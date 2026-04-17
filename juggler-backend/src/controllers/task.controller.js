/**
 * Task Controller — CRUD operations for tasks
 *
 * The DB stores scheduled_at (DATETIME, UTC) as the single source of truth.
 *
 * API accepts BOTH formats:
 *   - UTC ISO: scheduledAt ("2026-03-08T22:45:00Z"), deadline (YYYY-MM-DD), startAfterAt
 *   - Local strings: date ("3/8") + time ("6:45 PM") — converted server-side
 *   UTC takes precedence if both are provided.
 *
 * API always returns both: scheduledAt (UTC ISO) + date/time/day (local derived).
 */

const db = require('../db');
const { v7: uuidv7 } = require('uuid');
const { localToUtc, utcToLocal, toDateISO, fromDateISO, getDayName, safeTimezone } = require('../scheduler/dateHelpers');
const cache = require('../lib/redis');
const { enqueueScheduleRun: _enqueueScheduleRun } = require('../scheduler/scheduleQueue');
const sseEmitter = require('../lib/sse-emitter');
const { isLocked, enqueueWrite, splitFields, flushQueue } = require('../lib/task-write-queue');
const tasksWrite = require('../lib/tasks-write');
// Wrap enqueueScheduleRun to also emit SSE event so frontends refresh
// immediately. `ids` (optional) is the list of task ids the caller just
// wrote — when present, the frontend can upsert only those rows instead of
// refetching the full task list.
function enqueueScheduleRun(userId, source, ids) {
  var payload = { source: source, timestamp: Date.now() };
  if (Array.isArray(ids) && ids.length > 0) payload.ids = ids;
  sseEmitter.emit(userId, 'tasks:changed', payload);
  // Defer the scheduler enqueue (DB insert) off the save hot path. The
  // scheduler already debounces 2s after the last enqueue, so delaying this
  // by 2s just shifts the quiet-period start — it doesn't starve the user.
  // Keeps the save's pool connection uncontested by queue inserts.
  setTimeout(function() { _enqueueScheduleRun(userId, source); }, 2000);
}

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
  'notes', 'marker', 'flex_when', 'recur', 'recur_start', 'recur_end',
  'preferred_time_mins'];

/**
 * Build a { sourceId: row } lookup from an array of task rows.
 * Includes both recurring_template rows AND legacy rows that act as
 * recurring sources (task_type='task' with recurring=1), so instances
 * generated against a legacy source still inherit text/fields.
 */
/**
 * Fast single-row task lookup with calendar event ids attached.
 *
 * Bypasses the `tasks_with_sync_v` view, which is unusable for single-row
 * lookups: its 3 LEFT JOIN subqueries do GROUP BY task_id over the user's
 * full ledger every call (~3s on a user with ~2000 ledger rows). For full-
 * list scans the view is fine; for hot-path single-row reads it's a disaster.
 *
 * Strategy: read tasks_v (cheap, ~50ms) + at most one ledger lookup (filtered
 * by task_id index, ≤3 rows). Combine in JS. Total ~100ms vs ~3000ms.
 *
 * Used by updateTask, getTask, deleteTask. Returns null if not found.
 */
async function fetchTaskWithEventIds(dbOrTrx, id, userId) {
  var [row, ledgerRows] = await Promise.all([
    dbOrTrx('tasks_v').where({ id: id, user_id: userId }).first(),
    dbOrTrx('cal_sync_ledger')
      .where({ task_id: id, status: 'active' })
      .select('provider', 'provider_event_id')
  ]);
  if (!row) return null;
  // Attach event ids in the same shape tasks_with_sync_v exposes.
  row.gcal_event_id = null;
  row.msft_event_id = null;
  row.apple_event_id = null;
  for (var i = 0; i < ledgerRows.length; i++) {
    var p = ledgerRows[i].provider;
    if (p === 'gcal') row.gcal_event_id = ledgerRows[i].provider_event_id;
    else if (p === 'msft') row.msft_event_id = ledgerRows[i].provider_event_id;
    else if (p === 'apple') row.apple_event_id = ledgerRows[i].provider_event_id;
  }
  return row;
}

/**
 * Bulk equivalent of fetchTaskWithEventIds — read tasks_v for the user and
 * attach gcal/msft/apple event ids from one ledger query. Avoids the view
 * `tasks_with_sync_v`, whose 3 LEFT JOIN GROUP BY subqueries take ~3s even
 * for users with zero ledger rows. Returns rows in the shape rowToTask
 * expects. `queryBuilder` lets callers add .where/.orderBy to the tasks_v
 * read before it runs.
 */
async function fetchTasksWithEventIds(dbOrTrx, userId, queryBuilder) {
  var q = dbOrTrx('tasks_v').where('user_id', userId);
  if (typeof queryBuilder === 'function') queryBuilder(q);
  var [rows, ledgerRows] = await Promise.all([
    q,
    dbOrTrx('cal_sync_ledger')
      .where({ user_id: userId, status: 'active' })
      .select('task_id', 'provider', 'provider_event_id')
  ]);
  var byTask = {};
  for (var j = 0; j < ledgerRows.length; j++) {
    var lr = ledgerRows[j];
    if (!lr.task_id) continue;
    var slot = byTask[lr.task_id] || (byTask[lr.task_id] = {});
    if (lr.provider === 'gcal') slot.gcal_event_id = lr.provider_event_id;
    else if (lr.provider === 'msft') slot.msft_event_id = lr.provider_event_id;
    else if (lr.provider === 'apple') slot.apple_event_id = lr.provider_event_id;
  }
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var ev = byTask[r.id];
    r.gcal_event_id = ev && ev.gcal_event_id || null;
    r.msft_event_id = ev && ev.msft_event_id || null;
    r.apple_event_id = ev && ev.apple_event_id || null;
  }
  return rows;
}

function buildSourceMap(rows) {
  var map = {};
  rows.forEach(function(r) {
    if (r.task_type === 'recurring_template') {
      map[r.id] = r;
    } else if (r.recurring && r.task_type !== 'recurring_instance') {
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
    // Exception: for split chunks (split_total > 1), the instance's per-chunk
    // `dur` is the truth — each chunk is only part of the master's total dur.
    var isSplitChunk = Number(row.split_total) > 1;
    var merged = {};
    Object.keys(row).forEach(function(k) { merged[k] = row[k]; });
    TEMPLATE_FIELDS.forEach(function(f) {
      if (f === 'dur' && isSplitChunk) return; // keep the chunk's own dur
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
  var startAfter = null;

  // Derive date/time/day from scheduled_at (UTC source of truth).
  // When timezone is null (API responses), skip derivation — the frontend
  // hydrates local fields from scheduledAt using the browser timezone.
  // When timezone is provided (scheduler), derive for internal use — but
  // only for user-anchored tasks. For flexible tasks, the prior scheduled_at
  // is a scheduler auto-placement that must not bias the next run (mirrors
  // the isUserAnchored check in unifiedSchedule.js).
  // Booleans from tasks_with_sync_v come back as strings like '0'/'1' in some code
  // paths, so use a helper that treats only real truthy values as true.
  function boolish(v) { return v === true || v === 1 || v === '1'; }
  var whenStr = typeof row.when === 'string' ? row.when : '';
  var whenParts = whenStr ? whenStr.split(',').map(function(s) { return s.trim(); }) : [];
  var isUserAnchored = boolish(row.date_pinned) || boolish(row.generated) ||
    boolish(row.recurring) || whenParts.indexOf('fixed') !== -1 || boolish(row.marker);
  var displayTz = timezone || null;
  if (displayTz && row.scheduled_at && isUserAnchored) {
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

  // Derive deadline (ISO YYYY-MM-DD) from the DATE column.
  var deadlineISO = null;
  if (row.deadline) {
    deadlineISO = row.deadline instanceof Date
      ? row.deadline.toISOString().split('T')[0]
      : String(row.deadline).split('T')[0];
  }
  // Derive startAfter from start_after_at DATE column
  if (row.start_after_at) {
    startAfter = fromDateISO(row.start_after_at instanceof Date
      ? row.start_after_at.toISOString().split('T')[0]
      : String(row.start_after_at).split('T')[0]);
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
    deadline: deadlineISO,
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
    appleEventId: row.apple_event_id,
    dependsOn: safeParseJSON(row.depends_on, []),
    datePinned: !!row.date_pinned,
    prevWhen: row.prev_when || null,
    marker: !!row.marker,
    flexWhen: !!row.flex_when,
    travelBefore: row.travel_before != null ? row.travel_before : undefined,
    travelAfter: row.travel_after != null ? row.travel_after : undefined,
    preferredTimeMins: row.preferred_time_mins != null ? row.preferred_time_mins : null,
    desiredAt: row.desired_at ? new Date(row.desired_at).toISOString() : null,
    desiredDate: row.desired_date || null,
    unscheduled: !!row.unscheduled,
    recurStart: row.recur_start || null,
    recurEnd: row.recur_end || null,
    disabledAt: row.disabled_at ? scheduledAtToISO(row.disabled_at) : null,
    disabledReason: row.disabled_reason || null,
    // Ordinals from task_instances. Undefined for template rows (which don't
    // have an instance record). Frontend uses these to group split chunks
    // by (masterId/sourceId, occurrenceOrdinal) and render "chunk N of M".
    occurrenceOrdinal: row.occurrence_ordinal != null ? Number(row.occurrence_ordinal) : undefined,
    splitOrdinal: row.split_ordinal != null ? Number(row.split_ordinal) : undefined,
    splitTotal: row.split_total != null ? Number(row.split_total) : undefined,
    splitGroup: row.split_group || null,
    // Anchor date (date-only, YYYY-MM-DD): for instances, from the template; for templates, from self
    anchorDate: (function() {
      var sa = src ? src.scheduled_at : row.scheduled_at;
      if (!sa) return null;
      var iso = scheduledAtToISO(sa);
      return iso ? iso.slice(0, 10) : null;
    })()
  };
}

/**
 * Map API task to DB row.
 * Converts date+time → scheduled_at (UTC) and deadline/startAfter → deadline/start_after_at.
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
  if (task.deadline !== undefined) {
    row.deadline = task.deadline ? toDateISO(task.deadline) || task.deadline : null;
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


  row.updated_at = db.fn.now();
  return row;
}

// A calendar-synced timed event is inherently pinned to the calendar's time.
// Stripping `fixed` from such a row makes the scheduler treat it as movable
// while the external calendar still owns the time — a contradiction that
// manifests as the scheduler "moving" fixed meetings. Require an explicit
// _allowUnfix opt-in to remove `fixed` from a calendar-linked task. The
// guardTarget arg is the row whose `when` column will actually be written
// (the task itself for normal updates, the source template for recurring
// instance edits since TEMPLATE_FIELDS routes `when` there).
function guardFixedCalendarWhen(row, guardTarget, opts) {
  if (!guardTarget) return;
  if (row.when === undefined) return;
  if (opts && opts.allowUnfix) return;
  var wasFixed = guardTarget.when && String(guardTarget.when).indexOf('fixed') >= 0;
  if (!wasFixed) return;
  var isCalLinked = !!(guardTarget.gcal_event_id || guardTarget.msft_event_id);
  if (!isCalLinked) return;
  var willBeFixed = typeof row.when === 'string' && row.when.indexOf('fixed') >= 0;
  if (willBeFixed) return;
  console.log('[TASK-GUARD] preserving fixed tag on calendar-linked task ' + guardTarget.id +
    ' (incoming when=' + JSON.stringify(row.when) + ')');
  delete row.when;
}

/**
 * Compute a version string from the most recent updated_at across all tasks.
 * Used for change-detection polling so the frontend knows when to reload.
 */
async function getTasksVersion(userId) {
  var row = await db('tasks_v')
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

    var query = db('tasks_v').where('user_id', req.user.id).orderBy('created_at', 'asc');
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
 * GET /api/tasks/:id — single task detail with full data (anchorDate, recur, notes, etc.)
 */
async function getTask(req, res) {
  try {
    var id = req.params.id;
    // Fast-path single-row lookup with event ids attached, plus the recurring
    // templates needed for srcMap. fetchTaskWithEventIds bypasses the heavy
    // tasks_with_sync_v view (GROUP BY scan over full ledger).
    var [row, templateRows] = await Promise.all([
      fetchTaskWithEventIds(db, id, req.user.id),
      db('tasks_v').where('user_id', req.user.id)
        .where(function() { this.where('task_type', 'recurring_template').orWhere('recurring', 1); })
        .select()
    ]);
    if (!row) return res.status(404).json({ error: 'Task not found' });
    var srcMap = buildSourceMap(templateRows);
    res.json({ task: rowToTask(row, null, srcMap) });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
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
  // dur validation
  if (body.dur !== undefined && body.dur !== null) {
    var durVal = Number(body.dur);
    if (isNaN(durVal) || durVal <= 0) errors.push('Duration must be greater than 0');
  }
  // split validation
  if (body.split && body.splitMin !== undefined) {
    var smVal = Number(body.splitMin);
    if (isNaN(smVal) || smVal <= 0) errors.push('Split minimum must be greater than 0');
    if (body.dur && smVal > Number(body.dur)) errors.push('Split minimum must be less than or equal to duration');
  }
  // timeFlex validation
  if (body.timeFlex !== undefined && body.timeFlex !== null) {
    var tfVal = Number(body.timeFlex);
    if (isNaN(tfVal) || tfVal < 0 || tfVal > 480) errors.push('Time flex must be between 0 and 480 minutes');
  }
  // deadline validation
  if (body.deadline !== undefined && body.deadline !== null && body.deadline !== '') {
    var dlDate = new Date(body.deadline);
    if (isNaN(dlDate.getTime())) errors.push('Deadline must be a valid date');
  }
  // startAfter validation
  if (body.startAfter !== undefined && body.startAfter !== null && body.startAfter !== '') {
    var saDate = new Date(body.startAfter);
    if (isNaN(saDate.getTime())) errors.push('Start-after must be a valid date');
  }
  // cross-field: deadline >= startAfter
  if (body.deadline && body.startAfter) {
    var dlD = new Date(body.deadline);
    var saD = new Date(body.startAfter);
    if (!isNaN(dlD.getTime()) && !isNaN(saD.getTime()) && dlD < saD) errors.push('Deadline must be on or after start-after date');
  }
  // recur config validation
  if (body.recur && typeof body.recur === 'object') {
    var validRecurTypes = ['daily', 'weekly', 'biweekly', 'monthly', 'interval', 'none'];
    var rType = (body.recur.type || '').toLowerCase();
    if (rType && validRecurTypes.indexOf(rType) === -1) errors.push('Invalid recurrence type: ' + rType);
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

    // Lock check: if scheduling lock is held, queue the create
    var locked = await isLocked(req.user.id);
    if (locked) {
      row.user_id = req.user.id;
      await enqueueWrite(req.user.id, row.id, 'create', row, 'api:createTask');
      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:createTask', [row.id]);
      return res.status(201).json({ task: rowToTask(row, null), queued: true });
    }

    await tasksWrite.insertTask(db, row);
    var created = await fetchTaskWithEventIds(db, row.id, req.user.id);
    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:createTask', [row.id]);
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

    // ── Fast direct-write path ───────────────────────────────────────
    // Common edits (text, pri, dur, project, notes, status, scheduled_at,
    // single-task date+time changes) don't need any of the heavy machinery
    // below — recurrence cleanup, calendar-fixed guard, drag-pin/anchor-date
    // routing. For those, bypass the multi-step transactional path and do:
    //   - 1 fast existing fetch (parallel with project-ensure if applicable)
    //   - 1 direct write via tasksWrite.updateTaskById (master+instance)
    //   - optimistic response from existing+changes (skip re-read)
    // ~3 round-trips wall-clock instead of 7-12, no view scans.
    var needsComplexPath = req.body.recur !== undefined
      || req.body.recurStart !== undefined
      || req.body.recurEnd !== undefined
      || req.body.when !== undefined
      || req.body._dragPin
      || req.body.anchorDate
      || req.body._allowUnfix
      // time without date requires existing.scheduled_at to combine
      || (req.body.time !== undefined && req.body.date === undefined && req.body.scheduledAt === undefined);

    if (!needsComplexPath) {
      var fastTz = safeTimezone(req.headers['x-timezone']);
      var fastBody = Object.assign({}, req.body);
      delete fastBody.anchorDate;
      var fastRow = taskToRow(fastBody, req.user.id, fastTz);
      delete fastRow.id;
      delete fastRow.user_id;
      delete fastRow.created_at;
      delete fastRow._pendingTimeOnly;
      if ((req.body.date !== undefined || req.body.scheduledAt !== undefined)
          && fastRow.date_pinned === undefined) {
        fastRow.date_pinned = 1;
      }
      fastRow.updated_at = db.fn.now();

      // Fetch existing in parallel with project-ensure (if needed)
      var fastExistingPromise = fetchTaskWithEventIds(db, id, req.user.id);
      var fastEnsureProject = req.body.project
        ? ensureProject(req.user.id, req.body.project)
        : Promise.resolve();
      var [fastExisting] = await Promise.all([fastExistingPromise, fastEnsureProject]);

      if (!fastExisting) {
        return res.status(404).json({ error: 'Task not found' });
      }
      if (fastExisting.status === 'disabled') {
        return res.status(403).json({
          error: 'This item is disabled. Re-enable it before making changes.',
          code: 'TASK_DISABLED'
        });
      }

      // Recurrings cannot have dependencies — strip if provided
      if (fastExisting.recurring || fastExisting.task_type === 'recurring_template'
          || fastExisting.task_type === 'recurring_instance') {
        delete fastRow.depends_on;
      }

      // Direct write: master + instance fields routed by the helper.
      // For recurring_instance, route template fields to the source master.
      if (fastExisting.task_type === 'recurring_instance' && fastExisting.source_id) {
        var fastTplUpdate = {};
        var fastInstUpdate = {};
        Object.keys(fastRow).forEach(function(k) {
          if (k === 'updated_at') return;
          if (TEMPLATE_FIELDS.indexOf(k) >= 0) fastTplUpdate[k] = fastRow[k];
          else fastInstUpdate[k] = fastRow[k];
        });
        if (Object.keys(fastTplUpdate).length > 0) {
          fastTplUpdate.updated_at = db.fn.now();
          await tasksWrite.updateTaskById(db, fastExisting.source_id, fastTplUpdate, req.user.id);
        }
        if (Object.keys(fastInstUpdate).length > 0) {
          fastInstUpdate.updated_at = db.fn.now();
          await tasksWrite.updateTaskById(db, id, fastInstUpdate, req.user.id);
        } else {
          await tasksWrite.updateTaskById(db, id, { updated_at: db.fn.now() }, req.user.id);
        }
      } else {
        await tasksWrite.updateTaskById(db, id, fastRow, req.user.id);
      }

      // Fire-and-forget: cache invalidate + scheduler run.
      cache.invalidateTasks(req.user.id).catch(function(e) { console.error('[cache]', e.message); });
      enqueueScheduleRun(req.user.id, 'api:updateTask', [id]);

      // Optimistic response: merge the submitted changes into the existing
      // row shape. Skips the slow response re-read entirely.
      var optimistic = Object.assign({}, fastExisting, fastRow);
      optimistic.id = id;
      optimistic.user_id = req.user.id;
      optimistic.updated_at = new Date();
      return res.json({ task: rowToTask(optimistic, null) });
    }

    // ── Complex path: existing slow logic for recur/when/drag-pin/etc. ──
    var existing = await fetchTaskWithEventIds(db, id, req.user.id);
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
    var anchorDateVal = req.body.anchorDate;
    var bodyWithoutAnchor = Object.assign({}, req.body);
    delete bodyWithoutAnchor.anchorDate;
    var row = taskToRow(bodyWithoutAnchor, req.user.id, tz);
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

    // Guard: don't let calendar-linked fixed tasks silently lose their 'fixed'
    // tag. For recurring instances, `when` is routed to the source template,
    // so check the template's calendar linkage.
    if (row.when !== undefined && !req.body._dragPin) {
      var _guardOpts = { allowUnfix: !!req.body._allowUnfix };
      if ((existing.task_type || 'task') === 'recurring_instance' && existing.source_id) {
        var _srcTmpl = await fetchTaskWithEventIds(db, existing.source_id, req.user.id);
        guardFixedCalendarWhen(row, _srcTmpl, _guardOpts);
      } else {
        guardFixedCalendarWhen(row, existing, _guardOpts);
      }
    }

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

    // Lock check: if scheduling lock is held, split and queue scheduling fields
    var locked = await isLocked(req.user.id);
    if (locked) {
      var { schedulingFields, nonSchedulingFields } = splitFields(row);
      // Write non-scheduling fields directly (safe during scheduler/cal-sync)
      if (Object.keys(nonSchedulingFields).length > 0) {
        nonSchedulingFields.updated_at = db.fn.now();
        await tasksWrite.updateTaskById(db, id, nonSchedulingFields, req.user.id);
      }
      // Queue scheduling fields for flush
      if (Object.keys(schedulingFields).length > 0) {
        await enqueueWrite(req.user.id, id, 'update', schedulingFields, 'api:updateTask');
      }
      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:updateTask', [id]);
      // Narrow re-read: updated row (cheap path that bypasses tasks_with_sync_v)
      // + just recurring templates for srcMap.
      var [currentRow, templateRows2] = await Promise.all([
        fetchTaskWithEventIds(db, id, req.user.id),
        db('tasks_v').where('user_id', req.user.id)
          .where(function() { this.where('task_type', 'recurring_template').orWhere('recurring', 1); })
          .select()
      ]);
      var srcMap2 = buildSourceMap(templateRows2);
      return res.json({ task: rowToTask(currentRow, null, srcMap2), queued: true });
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

        // Route explicit anchor date to template's scheduled_at
        if (anchorDateVal) {
          templateUpdate.scheduled_at = localToUtc(anchorDateVal, null, tz) || null;
          templateUpdate.desired_at = templateUpdate.scheduled_at;
        }

        // Update the source template with template fields
        if (Object.keys(templateUpdate).length > 0) {
          templateUpdate.updated_at = db.fn.now();
          await tasksWrite.updateTaskById(trx, existing.source_id, templateUpdate, req.user.id);
        }

        // If recurrence changed via instance edit, clean up pending instances on the template.
        // Always do a full reset since we can't reliably compare old vs new recur here.
        if (templateUpdate.recur !== undefined) {
          var resetCount2 = await tasksWrite.deleteInstancesWhere(trx, req.user.id, function(q) {
            return q.where({ master_id: existing.source_id, status: '' });
          });
          if (resetCount2 > 0) {
            console.log('[RECUR] cycle reset via instance edit: deleted ' + resetCount2 + ' pending instances for template ' + existing.source_id);
          }
        }

        // Update instance-specific fields on this row
        if (Object.keys(instanceUpdate).length > 0) {
          instanceUpdate.updated_at = db.fn.now();
          await tasksWrite.updateTaskById(trx, id, instanceUpdate, req.user.id);
        } else {
          // Still touch updated_at so version changes
          await tasksWrite.updateTaskById(trx, id, { updated_at: db.fn.now() }, req.user.id);
        }
      } else if (taskType === 'recurring_template') {
        // Editing the template directly — just update the template row.
        // Instances always inherit template fields via rowToTask.
        await tasksWrite.updateTaskById(trx, id, row, req.user.id);

        // If recurrence or recurring date range changed, clean up pending instances
        // that no longer match the new pattern.
        var needsCleanup = row.recur !== undefined || row.recur_start !== undefined || row.recur_end !== undefined;
        if (needsCleanup) {
          var _dateHelpers = require('../scheduler/dateHelpers');
          var updatedTmpl = await trx('tasks_v').where({ id: id, user_id: req.user.id }).first();
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
            var resetCount = await tasksWrite.deleteInstancesWhere(trx, req.user.id, function(q) {
              return q.where({ master_id: id, status: '' });
            });
            if (resetCount > 0) {
              console.log('[RECUR] cycle reset: deleted ' + resetCount + ' pending instances after recurrence change on ' + id);
            }
          } else {
            // Incremental cleanup: only delete instances that no longer match
            var _dateMatch = require('../../shared/scheduler/dateMatchesRecurrence');
            var srcDateStr = updatedTmpl.scheduled_at ? utcToLocal(updatedTmpl.scheduled_at, tz).date : null;

            var pendingInstances = await trx('tasks_v')
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
              await tasksWrite.deleteTasksWhere(trx, req.user.id, function(q) {
                return q.whereIn('id', deleteIds);
              });
              console.log('[RECUR] cleaned up ' + deleteIds.length + ' pending instances after date-range change on ' + id);
            }
          }
        }
      } else {
        // Normal (non-recurring) task — update directly
        await tasksWrite.updateTaskById(trx, id, row, req.user.id);
      }
    });

    // Narrow re-read for the response: updated row via the fast helper
    // (bypasses the broken tasks_with_sync_v GROUP BY scan) + just recurring
    // templates for srcMap. Both run in parallel.
    var [updatedRow, templateRows] = await Promise.all([
      fetchTaskWithEventIds(db, id, req.user.id),
      db('tasks_v').where('user_id', req.user.id)
        .where(function() { this.where('task_type', 'recurring_template').orWhere('recurring', 1); })
        .select()
    ]);
    var srcMap = buildSourceMap(templateRows);
    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:updateTask', [id]);
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
    var task = await fetchTaskWithEventIds(db, id, req.user.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // In ingest-only mode, prevent deletion of calendar-linked tasks
    if (task.gcal_event_id || task.msft_event_id) {
      var _csRow = await db('user_config')
        .where({ user_id: req.user.id, config_key: 'cal_sync_settings' }).first();
      var _csSettings = _csRow
        ? (typeof _csRow.config_value === 'string' ? JSON.parse(_csRow.config_value) : _csRow.config_value)
        : {};
      var _isIngest = (task.gcal_event_id && _csSettings.gcal && _csSettings.gcal.mode === 'ingest')
                   || (task.msft_event_id && _csSettings.msft && _csSettings.msft.mode === 'ingest');
      if (_isIngest) {
        return res.status(403).json({
          error: 'Calendar-linked tasks cannot be deleted in ingest-only mode. Delete the event from your calendar instead.',
          code: 'INGEST_DELETE_BLOCKED'
        });
      }
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
      var pendingIds = [];
      var keptIds = [];

      await db.transaction(async function(trx) {
        // Find all instances of this recurring task
        var instances = await trx('tasks_with_sync_v')
          .where({ user_id: req.user.id, source_id: templateId })
          .select('id', 'status', 'gcal_event_id', 'msft_event_id');

        // Delete pending instances (no status = never acted on)
        pendingIds = instances
          .filter(function(inst) {
            var st = inst.status || '';
            return st !== 'done' && st !== 'cancel' && st !== 'skip';
          })
          .map(function(inst) { return inst.id; });

        // Clean up calendar sync for pending instances
        if (pendingIds.length > 0) {
          // status='deleted_local' tells the next cal-sync pull "user removed this;
          // do NOT re-ingest the calendar event as a new task". Just nulling task_id
          // would leave status='active', and the sync would treat the event as
          // unlinked and create a fresh task.
          await trx('cal_sync_ledger')
            .where('user_id', req.user.id)
            .whereIn('task_id', pendingIds)
            .where('status', 'active')
            .update({ status: 'deleted_local', task_id: null, provider_event_id: null, synced_at: db.fn.now() })
            .catch(function(err) { console.error("[silent-catch]", err.message); });

          await tasksWrite.deleteTasksWhere(trx, req.user.id, function(q) {
            return q.whereIn('id', pendingIds);
          });
          deletedCount = pendingIds.length;
        }

        // Completed instances (done/cancel/skip) are preserved as history.
        // Re-parent them to the user's archival master BEFORE deleting the
        // template — without this, the FK's ON DELETE SET NULL would orphan
        // them with master_id=NULL, leaving them with NULL text/pri/etc in
        // the view (poor UX). The archival master gives them stable display
        // fields ([Archived] / P4) until the user trashes them explicitly.
        keptIds = instances
          .filter(function(inst) {
            var st = inst.status || '';
            return st === 'done' || st === 'cancel' || st === 'skip';
          })
          .map(function(inst) { return inst.id; });
        if (keptIds.length > 0) {
          await tasksWrite.archiveInstances(trx, req.user.id, keptIds);
        }
        keptCount = keptIds.length;

        // Delete the template itself
        // Clean up calendar sync for template
        var template = await trx('tasks_with_sync_v').where({ id: templateId, user_id: req.user.id }).first();
        if (template) {
          if (template.gcal_event_id || template.msft_event_id) {
            // status='deleted_local' so the next sync pull doesn't re-ingest
            await trx('cal_sync_ledger')
              .where({ user_id: req.user.id, task_id: templateId })
              .where('status', 'active')
              .update({ status: 'deleted_local', task_id: null, provider_event_id: null, synced_at: db.fn.now() })
              .catch(function(err) { console.error("[silent-catch]", err.message); });
          }
          await tasksWrite.deleteTaskById(trx, templateId, req.user.id);
        }
      });

      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:deleteTask:cascade', [templateId].concat(pendingIds).concat(keptIds));
      res.json({
        message: 'Recurring deleted',
        templateId: templateId,
        deletedInstances: deletedCount,
        keptInstances: keptCount,
      });
      return;
    }

    // Recurring instance: SOFT-delete (status='skip') instead of physical delete.
    // Why: the recurring template's expansion (shared/scheduler/expandRecurring.js)
    // regenerates instances by deterministic id (sourceId-YYYYMMDD) within a 56-day
    // horizon. A physical delete leaves a hole the next scheduler run fills back in
    // with the same id — causing the user-visible "deleted task keeps coming back"
    // bug. Soft-delete keeps the row in task_instances so existingBySourceDate
    // dedup at expandRecurring.js:284-285 catches it and skips regeneration.
    // To remove the entire recurring task (template + all instances), use
    // ?cascade=recurring above.
    if (task.task_type === 'recurring_instance') {
      await tasksWrite.updateTaskById(db, id, {
        status: 'skip',
        updated_at: db.fn.now()
      }, req.user.id);
      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:deleteTask:softSkip', [id]);
      return res.json({ message: 'Recurring instance skipped', id: id, softDelete: true });
    }

    // Standard single-task delete (non-recurring)
    await db.transaction(async function(trx) {
      var deletedDeps = typeof task.depends_on === 'string'
        ? JSON.parse(task.depends_on || '[]') : (task.depends_on || []);
      var affected = await trx('tasks_v')
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
          return tasksWrite.updateTaskById(trx, u.id, {
            depends_on: u.depends_on, updated_at: db.fn.now()
          }, req.user.id);
        }));
      }

      if (task.gcal_event_id || task.msft_event_id || task.apple_event_id) {
        // status='deleted_local' so the next sync pull doesn't recreate the task
        // from the still-existing calendar event. (See top-of-deleteTask comment.)
        await trx('cal_sync_ledger')
          .where({ user_id: req.user.id, task_id: id })
          .where('status', 'active')
          .update({ status: 'deleted_local', task_id: null, provider_event_id: null, synced_at: db.fn.now() })
          .catch(function(err) { console.error("[silent-catch]", err.message); });
      }

      await tasksWrite.deleteTaskById(trx, id, req.user.id);
    });

    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:deleteTask', [id]);
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

    var existing = await fetchTaskWithEventIds(db, id, req.user.id);

    // Generated recurring instances (rc_<sourceId>_<dateDigits>) may not yet have
    // a DB row if the scheduler hasn't run since they were expanded.
    // Materialize them on demand so the status change can be persisted.
    if (!existing && id.startsWith('rc_')) {
      var parts = id.split('_');
      var dateDigits = parts[parts.length - 1];
      var sourceId = parts.slice(1, -1).join('_');
      var source = await fetchTaskWithEventIds(db, sourceId, req.user.id);
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
        await tasksWrite.insertTask(db, {
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
        existing = await fetchTaskWithEventIds(db, id, req.user.id);
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

      await tasksWrite.updateTaskById(db, id, { status: status || '', updated_at: db.fn.now() }, req.user.id);

      // When pausing: delete future open instances and clean up their GCal events
      if (status === 'pause') {
        var futureInstances = await db('tasks_with_sync_v')
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

          await tasksWrite.deleteTasksWhere(db, req.user.id, function(q) {
            return q.whereIn('id', instanceIds);
          });
        }
      }
      // Unpausing: next scheduler run will regenerate instances via expandRecurring

      var srcMap = buildSourceMap(await db('tasks_v').where('user_id', req.user.id).where(function() { this.where('task_type', 'recurring_template').orWhere('recurring', 1); }).select());
      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:updateTaskStatus:template', [id].concat(instanceIds || []));
      var updatedTemplate = await fetchTaskWithEventIds(db, id, req.user.id);
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


    await tasksWrite.updateTaskById(db, id, update, req.user.id);

    // Split-chunk sibling propagation: a split-enabled recurring master produces
    // multiple virtual chunks per occurrence (same occurrence_ordinal, different
    // split_ordinal, ids like "UUID-YYYYMMDD" and "UUID-YYYYMMDD-2"). The user's
    // "mark done" intent applies to the occurrence, not the individual chunk.
    // Without this, marking chunk 1 done leaves chunk 2 active and the task
    // reappears later in the day.
    var siblingIds = [];
    if (Number(existing.split_total) > 1 && existing.source_id != null && existing.occurrence_ordinal != null) {
      var siblings = await db('task_instances')
        .where({ user_id: req.user.id, master_id: existing.source_id, occurrence_ordinal: existing.occurrence_ordinal })
        .whereNot('id', id)
        .select('id');
      for (var si = 0; si < siblings.length; si++) {
        siblingIds.push(siblings[si].id);
        await tasksWrite.updateTaskById(db, siblings[si].id, update, req.user.id);
      }
    }

    var updated = await fetchTaskWithEventIds(db, id, req.user.id);
    var srcMap = buildSourceMap(await db('tasks_v').where('user_id', req.user.id).where(function() { this.where('task_type', 'recurring_template').orWhere('recurring', 1); }).select());
    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:updateTaskStatus', [id].concat(siblingIds));
    res.json({ task: rowToTask(updated, null, srcMap), siblingsUpdated: siblingIds.length });
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

    // Lock check: if scheduling lock is held, queue all creates
    var locked = await isLocked(req.user.id);
    if (locked) {
      for (var qi = 0; qi < rows.length; qi++) {
        rows[qi].user_id = req.user.id;
        await enqueueWrite(req.user.id, rows[qi].id, 'create', rows[qi], 'api:batchCreateTasks');
      }
      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:batchCreateTasks', rows.map(function(r) { return r.id; }));
      return res.status(201).json({ created: rows.length, queued: true });
    }

    await db.transaction(async function(trx) {
      // Bulk insert through the helper (routes each row to master/instance + legacy tasks)
      for (var i = 0; i < rows.length; i++) {
        await tasksWrite.insertTask(trx, rows[i]);
      }
    });

    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:batchCreateTasks', rows.map(function(r) { return r.id; }));
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
    var queuedCount = 0;
    var MAX_RETRIES = 3;

    // Template fields use the module-level TEMPLATE_FIELDS array (single source of truth)

    // Lock check: if scheduling lock is held, process updates with split/queue logic
    var locked = await isLocked(req.user.id);
    if (locked) {
      // Pre-load existing task info (same as the unlocked path below)
      var idsToCheck = updates.map(function(u) { return u.id; }).filter(Boolean);
      var existCheck = await db('tasks_with_sync_v')
        .where('user_id', req.user.id)
        .whereIn('id', idsToCheck)
        .select('id', 'task_type', 'source_id', 'scheduled_at', 'status',
                'when', 'gcal_event_id', 'msft_event_id');
      var existById = {};
      existCheck.forEach(function(r) { existById[r.id] = r; });

      for (var qi = 0; qi < updates.length; qi++) {
        var qUpdate = updates[qi];
        var qId = qUpdate.id;
        if (!qId) continue;
        var qExisting = existById[qId];
        if (qExisting && qExisting.status === 'disabled') continue;

        var qFields = {};
        Object.keys(qUpdate).forEach(function(k) { if (k !== 'id') qFields[k] = qUpdate[k]; });
        var qTz = qFields._timezone || tz;
        delete qFields._timezone;
        delete qFields.anchorDate;
        var qRow = taskToRow(qFields, req.user.id, qTz);
        delete qRow.user_id;
        delete qRow.created_at;
        delete qRow._pendingTimeOnly;

        var { schedulingFields, nonSchedulingFields } = splitFields(qRow);

        // Write non-scheduling fields directly
        if (Object.keys(nonSchedulingFields).length > 0) {
          nonSchedulingFields.updated_at = db.fn.now();
          await tasksWrite.updateTaskById(db, qId, nonSchedulingFields, req.user.id);
          updatedCount++;
        }

        // Queue scheduling fields
        if (Object.keys(schedulingFields).length > 0) {
          await enqueueWrite(req.user.id, qId, 'update', schedulingFields, 'api:batchUpdateTasks');
          queuedCount++;
        }
      }

      await cache.invalidateTasks(req.user.id);
      enqueueScheduleRun(req.user.id, 'api:batchUpdateTasks', idsToCheck);
      return res.json({ updated: updatedCount, queued: queuedCount });
    }

    for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        updatedCount = 0;
        await db.transaction(async function(trx) {
          // Pre-load task_type and source_id for all IDs being updated
          var idsToUpdate = updates.map(function(u) { return u.id; }).filter(Boolean);
          var existingRows = await trx('tasks_with_sync_v')
            .where('user_id', req.user.id)
            .whereIn('id', idsToUpdate)
            .select('id', 'task_type', 'source_id', 'scheduled_at', 'status',
                    'when', 'gcal_event_id', 'msft_event_id');
          var existingById = {};
          existingRows.forEach(function(r) { existingById[r.id] = r; });

          // Pre-load any source templates referenced by recurring instances in
          // this batch, so the fixed-calendar guard can inspect the template's
          // calendar linkage (that's where `when` edits on an instance route).
          var srcIds = [];
          existingRows.forEach(function(r) {
            if (r.task_type === 'recurring_instance' && r.source_id && srcIds.indexOf(r.source_id) < 0) {
              srcIds.push(r.source_id);
            }
          });
          var templateById = {};
          if (srcIds.length > 0) {
            var tmplRows = await trx('tasks_with_sync_v')
              .where('user_id', req.user.id)
              .whereIn('id', srcIds)
              .select('id', 'when', 'gcal_event_id', 'msft_event_id');
            tmplRows.forEach(function(r) { templateById[r.id] = r; });
          }

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
            // Extract anchorDate before taskToRow — it routes directly to the template's scheduled_at
            var anchorDateVal = fields.anchorDate;
            delete fields.anchorDate;
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

            // Guard: don't let calendar-linked fixed tasks lose their 'fixed' tag.
            // Recurring instances route `when` to the source template, so check it.
            if (row.when !== undefined && !update._dragPin && existing) {
              var _bGuardOpts = { allowUnfix: !!update._allowUnfix };
              if (taskType === 'recurring_instance' && existing.source_id) {
                guardFixedCalendarWhen(row, templateById[existing.source_id], _bGuardOpts);
              } else {
                guardFixedCalendarWhen(row, existing, _bGuardOpts);
              }
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
              // Route explicit anchor date to template's scheduled_at
              if (anchorDateVal) {
                templateUpdate.scheduled_at = localToUtc(anchorDateVal, null, updateTz) || null;
                templateUpdate.desired_at = templateUpdate.scheduled_at;
              }

              if (Object.keys(templateUpdate).length > 0) {
                console.log('[BATCH] template update:', JSON.stringify(templateUpdate));
                templateUpdate.updated_at = db.fn.now();
                await tasksWrite.updateTaskById(trx, existing.source_id, templateUpdate, req.user.id);
              }
              // If recurrence changed, delete all pending instances so they regenerate
              if (templateUpdate.recur !== undefined) {
                var resetCount = await tasksWrite.deleteInstancesWhere(trx, req.user.id, function(q) {
                  return q.where({ master_id: existing.source_id, status: '' });
                });
                if (resetCount > 0) {
                  console.log('[BATCH] cycle reset: deleted ' + resetCount + ' pending instances for template ' + existing.source_id);
                }
              }
              if (Object.keys(instanceUpdate).length > 0) {
                instanceUpdate.updated_at = db.fn.now();
                await tasksWrite.updateTaskById(trx, id, instanceUpdate, req.user.id);
              } else {
                await tasksWrite.updateTaskById(trx, id, { updated_at: db.fn.now() }, req.user.id);
              }
            } else {
              // Route anchor date to scheduled_at for templates
              if (anchorDateVal && taskType === 'recurring_template') {
                row.scheduled_at = localToUtc(anchorDateVal, null, updateTz) || null;
                row.desired_at = row.scheduled_at;
              }
              await tasksWrite.updateTaskById(trx, id, row, req.user.id);
              // If recurrence changed on a template, delete pending instances
              if (taskType === 'recurring_template' && row.recur !== undefined) {
                var tplResetCount = await tasksWrite.deleteInstancesWhere(trx, req.user.id, function(q) {
                  return q.where({ master_id: id, status: '' });
                });
                if (tplResetCount > 0) {
                  console.log('[BATCH] cycle reset on template: deleted ' + tplResetCount + ' pending instances for ' + id);
                }
              }
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
    enqueueScheduleRun(req.user.id, 'api:batchUpdateTasks', updates.map(function(u) { return u.id; }).filter(Boolean));
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
    var rows = await fetchTasksWithEventIds(db, req.user.id, function(q) {
      q.where('status', 'disabled').orderBy('disabled_at', 'desc');
    });
    var srcMap = buildSourceMap(
      await db('tasks_v').where('user_id', req.user.id).where(function() { this.where('task_type', 'recurring_template').orWhere('recurring', 1); }).select()
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
    var existing = await fetchTaskWithEventIds(db, id, req.user.id);
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
          var disabledInstances = await db('tasks_v')
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
      await tasksWrite.updateTaskById(trx, id, {
        status: '',
        disabled_at: null,
        disabled_reason: null,
        updated_at: db.fn.now()
      }, req.user.id);

      // If re-enabling a recurring task template, also re-enable its disabled instances.
      // In the new two-table model, disabled_at / disabled_reason live on the master;
      // instances only carry `status`. So the instance-side update is just status+updated_at.
      if (isRecurringTemplate) {
        await tasksWrite.updateInstancesWhere(trx, req.user.id, function(q) {
          return q.where({ master_id: id, status: 'disabled' });
        }, { status: '', updated_at: db.fn.now() });
      }
    });

    var srcMap = buildSourceMap(
      await db('tasks_v').where('user_id', req.user.id).where(function() { this.where('task_type', 'recurring_template').orWhere('recurring', 1); }).select()
    );
    var updated = await fetchTaskWithEventIds(db, id, req.user.id);
    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:reEnableTask', [id]);
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
    var existing = await db('tasks_with_sync_v')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!existing) return res.status(404).json({ error: 'Task not found' });

    var taskType = existing.task_type || 'task';

    if (taskType === 'recurring_instance' && existing.source_id) {
      // Recurring instance: delete it so the scheduler regenerates from template
      await tasksWrite.deleteTaskById(db, req.params.id, req.user.id);

      enqueueScheduleRun(req.user.id, 'api:unpinTask:delete', [req.params.id]);
      return res.json({ success: true, action: 'deleted', message: 'Instance deleted — scheduler will regenerate from template' });
    }

    // Regular task: restore previous scheduling mode
    var updates = {
      when: existing.prev_when || '',
      prev_when: null,
      date_pinned: 0,
      updated_at: db.fn.now()
    };

    await tasksWrite.updateTaskById(db, req.params.id, updates, req.user.id);

    enqueueScheduleRun(req.user.id, 'api:unpinTask', [req.params.id]);
    res.json({ success: true, action: 'unpinned', when: updates.when });
  } catch (error) {
    console.error('Unpin error:', error);
    res.status(500).json({ error: 'Failed to unpin task' });
  }
}

module.exports = {
  getAllTasks,
  getTask,
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
  guardFixedCalendarWhen,
  buildSourceMap,
  fetchTasksWithEventIds,
  ensureProject,
  applySplitDefault,
  TEMPLATE_FIELDS,
  validateTaskInput
};
