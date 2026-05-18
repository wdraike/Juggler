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
const { z } = require('zod');
const { localToUtc, utcToLocal, toDateISO, fromDateISO, getDayName, safeTimezone } = require('../scheduler/dateHelpers');
const cache = require('../lib/redis');
const { enqueueScheduleRun: _enqueueScheduleRun } = require('../scheduler/scheduleQueue');
const sseEmitter = require('../lib/sse-emitter');
const { isLocked, enqueueWrite, splitFields, flushQueue } = require('../lib/task-write-queue');
const tasksWrite = require('../lib/tasks-write');
const { isAnchorDependentRecur } = require('../../../shared/scheduler/expandRecurring');
var { PLACEMENT_MODES } = require('../lib/placementModes');
var { TERMINAL_STATUSES, isTerminalStatus } = require('../lib/task-status');

// Fields that, when present on an incoming task patch, require us to
// (re)derive placement_mode. Module-level so it's allocated once instead
// of on every taskToRow() call.
var PLACEMENT_TRIGGER_FIELDS = ['marker', 'rigid', 'when', 'recurring', 'preferredTimeMins', 'placementMode'];
// Wrap enqueueScheduleRun to also emit SSE event so frontends refresh
// immediately. `ids` (optional) is the list of task ids the caller just
// wrote — when present, the frontend can upsert only those rows instead of
// refetching the full task list.
function enqueueScheduleRun(userId, source, ids, options) {
  options = options || {};
  var payload = { source: source, timestamp: Date.now() };
  if (Array.isArray(ids) && ids.length > 0) payload.ids = ids;
  // When the caller queued writes to task_write_queue, the DB doesn't yet
  // reflect this change — emitting now would race the queue flush and the
  // frontend's re-fetch would return pre-write values (the "revert flash").
  // Callers pass { skipEmit: true } in that case; task-write-queue._doFlush
  // emits tasks:changed with the affected ids post-commit.
  if (!options.skipEmit) {
    sseEmitter.emit(userId, 'tasks:changed', payload);
  }
  // Non-scheduling-only edits (e.g. changing `notes` or `project`) don't
  // affect placement — callers pass { skipScheduler: true } to avoid the
  // wasted scheduler run. Other clients still learn of the change via the
  // tasks:changed emit above.
  if (options.skipScheduler) return;
  // Defer the scheduler enqueue (DB insert) off the save hot path. The
  // scheduler already debounces 2s after the last enqueue, so delaying this
  // by 2s just shifts the quiet-period start — it doesn't starve the user.
  // Keeps the save's pool connection uncontested by queue inserts.
  setTimeout(function() { _enqueueScheduleRun(userId, source); }, 2000);
}

// True iff `row` contains any scheduling-relevant DB fields (anything
// outside NON_SCHEDULING_FIELDS).
function hasSchedulingFields(row) {
  if (!row) return false;
  return Object.keys(splitFields(row).schedulingFields).length > 0;
}

/**
 * Expand a list of task IDs to include every sibling instance of any
 * recurring template or recurring instance among the inputs. Used after
 * a write that touches template-level (universal) fields so the frontend
 * can refresh every dependent instance — not just the one the user edited.
 *
 * Returns a deduped array (original order preserved for inputs that are
 * not recurring templates / instances; siblings appended after).
 */
async function expandToAllInstanceIds(userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return ids || [];
  var masterIds = new Set();
  // Which input ids map to a master (either directly or via an instance's
  // master_id)? Two short queries cover it.
  var masters = await db('task_masters')
    .where('user_id', userId)
    .whereIn('id', ids)
    .where('recurring', 1)
    .select('id');
  masters.forEach(function(r) { masterIds.add(r.id); });
  var insts = await db('task_instances')
    .where('user_id', userId)
    .whereIn('id', ids)
    .select('id', 'master_id');
  insts.forEach(function(r) { if (r.master_id) masterIds.add(r.master_id); });
  if (masterIds.size === 0) return ids;
  var siblings = await db('task_instances')
    .where('user_id', userId)
    .whereIn('master_id', Array.from(masterIds))
    .select('id');
  var out = {};
  ids.forEach(function(i) { out[i] = true; });
  masterIds.forEach(function(m) { out[m] = true; });
  siblings.forEach(function(r) { out[r.id] = true; });
  return Object.keys(out);
}

function derivePlacementMode(isMarker, isRigid, when, recurring, preferredTimeMins) {
  if (isMarker) return PLACEMENT_MODES.MARKER;
  var whenStr = when || '';
  if (whenStr.includes('fixed')) return PLACEMENT_MODES.FIXED;
  if (isRigid && !recurring) return PLACEMENT_MODES.FIXED;
  if (recurring && isRigid && preferredTimeMins != null) return PLACEMENT_MODES.RECURRING_RIGID;
  if (recurring && preferredTimeMins != null) return PLACEMENT_MODES.RECURRING_WINDOW;
  if (recurring) return PLACEMENT_MODES.RECURRING_FLEXIBLE;
  return PLACEMENT_MODES.FLEXIBLE;
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
  'when', 'day_req', 'recurring', 'time_flex', 'split', 'split_min',
  'travel_before', 'travel_after', 'depends_on',
  'notes', 'url', 'flex_when', 'recur', 'recur_start', 'recur_end',
  'preferred_time', 'preferred_time_mins', 'placement_mode',
  'weather_precip', 'weather_cloud', 'weather_temp_min', 'weather_temp_max',
  'weather_temp_unit', 'weather_humidity_min', 'weather_humidity_max'];

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
      .select('provider', 'provider_event_id', 'origin', 'event_url')
  ]);
  if (!row) return null;
  // Attach event ids in the same shape tasks_with_sync_v exposes.
  row.gcal_event_id = null;
  row.msft_event_id = null;
  row.apple_event_id = null;
  row.cal_sync_origin = null;
  row.cal_event_url = null;
  for (var i = 0; i < ledgerRows.length; i++) {
    var p = ledgerRows[i].provider;
    if (p === 'gcal') { row.gcal_event_id = ledgerRows[i].provider_event_id; }
    else if (p === 'msft') { row.msft_event_id = ledgerRows[i].provider_event_id; }
    else if (p === 'apple') { row.apple_event_id = ledgerRows[i].provider_event_id; }
    // Use the first active ledger row for origin/url (multi-provider: pick non-juggler origin if present)
    if (!row.cal_sync_origin || row.cal_sync_origin === 'juggler') {
      row.cal_sync_origin = ledgerRows[i].origin || null;
      row.cal_event_url = ledgerRows[i].event_url || null;
    }
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
      .select('task_id', 'provider', 'provider_event_id', 'origin', 'event_url')
  ]);
  var byTask = {};
  for (var j = 0; j < ledgerRows.length; j++) {
    var lr = ledgerRows[j];
    if (!lr.task_id) continue;
    var slot = byTask[lr.task_id] || (byTask[lr.task_id] = {});
    if (lr.provider === 'gcal') slot.gcal_event_id = lr.provider_event_id;
    else if (lr.provider === 'msft') slot.msft_event_id = lr.provider_event_id;
    else if (lr.provider === 'apple') slot.apple_event_id = lr.provider_event_id;
    // Use non-juggler origin if present (prefer provider-origin over juggler-origin)
    if (!slot.cal_sync_origin || slot.cal_sync_origin === 'juggler') {
      slot.cal_sync_origin = lr.origin || null;
      slot.cal_event_url = lr.event_url || null;
    }
  }
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var ev = byTask[r.id];
    r.gcal_event_id = ev && ev.gcal_event_id || null;
    r.msft_event_id = ev && ev.msft_event_id || null;
    r.apple_event_id = ev && ev.apple_event_id || null;
    r.cal_sync_origin = ev && ev.cal_sync_origin || null;
    r.cal_event_url = ev && ev.cal_event_url || null;
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
  // Merge template fields from source for thin recurring instances.
  // tasks_v currently (mis-)sets source_id = master_id for ALL instance rows
  // including one-off tasks (task_type='task'). For one-offs that's harmless
  // — we just don't merge anything — but we also don't want to spam warnings
  // every read. Only warn for genuinely recurring instances whose template is
  // absent.
  var src = sourceMap && row.source_id ? sourceMap[row.source_id] : null;
  if (!src && row.source_id && sourceMap && row.task_type === 'recurring_instance') {
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
  if (row.scheduled_at && (row.status === 'done' || row.status === 'cancel' || row.status === 'skip' || row.status === 'missed')) {
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
  // When timezone is provided (scheduler), derive for all tasks that have a
  // scheduled_at. The scheduler has its own isUserAnchored guard to decide
  // whether to use task.date as a placement anchor; rowToTask's job is to
  // faithfully represent the current DB state, not to filter by placement type.
  var displayTz = timezone || null;
  if (displayTz && row.scheduled_at) {
    var local = utcToLocal(row.scheduled_at, displayTz);
    if (local.date) date = local.date;
    if (local.time) time = local.time;
    if (local.day) day = local.day;
  }

  // Recurring instances: derive time from template's preferred_time_mins so the UI
  // shows where the scheduler will place it and the scheduler itself uses the
  // correct preferred time. The value is in local minutes-since-midnight, no
  // timezone conversion needed.
  //
  // Note: the `!row.scheduled_at` guard previously here (commit 9b8d4f7) has been
  // removed. That guard was added to prevent cal-sync drift between GCal (which used
  // task.time) and MSFT/Apple (which used scheduled_at). However, the GCal builder
  // was simultaneously hardened to prefer task.scheduledAt over task.time — making
  // the rowToTask guard redundant. With the guard in place, recurring instances with
  // a stale prior-day scheduled_at kept stale time values, causing the scheduler to
  // treat them as overdue or drop them silently.
  // Exception: disabled instances are frozen and never get the preferred-time hint.
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
    // juggler-cal-history Plan A/E — completion timestamp on terminal transition.
    completedAt: row.completed_at ? scheduledAtToISO(row.completed_at) : null,
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
    url: row.url || null,
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
    calSyncOrigin: row.cal_sync_origin || null,
    calEventUrl: row.cal_event_url || null,
    dependsOn: safeParseJSON(row.depends_on, []),
    datePinned: !!row.date_pinned,
    prevWhen: row.prev_when || null,
    marker: !!row.marker,
    placementMode: row.placement_mode || PLACEMENT_MODES.FLEXIBLE,
    flexWhen: !!row.flex_when,
    travelBefore: row.travel_before != null ? row.travel_before : undefined,
    travelAfter: row.travel_after != null ? row.travel_after : undefined,
    weatherPrecip:   row.weather_precip   || 'any',
    weatherCloud:    row.weather_cloud    || 'any',
    weatherTempMin:      row.weather_temp_min      != null ? row.weather_temp_min      : null,
    weatherTempMax:      row.weather_temp_max      != null ? row.weather_temp_max      : null,
    weatherTempUnit:     row.weather_temp_unit     || null,
    weatherHumidityMin:  row.weather_humidity_min  != null ? row.weather_humidity_min  : null,
    weatherHumidityMax:  row.weather_humidity_max  != null ? row.weather_humidity_max  : null,
    preferredTime: row.preferred_time != null ? !!row.preferred_time : null,
    preferredTimeMins: row.preferred_time_mins != null ? row.preferred_time_mins : null,
    desiredAt: row.desired_at ? new Date(row.desired_at).toISOString() : null,
    unscheduled: !!row.unscheduled,
    overdue: !!row.overdue,
    slackMins: row.slack_mins != null ? Number(row.slack_mins) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
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
function taskToRow(task, userId, timezone, currentTask) {
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
  if (task.url !== undefined) row.url = task.url || null;
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
  if (task.flexWhen !== undefined) row.flex_when = task.flexWhen ? 1 : 0;
  if (task.travelBefore !== undefined) row.travel_before = task.travelBefore || null;
  else if (task.travel_before !== undefined) row.travel_before = task.travel_before || null;
  if (task.travelAfter !== undefined) row.travel_after = task.travelAfter || null;
  else if (task.travel_after !== undefined) row.travel_after = task.travel_after || null;
  if (task.tz !== undefined) row.tz = task.tz || null;
  if (task.recurStart !== undefined) row.recur_start = task.recurStart || null;
  if (task.recurEnd !== undefined) row.recur_end = task.recurEnd || null;
  if (task.preferredTime !== undefined) {
    row.preferred_time = task.preferredTime === null ? null : (task.preferredTime ? 1 : 0);
  }
  if (task.preferredTimeMins !== undefined) row.preferred_time_mins = task.preferredTimeMins;
  if (task.weatherPrecip   !== undefined) row.weather_precip    = task.weatherPrecip;
  if (task.weatherCloud    !== undefined) row.weather_cloud     = task.weatherCloud;
  if (task.weatherTempMin      !== undefined) row.weather_temp_min      = task.weatherTempMin;
  if (task.weatherTempMax      !== undefined) row.weather_temp_max      = task.weatherTempMax;
  if (task.weatherTempUnit     !== undefined) row.weather_temp_unit     = task.weatherTempUnit;
  if (task.weatherHumidityMin  !== undefined) row.weather_humidity_min  = task.weatherHumidityMin;
  if (task.weatherHumidityMax  !== undefined) row.weather_humidity_max  = task.weatherHumidityMax;

  // Direct desired_at mapping (if caller provides it explicitly)
  if (task.desiredAt !== undefined) {
    row.desired_at = task.desiredAt ? parseISOToDate(task.desiredAt) : null;
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
      // Also set desired_at to preserve user intent. For date-only (no time)
      // intents we store local-noon of that day — avoids midnight timezone
      // slip and reads naturally as "on this day."
      if (row.desired_at === undefined) {
        row.desired_at = timeVal
          ? row.scheduled_at
          : localToUtc(dateVal, '12:00 PM', timezone) || null;
      }
    } else if (task.date !== undefined && !dateVal) {
      // date was explicitly sent as null/empty → clear scheduled_at and desired_at
      row.scheduled_at = null;
      if (row.desired_at === undefined) row.desired_at = null;
    }
    // If only time was sent (no date field), scheduled_at is handled in the
    // caller which can read the existing row's date and combine with the new time.
    if (task.date === undefined && task.time !== undefined) {
      row._pendingTimeOnly = timeVal;
    }
  }


  var touchesPlacement = PLACEMENT_TRIGGER_FIELDS.some(function(f) { return task[f] !== undefined; });
  if (touchesPlacement) {
    if (task.placementMode !== undefined) {
      row.placement_mode = task.placementMode;
    } else {
      var cur = currentTask || {};
      var curPrefTimeMins = cur.preferredTimeMins != null ? cur.preferredTimeMins : cur.preferred_time_mins;
      row.placement_mode = derivePlacementMode(
        task.marker     !== undefined ? !!task.marker     : !!(cur.marker),
        task.rigid      !== undefined ? !!task.rigid      : !!(cur.rigid),
        task.when       !== undefined ? task.when         : (cur.when || ''),
        task.recurring  !== undefined ? !!task.recurring  : !!(cur.recurring),
        task.preferredTimeMins !== undefined ? task.preferredTimeMins : curPrefTimeMins
      );
    }
  }

  row.updated_at = new Date();
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
// Guard: prevent unpinning calendar-linked tasks. Pinning is the mechanism
// that keeps synced events immovable — removing it would let the scheduler
// move calendar events. The broader ingested-task guard (#8) blocks most
// field changes; this catches the specific case of date_pinned being cleared.
function guardFixedCalendarWhen(row, guardTarget, opts) {
  if (!guardTarget) return;
  if (opts && opts.allowUnfix) return;
  var isCalLinked = !!(guardTarget.gcal_event_id || guardTarget.msft_event_id || guardTarget.apple_event_id);
  if (!isCalLinked) return;
  // Prevent clearing date_pinned on calendar-linked tasks
  if (row.date_pinned === 0 || row.date_pinned === false) {
    delete row.date_pinned;
  }
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

    var query = db('tasks_v').where('user_id', req.user.id)
      .orderByRaw('(scheduled_at IS NULL) ASC, scheduled_at ASC');
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
    // Anchor-dependent recur types (biweekly, interval, timesPerCycle filtering)
    // need a stored recur_start. Without it, the scheduler falls back to
    // "today" as the anchor, which causes cycle boundaries + parity to drift
    // run-to-run. Two failure cases:
    //   1. Create: caller sets _requireRecurStartIfAnchor (from createTask) —
    //      recurStart missing entirely is rejected.
    //   2. Update: caller explicitly clears recurStart (null / '') while the
    //      recur type is still anchor-dependent — reject so the user can't
    //      accidentally orphan the anchor. `undefined` means "not touched",
    //      which is fine; the existing DB value remains.
    if (isAnchorDependentRecur(body.recur)) {
      var rs = body.recurStart;
      if (body._requireRecurStartIfAnchor) {
        if (rs === undefined || rs === null || String(rs).trim() === '') {
          errors.push('Recurrence start date is required for biweekly, interval, or times-per-cycle patterns');
        }
      } else if (rs === null || (typeof rs === 'string' && rs.trim() === '')) {
        errors.push('Recurrence start date cannot be cleared on biweekly, interval, or times-per-cycle patterns');
      }
    }
  }
  return errors;
}

async function createTask(req, res) {
  try {
    // Validate input
    req.body._requireText = true;
    req.body._requireRecurStartIfAnchor = true;
    var validationErrors = validateTaskInput(req.body);
    delete req.body._requireText;
    delete req.body._requireRecurStartIfAnchor;
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    var tz = safeTimezone(req.headers['x-timezone']);
    var row = taskToRow(req.body, req.user.id, tz);
    if (!row.id) row.id = uuidv7();
    if (!row.task_type) row.task_type = 'task';
    row.created_at = new Date();
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
      // Also align placement_mode — taskToRow derived it before this auto-set,
      // so it may be FLEXIBLE. Fix the inconsistency here.
      row.placement_mode = PLACEMENT_MODES.FIXED;
    }
    // [FIX D-14] Server-side backstop: if client signals all-day but didn't set when, enforce it
    if (!timeWasSet && req.body.allDay === true && row.when === undefined) {
      row.when = 'allday';
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
      enqueueScheduleRun(req.user.id, 'api:createTask', [row.id], { skipEmit: true });
      return res.status(201).json({ task: rowToTask(row, null), queued: true });
    }

    await tasksWrite.insertTask(db, row);
    var created = await fetchTaskWithEventIds(db, row.id, req.user.id);
    if (!created) {
      console.error('Create task: fetchTaskWithEventIds returned null for id=' + row.id + ' type=' + row.task_type);
      return res.status(500).json({ error: 'Task created but could not be read back' });
    }
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
      // allDay affects `when` derivation — must hit the complex path for D-14 backstop
      || req.body.allDay !== undefined
      // recurring=false must clean up instances — fast path skips that entirely
      || (req.body.recurring !== undefined && !req.body.recurring)
      // time without date requires existing.scheduled_at to combine
      || (req.body.time !== undefined && req.body.date === undefined && req.body.scheduledAt === undefined);

    if (!needsComplexPath) {
      var fastTz = safeTimezone(req.headers['x-timezone']);
      var fastBody = Object.assign({}, req.body);
      delete fastBody.anchorDate;

      // Fetch existing in parallel with project-ensure (if needed)
      var fastExistingPromise = fetchTaskWithEventIds(db, id, req.user.id);
      var fastEnsureProject = req.body.project
        ? ensureProject(req.user.id, req.body.project)
        : Promise.resolve();
      var [fastExisting] = await Promise.all([fastExistingPromise, fastEnsureProject]);

      var fastRow = taskToRow(fastBody, req.user.id, fastTz, fastExisting);
      delete fastRow.id;
      delete fastRow.user_id;
      delete fastRow.created_at;
      delete fastRow._pendingTimeOnly;
      if ((req.body.date !== undefined || req.body.scheduledAt !== undefined)
          && fastRow.date_pinned === undefined) {
        fastRow.date_pinned = 1;
      }
      fastRow.updated_at = db.fn.now();

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

      // Normalize: if clearing date_pinned without explicitly changing when,
      // strip the 'fixed' tag so the scheduler isn't left treating the task as
      // immovable after the user has asked to unpin it.
      if (fastRow.date_pinned === 0 && req.body.when === undefined) {
        var _exWhen = fastExisting.when || '';
        if (_exWhen.split(',').some(function(t) { return t.trim() === 'fixed'; })) {
          fastRow.when = _exWhen.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t && t !== 'fixed'; }).join(',');
        }
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

      // Fire-and-forget: cache invalidate + scheduler run (skipped when
      // only non-scheduling fields changed).
      cache.invalidateTasks(req.user.id).catch(function(e) { console.error('[cache]', e.message); });
      // When the edit touched universal/template fields on a recurring
      // task, broadcast a refresh to every sibling instance so their
      // cached rows pick up the new values — even when the scheduler
      // isn't rerun.
      var fastBroadcastIds = [id];
      if (fastExisting.recurring || fastExisting.task_type === 'recurring_template' || fastExisting.task_type === 'recurring_instance') {
        try { fastBroadcastIds = await expandToAllInstanceIds(req.user.id, [id]); } catch (e) { /* fall back to just [id] */ }
      }
      enqueueScheduleRun(req.user.id, 'api:updateTask', fastBroadcastIds, { skipScheduler: !hasSchedulingFields(fastRow) });

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

    // Guard: calendar-synced tasks in ingest mode — block field edits that
    // would create drift with the external calendar. Allow status and notes only.
    var isCalSynced = !!(existing.gcal_event_id || existing.msft_event_id || existing.apple_event_id);
    if (isCalSynced) {
      var ALLOWED_SYNCED_FIELDS = ['status', 'notes', 'datePinned', '_dragPin', '_allowUnfix'];
      var bodyKeys = Object.keys(req.body).filter(function(k) { return k !== 'id'; });
      var blockedFields = bodyKeys.filter(function(k) { return ALLOWED_SYNCED_FIELDS.indexOf(k) === -1; });
      if (blockedFields.length > 0) {
        return res.status(403).json({
          error: 'This task is synced from an external calendar. Only status and notes can be changed here.',
          code: 'CAL_SYNCED_READONLY',
          blockedFields: blockedFields
        });
      }
    }

    var tz = safeTimezone(req.headers['x-timezone']);
    var anchorDateVal = req.body.anchorDate;
    var bodyWithoutAnchor = Object.assign({}, req.body);
    delete bodyWithoutAnchor.anchorDate;
    var row = taskToRow(bodyWithoutAnchor, req.user.id, tz, existing);
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
    // If the user explicitly cleared the time field and didn't also set when, auto-strip
    // 'fixed' from when. The create path auto-adds 'fixed' when a time is given; without
    // this strip the task becomes permanently unschedulable (when='fixed', no date/time).
    var timeWasCleared = req.body.time === null || req.body.time === '';
    if (timeWasCleared && row.when === undefined) {
      var _existingWhen = existing.when || '';
      if (_existingWhen.split(',').some(function(t) { return t.trim() === 'fixed'; })) {
        row.when = _existingWhen.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t && t !== 'fixed'; }).join(',');
      }
    }
    // [FIX D-14] Server-side backstop for all-day tasks in update path
    if (!timeWasSet && req.body.allDay === true && row.when === undefined) {
      row.when = 'allday';
    }
    // Drag-pin: user dragged this task to a new time on the calendar.
    // Pin it so the scheduler respects the user's placement. The when-tags
    // stay unchanged — pinning is handled by datePinned, not when:'fixed'.
    if (req.body._dragPin) {
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
      var queuedScheduling = false;
      if (Object.keys(schedulingFields).length > 0) {
        await enqueueWrite(req.user.id, id, 'update', schedulingFields, 'api:updateTask');
        queuedScheduling = true;
      }
      await cache.invalidateTasks(req.user.id);
      // If scheduling fields are pending in the queue, defer the SSE emit —
      // the queue flush will emit with post-commit values. If nothing
      // scheduling-relevant was touched, skip the scheduler run entirely.
      var lockedBroadcastIds = [id];
      if ((existing.recurring || existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance') && !queuedScheduling) {
        // Non-scheduling template change → frontend refresh siblings now.
        try { lockedBroadcastIds = await expandToAllInstanceIds(req.user.id, [id]); } catch (e) { /* fall back */ }
      }
      enqueueScheduleRun(req.user.id, 'api:updateTask', lockedBroadcastIds, {
        skipEmit: queuedScheduling,
        skipScheduler: !queuedScheduling
      });
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
          await tasksWrite.resetRecurringInstances(trx, req.user.id, existing.source_id, '[RECUR] cycle reset via instance edit');
          if (templateUpdate.recur === null) {
            await tasksWrite.archiveCompletedInstances(trx, req.user.id, existing.source_id);
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
        var needsCleanup = row.recur !== undefined || row.recur_start !== undefined || row.recur_end !== undefined
          || row.recurring === 0;
        if (needsCleanup) {
          // recurring=false on a template: convert to a one-off task.
          // resetRecurringInstances handles ledger cleanup + pending instance deletion atomically.
          // archiveCompletedInstances re-parents done/cancel/skip instances to the archive master.
          if (row.recurring === 0) {
            await tasksWrite.resetRecurringInstances(trx, req.user.id, id, '[RECUR] toggle-off: recurring=false');
            await tasksWrite.archiveCompletedInstances(trx, req.user.id, id);
            // After toggle-off, the template is no longer visible in tasks_v
            // (template branch requires recurring=1; instance branch requires an instance row).
            // Create the self-linked instance so the task stays visible as a one-off.
            await trx('task_instances')
              .insert({
                id: id,
                master_id: id,
                user_id: req.user.id,
                occurrence_ordinal: 1,
                split_ordinal: 1,
                split_total: 1,
                dur: existing.dur || 30,
                status: existing.status || '',
                scheduled_at: existing.scheduled_at || null,
                date_pinned: 0,
                overdue: 0,
                generated: 0,
                created_at: trx.fn.now(),
                updated_at: trx.fn.now()
              })
              .onConflict('id').ignore();
          } else {
          var _dateHelpers = require('../scheduler/dateHelpers');
          // Build the post-update template state by merging the pre-fetch (existing) with
          // the write payload (row) — both use tasks_v snake_case column names, so this is
          // equivalent to re-fetching without the extra DB round-trip inside the transaction.
          var updatedTmpl = Object.assign({}, existing, row);
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
            await tasksWrite.resetRecurringInstances(trx, req.user.id, id, '[RECUR] cycle reset');
            if (oldRecur && !newRecur) {
              await tasksWrite.archiveCompletedInstances(trx, req.user.id, id);
            }
          } else {
            // Incremental cleanup: only delete instances that no longer match
            var _dateMatch = require('../../shared/scheduler/dateMatchesRecurrence');
            // Prefer recur_start as the anchor (matches expandRecurring's new
            // model). Fall back to scheduled_at for legacy templates without
            // recur_start set.
            var srcDateStr = updatedTmpl.recur_start
              ? (updatedTmpl.recur_start instanceof Date
                  ? _dateHelpers.formatDateKey(updatedTmpl.recur_start)
                  : (function() {
                      var iso = String(updatedTmpl.recur_start).match(/^(\d{4})-(\d{2})-(\d{2})/);
                      return iso ? Number(iso[2]) + '/' + Number(iso[3]) : String(updatedTmpl.recur_start);
                    })())
              : (updatedTmpl.scheduled_at ? utcToLocal(updatedTmpl.scheduled_at, tz).date : null);

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
            }
          }
          } // end else (recur/recur_start/recur_end change detection)
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
    var slowBroadcastIds = [id];
    if (existing.recurring || existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance') {
      try { slowBroadcastIds = await expandToAllInstanceIds(req.user.id, [id]); } catch (e) { /* fall back to just [id] */ }
    }
    enqueueScheduleRun(req.user.id, 'api:updateTask', slowBroadcastIds, { skipScheduler: !hasSchedulingFields(row) });
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

    // [FIX D-08] Block deletion of provider-origin tasks — user must delete from the provider
    var PROVIDER_NAMES_LOCAL = { gcal: 'Google Calendar', msft: 'Microsoft Calendar', apple: 'Apple Calendar' };
    var isCascadeDelete = cascade === 'recurring';
    if (!isCascadeDelete) {
      var providerLedgerRow = await db('cal_sync_ledger')
        .where({ user_id: req.user.id, task_id: id, status: 'active' })
        .where('origin', '!=', 'juggler')
        .first();
      if (providerLedgerRow) {
        var providerName = PROVIDER_NAMES_LOCAL[providerLedgerRow.provider] || providerLedgerRow.provider;
        return res.status(403).json({
          error: 'This task came from ' + providerName + '. To remove it, delete it from ' + providerName + ' directly.',
          code: 'PROVIDER_ORIGIN_DELETE_BLOCKED',
          provider: providerLedgerRow.provider
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
            .update({ status: 'deleted_local', task_id: null, synced_at: db.fn.now() })
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
              .update({ status: 'deleted_local', task_id: null, synced_at: db.fn.now() })
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
          .update({ status: 'deleted_local', task_id: null, synced_at: db.fn.now() })
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
var VALID_STATUSES = ['', 'done', 'wip', 'cancel', 'skip', 'pause', 'disabled', 'missed'];

// juggler-cal-history Plan C — terminal transitions that require non-null scheduled_at (D-15).
// 'missed' excluded: cron-only writer + scheduler past-window (rows always have scheduled_at).
// 'pause' excluded: template-level operation, scheduled_at semantically n/a.
var TERMINAL_REQUIRES_SCHEDULE = ['done', 'skip', 'cancel'];

const taskPatchSchema = z.object({
  id: z.string().optional(),
  text: z.string().max(500).optional(),
  dur: z.number().int().min(1).max(1440).optional(),
  pri: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  status: z.string().optional(),
  notes: z.string().max(10000).optional(),
  project: z.string().max(100).optional(),
  deadline: z.string().nullable().optional(),
  recurring: z.boolean().optional(),
}).passthrough();

const batchCreateSchema = z.object({
  tasks: z.array(taskPatchSchema).min(1).max(100),
});

const batchUpdateSchema = z.object({
  updates: z.array(taskPatchSchema.extend({ id: z.string().min(1) })).min(1).max(2000),
});

const statusUpdateSchema = z.object({
  status: z.enum(['', 'done', 'wip', 'cancel', 'skip', 'pause', 'disabled', 'missed']),
  completedAt: z.string().optional(),
  direction: z.string().optional(),
}).passthrough();

async function updateTaskStatus(req, res) {
  const statusParsed = statusUpdateSchema.safeParse(req.body);
  if (!statusParsed.success) return res.status(400).json({ error: 'Invalid status', details: statusParsed.error.issues });

  try {
    var id = req.params.id;
    var status = req.body.status;

    // Validate status value
    if (status !== undefined && VALID_STATUSES.indexOf(status) === -1) {
      return res.status(400).json({ error: 'Invalid status. Valid values: ' + VALID_STATUSES.join(', ') });
    }

    // juggler-cal-history Plan C: 'missed' is system-applied (cron writer + scheduler past-window).
    // Reject user-supplied 'missed' to keep the semantic clean.
    if (status === 'missed') {
      return res.status(403).json({
        error: "Status 'missed' is system-applied; cannot be set directly.",
        code: 'STATUS_MISSED_SYSTEM_ONLY'
      });
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
            .update({ status: 'deleted_local', task_id: null, synced_at: db.fn.now() })
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

    // juggler-cal-history Plan C — scheduled_at required for terminal transitions (D-15).
    // Backend constraint: cannot mark a task done/skip/cancel without a scheduled time.
    // Eliminates the unscheduled-history anchor ambiguity. Frontend mirrors with disabled buttons.
    if (TERMINAL_REQUIRES_SCHEDULE.indexOf(status) !== -1
        && !existing.scheduled_at
        && !req.body.scheduledAt) {
      return res.status(400).json({
        error: 'Cannot mark task ' + status + ' without a scheduled time. Schedule it first.',
        code: 'SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS'
      });
    }

    var update = { status: status || '', updated_at: db.fn.now() };
    var isFutureScheduled = existing.scheduled_at && new Date(existing.scheduled_at) > new Date();

    // juggler-cal-history Plan C — write completed_at on terminal transition (D-12).
    // Reverse: clearing terminal status (reopen) clears completed_at.
    if (isTerminalStatus(status) && !isTerminalStatus(existing.status)) {
      update.completed_at = db.fn.now();
    } else if (status === '' && isTerminalStatus(existing.status)) {
      update.completed_at = null;
    }

    // When marking done, only update scheduled_at if the user provided an explicit
    // custom completion time. Never overwrite it with "now" — that's the done-time
    // shift bug that moves GCal events to the completion timestamp.
    if (status === 'done') {
      var completedAt = req.body.completedAt;
      if (completedAt && completedAt !== 'now' && completedAt !== 'scheduled') {
        // Custom datetime string from the user — clamp to now if in the future
        var customDate = new Date(completedAt);
        update.scheduled_at = customDate > new Date() ? db.fn.now() : customDate;
      }
      // Otherwise leave scheduled_at unchanged (covers 'now', 'scheduled', and undefined)
    }

    // [FIX D-04 + juggler-cal-history Plan C] Reactivating a terminal task — clear done_frozen
    // so sync resumes. Originally fix-cal-sync handled `done → non-done` only; Plan C
    // generalizes to all terminal statuses (done, cancel, skip, pause, missed) via shared
    // isTerminalStatus. Fires on any terminal → non-terminal transition.
    if (existing && isTerminalStatus(existing.status) && !isTerminalStatus(status)) {
      await db('cal_sync_ledger')
        .where({ user_id: req.user.id, task_id: id, status: 'done_frozen' })
        .update({ status: 'active', synced_at: db.fn.now() });
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

    // Outbound calendar sync on skip/cancel: the cal-sync processor already
    // handles terminal-status tasks (cal-sync.controller.js:399-419 — it pulls
    // active ledger rows whose task is done/cancel/skip/pause and pushes a
    // DELETE to the provider). But cal-sync doesn't run automatically on
    // every task mutation; it runs on a user-configured cadence or manual
    // trigger. So skip/cancel alone leaves the remote event in place until
    // the next sync cycle. Enqueue a cal-sync run to close the gap for
    // calendar-linked instances.
    //
    // `done` intentionally NOT included — completed history on the user's
    // calendar is usually valuable (e.g. "I exercised Mon"). Users who do
    // want that can set calCompletedBehavior='delete' in config, which the
    // processor already respects.
    var hasCalLink = !!(existing.gcal_event_id || existing.msft_event_id || existing.apple_event_id);
    if ((status === 'skip' || status === 'cancel') && hasCalLink) {
      try {
        var syncController = require('./cal-sync.controller');
        if (syncController && typeof syncController.sync === 'function') {
          // Fire-and-forget — don't block the status response on the sync.
          // The processor pulls fresh task + ledger state, sees terminal
          // status, deletes the event, and flips the ledger to deleted_local.
          syncController.sync({ user: { id: req.user.id }, body: {} }, { json: function() {}, status: function() { return { json: function() {} }; } })
            .catch(function(err) { console.error('[cal-sync] trigger failed:', err && err.message); });
        }
      } catch (err) {
        console.error('[cal-sync] trigger import failed:', err && err.message);
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
  const batchParsed = batchCreateSchema.safeParse(req.body);
  if (!batchParsed.success) return res.status(400).json({ error: 'Invalid batch payload', details: batchParsed.error.issues });

  try {
    var tasks = req.body.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Tasks array required' });
    }
    if (tasks.length > 500) {
      return res.status(400).json({ error: 'Batch limited to 500 items' });
    }

    // Validate each task
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var batchCreateErrs = validateTaskInput(Object.assign({ _requireText: true }, t));
      if (batchCreateErrs.length > 0) {
        return res.status(400).json({ error: 'Task ' + i + ': ' + batchCreateErrs.join('; ') });
      }
    }

    var tz = safeTimezone(req.headers['x-timezone']);

    var prefs = await db('user_config').where({ user_id: req.user.id, config_key: 'preferences' }).first();
    var splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;

    var rows = tasks.map(function(t) {
      var row = taskToRow(t, req.user.id, tz);
      row.created_at = new Date();
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
      enqueueScheduleRun(req.user.id, 'api:batchCreateTasks', rows.map(function(r) { return r.id; }), { skipEmit: true });
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
  const batchUpdateParsed = batchUpdateSchema.safeParse(req.body);
  if (!batchUpdateParsed.success) return res.status(400).json({ error: 'Invalid batch payload', details: batchUpdateParsed.error.issues });

  try {
    var updates = req.body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Updates array required' });
    }
    if (updates.length > 2000) {
      return res.status(400).json({ error: 'Batch limited to 2000 items' });
    }

    // Validate each update item up-front
    for (var bvi = 0; bvi < updates.length; bvi++) {
      var bvItem = updates[bvi];
      if (!bvItem || !bvItem.id) continue;
      var bvFields = {};
      Object.keys(bvItem).forEach(function(k) { if (k !== 'id') bvFields[k] = bvItem[k]; });
      var bvErrs = validateTaskInput(bvFields);
      if (bvErrs.length > 0) {
        return res.status(400).json({ error: 'Update item ' + bvi + ' (' + bvItem.id + '): ' + bvErrs.join('; ') });
      }
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
        var qRow = taskToRow(qFields, req.user.id, qTz, qExisting);
        delete qRow.user_id;
        delete qRow.created_at;
        delete qRow._pendingTimeOnly;

        // Normalize: clearing date_pinned without changing when → strip 'fixed'
        if (qRow.date_pinned === 0 && qFields.when === undefined && qExisting) {
          var _qExWhen = qExisting.when || '';
          if (_qExWhen.split(',').some(function(t) { return t.trim() === 'fixed'; })) {
            qRow.when = _qExWhen.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t && t !== 'fixed'; }).join(',');
          }
        }

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
      // If any scheduling-field updates were queued, defer the SSE emit —
      // the queue flush will emit post-commit with correct values. If none
      // were, only direct non-scheduling writes happened → skip scheduler.
      enqueueScheduleRun(req.user.id, 'api:batchUpdateTasks', idsToCheck, {
        skipEmit: queuedCount > 0,
        skipScheduler: queuedCount === 0
      });
      return res.json({ updated: updatedCount, queued: queuedCount });
    }

    var anySchedulingInBatch = false;
    for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        updatedCount = 0;
        anySchedulingInBatch = false;
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
            var existing = existingById[id];
            var row = taskToRow(fields, req.user.id, updateTz, existing);
            delete row.user_id;
            delete row.created_at;
            if (!anySchedulingInBatch && hasSchedulingFields(row)) anySchedulingInBatch = true;

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

            // Normalize: clearing date_pinned without changing when → strip 'fixed'
            if (row.date_pinned === 0 && fields.when === undefined && existing) {
              var _exWhen = existing.when || '';
              if (_exWhen.split(',').some(function(t) { return t.trim() === 'fixed'; })) {
                row.when = _exWhen.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t && t !== 'fixed'; }).join(',');
              }
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
                templateUpdate.updated_at = db.fn.now();
                await tasksWrite.updateTaskById(trx, existing.source_id, templateUpdate, req.user.id);
              }
              // If recurrence changed, delete all pending instances so they regenerate
              if (templateUpdate.recur !== undefined || templateUpdate.recurring === 0) {
                await tasksWrite.resetRecurringInstances(trx, req.user.id, existing.source_id, '[BATCH] cycle reset');
                if (templateUpdate.recur === null || templateUpdate.recurring === 0) {
                  await tasksWrite.archiveCompletedInstances(trx, req.user.id, existing.source_id);
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
              if (taskType === 'recurring_template' && (row.recur !== undefined || row.recurring === 0)) {
                await tasksWrite.resetRecurringInstances(trx, req.user.id, id, '[BATCH] cycle reset on template');
                if (row.recur === null || row.recurring === 0) {
                  await tasksWrite.archiveCompletedInstances(trx, req.user.id, id);
                }
              }
            }
            updatedCount++;
          }
        });
        break;
      } catch (err) {
        if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
          await new Promise(function(r) { setTimeout(r, 200 * (attempt + 1)); });
          continue;
        }
        throw err;
      }
    }

    await cache.invalidateTasks(req.user.id);
    enqueueScheduleRun(req.user.id, 'api:batchUpdateTasks', updates.map(function(u) { return u.id; }).filter(Boolean), {
      skipScheduler: !anySchedulingInBatch
    });
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

/**
 * POST /api/tasks/:id/take-ownership
 *
 * Detaches a provider-origin task from its calendar link so Juggler owns
 * the schedule. Marks ledger rows as 'deleted_local' (sync stops without
 * deleting the event from the provider) and returns the updated task.
 */
async function takeOwnership(req, res) {
  try {
    var id = req.params.id;
    var task = await fetchTaskWithEventIds(db, id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    await db.transaction(async function(trx) {
      // Mark all active ledger rows as deleted_local — sync stops, calendar
      // event remains in the provider.
      await trx('cal_sync_ledger')
        .where({ task_id: id, user_id: req.user.id, status: 'active' })
        .update({ status: 'deleted_local', synced_at: trx.fn.now() });

      // Clear event IDs and strip 'fixed' from when / clear date_pinned so the
      // scheduler can place this task freely. Guard is bypassed here because we
      // just removed the cal link in the same transaction.
      var clearFields = { updated_at: trx.fn.now() };
      if (task.gcal_event_id) clearFields.gcal_event_id = null;
      if (task.msft_event_id) clearFields.msft_event_id = null;
      if (task.apple_event_id) clearFields.apple_event_id = null;
      var currentWhen = task.when || '';
      var newWhen = currentWhen.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t && t !== 'fixed'; }).join(',');
      clearFields.when = newWhen;
      clearFields.date_pinned = 0;
      await tasksWrite.updateTaskById(trx, id, clearFields, req.user.id);
    });

    await cache.invalidateTasks(req.user.id);
    var srcMap = buildSourceMap(
      await db('tasks_v').where('user_id', req.user.id)
        .where(function() { this.where('task_type', 'recurring_template').orWhere('recurring', 1); })
        .select()
    );
    var updated = await fetchTaskWithEventIds(db, id, req.user.id);
    enqueueScheduleRun(req.user.id, 'api:takeOwnership', [id]);
    res.json({ task: rowToTask(updated, null, srcMap) });
  } catch (error) {
    console.error('Take ownership error:', error);
    res.status(500).json({ error: 'Failed to take ownership' });
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
  takeOwnership,
  rowToTask,
  taskToRow,
  guardFixedCalendarWhen,
  buildSourceMap,
  fetchTasksWithEventIds,
  ensureProject,
  applySplitDefault,
  TEMPLATE_FIELDS,
  validateTaskInput,
  expandToAllInstanceIds,
  safeParseJSON
};
