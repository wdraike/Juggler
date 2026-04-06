/**
 * Task Controller — CRUD operations for tasks
 *
 * The DB stores scheduled_at (DATETIME, UTC) as the single source of truth.
 *
 * API accepts BOTH formats:
 *   - UTC ISO: scheduledAt ("2026-03-08T22:45:00Z"), dueAt, startAfterAt
 *   - Local strings: date ("3/8") + time ("6:45 PM") — converted server-side
 *   UTC takes precedence if both are provided.
 *
 * API always returns both: scheduledAt (UTC ISO) + date/time/day (local derived).
 */

const db = require('../db');
const { v7: uuidv7 } = require('uuid');
const { localToUtc, utcToLocal, toDateISO, fromDateISO, getDayName, safeTimezone } = require('../scheduler/dateHelpers');
const cache = require('../lib/redis');
const { enqueueScheduleRun } = require('../scheduler/scheduleQueue');

/** Safely parse a JSON string, returning fallback on any error. */
function safeParseJSON(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== 'string') return val || fallback;
  if (val === '' || val === 'null') return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

/**
 * Normalize priority to P1-P4 format. Accepts "P1", "1", "p2", etc.
 */
function normalizePri(pri) {
  if (!pri) return 'P3';
  var s = String(pri).trim();
  if (/^P[1-4]$/i.test(s)) return s.toUpperCase();
  if (/^[1-4]$/.test(s)) return 'P' + s;
  return 'P3';
}

/**
 * Convert a DB scheduled_at value to an ISO UTC string.
 */
function scheduledAtToISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  var s = String(val);
  // MySQL dateStrings mode returns "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return s.replace(' ', 'T') + 'Z';
  }
  // Already ISO
  if (s.endsWith('Z') || s.includes('+')) return s;
  return s + 'Z';
}

/**
 * Parse an ISO timestamp string into a Date for DB storage.
 * Accepts UTC ("2026-03-10T14:30:00Z") or with offset ("2026-03-10T10:30:00-04:00").
 */
function parseISOToDate(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d;
}

// Fields that live on the source template and are inherited by recurring instances.
// If an instance row has NULL for these, the value is read from the source.
// This is the SINGLE source of truth — used for rowToTask merge, updateTask routing,
// batchUpdateTasks routing, and MCP update routing.
// NOTE: scheduled_at and desired_at are NOT template fields — they belong on instances.
// The template's preferred time is stored in preferred_time_mins (minutes since midnight).
var TEMPLATE_FIELDS = ['text', 'dur', 'pri', 'project', 'section', 'location', 'tools',
  'when', 'day_req', 'recurring', 'rigid', 'time_flex', 'split', 'split_min',
  'travel_before', 'travel_after', 'depends_on',
  'notes', 'marker', 'flex_when', 'recur_start', 'recur_end',
  'preferred_time', 'preferred_time_mins'];

/**
 * Build a { sourceId: row } lookup from an array of task rows.
 * Includes recurring_template rows so instances can inherit their fields.
 */
function buildSourceMap(rows) {
  var map = {};
  rows.forEach(function(r) {
    if (r.task_type === 'recurring_template') {
      map[r.id] = r;
    }
  });
  return map;
}

/**
 * Map task row from DB to API format.
 * Derives date/time/day from scheduled_at (UTC) using the user's timezone.
 * If sourceMap is provided, recurring instances inherit template fields from their source.
 */
function rowToTask(row, timezone, sourceMap) {
  // Merge template fields from source for thin recurring instances
  var src = sourceMap && row.source_id ? sourceMap[row.source_id] : null;
  if (!src && row.source_id && sourceMap) {
    console.warn('[rowToTask] Orphaned instance: ' + row.id + ' references missing template ' + row.source_id);
  }
  // Disabled instances are frozen — do not inherit template fields so they stay locked in place
  if (src && row.status !== 'disabled') {
    // Recurring instances always inherit template fields from the source template.
    // The template is the single source of truth — instances never override.
    var merged = {};
    Object.keys(row).forEach(function(k) { merged[k] = row[k]; });
    TEMPLATE_FIELDS.forEach(function(f) {
      merged[f] = src[f];
    });
    row = merged;
  }

  // Terminal-status tasks must never appear in the future — clamp scheduled_at
  // to updated_at (completion time) or now, whichever is earlier.
  if (row.scheduled_at && (row.status === 'done' || row.status === 'cancel' || row.status === 'skip')) {
    var sa = new Date(row.scheduled_at);
    var now = new Date();
    if (sa > now) {
      var ua = row.updated_at ? new Date(row.updated_at) : now;
      row.scheduled_at = ua <= now ? ua : now;
    }
  }

  var date = null;
  var time = null;
  var day = null;
  var due = null;
  var startAfter = null;

  // Derive date/time/day from scheduled_at (UTC source of truth).
  // When timezone is null (API responses), skip derivation — the frontend
  // hydrates local fields from scheduledAt using the browser timezone.
  // When timezone is provided (scheduler), derive for internal use.
  var displayTz = timezone || null;
  if (displayTz && row.scheduled_at) {
    var local = utcToLocal(row.scheduled_at, displayTz);
    if (local.date) date = local.date;
    if (local.time) time = local.time;
    if (local.day) day = local.day;
  }

  // Recurring instances in Time Window mode: derive the preferred time from
  // the template's preferred_time_mins (minutes since midnight, local tz).
  // No timezone conversion needed — the value is already in local time.
  // Exception: disabled instances are frozen.
  if (src && src.preferred_time_mins != null && row.status !== 'disabled') {
    var ptH = Math.floor(src.preferred_time_mins / 60);
    var ptM = src.preferred_time_mins % 60;
    var ptAmpm = ptH >= 12 ? 'PM' : 'AM';
    var ptH12 = ptH % 12 || 12;
    time = ptH12 + ':' + (ptM < 10 ? '0' : '') + ptM + ' ' + ptAmpm;
  }

  // Derive due from due_at DATE column
  if (row.due_at) {
    due = fromDateISO(row.due_at instanceof Date
      ? row.due_at.toISOString().split('T')[0]
      : String(row.due_at).split('T')[0]);
  }
  // Derive startAfter from start_after_at DATE column
  if (row.start_after_at) {
    startAfter = fromDateISO(row.start_after_at instanceof Date
      ? row.start_after_at.toISOString().split('T')[0]
      : String(row.start_after_at).split('T')[0]);
  }

  // Build dueAt / startAfterAt ISO strings
  var dueAtISO = null;
  if (row.due_at) {
    var dueStr = row.due_at instanceof Date
      ? row.due_at.toISOString().split('T')[0]
      : String(row.due_at).split('T')[0];
    dueAtISO = dueStr;
  }
  var startAfterAtISO = null;
  if (row.start_after_at) {
    var saStr = row.start_after_at instanceof Date
      ? row.start_after_at.toISOString().split('T')[0]
      : String(row.start_after_at).split('T')[0];
    startAfterAtISO = saStr;
  }

  return {
    id: row.id,
    taskType: row.task_type || 'task',
    text: row.text,
    // UTC source of truth
    scheduledAt: scheduledAtToISO(row.scheduled_at),
    tz: row.tz || null,
    dueAt: dueAtISO,
    startAfterAt: startAfterAtISO,
    // Derived local convenience fields
    date: date,
    day: day,
    time: time,
    dur: row.dur,
    timeRemaining: row.time_remaining,
    pri: row.pri,
    project: row.project,
    status: row.status || '',
    section: row.section,
    notes: row.notes,
    due: due,
    startAfter: startAfter,
    location: safeParseJSON(row.location, []),
    tools: safeParseJSON(row.tools, []),
    when: row.when,
    dayReq: row.day_req,
    recurring: !!row.recurring,
    rigid: !!row.rigid,
    timeFlex: row.time_flex != null ? row.time_flex : undefined,
    split: row.split === null ? undefined : !!row.split,
    splitMin: row.split_min,
    recur: safeParseJSON(row.recur, null),
    sourceId: row.source_id,
    generated: !!row.generated,
    gcalEventId: row.gcal_event_id,
    msftEventId: row.msft_event_id,
    dependsOn: safeParseJSON(row.depends_on, []),
    datePinned: !!row.date_pinned,
    prevWhen: row.prev_when || null,
    marker: !!row.marker,
    flexWhen: !!row.flex_when,
    travelBefore: row.travel_before != null ? row.travel_before : undefined,
    travelAfter: row.travel_after != null ? row.travel_after : undefined,
    preferredTime: row.preferred_time != null ? !!row.preferred_time : null,
    preferredTimeMins: row.preferred_time_mins != null ? row.preferred_time_mins : null,
    desiredAt: row.desired_at ? new Date(row.desired_at).toISOString() : null,
    desiredDate: row.desired_date || null,
    unscheduled: !!row.unscheduled,
    recurStart: row.recur_start || null,
    recurEnd: row.recur_end || null,
    disabledAt: row.disabled_at ? scheduledAtToISO(row.disabled_at) : null,
    disabledReason: row.disabled_reason || null
  };
}

/**
 * Map API task to DB row.
 * Converts date+time → scheduled_at (UTC) and due/startAfter → due_at/start_after_at.
 */
function taskToRow(task, userId, timezone) {
  var row = { user_id: userId };
  if (task.id !== undefined) row.id = task.id;
  if (task.taskType !== undefined) row.task_type = task.taskType;
  if (task.text !== undefined) row.text = task.text;
  if (task.dur !== undefined) row.dur = task.dur || 30;
  if (task.timeRemaining !== undefined) row.time_remaining = task.timeRemaining;
  if (task.pri !== undefined) row.pri = normalizePri(task.pri);
  if (task.project !== undefined) row.project = task.project;
  if (task.status !== undefined) row.status = task.status;
  if (task.section !== undefined) row.section = task.section;
  if (task.notes !== undefined) row.notes = task.notes;
  // UTC ISO fields take precedence over local string fields
  if (task.dueAt !== undefined) {
    row.due_at = task.dueAt || null;
  } else if (task.due !== undefined) {
    row.due_at = task.due ? toDateISO(task.due) || null : null;
  }
  if (task.startAfterAt !== undefined) {
    row.start_after_at = task.startAfterAt || null;
  } else if (task.startAfter !== undefined) {
    row.start_after_at = task.startAfter ? toDateISO(task.startAfter) || null : null;
  }
  if (task.location !== undefined) row.location = JSON.stringify(task.location);
  if (task.tools !== undefined) row.tools = JSON.stringify(task.tools);
  if (task.when !== undefined) row.when = task.when;
  if (task.dayReq !== undefined) row.day_req = task.dayReq;
  if (task.recurring !== undefined) row.recurring = task.recurring ? 1 : 0;
  if (task.rigid !== undefined) row.rigid = task.rigid ? 1 : 0;
  if (task.timeFlex !== undefined) row.time_flex = task.timeFlex;
  if (task.split !== undefined) row.split = task.split === null ? null : (task.split ? 1 : 0);
  if (task.splitMin !== undefined) row.split_min = task.splitMin;
  if (task.recur !== undefined) row.recur = task.recur ? JSON.stringify(task.recur) : null;
  if (task.sourceId !== undefined) row.source_id = task.sourceId;
  if (task.generated !== undefined) row.generated = task.generated ? 1 : 0;
  if (task.gcalEventId !== undefined) row.gcal_event_id = task.gcalEventId;
  if (task.msftEventId !== undefined) row.msft_event_id = task.msftEventId;
  if (task.dependsOn !== undefined) row.depends_on = JSON.stringify(task.dependsOn || []);
  if (task.datePinned !== undefined) row.date_pinned = task.datePinned ? 1 : 0;
  if (task.marker !== undefined) row.marker = task.marker ? 1 : 0;
  if (task.flexWhen !== undefined) row.flex_when = task.flexWhen ? 1 : 0;
  if (task.travelBefore !== undefined) row.travel_before = task.travelBefore || null;
  if (task.travelAfter !== undefined) row.travel_after = task.travelAfter || null;
  if (task.tz !== undefined) row.tz = task.tz || null;
  if (task.recurStart !== undefined) row.recur_start = task.recurStart || null;
  if (task.recurEnd !== undefined) row.recur_end = task.recurEnd || null;
  if (task.preferredTime !== undefined) row.preferred_time = task.preferredTime ? 1 : 0;
  if (task.preferredTimeMins !== undefined) row.preferred_time_mins = task.preferredTimeMins;

  // Direct desired_at / desired_date mapping (if caller provides them explicitly)
  if (task.desiredAt !== undefined) {
    row.desired_at = task.desiredAt ? parseISOToDate(task.desiredAt) : null;
  }
  if (task.desiredDate !== undefined) {
    row.desired_date = task.desiredDate || null;
  }

  // scheduledAt (UTC ISO) takes precedence over date+time (local strings)
  if (task.scheduledAt !== undefined) {
    row.scheduled_at = task.scheduledAt ? parseISOToDate(task.scheduledAt) : null;
    // Also set desired_at to preserve user intent (unless explicitly provided)
    if (row.desired_at === undefined) {
      row.desired_at = row.scheduled_at;
    }
  } else if (timezone && (task.date !== undefined || task.time !== undefined)) {
    var dateVal = task.date !== undefined ? task.date : null;
    var timeVal = task.time !== undefined ? task.time : null;
    if (dateVal) {
      row.scheduled_at = localToUtc(dateVal, timeVal, timezone) || null;
      // Also set desired_at to preserve user intent
      if (row.desired_at === undefined) {
        row.desired_at = row.scheduled_at;
      }
      // Set desired_date for date-only tasks (no time specified)
      if (!timeVal && row.desired_date === undefined) {
        row.desired_date = toDateISO(dateVal) || null;
      }
    } else if (task.date !== undefined && !dateVal) {
      // date was explicitly sent as null/empty → clear scheduled_at and desired_at
      row.scheduled_at = null;
      if (row.desired_at === undefined) row.desired_at = null;
      if (row.desired_date === undefined) row.desired_date = null;
    }
    // If only time was sent (no date field), scheduled_at is handled in the
    // caller which can read the existing row's date and combine with the new time.
    if (task.date === undefined && task.time !== undefined) {
      row._pendingTimeOnly = timeVal;
    }
  }

  // Time mode field cleanup: clear fields irrelevant to the active mode.
  // Only applies when preferred_time is explicitly set in this update.
  if (row.preferred_time === 1) {
    // Time Window mode: placement is anchor time ± time_flex.
    // Time blocks (when), splitting, and flex_when are irrelevant.
    row.split = null;
    row.split_min = null;
    row.flex_when = null;
    // Don't clear 'when' — it may carry the tag for the time window anchor
    // Don't clear 'time_flex' — it IS the flexibility window for this mode
  } else if (row.preferred_time === 0) {
    // Time Block mode: placement uses when tags. time_flex is irrelevant.
    row.time_flex = null;
  }

  row.updated_at = db.fn.now();
  return row;
}

/**
 * Compute a version string from the most recent updated_at across all tasks.
 * Used for change-detection polling so the frontend knows when to reload.
 */
async function getTasksVersion(userId) {
  var row = await db('tasks')
    .where('user_id', userId)
    .max('updated_at as max_updated')
    .count('* as cnt')
    .first();
  // Combine max timestamp + count so additions/deletions also change the version
  var ts = row && row.max_updated ? String(row.max_updated) : '0';
  var cnt = row ? String(row.cnt) : '0';
  return ts + ':' + cnt;
}

/**
 * GET /api/tasks — all tasks for user
 */
async function getAllTasks(req, res) {
  try {
    var cacheKey = `user:${req.user.id}:tasks`;
    var cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    var query = db('tasks').where('user_id', req.user.id).orderBy('created_at', 'asc');
    if (req.query.limit) query = query.limit(parseInt(req.query.limit) || 1000);
    if (req.query.offset) query = query.offset(parseInt(req.query.offset) || 0);
    var rows = await query;
    var srcMap = buildSourceMap(rows);
    var tasks = rows.map(function(r) { return rowToTask(r, null, srcMap); });
    var version = await getTasksVersion(req.user.id);
    var result = { tasks: tasks, version: version };
    await cache.set(cacheKey, result, 300); // 5 min TTL
    res.json(result);
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
}

/**
 * GET /api/tasks/version — lightweight change-detection endpoint
 */
async function getVersion(req, res) {
  try {
    var cacheKey = `user:${req.user.id}:version`;
    var cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    var version = await getTasksVersion(req.user.id);
    var result = { version: version };
    await cache.set(cacheKey, result, 30); // 30s TTL — polled every 5-10s
    res.json(result);
  } catch (error) {
    console.error('Get version error:', error);
    res.status(500).json({ error: 'Failed to get version' });
  }
}

/**
 * POST /api/tasks — create single task
 */
async function ensureProject(userId, projectName) {
  if (!projectName) return;
  var exists = await db('projects').where({ user_id: userId, name: projectName }).first();
  if (!exists) {
    await db('projects').insert({ user_id: userId, name: projectName });
  }
}

async function applySplitDefault(row, userId) {
  if (row.split === undefined || row.split === null) {
    var prefs = await db('user_config').where({ user_id: userId, config_key: 'preferences' }).first();
    var splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;
    row.split = splitDefault ? 1 : 0;
  }
}

var VALID_WHEN_KEYWORDS = ['', 'fixed', 'allday', 'anytime'];
var VALID_DAY_REQ = ['any', 'weekday', 'weekend'];
var VALID_DAY_CODES = ['M', 'T', 'W', 'R', 'F', 'Sa', 'Su', 'S', 'U'];

function validateTaskInput(body) {
  var errors = [];
  // text required for creation
  if (body._requireText && (!body.text || !body.text.trim())) {
    errors.push('Task name is required');
  }
  // text length limit
  if (body.text && body.text.length > 500) {
    errors.push('Task name must be 500 characters or less');
  }
  // notes length limit
  if (body.notes && body.notes.length > 5000) {
    errors.push('Notes must be 5000 characters or less');
  }
  // when validation
  if (body.when !== undefined && body.when !== null) {
    var whenParts = String(body.when).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    // Each part should be a known keyword or a time block tag (we allow any non-empty string for custom blocks)
    // Just reject obviously bad values
    if (whenParts.some(function(p) { return p.length > 30; })) {
      errors.push('Invalid when value: tag names must be 30 characters or less');
    }
  }
  // dayReq validation
  if (body.dayReq !== undefined && body.dayReq !== null) {
    var dr = String(body.dayReq);
    if (VALID_DAY_REQ.indexOf(dr) === -1) {
      // Check if it's comma-separated day codes
      var dayParts = dr.split(',');
      var allValid = dayParts.every(function(p) { return VALID_DAY_CODES.indexOf(p.trim()) !== -1; });
      if (!allValid) errors.push('Invalid dayReq: must be any, weekday, weekend, or comma-separated day codes (M,T,W,R,F,Sa,Su)');
    }
  }
  return errors;
}

async function createTask(req, res) {
  try {
    // Validate input
    req.body._requireText = true;
    var validationErrors = validateTaskInput(req.body);
    delete req.body._requireText;
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    var tz = safeTimezone(req.headers['x-timezone']);
    var row = taskToRow(req.body, req.user.id, tz);
    if (!row.id) row.id = uuidv7();
    if (!row.task_type) row.task_type = 'task';
    row.created_at = db.fn.now();
    // When a user explicitly provides a date/scheduledAt on creation, pin it
    // so the scheduler doesn't drift the task to a different day.
    var dateWasSet = req.body.date !== undefined || req.body.scheduledAt !== undefined;
    if (dateWasSet && row.date_pinned === undefined) {
      row.date_pinned = 1;
    }
    // When a user creates a task with an explicit time, make it fixed so the
    // scheduler anchors it at that time. User can remove the fixed setting later.
    var timeWasSet = req.body.time !== undefined || req.body.scheduledAt !== undefined;
    if (timeWasSet && row.when === undefined) {
      row.when = 'fixed';
    }
    // Recurrings cannot have dependencies — clear if provided
    if (row.recurring || row.task_type === 'recurring_template' || row.task_type === 'recurring_instance') {
      delete row.depends_on;
    }
    await applySplitDefault(row, req.user.id);
    await ensureProject(req.user.id, req.body.project);
    await db('tasks').insert(row);
    var created = await db('tasks').where('id', row.id).first();
    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:createTask');
    res.status(201).json({ task: rowToTask(created, null) });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
}

/**
 * PUT /api/tasks/:id — update task fields
 */
async function updateTask(req, res) {
  try {
    console.log('[UPDATE] id=' + req.params.id + ' body=' + JSON.stringify(req.body));
    var validationErrors = validateTaskInput(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    var id = req.params.id;
    var existing = await db('tasks').where({ id: id, user_id: req.user.id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (existing.status === 'disabled') {
      return res.status(403).json({
        error: 'This item is disabled. Re-enable it before making changes.',
        code: 'TASK_DISABLED'
      });
    }

    var tz = safeTimezone(req.headers['x-timezone']);
    var row = taskToRow(req.body, req.user.id, tz);
    delete row.id;
    delete row.user_id;
    delete row.created_at;

    // Recurrings cannot have dependencies — strip if provided
    if (existing.recurring || existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance') {
      delete row.depends_on;
    }

    // Time-only update: combine new time with existing date
    if (row._pendingTimeOnly && existing.scheduled_at) {
      var existingLocal = utcToLocal(existing.scheduled_at, tz);
      if (existingLocal && existingLocal.date) {
        row.scheduled_at = localToUtc(existingLocal.date, row._pendingTimeOnly, tz) || null;
        // Also update desired_at to preserve user intent
        if (row.desired_at === undefined) {
          row.desired_at = row.scheduled_at;
        }
      }
    }
    delete row._pendingTimeOnly;

    if (req.body.project) await ensureProject(req.user.id, req.body.project);

    // When the user explicitly sets a date/scheduledAt, pin it so the scheduler honors it.
    var dateWasSet = req.body.date !== undefined || req.body.scheduledAt !== undefined;
    var timeWasSet = req.body.time !== undefined || req.body.scheduledAt !== undefined;
    if (dateWasSet && row.date_pinned === undefined) {
      row.date_pinned = 1;
    }
    // Drag-pin: user dragged this task to a new time on the calendar.
    // Convert to fixed mode so the scheduler won't overwrite the placement.
    // Store the previous when so it can be restored on unpin.
    if (req.body._dragPin) {
      var currentWhen = existing.when || '';
      // Only store prev_when if not already pinned (avoid overwriting the original)
      if (!existing.prev_when && currentWhen !== 'fixed') {
        row.prev_when = currentWhen;
      }
      row.when = 'fixed';
      row.date_pinned = 1;
    }

    // Use the single TEMPLATE_FIELDS array for routing (defined at module level)

    var taskType = existing.task_type || 'task';

    await db.transaction(async function(trx) {
      if (taskType === 'recurring_instance' && existing.source_id) {
        // Route template fields to the source, keep instance fields on this row.
        // Exception: drag-pin sets when='fixed' on the INSTANCE (not the template)
        // so this specific instance is pinned without affecting other instances.
        var isDragPin = !!req.body._dragPin;
        var templateUpdate = {};
        var instanceUpdate = {};

        Object.keys(row).forEach(function(k) {
          if (k === 'updated_at') return; // added to both
          // For drag-pin: when + prev_when stay on instance, not routed to template
          if (isDragPin && (k === 'when' || k === 'prev_when')) {
            instanceUpdate[k] = row[k];
          } else if (TEMPLATE_FIELDS.indexOf(k) >= 0) {
            templateUpdate[k] = row[k];
          } else {
            instanceUpdate[k] = row[k];
          }
        });

        // Update the source template with template fields
        if (Object.keys(templateUpdate).length > 0) {
          templateUpdate.updated_at = db.fn.now();
          await trx('tasks')
            .where({ id: existing.source_id, user_id: req.user.id })
            .update(templateUpdate);
        }

        // Update instance-specific fields on this row
        if (Object.keys(instanceUpdate).length > 0) {
          instanceUpdate.updated_at = db.fn.now();
          await trx('tasks').where({ id: id, user_id: req.user.id }).update(instanceUpdate);
        } else {
          // Still touch updated_at so version changes
          await trx('tasks').where({ id: id, user_id: req.user.id }).update({ updated_at: db.fn.now() });
        }
      } else if (taskType === 'recurring_template') {
        // Editing the template directly — just update the template row.
        // Instances always inherit template fields via rowToTask.
        await trx('tasks').where({ id: id, user_id: req.user.id }).update(row);

        // If recurrence or recurring date range changed, clean up pending instances
        // that no longer match the new pattern.
        var needsCleanup = row.recur !== undefined || row.recur_start !== undefined || row.recur_end !== undefined;
        if (needsCleanup) {
          var _dateHelpers = require('../scheduler/dateHelpers');
          var updatedTmpl = await trx('tasks').where({ id: id, user_id: req.user.id }).first();
          var newRecur = typeof updatedTmpl.recur === 'string' ? JSON.parse(updatedTmpl.recur || 'null') : updatedTmpl.recur;
          var oldRecur = typeof existing.recur === 'string' ? JSON.parse(existing.recur || 'null') : existing.recur;

          // Full cycle reset: if recurrence type, days, or timesPerCycle changed,
          // delete ALL future active instances so they regenerate with new settings.
          var recurChanged = row.recur !== undefined && (
            (oldRecur && newRecur && (
              oldRecur.type !== newRecur.type ||
              JSON.stringify(oldRecur.days) !== JSON.stringify(newRecur.days) ||
              (oldRecur.timesPerCycle || 0) !== (newRecur.timesPerCycle || 0)
            )) ||
            (!oldRecur && newRecur) ||
            (oldRecur && !newRecur)
          );

          if (recurChanged) {
            // Full reset: delete all future active instances
            var resetCount = await trx('tasks')
              .where({ source_id: id, user_id: req.user.id, task_type: 'recurring_instance' })
              .where('status', '')
              .del();
            if (resetCount > 0) {
              console.log('[RECUR] cycle reset: deleted ' + resetCount + ' pending instances after recurrence change on ' + id);
            }
          } else {
            // Incremental cleanup: only delete instances that no longer match
            var _dateMatch = require('../../shared/scheduler/dateMatchesRecurrence');
            var srcDateStr = updatedTmpl.scheduled_at ? utcToLocal(updatedTmpl.scheduled_at, tz).date : null;

            var pendingInstances = await trx('tasks')
              .where({ source_id: id, user_id: req.user.id, task_type: 'recurring_instance' })
              .where('status', '');

            var deleteIds = [];
            pendingInstances.forEach(function(inst) {
              var instDate = inst.scheduled_at ? utcToLocal(inst.scheduled_at, tz).date : null;
              if (!instDate) { deleteIds.push(inst.id); return; }
              if (!newRecur || newRecur.type === 'none' ||
                  !_dateMatch.dateMatchesRecurrence(instDate, newRecur, srcDateStr, _dateHelpers.parseDate)) {
                deleteIds.push(inst.id); return;
              }
              if (updatedTmpl.recur_start) {
                var hs = _dateHelpers.parseDate(updatedTmpl.recur_start instanceof Date
                  ? _dateHelpers.formatDateKey(updatedTmpl.recur_start)
                  : String(updatedTmpl.recur_start).replace(/-/g, '/').replace(/^0/, ''));
                var instD = _dateHelpers.parseDate(instDate);
                if (hs && instD && instD < hs) { deleteIds.push(inst.id); return; }
              }
              if (updatedTmpl.recur_end) {
                var he = _dateHelpers.parseDate(updatedTmpl.recur_end instanceof Date
                  ? _dateHelpers.formatDateKey(updatedTmpl.recur_end)
                  : String(updatedTmpl.recur_end).replace(/-/g, '/').replace(/^0/, ''));
                var instD2 = _dateHelpers.parseDate(instDate);
                if (he && instD2 && instD2 > he) { deleteIds.push(inst.id); return; }
              }
            });

            if (deleteIds.length > 0) {
              await trx('tasks').where('user_id', req.user.id).whereIn('id', deleteIds).del();
              console.log('[RECUR] cleaned up ' + deleteIds.length + ' pending instances after date-range change on ' + id);
            }
          }
        }
      } else {
        // Normal (non-recurring) task — update directly
        await trx('tasks').where({ id: id, user_id: req.user.id }).update(row);
      }
    });

    // Re-read with sourceMap so the response includes merged fields
    var allRows = await db('tasks').where('user_id', req.user.id).select();
    var srcMap = buildSourceMap(allRows);
    var updatedRow = allRows.find(function(r) { return r.id === id; });
    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:updateTask');
    res.json({ task: rowToTask(updatedRow, null, srcMap) });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
}

/**
 * DELETE /api/tasks/:id — delete task
 */
async function deleteTask(req, res) {
  try {
    var id = req.params.id;
    var cascade = req.query.cascade;
    var task = await db('tasks').where({ id: id, user_id: req.user.id }).first();
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Cascade recurring delete: delete template + pending instances, keep completed
    if (cascade === 'recurring') {
      // Resolve the template ID — caller may pass a template or an instance
      var templateId = id;
      if (task.task_type === 'recurring_instance' || task.source_id) {
        templateId = task.source_id || id;
      }

      var deletedCount = 0;
      var keptCount = 0;

      await db.transaction(async function(trx) {
        // Find all instances of this recurring task
        var instances = await trx('tasks')
          .where({ user_id: req.user.id, source_id: templateId })
          .select('id', 'status', 'gcal_event_id', 'msft_event_id');

        // Delete pending instances (no status = never acted on)
        var pendingIds = instances
          .filter(function(inst) {
            var st = inst.status || '';
            return st !== 'done' && st !== 'cancel' && st !== 'skip';
          })
          .map(function(inst) { return inst.id; });

        // Clean up calendar sync for pending instances
        if (pendingIds.length > 0) {
          await trx('cal_sync_ledger')
            .where('user_id', req.user.id)
            .whereIn('task_id', pendingIds)
            .where('status', 'active')
            .update({ task_id: null, synced_at: db.fn.now() })
            .catch(function(err) { console.error("[silent-catch]", err.message); });

          await trx('tasks')
            .where('user_id', req.user.id)
            .whereIn('id', pendingIds)
            .del();
          deletedCount = pendingIds.length;
        }

        // Clear source_id on kept (completed) instances so they don't reference a dead template
        var keptIds = instances
          .filter(function(inst) {
            var st = inst.status || '';
            return st === 'done' || st === 'cancel' || st === 'skip';
          })
          .map(function(inst) { return inst.id; });

        if (keptIds.length > 0) {
          await trx('tasks')
            .where('user_id', req.user.id)
            .whereIn('id', keptIds)
            .update({ source_id: null, updated_at: db.fn.now() });
          keptCount = keptIds.length;
        }

        // Delete the template itself
        // Clean up calendar sync for template
        var template = await trx('tasks').where({ id: templateId, user_id: req.user.id }).first();
        if (template) {
          if (template.gcal_event_id || template.msft_event_id) {
            await trx('cal_sync_ledger')
              .where({ user_id: req.user.id, task_id: templateId })
              .where('status', 'active')
              .update({ task_id: null, synced_at: db.fn.now() })
              .catch(function(err) { console.error("[silent-catch]", err.message); });
          }
          await trx('tasks').where({ id: templateId, user_id: req.user.id }).del();
        }
      });

      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:deleteTask:cascade');
      res.json({
        message: 'Recurring deleted',
        templateId: templateId,
        deletedInstances: deletedCount,
        keptInstances: keptCount,
      });
      return;
    }

    // Standard single-task delete
    await db.transaction(async function(trx) {
      var deletedDeps = typeof task.depends_on === 'string'
        ? JSON.parse(task.depends_on || '[]') : (task.depends_on || []);
      var affected = await trx('tasks')
        .where('user_id', req.user.id)
        .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(id)])
        .select('id', 'depends_on');
      if (affected.length > 0) {
        var depUpdates = affected.map(function(other) {
          var deps = typeof other.depends_on === 'string'
            ? JSON.parse(other.depends_on || '[]') : (other.depends_on || []);
          var newDeps = deps.filter(function(d) { return d !== id; });
          deletedDeps.forEach(function(d) { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
          return { id: other.id, depends_on: JSON.stringify(newDeps) };
        });
        await Promise.all(depUpdates.map(function(u) {
          return trx('tasks').where({ id: u.id, user_id: req.user.id })
            .update({ depends_on: u.depends_on, updated_at: db.fn.now() });
        }));
      }

      if (task.gcal_event_id || task.msft_event_id) {
        await trx('cal_sync_ledger')
          .where({ user_id: req.user.id, task_id: id })
          .where('status', 'active')
          .update({ task_id: null, synced_at: db.fn.now() })
          .catch(function(err) { console.error("[silent-catch]", err.message); });
      }

      await trx('tasks').where({ id: id, user_id: req.user.id }).del();
    });

    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:deleteTask');
    res.json({ message: 'Task deleted', id: id });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
}

/**
 * PUT /api/tasks/:id/status — update status + direction
 */
var VALID_STATUSES = ['', 'done', 'wip', 'cancel', 'skip', 'pause', 'disabled'];

async function updateTaskStatus(req, res) {
  try {
    var id = req.params.id;
    var status = req.body.status;

    // Validate status value
    if (status !== undefined && VALID_STATUSES.indexOf(status) === -1) {
      return res.status(400).json({ error: 'Invalid status. Valid values: ' + VALID_STATUSES.join(', ') });
    }

    var existing = await db('tasks').where({ id: id, user_id: req.user.id }).first();

    // Generated recurring instances (rc_<sourceId>_<dateDigits>) may not yet have
    // a DB row if the scheduler hasn't run since they were expanded.
    // Materialize them on demand so the status change can be persisted.
    if (!existing && id.startsWith('rc_')) {
      var parts = id.split('_');
      var dateDigits = parts[parts.length - 1];
      var sourceId = parts.slice(1, -1).join('_');
      var source = await db('tasks').where({ id: sourceId, user_id: req.user.id }).first();
      if (source) {
        // Parse date from concatenated M+D digits (e.g. "318" → "3/18")
        var first2 = parseInt(dateDigits.substring(0, 2), 10);
        var localDate;
        if (dateDigits.length >= 3 && first2 >= 10 && first2 <= 12) {
          localDate = dateDigits.substring(0, 2) + '/' + dateDigits.substring(2);
        } else {
          localDate = dateDigits.substring(0, 1) + '/' + dateDigits.substring(1);
        }
        var srcTime = source.scheduled_at ? utcToLocal(source.scheduled_at, tz).time : null;
        var scheduledAt = localToUtc(localDate, srcTime, tz);
        await db('tasks').insert({
          id: id,
          user_id: req.user.id,
          task_type: 'recurring_instance',
          source_id: sourceId,
          generated: 0,
          recurring: 1,
          scheduled_at: scheduledAt || null,
          status: '',
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        });
        existing = await db('tasks').where({ id: id, user_id: req.user.id }).first();
      }
    }

    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (existing.status === 'disabled') {
      return res.status(403).json({
        error: 'This item is disabled. Use the re-enable endpoint to restore it.',
        code: 'TASK_DISABLED'
      });
    }

    // Recurring templates: only 'pause' and '' (unpause) are valid statuses
    if (existing.task_type === 'recurring_template') {
      if (status !== 'pause' && status !== '') {
        return res.status(400).json({ error: 'Recurring templates can only be paused or unpaused' });
      }

      await db('tasks').where({ id: id, user_id: req.user.id }).update({ status: status || '', updated_at: db.fn.now() });

      // When pausing: delete future open instances and clean up their GCal events
      if (status === 'pause') {
        var futureInstances = await db('tasks')
          .where({ source_id: id, user_id: req.user.id })
          .where('status', '')
          .where('scheduled_at', '>', new Date())
          .select('id', 'gcal_event_id');

        var instanceIds = futureInstances.map(function(i) { return i.id; });

        if (instanceIds.length > 0) {
          // Clean up calendar sync ledger entries for deleted instances
          await db('cal_sync_ledger')
            .where('user_id', req.user.id)
            .whereIn('task_id', instanceIds)
            .where('status', 'active')
            .update({ status: 'deleted_local', task_id: null, provider_event_id: null, synced_at: db.fn.now() })
            .catch(function(err) { console.error("[silent-catch]", err.message); });

          await db('tasks')
            .where({ user_id: req.user.id })
            .whereIn('id', instanceIds)
            .del();
        }
      }
      // Unpausing: next scheduler run will regenerate instances via expandRecurring

      var srcMap = buildSourceMap(await db('tasks').where({ user_id: req.user.id, task_type: 'recurring_template' }).select());
      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:updateTaskStatus:template');
      var updatedTemplate = await db('tasks').where('id', id).first();
      return res.json({ task: rowToTask(updatedTemplate, null, srcMap), instancesRemoved: status === 'pause' ? (instanceIds || []).length : 0 });
    }

    var update = { status: status || '', updated_at: db.fn.now() };
    var isFutureScheduled = existing.scheduled_at && new Date(existing.scheduled_at) > new Date();

    // When marking done, stamp scheduled_at to the chosen completion time
    if (status === 'done') {
      var completedAt = req.body.completedAt;
      if (completedAt === 'scheduled' && !isFutureScheduled) {
        // Keep existing scheduled_at — no change (only if not in the future)
      } else if (completedAt && completedAt !== 'now' && completedAt !== 'scheduled') {
        // Custom datetime string from the user — clamp to now if in the future
        var customDate = new Date(completedAt);
        update.scheduled_at = customDate > new Date() ? db.fn.now() : customDate;
      } else {
        // Default: current time
        update.scheduled_at = db.fn.now();
      }
    }

    // For cancel/skip with a future scheduled_at, snap to now
    if ((status === 'cancel' || status === 'skip') && isFutureScheduled) {
      update.scheduled_at = db.fn.now();
    }


    await db('tasks').where({ id: id, user_id: req.user.id }).update(update);
    var updated = await db('tasks').where('id', id).first();
    var srcMap = buildSourceMap(await db('tasks').where({ user_id: req.user.id, task_type: 'recurring_template' }).select());
    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:updateTaskStatus');
    res.json({ task: rowToTask(updated, null, srcMap) });
  } catch (error) {
    console.error('Update task status error:', error);
    res.status(500).json({ error: 'Failed to update task status' });
  }
}

/**
 * POST /api/tasks/batch — batch create tasks
 */
async function batchCreateTasks(req, res) {
  try {
    var tasks = req.body.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Tasks array required' });
    }
    if (tasks.length > 500) {
      return res.status(400).json({ error: 'Batch limited to 500 items' });
    }

    // Validate field lengths to prevent oversized data
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (t.title && t.title.length > 500) return res.status(400).json({ error: `Task ${i}: title too long (max 500 chars)` });
      if (t.notes && t.notes.length > 5000) return res.status(400).json({ error: `Task ${i}: notes too long (max 5000 chars)` });
      if (t.depends_on && Array.isArray(t.depends_on) && t.depends_on.length > 50) return res.status(400).json({ error: `Task ${i}: too many dependencies (max 50)` });
    }

    var tz = safeTimezone(req.headers['x-timezone']);

    var prefs = await db('user_config').where({ user_id: req.user.id, config_key: 'preferences' }).first();
    var splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;

    var rows = tasks.map(function(t) {
      var row = taskToRow(t, req.user.id, tz);
      row.created_at = db.fn.now();
      if (row.split === undefined || row.split === null) {
        row.split = splitDefault ? 1 : 0;
      }
      return row;
    });

    var projectNames = [];
    var seen = {};
    tasks.forEach(function(t) {
      if (t.project && !seen[t.project]) { projectNames.push(t.project); seen[t.project] = true; }
    });
    for (var i = 0; i < projectNames.length; i++) {
      await ensureProject(req.user.id, projectNames[i]);
    }

    await db.transaction(async function(trx) {
      var chunkSize = 100;
      for (var i = 0; i < rows.length; i += chunkSize) {
        await trx('tasks').insert(rows.slice(i, i + chunkSize));
      }
    });

    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:batchCreateTasks');
    res.status(201).json({ created: rows.length });
  } catch (error) {
    console.error('Batch create error:', error);
    res.status(500).json({ error: 'Failed to batch create tasks' });
  }
}

/**
 * PUT /api/tasks/batch — batch update tasks
 */
async function batchUpdateTasks(req, res) {
  try {
    var updates = req.body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Updates array required' });
    }
    if (updates.length > 2000) {
      return res.status(400).json({ error: 'Batch limited to 2000 items' });
    }

    var tz = safeTimezone(req.headers['x-timezone']);
    var updatedCount = 0;
    var MAX_RETRIES = 3;

    // Template fields use the module-level TEMPLATE_FIELDS array (single source of truth)

    for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        updatedCount = 0;
        await db.transaction(async function(trx) {
          // Pre-load task_type and source_id for all IDs being updated
          var idsToUpdate = updates.map(function(u) { return u.id; }).filter(Boolean);
          var existingRows = await trx('tasks')
            .where('user_id', req.user.id)
            .whereIn('id', idsToUpdate)
            .select('id', 'task_type', 'source_id', 'scheduled_at', 'status');
          var existingById = {};
          existingRows.forEach(function(r) { existingById[r.id] = r; });

          for (var i = 0; i < updates.length; i++) {
            var update = updates[i];
            var id = update.id;
            if (!id) continue;

            var fields = {};
            Object.keys(update).forEach(function(k) { if (k !== 'id') fields[k] = update[k]; });
            // Per-update timezone override: frontend can specify which timezone
            // the date/time values are expressed in (e.g., active timezone from browser)
            var updateTz = fields._timezone || tz;
            delete fields._timezone;
            var row = taskToRow(fields, req.user.id, updateTz);
            delete row.user_id;
            delete row.created_at;

            var existing = existingById[id];

            // Skip disabled items — they cannot be modified
            if (existing && existing.status === 'disabled') continue;

            // Time-only update: combine new time with existing date
            if (row._pendingTimeOnly && existing && existing.scheduled_at) {
              var existingDt = new Date(existing.scheduled_at);
              var existingLocal = utcToLocal(existingDt, updateTz);
              if (existingLocal) {
                var existingDate = existingLocal.date; // e.g. "3/12"
                row.scheduled_at = localToUtc(existingDate, row._pendingTimeOnly, updateTz) || null;
                if (row.desired_at === undefined) row.desired_at = row.scheduled_at;
              }
            }
            delete row._pendingTimeOnly;

            // Date-only update: combine new date with existing time
            // When only date was sent (no time field in the update), scheduled_at
            // would default to midnight. Preserve the existing time instead.
            if (row.scheduled_at && existing && existing.scheduled_at
                && update.date !== undefined && update.time === undefined) {
              var existLocal = utcToLocal(existing.scheduled_at, updateTz);
              if (existLocal && existLocal.time) {
                var newDate = update.date;
                row.scheduled_at = localToUtc(newDate, existLocal.time, updateTz) || row.scheduled_at;
                if (row.desired_at === undefined) row.desired_at = row.scheduled_at;
              }
            }

            // Recurrings cannot have dependencies — strip if provided
            if (existing && (existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance')) {
              delete row.depends_on;
            }

            var taskType = existing ? (existing.task_type || 'task') : 'task';

            // Never set status on a recurring task template — status belongs on instances only
            if (taskType === 'recurring_template' && row.status !== undefined) {
              delete row.status;
            }

            if (taskType === 'recurring_instance' && existing && existing.source_id) {
              // Route template fields to source, instance fields to this row
              console.log('[BATCH] routing instance ' + id + ' → template ' + existing.source_id + ', row keys:', Object.keys(row).join(','));
              var templateUpdate = {};
              var instanceUpdate = {};
              Object.keys(row).forEach(function(k) {
                if (k === 'updated_at') return;
                if (TEMPLATE_FIELDS.indexOf(k) >= 0) {
                  templateUpdate[k] = row[k];
                } else {
                  instanceUpdate[k] = row[k];
                }
              });
              if (Object.keys(templateUpdate).length > 0) {
                console.log('[BATCH] template update:', JSON.stringify(templateUpdate));
                templateUpdate.updated_at = db.fn.now();
                await trx('tasks')
                  .where({ id: existing.source_id, user_id: req.user.id })
                  .update(templateUpdate);
              }
              if (Object.keys(instanceUpdate).length > 0) {
                instanceUpdate.updated_at = db.fn.now();
                await trx('tasks').where({ id: id, user_id: req.user.id }).update(instanceUpdate);
              } else {
                await trx('tasks').where({ id: id, user_id: req.user.id }).update({ updated_at: db.fn.now() });
              }
            } else {
              await trx('tasks').where({ id: id, user_id: req.user.id }).update(row);
            }
            updatedCount++;
          }
        });
        break;
      } catch (err) {
        if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
          console.log('[BATCH] deadlock, retry ' + (attempt + 1) + '/' + MAX_RETRIES);
          await new Promise(function(r) { setTimeout(r, 200 * (attempt + 1)); });
          continue;
        }
        throw err;
      }
    }

    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:batchUpdateTasks');
    res.json({ updated: updatedCount });
  } catch (error) {
    console.error('Batch update error:', error);
    res.status(500).json({ error: 'Failed to batch update tasks' });
  }
}

/**
 * GET /api/tasks/disabled — list all disabled items for the user
 */
async function getDisabledTasks(req, res) {
  try {
    var rows = await db('tasks')
      .where({ user_id: req.user.id, status: 'disabled' })
      .orderBy('disabled_at', 'desc');
    var srcMap = buildSourceMap(
      await db('tasks').where({ user_id: req.user.id, task_type: 'recurring_template' }).select()
    );
    var tasks = rows.map(function(r) { return rowToTask(r, null, srcMap); });
    res.json({ tasks: tasks });
  } catch (error) {
    console.error('Get disabled tasks error:', error);
    res.status(500).json({ error: 'Failed to get disabled tasks' });
  }
}

/**
 * PUT /api/tasks/:id/re-enable — re-enable a disabled task
 * Checks entity limits before allowing re-enable.
 */
async function reEnableTask(req, res) {
  try {
    var id = req.params.id;
    var existing = await db('tasks').where({ id: id, user_id: req.user.id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (existing.status !== 'disabled') {
      return res.status(400).json({ error: 'Task is not disabled' });
    }

    // Check entity limits before re-enabling
    var { countActiveTasks, countRecurringTemplates } = require('../middleware/entity-limits');
    var isRecurringTemplate = existing.task_type === 'recurring_template';
    var limitKey = isRecurringTemplate ? 'limits.recurring_templates' : 'limits.active_tasks';

    if (req.planFeatures) {
      var limit = limitKey.split('.').reduce(function(o, k) { return o && o[k]; }, req.planFeatures);
      if (limit !== -1 && limit !== undefined && limit !== null) {
        var currentCount = isRecurringTemplate
          ? await countRecurringTemplates(req.user.id)
          : await countActiveTasks(req.user.id);

        // For recurring templates, also count how many instances will be re-enabled
        var instanceCount = 0;
        if (isRecurringTemplate) {
          var disabledInstances = await db('tasks')
            .where({ source_id: id, user_id: req.user.id, status: 'disabled' })
            .count('* as count').first();
          instanceCount = parseInt(disabledInstances.count, 10);
        }

        // Recurring templates check against recurring limit; instances check against task limit
        if (currentCount + 1 > limit) {
          return res.status(403).json({
            error: "You've reached the limit for your plan",
            code: 'ENTITY_LIMIT_REACHED',
            limit_key: limitKey,
            current_count: currentCount,
            limit: limit,
            current_plan: req.planId || 'free',
            upgrade_required: true
          });
        }

        // If re-enabling a recurring task template, also check task limit for its instances
        if (isRecurringTemplate && instanceCount > 0) {
          var taskLimit = 'limits.active_tasks'.split('.').reduce(function(o, k) { return o && o[k]; }, req.planFeatures);
          if (taskLimit !== -1 && taskLimit !== undefined && taskLimit !== null) {
            var currentTasks = await countActiveTasks(req.user.id);
            if (currentTasks + instanceCount > taskLimit) {
              return res.status(403).json({
                error: "Re-enabling this recurring task would exceed your active task limit",
                code: 'ENTITY_LIMIT_REACHED',
                limit_key: 'limits.active_tasks',
                current_count: currentTasks,
                limit: taskLimit,
                attempting_to_add: instanceCount,
                current_plan: req.planId || 'free',
                upgrade_required: true
              });
            }
          }
        }
      }
    }

    await db.transaction(async function(trx) {
      // Re-enable the task/template itself
      await trx('tasks').where({ id: id, user_id: req.user.id }).update({
        status: '',
        disabled_at: null,
        disabled_reason: null,
        updated_at: db.fn.now()
      });

      // If re-enabling a recurring task template, also re-enable its disabled instances
      if (isRecurringTemplate) {
        await trx('tasks')
          .where({ source_id: id, user_id: req.user.id, status: 'disabled' })
          .update({
            status: '',
            disabled_at: null,
            disabled_reason: null,
            updated_at: db.fn.now()
          });
      }
    });

    var srcMap = buildSourceMap(
      await db('tasks').where({ user_id: req.user.id, task_type: 'recurring_template' }).select()
    );
    var updated = await db('tasks').where('id', id).first();
    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:reEnableTask');
    res.json({ task: rowToTask(updated, null, srcMap) });
  } catch (error) {
    console.error('Re-enable task error:', error);
    res.status(500).json({ error: 'Failed to re-enable task' });
  }
}

/**
 * PUT /api/tasks/:id/unpin — Unpin a drag-pinned task
 *
 * For regular tasks: restores prev_when, clears date_pinned.
 * For recurring instances: deletes the instance so the scheduler regenerates it.
 */
async function unpinTask(req, res) {
  try {
    var existing = await db('tasks')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!existing) return res.status(404).json({ error: 'Task not found' });

    var taskType = existing.task_type || 'task';

    if (taskType === 'recurring_instance' && existing.source_id) {
      // Recurring instance: delete it so the scheduler regenerates from template
      await db('tasks')
        .where({ id: req.params.id, user_id: req.user.id })
        .del();

      enqueueScheduleRun(req.user.id, 'api:unpinTask:delete');
      return res.json({ success: true, action: 'deleted', message: 'Instance deleted — scheduler will regenerate from template' });
    }

    // Regular task: restore previous scheduling mode
    var updates = {
      when: existing.prev_when || '',
      prev_when: null,
      date_pinned: 0,
      updated_at: db.fn.now()
    };

    await db('tasks')
      .where({ id: req.params.id, user_id: req.user.id })
      .update(updates);

    enqueueScheduleRun(req.user.id, 'api:unpinTask');
    res.json({ success: true, action: 'unpinned', when: updates.when });
  } catch (error) {
    console.error('Unpin error:', error);
    res.status(500).json({ error: 'Failed to unpin task' });
  }
}

module.exports = {
  getAllTasks,
  getVersion,
  createTask,
  updateTask,
  deleteTask,
  updateTaskStatus,
  batchCreateTasks,
  batchUpdateTasks,
  getDisabledTasks,
  reEnableTask,
  unpinTask,
  rowToTask,
  taskToRow,
  buildSourceMap,
  ensureProject,
  applySplitDefault,
  TEMPLATE_FIELDS
};
