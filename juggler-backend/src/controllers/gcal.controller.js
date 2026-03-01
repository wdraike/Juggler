/**
 * Google Calendar Controller — OAuth flow + push/pull sync
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const gcalApi = require('../lib/gcal-api');

const TIMEZONE = 'America/New_York';

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
    var match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match) {
      hours = parseInt(match[1], 10);
      minutes = parseInt(match[2], 10);
      var ampm = match[3].toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
    }
  }

  // Build a date string for the target timezone
  var dateStr = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') +
    'T' + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':00';
  return dateStr;
}

/**
 * Convert ISO datetime → { date: "M/D", time: "H:MM AM/PM" }
 */
function isoToJugglerDate(isoString) {
  if (!isoString) return { date: null, time: null };
  var d = new Date(isoString);
  // Use Intl to get parts in the right timezone
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
    // Fallback: parse directly
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

// --- Token management ---

function getJwtSecret() {
  return process.env.JWT_SECRET || 'local-dev-jwt-secret-juggler';
}

/**
 * Get a valid access token for a user, refreshing if expired
 */
async function getValidAccessToken(user) {
  if (!user.gcal_refresh_token) {
    throw new Error('Google Calendar not connected');
  }

  // Check if token is still valid (with 5 min buffer)
  if (user.gcal_access_token && user.gcal_token_expiry) {
    var expiry = new Date(user.gcal_token_expiry);
    if (expiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return user.gcal_access_token;
    }
  }

  // Refresh the token
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

// --- Endpoints ---

/**
 * GET /api/gcal/status — check if user has GCal connected
 */
async function getStatus(req, res) {
  try {
    var connected = !!req.user.gcal_refresh_token;
    var lastSyncedAt = req.user.gcal_last_synced_at || null;

    // Read auto-sync from user_config
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

    // Sign the user ID as state param to prevent CSRF
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

    // Verify state
    var decoded;
    try {
      decoded = jwt.verify(state, getJwtSecret());
    } catch (e) {
      return res.status(400).send('Invalid or expired state parameter');
    }

    var userId = decoded.userId;

    // Exchange code for tokens
    var oauth2Client = gcalApi.createOAuth2Client();
    var tokens = await gcalApi.getTokensFromCode(oauth2Client, code);

    // Store tokens
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

    // Redirect back to frontend
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
 * POST /api/gcal/push — push completed tasks as GCal events
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 */
async function push(req, res) {
  try {
    var { from, to } = req.body;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date range required' });
    }

    var accessToken = await getValidAccessToken(req.user);

    // Parse from/to into M/D format for DB query
    var fromDate = new Date(from + 'T00:00:00');
    var toDate = new Date(to + 'T00:00:00');

    // Get all done tasks in range that haven't been pushed yet
    var tasks = await db('tasks')
      .where('user_id', req.user.id)
      .where('status', 'done')
      .whereNull('gcal_event_id')
      .select();

    // Filter tasks whose date falls in range
    var year = new Date().getFullYear();
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
        var startISO = jugglerDateToISO(task.date, task.time, year);
        var dur = task.dur || 30;

        var startDt = new Date(startISO);
        var endDt = new Date(startDt.getTime() + dur * 60000);
        var endISO = endDt.toISOString().replace('Z', '').split('.')[0];

        // Build description from task metadata
        var descParts = [];
        if (task.project) descParts.push('Project: ' + task.project);
        if (task.pri) descParts.push('Priority: ' + task.pri);
        if (task.notes) descParts.push('Notes: ' + task.notes);
        descParts.push('', 'Synced from Juggler');

        var event = {
          summary: task.text,
          description: descParts.join('\n'),
          start: { dateTime: startISO, timeZone: TIMEZONE },
          end: { dateTime: endISO, timeZone: TIMEZONE }
        };

        var created = await gcalApi.insertEvent(accessToken, event);

        // Save the GCal event ID back to the task
        await db('tasks').where('id', task.id).update({
          gcal_event_id: created.id,
          updated_at: db.fn.now()
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
 * POST /api/gcal/pull — pull GCal events as Juggler tasks
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 */
async function pull(req, res) {
  try {
    var { from, to } = req.body;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date range required' });
    }

    var accessToken = await getValidAccessToken(req.user);

    var timeMin = from + 'T00:00:00Z';
    var timeMax = to + 'T23:59:59Z';

    var result = await gcalApi.listEvents(accessToken, timeMin, timeMax);
    var events = (result && result.items) || [];

    // Get existing gcal_event_ids to skip duplicates
    var existingIds = await db('tasks')
      .where('user_id', req.user.id)
      .whereNotNull('gcal_event_id')
      .pluck('gcal_event_id');
    var existingSet = new Set(existingIds);

    var pulled = 0;
    var skipped = 0;

    for (var event of events) {
      if (existingSet.has(event.id)) {
        skipped++;
        continue;
      }

      // Determine start/end
      var startStr = event.start?.dateTime || event.start?.date;
      var endStr = event.end?.dateTime || event.end?.date;
      var isAllDay = !event.start?.dateTime;

      var jugglerDate = isoToJugglerDate(startStr);
      var dur = 30;
      if (!isAllDay && startStr && endStr) {
        dur = computeDurationMinutes(startStr, endStr);
      }

      var taskId = 'gcal_' + crypto.randomBytes(8).toString('hex');

      var row = {
        id: taskId,
        user_id: req.user.id,
        text: event.summary || '(No title)',
        date: jugglerDate.date,
        time: isAllDay ? null : jugglerDate.time,
        dur: dur,
        pri: 'P3',
        status: '',
        gcal_event_id: event.id,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      };

      if (event.description) {
        row.notes = event.description;
      }

      await db('tasks').insert(row);
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
 * POST /api/gcal/sync — bidirectional sync (30 days back, 60 days forward)
 */
async function sync(req, res) {
  try {
    var accessToken = await getValidAccessToken(req.user);
    var userId = req.user.id;
    var year = new Date().getFullYear();
    var now = new Date();
    var lastSynced = req.user.gcal_last_synced_at ? new Date(req.user.gcal_last_synced_at) : null;

    // Sync window: 30 days back, 60 days forward
    var windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 30);
    var windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 60);

    var stats = { deleted: 0, pushed: 0, patched: 0, pulled: 0, unlinked: 0, errors: [] };

    // --- Phase 1: Deletions ---
    var deletionQueue = await db('gcal_deleted_events').where('user_id', userId);
    for (var del of deletionQueue) {
      try {
        await gcalApi.deleteEvent(accessToken, del.gcal_event_id);
      } catch (e) {
        // 404/410 = already gone, that's fine
        if (!e.message.includes('404') && !e.message.includes('410')) {
          stats.errors.push({ phase: 'delete', eventId: del.gcal_event_id, error: e.message });
        }
      }
      stats.deleted++;
    }
    if (deletionQueue.length > 0) {
      await db('gcal_deleted_events').where('user_id', userId).del();
    }

    // --- Phase 2: Push Juggler → GCal ---
    // Tasks with date + time in the sync window
    var tasks = await db('tasks').where('user_id', userId).whereNotNull('date').whereNotNull('time').select();

    // Filter to tasks in the sync window
    var tasksInWindow = tasks.filter(function(t) {
      if (!t.date) return false;
      var parts = t.date.split('/');
      var m = parseInt(parts[0], 10) - 1;
      var d = parseInt(parts[1], 10);
      var taskDate = new Date(year, m, d);
      return taskDate >= windowStart && taskDate <= windowEnd;
    });

    for (var task of tasksInWindow) {
      try {
        var startISO = jugglerDateToISO(task.date, task.time, year);
        var dur = task.dur || 30;
        var startDt = new Date(startISO);
        var endDt = new Date(startDt.getTime() + dur * 60000);
        var endISO = endDt.toISOString().replace('Z', '').split('.')[0];

        var descParts = [];
        if (task.project) descParts.push('Project: ' + task.project);
        if (task.pri) descParts.push('Priority: ' + task.pri);
        if (task.notes) descParts.push('Notes: ' + task.notes);
        descParts.push('', 'Synced from Juggler');

        var eventBody = {
          summary: task.text,
          description: descParts.join('\n'),
          start: { dateTime: startISO, timeZone: TIMEZONE },
          end: { dateTime: endISO, timeZone: TIMEZONE }
        };

        if (!task.gcal_event_id) {
          // New task → insert
          var created = await gcalApi.insertEvent(accessToken, eventBody);
          await db('tasks').where('id', task.id).update({
            gcal_event_id: created.id,
            updated_at: db.fn.now()
          });
          stats.pushed++;
        } else if (lastSynced && task.updated_at && new Date(task.updated_at) > lastSynced) {
          // Existing task modified since last sync → patch
          await gcalApi.patchEvent(accessToken, task.gcal_event_id, eventBody);
          stats.patched++;
        }
      } catch (e) {
        stats.errors.push({ phase: 'push', taskId: task.id, error: e.message });
      }
    }

    // --- Phase 3: Pull GCal → Juggler ---
    var timeMin = windowStart.toISOString();
    var timeMax = windowEnd.toISOString();
    var result = await gcalApi.listEvents(accessToken, timeMin, timeMax);
    var gcalEvents = (result && result.items) || [];

    // Build lookup: gcal_event_id → task
    var linkedTasks = await db('tasks').where('user_id', userId).whereNotNull('gcal_event_id').select();
    var taskByGcalId = {};
    linkedTasks.forEach(function(t) { taskByGcalId[t.gcal_event_id] = t; });

    var gcalEventIds = new Set(gcalEvents.map(function(e) { return e.id; }));

    for (var event of gcalEvents) {
      try {
        var existingTask = taskByGcalId[event.id];

        if (existingTask) {
          // Event matches task — update task if GCal changed since last sync
          // (last-write-wins: if both changed, GCal wins during pull)
          if (lastSynced) {
            var eventUpdated = event.updated ? new Date(event.updated) : null;
            if (eventUpdated && eventUpdated > lastSynced) {
              var startStr = event.start?.dateTime || event.start?.date;
              var endStr = event.end?.dateTime || event.end?.date;
              var isAllDay = !event.start?.dateTime;
              var jd = isoToJugglerDate(startStr);
              var eventDur = 30;
              if (!isAllDay && startStr && endStr) {
                eventDur = computeDurationMinutes(startStr, endStr);
              }

              await db('tasks').where('id', existingTask.id).update({
                text: event.summary || existingTask.text,
                date: jd.date || existingTask.date,
                time: isAllDay ? existingTask.time : (jd.time || existingTask.time),
                dur: eventDur,
                updated_at: db.fn.now()
              });
              stats.pulled++;
            }
          }
        } else {
          // New event from GCal → create task
          var startStr2 = event.start?.dateTime || event.start?.date;
          var endStr2 = event.end?.dateTime || event.end?.date;
          var isAllDay2 = !event.start?.dateTime;
          var jd2 = isoToJugglerDate(startStr2);
          var eventDur2 = 30;
          if (!isAllDay2 && startStr2 && endStr2) {
            eventDur2 = computeDurationMinutes(startStr2, endStr2);
          }

          var taskId = 'gcal_' + crypto.randomBytes(8).toString('hex');
          var row = {
            id: taskId,
            user_id: userId,
            text: event.summary || '(No title)',
            date: jd2.date,
            time: isAllDay2 ? null : jd2.time,
            dur: eventDur2,
            pri: 'P3',
            rigid: 1,
            status: '',
            gcal_event_id: event.id,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
          };
          if (event.description) {
            row.notes = event.description;
          }
          await db('tasks').insert(row);
          stats.pulled++;
        }
      } catch (e) {
        stats.errors.push({ phase: 'pull', eventId: event.id, error: e.message });
      }
    }

    // Unlink tasks whose gcal events no longer exist
    for (var linked of linkedTasks) {
      if (!gcalEventIds.has(linked.gcal_event_id)) {
        await db('tasks').where('id', linked.id).update({
          gcal_event_id: null,
          updated_at: db.fn.now()
        });
        stats.unlinked++;
      }
    }

    // --- Phase 4: Update timestamp ---
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
  setAutoSync
};
