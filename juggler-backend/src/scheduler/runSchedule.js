/**
 * runSchedule.js — Load data, run scheduler, persist date moves
 *
 * The DB stores scheduled_at (UTC DATETIME) as the single source of truth.
 * The scheduler works with in-memory task objects that have local date/time/day
 * properties, derived from scheduled_at via rowToTask().
 */

var { createLogger } = require('@raike/lib-logger');
const logger = createLogger('runSchedule');

var db = require('../db');
var tasksWrite = require('../lib/tasks-write');
var { computeChunks } = require('../lib/reconcile-splits');
var unifiedScheduleV2 = require('./unifiedScheduleV2');
var constants = require('./constants');
var { TERMINAL_STATUSES } = require('../lib/task-status');

// v2 is the only scheduler. Kept as a thin wrapper so call sites don't have
// to care about whether a shadow / diff layer exists (makes re-adding one
// later for another migration trivial). The `userId` / `context` args are
// accepted for signature compatibility with the historical shadow wrapper;
// they're unused here.
/**
 * Validate that all pending tasks have required scheduled_at values.
 * This is the scheduled_at-required guard for juggler-cal-history Plan C.
 *
 * Rules:
 * - Recurring templates (task_type='recurring_template') should NOT have scheduled_at
 * - Recurring instances (task_type='recurring_instance') should have scheduled_at
 * - Regular tasks with date/time constraints but no scheduled_at are NEW tasks - OK
 * - Regular tasks that look like they've been scheduled before should have scheduled_at
 * - Terminal statuses are allowed to lack scheduled_at (legacy support, though DB constraint prevents this)
 *
 * @param {Array} allTasks - Array of task objects
 * @throws {Error} If any pending task is missing required scheduled_at
 */
function validateScheduledAt(allTasks) {
  for (var i = 0; i < allTasks.length; i++) {
    var task = allTasks[i];
    
    // Recurring templates should NOT have scheduled_at - that's correct
    if (task.taskType === 'recurring_template') {
      continue; // Skip validation for templates
    }
    
    // Recurring instances: skip scheduled_at validation entirely.
    // The reconciler creates instances without scheduled_at; the scheduler
    // assigns it on first placement. Throwing here blocks the scheduler from
    // ever running on new instances (chicken-and-egg). Post-run validation
    // is the right place to enforce scheduled_at on placed instances.
    if (task.taskType === 'recurring_instance') {
      continue;
    }
    
    // Only validate pending tasks (empty status)
    // Terminal statuses are handled by DB constraint (Phase A)
    if (!task.status || task.status === '') {
      // Recurring instances are handled above, so this is a regular task
      // Regular tasks without scheduled_at are NEW tasks - that's OK
      // The scheduler will assign scheduled_at during placement
      if (!task.scheduledAt && !task.scheduled_at) {
        // This is a new task without scheduling - perfectly valid
        // The scheduler will assign scheduled_at during placement
        continue;
      }
      // If we get here, the task has scheduled_at - validation passes
    }
  }
}

function runSchedulerWithShadow(allTasks, statuses, todayKey, nowMins, cfg, clock /*, userId, context */) {
  // Wave C: scheduled_at-required guard
  validateScheduledAt(allTasks);
  return unifiedScheduleV2(allTasks, statuses, todayKey, nowMins, cfg, clock);
}
var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DEFAULT_TOOL_MATRIX = constants.DEFAULT_TOOL_MATRIX;
var DAY_NAMES = constants.DAY_NAMES;
var SCHEDULER_VERSION = constants.SCHEDULER_VERSION;
var RECUR_EXPAND_DAYS = constants.RECUR_EXPAND_DAYS;
var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var isoToDateKey = dateHelpers.isoToDateKey;
var parseTimeToMinutes = dateHelpers.parseTimeToMinutes;
var timeBlockHelpers = require('./timeBlockHelpers');
var getBlocksForDate = timeBlockHelpers.getBlocksForDate;

/**
 * computeIsPastDue — single source of truth for the floating-exclusion gate.
 * 999.671: floating tasks (no deadline, overdue=0) have no firm commitment;
 * a stale past date is NOT "past due". Only deadline-bearing or already-flagged
 * (overdue=1) tasks can be isPastDue.
 *
 * Both synthesis sites (primary :1825 and cache :2202) call this helper so they
 * CANNOT silently diverge.
 *
 * @param {object} t           - task object (fields: deadline, overdue, date, time)
 * @param {number|null} scheduledMins - parsed minutes from t.time (null if no time)
 * @param {object} timeInfo    - scheduler time context (todayKey, nowMins)
 * @returns {boolean}
 */
function computeIsPastDue(t, scheduledMins, timeInfo) {
  // R50.0: a fixed / ingested-calendar event's scheduled_at IS its hard due
  // date/time — it becomes past-due the moment that time passes, even with no
  // explicit deadline. So `fixed` is a hard commitment alongside deadline/overdue.
  // Floating tasks (no deadline, not fixed, overdue=0) stay excluded per 999.671.
  var hasHardCommitment = t.deadline || t.overdue ||
    t.placementMode === PLACEMENT_MODES.FIXED;
  return hasHardCommitment &&
    scheduledMins != null &&
    t.date != null &&
    t.date !== 'TBD' &&
    (t.date < timeInfo.todayKey ||
      (t.date === timeInfo.todayKey && scheduledMins < timeInfo.nowMins));
}
var formatMinutesToTime = dateHelpers.formatMinutesToTime;
var formatMinutesToTimeDb = dateHelpers.formatMinutesToTimeDb;
var localToUtc = dateHelpers.localToUtc;
var utcToLocal = dateHelpers.utcToLocal;
// Task row↔object mappers are routed through the scheduler slice's
// SchedulerTaskProvider (H6 W2), which sources the byte-identical mappers from the
// task slice facade — CUTTING the legacy direct dependency on the task-controller
// module that this file held at lines 92-95 (rowToTask/buildSourceMap/taskToRow).
// The mappers are the SAME function objects the task slice owns; the golden-master
// proves placements stay bit-for-bit identical.
var SchedulerTaskProvider = require('../slices/scheduler/adapters/SchedulerTaskProvider');
var _taskProvider = new SchedulerTaskProvider();
var rowToTask = _taskProvider.rowToTask;
var buildSourceMap = _taskProvider.buildSourceMap;
var _taskToRow = _taskProvider.taskToRow;
// H6 / W3 — the sole persist I/O orchestrator. Every scheduler DB write below
// routes through this command's W2 adapters (writeChanged / deleteTasksWhere /
// backfillRollingAnchorIfNull / now); the inline knex flush + the 19 inline
// db.fn.now() are gone (P1). The command NEVER imports scheduleQueue (S4/S6) —
// deadlock-retry + sync-lock stay here in runScheduleAndPersist / its caller.
var RunScheduleCommand = require('../slices/scheduler/application/RunScheduleCommand');
var _runScheduleCommand = new RunScheduleCommand();
var expandRecurringShared = require('../../../shared/scheduler/expandRecurring');
var expandRecurring = expandRecurringShared.expandRecurring;

// 999.013: compute dayMinutes from cfg.timeBlocks — maps dateKey strings to total
// available minutes on that day (sum of all time block durations). Returns null
// when timeBlocks is absent/unusable so expandRecurring skips budget capping.
function computeDayMinutes(timeBlocks, startDate, endDate, cfg) {
  if (!timeBlocks || typeof timeBlocks !== 'object') return null;
  var result = {};
  var cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  var end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  while (cursor <= end) {
    var dk = formatDateKey(cursor);
    var dayName = DAY_NAMES[cursor.getDay()];
    var blocks = timeBlocks[dayName];
    // Use getBlocksForDate to respect schedule overrides when cfg is provided
    if (cfg && (cfg.scheduleTemplates || cfg.locScheduleOverrides)) {
      blocks = getBlocksForDate(dk, timeBlocks, cfg);
    }
    if (!blocks || !blocks.length) {
      blocks = DEFAULT_TIME_BLOCKS[dayName] || [];
    }
    var total = 0;
    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (b && typeof b.start === 'number' && typeof b.end === 'number') {
        total += Math.max(0, b.end - b.start);
      }
    }
    result[dk] = total;
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}
var reconcile = require('./reconcileOccurrences');
var cache = require('../lib/redis');
var { PLACEMENT_MODES } = require('../lib/placementModes');

var DEFAULT_TIMEZONE = constants.DEFAULT_TIMEZONE;

// NOTE (W3 DB single source): syncLock, isAllDayTaskBackend and the
// injectTerminalPlacements() helper were removed alongside getSchedulePlacements
// — they were used only by that deleted read path. The schedule_cache WRITE in
// runScheduleAndPersist (an internal detail only cal-sync reads) is unaffected.

/**
 * juggler-cal-history Plan C — compute window-close UTC for a recurring instance.
 * Returns Date when scheduled_at + timeFlex marks the moment the placement window closed.
 * Used by the past-window auto-mark block (status: 'missed' write below) and exported for
 * the cal-history cron's matching logic in `shared/scheduler/missedHelpers.js`.
 *
 * @param task — task object with `scheduledAt` (camelCase, rowToTask) or `scheduled_at` (snake_case, raw row)
 * @param _today — current date (kept for parity with caller signatures; not used)
 * @param _tz — timezone (kept for parity; window math is UTC-pure)
 * @returns Date | null — null when scheduled_at is missing
 */
function computeWindowCloseUtc(task, _today, _tz) {
  var sa = task && (task.scheduledAt || task.scheduled_at);
  if (!sa) return null;
  var saDate = new Date(sa);
  if (isNaN(saDate.getTime())) return null;
  var flexMin = (task.timeFlex != null) ? task.timeFlex : 60;
  return new Date(saDate.getTime() + flexMin * 60 * 1000);
}

var _ConstraintSolver = require('../slices/scheduler/domain/logic/ConstraintSolver');
var recurringCycleDays = _ConstraintSolver.recurringCycleDays;

/**
 * R50.0 — the recurrence-PERIOD boundary is a recurring instance's IMPLIED
 * deadline (recurring instances carry no explicit `deadline`). It is the value the
 * overdue/missed logic acts on:
 *   - Day-locked instance (timesPerCycle ≥ selected days, or no TPC) → end of its
 *     OCCURRENCE DAY: the deadline is the next day (cycle = 1).
 *   - Flexible-TPC instance (timesPerCycle < selected days → it may roam within the
 *     cycle) → end of its CYCLE: occurrence + cycleLen. It is NOT missed until the
 *     whole cycle has passed (it could still be completed on a later cycle day).
 * Day-locked instance (timesPerCycle ≥ selected days, or no TPC) → end of its
 * occurrence DAY (cycle = 1). Flexible-TPC instance (timesPerCycle < selected
 * days → may roam within the cycle) → end of its CYCLE (occurrence + cycleLen).
 * Returns the dateKey of the FIRST day past the period (instance is live through
 * periodEnd−1, missed ON periodEnd). Null when not recurring or no occurrence date.
 * (The separate timeFlex placement window is applied by the caller alongside this.)
 */
function recurringPeriodEndKey(recur, occurrenceDateKey) {
  var occ = parseDate(occurrenceDateKey);
  if (!occ) return null;
  var r = recur;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_e) { r = null; } }
  var cycleDays = 1; // day-locked default: deadline = end of the occurrence day
  if (r && r.timesPerCycle && r.timesPerCycle > 0) {
    // selectedDays = how many days the recurrence picks from. The `r.days ||
    // 'MTWRF'` / `r.monthDays || [1,15]` shape-defaults are NOT data fallbacks —
    // they are byte-identical to unifiedScheduleV2's isFlexibleTpc (:457/:462), the
    // single source for flexible-vs-day-locked classification; a missing field is a
    // malformed recur and these defaults only affect that classification (never
    // corrupt data). Unrecognised types (incl. `interval`) → selectedDays 1 → never
    // flexible → day-locked, matching isFlexibleTpc.
    var selectedDays;
    if (r.type === 'daily') selectedDays = 7;
    else if (r.type === 'weekly' || r.type === 'biweekly') {
      var days = r.days || 'MTWRF';
      selectedDays = (typeof days === 'object' && !Array.isArray(days)) ? Object.keys(days).length
        : (typeof days === 'string' ? days.length : 0);
    } else if (r.type === 'monthly') { selectedDays = (r.monthDays || [1, 15]).length; }
    else { selectedDays = 1; }
    if (r.timesPerCycle < selectedDays) { // flexible-TPC → roams within the cycle
      cycleDays = recurringCycleDays(r) || 1;
    }
  }
  var end = new Date(occ.getTime());
  end.setDate(end.getDate() + cycleDays);
  return formatDateKey(end);
}

/**
 * Get current date/time in user's timezone — delegated to the shared contract
 * (shared/scheduler/getNowInTimezone.js, W1 R50.8). The local duplicate is
 * removed; all callers continue to receive {todayKey, nowMins} unchanged.
 * (todayDate is also available but unused by the scheduler path.)
 */
var getNowInTimezone = require('../../../shared/scheduler/getNowInTimezone').getNowInTimezone;

/**
 * Load user config values from DB and assemble into scheduler cfg object
 */
async function loadConfig(userId) {
  // user_config holds JSON-blob settings (time_blocks, preferences, etc).
  // The `locations` user setting lives in its own table (matching the
  // shape exposed by getAllConfig in config.controller.js); the scheduler
  // needs lat/lon from there to load weather forecasts for weather-constrained
  // tasks. Reading `config.locations` from user_config silently produced an
  // empty array, which made `loadWeatherForHorizon` skip and weatherOk
  // fail-open for every weather-constrained task.
  var [rows, locRows] = await Promise.all([
    db('user_config').where('user_id', userId).select(),
    db('locations').where('user_id', userId).orderBy('sort_order')
  ]);
  var config = {};
  rows.forEach(function(row) {
    var val = typeof row.config_value === 'string'
      ? JSON.parse(row.config_value) : row.config_value;
    config[row.config_key] = val;
  });

  var locations = locRows.map(function(l) {
    return {
      id: l.location_id,
      name: l.name,
      icon: l.icon,
      lat: l.lat != null ? parseFloat(l.lat) : undefined,
      lon: l.lon != null ? parseFloat(l.lon) : undefined,
      displayName: l.display_name || undefined
    };
  });

  return {
    timeBlocks: config.time_blocks || DEFAULT_TIME_BLOCKS,
    toolMatrix: config.tool_matrix || DEFAULT_TOOL_MATRIX,
    locSchedules: config.loc_schedules || {},
    locScheduleDefaults: config.loc_schedule_defaults || {},
    locScheduleOverrides: config.loc_schedule_overrides || {},
    hourLocationOverrides: config.hour_location_overrides || {},
    scheduleTemplates: config.schedule_templates || null,
    preferences: config.preferences || {},
    splitDefault: config.preferences ? config.preferences.splitDefault : undefined,
    splitMinDefault: config.preferences ? config.preferences.splitMinDefault : undefined,
    locations: locations
  };
}

/**
 * Run the scheduler and persist date moves to the DB.
 *
 * The scheduler reads current scheduled_at values and places tasks from
 * scratch. Only tasks whose scheduled_at actually changed are written back.
 * Pinned, fixed, marker, and template tasks are never modified.
 *
 * Returns stats: { updated, cleared, tasks: [...] }
 */
// Per-user mutex to prevent concurrent scheduler runs (Redis-based for multi-process safety)
var _LOCK_TTL_MS = 30000; // 30s max lock hold time
async function _acquireSchedulerLock(_userId) { /* unused */ }
async function _releaseSchedulerLock(userId) {
  var lockKey = 'sched_lock:' + userId;
  try { await cache.getClient().del(lockKey); } catch (_e) { /* fail open */ }
}

// Weather provider injection - default to the real SchedulerWeatherProvider
// but allow injection of FakeWeatherProvider for testing
var SchedulerWeatherProvider = require('../slices/scheduler/adapters/SchedulerWeatherProvider');
var _weatherProvider = new SchedulerWeatherProvider();

/**
 * Set a custom weather provider for testing purposes
 * @param {WeatherProviderPort} provider - Weather provider implementing WeatherProviderPort interface
 */
function setWeatherProvider(provider) {
  if (provider && typeof provider.loadWeatherForHorizon === 'function') {
    _weatherProvider = provider;
  }
}

/**
 * Get the current weather provider
 * @returns {WeatherProviderPort} Current weather provider
 */
function getWeatherProvider() {
  return _weatherProvider;
}

// ── DELTA-WRITE comparison (H6 W2) ───────────────────────────────────────────
// Normalizers + the placement-vs-DB-row equality used by the delta-write skip.
// The contract: return TRUE only when the DB row ALREADY EQUALS the computed
// placement for EVERY field the dbUpdate would write (so writing is a no-op).
// Return FALSE on any difference OR any field we cannot confidently compare —
// false → a real write happens, which is always safe (it never skips a genuine
// change; the worst case is a redundant write, matching legacy write-all).

// scheduled_at: compare to ms precision. The computed value is a JS Date (UTC);
// the DB DATETIME comes back as a Date (mysql2) or a "YYYY-MM-DD HH:MM:SS" string
// (UTC, no zone). Normalize both to epoch-ms.
function _schedAtMs(v) {
  if (v == null) return null;
  if (v instanceof Date) { var t = v.getTime(); return isNaN(t) ? NaN : t; }
  var s = String(v);
  // Bare "YYYY-MM-DD HH:MM:SS" → treat as UTC (the DB stores UTC).
  var m = s.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/);
  var iso = m ? s.replace(' ', 'T').slice(0, 19) + 'Z' : s;
  var t2 = new Date(iso).getTime();
  return isNaN(t2) ? NaN : t2;
}

// date: DB DATE → "YYYY-MM-DD" (string) or Date. The computed value is an ISO
// dateKey "YYYY-MM-DD". Normalize both to "YYYY-MM-DD".
function _dateKeyOf(v) {
  if (v == null) return null;
  if (v instanceof Date) return formatDateKey(v);
  var s = String(v);
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

// time: DB TIME → "HH:MM:SS". The computed value is "HH:MM:00" (formatMinutesToTimeDb).
function _timeOf(v) {
  if (v == null) return null;
  var s = String(v);
  var m = s.match(/^(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : s;
}

// tinyint flags: DB returns 0/1/null. Computed: null (unscheduled), 0 (overdue).
// Treat null and 0 as the SAME "not set" state for unscheduled (the DB default
// for a placed task is unscheduled=0 or null — both mean "on the calendar").
function _flagOf(v) {
  if (v == null) return 0;
  return Number(v) ? 1 : 0;
}

function placementMatchesDbRow(dbUpdate, rawRow) {
  if (!rawRow) return false; // no DB row to compare → must write

  // scheduled_at (always present in a placement dbUpdate).
  var a = _schedAtMs(dbUpdate.scheduled_at);
  var b = _schedAtMs(rawRow.scheduled_at);
  if (a == null || b == null || isNaN(a) || isNaN(b) || a !== b) return false;

  // date.
  if (_dateKeyOf(dbUpdate.date) !== _dateKeyOf(rawRow.date)) return false;

  // day (varchar — direct compare, null-normalized).
  if ((dbUpdate.day || null) !== (rawRow.day || null)) return false;

  // time.
  if (_timeOf(dbUpdate.time) !== _timeOf(rawRow.time)) return false;

  // unscheduled / overdue flags (the dbUpdate sets unscheduled:null, overdue:0).
  if (_flagOf(dbUpdate.unscheduled) !== _flagOf(rawRow.unscheduled)) return false;
  if (_flagOf(dbUpdate.overdue) !== _flagOf(rawRow.overdue)) return false;

  // DB-single-source (W1) partition-leak fix (ernie/cookie): a row reaching this
  // PLACEMENT skip is being placed → it carries no unplaced reason. The placement
  // dbUpdate doesn't set these cols; the batched persist clears them to null on
  // write. So a stale non-null reason left on the DB row from a prior run (when it
  // was unplaceable) must count as a MISMATCH here — otherwise the skip drops the
  // clearing write and the placed row keeps a phantom reason (one-row-one-state
  // violation). Comparing against the dbUpdate's (absent → null) value forces the
  // write once, then matches on the next run (idempotent-on-stable invariant kept).
  if ((dbUpdate.unplaced_reason || null) !== (rawRow.unplaced_reason || null)) return false;
  if ((dbUpdate.unplaced_detail || null) !== (rawRow.unplaced_detail || null)) return false;

  // dur (only when the dbUpdate writes it).
  if (Object.prototype.hasOwnProperty.call(dbUpdate, 'dur')) {
    if (Number(dbUpdate.dur) !== Number(rawRow.dur)) return false;
  }

  // NOTE: slack_mins is intentionally NOT compared here. The legacy batched
  // persist (runSchedule.js:1714-1773) silently drops slack_mins from the CASE
  // update even when dbUpdate carries it. Comparing slack_mins here would cause
  // a perpetual mismatch on rows where slack changed — triggering redundant
  // writes that still don't persist slack_mins (the batch drops it). The skip
  // logic must only compare fields the live write path ACTUALLY persists.

  return true; // every written field already matches → skip the write
}

async function runScheduleAndPersist(userId, _retries, options) {
  var retries = _retries || 0;
  var MAX_RETRIES = 3;

  // Timezone from frontend (X-Timezone header) via options, or fallback
  var TIMEZONE = (options && options.timezone) || DEFAULT_TIMEZONE;

  try {
  return await db.transaction(async function(trx) {

  // Per-phase timing. Each checkpoint captures cumulative elapsed ms from
  // transaction start; the summary log at the end shows phase-by-phase
  // deltas so we can find where time is going without a profiler.
  var tPerfStart = Date.now();
  var tPerf = { loadEnd: 0, expandEnd: 0, reconcileEnd: 0, scheduleEnd: 0, persistEnd: 0 };

  // Note: Non-recurring split tasks are now handled by inline expansion in
  // unifiedScheduleV2 (placeSplitInline) — split on demand as needed. The
  // reconcileSplitsForUser() call has been removed per ROADMAP 999.097.
  // Recurring split tasks continue to be handled by the Phase 1 upfront
  // INSERT path in step 5b below (pre-insert before scheduling).

  // 1. Load schedulable tasks + templates + terminal-dedup + user config in
  //    parallel. All three are read-only and independent; serial awaits were
  //    adding the three queries' latencies on top of each other. Config uses
  //    its own connection (db) while the task rows use the transaction (trx)
  //    so the scheduler still sees a consistent snapshot.
  var _loadStart = Date.now();
  var _p_taskRows = trx('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        // R55: a soft-cancelled or disabled recurring_template must NOT be loaded
        // for expansion — cancel-series stops fabrication while keeping past rows.
        .orWhere(function() {
          this.where('task_type', 'recurring_template')
            .whereNotIn('status', ['cancelled', 'disabled']);
        });
    })
    .select();
  // Pull scheduled_at alongside date so we can fall back when date is NULL.
  // Some legacy / partially-created rows end up with NULL date but a valid
  // scheduled_at. Without the fallback, skip/cancel/done on those rows
  // doesn't block expansion of the same occurrence — and a fresh pending
  // instance reappears on the next scheduler run.
  var _p_terminalDedupRows = trx('task_instances').where('user_id', userId)
    .whereNotNull('master_id')
    .whereIn('status', TERMINAL_STATUSES)
    .select('master_id as source_id', 'date', 'scheduled_at', 'occurrence_ordinal', 'id');
  // Cross-cycle spacing history: latest `done` placement date per recurring
  // master. Only `done` counts — `skip` / `cancel` mean the user opted out
  // of that slot and shouldn't be treated as the real cadence (else a user
  // who skips a week would be blocked from re-scheduling earlier than
  // minGap days later). Pending instances are excluded because they include
  // the rows we are about to place; within-run placements contribute via
  // noteMasterPlacement in v2. See docs/RECURRING-SPACING-DESIGN.md.
  var _p_recurHistory = trx('task_instances').where('user_id', userId)
    .whereNotNull('master_id')
    .whereNotNull('date')
    .where('status', 'done')
    .select('master_id')
    .max('date as latest_date')
    .groupBy('master_id');
  var _p_cfg = loadConfig(userId);
  var _loaded = await Promise.all([_p_taskRows, _p_terminalDedupRows, _p_recurHistory, _p_cfg]);
  var taskRows = _loaded[0];
  var terminalDedupRows = _loaded[1];
  var recurHistoryRows = _loaded[2];
  var _preloadedCfg = _loaded[3];
  var recurringHistoryByMaster = {};
  recurHistoryRows.forEach(function(r) {
    if (!r.master_id || !r.latest_date) return;
    var dk = isoToDateKey(r.latest_date);
    if (dk) recurringHistoryByMaster[r.master_id] = dk;
  });
  _preloadedCfg.recurringHistoryByMaster = recurringHistoryByMaster;
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
  // Inject terminal dedup data as synthetic entries so expandRecurring skips
  // those dates. Derive date from scheduled_at when the DB `date` column is
  // NULL — common for legacy rows and for instances created through paths
  // that set scheduled_at but didn't backfill the denormalized date column.
  terminalDedupRows.forEach(function(r) {
    if (!r.source_id) return;
    var dateKey = isoToDateKey(r.date);
    if (!dateKey && r.scheduled_at) {
      var local = utcToLocal(r.scheduled_at, TIMEZONE);
      if (local && local.date) dateKey = local.date;
    }
    if (!dateKey) return;
    allTasks.push({ id: '_dedup_' + r.source_id + '_' + dateKey, sourceId: r.source_id, date: dateKey, taskType: 'recurring_instance', text: '', status: 'done' });
  });

  // Backfill: rolling tasks whose rolling_anchor is null because the last
  // completion happened before the rolling-anchor feature shipped (2026-05-20).
  // Without an anchor, getAnchor() falls back to recurStart, and the arithmetic
  // projection can land on a date that violates the spacing guarantee. Use the
  // latest done date from recurringHistoryByMaster as the in-memory anchor, and
  // persist it so subsequent runs don't repeat the work.
  var _rollingBackfills = [];
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_template') return;
    if (!t.recur || t.recur.type !== 'rolling') return;
    if (t.rollingAnchor) return; // already set — normal path
    var latestDone = recurringHistoryByMaster[t.id];
    if (!latestDone) return;
    t.rollingAnchor = latestDone; // fix in-memory for this run
    _rollingBackfills.push({ id: t.id, anchor: latestDone });
  });
  if (_rollingBackfills.length > 0) {
    var _backfillCounts = await Promise.all(_rollingBackfills.map(function(b) {
      // H6 / W3: rolling-anchor backfill via the repository (updated_at = new
      // Date(), P1 — the legacy trx.fn.now() corrected). T-TX: trx-bound.
      return _runScheduleCommand.backfillRollingAnchor(trx, userId, b.id, b.anchor);
    }));
    var _backfillActual = _backfillCounts.reduce(function(s, n) { return s + (n || 0); }, 0);
    logger.info('[SCHED] rolling_anchor backfill: ' + _backfillActual + '/' + _rollingBackfills.length + ' written: ' +
      _rollingBackfills.map(function(b) { return b.id + '→' + b.anchor; }).join(', '));
  }

  // 2a. Normalize empty `when` to all five standard day windows. Users treat
  // no-when-set as "place whenever," not "skip scheduling" — the placement
  // phase requires a non-empty when-tag to match against day windows.
  var ALL_WINDOWS = 'morning,lunch,afternoon,evening,night';
  allTasks.forEach(function(t) {
    if (t.when == null || t.when === '') t.when = ALL_WINDOWS;
  });

  // 2b. Derive per-chunk placement brackets for recurring instances.
  // Use the task's date field (or _candidateDate from expandRecurring) to
  // determine the occurrence date. Master.recur's type drives the flex window:
  //   daily    → 0 days  (strict same-day)
  //   weekly   → 6 days  (Mon→Sun anchor)
  //   monthly  → 27 days (~end of month)
  //   every_N  → N-1 days
  // earliest_start = occurrence date; due = earliest_start + flex.
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_instance' || !t.sourceId) return;
    var master = srcMap[t.sourceId];
    if (!master) return;
    // Determine occurrence date from the task's date field or _candidateDate.
    // Legacy IDs encode the date as YYYYMMDD suffix; new ordinal IDs don't.
    var occDate = t._candidateDate || t.date;
    if (!occDate) {
      // Fallback: try parsing date from legacy ID format
      var m = String(t.id).match(/-(\d{8})(?:-\d+)?$/);
      if (m) {
        var y = parseInt(m[1].slice(0, 4), 10);
        var mo = parseInt(m[1].slice(4, 6), 10);
        var dd = parseInt(m[1].slice(6, 8), 10);
        occDate = formatDateKey(new Date(y, mo - 1, dd));
      }
    }
    if (!occDate) return;
    var occ = parseDate(occDate);
    if (!occ) return;
    var recur = master.recur || {};
    var type = (recur.type || '').toLowerCase();
    var flex = 0;
    if (type === 'weekly') flex = 6;
    else if (type === 'monthly') flex = 27;
    else if (type === 'every' || type === 'every_n') {
      var every = Number(recur.every) || 1;
      flex = Math.max(0, every - 1);
    }
    var dueDate = new Date(occ); dueDate.setDate(dueDate.getDate() + flex);
    t.earliestStart = formatDateKey(occ);
    t.deadline = formatDateKey(dueDate);
    if (!t.date) {
      t.date = t.earliestStart;
      t.day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][occ.getDay()];
    }
  });

  // 3. Build statuses map
  var statuses = {};
  allTasks.forEach(function(t) {
    statuses[t.id] = t.status || '';
  });

  // 4. Get current date/time in user's timezone
  var timeInfo = getNowInTimezone(TIMEZONE, _runScheduleCommand.clock);

  // 5. Config was loaded in parallel with tasks above.
  var cfg = _preloadedCfg;
  cfg.timezone = TIMEZONE;

  tPerf.loadEnd = Date.now() - tPerfStart;

  // 5b. Unified reconcile — recurring-instance expansion PLUS split chunks
  // in one pass. Each master with split=1 produces K chunks per occurrence
  // (computeChunks derives {split_ordinal, dur}). Chunk IDs are deterministic:
  //   split_ordinal=1 → "<masterId>-YYYYMMDD" (from expandRecurring)
  //   split_ordinal=N>=2 → "<masterId>-YYYYMMDD-N"
  // All chunks of one occurrence share the same occurrence_ordinal.
  //
  // This replaces the prior two-pass design (expand-then-split-reconcile) that
  // thrashed because the expand pass deleted chunk rows it didn't recognize.
  var today = parseDate(timeInfo.todayKey) || _runScheduleCommand.clockNow();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + RECUR_EXPAND_DAYS);

  // Index existing recurring_instance rows. Track pending (placeable) and the
  // full set (any status) for ordinal preservation + existence lookup.
  // `pendingBookedByDate` is additionally passed to expandRecurring so the
  // timesPerCycle slot accounting can treat pending instances as already
  // "filling" cycle slots. Without this, a user who skipped M+W+F of a
  // tpc=4 weekly pattern saw the scheduler pick a fresh 4th date every run
  // (skipped count = 3, slotsNeeded = 4-3 = 1, new instance created →
  // user skips → repeat).
  var existingPendingIds = {};
  var existingById = {}; // id -> { occ, status, master_id }
  var rowsByIdForReconcile = {}; // id -> full raw row (for dur/merge-survivor checks)
  var maxOrdByMaster = {};
  var pendingBookedByDate = {}; // `${masterId}|${date}` -> true (pending only)
  taskRows.forEach(function(r) {
    if (r.task_type !== 'recurring_instance') return;
    rowsByIdForReconcile[r.id] = r;
    existingById[r.id] = {
      occ: Number(r.occurrence_ordinal) || 0,
      status: r.status,
      master_id: r.master_id || r.source_id
    };
    if (!r.status || r.status === '') existingPendingIds[r.id] = true;
    var mid = r.master_id || r.source_id;
    if (mid) {
      var o = Number(r.occurrence_ordinal) || 0;
      if (o > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = o;
      // Also track the numeric suffix of the instance ID. IDs from prior runs
      // may have suffixes higher than occurrence_ordinal (they diverge when
      // collision-dropped desired occurrences leave holes in the ordinal space
      // while the actual inserted IDs advance further). If nextOrd starts below
      // an existing ID suffix, the new desired occurrence gets an ID that
      // matches an existing pending instance — existingPendingIds rejects it,
      // silently dropping the new instance from the calendar.
      var idSuffix = String(r.id).match(/-(\d+)(?:-\d+)?$/);
      if (idSuffix) {
        var idNum = Number(idSuffix[1]);
        if (idNum > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = idNum;
      }
    }
    // Record pending dates so tpc slot accounting can count them as booked.
    if (mid && (!r.status || r.status === '') && r.date) {
      var pdkey = isoToDateKey(r.date);
      if (pdkey) pendingBookedByDate[mid + '|' + pdkey] = true;
    }
  });

  // Include terminal (done/skip/cancel) rows in maxOrdByMaster so new ordinals
  // never collide with completed occurrences. Pending rows are already handled
  // above; terminal rows are excluded from taskRows but their ordinals are just
  // as reserved.
  terminalDedupRows.forEach(function(r) {
    var mid = r.source_id;
    if (!mid) return;
    var o = Number(r.occurrence_ordinal) || 0;
    if (o > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = o;
    var idSuffix = String(r.id).match(/-(\d+)(?:-\d+)?$/);
    if (idSuffix) {
      var idNum = Number(idSuffix[1]);
      if (idNum > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = idNum;
    }
  });

  // expandRecurring skips generating an instance whose (sourceId, date) already
  // appears in allTasks. Hide pending chunks from that input so the expansion
  // is authoritative (we rebuild the full desired set below).
  var allTasksForExpand = allTasks.filter(function(t) {
    if (t.taskType !== 'recurring_instance') return true;
    return !existingPendingIds[t.id];
  });
  // 999.013: compute dayMinutes from cfg.timeBlocks for budget-aware TPC expansion
  var dayMinutesMap = computeDayMinutes(cfg.timeBlocks, today, expandEnd, cfg);

  var desiredOccurrences = expandRecurring(allTasksForExpand, today, expandEnd, {
    statuses: statuses,
    maxOrdBySource: maxOrdByMaster,
    pendingBookedByDate: pendingBookedByDate,
    dayMinutes: dayMinutesMap
  });
  var MAX_EXPANDED = 500;
  if (desiredOccurrences.length > MAX_EXPANDED) {
    logger.warn('[SCHED] expansion capped: ' + desiredOccurrences.length + ' → ' + MAX_EXPANDED);
    desiredOccurrences = desiredOccurrences.slice(0, MAX_EXPANDED);
  }
  tPerf.expandEnd = Date.now() - tPerfStart;

  // Build next-tpc-occurrence map so split chunk deadlines can be capped to the
  // interval boundary (day before next occurrence) instead of the full flex window.
  // Without this, a Mon chunk of a Mon/Thu 2x-weekly task could roam all the way
  // to Sunday and compete with Thursday's occurrence for slots.
  var nextTpcOccDateByKey = {}; // key: masterId|occDateKey → next occDateKey (or null)
  (function() {
    var occsByMaster = {};
    desiredOccurrences.forEach(function(occ) {
      var mid = occ.sourceId;
      if (!mid) return;
      var master = srcMap[mid];
      if (!master) return;
      var recur = master.recur || {};
      if (!recur.timesPerCycle || recur.timesPerCycle <= 0) return;
      if (!occsByMaster[mid]) occsByMaster[mid] = [];
      occsByMaster[mid].push(occ.date);
    });
    Object.keys(occsByMaster).forEach(function(mid) {
      var sorted = occsByMaster[mid].slice().sort();
      for (var i = 0; i < sorted.length; i++) {
        nextTpcOccDateByKey[mid + '|' + sorted[i]] = sorted[i + 1] || null;
      }
    });
  })();

  // Fix split-chunk deadlines for tpc tasks. Step 2b used the coarse flex window
  // (e.g. 6 days for weekly). Now that desiredOccurrences is available, cap each
  // split primary chunk's deadline to the day before the next occurrence fires.
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_instance' || !t.sourceId) return;
    if (!t.deadline || !t.splitTotal || t.splitTotal <= 1) return;
    var master = srcMap[t.sourceId];
    if (!master) return;
    var recur = master.recur || {};
    if (!recur.timesPerCycle || recur.timesPerCycle <= 0) return;
    var occDate = t._candidateDate || t.date || t.earliestStart;
    if (!occDate) return;
    var nextKey = nextTpcOccDateByKey[t.sourceId + '|' + occDate];
    if (!nextKey) return;
    var nextOcc = parseDate(nextKey);
    if (!nextOcc) return;
    var dayBefore = new Date(nextOcc);
    dayBefore.setDate(dayBefore.getDate() - 1);
    t.deadline = formatDateKey(dayBefore);
  });

  // ── Date-based reconciliation ──
  // Match existing pending occurrences to target dates by exact-date first,
  // then nearest-first. Preserves instance IDs + occurrence_ordinals across
  // runs so completion state, cal links, and the UI don't churn. Cal-linked
  // rows (gcal/msft) bypass this pool — they pass through the id-based diff
  // unchanged so outbound sync stays correct.
  var existingGroupsByMaster = reconcile.buildExistingGroups(taskRows, parseDate, isoToDateKey);
  var reconResult = reconcile.matchOccurrences(desiredOccurrences, existingGroupsByMaster, parseDate);
  var occIdOverrides = reconResult.occIdOverrides;
  var occurrenceMoves = reconResult.occurrenceMoves;

  // Rewrite matched desired.id to reuse the existing occurrence's primary id.
  // Chunk fanout (below) sees existingById[primaryId] and keeps the original
  // occurrence_ordinal; the existing DB row stays, avoiding ordinal churn.
  desiredOccurrences.forEach(function(occ) {
    var newId = occIdOverrides[occ.id];
    if (newId && newId !== occ.id) occ.id = newId;
  });

  // Mutate matched allTasks entries so the scheduler sees the target date,
  // not the stale existing date. Clearing scheduledAt forces re-placement.
  // Stash `_preReconDate` / `_preReconTime` so the post-placement diff below
  // still sees the pre-move date and emits a proper SSE patch + DB update.
  // Without this, `taskById[id].date` would already be `newDate` at diff time,
  // `dateChanged` would be false, and the frontend would never learn about
  // the move.
  if (occurrenceMoves.length > 0) {
    var moveByChunkId = {};
    occurrenceMoves.forEach(function(mv) {
      mv.chunkIds.forEach(function(cid) { moveByChunkId[cid] = mv; });
    });
    allTasks.forEach(function(t) {
      var mv = moveByChunkId[t.id];
      if (!mv) return;
      t._preReconDate = t.date;
      t._preReconTime = t.time;
      t.date = mv.newDate;
      t._candidateDate = mv.newDate;
      var d = parseDate(mv.newDate);
      if (d) t.day = DAY_NAMES[d.getDay()];
      t.time = null;
      t.earliestStart = null;
      t.deadline = null;
      t.scheduledAt = null;
    });
    logger.info('[SCHED] reconcile: matched ' + occurrenceMoves.length + ' existing occurrence(s) to new target date(s)');
  }

  // Fan out each occurrence into K chunks based on master.split / splitMin.
  var nextOrdByMaster = Object.assign({}, maxOrdByMaster);
  var desiredRows = [];
  desiredOccurrences.forEach(function(occ) {
    var masterId = occ.sourceId;
    var primaryId = occ.id; // <masterId>-<ordinal> (date-agnostic)

    // Determine chunk plan. occ inherits master.split / master.splitMin via
    // expandRecurring's newTasks copy.
    //
    // User-edited `time_remaining` on the existing primary chunk overrides
    // the full master.dur for this occurrence. This lets the user say "I
    // already did 75 of the planned 120 minutes of apply-for-jobs, only 45
    // left to schedule today" and have the scheduler shrink the chunk plan
    // accordingly. Only the PRIMARY chunk (split_ordinal=1) carries the
    // override because that's what the edit form binds to for multi-chunk
    // split tasks.
    var effectiveDur = occ.dur;
    var primaryRow = rowsByIdForReconcile[primaryId];
    if (primaryRow && primaryRow.time_remaining != null) {
      var remaining = Number(primaryRow.time_remaining);
      if (!isNaN(remaining) && remaining >= 0) effectiveDur = remaining;
    }

    var chunks;
    if (occ.split && effectiveDur > 0) {
      chunks = computeChunks(effectiveDur, occ.splitMin);
      if (chunks.length === 0) chunks = [{ splitOrdinal: 1, splitTotal: 1, dur: effectiveDur || 30 }];
    } else {
      chunks = [{ splitOrdinal: 1, splitTotal: 1, dur: effectiveDur || 30 }];
    }

    // Always produce the correct chunk plan — even if a prior run merged
    // chunks into one row. The scheduler places each chunk independently;
    // the post-placement merge step recombines contiguous chunks.
    // If the primary row carries the full master dur from a prior merge,
    // the drift-fix below will correct it back to chunk 1's dur.

    // One occurrence ordinal shared by all chunks of this day.
    var occOrd;
    if (existingById[primaryId]) {
      occOrd = existingById[primaryId].occ;
    } else {
      nextOrdByMaster[masterId] = (nextOrdByMaster[masterId] || 0) + 1;
      occOrd = nextOrdByMaster[masterId];
    }

    chunks.forEach(function(c) {
      var chunkId = c.splitOrdinal === 1 ? primaryId : primaryId + '-' + c.splitOrdinal;
      desiredRows.push({
        id: chunkId,
        sourceId: masterId,
        date: occ.date,
        time: occ.time,
        occurrence_ordinal: occOrd,
        split_ordinal: c.splitOrdinal,
        split_total: chunks.length,
        split_group: chunks.length > 1 ? primaryId : null,
        dur: c.dur,
        _candidateDate: occ._candidateDate || occ.date,
        _tpcBudgetUnscheduled: occ._tpcBudgetUnscheduled || false
      });
    });
  });

  // Diff desired vs existing pending.
  var desiredIds = {};
  var desiredById = {};
  desiredRows.forEach(function(r) { desiredIds[r.id] = true; desiredById[r.id] = r; });
  var toInsert = desiredRows.filter(function(r) { return !existingPendingIds[r.id]; });
  // Grandfather pending instances that fall beyond the expansion horizon.
  // Without this, shrinking RECUR_EXPAND_DAYS would delete legitimate
  // pending rows that were expanded under a prior (larger) horizon.
  // "Reconstruct the sequence" paths (recur-config change in
  // task.controller.js) delete pending rows directly via SQL before the
  // scheduler runs, so they are unaffected by this grandfather clause.
  var toDeleteIds = Object.keys(existingPendingIds).filter(function(id) {
    if (desiredIds[id]) return false;
    var row = rowsByIdForReconcile[id];
    if (row && row.date) {
      var rowDate = parseDate(row.date);
      if (rowDate && rowDate > expandEnd) return false;
      // Spare past pending recurring instances so Phase-9 can freeze them as
      // 'missed' (LOCKED design 999.808 LC-1/LC-2).
      // Any recurring instance (placed or never-placed) that is in the past and
      // still pending must survive to Phase-9 auto-miss — deleting it here would
      // produce "executing 0 DB updates" and lose the slot record entirely.
      // Only protect past recurring instances; future/non-recurring rows continue
      // to follow the normal deletion path.
      if (rowDate && rowDate < today && row.task_type === 'recurring_instance') return false;
    }
    return true;
  });

  // Drift fix: existing pending rows whose (split_ordinal, split_total, dur)
  // don't match the current chunk plan get UPDATEd in place. Covers the case
  // where master.dur or master.split_min changed, or where a prior bug wrote
  // the wrong chunk dur.
  var toUpdate = [];
  // Declared in outer scope so the reconcileChanged rebuild can re-apply these
  // corrections — without this, the rebuild wipes the allTasks patch and the
  // scheduler then places at the old (wrong) dur, which the persist step writes
  // back to the DB, undoing the drift-fix entirely.
  var updateById = {};
  taskRows.forEach(function(r) {
    if (r.task_type !== 'recurring_instance') return;
    if (r.status && r.status !== '') return;
    var want = desiredById[r.id];
    if (!want) return;
    var curSo = Number(r.split_ordinal) || 1;
    var curSt = Number(r.split_total) || 1;
    var curDur = Number(r.dur);
    if (curSo !== want.split_ordinal || curSt !== want.split_total || curDur !== want.dur) {
      toUpdate.push({
        id: r.id,
        changes: { split_ordinal: want.split_ordinal, split_total: want.split_total, dur: want.dur }
      });
    }
  });

  // Preserve the variable names the downstream changeset computation uses.
  var deadIds = toDeleteIds;
  var expanded = toInsert;

  // ── DB reconcile: deletions and drift-fixes only ──
  // Inserts are deferred — chunks are built in memory for the scheduler.
  // Only delete stale rows and fix drifted rows in the DB.
  var reconcileChanged = false;
  if (toDeleteIds.length > 0) {
    // Use db (not trx) so this persists even if the deletion transaction rolls
    // back on lock timeout — the safety-net flag must survive a rollback.
    await db('task_instances').whereIn('id', toDeleteIds).update({ unscheduled: 1, updated_at: _runScheduleCommand.clockNow() });
    await _runScheduleCommand.deleteTasksWhere(trx, userId, function(q) { return q.whereIn('id', toDeleteIds); });
    logger.info('[SCHED] reconcile: deleted ' + toDeleteIds.length + ' stale recurring instances');
    reconcileChanged = true;
  }
  if (toUpdate.length > 0) {
    // Batch drift-fix UPDATEs into CASE-WHEN expressions, chunked to 200 per
    // statement to stay well below MySQL's max_allowed_packet. Each drift-fix
    // touches up to three fields (split_ordinal, split_total, dur) — we only
    // emit CASEs for fields that actually vary in the chunk, skipping no-op
    // columns.
    var DRIFT_CHUNK = 200;
    for (var dci = 0; dci < toUpdate.length; dci += DRIFT_CHUNK) {
      var driftChunk = toUpdate.slice(dci, dci + DRIFT_CHUNK);
      var driftIds = driftChunk.map(function(u) { return u.id; });
      var driftFields = { updated_at: _runScheduleCommand.clockNow() };
      ['split_ordinal', 'split_total', 'dur'].forEach(function(col) {
        var touched = driftChunk.filter(function(u) { return u.changes[col] != null; });
        if (touched.length === 0) return;
        var expr = 'CASE id';
        var bindings = [];
        touched.forEach(function(u) { expr += ' WHEN ? THEN ?'; bindings.push(u.id, u.changes[col]); });
        expr += ' ELSE `' + col + '` END';
        driftFields[col] = trx.raw(expr, bindings);
      });
      await trx('task_instances').whereIn('id', driftIds).update(driftFields);
    }
    toUpdate.forEach(function(u) { updateById[u.id] = u.changes; });
    allTasks.forEach(function(t) {
      var ch = updateById[t.id];
      if (!ch) return;
      if (ch.dur != null) t.dur = ch.dur;
      if (ch.split_ordinal != null) t.splitOrdinal = ch.split_ordinal;
      if (ch.split_total != null) t.splitTotal = ch.split_total;
    });
    logger.info('[SCHED] reconcile: updated ' + toUpdate.length + ' instance rows to match chunk plan');
    reconcileChanged = true;
  }
  if (reconcileChanged) {
    var deletedIds = new Set(toDeleteIds);
    if (deletedIds.size > 0) {
      taskRows = taskRows.filter(function(r) { return !deletedIds.has(r.id); });
    }
    srcMap = buildSourceMap(taskRows);
    allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
    // Re-apply step 2a: the rebuild above wiped any when-normalization done
    // before the reconcile. Tasks with when='' must still get ALL_WINDOWS so
    // the scheduler has a non-empty window set to match against.
    allTasks.forEach(function(t) { if (t.when == null || t.when === '') t.when = ALL_WINDOWS; });
    statuses = {};
    allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
    // Re-apply reconcile move mutations — the reload above rebuilt allTasks
    // from the original taskRows, so the date retargeting from the occurrence
    // reconcile (e.g. user changed recur_start) just got wiped. Without this,
    // the scheduler sees the stale original date and re-places at the old
    // anchor (or leaves it unplaced if the old date is past).
    if (typeof occurrenceMoves !== 'undefined' && occurrenceMoves.length > 0) {
      var moveByChunkIdReapply = {};
      occurrenceMoves.forEach(function(mv) {
        mv.chunkIds.forEach(function(cid) { moveByChunkIdReapply[cid] = mv; });
      });
      allTasks.forEach(function(t) {
        var mv = moveByChunkIdReapply[t.id];
        if (!mv) return;
        t._preReconDate = t.date;
        t._preReconTime = t.time;
        t.date = mv.newDate;
        t._candidateDate = mv.newDate;
        var d2 = parseDate(mv.newDate);
        if (d2) t.day = DAY_NAMES[d2.getDay()];
        t.time = null;
        t.earliestStart = null;
        t.deadline = null;
        t.scheduledAt = null;
      });
    }
    // Re-apply drift-fix chunk-plan corrections. The taskRows rebuild above
    // loaded stale dur/split values from before the DB update — without this
    // the scheduler places at the old dur and the persist step writes it back,
    // permanently undoing the drift-fix.
    if (Object.keys(updateById).length > 0) {
      allTasks.forEach(function(t) {
        var ch = updateById[t.id];
        if (!ch) return;
        if (ch.dur != null) t.dur = ch.dur;
        if (ch.split_ordinal != null) t.splitOrdinal = ch.split_ordinal;
        if (ch.split_total != null) t.splitTotal = ch.split_total;
      });
    }
  }

  // ── Phase 1: Pre-insert all new chunk rows before scheduling ──
  // Ensures every planned chunk has a DB row immediately (for cal sync,
  // per-chunk status, and idempotent next-run loading). scheduled_at starts
  // null; the persist step UPDATEs it for placed chunks.
  // Hoisted so the changeset builder can project full task objects for these
  // rows even though taskRows was loaded before the INSERT.
  var phase1InsertedById = {};
  if (toInsert.length > 0) {
    var chunkInsertRows = toInsert.map(function(row) {
      var occDate = row._candidateDate || row.date || null;
      var occDay = null;
      if (occDate) {
        var occDateObj = parseDate(occDate);
        if (occDateObj) occDay = DAY_NAMES[occDateObj.getDay()];
      }
      // W3 (R50.7): materialize the recurring implied deadline onto the row so
      // the read-time overdue predicate (W4) can compare against it without
      // re-running recurrence logic. Null when not recurring or no occDate.
      // recurringPeriodEndKey handles JSON-string recur internally (line 265).
      var masterRow = srcMap[row.sourceId];
      var impliedDeadline = (masterRow && occDate)
        ? recurringPeriodEndKey(masterRow.recur, occDate)
        : null;
      return {
        id: row.id,
        user_id: userId,
        task_type: 'recurring_instance',
        source_id: row.sourceId,
        occurrence_ordinal: row.occurrence_ordinal,
        split_ordinal: row.split_ordinal,
        split_total: row.split_total,
        split_group: row.split_group || null,
        dur: row.dur,
        generated: 0,
        scheduled_at: null,
        date: occDate,
        day: occDay,
        time: null,
        unscheduled: null,
        status: '',
        implied_deadline: impliedDeadline,
        created_at: _runScheduleCommand.clockNow(),
        updated_at: _runScheduleCommand.clockNow()
      };
    });
    // Defensive dedup: detect any IDs already in DB before inserting.
    // Structurally impossible given the existingPendingIds filter above,
    // but guards against future code changes breaking that invariant.
    var existingChunkCheck = await trx('task_instances')
      .whereIn('id', chunkInsertRows.map(function(r) { return r.id; }))
      .select('id');
    if (existingChunkCheck.length > 0) {
      var existingChunkSet = {};
      existingChunkCheck.forEach(function(r) { existingChunkSet[r.id] = true; });
      logger.error('[SCHED] phase1: collision — ' + existingChunkCheck.length + ' chunk IDs already in DB, skipping:', existingChunkCheck.map(function(r) { return r.id; }));
      chunkInsertRows = chunkInsertRows.filter(function(r) { return !existingChunkSet[r.id]; });
    }
    if (chunkInsertRows.length > 0) {
      await tasksWrite.insertTasksBatch(trx, chunkInsertRows);
      logger.info('[SCHED] phase1: pre-inserted ' + chunkInsertRows.length + ' chunk rows');
    }
    // Populate for changeset projection — taskRows was loaded before this INSERT
    // so rowsById won't have these rows; phase1InsertedById fills the gap.
    // Use an ISO string for created_at/updated_at here: the DB rows were stamped
    // with a JS Date (H6/W3 P1: _runScheduleCommand.clockNow()); rowToTask wants a
    // parseable string for the changeset projection, so normalize to ISO.
    var nowISO = _runScheduleCommand.clockNow().toISOString();
    chunkInsertRows.forEach(function(r) {
      phase1InsertedById[r.id] = Object.assign({}, r, { created_at: nowISO, updated_at: nowISO });
    });
  }

  // ── In-memory chunk expansion ──
  // Build task objects for new/missing chunks directly from master fields.
  // No DB insert — the scheduler works on these in memory. Persist step
  // will INSERT placed chunks after scheduling completes.
  var masterById = {};
  allTasks.forEach(function(t) {
    if (t.taskType === 'recurring_template') masterById[t.id] = t;
  });
  var existingTaskIds = {};
  allTasks.forEach(function(t) { existingTaskIds[t.id] = true; });

  var inMemoryChunks = [];
  toInsert.forEach(function(row) {
    if (existingTaskIds[row.id]) return; // already in allTasks
    var master = masterById[row.sourceId];
    if (!master) return;

    // Build a task object inheriting master fields
    var chunk = {
      id: row.id,
      taskType: 'recurring_instance',
      text: master.text,
      dur: row.dur,
      pri: master.pri,
      project: master.project,
      section: master.section,
      notes: master.notes,
      location: master.location,
      tools: master.tools,
      when: master.when || ALL_WINDOWS,
      dayReq: master.dayReq,
      recurring: true,
      placementMode: master.placementMode,
      timeFlex: master.timeFlex,
      split: master.split,
      splitMin: master.splitMin,
      travelBefore: master.travelBefore,
      travelAfter: master.travelAfter,
      dependsOn: master.dependsOn || [],
      marker: master.marker,
      flexWhen: master.flexWhen,
      recur: master.recur,
      recurStart: master.recurStart,
      recurEnd: master.recurEnd,
      preferredTimeMins: row.split_ordinal === 1 ? master.preferredTimeMins : null,
      sourceId: row.sourceId,
      generated: true,
      date: row.date,
      day: row.date ? DAY_NAMES[parseDate(row.date).getDay()] : null,
      time: row.split_ordinal === 1 ? row.time : null,
      status: '',
      splitOrdinal: row.split_ordinal,
      splitTotal: row.split_total,
      splitGroup: row.split_group || null,
      occurrenceOrdinal: row.occurrence_ordinal,
      earliestStart: null,
      deadline: null,
      scheduledAt: null,
      unscheduled: false,
      _candidateDate: row._candidateDate || row.date,
      _inMemoryChunk: true, // flag for persist step
      _tpcBudgetUnscheduled: row._tpcBudgetUnscheduled || false
    };
    inMemoryChunks.push(chunk);
  });

  if (inMemoryChunks.length > 0) {
    allTasks = allTasks.concat(inMemoryChunks);
    inMemoryChunks.forEach(function(t) { statuses[t.id] = ''; });
    logger.info('[SCHED] in-memory: added ' + inMemoryChunks.length + ' chunk tasks for scheduling');
  }

  // Re-apply placement brackets (earliestStart/deadline) for all recurring instances
  // including in-memory chunks. This was done in step 2b but only for tasks that
  // existed at that point — in-memory chunks need it too.
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_instance' || !t.sourceId) return;
    if (t.earliestStart && t.deadline) return; // already set from step 2b
    var master = masterById[t.sourceId];
    if (!master) { master = srcMap[t.sourceId]; }
    if (!master) return;
    // Use _candidateDate or date field; fallback to legacy ID parsing
    var occDate = t._candidateDate || t.date;
    if (!occDate) {
      var m = String(t.id).match(/-(\d{8})(?:-\d+)?$/);
      if (m) {
        occDate = formatDateKey(new Date(parseInt(m[1].slice(0,4),10), parseInt(m[1].slice(4,6),10)-1, parseInt(m[1].slice(6,8),10)));
      }
    }
    if (!occDate) return;
    var occ = parseDate(occDate);
    if (!occ) return;
    var recur = (master.recur || master.recur_json) || {};
    if (typeof recur === 'string') { try { recur = JSON.parse(recur); } catch(_e) { recur = {}; } }
    var type = (recur.type || '').toLowerCase();
    var flex = 0;
    if (type === 'weekly') flex = 6;
    else if (type === 'monthly') flex = 27;
    else if (type === 'every' || type === 'every_n') {
      var every = Number(recur.every) || 1;
      flex = Math.max(0, every - 1);
    }
    var dueDate = new Date(occ); dueDate.setDate(dueDate.getDate() + flex);
    t.earliestStart = formatDateKey(occ);
    t.deadline = formatDateKey(dueDate);
    // For in-memory split chunks (ordinal 2+) of tpc tasks, cap deadline to the
    // day before the next occurrence so they don't compete with it for slots.
    if (t.splitTotal > 1 && recur.timesPerCycle > 0) {
      var nextKey = nextTpcOccDateByKey[t.sourceId + '|' + formatDateKey(occ)];
      if (nextKey) {
        var nextOcc2 = parseDate(nextKey);
        if (nextOcc2) {
          var dayBefore2 = new Date(nextOcc2);
          dayBefore2.setDate(dayBefore2.getDate() - 1);
          t.deadline = formatDateKey(dayBefore2);
        }
      }
    }
    if (!t.date) {
      t.date = t.earliestStart;
      t.day = DAY_NAMES[occ.getDay()];
    }
    if (t.when == null || t.when === '') t.when = ALL_WINDOWS;
  });

  tPerf.reconcileEnd = Date.now() - tPerfStart;

  // Load weather data for weather-constrained tasks (fail-open if no coords/cache).
  // Detection MUST mirror hasWeatherConstraint() in unifiedScheduleV2.js — otherwise
  // a task whose only constraint is humidity skips the load and fails open silently.
  cfg.weatherByDateHour = {};
  var hasWeatherTasks = allTasks.some(function(t) {
    return (t.weatherPrecip && t.weatherPrecip !== 'any') ||
           (t.weatherCloud  && t.weatherCloud  !== 'any') ||
           t.weatherTempMin != null || t.weatherTempMax != null ||
           t.weatherHumidityMin != null || t.weatherHumidityMax != null;
  });
  if (hasWeatherTasks && cfg.locations && cfg.locations.length > 0) {
    try {
      cfg.weatherByDateHour = await _weatherProvider.loadWeatherForHorizon(cfg.locations, db);
    } catch (_e) {
      cfg.weatherByDateHour = {}; // fail-open: proceed without weather data
    }
  }

  // 6. Run scheduler (primary chosen by SCHEDULER_V2 env var; shadow runs
  //    in parallel when SCHEDULER_V2_SHADOW=true).
  var result = runSchedulerWithShadow(
    allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg, _runScheduleCommand.clock, userId, 'main'
  );
  tPerf.scheduleEnd = Date.now() - tPerfStart;

  // 7. Persist schedule results from dayPlacements
  var updated = 0;
  var updatedTasks = [];

  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Build a map of raw rows by ID for accessing scheduled_at
  var rawRowById = {};
  taskRows.forEach(function(r) { rawRowById[r.id] = r; });

  // Extract the first placement per task from dayPlacements. Phase 1 ensures
  // every split chunk has its own unique row ID, so each task.id maps to
  // exactly one placement. No multi-placement-per-task-id split-master
  // handling needed (that was v1-only behavior).
  var placementByTaskId = {};
  var dayPlacements = result.dayPlacements;

  // ── #42: Merge adjacent split-task chunks ──────────────────────────────────
  // After all placements are determined, collapse back-to-back chunks of the
  // same split occurrence into a single extended placement entry. "Back-to-back"
  // means zero gap: chunk N's start + dur === chunk N+1's start on the same day.
  //
  // Result: one DB row (the primary/first chunk) carries the combined dur.
  // The secondary rows that were merged in are deleted from the DB — they were
  // pre-inserted in Phase 1 but are no longer needed as distinct entries.
  //
  // Rationale: the day view and calendar sync should show one continuous block,
  // not N short tiles/events. If the scheduler placed chunks with gaps between
  // them the chunks remain separate (gap > 0 means the user could fill the gap
  // with something else and the visual split is meaningful).
  var mergedOutIds = []; // secondary chunk IDs whose DB rows should be deleted
  Object.keys(dayPlacements).forEach(function(dateKey) {
    var placements = dayPlacements[dateKey];
    if (!placements || placements.length < 2) return;

    // Track per-day merged IDs to filter only the current day's merged chunks
    var dayMergedIds = [];

    // Collect split-chunk placements grouped by splitGroup.
    // Non-split placements (splitGroup null/undefined) are left untouched.
    var byGroup = {}; // splitGroup → [placementEntry, ...]
    placements.forEach(function(p) {
      if (!p.task) return;
      var sg = p.task.splitGroup;
      if (!sg) return; // not a split chunk
      if (!byGroup[sg]) byGroup[sg] = [];
      byGroup[sg].push(p);
    });

    Object.keys(byGroup).forEach(function(sg) {
      var group = byGroup[sg];
      if (group.length < 2) return; // nothing to merge

      // Sort by start time ascending so we can scan for adjacent pairs.
      group.sort(function(a, b) { return a.start - b.start; });

      // Linear scan: merge consecutive zero-gap pairs.
      // Walk forward; whenever two entries are back-to-back, fold the second
      // into the first (accumulate dur) and mark the second for deletion.
      var i = 0;
      while (i < group.length - 1) {
        var curr = group[i];
        var next = group[i + 1];
        if (curr.start + curr.dur === next.start) {
          // Zero gap — merge next into curr.
          curr.dur += next.dur;
          // Record next's task ID for DB row deletion.
          if (next.task && next.task.id) {
            dayMergedIds.push(next.task.id);
            mergedOutIds.push(next.task.id);
          }
          // Remove next from the group so the scan can continue (handles 3+ chunks).
          group.splice(i + 1, 1);
          // Do NOT advance i: re-check curr against the new group[i+1].
        } else {
          i++;
        }
      }
      // Note: `group` entries are the same object references as in `placements`,
      // so mutating curr.dur already updated the placement list in-place.
      // Entries removed from `group` via splice are still in `placements` — we
      // filter those out below.
    });

    // Remove merged-out entries from the day's placement list so they don't
    // receive a scheduled_at update and don't appear in the outgoing cache/SSE.
    if (dayMergedIds.length > 0) {
      var mergedOutSet = {};
      dayMergedIds.forEach(function(id) { mergedOutSet[id] = true; });
      dayPlacements[dateKey] = placements.filter(function(p) {
        return !(p.task && p.task.id && mergedOutSet[p.task.id]);
      });
    }
  });

  if (mergedOutIds.length > 0) {
    logger.info('[SCHED] split-chunk merge: collapsed ' + mergedOutIds.length + ' adjacent chunk(s) into primary rows');
  }

  Object.keys(dayPlacements).forEach(function(dateKey) {
    var placements = dayPlacements[dateKey];
    if (!placements) return;
    placements.forEach(function(p) {
      if (!p.task || !p.task.id) return;
      if (!placementByTaskId[p.task.id]) {
        placementByTaskId[p.task.id] = { dateKey: dateKey, start: p.start, dur: p.dur };
      }
    });
  });

  // Collect all updates, then batch them to minimize lock contention
  var pendingUpdates = []; // { id, dbUpdate }


  for (var taskId in placementByTaskId) {
    var placement = placementByTaskId[taskId];
    var original = taskById[taskId];
    if (!original) continue;

    var newTime = formatMinutesToTimeDb(placement.start);
    var newTimeDisplay = formatMinutesToTime(placement.start);
    var newDate = placement.dateKey;

    // For reconciled (moved) occurrences, `original.date` was overwritten
    // in-place with the target date so the scheduler could place against it.
    // The TRUE pre-run date lives on `_preReconDate`. Without this shim, the
    // diff would see `newDate === original.date` and skip emitting the SSE
    // patch / DB update even though the task just moved.
    var priorDate = original._preReconDate != null ? original._preReconDate : original.date;
    var priorTime = original._preReconTime != null ? original._preReconTime : original.time;
    // Normalize to ISO so M/D format from rowToTask never produces a false dateChanged.
    var priorDateIso = priorDate ? (formatDateKey(parseDate(priorDate)) || priorDate) : priorDate;
    var dateChanged = newDate !== priorDateIso;
    var timeChanged = newTimeDisplay !== priorTime;

    // Never touch recurring templates — they're blueprints, not schedulable tasks.
    if (original.taskType === 'recurring_template') continue;
    // Fixed tasks are user-anchored — never override their time/date.
    // Exception: still sync dur back to the DB when the scheduler's effective
    // placed duration differs from the stored value. The user pinned the TIME,
    // not the block size. Without this, the cal-sync uses the master's dur
    // (e.g. 30 min) and pushes a 30-min GCal event even though Juggler shows
    // a 3.5-hour block — the "inaccurate split task information" in GCal.
    if (original.placementMode === PLACEMENT_MODES.FIXED) {
      var pinnedPlacedDur = placement.dur;
      var pinnedStoredDur = Number(original.dur) || 0;
      if (pinnedPlacedDur && pinnedPlacedDur !== pinnedStoredDur) {
        pendingUpdates.push({ id: taskId, dbUpdate: { dur: pinnedPlacedDur, updated_at: _runScheduleCommand.clockNow() } });
      }
      continue;
    }
    // Markers are non-blocking — never move them.
    if (original.marker) continue;
    // Recurrings should never have their date moved — they're day-specific.
    // Exceptions:
    //   - Reconcile-initiated moves (e.g. user changed recur_start): reconcile
    //     explicitly retargeted this chunk, so the move is authoritative. The
    //     `_preReconDate` marker signals this case.
    //   - Past recurringTasks within their placement window can be moved to today.
    if (original.recurring && dateChanged && original._preReconDate == null) {
      var origTd = parseDate(original.date);
      var isBehind = origTd && origTd < today;
      var recurFlex = original.timeFlex != null ? original.timeFlex : 60;
      var recurDaysPast = origTd ? Math.round((today.getTime() - origTd.getTime()) / 86400000) : 0;
      if (!isBehind || recurFlex < recurDaysPast * 1440) continue;
      // Within placement window — allow the date move to today
    }
    // Rigid recurringTasks keep their preferred time (unless redirected from past above).
    if (original.recurring && original.placementMode === PLACEMENT_MODES.FIXED && !dateChanged) continue;

    // DELTA-WRITE (H6 W2 — write-all → write-changed, user ruling 2026-06-12).
    // Build the placement the scheduler decided, then write it ONLY when the
    // DB row does NOT already equal it. The prior "NEW DESIGN" wrote scheduled_at/
    // dur for EVERY placed task every run; that made every run non-idempotent at
    // the DB level (S5/C-IDEM red) and bumped updated_at on unchanged tasks.
    //
    // SYNC-SAFETY (binding W2 constraint — verified): cal-sync change detection is
    // CONTENT-HASH based (cal-sync.controller.js:821-822 `taskHash(task) !==
    // ledger.last_pushed_hash`), NOT updated_at-freshness based. taskHash covers
    // scheduled_at-derived fields (date/time/dur/...). When this delta skips a row
    // it is because those content fields are UNCHANGED in the DB, so the hash is
    // unchanged → the sync sees no change → no stale-DB state is reopened. The one
    // updated_at consumer (cal-sync.controller.js:885 last-modified-wins tiebreaker)
    // is reached only when the content hash ALSO changed (both-sides-changed
    // conflict), which never happens for a skipped (content-identical) row.
    // `task_updated_at` written to the ledger is audit-only (never read back for
    // sync logic). Conclusion: NOT bumping updated_at on unchanged tasks is sync-safe.
    var newScheduledAt = localToUtc(newDate, newTimeDisplay, TIMEZONE);
    if (!newScheduledAt) continue;

    // Derive day-of-week for the DB write
    var parsedNewDate = parseDate(newDate);
    var newDay = parsedNewDate ? DAY_NAMES[parsedNewDate.getDay()] : null;
    var dbUpdate = {
      scheduled_at: newScheduledAt,
      date: newDate || null,
      day: newDay,
      time: newTime || null,
      unscheduled: null,
      overdue: 0,
      updated_at: _runScheduleCommand.clockNow()
    };
    // Don't overwrite instance.dur when time_remaining drives the effective
    // placement duration. The instance.dur represents the user-set total chunk
    // size; time_remaining is a separate "how much is left" value. Writing
    // dur = time_remaining would corrupt the Duration field in the task form.
    if (placement.dur && original.timeRemaining == null) {
      dbUpdate.dur = placement.dur;
    }
    if (result.slackByTaskId && taskId in result.slackByTaskId) {
      dbUpdate.slack_mins = result.slackByTaskId[taskId];
    }

    // DELTA-WRITE skip: the skip condition is "the DB row ALREADY EQUALS the
    // computed placement" (NOT "the task didn't move since last run"). Compare
    // every field this dbUpdate would write against the current DB row
    // (rawRowById[taskId]). If all match, the write is a no-op → skip it. Any
    // field that differs, or any field we can't confidently compare, falls
    // through to a real write (conservative — never skips a genuine change).
    if (placementMatchesDbRow(dbUpdate, rawRowById[taskId])) {
      // No DB change needed. Still emit the SSE patch below on a date/time move
      // is impossible here (a move would have differed), so nothing to push.
      continue;
    }

    pendingUpdates.push({
      id: taskId,
      dbUpdate: dbUpdate
    });

    if (dateChanged || timeChanged) {
      // Derive day-of-week label for the patch so the frontend can render
      // without a lookup. parseDate handles both M/D and MM/DD.
      var parsedForDay = parseDate(newDate);
      var dayLabel = parsedForDay ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][parsedForDay.getDay()] : null;

      // Build a minimal patch — only fields that actually changed. Prior
      // versions included dur/slackMins/unscheduled unconditionally, which
      // meant every move triggered no-op merges (and frontend re-renders)
      // for tasks whose duration and slack were stable across runs (#39).
      // When time_remaining drives placement, keep the original instance.dur in
      // the patch so the frontend doesn't replace the user's Duration value.
      var newDur = (placement.dur && original.timeRemaining == null)
        ? (placement.dur || original.dur || null)
        : (original.dur || null);
      var newSlackMins = result.slackByTaskId && taskId in result.slackByTaskId ? result.slackByTaskId[taskId] : null;
      var patch = {
        date: newDate || null,
        time: newTimeDisplay || null,
        day: dayLabel,
        scheduledAt: newScheduledAt instanceof Date ? newScheduledAt.toISOString() : newScheduledAt
      };
      if (newDur !== original.dur) patch.dur = newDur;
      // Normalize original.slackMins (number|null) so we don't emit on null→null.
      var priorSlackMins = original.slackMins != null ? original.slackMins : null;
      if (newSlackMins !== priorSlackMins) patch.slackMins = newSlackMins;
      if (original.unscheduled) patch.unscheduled = false; // only send on transition
      if (original.overdue) patch.overdue = false; // only send on transition

      updatedTasks.push({
        id: taskId,
        text: original.text,
        from: priorDate,
        to: newDate,
        fromTime: priorTime,
        toTime: newTimeDisplay,
        patch: patch
      });
      updated++;
    }
  }

  // 8. Mark unplaced tasks.
  //    There are three cases:
  //
  //    A) Recurring instance with a scheduled_at: leave in place on the calendar.
  //       These are already handled above (the recurring-instance preserve path).
  //
  //    B) Non-recurring task (or recurring instance without scheduled_at) that
  //       has a scheduled_at / date set: it was previously placed but couldn't
  //       be re-placed this run. Set overdue=1, keep unscheduled=0, and
  //       PRESERVE scheduled_at/date/time so the task stays at its last proposed
  //       position with an overdue indicator. Do NOT move it to the unscheduled
  //       lane.
  //
  //    C) Brand-new task (no scheduled_at yet) that couldn't be placed: set
  //       unscheduled=1 so the frontend shows it in the unscheduled lane.
  var cleared = 0;
  result.unplaced.forEach(function(t) {
    if (!t || !t.id) return;
    var original = taskById[t.id];
    if (!original) return;
    if (original.taskType === 'recurring_template') return;
    if (original.placementMode === PLACEMENT_MODES.FIXED) return;
    if (original.marker) return;
    // Recurring instances: two cases based on whether they've ever been placed.
    //   - scheduled_at set: keep last-proposed position on calendar; the overdue
    //     indicator is inferred on the frontend from (date < today AND status='').
    //     No DB write needed here — the task is already in place.
    //   - scheduled_at null: Phase 1 pre-inserted chunk that couldn't be placed
    //     this run. Mark unscheduled=1 so the frontend shows it in the
    //     unscheduled lane. No SSE emitted here — Phase 5 handles new-chunk events.
    if (original.taskType === 'recurring_instance') {
      var rawRec = rawRowById[t.id];
      var hasScheduledAt = rawRec ? !!rawRec.scheduled_at : !!original.scheduledAt;
      if (hasScheduledAt) return;
      var unplacedChunkUpdate = { unscheduled: 1, unplaced_reason: t._unplacedReason || null, unplaced_detail: t._unplacedDetail || null, updated_at: _runScheduleCommand.clockNow() };
      if (result.slackByTaskId && t.id in result.slackByTaskId) {
        unplacedChunkUpdate.slack_mins = result.slackByTaskId[t.id];
      }
      pendingUpdates.push({ id: t.id, dbUpdate: unplacedChunkUpdate });
      cleared++;
      return;
    }
    // One-off / chain-member task. Two sub-cases:
    var rawRow = rawRowById[t.id];
    // eslint-disable-next-line no-redeclare
    var hasScheduledAt = rawRow ? !!rawRow.scheduled_at : !!(original.date || original.scheduledAt);
    if (hasScheduledAt) {
      // 999.700: floating tasks (no deadline) are NEVER past-due (999.671 roll-forward policy).
      // A stale past placement does not make a no-deadline task overdue. Applies to every
      // placement mode (the prior ANYTIME-only guard left non-anytime + anytime-in-past holes).
      // Also CLEAR a stale overdue=1 so a previously-mis-flagged floating task does not stick
      // past-due across runs (defeats computeIsPastDue's ||t.overdue branch otherwise).
      if (!original.deadline) {
        if (rawRow && rawRow.overdue) {
          pendingUpdates.push({ id: t.id, dbUpdate: { overdue: 0, updated_at: _runScheduleCommand.clockNow() } });
        }
        cleared++;
        return;
      }
      // Guard: ANYTIME tasks without a passed deadline are not overdue when they
      // can't fit in today's time grid — the calendar is simply full right now.
      // Only mark overdue if (a) the task was placed on a prior day (rolled over
      // without completion) OR (b) its deadline has already passed.
      // This prevents a full calendar from permanently locking ANYTIME tasks in
      // overdue=1 on every subsequent scheduler run.
      if (original.placementMode === PLACEMENT_MODES.ANYTIME) {
        var _aDeadlineKey = original.deadline ? isoToDateKey(original.deadline) : null;
        var _aInPast = original.date && original.date < timeInfo.todayKey;
        var _aDeadlinePassed = _aDeadlineKey && _aDeadlineKey < timeInfo.todayKey;
        if (!_aInPast && !_aDeadlinePassed) {
          if (rawRow && rawRow.overdue) {
            pendingUpdates.push({ id: t.id, dbUpdate: { overdue: 0, updated_at: _runScheduleCommand.clockNow() } });
          }
          cleared++;
          return;
        }
      }
      // Case B: was previously placed — pin in place with overdue=1.
      // Keep unscheduled=0 so the task renders at its scheduled position.
      var wasAlreadyOverdue = !!(rawRow && rawRow.overdue);

      // Only write if there's a state change:
      // 1. If already overdue + unscheduled already 0 → only write if slack_mins changed
      // 2. If newly overdue → write the full transition
      // 3. If already overdue but unscheduled was 1 → fix that
      var needsUpdate = false;
      var overdueDbUpdate = {};

      if (wasAlreadyOverdue && rawRow && rawRow.unscheduled === 0) {
        // Already in final state (overdue=1, unscheduled=0).
        // Only update if slack_mins changed.
        if (result.slackByTaskId && t.id in result.slackByTaskId &&
            result.slackByTaskId[t.id] !== (rawRow.slack_mins || 0)) {
          overdueDbUpdate.slack_mins = result.slackByTaskId[t.id];
          needsUpdate = true;
        }
      } else {
        // Newly overdue OR unscheduled flag needs fixing.
        overdueDbUpdate.unscheduled = 0;
        overdueDbUpdate.overdue = 1;
        // DB-single-source (W1): overdue = pinned on the grid, NOT unplaced. Clear any
        // reason carried over from a prior run where this row was UNPLACEABLE, so the
        // partition stays mutually exclusive (one row, one state).
        overdueDbUpdate.unplaced_reason = null;
        overdueDbUpdate.unplaced_detail = null;
        overdueDbUpdate.updated_at = _runScheduleCommand.clockNow();
        if (result.slackByTaskId && t.id in result.slackByTaskId) {
          overdueDbUpdate.slack_mins = result.slackByTaskId[t.id];
        }
        needsUpdate = true;
      }

      if (needsUpdate) {
        pendingUpdates.push({ id: t.id, dbUpdate: overdueDbUpdate });
      }

      // Emit SSE transition only when crossing placed → overdue (not already overdue).
      if (!wasAlreadyOverdue) {
        updatedTasks.push({
          id: t.id,
          text: original.text,
          from: original.date,
          to: original.date, // date stays unchanged
          fromTime: original.time,
          toTime: original.time,
          patch: { overdue: true } // scheduled_at/date/time/day unchanged
        });
      }
    } else {
      // Case C: never placed — move to unscheduled lane.
      // DB-single-source (W1): persist why it's unplaced so the Unplaced view reads
      // the reason from the row (DB read model), not the deleted placements cache.
      var unplacedDbUpdate = { unscheduled: 1, unplaced_reason: t._unplacedReason || null, unplaced_detail: t._unplacedDetail || null, updated_at: _runScheduleCommand.clockNow() };
      if (result.slackByTaskId && t.id in result.slackByTaskId) {
        unplacedDbUpdate.slack_mins = result.slackByTaskId[t.id];
      }
      pendingUpdates.push({ id: t.id, dbUpdate: unplacedDbUpdate });
    }
    cleared++;
  });

  // Build unplaced lookup so Phase 9 doesn't overwrite Phase 8's null scheduled_at
  var unplacedIds = {};
  result.unplaced.forEach(function(t) { if (t && t.id) unplacedIds[t.id] = true; });

  // 8.5. Clear stale `unscheduled` flag on recurring instances that have a
  // scheduled_at. They stay visible on the calendar at their last proposed
  // time even when they didn't fit a fresh placement (per user request).
  // Without this, a flag set by a prior run persists indefinitely and the
  // task shows in the unscheduled lane instead of the calendar.
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_instance') return;
    var raw = rawRowById[t.id];
    if (!raw || !raw.unscheduled) return; // already clear
    if (!raw.scheduled_at) return; // truly nothing to show on calendar
    // DB-single-source (W1) partition-leak fix (ernie F3): this sweep revives a
    // recurring instance from unplaced (unscheduled=1) to placed-on-calendar and
    // bypasses the placement skip path — clear the reason too, else a row unplaced
    // -with-reason in run N stays placed-with-stale-reason in run N+1 (6th clear site).
    pendingUpdates.push({ id: t.id, dbUpdate: { unscheduled: null, unplaced_reason: null, unplaced_detail: null, updated_at: _runScheduleCommand.clockNow() } });
  });

  // 8.6. Clear stale overdue flag on tasks that were overdue in the DB but are
  // now placed. The unplaced loop (§8) writes overdue=1 for newly-unplaceable
  // tasks; without this sweep those flags are never cleared when the
  // constraint resolves (e.g. when-tag corrected, new capacity freed up).
  taskRows.forEach(function(r) {
    if (!r.overdue) return; // already clear in DB — nothing to do
    if (unplacedIds[r.id]) return; // still unplaced — §8 handles this
    // DB-single-source (W1): constraint resolved, row is placed again — clear the reason too.
    pendingUpdates.push({ id: r.id, dbUpdate: { overdue: 0, unplaced_reason: null, unplaced_detail: null, updated_at: _runScheduleCommand.clockNow() } });
  });

  // 8.5 — R50.1/R50.2 (999.796): PERSIST overdue=1 for a past-due FIXED/ingested
  // event. The placement loop skips fixed tasks (user-anchored) and Phase 8/9
  // early-return them, so without this the DB keeps overdue=0/unscheduled and the
  // frontend shows the late event in the Unscheduled lane / "Past Scheduled Date"
  // instead of on its day flagged overdue. (computeIsPastDue treats a fixed event's
  // scheduled_at as its hard due date.)
  allTasks.forEach(function(t) {
    if (t.generated || t.taskType === 'recurring_template') return;
    if (t.recurring) return; // recurring handled by their own lifecycle (Phase 9)
    if (t.placementMode !== PLACEMENT_MODES.FIXED) return;
    var stFx = statuses[t.id] || '';
    if (stFx === 'done' || stFx === 'cancel' || stFx === 'skip' || stFx === 'pause' || stFx === 'disabled' || stFx === 'missed') return;
    var rawFx = rawRowById[t.id];
    if (!rawFx) return;
    var schedMinsFx = t.time ? parseTimeToMinutes(t.time) : null;
    if (!computeIsPastDue(t, schedMinsFx, timeInfo)) return; // not past its due date/time
    var fxUpd = {};
    if (!rawFx.overdue) fxUpd.overdue = 1;
    if (rawFx.unscheduled) fxUpd.unscheduled = 0;
    if (Object.keys(fxUpd).length > 0) {
      // DB-single-source (W1): a past-due FIXED event is OVERDUE on its day, not
      // unplaced — clear any stale reason alongside the flag fix.
      fxUpd.unplaced_reason = null;
      fxUpd.unplaced_detail = null;
      fxUpd.updated_at = _runScheduleCommand.clockNow();
      pendingUpdates.push({ id: t.id, dbUpdate: fxUpd });
    }
  });

  // 9. Move remaining past-dated tasks to today
  //    Past recurringTasks missed their day — mark as 'missed' (juggler-cal-history Plan C; was 'skip').
  //    Past non-recurringTasks that weren't placed — move date to today.
  var todayMidnight = localToUtc(timeInfo.todayKey, '12:00 AM', TIMEZONE);
  if (todayMidnight) {
    var movedPast = 0;
    allTasks.forEach(function(t) {
      // Skip generated recurring instances (not real DB rows)
      if (t.generated) return;
      // Never touch recurring templates — they're blueprints, not schedulable tasks
      if (t.taskType === 'recurring_template') return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'pause' || st === 'disabled') return;

      // PATH B fix (BUG-142): Hoist rawRowPast so we can use the DB `date` column
      // as a fallback when t.date is null. rowToTask only sets t.date from
      // utcToLocal(scheduled_at) — when scheduled_at=NULL (never placed), t.date
      // is null even if the DB row's `date` column holds the intended calendar day.
      var rawRowPast = rawRowById[t.id];
      if (!rawRowPast) return;  // not a real DB task

      // Use the raw DB row's `date` column as the authoritative calendar day for
      // auto-miss decisions when the instance was never placed (scheduled_at=NULL).
      // Two cases this corrects:
      //   (1) t.date=null: rowToTask only derives date from utcToLocal(scheduled_at);
      //       when scheduled_at=NULL, t.date is null even though rawRowPast.date is set.
      //   (2) t.date=future: the reconciler's occurrenceMove may have overwritten t.date
      //       to a new desired date. An instance that was NEVER placed on its original
      //       past day must still become 'missed' — the original date is authoritative.
      // When scheduled_at IS set, t.date (derived from it) is trustworthy; use it.
      var effectiveDate = t.date;
      if (t.recurring && rawRowPast.scheduled_at == null && rawRowPast.date) {
        effectiveDate = isoToDateKey(String(rawRowPast.date).split('T')[0]);
      }
      if (!effectiveDate || effectiveDate === 'TBD') return;

      var td = parseDate(effectiveDate);
      if (!td || td >= today) return;  // not past
      // Already handled by placement persistence above
      if (placementByTaskId[t.id]) return;
      // PATH C fix (BUG-142): The unplacedIds guard prevents Plan C from auto-missing
      // instances the scheduler tried this run. For a recurring instance that was NEVER
      // placed (scheduled_at=NULL) and whose day is definitively past, this guard must
      // not block auto-miss — the instance is stuck and must become 'missed'.
      // All other unplaced tasks (non-recurring, future/today, previously placed)
      // still skip through here as before.
      if (unplacedIds[t.id]) {
        if (!t.recurring || rawRowPast.scheduled_at != null) return;
        // Recurring + never-placed + definitively past: fall through.
        // The timeFlex window check below makes the final call.
      }

      // Fixed tasks are user-anchored — never move them, even if past.
      if (t.placementMode === PLACEMENT_MODES.FIXED) return;
      // Markers are non-blocking — never move them.
      if (t.marker) return;

      if (t.recurring) {
        // Past recurring — not "missed" while it can still be completed. Two live
        // windows, either of which keeps it from being missed:
        //  (1) the timeFlex placement window (scheduler may still place it late), and
        //  (2) R50.0: the recurrence-PERIOD boundary — a flexible-TPC instance may
        //      roam within its cycle (e.g. a 3×/week task is not missed until the
        //      week ends), so its implied deadline is the end of the cycle, not the
        //      occurrence day.
        var flex = t.timeFlex != null ? t.timeFlex : 60;
        var daysPast = Math.round((today.getTime() - td.getTime()) / 86400000);
        if (flex >= daysPast * 1440) return; // still within the timeFlex window
        var periodEndKey = recurringPeriodEndKey(t.recur, effectiveDate);
        var periodEnd = periodEndKey ? parseDate(periodEndKey) : null;
        if (periodEnd && today < periodEnd) return; // still within the recurrence cycle
        // Outside placement window — day was missed, mark as 'missed' (juggler-cal-history
        // Plan C; was 'skip'). Distinguishes user-initiated skip from system-applied missed.
        var windowClose = computeWindowCloseUtc(t, today, TIMEZONE);
        // scheduled_at must be non-null for terminal statuses (DB CHECK constraint).
        // For instances that were never placed (no scheduledAt), fall back to midnight
        // of the occurrence's intended date — it's when the day was supposed to happen.
        // LOCKED design (999.808): freeze a missed PLACED instance at its last real slot.
        // Parse the placed slot as UTC. tasks_v with dateStrings:true yields a bare
        // string ('2026-06-14 15:00:00') — append 'Z' so Node parses it as UTC, not local
        // (ernie W1 defense-in-depth: if a future row-source ever hands back a Date, use it
        // as-is rather than `new Date(Date + 'Z')` which would be Invalid Date).
        var lastRealSlot = null;
        if (rawRowPast.scheduled_at != null) {
          lastRealSlot = (rawRowPast.scheduled_at instanceof Date)
            ? rawRowPast.scheduled_at
            : new Date(String(rawRowPast.scheduled_at) + 'Z');
        }
        var missedAt = lastRealSlot
          || windowClose
          || localToUtc(effectiveDate, '12:00 AM', TIMEZONE)
          || _runScheduleCommand.clockNow();
        pendingUpdates.push({
          id: t.id,
          dbUpdate: {
            status: 'missed',
            scheduled_at: missedAt,
            completed_at: missedAt,
            unscheduled: null,
            unplaced_reason: t._unplacedReason || null,
            unplaced_detail: t._unplacedDetail || null,
            updated_at: _runScheduleCommand.clockNow()
          }
        });
        updatedTasks.push({
          id: t.id,
          text: t.text,
          from: effectiveDate,
          to: effectiveDate,
          patch: { status: 'missed' }
        });
      } else {
        // Past non-recurring — move date forward to today
        pendingUpdates.push({
          id: t.id,
          dbUpdate: {
            scheduled_at: todayMidnight,
            updated_at: _runScheduleCommand.clockNow()
          }
        });
      }
      movedPast++;
    });
    if (movedPast > 0) logger.info('[SCHED] moved/skipped ' + movedPast + ' past-dated tasks');
  }

  // Adjacent split chunks that landed back-to-back (zero gap) on the same day
  // were merged into a single extended DB row earlier in the write path (#42).
  // See the "Merge adjacent split-task chunks" block above. Chunks with gaps
  // between them remain as separate rows — gap > 0 means capacity lives between
  // them and the split is still meaningful for scheduling purposes.

  // Phase 1: in-memory chunk rows were pre-inserted before scheduling (see
  // "Phase 1: Pre-insert" block above). Placed chunks now have DB rows and
  // flow through pendingUpdates as UPDATEs like any other recurring instance.
  logger.info('[SCHED] persist: ' + inMemoryChunks.length + ' pre-inserted chunks updating via pendingUpdates');

  // H6 / W3 — flush the changed-rows delta through the SOLE delta-write impl
  // (RunScheduleCommand → KnexScheduleRepository.writeChanged). The inline knex
  // flush (the batched scheduled_at/dur CASE update chunked at 200 + the per-row
  // otherUpdates loop + the 200-chunk constant + the updated_at db.fn.now())
  // moved INTO the repository verbatim — there is now ONE delta-write impl, not
  // two. The S5 skip (placementMatchesDbRow above) already excluded unchanged
  // rows from pendingUpdates, so this writes only what changed. T-TX: trx-bound,
  // so it commits/rolls back with the caller's transaction. instanceOnly:true
  // preserves the legacy "never overwrite user-set master.dur" routing.
  logger.info('[SCHED] executing ' + pendingUpdates.length + ' DB updates');
  await _runScheduleCommand.persistDelta(trx, userId, pendingUpdates, { instanceOnly: true });

  // Delete merged-out secondary chunk rows. Pre-inserted in Phase 1 but their
  // placement was folded into the primary chunk above.
  if (mergedOutIds.length > 0) {
    await _runScheduleCommand.deleteTasksWhere(trx, userId, function(q) {
      return q.whereIn('id', mergedOutIds);
    });
    logger.info('[SCHED] split-chunk merge: deleted ' + mergedOutIds.length + ' secondary chunk row(s) from DB');
  }

  logger.info('[SCHED] runScheduleAndPersist: updated ' + updated + ', cleared ' + cleared + ' for user ' + userId);
  tPerf.persistEnd = Date.now() - tPerfStart;
  logger.info('[SCHED] perf user=' + userId
    + ' load=' + tPerf.loadEnd
    + 'ms expand=' + (tPerf.expandEnd - tPerf.loadEnd)
    + 'ms reconcile=' + (tPerf.reconcileEnd - tPerf.expandEnd)
    + 'ms schedule=' + (tPerf.scheduleEnd - tPerf.reconcileEnd)
    + 'ms persist=' + (tPerf.persistEnd - tPerf.scheduleEnd)
    + 'ms total=' + tPerf.persistEnd
    + 'ms tasks=' + taskRows.length
    + ' placed=' + updated);

  // 10. Cache the placement result so GET /placements doesn't re-run the scheduler
  // Use MySQL's clock for generatedAt so it's consistent with tasks.updated_at.
  // Node.js Date.now() can lag MySQL by several seconds on Cloud SQL, making the
  // cache appear stale immediately. H6 / W3: the `SELECT NOW(3)` read is surfaced
  // through RunScheduleCommand.dbNow (→ repository.now) so this path stays free of
  // raw knex. Returns a JS Date already parsed (the legacy ' '→'T' + 'Z' parse).
  var _dbNowDate = await _runScheduleCommand.dbNow(trx);
  var placementCache = { dayPlacements: {}, unplaced: [], score: result.score, warnings: result.warnings || [], generatedAt: _dbNowDate.toISOString(), timezone: TIMEZONE, schedulerVersion: SCHEDULER_VERSION };
  Object.keys(result.dayPlacements).forEach(function(dk) {
    placementCache.dayPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      var entry = { taskId: p.task ? p.task.id : null, start: p.start, dur: p.dur };
      // Convert local start to UTC ISO for timezone-independent display
      var timeStr = formatMinutesToTime(p.start);
      var utcDate = localToUtc(dk, timeStr, TIMEZONE);
      if (utcDate) entry.scheduledAtUtc = utcDate.toISOString();
      if (p.locked) entry.locked = true;
      if (p.marker) entry.marker = true;
      if (p._whenRelaxed) entry.whenRelaxed = true;
      if (p.splitPart) { entry.splitPart = p.splitPart; entry.splitTotal = p.splitTotal; }
      if (p.travelBefore) entry.travelBefore = p.travelBefore;
      if (p.travelAfter) entry.travelAfter = p.travelAfter;
      if (p._moveReason) entry.moveReason = p._moveReason;
      if (p._conflict) entry.conflict = true;
      if (p._placementReason) entry.placementReason = p._placementReason;
      // Overdue flag: preserve through the cache round-trip so the frontend
      // sees it in both the fresh schedule:changed payload and the hydrated
      // read-from-cache path.
      if (p._overdue || (p.task && p.task._overdue)) entry.overdue = true;
      return entry;
    });
  });
  // Store unplaced IDs + diagnostic info in cache
  var unplacedMeta = {};
  result.unplaced.forEach(function(t) {
    if (t._unplacedDetail || t._suggestions || t._unplacedReason) {
      var meta = {};
      if (t._unplacedDetail) meta.detail = t._unplacedDetail;
      if (t._unplacedReason) meta.reason = t._unplacedReason;
      if (t._suggestions) meta.suggestions = t._suggestions;
      if (t._whenBlocked) meta.whenBlocked = true;
      unplacedMeta[t.id] = meta;
    }
  });
  placementCache.unplaced = result.unplaced.map(function(t) { return t.id; });
  placementCache.unplacedMeta = unplacedMeta;
  var cacheJson = JSON.stringify(placementCache);
  var existingCache = await trx('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
  if (existingCache) {
    await trx('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).update({ config_value: cacheJson });
  } else {
    await trx('user_config').insert({ user_id: userId, config_key: 'schedule_cache', config_value: cacheJson });
  }

  // Invalidate Redis caches — scheduler modified tasks
  cache.invalidateTasks(userId).catch(function(err) { logger.error("[silent-catch]", { error: err }); });

  // Add scheduledAtUtc to placements for timezone-independent frontend display
  var outPlacements = {};
  Object.keys(result.dayPlacements).forEach(function(dk) {
    outPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      var hh3 = Math.floor(p.start / 60);
      var mm3 = p.start % 60;
      var ampm3 = hh3 >= 12 ? 'PM' : 'AM';
      var dh3 = hh3 > 12 ? hh3 - 12 : (hh3 === 0 ? 12 : hh3);
      var ts3 = dh3 + ':' + (mm3 < 10 ? '0' : '') + mm3 + ' ' + ampm3;
      var utc3 = localToUtc(dk, ts3, TIMEZONE);
      if (utc3) p.scheduledAtUtc = utc3.toISOString();
      return p;
    });
  });

  // Synthesize placements for finished tasks so they appear on the calendar
  // when the "all" filter is active (scheduler only places active tasks).
  // Also synthesize placements for overdue tasks — they have a scheduled_at
  // but weren't re-placed this run. They stay visible in the grid at their
  // last scheduled position with an overdue indicator (overdue=1).
  var placedIds = {};
  Object.keys(outPlacements).forEach(function(dk) {
    outPlacements[dk].forEach(function(p) {
      if (p.task) placedIds[p.task.id] = true;
    });
  });
  // Track occupied (date, startMin) slots so overdue tasks don't stack on each other
  var overdueSlotsByDate = {};
  allTasks.forEach(function(t) {
    if (placedIds[t.id]) return;
    if (t.generated || t.taskType === 'recurring_template') return;
    var st = statuses[t.id] || '';
    var isFinished = st === 'done' || st === 'cancel' || st === 'skip';
    var scheduledMins = t.time ? parseTimeToMinutes(t.time) : null;
    // 999.671: single source of truth — computeIsPastDue() encapsulates the
    // floating-exclusion gate so this site and the cache path below CANNOT diverge.
    var isPastDue = computeIsPastDue(t, scheduledMins, timeInfo);
    var isOverdueTask = !!t.overdue || isPastDue;
    if (!isFinished && !isOverdueTask) return;
    if (!t.date || t.date === 'TBD') return;
    var startMin = scheduledMins;
    if (startMin == null) return;
    var dur = t.dur || 30;
    // Bug 2 fix: for overdue today-tasks whose original time has passed, snap to last
    // time-block boundary so they appear at the latest slot rather than buried in the past.
    // R50: NEVER snap a FIXED event — it is immovable and must stay at its anchor time
    // even when overdue (#67598/#67654); the snap is a floating/flex affordance only.
    if (isOverdueTask && t.placementMode !== PLACEMENT_MODES.FIXED && t.date === timeInfo.todayKey && startMin < timeInfo.nowMins) {
      var dateObj = parseDate(t.date);
      var dayName = dateObj ? DAY_NAMES[dateObj.getDay()] : null;
      var blocks = (dayName && cfg.timeBlocks && cfg.timeBlocks[dayName]) ? cfg.timeBlocks[dayName] : null;
      var lastBlockEnd = 1080; // default 6 PM if no blocks available
      if (blocks && blocks.length > 0) {
        lastBlockEnd = blocks[blocks.length - 1].end;
      }
      startMin = lastBlockEnd - dur;
      if (startMin < 0) startMin = 0;
    }
    // Bug 3 fix: collision detection — offset until a free slot is found for this date
    if (!overdueSlotsByDate[t.date]) overdueSlotsByDate[t.date] = {};
    var slotMin = startMin;
    while (overdueSlotsByDate[t.date][slotMin]) {
      slotMin += Math.max(dur, 15);
    }
    overdueSlotsByDate[t.date][slotMin] = true;
    startMin = slotMin;
    var entry = { task: t, start: startMin, dur: dur };
    var utcDate = localToUtc(t.date, t.time, TIMEZONE);
    if (utcDate) entry.scheduledAtUtc = utcDate.toISOString();
    if (isOverdueTask) entry._overdue = true;
    if (!outPlacements[t.date]) outPlacements[t.date] = [];
    outPlacements[t.date].push(entry);
  });

  // Compute changeset: which task IDs were added, removed, or moved
  var deadSet = {};
  (deadIds || []).forEach(function(id) { deadSet[id] = true; });
  var bornSet = {};
  expanded.forEach(function(t) { bornSet[t.id] = true; });

  // Removed: deleted but not regenerated with same ID
  var removed = (deadIds || []).filter(function(id) { return !bornSet[id]; });
  // Added: born but didn't exist before. Carry the full row so the frontend
  // doesn't have to fetch — it has nothing to merge into and would otherwise
  // do an N+1 GET per added row (catastrophic when reconcile inserts ~500).
  var addedIdSet = {};
  expanded.forEach(function(t) { if (!deadSet[t.id]) addedIdSet[t.id] = true; });
  var rowsById = {};
  taskRows.forEach(function(r) { rowsById[r.id] = r; });
  var added = Object.keys(addedIdSet).map(function(id) {
    // rowsById was populated from taskRows (pre-Phase-1 snapshot). Phase 1
    // pre-inserted chunk rows (split_ordinal >= 2) aren't there — fall back
    // to phase1InsertedById so we still ship a full object instead of id-only.
    var r = rowsById[id] || phase1InsertedById[id];
    if (!r) return { id: id }; // fallback: id-only (frontend will fetch as before)
    // Project a full task shape via rowToTask so the frontend gets exactly the
    // same fields it would have received from GET /api/tasks/:id.
    return rowToTask(r, null, srcMap);
  });
  // Changed: tasks whose date/time was moved (or cleared) by the scheduler.
  // Send {id, patch} so the frontend can merge without re-fetching.
  var changed = updatedTasks.map(function(t) { return { id: t.id, patch: t.patch || {} }; });

  // Affected dates: all dates that had tasks added, removed, or moved
  var affectedDates = {};
  updatedTasks.forEach(function(t) {
    if (t.from) affectedDates[t.from] = true;
    if (t.to) affectedDates[t.to] = true;
  });
  Object.keys(outPlacements).forEach(function(dk) { affectedDates[dk] = true; });

  return {
    updated: updated, cleared: cleared, tasks: updatedTasks, score: result.score,
    dayPlacements: outPlacements,
    unplaced: result.unplaced.filter(function(t) {
      // Keep missed recurring instances (they have _unplacedReason) even if generated
      if (t.generated && !t._unplacedReason) return false;
      return true;
    }),
    warnings: result.warnings || [],
    changeset: {
      added: added,
      changed: changed,
      removed: removed,
      affectedDates: Object.keys(affectedDates)
    },
    _debug: { inMemoryChunks: inMemoryChunks.length, expandedOccurrences: desiredOccurrences.length }
  };

  }); // end transaction
  } catch (err) {
    if ((err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') && retries < MAX_RETRIES) {
      logger.info('[SCHED] ' + err.code + ' detected, retry ' + (retries + 1) + '/' + MAX_RETRIES);
      await new Promise(function(r) { setTimeout(r, 500 * (retries + 1)); });
      return runScheduleAndPersist(userId, retries + 1, options);
    }
    throw err;
  }
}

module.exports = {
  runScheduleAndPersist,
  computeWindowCloseUtc,
  recurringPeriodEndKey,
  computeIsPastDue,
  setWeatherProvider,
  getWeatherProvider,
  // Test-only export — pure-function seam for unit tests.
  // Never call from production code.
  _placementMatchesDbRow: process.env.NODE_ENV === 'test' ? placementMatchesDbRow : undefined
};
