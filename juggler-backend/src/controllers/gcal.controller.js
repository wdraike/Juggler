/**
 * Google Calendar Controller — OAuth flow + ledger-based bidirectional sync
 *
 * Tasks are stored with scheduled_at (UTC DATETIME) as the single source of truth.
 * This controller derives local date/time via rowToTask() for building GCal events,
 * and computes scheduled_at via localToUtc() when pulling events from GCal.
 */

var crypto = require('crypto');
var { SignJWT, jwtVerify } = require('jose');
var db = require('../db');
var gcalApi = require('../lib/gcal-api');
var { runScheduleAndPersist } = require('../scheduler/runSchedule');
var { rowToTask } = require('./task.controller');
var { localToUtc } = require('../scheduler/dateHelpers');
var { jugglerDateToISO, isoToJugglerDate, computeDurationMinutes, taskHash, DEFAULT_TIMEZONE } = require('./cal-sync-helpers');

// Re-export helpers from cal-sync-helpers for backward compatibility
// (msft-cal.controller.js imports from here)

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

/**
 * Hash the GCal event fields we care about.
 */
function eventHash(event) {
  var startStr = event.start?.dateTime || event.start?.date || '';
  var endStr = event.end?.dateTime || event.end?.date || '';
  var str = [
    event.summary || '',
    startStr,
    endStr,
    event.description || ''
  ].join('|');
  return crypto.createHash('md5').update(str).digest('hex');
}

// --- Token management ---

function getJwtSecret() {
  var secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET required in production');
    secret = 'local-dev-jwt-secret-juggler';
  }
  return new TextEncoder().encode(secret);
}

async function getValidAccessToken(user) {
  if (!user.gcal_refresh_token) {
    throw new Error('Google Calendar not connected');
  }

  if (user.gcal_access_token && user.gcal_token_expiry) {
    var expiryStr = String(user.gcal_token_expiry);
    var expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
    if (expiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return user.gcal_access_token;
    }
  }

  var oauth2Client = gcalApi.createOAuth2Client();
  var credentials = await gcalApi.refreshAccessToken(oauth2Client, user.gcal_refresh_token);

  var update = {
    gcal_access_token: credentials.access_token,
    updated_at: db.fn.now()
  };
  if (credentials.expiry_date) {
    update.gcal_token_expiry = new Date(credentials.expiry_date);
  }

  await db('users').where('id', user.id).update(update);

  return credentials.access_token;
}

// --- Build GCal event body from a task object (with date/time from rowToTask) ---

function buildEventBody(task, year, timezone) {
  var tz = timezone || DEFAULT_TIMEZONE;
  var startISO = jugglerDateToISO(task.date, task.time, year);
  var dur = task.dur || 30;
  var isAllDay = task.when === 'allday';

  if (isAllDay) {
    var dateParts = (task.date || '').split('/');
    var month = parseInt(dateParts[0], 10);
    var day = parseInt(dateParts[1], 10);
    var y = year || new Date().getFullYear();
    var startDate = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var endObj = new Date(y, month - 1, day + 1);
    var endDate = endObj.getFullYear() + '-' + String(endObj.getMonth() + 1).padStart(2, '0') + '-' + String(endObj.getDate()).padStart(2, '0');

    var descParts = [];
    if (task.project) descParts.push('Project: ' + task.project);
    if (task.pri) descParts.push('Priority: ' + task.pri);
    if (task.notes) descParts.push('Notes: ' + task.notes);
    descParts.push('', 'Synced from Raike & Sons');

    return {
      summary: task.text,
      description: descParts.join('\n'),
      start: { date: startDate },
      end: { date: endDate }
    };
  }

  // Timed event
  var sParts = startISO.split('T');
  var tParts = sParts[1].split(':');
  var sMins = parseInt(tParts[0], 10) * 60 + parseInt(tParts[1], 10);
  var eMins = sMins + dur;
  var eH = Math.floor(eMins / 60);
  var eM = eMins % 60;
  var endISO = sParts[0] + 'T' + String(eH).padStart(2, '0') + ':' + String(eM).padStart(2, '0') + ':00';

  var descParts2 = [];
  if (task.project) descParts2.push('Project: ' + task.project);
  if (task.pri) descParts2.push('Priority: ' + task.pri);
  if (task.notes) descParts2.push('Notes: ' + task.notes);
  descParts2.push('', 'Synced from Raike & Sons');

  return {
    summary: task.text,
    description: descParts2.join('\n'),
    start: { dateTime: startISO, timeZone: tz },
    end: { dateTime: endISO, timeZone: tz }
  };
}

// --- Apply GCal event data → DB update fields ---

function applyEventToTask(event, timezone) {
  var tz = timezone || DEFAULT_TIMEZONE;
  var startStr = event.start?.dateTime || event.start?.date;
  var endStr = event.end?.dateTime || event.end?.date;
  var isAllDay = !event.start?.dateTime;
  var jd = isoToJugglerDate(startStr, tz);
  var eventDur = 30;
  if (!isAllDay && startStr && endStr) {
    eventDur = computeDurationMinutes(startStr, endStr);
  }

  var fields = {
    text: event.summary || '(No title)',
    dur: eventDur,
    updated_at: db.fn.now()
  };

  // Compute scheduled_at from the event's local date+time
  if (jd.date) {
    if (isAllDay) {
      fields.scheduled_at = localToUtc(jd.date, '12:00 AM', tz);
    } else if (jd.time) {
      fields.scheduled_at = localToUtc(jd.date, jd.time, tz);
    }
  }

  if (isAllDay) {
    fields.when = 'allday';
  }
  return fields;
}

// --- Endpoints ---

async function getStatus(req, res) {
  try {
    var hasToken = !!req.user.gcal_refresh_token;
    var lastSyncedAt = req.user.gcal_last_synced_at || null;
    var connected = false;
    var tokenExpired = false;

    if (hasToken) {
      // Validate the token by attempting a refresh
      try {
        var gcalApi = require('../lib/gcal-api');
        var oauth2Client = gcalApi.createOAuth2Client();
        var creds = await gcalApi.refreshAccessToken(oauth2Client, req.user.gcal_refresh_token);

        // Token is valid — update it in DB
        var update = { gcal_access_token: creds.access_token, updated_at: db.fn.now() };
        if (creds.expiry_date) update.gcal_token_expiry = new Date(creds.expiry_date);
        await db('users').where('id', req.user.id).update(update);

        connected = true;
      } catch (tokenErr) {
        var msg = tokenErr.message || '';
        if (msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
          // Token is dead — clear it so the user can reconnect
          await db('users').where('id', req.user.id).update({
            gcal_access_token: null,
            gcal_refresh_token: null,
            gcal_token_expiry: null,
            updated_at: db.fn.now()
          });
          tokenExpired = true;
          connected = false;
        } else {
          // Transient error (network, etc.) — report connected but note the error
          connected = true;
        }
      }
    }

    var autoSyncRow = await db('user_config')
      .where({ user_id: req.user.id, config_key: 'gcal_auto_sync' })
      .first();
    var autoSync = false;
    if (autoSyncRow) {
      var val = typeof autoSyncRow.config_value === 'string'
        ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value;
      autoSync = !!val;
    }

    res.json({
      connected: connected,
      tokenExpired: tokenExpired,
      email: req.user.email,
      lastSyncedAt: lastSyncedAt,
      autoSync: autoSync
    });
  } catch (error) {
    console.error('GCal status error:', error);
    res.status(500).json({ error: 'Failed to check GCal status' });
  }
}

async function connect(req, res) {
  try {
    var oauth2Client = gcalApi.createOAuth2Client();
    var state = await new SignJWT({ userId: req.user.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(getJwtSecret());
    var authUrl = gcalApi.getAuthUrl(oauth2Client, state);
    res.json({ authUrl: authUrl });
  } catch (error) {
    console.error('GCal connect error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

async function callback(req, res) {
  try {
    var code = req.query.code;
    var state = req.query.state;

    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }

    var decoded;
    try {
      var result = await jwtVerify(state, getJwtSecret());
      decoded = result.payload;
    } catch (e) {
      return res.status(400).send('Invalid or expired state parameter');
    }

    var userId = decoded.userId;
    var oauth2Client = gcalApi.createOAuth2Client();
    var tokens = await gcalApi.getTokensFromCode(oauth2Client, code);

    var update = {
      gcal_access_token: tokens.access_token,
      updated_at: db.fn.now()
    };
    if (tokens.refresh_token) {
      update.gcal_refresh_token = tokens.refresh_token;
    }
    if (tokens.expiry_date) {
      update.gcal_token_expiry = new Date(tokens.expiry_date);
    }

    await db('users').where('id', userId).update(update);

    var frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3001').split(',')[0];
    res.redirect(frontendUrl + '/?gcal=connected');
  } catch (error) {
    console.error('GCal callback error:', error);
    res.status(500).send('Failed to complete Google Calendar authorization');
  }
}

async function disconnect(req, res) {
  try {
    await db('users').where('id', req.user.id).update({
      gcal_access_token: null,
      gcal_refresh_token: null,
      gcal_token_expiry: null,
      updated_at: db.fn.now()
    });
    res.json({ disconnected: true });
  } catch (error) {
    console.error('GCal disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect GCal' });
  }
}

/**
 * POST /api/gcal/push — push done tasks as GCal events
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 */
async function push(req, res) {
  try {
    var from = req.body.from;
    var to = req.body.to;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date range required' });
    }

    var accessToken = await getValidAccessToken(req.user);
    var userId = req.user.id;
    var userRow = await db('users').where('id', userId).select('timezone').first();
    var tz = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;
    var year = new Date().getFullYear();

    // Filter by scheduled_at range in the query
    var fromUTC = new Date(from + 'T00:00:00Z');
    var toUTC = new Date(to + 'T23:59:59Z');

    var taskRows = await db('tasks')
      .where('user_id', userId)
      .where('status', 'done')
      .whereNull('gcal_event_id')
      .whereNotNull('scheduled_at')
      .where('scheduled_at', '>=', fromUTC)
      .where('scheduled_at', '<=', toUTC)
      .select();

    var tasksInRange = taskRows.map(function(r) { return rowToTask(r, tz); });

    var pushed = 0;
    var errors = [];

    for (var i = 0; i < tasksInRange.length; i++) {
      var task = tasksInRange[i];
      try {
        var eventBody = buildEventBody(task, year, tz);
        var created = await gcalApi.insertEvent(accessToken, eventBody);

        await db.transaction(async function(trx) {
          await trx('tasks').where('id', task.id).update({
            gcal_event_id: created.id,
            updated_at: db.fn.now()
          });

          await trx('gcal_sync_ledger').insert({
            user_id: userId,
            task_id: task.id,
            gcal_event_id: created.id,
            origin: 'juggler',
            last_pushed_hash: taskHash(task),
            last_pulled_hash: eventHash(created),
            gcal_summary: task.text,
            gcal_start: created.start?.dateTime || created.start?.date || null,
            gcal_end: created.end?.dateTime || created.end?.date || null,
            gcal_all_day: !created.start?.dateTime ? 1 : 0,
            status: 'active',
            synced_at: db.fn.now(),
            created_at: db.fn.now()
          });
        });

        pushed++;
      } catch (e) {
        errors.push({ taskId: task.id, error: e.message });
      }
    }

    res.json({ pushed: pushed, errors: errors, total: tasksInRange.length });
  } catch (error) {
    if (error.message === 'Google Calendar not connected') {
      return res.status(400).json({ error: error.message });
    }
    console.error('GCal push error:', error);
    res.status(500).json({ error: 'Failed to push tasks to GCal' });
  }
}

/**
 * POST /api/gcal/pull — pull GCal events as Juggler tasks
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 */
async function pull(req, res) {
  try {
    var from = req.body.from;
    var to = req.body.to;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date range required' });
    }

    var accessToken = await getValidAccessToken(req.user);
    var userId = req.user.id;
    var userRow = await db('users').where('id', userId).select('timezone').first();
    var tz = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;

    var timeMin = from + 'T00:00:00Z';
    var timeMax = to + 'T23:59:59Z';

    var result = await gcalApi.listEvents(accessToken, timeMin, timeMax);
    var events = (result && result.items) || [];

    var existingLedger = await db('gcal_sync_ledger')
      .where('user_id', userId)
      .whereNotNull('gcal_event_id')
      .pluck('gcal_event_id');
    var ledgerSet = new Set(existingLedger);

    var existingTaskIds = await db('tasks')
      .where('user_id', userId)
      .whereNotNull('gcal_event_id')
      .pluck('gcal_event_id');
    var taskSet = new Set(existingTaskIds);

    var pulled = 0;
    var skipped = 0;

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (ledgerSet.has(event.id) || taskSet.has(event.id)) {
        skipped++;
        continue;
      }

      // Skip events that originated from Juggler (round-trip prevention)
      var evDescription = event.description || '';
      if (evDescription.indexOf('Synced from Raike & Sons') !== -1 || evDescription.indexOf('Synced from Juggler') !== -1) {
        skipped++;
        continue;
      }

      var startStr = event.start?.dateTime || event.start?.date;
      var isAllDay = !event.start?.dateTime;
      var endStr = event.end?.dateTime || event.end?.date;

      var jugglerDate = isoToJugglerDate(startStr, tz);
      var dur = 30;
      if (!isAllDay && startStr && endStr) {
        dur = computeDurationMinutes(startStr, endStr);
      }

      var taskId = 'gcal_' + crypto.randomBytes(8).toString('hex');

      // Compute scheduled_at
      var scheduledAt = null;
      if (jugglerDate.date) {
        if (isAllDay) {
          scheduledAt = localToUtc(jugglerDate.date, '12:00 AM', tz);
        } else if (jugglerDate.time) {
          scheduledAt = localToUtc(jugglerDate.date, jugglerDate.time, tz);
        }
      }

      var row = {
        id: taskId,
        user_id: userId,
        text: event.summary || '(No title)',
        scheduled_at: scheduledAt,
        dur: dur,
        pri: 'P3',
        status: '',
        when: isAllDay ? 'allday' : 'fixed',
        rigid: 1,
        gcal_event_id: event.id,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      };

      if (event.description) {
        row.notes = event.description;
      }

      await db.transaction(async function(trx) {
        await trx('tasks').insert(row);

        await trx('gcal_sync_ledger').insert({
          user_id: userId,
          task_id: taskId,
          gcal_event_id: event.id,
          origin: 'gcal',
          last_pushed_hash: null,
          last_pulled_hash: eventHash(event),
          gcal_summary: event.summary || '(No title)',
          gcal_start: startStr || null,
          gcal_end: endStr || null,
          gcal_all_day: isAllDay ? 1 : 0,
          status: 'active',
          synced_at: db.fn.now(),
          created_at: db.fn.now()
        });
      });

      pulled++;
    }

    res.json({ pulled: pulled, skipped: skipped, total: events.length });
  } catch (error) {
    if (error.message === 'Google Calendar not connected') {
      return res.status(400).json({ error: error.message });
    }
    console.error('GCal pull error:', error);
    res.status(500).json({ error: 'Failed to pull events from GCal' });
  }
}

/**
 * POST /api/gcal/sync — ledger-based bidirectional sync
 * Sync window: 90 days back + 60 days forward
 */
async function sync(req, res) {
  try {
    var accessToken = await getValidAccessToken(req.user);
    var userId = req.user.id;
    var userRow = await db('users').where('id', userId).select('timezone').first();
    var tz = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;
    var year = new Date().getFullYear();
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    var windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 90);
    var windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 60);

    var stats = { pushed: 0, pulled: 0, deleted_local: 0, deleted_remote: 0, errors: [] };

    // === Phase 0: Run scheduler ===
    try {
      var schedResult = await runScheduleAndPersist(userId);
      stats.scheduler = { moved: schedResult.moved, tasks: schedResult.tasks };
    } catch (schedErr) {
      console.error('GCal sync Phase 0 (scheduler) error:', schedErr);
      stats.errors.push({ phase: 'scheduler', error: schedErr.message });
    }

    // === Phase 1: Build state maps ===

    var ledgerRecords = await db('gcal_sync_ledger')
      .where('user_id', userId)
      .where('status', 'active')
      .select();

    var timeMin = windowStart.toISOString();
    var timeMax = windowEnd.toISOString();
    var result = await gcalApi.listEvents(accessToken, timeMin, timeMax);
    var gcalEvents = (result && result.items) || [];

    // Load all user tasks that have a scheduled date
    var allTaskRows = await db('tasks')
      .where('user_id', userId)
      .whereNotNull('scheduled_at')
      .select();

    // Map through rowToTask to get date/time/day properties
    var allTasks = allTaskRows.map(function(r) {
      var t = rowToTask(r, tz);
      // Carry over raw DB fields needed for sync logic
      t._habit = r.habit;
      t._generated = r.generated;
      t._scheduled_at = r.scheduled_at;
      return t;
    });

    var ledgerByTaskId = {};
    var ledgerByGcalId = {};
    for (var lr of ledgerRecords) {
      if (lr.task_id) ledgerByTaskId[lr.task_id] = lr;
      if (lr.gcal_event_id) ledgerByGcalId[lr.gcal_event_id] = lr;
    }

    var gcalEventsById = {};
    for (var ev of gcalEvents) {
      gcalEventsById[ev.id] = ev;
    }

    var tasksById = {};
    for (var ti = 0; ti < allTasks.length; ti++) {
      tasksById[allTasks[ti].id] = allTasks[ti];
    }

    var processedTaskIds = new Set();
    var processedGcalIds = new Set();

    // === Phase 2: Process existing ledger records ===

    for (var li = 0; li < ledgerRecords.length; li++) {
      var ledger = ledgerRecords[li];
      var task = ledger.task_id ? tasksById[ledger.task_id] : null;
      var event = ledger.gcal_event_id ? gcalEventsById[ledger.gcal_event_id] : null;

      if (ledger.task_id) processedTaskIds.add(ledger.task_id);
      if (ledger.gcal_event_id) processedGcalIds.add(ledger.gcal_event_id);

      try {
        // Habit/generated tasks should NOT be on GCal
        if (task && (task._habit || task._generated) && event) {
          try {
            await gcalApi.deleteEvent(accessToken, ledger.gcal_event_id);
            await delay(100);
          } catch (e2) {
            if (!e2.message.includes('404') && !e2.message.includes('410')) throw e2;
          }
          await db.transaction(async function(trx) {
            await trx('tasks').where('id', task.id).update({
              gcal_event_id: null, updated_at: db.fn.now()
            });
            await trx('gcal_sync_ledger').where('id', ledger.id).update({
              status: 'deleted_local', gcal_event_id: null, synced_at: db.fn.now()
            });
          });
          stats.deleted_local++;
          continue;
        }
        if (task && (task._habit || task._generated) && !event) {
          await db.transaction(async function(trx) {
            await trx('tasks').where('id', task.id).update({
              gcal_event_id: null, updated_at: db.fn.now()
            });
            await trx('gcal_sync_ledger').where('id', ledger.id).update({
              status: 'deleted_local', gcal_event_id: null, synced_at: db.fn.now()
            });
          });
          continue;
        }

        // Past juggler-origin tasks that aren't done → remove from GCal
        if (task && event && ledger.origin === 'juggler' && task._scheduled_at) {
          var taskScheduledAt = task._scheduled_at instanceof Date ? task._scheduled_at : new Date(String(task._scheduled_at).replace(' ', 'T') + 'Z');
          var taskIsPast = taskScheduledAt < todayStart;
          var taskNotDone = task.status !== 'done' && task.status !== 'skip';
          if (taskIsPast && taskNotDone) {
            try {
              await gcalApi.deleteEvent(accessToken, ledger.gcal_event_id);
              await delay(100);
            } catch (e3) {
              if (!e3.message.includes('404') && !e3.message.includes('410')) throw e3;
            }
            await db.transaction(async function(trx) {
              await trx('tasks').where('id', task.id).update({ gcal_event_id: null, updated_at: db.fn.now() });
              await trx('gcal_sync_ledger').where('id', ledger.id).update({
                status: 'deleted_local', gcal_event_id: null, synced_at: db.fn.now()
              });
            });
            stats.deleted_local++;
            continue;
          }
        }

        if (task && event) {
          // Never apply calendar changes to habit source templates
          var isHabitSource = task._habit && !task._generated;

          var currentTaskHash = taskHash(task);
          var currentEventHash = eventHash(event);
          var taskChanged = currentTaskHash !== ledger.last_pushed_hash;
          var eventChanged = currentEventHash !== ledger.last_pulled_hash;

          // Skip overwriting scheduled_at for fixed tasks
          var isFixed = task.when && task.when.indexOf('fixed') >= 0;

          if (taskChanged && eventChanged) {
            if (ledger.origin === 'juggler' || isHabitSource || isFixed) {
              var eventBody = buildEventBody(task, year, tz);
              await gcalApi.patchEvent(accessToken, ledger.gcal_event_id, eventBody);
              await delay(100);
              stats.pushed++;
            } else {
              var updateFields = applyEventToTask(event, tz);
              await db('tasks').where('id', task.id).update(updateFields);
              stats.pulled++;
            }
          } else if (taskChanged) {
            var eventBody2 = buildEventBody(task, year, tz);
            await gcalApi.patchEvent(accessToken, ledger.gcal_event_id, eventBody2);
            await delay(100);
            stats.pushed++;
          } else if (eventChanged) {
            if (!isHabitSource && !isFixed) {
              var updateFields2 = applyEventToTask(event, tz);
              await db('tasks').where('id', task.id).update(updateFields2);
              stats.pulled++;
            }
          }

          var startStr = event.start?.dateTime || event.start?.date || null;
          var endStr = event.end?.dateTime || event.end?.date || null;
          await db('gcal_sync_ledger').where('id', ledger.id).update({
            last_pushed_hash: taskChanged ? taskHash(task) : (ledger.last_pushed_hash || taskHash(task)),
            last_pulled_hash: eventHash(event),
            gcal_summary: event.summary || task.text,
            gcal_start: startStr,
            gcal_end: endStr,
            gcal_all_day: !event.start?.dateTime ? 1 : 0,
            synced_at: db.fn.now()
          });

        } else if (task && !event) {
          if (ledger.gcal_event_id) {
            var cachedStart = ledger.gcal_start;
            var eventInWindow = false;
            if (cachedStart) {
              var cachedDate = new Date(cachedStart);
              eventInWindow = cachedDate >= windowStart && cachedDate <= windowEnd;
            }
            if (eventInWindow) {
              await db.transaction(async function(trx) {
                var deletedDeps = typeof task.dependsOn === 'object' ? task.dependsOn : [];
                var affected = await trx('tasks')
                  .where('user_id', userId)
                  .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(task.id)])
                  .select('id', 'depends_on');
                for (var ai = 0; ai < affected.length; ai++) {
                  var a = affected[ai];
                  var deps = typeof a.depends_on === 'string'
                    ? JSON.parse(a.depends_on || '[]') : (a.depends_on || []);
                  var newDeps = deps.filter(function(d) { return d !== task.id; });
                  deletedDeps.forEach(function(d) { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
                  await trx('tasks').where({ id: a.id, user_id: userId })
                    .update({ depends_on: JSON.stringify(newDeps), updated_at: db.fn.now() });
                }
                await trx('tasks').where('id', task.id).del();
                await trx('gcal_sync_ledger').where('id', ledger.id).update({
                  status: 'deleted_remote',
                  task_id: null,
                  synced_at: db.fn.now()
                });
              });
              stats.deleted_remote++;
            }
          }

        } else if (!task && event) {
          try {
            await gcalApi.deleteEvent(accessToken, ledger.gcal_event_id);
            await delay(100);
          } catch (e) {
            if (!e.message.includes('404') && !e.message.includes('410')) {
              throw e;
            }
          }
          await db('gcal_sync_ledger').where('id', ledger.id).update({
            status: 'deleted_local',
            gcal_event_id: null,
            synced_at: db.fn.now()
          });
          stats.deleted_local++;

        } else {
          await db('gcal_sync_ledger').where('id', ledger.id).update({
            status: 'deleted_local',
            synced_at: db.fn.now()
          });
        }

      } catch (e) {
        stats.errors.push({
          phase: 'ledger',
          ledgerId: ledger.id,
          taskId: ledger.task_id,
          gcalEventId: ledger.gcal_event_id,
          error: e.message
        });
      }
    }

    // === Phase 3: Handle new items (no ledger record) ===

    // 3a: Tasks with scheduled_at and no ledger record → push to GCal
    for (var ti2 = 0; ti2 < allTasks.length; ti2++) {
      var newTask = allTasks[ti2];
      if (processedTaskIds.has(newTask.id)) continue;

      if (newTask._habit || newTask._generated) continue;
      if (!newTask.date) continue;
      if (!newTask.time && newTask.when !== 'allday') continue;

      // Only push future tasks
      var taskSA = newTask._scheduled_at instanceof Date ? newTask._scheduled_at : new Date(String(newTask._scheduled_at).replace(' ', 'T') + 'Z');
      if (taskSA < todayStart) continue;
      if (taskSA > windowEnd) continue;

      try {
        var newEventBody = buildEventBody(newTask, year, tz);
        var created = await gcalApi.insertEvent(accessToken, newEventBody);
        await delay(100);

        var createdStart = created.start?.dateTime || created.start?.date || null;
        var createdEnd = created.end?.dateTime || created.end?.date || null;

        await db.transaction(async function(trx) {
          await trx('tasks').where('id', newTask.id).update({
            gcal_event_id: created.id,
            updated_at: db.fn.now()
          });

          await trx('gcal_sync_ledger').insert({
            user_id: userId,
            task_id: newTask.id,
            gcal_event_id: created.id,
            origin: 'juggler',
            last_pushed_hash: taskHash(newTask),
            last_pulled_hash: eventHash(created),
            gcal_summary: newTask.text,
            gcal_start: createdStart,
            gcal_end: createdEnd,
            gcal_all_day: !created.start?.dateTime ? 1 : 0,
            status: 'active',
            synced_at: db.fn.now(),
            created_at: db.fn.now()
          });
        });

        stats.pushed++;
      } catch (e) {
        stats.errors.push({ phase: 'push_new', taskId: newTask.id, error: e.message });
      }
    }

    // 3b: GCal events not in any ledger record → create task
    var gcalEventIds = Object.keys(gcalEventsById);
    for (var ei = 0; ei < gcalEventIds.length; ei++) {
      var evId = gcalEventIds[ei];
      if (processedGcalIds.has(evId)) continue;
      var newEvent = gcalEventsById[evId];

      // Check if already linked to a task (pre-ledger)
      var existingTask = allTasks.find(function(t) { return t.gcalEventId === evId; });
      if (existingTask) {
        var origin = existingTask.id.startsWith('gcal_') ? 'gcal' : 'juggler';
        await db('gcal_sync_ledger').insert({
          user_id: userId,
          task_id: existingTask.id,
          gcal_event_id: evId,
          origin: origin,
          last_pushed_hash: taskHash(existingTask),
          last_pulled_hash: eventHash(newEvent),
          gcal_summary: newEvent.summary || existingTask.text,
          gcal_start: newEvent.start?.dateTime || newEvent.start?.date || null,
          gcal_end: newEvent.end?.dateTime || newEvent.end?.date || null,
          gcal_all_day: !newEvent.start?.dateTime ? 1 : 0,
          status: 'active',
          synced_at: db.fn.now(),
          created_at: db.fn.now()
        });
        continue;
      }

      // Check if event is in the past
      var evStartStr = newEvent.start?.dateTime || newEvent.start?.date;
      var isPast = false;
      if (evStartStr) {
        var evDate = new Date(evStartStr);
        isPast = evDate < todayStart;
      }

      if (isPast) {
        await db('gcal_sync_ledger').insert({
          user_id: userId,
          task_id: null,
          gcal_event_id: evId,
          origin: 'gcal',
          last_pushed_hash: null,
          last_pulled_hash: eventHash(newEvent),
          gcal_summary: newEvent.summary || '(No title)',
          gcal_start: newEvent.start?.dateTime || newEvent.start?.date || null,
          gcal_end: newEvent.end?.dateTime || newEvent.end?.date || null,
          gcal_all_day: !newEvent.start?.dateTime ? 1 : 0,
          status: 'active',
          synced_at: db.fn.now(),
          created_at: db.fn.now()
        });
        continue;
      }

      // Future event — create task
      try {
        var evStartStr2 = newEvent.start?.dateTime || newEvent.start?.date;
        var evEndStr = newEvent.end?.dateTime || newEvent.end?.date;
        var evIsAllDay = !newEvent.start?.dateTime;
        var jd = isoToJugglerDate(evStartStr2, tz);
        var evDur = evIsAllDay ? 0 : 30;
        if (!evIsAllDay && evStartStr2 && evEndStr) {
          evDur = computeDurationMinutes(evStartStr2, evEndStr);
        }

        // Skip if a task with same text and date already exists
        var dupTask = allTasks.find(function(t) {
          return t.text === (newEvent.summary || '') && t.date === jd.date;
        });
        if (dupTask) {
          await db('gcal_sync_ledger').insert({
            user_id: userId,
            task_id: dupTask.id,
            gcal_event_id: newEvent.id,
            origin: 'gcal',
            last_pushed_hash: taskHash(dupTask),
            last_pulled_hash: eventHash(newEvent),
            gcal_summary: newEvent.summary || '(No title)',
            gcal_start: newEvent.start?.dateTime || newEvent.start?.date || null,
            gcal_end: newEvent.end?.dateTime || newEvent.end?.date || null,
            gcal_all_day: evIsAllDay ? 1 : 0,
            status: 'active',
            synced_at: db.fn.now(),
            created_at: db.fn.now()
          });
          continue;
        }

        var newTaskId = 'gcal_' + crypto.randomBytes(8).toString('hex');

        // Compute scheduled_at
        var newScheduledAt = null;
        if (jd.date) {
          if (evIsAllDay) {
            newScheduledAt = localToUtc(jd.date, '12:00 AM', tz);
          } else if (jd.time) {
            newScheduledAt = localToUtc(jd.date, jd.time, tz);
          }
        }

        var taskRow = {
          id: newTaskId,
          user_id: userId,
          text: newEvent.summary || '(No title)',
          scheduled_at: newScheduledAt,
          dur: evDur,
          pri: 'P3',
          rigid: 1,
          status: '',
          when: evIsAllDay ? 'allday' : 'fixed',
          gcal_event_id: newEvent.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        };
        if (newEvent.description) {
          taskRow.notes = newEvent.description;
        }

        // Build a task object for hashing
        var newTaskObj = rowToTask(taskRow, tz);

        await db.transaction(async function(trx) {
          await trx('tasks').insert(taskRow);

          await trx('gcal_sync_ledger').insert({
            user_id: userId,
            task_id: newTaskId,
            gcal_event_id: newEvent.id,
            origin: 'gcal',
            last_pushed_hash: taskHash(newTaskObj),
            last_pulled_hash: eventHash(newEvent),
            gcal_summary: newEvent.summary || '(No title)',
            gcal_start: newEvent.start?.dateTime || newEvent.start?.date || null,
            gcal_end: newEvent.end?.dateTime || newEvent.end?.date || null,
            gcal_all_day: evIsAllDay ? 1 : 0,
            status: 'active',
            synced_at: db.fn.now(),
            created_at: db.fn.now()
          });
        });

        stats.pulled++;
      } catch (e) {
        stats.errors.push({ phase: 'pull_new', eventId: evId, error: e.message });
      }
    }

    // === Phase 4: Update timestamp ===
    await db('users').where('id', userId).update({
      gcal_last_synced_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    res.json(stats);
  } catch (error) {
    if (error.message === 'Google Calendar not connected') {
      return res.status(400).json({ error: error.message });
    }
    console.error('GCal sync error:', error);
    res.status(500).json({ error: 'Failed to sync with GCal' });
  }
}

async function setAutoSync(req, res) {
  try {
    var enabled = req.body.enabled;
    var userId = req.user.id;
    var value = !!enabled;

    var existing = await db('user_config')
      .where({ user_id: userId, config_key: 'gcal_auto_sync' })
      .first();

    if (existing) {
      await db('user_config')
        .where({ user_id: userId, config_key: 'gcal_auto_sync' })
        .update({ config_value: JSON.stringify(value), updated_at: db.fn.now() });
    } else {
      await db('user_config').insert({
        user_id: userId,
        config_key: 'gcal_auto_sync',
        config_value: JSON.stringify(value)
      });
    }

    res.json({ autoSync: value });
  } catch (error) {
    console.error('GCal auto-sync error:', error);
    res.status(500).json({ error: 'Failed to update auto-sync setting' });
  }
}

module.exports = {
  getStatus,
  connect,
  callback,
  disconnect,
  push,
  pull,
  sync,
  setAutoSync,
  jugglerDateToISO,
  isoToJugglerDate,
  taskHash,
  eventHash
};
