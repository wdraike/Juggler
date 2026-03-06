/**
 * Google Calendar Controller — OAuth flow + ledger-based bidirectional sync
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const gcalApi = require('../lib/gcal-api');
const { runScheduleAndPersist } = require('../scheduler/runSchedule');

const TIMEZONE = 'America/New_York';

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// --- Date conversion helpers ---

/**
 * Convert Juggler date "M/D" + time "H:MM AM/PM" → ISO datetime string
 * If no time provided, defaults to 9:00 AM
 */
function jugglerDateToISO(date, time, year) {
  if (!date) return null;
  var parts = date.split('/');
  var month = parseInt(parts[0], 10);
  var day = parseInt(parts[1], 10);
  var y = year || new Date().getFullYear();

  var hours = 9, minutes = 0;
  if (time) {
    var parsed = false;

    // Named times
    var namedTimes = {
      'morning': [9, 0], 'evening': [18, 0], 'afternoon': [13, 0],
      'night': [20, 0], 'noon': [12, 0], 'lunch': [12, 0]
    };
    var lower = time.trim().toLowerCase();
    if (namedTimes[lower]) {
      hours = namedTimes[lower][0];
      minutes = namedTimes[lower][1];
      parsed = true;
    }

    // Standard "H:MM AM/PM"
    if (!parsed) {
      var match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (match) {
        hours = parseInt(match[1], 10);
        minutes = parseInt(match[2], 10);
        var ampm = match[3].toUpperCase();
        if (ampm === 'PM' && hours !== 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        parsed = true;
      }
    }

    // Range with AM/PM: "H:MM-H:MM AM/PM" — use start time with the suffix
    if (!parsed) {
      var rangeMatch = time.match(/^(\d{1,2}):(\d{2})\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)$/i);
      if (rangeMatch) {
        hours = parseInt(rangeMatch[1], 10);
        minutes = parseInt(rangeMatch[2], 10);
        var ampm2 = rangeMatch[3].toUpperCase();
        if (ampm2 === 'PM' && hours !== 12) hours += 12;
        if (ampm2 === 'AM' && hours === 12) hours = 0;
        parsed = true;
      }
    }

    // Range without AM/PM: "H:MM-H:MM" — assume AM
    if (!parsed) {
      var bareRange = time.match(/^(\d{1,2}):(\d{2})\s*-\s*\d{1,2}:\d{2}$/);
      if (bareRange) {
        hours = parseInt(bareRange[1], 10);
        minutes = parseInt(bareRange[2], 10);
        parsed = true;
      }
    }
  }

  var dateStr = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') +
    'T' + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':00';
  return dateStr;
}

/**
 * Convert ISO datetime → { date: "M/D", time: "H:MM AM/PM" }
 */
function isoToJugglerDate(isoString) {
  if (!isoString) return { date: null, time: null };

  // Date-only strings (YYYY-MM-DD) from all-day events: parse directly to avoid UTC shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
    var parts = isoString.split('-');
    return {
      date: parseInt(parts[1], 10) + '/' + parseInt(parts[2], 10),
      time: null
    };
  }

  var d = new Date(isoString);
  try {
    var dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, month: 'numeric', day: 'numeric'
    }).formatToParts(d);
    var timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true
    }).formatToParts(d);

    var month = dateParts.find(p => p.type === 'month').value;
    var day = dateParts.find(p => p.type === 'day').value;
    var hour = timeParts.find(p => p.type === 'hour').value;
    var minute = timeParts.find(p => p.type === 'minute').value;
    var dayPeriod = timeParts.find(p => p.type === 'dayPeriod').value.toUpperCase();

    return {
      date: month + '/' + day,
      time: hour + ':' + minute + ' ' + dayPeriod
    };
  } catch (e) {
    var mo = d.getMonth() + 1;
    var da = d.getDate();
    var h = d.getHours();
    var mi = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return {
      date: mo + '/' + da,
      time: h + ':' + String(mi).padStart(2, '0') + ' ' + ap
    };
  }
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

// --- Hash helpers for change detection ---

/**
 * Hash the task fields we sync to GCal. If any of these change, we need to push.
 */
function taskHash(task) {
  var str = [
    task.text || '',
    task.date || '',
    task.time || '',
    String(task.dur || 0),
    task.status || '',
    task.when || '',
    task.project || ''
  ].join('|');
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Hash the GCal event fields we care about. If any of these change, we need to pull.
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
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET required in production');
  return 'local-dev-jwt-secret-juggler';
}

/**
 * Get a valid access token for a user, refreshing if expired
 */
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

// --- Build GCal event body from a task ---

function buildEventBody(task, year) {
  var startISO = jugglerDateToISO(task.date, task.time, year);
  var dur = task.dur || 30;
  var isAllDay = task.when === 'allday' || !task.time;

  if (isAllDay) {
    // All-day event: use date format
    var dateParts = (task.date || '').split('/');
    var month = parseInt(dateParts[0], 10);
    var day = parseInt(dateParts[1], 10);
    var y = year || new Date().getFullYear();
    var startDate = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    // All-day end is exclusive, so add one day
    var endObj = new Date(y, month - 1, day + 1);
    var endDate = endObj.getFullYear() + '-' + String(endObj.getMonth() + 1).padStart(2, '0') + '-' + String(endObj.getDate()).padStart(2, '0');

    var descParts = [];
    if (task.project) descParts.push('Project: ' + task.project);
    if (task.pri) descParts.push('Priority: ' + task.pri);
    if (task.notes) descParts.push('Notes: ' + task.notes);
    descParts.push('', 'Synced from Juggler');

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
  descParts2.push('', 'Synced from Juggler');

  return {
    summary: task.text,
    description: descParts2.join('\n'),
    start: { dateTime: startISO, timeZone: TIMEZONE },
    end: { dateTime: endISO, timeZone: TIMEZONE }
  };
}

// --- Apply GCal event data to a task row ---

function applyEventToTask(event) {
  var startStr = event.start?.dateTime || event.start?.date;
  var endStr = event.end?.dateTime || event.end?.date;
  var isAllDay = !event.start?.dateTime;
  var jd = isoToJugglerDate(startStr);
  var eventDur = isAllDay ? 0 : 30;
  if (!isAllDay && startStr && endStr) {
    eventDur = computeDurationMinutes(startStr, endStr);
  }

  var fields = {
    text: event.summary || '(No title)',
    date: jd.date,
    time: isAllDay ? null : jd.time,
    dur: eventDur,
    updated_at: db.fn.now()
  };
  if (isAllDay) {
    fields.when = 'allday';
  }
  return fields;
}

// --- Endpoints ---

/**
 * GET /api/gcal/status — check if user has GCal connected
 */
async function getStatus(req, res) {
  try {
    var connected = !!req.user.gcal_refresh_token;
    var lastSyncedAt = req.user.gcal_last_synced_at || null;

    var autoSyncRow = await db('user_config')
      .where({ user_id: req.user.id, config_key: 'gcal_auto_sync' })
      .first();
    var autoSync = false;
    if (autoSyncRow) {
      var val = typeof autoSyncRow.config_value === 'string'
        ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value;
      autoSync = !!val;
    }

    res.json({ connected, email: req.user.email, lastSyncedAt, autoSync });
  } catch (error) {
    console.error('GCal status error:', error);
    res.status(500).json({ error: 'Failed to check GCal status' });
  }
}

/**
 * GET /api/gcal/connect — start OAuth2 flow, return auth URL
 */
async function connect(req, res) {
  try {
    var oauth2Client = gcalApi.createOAuth2Client();
    var state = jwt.sign({ userId: req.user.id }, getJwtSecret(), { expiresIn: '10m' });
    var authUrl = gcalApi.getAuthUrl(oauth2Client, state);
    res.json({ authUrl });
  } catch (error) {
    console.error('GCal connect error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

/**
 * GET /api/gcal/callback — OAuth2 callback (no auth middleware — browser redirect)
 */
async function callback(req, res) {
  try {
    var { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }

    var decoded;
    try {
      decoded = jwt.verify(state, getJwtSecret());
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

    var frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    res.redirect(frontendUrl + '/?gcal=connected');
  } catch (error) {
    console.error('GCal callback error:', error);
    res.status(500).send('Failed to complete Google Calendar authorization');
  }
}

/**
 * POST /api/gcal/disconnect — clear GCal tokens
 */
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
 * POST /api/gcal/push — push tasks as GCal events (with ledger tracking)
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 */
async function push(req, res) {
  try {
    var { from, to } = req.body;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date range required' });
    }

    var accessToken = await getValidAccessToken(req.user);
    var userId = req.user.id;
    var year = new Date().getFullYear();

    var fromDate = new Date(from + 'T00:00:00');
    var toDate = new Date(to + 'T00:00:00');

    // Get done tasks in range that haven't been pushed yet
    var tasks = await db('tasks')
      .where('user_id', userId)
      .where('status', 'done')
      .whereNull('gcal_event_id')
      .select();

    var tasksInRange = tasks.filter(function(t) {
      if (!t.date) return false;
      var parts = t.date.split('/');
      var m = parseInt(parts[0], 10) - 1;
      var d = parseInt(parts[1], 10);
      var taskDate = new Date(year, m, d);
      return taskDate >= fromDate && taskDate <= toDate;
    });

    var pushed = 0;
    var errors = [];

    for (var task of tasksInRange) {
      try {
        var eventBody = buildEventBody(task, year);
        var created = await gcalApi.insertEvent(accessToken, eventBody);

        await db('tasks').where('id', task.id).update({
          gcal_event_id: created.id,
          updated_at: db.fn.now()
        });

        // Create ledger record
        await db('gcal_sync_ledger').insert({
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

        pushed++;
      } catch (e) {
        errors.push({ taskId: task.id, error: e.message });
      }
    }

    res.json({ pushed, errors, total: tasksInRange.length });
  } catch (error) {
    if (error.message === 'Google Calendar not connected') {
      return res.status(400).json({ error: error.message });
    }
    console.error('GCal push error:', error);
    res.status(500).json({ error: 'Failed to push tasks to GCal' });
  }
}

/**
 * POST /api/gcal/pull — pull GCal events as Juggler tasks (with ledger tracking)
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 */
async function pull(req, res) {
  try {
    var { from, to } = req.body;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date range required' });
    }

    var accessToken = await getValidAccessToken(req.user);
    var userId = req.user.id;

    var timeMin = from + 'T00:00:00Z';
    var timeMax = to + 'T23:59:59Z';

    var result = await gcalApi.listEvents(accessToken, timeMin, timeMax);
    var events = (result && result.items) || [];

    // Build set of gcal_event_ids already in ledger
    var existingLedger = await db('gcal_sync_ledger')
      .where('user_id', userId)
      .whereNotNull('gcal_event_id')
      .pluck('gcal_event_id');
    var ledgerSet = new Set(existingLedger);

    // Also check tasks directly for backwards compat
    var existingTaskIds = await db('tasks')
      .where('user_id', userId)
      .whereNotNull('gcal_event_id')
      .pluck('gcal_event_id');
    var taskSet = new Set(existingTaskIds);

    var pulled = 0;
    var skipped = 0;

    for (var event of events) {
      if (ledgerSet.has(event.id) || taskSet.has(event.id)) {
        skipped++;
        continue;
      }

      var startStr = event.start?.dateTime || event.start?.date;
      var endStr = event.end?.dateTime || event.end?.date;
      var isAllDay = !event.start?.dateTime;

      var jugglerDate = isoToJugglerDate(startStr);
      var dur = isAllDay ? 0 : 30;
      if (!isAllDay && startStr && endStr) {
        dur = computeDurationMinutes(startStr, endStr);
      }

      var taskId = 'gcal_' + crypto.randomBytes(8).toString('hex');

      var row = {
        id: taskId,
        user_id: userId,
        text: event.summary || '(No title)',
        date: jugglerDate.date,
        time: isAllDay ? null : jugglerDate.time,
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

      await db('tasks').insert(row);

      // Create ledger record
      await db('gcal_sync_ledger').insert({
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

      pulled++;
    }

    res.json({ pulled, skipped, total: events.length });
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
    var year = new Date().getFullYear();
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Wide sync window: 90 days back, 60 days forward
    var windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 90);
    var windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 60);

    var stats = { pushed: 0, pulled: 0, deleted_local: 0, deleted_remote: 0, errors: [] };

    // === Phase 0: Run scheduler to persist date moves ===
    try {
      var schedResult = await runScheduleAndPersist(userId);
      stats.scheduler = { moved: schedResult.moved, tasks: schedResult.tasks };
    } catch (schedErr) {
      console.error('GCal sync Phase 0 (scheduler) error:', schedErr);
      stats.errors.push({ phase: 'scheduler', error: schedErr.message });
    }

    // === Phase 1: Build state maps ===

    // Load all active ledger records for the user
    var ledgerRecords = await db('gcal_sync_ledger')
      .where('user_id', userId)
      .where('status', 'active')
      .select();

    // Fetch ALL GCal events in the wide window
    var timeMin = windowStart.toISOString();
    var timeMax = windowEnd.toISOString();
    var result = await gcalApi.listEvents(accessToken, timeMin, timeMax);
    var gcalEvents = (result && result.items) || [];

    // Load all user tasks that have a date
    var allTasks = await db('tasks')
      .where('user_id', userId)
      .whereNotNull('date')
      .select();

    // Build lookup maps
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
    for (var t of allTasks) {
      tasksById[t.id] = t;
    }

    // Track which tasks and events have been processed via ledger
    var processedTaskIds = new Set();
    var processedGcalIds = new Set();

    // === Phase 2: Process existing ledger records ===

    for (var ledger of ledgerRecords) {
      var task = ledger.task_id ? tasksById[ledger.task_id] : null;
      var event = ledger.gcal_event_id ? gcalEventsById[ledger.gcal_event_id] : null;

      if (ledger.task_id) processedTaskIds.add(ledger.task_id);
      if (ledger.gcal_event_id) processedGcalIds.add(ledger.gcal_event_id);

      try {
        // Habit/generated tasks should NOT be on GCal — remove them
        if (task && (task.habit || task.generated) && event) {
          try {
            await gcalApi.deleteEvent(accessToken, ledger.gcal_event_id);
            await delay(100);
          } catch (e2) {
            if (!e2.message.includes('404') && !e2.message.includes('410')) throw e2;
          }
          await db('tasks').where('id', task.id).update({
            gcal_event_id: null, updated_at: db.fn.now()
          });
          await db('gcal_sync_ledger').where('id', ledger.id).update({
            status: 'deleted_local', gcal_event_id: null, synced_at: db.fn.now()
          });
          stats.deleted_local++;
          continue;
        }
        if (task && (task.habit || task.generated) && !event) {
          // Habit task, event already gone — just clean up ledger
          await db('tasks').where('id', task.id).update({
            gcal_event_id: null, updated_at: db.fn.now()
          });
          await db('gcal_sync_ledger').where('id', ledger.id).update({
            status: 'deleted_local', gcal_event_id: null, synced_at: db.fn.now()
          });
          continue;
        }

        // Juggler-origin tasks whose date is today or past and not done/skip →
        // the scheduler will reschedule these to future dates, so remove from GCal
        if (task && event && ledger.origin === 'juggler') {
          var tDateParts = (task.date || '').split('/');
          if (/^\d{1,2}\/\d{1,2}$/.test(task.date || '')) {
            var tDateObj = new Date(year, parseInt(tDateParts[0], 10) - 1, parseInt(tDateParts[1], 10));
            var taskIsPast = tDateObj < todayStart;
            var taskNotDone = task.status !== 'done' && task.status !== 'skip';
            if (taskIsPast && taskNotDone) {
              try {
                await gcalApi.deleteEvent(accessToken, ledger.gcal_event_id);
                await delay(100);
              } catch (e3) {
                if (!e3.message.includes('404') && !e3.message.includes('410')) throw e3;
              }
              await db('tasks').where('id', task.id).update({ gcal_event_id: null, updated_at: db.fn.now() });
              await db('gcal_sync_ledger').where('id', ledger.id).update({
                status: 'deleted_local', gcal_event_id: null, synced_at: db.fn.now()
              });
              stats.deleted_local++;
              continue;
            }
          }
        }

        if (task && event) {
          // Both exist — compare hashes for changes
          var currentTaskHash = taskHash(task);
          var currentEventHash = eventHash(event);
          var taskChanged = currentTaskHash !== ledger.last_pushed_hash;
          var eventChanged = currentEventHash !== ledger.last_pulled_hash;

          if (taskChanged && eventChanged) {
            // Both changed — origin wins
            if (ledger.origin === 'juggler') {
              // Push task → GCal
              var eventBody = buildEventBody(task, year);
              await gcalApi.patchEvent(accessToken, ledger.gcal_event_id, eventBody);
              await delay(100);
              stats.pushed++;
            } else {
              // Pull GCal → task
              var updateFields = applyEventToTask(event);
              await db('tasks').where('id', task.id).update(updateFields);
              stats.pulled++;
            }
          } else if (taskChanged) {
            // Only task changed → push to GCal
            var eventBody2 = buildEventBody(task, year);
            await gcalApi.patchEvent(accessToken, ledger.gcal_event_id, eventBody2);
            await delay(100);
            stats.pushed++;
          } else if (eventChanged) {
            // Only event changed → pull to task
            var updateFields2 = applyEventToTask(event);
            await db('tasks').where('id', task.id).update(updateFields2);
            stats.pulled++;
          }
          // else: neither changed, nothing to do

          // Update ledger hashes and cached fields
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
          // Task exists but event gone from GCal
          // Only treat as "deleted remotely" if the event's cached date falls
          // within our fetch window. Events outside the window simply weren't
          // returned by the API — they weren't deleted.
          if (ledger.gcal_event_id) {
            var cachedStart = ledger.gcal_start;
            var eventInWindow = false;
            if (cachedStart) {
              var cachedDate = new Date(cachedStart);
              eventInWindow = cachedDate >= windowStart && cachedDate <= windowEnd;
            }
            if (eventInWindow) {
              await db('tasks').where('id', task.id).del();
              await db('gcal_sync_ledger').where('id', ledger.id).update({
                status: 'deleted_remote',
                task_id: null,
                synced_at: db.fn.now()
              });
              stats.deleted_remote++;
            }
          }

        } else if (!task && event) {
          // Task deleted from Juggler (task_id is null or task row gone) → delete GCal event
          try {
            await gcalApi.deleteEvent(accessToken, ledger.gcal_event_id);
            await delay(100);
          } catch (e) {
            // 404/410 = already gone
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
          // Both gone → clean up ledger record
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

    // 3a: Tasks with date + time and no ledger record → push to GCal
    for (var taskId in tasksById) {
      if (processedTaskIds.has(taskId)) continue;
      var newTask = tasksById[taskId];

      // Skip habit and generated tasks — they clutter GCal
      if (newTask.habit || newTask.generated) continue;

      // Only push tasks that have a valid M/D date + time
      if (!newTask.date || !/^\d{1,2}\/\d{1,2}$/.test(newTask.date)) continue;
      if (!newTask.time && newTask.when !== 'allday') continue;

      // Only push future tasks (from today forward)
      var taskParts = newTask.date.split('/');
      var taskMonth = parseInt(taskParts[0], 10) - 1;
      var taskDay = parseInt(taskParts[1], 10);
      var taskDate = new Date(year, taskMonth, taskDay);
      if (taskDate < todayStart) continue;
      if (taskDate > windowEnd) continue;

      try {
        var newEventBody = buildEventBody(newTask, year);
        var created = await gcalApi.insertEvent(accessToken, newEventBody);
        await delay(100);

        await db('tasks').where('id', newTask.id).update({
          gcal_event_id: created.id,
          updated_at: db.fn.now()
        });

        var createdStart = created.start?.dateTime || created.start?.date || null;
        var createdEnd = created.end?.dateTime || created.end?.date || null;

        await db('gcal_sync_ledger').insert({
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

        stats.pushed++;
      } catch (e) {
        stats.errors.push({ phase: 'push_new', taskId: newTask.id, error: e.message });
      }
    }

    // 3b: GCal events not in any ledger record → create task (future only)
    for (var evId in gcalEventsById) {
      if (processedGcalIds.has(evId)) continue;
      var newEvent = gcalEventsById[evId];

      // Check if this event is already linked to a task (pre-ledger)
      var existingTask = allTasks.find(function(t) { return t.gcal_event_id === evId; });
      if (existingTask) {
        // Create a ledger record for this pre-existing link
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
        // Past event — create ledger record but no task
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

      // Future event — check for existing task with same text+date before creating
      try {
        var evStartStr2 = newEvent.start?.dateTime || newEvent.start?.date;
        var evEndStr = newEvent.end?.dateTime || newEvent.end?.date;
        var evIsAllDay = !newEvent.start?.dateTime;
        var jd = isoToJugglerDate(evStartStr2);
        var evDur = evIsAllDay ? 0 : 30;
        if (!evIsAllDay && evStartStr2 && evEndStr) {
          evDur = computeDurationMinutes(evStartStr2, evEndStr);
        }

        // Skip if a task with the same text and date already exists (prevent duplicates)
        var dupTask = allTasks.find(function(t) {
          return t.text === (newEvent.summary || '') && t.date === jd.date;
        });
        if (dupTask) {
          // Link existing task to this GCal event via ledger (don't create a new task)
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
        var taskRow = {
          id: newTaskId,
          user_id: userId,
          text: newEvent.summary || '(No title)',
          date: jd.date,
          time: evIsAllDay ? null : jd.time,
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
        await db('tasks').insert(taskRow);

        await db('gcal_sync_ledger').insert({
          user_id: userId,
          task_id: newTaskId,
          gcal_event_id: newEvent.id,
          origin: 'gcal',
          last_pushed_hash: taskHash(taskRow),
          last_pulled_hash: eventHash(newEvent),
          gcal_summary: newEvent.summary || '(No title)',
          gcal_start: newEvent.start?.dateTime || newEvent.start?.date || null,
          gcal_end: newEvent.end?.dateTime || newEvent.end?.date || null,
          gcal_all_day: evIsAllDay ? 1 : 0,
          status: 'active',
          synced_at: db.fn.now(),
          created_at: db.fn.now()
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

/**
 * POST /api/gcal/auto-sync — toggle auto-sync setting
 * Body: { enabled: true/false }
 */
async function setAutoSync(req, res) {
  try {
    var { enabled } = req.body;
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
  // Exported for testing
  jugglerDateToISO,
  isoToJugglerDate,
  taskHash,
  eventHash
};
