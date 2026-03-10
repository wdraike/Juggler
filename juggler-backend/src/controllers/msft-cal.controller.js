/**
 * Microsoft Calendar Controller — OAuth flow + ledger-based bidirectional sync
 *
 * Mirrors gcal.controller.js but uses Microsoft Graph API.
 * Tasks are stored with scheduled_at (UTC DATETIME) as the single source of truth.
 */

var crypto = require('crypto');
var jwt = require('jsonwebtoken');
var db = require('../db');
var msftCalApi = require('../lib/msft-cal-api');
var { runScheduleAndPersist } = require('../scheduler/runSchedule');
var { rowToTask } = require('./task.controller');
var { localToUtc } = require('../scheduler/dateHelpers');
var { jugglerDateToISO, isoToJugglerDate, taskHash } = require('./gcal.controller');

var DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Convert IANA timezone to Windows timezone name for Microsoft Graph API.
 * Graph requires Windows-style names (e.g. "Eastern Standard Time") not IANA ("America/New_York").
 */
var IANA_TO_WINDOWS = {
  'America/New_York': 'Eastern Standard Time',
  'America/Chicago': 'Central Standard Time',
  'America/Denver': 'Mountain Standard Time',
  'America/Los_Angeles': 'Pacific Standard Time',
  'America/Anchorage': 'Alaskan Standard Time',
  'Pacific/Honolulu': 'Hawaiian Standard Time',
  'America/Phoenix': 'US Mountain Standard Time',
  'America/Indiana/Indianapolis': 'US Eastern Standard Time',
  'America/Toronto': 'Eastern Standard Time',
  'America/Vancouver': 'Pacific Standard Time',
  'America/Winnipeg': 'Central Standard Time',
  'America/Edmonton': 'Mountain Standard Time',
  'America/Halifax': 'Atlantic Standard Time',
  'America/St_Johns': 'Newfoundland Standard Time',
  'Europe/London': 'GMT Standard Time',
  'Europe/Paris': 'Romance Standard Time',
  'Europe/Berlin': 'W. Europe Standard Time',
  'Europe/Amsterdam': 'W. Europe Standard Time',
  'Europe/Brussels': 'Romance Standard Time',
  'Europe/Rome': 'W. Europe Standard Time',
  'Europe/Madrid': 'Romance Standard Time',
  'Europe/Zurich': 'W. Europe Standard Time',
  'Europe/Vienna': 'W. Europe Standard Time',
  'Europe/Stockholm': 'W. Europe Standard Time',
  'Europe/Oslo': 'W. Europe Standard Time',
  'Europe/Copenhagen': 'Romance Standard Time',
  'Europe/Helsinki': 'FLE Standard Time',
  'Europe/Warsaw': 'Central European Standard Time',
  'Europe/Prague': 'Central Europe Standard Time',
  'Europe/Budapest': 'Central Europe Standard Time',
  'Europe/Bucharest': 'GTB Standard Time',
  'Europe/Athens': 'GTB Standard Time',
  'Europe/Istanbul': 'Turkey Standard Time',
  'Europe/Moscow': 'Russian Standard Time',
  'Asia/Jerusalem': 'Israel Standard Time',
  'Asia/Dubai': 'Arabian Standard Time',
  'Asia/Kolkata': 'India Standard Time',
  'Asia/Shanghai': 'China Standard Time',
  'Asia/Tokyo': 'Tokyo Standard Time',
  'Asia/Seoul': 'Korea Standard Time',
  'Asia/Singapore': 'Singapore Standard Time',
  'Asia/Hong_Kong': 'China Standard Time',
  'Australia/Sydney': 'AUS Eastern Standard Time',
  'Australia/Melbourne': 'AUS Eastern Standard Time',
  'Australia/Perth': 'W. Australia Standard Time',
  'Australia/Brisbane': 'E. Australia Standard Time',
  'Pacific/Auckland': 'New Zealand Standard Time',
  'UTC': 'UTC'
};

function ianaToWindows(iana) {
  return IANA_TO_WINDOWS[iana] || iana;
}

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

/**
 * Hash Microsoft Graph event fields for change detection.
 */
function msftEventHash(event) {
  var startStr = event.start?.dateTime || '';
  var endStr = event.end?.dateTime || '';
  var str = [
    event.subject || '',
    startStr,
    endStr,
    (event.body?.content) || ''
  ].join('|');
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Compute duration in minutes between two ISO datetime strings
 */
function computeDurationMinutes(start, end) {
  var s = new Date(start);
  var e = new Date(end);
  var diff = Math.round((e - s) / 60000);
  return diff > 0 ? diff : 30;
}

// --- Token management ---

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET required in production');
  return 'local-dev-jwt-secret-juggler';
}

async function getValidAccessToken(user) {
  if (!user.msft_cal_refresh_token) {
    throw new Error('Microsoft Calendar not connected');
  }

  if (user.msft_cal_access_token && user.msft_cal_token_expiry) {
    var expiryStr = String(user.msft_cal_token_expiry);
    var expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
    if (expiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return user.msft_cal_access_token;
    }
  }

  var credentials = await msftCalApi.refreshAccessToken(user.msft_cal_refresh_token);

  var update = {
    msft_cal_access_token: credentials.accessToken,
    updated_at: db.fn.now()
  };
  if (credentials.expiresOn) {
    update.msft_cal_token_expiry = new Date(credentials.expiresOn);
  }
  if (credentials.refreshToken) {
    update.msft_cal_refresh_token = credentials.refreshToken;
  }

  await db('users').where('id', user.id).update(update);

  return credentials.accessToken;
}

// --- Build Microsoft Graph event body from a task object ---

function buildMsftEventBody(task, year, timezone) {
  var tz = timezone || DEFAULT_TIMEZONE;
  var dur = task.dur || 30;
  // Detect all-day: explicit allday, no time, or midnight-scheduled non-fixed tasks
  var isMidnight = task.time === '12:00 AM' && task.when !== 'fixed';
  var isAllDay = task.when === 'allday' || !task.time || isMidnight;

  var descParts = [];
  if (task.project) descParts.push('Project: ' + task.project);
  if (task.pri) descParts.push('Priority: ' + task.pri);
  if (task.notes) descParts.push('Notes: ' + task.notes);
  descParts.push('', 'Synced from Juggler');

  if (isAllDay) {
    var dateParts = (task.date || '').split('/');
    var month = parseInt(dateParts[0], 10);
    var day = parseInt(dateParts[1], 10);
    var y = year || new Date().getFullYear();
    var startDate = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var endObj = new Date(y, month - 1, day + 1);
    var endDate = endObj.getFullYear() + '-' + String(endObj.getMonth() + 1).padStart(2, '0') + '-' + String(endObj.getDate()).padStart(2, '0');

    return {
      subject: task.text,
      body: { contentType: 'text', content: descParts.join('\n') },
      start: { dateTime: startDate + 'T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: endDate + 'T00:00:00.0000000', timeZone: 'UTC' },
      isAllDay: true
    };
  }

  // Timed event — convert local date+time to UTC for Graph API
  var scheduledAt = task.scheduledAt || task._scheduledAtISO;
  if (scheduledAt) {
    // Use the UTC scheduled_at directly
    var startUtc = new Date(scheduledAt);
    var endUtc = new Date(startUtc.getTime() + dur * 60000);

    return {
      subject: task.text,
      body: { contentType: 'text', content: descParts.join('\n') },
      start: { dateTime: startUtc.toISOString().replace('Z', ''), timeZone: 'UTC' },
      end: { dateTime: endUtc.toISOString().replace('Z', ''), timeZone: 'UTC' }
    };
  }

  // Fallback: use local date/time with Windows timezone
  var startISO = jugglerDateToISO(task.date, task.time, year);
  var sParts = startISO.split('T');
  var tParts = sParts[1].split(':');
  var sMins = parseInt(tParts[0], 10) * 60 + parseInt(tParts[1], 10);
  var eMins = sMins + dur;
  var eH = Math.floor(eMins / 60);
  var eM = eMins % 60;
  var endISO = sParts[0] + 'T' + String(eH).padStart(2, '0') + ':' + String(eM).padStart(2, '0') + ':00';

  return {
    subject: task.text,
    body: { contentType: 'text', content: descParts.join('\n') },
    start: { dateTime: startISO, timeZone: ianaToWindows(tz) },
    end: { dateTime: endISO, timeZone: ianaToWindows(tz) }
  };
}

// --- Apply Microsoft Graph event data to DB update fields ---

function applyMsftEventToTask(event, timezone) {
  var tz = timezone || DEFAULT_TIMEZONE;
  var isAllDay = !!event.isAllDay;
  var startStr = event.start?.dateTime;
  var endStr = event.end?.dateTime;

  // For all-day events, Graph sends datetime with T00:00:00 + timeZone UTC
  // Convert to a date-only string for isoToJugglerDate
  var jd;
  if (isAllDay && startStr) {
    // Extract YYYY-MM-DD from the datetime
    var dateOnly = startStr.split('T')[0];
    jd = isoToJugglerDate(dateOnly, tz);
  } else {
    // For timed events, Graph sends local datetime + timeZone
    // We need to convert to an absolute time. If timeZone matches user tz, parse directly.
    var eventTz = event.start?.timeZone || tz;
    if (startStr && !startStr.endsWith('Z') && eventTz) {
      // Build a date in the event's timezone context
      jd = isoToJugglerDate(startStr, eventTz);
    } else {
      jd = isoToJugglerDate(startStr, tz);
    }
  }

  var eventDur = isAllDay ? 0 : 30;
  if (!isAllDay && startStr && endStr) {
    eventDur = computeDurationMinutes(startStr, endStr);
  }

  var fields = {
    text: event.subject || '(No title)',
    dur: eventDur,
    updated_at: db.fn.now()
  };

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

// Guard against duplicate callback hits (browser retries)
var usedCodes = new Set();
function markCodeUsed(code) {
  var key = code.substring(0, 40);
  if (usedCodes.has(key)) return false;
  usedCodes.add(key);
  setTimeout(function() { usedCodes.delete(key); }, 120000);
  return true;
}

// --- Endpoints ---

async function getStatus(req, res) {
  try {
    var connected = !!req.user.msft_cal_refresh_token;
    var lastSyncedAt = req.user.msft_cal_last_synced_at || null;

    var autoSyncRow = await db('user_config')
      .where({ user_id: req.user.id, config_key: 'msft_cal_auto_sync' })
      .first();
    var autoSync = false;
    if (autoSyncRow) {
      var val = typeof autoSyncRow.config_value === 'string'
        ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value;
      autoSync = !!val;
    }

    res.json({ connected: connected, email: req.user.email, lastSyncedAt: lastSyncedAt, autoSync: autoSync });
  } catch (error) {
    console.error('MsftCal status error:', error);
    res.status(500).json({ error: 'Failed to check Microsoft Calendar status' });
  }
}

async function connect(req, res) {
  try {
    var pkce = msftCalApi.generatePkce();
    var state = jwt.sign({ userId: req.user.id, cv: pkce.codeVerifier }, getJwtSecret(), { expiresIn: '10m' });
    var authUrl = msftCalApi.getAuthUrl(state, pkce.codeChallenge);
    res.json({ authUrl: authUrl });
  } catch (error) {
    console.error('MsftCal connect error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

async function callback(req, res) {
  try {
    console.log('MsftCal callback hit at', new Date().toISOString());
    console.log('  code:', req.query.code ? req.query.code.substring(0, 30) + '... (len=' + req.query.code.length + ')' : 'NONE');
    console.log('  state:', req.query.state ? 'present' : 'NONE');
    console.log('  full URL:', req.originalUrl.substring(0, 100));
    var code = req.query.code;
    var state = req.query.state;

    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }

    if (!markCodeUsed(code)) {
      console.log('[MSFT CALLBACK] Duplicate code detected, redirecting without re-exchange');
      var frontUrl = (process.env.FRONTEND_URL || 'http://localhost:3001').split(',')[0].trim();
      return res.redirect(frontUrl + '/?msftcal=connected');
    }

    var decoded;
    try {
      decoded = jwt.verify(state, getJwtSecret());
    } catch (e) {
      return res.status(400).send('Invalid or expired state parameter');
    }

    var userId = decoded.userId;
    var codeVerifier = decoded.cv;
    if (!codeVerifier) {
      return res.status(400).send('Missing PKCE code_verifier in state');
    }
    var tokens = await msftCalApi.getTokensFromCode(code, codeVerifier);

    var update = {
      msft_cal_access_token: tokens.accessToken,
      updated_at: db.fn.now()
    };
    if (tokens.refreshToken) {
      update.msft_cal_refresh_token = tokens.refreshToken;
    }
    if (tokens.expiresOn) {
      update.msft_cal_token_expiry = new Date(tokens.expiresOn);
    }

    await db('users').where('id', userId).update(update);

    var frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3001').split(',')[0].trim();
    res.redirect(frontendUrl + '/?msftcal=connected');
  } catch (error) {
    console.error('MsftCal callback error:', error.message || error);
    res.status(500).send('Failed to complete Microsoft Calendar authorization: ' + (error.message || 'unknown error'));
  }
}

async function disconnect(req, res) {
  try {
    await db('users').where('id', req.user.id).update({
      msft_cal_access_token: null,
      msft_cal_refresh_token: null,
      msft_cal_token_expiry: null,
      updated_at: db.fn.now()
    });
    res.json({ disconnected: true });
  } catch (error) {
    console.error('MsftCal disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Microsoft Calendar' });
  }
}

/**
 * POST /api/msft-cal/push — push done tasks as Microsoft Calendar events
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

    var fromUTC = new Date(from + 'T00:00:00Z');
    var toUTC = new Date(to + 'T23:59:59Z');

    var taskRows = await db('tasks')
      .where('user_id', userId)
      .where('status', 'done')
      .whereNull('msft_event_id')
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
        var eventBody = buildMsftEventBody(task, year, tz);
        var created = await msftCalApi.insertEvent(accessToken, eventBody);

        await db.transaction(async function(trx) {
          await trx('tasks').where('id', task.id).update({
            msft_event_id: created.id,
            updated_at: db.fn.now()
          });

          await trx('msft_cal_sync_ledger').insert({
            user_id: userId,
            task_id: task.id,
            msft_event_id: created.id,
            origin: 'juggler',
            last_pushed_hash: taskHash(task),
            last_pulled_hash: msftEventHash(created),
            msft_summary: task.text,
            msft_start: created.start?.dateTime || null,
            msft_end: created.end?.dateTime || null,
            msft_all_day: created.isAllDay ? 1 : 0,
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
    if (error.message === 'Microsoft Calendar not connected') {
      return res.status(400).json({ error: error.message });
    }
    console.error('MsftCal push error:', error);
    res.status(500).json({ error: 'Failed to push tasks to Microsoft Calendar' });
  }
}

/**
 * POST /api/msft-cal/pull — pull Microsoft Calendar events as Juggler tasks
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

    var result = await msftCalApi.listEvents(accessToken, timeMin, timeMax);
    var events = (result && result.items) || [];

    var existingLedger = await db('msft_cal_sync_ledger')
      .where('user_id', userId)
      .whereNotNull('msft_event_id')
      .pluck('msft_event_id');
    var ledgerSet = new Set(existingLedger);

    var existingTaskIds = await db('tasks')
      .where('user_id', userId)
      .whereNotNull('msft_event_id')
      .pluck('msft_event_id');
    var taskSet = new Set(existingTaskIds);

    var pulled = 0;
    var skipped = 0;

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (ledgerSet.has(event.id) || taskSet.has(event.id)) {
        skipped++;
        continue;
      }

      var isAllDay = !!event.isAllDay;
      var startStr = event.start?.dateTime;
      var endStr = event.end?.dateTime;

      var jugglerDate;
      if (isAllDay && startStr) {
        jugglerDate = isoToJugglerDate(startStr.split('T')[0], tz);
      } else {
        jugglerDate = isoToJugglerDate(startStr, event.start?.timeZone || tz);
      }

      var dur = isAllDay ? 0 : 30;
      if (!isAllDay && startStr && endStr) {
        dur = computeDurationMinutes(startStr, endStr);
      }

      var taskId = 'msft_' + crypto.randomBytes(8).toString('hex');

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
        text: event.subject || '(No title)',
        scheduled_at: scheduledAt,
        dur: dur,
        pri: 'P3',
        status: '',
        when: isAllDay ? 'allday' : 'fixed',
        rigid: 1,
        msft_event_id: event.id,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      };

      if (event.body?.content) {
        row.notes = event.body.content;
      }

      await db.transaction(async function(trx) {
        await trx('tasks').insert(row);

        await trx('msft_cal_sync_ledger').insert({
          user_id: userId,
          task_id: taskId,
          msft_event_id: event.id,
          origin: 'msft',
          last_pushed_hash: null,
          last_pulled_hash: msftEventHash(event),
          msft_summary: event.subject || '(No title)',
          msft_start: startStr || null,
          msft_end: endStr || null,
          msft_all_day: isAllDay ? 1 : 0,
          status: 'active',
          synced_at: db.fn.now(),
          created_at: db.fn.now()
        });
      });

      pulled++;
    }

    res.json({ pulled: pulled, skipped: skipped, total: events.length });
  } catch (error) {
    if (error.message === 'Microsoft Calendar not connected') {
      return res.status(400).json({ error: error.message });
    }
    console.error('MsftCal pull error:', error);
    res.status(500).json({ error: 'Failed to pull events from Microsoft Calendar' });
  }
}

/**
 * POST /api/msft-cal/sync — ledger-based bidirectional sync
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
      console.error('MsftCal sync Phase 0 (scheduler) error:', schedErr);
      stats.errors.push({ phase: 'scheduler', error: schedErr.message });
    }

    // === Phase 1: Build state maps ===

    var ledgerRecords = await db('msft_cal_sync_ledger')
      .where('user_id', userId)
      .where('status', 'active')
      .select();

    var timeMin = windowStart.toISOString();
    var timeMax = windowEnd.toISOString();
    var result = await msftCalApi.listEvents(accessToken, timeMin, timeMax);
    var msftEvents = (result && result.items) || [];

    var allTaskRows = await db('tasks')
      .where('user_id', userId)
      .whereNotNull('scheduled_at')
      .select();

    var allTasks = allTaskRows.map(function(r) {
      var t = rowToTask(r, tz);
      t._habit = r.habit;
      t._generated = r.generated;
      t._scheduled_at = r.scheduled_at;
      return t;
    });

    var ledgerByTaskId = {};
    var ledgerByMsftId = {};
    for (var lr of ledgerRecords) {
      if (lr.task_id) ledgerByTaskId[lr.task_id] = lr;
      if (lr.msft_event_id) ledgerByMsftId[lr.msft_event_id] = lr;
    }

    var msftEventsById = {};
    for (var ev of msftEvents) {
      msftEventsById[ev.id] = ev;
    }

    var tasksById = {};
    for (var ti = 0; ti < allTasks.length; ti++) {
      tasksById[allTasks[ti].id] = allTasks[ti];
    }

    var processedTaskIds = new Set();
    var processedMsftIds = new Set();

    // === Phase 2: Process existing ledger records ===

    for (var li = 0; li < ledgerRecords.length; li++) {
      var ledger = ledgerRecords[li];
      var task = ledger.task_id ? tasksById[ledger.task_id] : null;
      var event = ledger.msft_event_id ? msftEventsById[ledger.msft_event_id] : null;

      if (ledger.task_id) processedTaskIds.add(ledger.task_id);
      if (ledger.msft_event_id) processedMsftIds.add(ledger.msft_event_id);

      try {
        // Habit/generated tasks should NOT be on calendar
        if (task && (task._habit || task._generated) && event) {
          try {
            await msftCalApi.deleteEvent(accessToken, ledger.msft_event_id);
            await delay(100);
          } catch (e2) {
            if (!e2.message.includes('404') && !e2.message.includes('410')) throw e2;
          }
          await db.transaction(async function(trx) {
            await trx('tasks').where('id', task.id).update({
              msft_event_id: null, updated_at: db.fn.now()
            });
            await trx('msft_cal_sync_ledger').where('id', ledger.id).update({
              status: 'deleted_local', msft_event_id: null, synced_at: db.fn.now()
            });
          });
          stats.deleted_local++;
          continue;
        }
        if (task && (task._habit || task._generated) && !event) {
          await db.transaction(async function(trx) {
            await trx('tasks').where('id', task.id).update({
              msft_event_id: null, updated_at: db.fn.now()
            });
            await trx('msft_cal_sync_ledger').where('id', ledger.id).update({
              status: 'deleted_local', msft_event_id: null, synced_at: db.fn.now()
            });
          });
          continue;
        }

        // Past juggler-origin tasks that aren't done: remove from calendar
        if (task && event && ledger.origin === 'juggler' && task._scheduled_at) {
          var taskScheduledAt = task._scheduled_at instanceof Date ? task._scheduled_at : new Date(String(task._scheduled_at).replace(' ', 'T') + 'Z');
          var taskIsPast = taskScheduledAt < todayStart;
          var taskNotDone = task.status !== 'done' && task.status !== 'skip';
          if (taskIsPast && taskNotDone) {
            try {
              await msftCalApi.deleteEvent(accessToken, ledger.msft_event_id);
              await delay(100);
            } catch (e3) {
              if (!e3.message.includes('404') && !e3.message.includes('410')) throw e3;
            }
            await db.transaction(async function(trx) {
              await trx('tasks').where('id', task.id).update({ msft_event_id: null, updated_at: db.fn.now() });
              await trx('msft_cal_sync_ledger').where('id', ledger.id).update({
                status: 'deleted_local', msft_event_id: null, synced_at: db.fn.now()
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
          var currentEventHash = msftEventHash(event);
          var taskChanged = currentTaskHash !== ledger.last_pushed_hash;
          var eventChanged = currentEventHash !== ledger.last_pulled_hash;

          if (taskChanged && eventChanged) {
            if (ledger.origin === 'juggler' || isHabitSource) {
              var eventBody = buildMsftEventBody(task, year, tz);
              await msftCalApi.patchEvent(accessToken, ledger.msft_event_id, eventBody);
              await delay(100);
              stats.pushed++;
            } else {
              var updateFields = applyMsftEventToTask(event, tz);
              await db('tasks').where('id', task.id).update(updateFields);
              stats.pulled++;
            }
          } else if (taskChanged) {
            var eventBody2 = buildMsftEventBody(task, year, tz);
            await msftCalApi.patchEvent(accessToken, ledger.msft_event_id, eventBody2);
            await delay(100);
            stats.pushed++;
          } else if (eventChanged) {
            if (!isHabitSource) {
              var updateFields2 = applyMsftEventToTask(event, tz);
              await db('tasks').where('id', task.id).update(updateFields2);
              stats.pulled++;
            }
          }

          var startStr = event.start?.dateTime || null;
          var endStr = event.end?.dateTime || null;
          await db('msft_cal_sync_ledger').where('id', ledger.id).update({
            last_pushed_hash: taskChanged ? taskHash(task) : (ledger.last_pushed_hash || taskHash(task)),
            last_pulled_hash: msftEventHash(event),
            msft_summary: event.subject || task.text,
            msft_start: startStr,
            msft_end: endStr,
            msft_all_day: event.isAllDay ? 1 : 0,
            synced_at: db.fn.now()
          });

        } else if (task && !event) {
          if (ledger.msft_event_id) {
            var cachedStart = ledger.msft_start;
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
                await trx('msft_cal_sync_ledger').where('id', ledger.id).update({
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
            await msftCalApi.deleteEvent(accessToken, ledger.msft_event_id);
            await delay(100);
          } catch (e) {
            if (!e.message.includes('404') && !e.message.includes('410')) {
              throw e;
            }
          }
          await db('msft_cal_sync_ledger').where('id', ledger.id).update({
            status: 'deleted_local',
            msft_event_id: null,
            synced_at: db.fn.now()
          });
          stats.deleted_local++;

        } else {
          await db('msft_cal_sync_ledger').where('id', ledger.id).update({
            status: 'deleted_local',
            synced_at: db.fn.now()
          });
        }

      } catch (e) {
        stats.errors.push({
          phase: 'ledger',
          ledgerId: ledger.id,
          taskId: ledger.task_id,
          msftEventId: ledger.msft_event_id,
          error: e.message
        });
      }
    }

    // === Phase 3: Handle new items (no ledger record) ===

    // 3a: Tasks with scheduled_at and no ledger record -> push to Microsoft Calendar
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
        var newEventBody = buildMsftEventBody(newTask, year, tz);
        var created = await msftCalApi.insertEvent(accessToken, newEventBody);
        await delay(100);

        var createdStart = created.start?.dateTime || null;
        var createdEnd = created.end?.dateTime || null;

        await db.transaction(async function(trx) {
          await trx('tasks').where('id', newTask.id).update({
            msft_event_id: created.id,
            updated_at: db.fn.now()
          });

          await trx('msft_cal_sync_ledger').insert({
            user_id: userId,
            task_id: newTask.id,
            msft_event_id: created.id,
            origin: 'juggler',
            last_pushed_hash: taskHash(newTask),
            last_pulled_hash: msftEventHash(created),
            msft_summary: newTask.text,
            msft_start: createdStart,
            msft_end: createdEnd,
            msft_all_day: created.isAllDay ? 1 : 0,
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

    // 3b: Microsoft Calendar events not in any ledger record -> create task
    var msftEventIds = Object.keys(msftEventsById);
    for (var ei = 0; ei < msftEventIds.length; ei++) {
      var evId = msftEventIds[ei];
      if (processedMsftIds.has(evId)) continue;
      var newEvent = msftEventsById[evId];

      // Check if already linked to a task (pre-ledger)
      var existingTask = allTasks.find(function(t) { return t.msftEventId === evId; });
      if (existingTask) {
        var origin = existingTask.id.startsWith('msft_') ? 'msft' : 'juggler';
        await db('msft_cal_sync_ledger').insert({
          user_id: userId,
          task_id: existingTask.id,
          msft_event_id: evId,
          origin: origin,
          last_pushed_hash: taskHash(existingTask),
          last_pulled_hash: msftEventHash(newEvent),
          msft_summary: newEvent.subject || existingTask.text,
          msft_start: newEvent.start?.dateTime || null,
          msft_end: newEvent.end?.dateTime || null,
          msft_all_day: newEvent.isAllDay ? 1 : 0,
          status: 'active',
          synced_at: db.fn.now(),
          created_at: db.fn.now()
        });
        continue;
      }

      // Check if event is in the past
      var evStartStr = newEvent.start?.dateTime;
      var isPast = false;
      if (evStartStr) {
        var evDate = new Date(evStartStr);
        isPast = evDate < todayStart;
      }

      if (isPast) {
        await db('msft_cal_sync_ledger').insert({
          user_id: userId,
          task_id: null,
          msft_event_id: evId,
          origin: 'msft',
          last_pushed_hash: null,
          last_pulled_hash: msftEventHash(newEvent),
          msft_summary: newEvent.subject || '(No title)',
          msft_start: newEvent.start?.dateTime || null,
          msft_end: newEvent.end?.dateTime || null,
          msft_all_day: newEvent.isAllDay ? 1 : 0,
          status: 'active',
          synced_at: db.fn.now(),
          created_at: db.fn.now()
        });
        continue;
      }

      // Future event — create task
      try {
        var evIsAllDay = !!newEvent.isAllDay;
        var evStartStr2 = newEvent.start?.dateTime;
        var evEndStr = newEvent.end?.dateTime;

        var jd;
        if (evIsAllDay && evStartStr2) {
          jd = isoToJugglerDate(evStartStr2.split('T')[0], tz);
        } else {
          jd = isoToJugglerDate(evStartStr2, newEvent.start?.timeZone || tz);
        }

        var evDur = evIsAllDay ? 0 : 30;
        if (!evIsAllDay && evStartStr2 && evEndStr) {
          evDur = computeDurationMinutes(evStartStr2, evEndStr);
        }

        // Skip if a task with same text and date already exists
        var dupTask = allTasks.find(function(t) {
          return t.text === (newEvent.subject || '') && t.date === jd.date;
        });
        if (dupTask) {
          await db('msft_cal_sync_ledger').insert({
            user_id: userId,
            task_id: dupTask.id,
            msft_event_id: newEvent.id,
            origin: 'msft',
            last_pushed_hash: taskHash(dupTask),
            last_pulled_hash: msftEventHash(newEvent),
            msft_summary: newEvent.subject || '(No title)',
            msft_start: newEvent.start?.dateTime || null,
            msft_end: newEvent.end?.dateTime || null,
            msft_all_day: evIsAllDay ? 1 : 0,
            status: 'active',
            synced_at: db.fn.now(),
            created_at: db.fn.now()
          });
          continue;
        }

        var newTaskId = 'msft_' + crypto.randomBytes(8).toString('hex');

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
          text: newEvent.subject || '(No title)',
          scheduled_at: newScheduledAt,
          dur: evDur,
          pri: 'P3',
          rigid: 1,
          status: '',
          when: evIsAllDay ? 'allday' : 'fixed',
          msft_event_id: newEvent.id,
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        };
        if (newEvent.body?.content) {
          taskRow.notes = newEvent.body.content;
        }

        var newTaskObj = rowToTask(taskRow, tz);

        await db.transaction(async function(trx) {
          await trx('tasks').insert(taskRow);

          await trx('msft_cal_sync_ledger').insert({
            user_id: userId,
            task_id: newTaskId,
            msft_event_id: newEvent.id,
            origin: 'msft',
            last_pushed_hash: taskHash(newTaskObj),
            last_pulled_hash: msftEventHash(newEvent),
            msft_summary: newEvent.subject || '(No title)',
            msft_start: newEvent.start?.dateTime || null,
            msft_end: newEvent.end?.dateTime || null,
            msft_all_day: evIsAllDay ? 1 : 0,
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
      msft_cal_last_synced_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    res.json(stats);
  } catch (error) {
    if (error.message === 'Microsoft Calendar not connected') {
      return res.status(400).json({ error: error.message });
    }
    console.error('MsftCal sync error:', error);
    res.status(500).json({ error: 'Failed to sync with Microsoft Calendar' });
  }
}

async function setAutoSync(req, res) {
  try {
    var enabled = req.body.enabled;
    var userId = req.user.id;
    var value = !!enabled;

    var existing = await db('user_config')
      .where({ user_id: userId, config_key: 'msft_cal_auto_sync' })
      .first();

    if (existing) {
      await db('user_config')
        .where({ user_id: userId, config_key: 'msft_cal_auto_sync' })
        .update({ config_value: JSON.stringify(value), updated_at: db.fn.now() });
    } else {
      await db('user_config').insert({
        user_id: userId,
        config_key: 'msft_cal_auto_sync',
        config_value: JSON.stringify(value)
      });
    }

    res.json({ autoSync: value });
  } catch (error) {
    console.error('MsftCal auto-sync error:', error);
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
  setAutoSync
};
