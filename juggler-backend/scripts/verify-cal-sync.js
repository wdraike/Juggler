#!/usr/bin/env node
/**
 * Post-sync verification script.
 * Compares DB task state against live calendar events from both providers.
 * Read-only — does not modify task or sync data.
 *
 * Usage: node scripts/verify-cal-sync.js
 * Exit 0 = pass, Exit 1 = fail
 */

var db = require('../src/db');
var { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
var gcal = require('../src/lib/cal-adapters/gcal.adapter');
var msft = require('../src/lib/cal-adapters/msft.adapter');
var { isoToJugglerDate, DEFAULT_TIMEZONE } = require('../src/controllers/cal-sync-helpers');

function compareTaskToEvent(task, event, tz) {
  var diffs = [];

  // 1. Title — done tasks get ✓ prefix when pushed
  var isDone = task.status === 'done';
  var expectedTitle = isDone ? '✓ ' + task.text : task.text;
  if (event.title !== expectedTitle) {
    diffs.push({ field: 'title', task: expectedTitle, event: event.title });
  }

  // 2. All-day status
  var taskIsAllDay = task.when === 'allday';
  if (event.isAllDay !== taskIsAllDay) {
    diffs.push({ field: 'isAllDay', task: taskIsAllDay, event: event.isAllDay });
  }

  // 3. Duration (skip for all-day events)
  if (!taskIsAllDay && !event.isAllDay) {
    if (task.dur !== event.durationMinutes) {
      diffs.push({ field: 'duration', task: task.dur, event: event.durationMinutes });
    }
  }

  // 4. Start time (2-min tolerance for timezone rounding)
  if (!taskIsAllDay && task.scheduledAt && event.startDateTime) {
    var eventStartStr = event.startDateTime;
    // MSFT sends bare local datetime with timeZone field; if UTC, append Z for parsing.
    // Also handle when startTimezone is missing — MSFT events pushed by Juggler always use UTC.
    if (!/Z$/.test(eventStartStr) && !/[+-]\d{2}:\d{2}$/.test(eventStartStr)) {
      eventStartStr = eventStartStr + 'Z';
    }
    var taskStart = new Date(task.scheduledAt).getTime();
    var eventStart = new Date(eventStartStr).getTime();
    if (!isNaN(taskStart) && !isNaN(eventStart) && Math.abs(taskStart - eventStart) > 2 * 60 * 1000) {
      diffs.push({
        field: 'startTime', task: task.scheduledAt, event: event.startDateTime,
        diffMinutes: Math.round((taskStart - eventStart) / 60000)
      });
    }
  }

  // 5. All-day date match
  if (taskIsAllDay && event.isAllDay && task.date && event.startDateTime) {
    var eventJd = isoToJugglerDate(event.startDateTime, tz);
    if (eventJd.date !== task.date) {
      diffs.push({ field: 'allDayDate', task: task.date, event: eventJd.date });
    }
  }

  // 6. Marker / transparency (done tasks are always pushed as transparent)
  if (!isDone && !!task.marker !== event.isTransparent) {
    diffs.push({ field: 'marker', task: task.marker, event: event.isTransparent });
  }

  return diffs;
}

async function run() {
  // Load user (single-user dev setup)
  var user = await db('users').first();
  if (!user) { console.error('No user found'); process.exit(1); }
  var tz = user.timezone || DEFAULT_TIMEZONE;

  // Sync window: 90 days back, 60 days forward (matches cal-sync.controller.js)
  var now = new Date();
  var windowStart = new Date(now); windowStart.setDate(windowStart.getDate() - 90);
  var windowEnd = new Date(now);   windowEnd.setDate(windowEnd.getDate() + 60);
  var timeMin = windowStart.toISOString();
  var timeMax = windowEnd.toISOString();

  console.log('Sync window: ' + timeMin.slice(0, 10) + ' to ' + timeMax.slice(0, 10));
  console.log('Timezone: ' + tz);

  // Load all tasks (need full set for buildSourceMap)
  var allTaskRows = await db('tasks')
    .where('user_id', user.id)
    .whereNotNull('scheduled_at')
    .select();

  var sourceMap = buildSourceMap(allTaskRows);

  // Filter to synced tasks within window
  var syncedRows = allTaskRows.filter(function(r) {
    return r.gcal_event_id || r.msft_event_id;
  });
  var tasks = syncedRows.map(function(r) { return rowToTask(r, tz, sourceMap); });

  console.log('Total scheduled tasks: ' + allTaskRows.length);
  console.log('Tasks with calendar event IDs: ' + tasks.length);

  // Determine connected providers
  var providers = [];
  if (user.gcal_refresh_token) providers.push({ adapter: gcal, name: 'gcal', eventIdField: 'gcalEventId' });
  if (user.msft_cal_refresh_token) providers.push({ adapter: msft, name: 'msft', eventIdField: 'msftEventId' });

  if (providers.length === 0) {
    console.log('\nNo calendar providers connected. Nothing to verify.');
    await db.destroy();
    process.exit(0);
  }

  console.log('Connected providers: ' + providers.map(function(p) { return p.name; }).join(', '));

  // Fetch live events from each provider
  var providerEvents = {};
  for (var pi = 0; pi < providers.length; pi++) {
    var p = providers[pi];
    console.log('\nFetching events from ' + p.name + '...');
    try {
      var token = await p.adapter.getValidAccessToken(user);
      var events = await p.adapter.listEvents(token, timeMin, timeMax, user.id);
      var byId = {};
      events.forEach(function(e) { byId[e.id] = e; });
      providerEvents[p.name] = { byId: byId, all: events };
      console.log('  Found ' + events.length + ' events');
    } catch (err) {
      console.error('  ERROR fetching ' + p.name + ': ' + err.message);
      providerEvents[p.name] = { byId: {}, all: [] };
    }
  }

  // Compare tasks to events per provider
  var fail = false;

  console.log('\n=== Calendar Sync Verification Report ===\n');

  for (var pi2 = 0; pi2 < providers.length; pi2++) {
    var prov = providers[pi2];
    var eventsById = providerEvents[prov.name].byId;
    var allProvEvents = providerEvents[prov.name].all;
    var matchedEventIds = new Set();

    var matches = [];
    var mismatches = [];
    var staleTaskIds = [];
    var orphanEvents = [];

    // Check each synced task against its calendar event
    for (var ti = 0; ti < tasks.length; ti++) {
      var task = tasks[ti];
      var eventId = task[prov.eventIdField];
      if (!eventId) continue;

      var event = eventsById[eventId];
      if (!event) {
        // Task references event not found in calendar — could be outside window or deleted
        staleTaskIds.push({ taskId: task.id, text: task.text, eventId: eventId });
        continue;
      }

      matchedEventIds.add(eventId);
      var diffs = compareTaskToEvent(task, event, tz);
      if (diffs.length === 0) {
        matches.push({ taskId: task.id, text: task.text });
      } else {
        mismatches.push({ taskId: task.id, text: task.text, diffs: diffs });
      }
    }

    // Check for orphan events (Juggler-created events with no matching task AND no ledger entry)
    var ledgerEventIds = new Set();
    var allLedger = await db('cal_sync_ledger')
      .where('user_id', user.id)
      .where('provider', prov.name)
      .whereNotNull('provider_event_id')
      .pluck('provider_event_id');
    allLedger.forEach(function(id) { ledgerEventIds.add(id); });

    for (var ei = 0; ei < allProvEvents.length; ei++) {
      var ev = allProvEvents[ei];
      if (matchedEventIds.has(ev.id)) continue;
      if (ledgerEventIds.has(ev.id)) continue; // known to ledger, not a true orphan
      var desc = ev.description || '';
      var rawBody = (ev._raw && ev._raw.body && ev._raw.body.content) || '';
      var combined = desc + ' ' + rawBody;
      if (combined.indexOf('Synced from Raike') >= 0 || combined.indexOf('Synced from Juggler') >= 0) {
        orphanEvents.push({ eventId: ev.id, title: ev.title });
      }
    }

    // Report
    var total = matches.length + mismatches.length + staleTaskIds.length;
    var provLabel = prov.name === 'gcal' ? 'Google Calendar' : 'Microsoft Calendar';
    console.log('--- ' + provLabel + ' (' + prov.name + ') ---');
    console.log('  Tasks synced to this provider: ' + total);
    console.log('  Provider events in window: ' + allProvEvents.length);
    console.log('  Matches:      ' + matches.length);
    console.log('  Mismatches:   ' + mismatches.length);
    console.log('  Stale IDs:    ' + staleTaskIds.length + '  (task has event ID but event not in calendar window)');
    console.log('  Orphan events: ' + orphanEvents.length + '  (Juggler-created event with no matching task)');

    if (mismatches.length > 0) {
      fail = true;
      console.log('');
      mismatches.forEach(function(m) {
        console.log('  MISMATCH: "' + m.text + '" (task ' + m.taskId + ')');
        m.diffs.forEach(function(d) {
          var extra = d.diffMinutes !== undefined ? ' (diff: ' + d.diffMinutes + ' min)' : '';
          console.log('    ' + d.field + ': task=' + JSON.stringify(d.task) + '  event=' + JSON.stringify(d.event) + extra);
        });
      });
    }

    if (staleTaskIds.length > 0) {
      console.log('');
      staleTaskIds.forEach(function(s) {
        console.log('  STALE: "' + s.text + '" (task ' + s.taskId + ') -> ' + s.eventId);
      });
    }

    if (orphanEvents.length > 0) {
      fail = true;
      console.log('');
      orphanEvents.forEach(function(o) {
        console.log('  ORPHAN: "' + o.title + '" (event ' + o.eventId + ')');
      });
    }

    console.log('');
  }

  console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS');
  await db.destroy();
  process.exit(fail ? 1 : 0);
}

run().catch(function(err) {
  console.error('FATAL:', err);
  db.destroy().then(function() { process.exit(1); });
});
