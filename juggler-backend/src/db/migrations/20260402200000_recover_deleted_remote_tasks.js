/**
 * Recover tasks that were incorrectly hard-deleted by the sync engine.
 *
 * Bug: when /me/calendarView transiently failed to return an event, the sync
 * concluded it had been deleted on the provider side and hard-deleted the
 * Juggler task (cal-sync.controller.js, Scenario D). This migration recreates
 * those tasks from the ledger's cached event metadata and re-links them.
 *
 * Recovery logic:
 *  1. Find all deleted_remote ledger entries with event data.
 *  2. Deduplicate: same event_summary + similar event_start → keep the one
 *     with a provider_event_id (so we can re-link).
 *  3. Skip entries whose event_summary already exists as a task in the DB.
 *  4. Create tasks from the ledger data, re-link ledger entries to active.
 */

var { isoToJugglerDate, computeDurationMinutes } = require('../../controllers/cal-sync-helpers');
var { localToUtc } = require('../../scheduler/dateHelpers');

var DEFAULT_TIMEZONE = 'America/New_York';

exports.up = async function(knex) {
  var tz = DEFAULT_TIMEZONE;

  // Get user (single-user system for now)
  var user = await knex('users').select('id', 'timezone').first();
  if (!user) return;
  if (user.timezone) tz = user.timezone;
  var userId = user.id;

  // 1. Get all deleted_remote ledger entries with event data
  var entries = await knex('cal_sync_ledger')
    .where('status', 'deleted_remote')
    .where('user_id', userId)
    .whereNotNull('event_summary')
    .whereNotNull('event_start')
    .orderBy('synced_at', 'desc')
    .select();

  if (!entries.length) return;

  // 2. Get all existing task texts for dedup
  var existingTasks = await knex('tasks')
    .where('user_id', userId)
    .select('id', 'text', 'status', 'scheduled_at');
  var existingTextSet = new Set(existingTasks.map(function(t) { return t.text; }));

  // 3. Deduplicate entries by event_summary.
  //    For each unique summary, keep the MOST RECENT entry that has a
  //    provider_event_id. If multiple providers have the same summary,
  //    pick one per provider so we can re-link both.
  var byKey = {}; // key = summary -> { perProvider: { gcal: entry, msft: entry } }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var key = e.event_summary.trim();
    if (!byKey[key]) byKey[key] = {};
    var prov = e.provider;
    // Keep the entry with a provider_event_id, preferring more recent
    if (!byKey[key][prov] || (!byKey[key][prov].provider_event_id && e.provider_event_id)) {
      byKey[key][prov] = e;
    }
  }

  var recovered = 0;
  var skipped = 0;
  var summaries = Object.keys(byKey);

  for (var si = 0; si < summaries.length; si++) {
    var summary = summaries[si];
    var provEntries = byKey[summary];

    // Skip if task with same text already exists
    if (existingTextSet.has(summary)) {
      skipped++;
      // Still clean up orphaned ledger entries: re-link to existing task
      var existingTask = existingTasks.find(function(t) { return t.text === summary; });
      if (existingTask) {
        var provs = Object.keys(provEntries);
        for (var pi = 0; pi < provs.length; pi++) {
          var le = provEntries[provs[pi]];
          if (le.provider_event_id) {
            var eventIdCol = le.provider === 'gcal' ? 'gcal_event_id' : 'msft_event_id';
            await knex('cal_sync_ledger').where('id', le.id).update({
              status: 'active',
              task_id: existingTask.id,
              miss_count: 0,
              synced_at: knex.fn.now()
            });
            await knex('tasks').where('id', existingTask.id).update({
              [eventIdCol]: le.provider_event_id,
              updated_at: knex.fn.now()
            });
          }
        }
      }
      continue;
    }

    // Pick the best entry (prefer one with event_id, prefer msft for time data)
    var providers = Object.keys(provEntries);
    var best = provEntries[providers[0]];
    for (var pi2 = 1; pi2 < providers.length; pi2++) {
      var candidate = provEntries[providers[pi2]];
      if (!best.provider_event_id && candidate.provider_event_id) best = candidate;
    }

    // Parse the event start to compute scheduled_at (UTC datetime for MySQL)
    var startStr = best.event_start;
    var endStr = best.event_end;
    var isAllDay = !!best.event_all_day;
    var dur = 30;
    if (!isAllDay && startStr && endStr) {
      dur = computeDurationMinutes(startStr, endStr);
    }

    var scheduledAt = null;
    var whenVal = null;

    if (isAllDay) {
      // All-day: parse date, store as midnight UTC
      var jd = isoToJugglerDate(startStr, tz);
      if (jd.date) {
        scheduledAt = localToUtc(jd.date, '12:00 AM', tz);
      }
      whenVal = 'allday';
    } else if (startStr) {
      // Timed event — event_start may have timezone offset or be UTC
      var d = new Date(startStr);
      if (!isNaN(d.getTime())) {
        // Convert to MySQL datetime string (UTC)
        scheduledAt = d.getFullYear() + '-' +
          String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
          String(d.getUTCDate()).padStart(2, '0') + ' ' +
          String(d.getUTCHours()).padStart(2, '0') + ':' +
          String(d.getUTCMinutes()).padStart(2, '0') + ':' +
          String(d.getUTCSeconds()).padStart(2, '0');

        // Determine 'when' bucket from local hour
        var jd2 = isoToJugglerDate(startStr, tz);
        if (jd2.time) {
          var match = jd2.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
          if (match) {
            var h = parseInt(match[1], 10);
            var ap = match[3].toUpperCase();
            if (ap === 'PM' && h !== 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            if (h < 12) whenVal = 'morning';
            else if (h < 17) whenVal = 'afternoon';
            else whenVal = 'evening';
          }
        }
      }
    }

    if (!scheduledAt) continue; // Can't recover without a date

    // Generate a task ID
    var taskId = 'recovered_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    // Determine event ID columns
    var gcalEventId = null;
    var msftEventId = null;
    for (var pi3 = 0; pi3 < providers.length; pi3++) {
      var pe = provEntries[providers[pi3]];
      if (pe.provider === 'gcal' && pe.provider_event_id) gcalEventId = pe.provider_event_id;
      if (pe.provider === 'msft' && pe.provider_event_id) msftEventId = pe.provider_event_id;
    }

    await knex.transaction(async function(trx) {
      // Create the task
      await trx('tasks').insert({
        id: taskId,
        task_type: 'task',
        user_id: userId,
        text: summary,
        scheduled_at: scheduledAt,
        dur: dur,
        pri: 'P3',
        status: '',
        when: whenVal,
        habit: 0,
        generated: 0,
        gcal_event_id: gcalEventId,
        msft_event_id: msftEventId,
        depends_on: JSON.stringify([]),
        location: JSON.stringify([]),
        tools: JSON.stringify([]),
        marker: 0,
        flex_when: 0
      });

      // Re-link ledger entries
      for (var pi4 = 0; pi4 < providers.length; pi4++) {
        var le2 = provEntries[providers[pi4]];
        if (le2.provider_event_id) {
          await trx('cal_sync_ledger').where('id', le2.id).update({
            status: 'active',
            task_id: taskId,
            miss_count: 0,
            synced_at: trx.fn.now()
          });
        }
      }
    });

    existingTextSet.add(summary);
    recovered++;
  }

  console.log('[RECOVERY] Recovered ' + recovered + ' tasks, skipped ' + skipped + ' (already exist)');

  // 4. Clean up duplicate deleted_local entries for the same event_summary
  //    These are the orphaned pull-delete loop entries
  var duplicateLocal = await knex('cal_sync_ledger')
    .where('status', 'deleted_local')
    .where('user_id', userId)
    .whereNull('task_id')
    .whereNull('provider_event_id')
    .select('id');

  if (duplicateLocal.length > 0) {
    var ids = duplicateLocal.map(function(d) { return d.id; });
    // Delete in batches of 500
    for (var bi = 0; bi < ids.length; bi += 500) {
      var batch = ids.slice(bi, bi + 500);
      await knex('cal_sync_ledger').whereIn('id', batch).del();
    }
    console.log('[RECOVERY] Cleaned up ' + duplicateLocal.length + ' orphaned deleted_local ledger entries');
  }
};

exports.down = async function(knex) {
  // Delete recovered tasks (identifiable by ID prefix)
  await knex('tasks').where('id', 'like', 'recovered_%').del();
  // Note: ledger entries will remain as deleted_remote — a re-run of the up
  // migration would re-recover them
};
