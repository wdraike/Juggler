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
// H7 (999.1193): lib/tasks-write is no longer required here — the phase-1 chunk
// pre-insert routes through _runScheduleCommand.insertTasksBatch (port seam).
var { computeChunks } = require('../lib/reconcile-splits');
var unifiedScheduleV2 = require('./unifiedScheduleV2');
var constants = require('./constants');
var { TERMINAL_STATUSES } = require('../lib/task-status');
var config = require('../lib/config');

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

var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DAY_NAMES = constants.DAY_NAMES;
// 999.1217 (W4): SCHEDULER_VERSION was only read for the (now-removed)
// schedule_cache write's `schedulerVersion` field.
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
// 999.1102: direct access to the computed-overdue predicate so SSE patches
// can be verified against the same single source of truth a GET will use,
// avoiding transient overdue-flag staleness on forward-rolled recurring instances.
var _computeOverdueForRow = require('../slices/task/facade').computeOverdueForRow;
// H6 / W3 — the sole persist I/O orchestrator. Every scheduler DB write below
// routes through this command's W2 adapters (writeChanged / deleteTasksWhere /
// backfillRollingAnchorIfNull / now); the inline knex flush + the 19 inline
// db.fn.now() are gone (P1). The command NEVER imports scheduleQueue (S4/S6) —
// deadlock-retry + sync-lock stay here in runScheduleAndPersist / its caller.
var RunScheduleCommand = require('../slices/scheduler/application/RunScheduleCommand');
var _runScheduleCommand = new RunScheduleCommand();
// 999.1195: ms-epoch read derived from the injected ClockPort (perf-stopwatch
// checkpoints). Under FakeClockAdapter the deltas are 0 — tPerf is diagnostic
// logging only, never scheduling math.
function _clockNowMs() { return _runScheduleCommand.clockNow().getTime(); }
var expandRecurringShared = require('juggler-shared/scheduler/expandRecurring');
var expandRecurring = expandRecurringShared.expandRecurring;
var { REASON_CODES } = require('juggler-shared/scheduler/reasonCodes');

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
 * Exported for the cal-history cron's matching logic in
 * `shared/scheduler/missedHelpers.js`. (The in-scheduler auto-mark block that once
 * consumed this was removed in Leg D — the scheduler no longer auto-marks recurring
 * instances terminal; past-incomplete recurring stay overdue/unscheduled, never missed.)
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
  // AC2b consistency (R50): window-close base = preferred_time_mins when set,
  // otherwise fall back to the scheduled slot. Both are treated as minutes-since-UTC-midnight
  // (UTC-pure: this function does not receive timezone info). Mirrors taskMappers.js FIX-1:
  // (preferred_time_mins ?? scheduledMins) + time_flex.
  var preferredMins = (task.preferredTimeMins != null) ? task.preferredTimeMins
    : (task.preferred_time_mins != null ? task.preferred_time_mins : null);
  var utcMidnight = new Date(saDate);
  utcMidnight.setUTCHours(0, 0, 0, 0);
  var baseMins = preferredMins != null ? preferredMins
    : (saDate.getUTCHours() * 60 + saDate.getUTCMinutes());
  return new Date(utcMidnight.getTime() + baseMins * 60 * 1000 + flexMin * 60 * 1000);
}

/**
 * AC-840-4 (REG-26/F9, flipped to min() per SCHEDULER-SPEC.md:700 LOCKED ruling,
 * David 2026-06-23): Combine a recurring period-boundary and a flex window-close
 * into a single explicit effective deadline (the EARLIER of the two non-null
 * values). A recurring instance stays live while today < effectiveDeadline.
 *
 * Returns the MINIMUM (earlier) of the two non-null deadlines — overdue as soon
 * as EITHER has passed. Previously this returned max() (the De Morgan dual of the
 * original two independent OR guards), which let the persist-sweep believe a
 * same-day-window-closed, still-mid-cycle instance was "still live" for up to a
 * full extra cycle while the scheduler (unifiedScheduleV2) had already marked the
 * same occurrence unplaced/MISSED this run — the F9 dead zone. min() keeps the
 * sweep's verdict consistent with the scheduler's: once the occurrence's own
 * window has closed, it is no longer "still live" even if the recurrence period
 * has not yet ended.
 *
 * @param {Object}  opts
 * @param {Date|null} opts.periodBoundary  — end of the recurrence cycle (from recurringPeriodEndKey)
 * @param {Date|null} opts.windowClose     — timeFlex window close (occurrence date + timeFlex minutes)
 * @returns {Date|null} min(periodBoundary, windowClose), or whichever is non-null, or null if both null.
 */
function computeEffectiveDeadline(opts) {
  var periodBoundary = opts.periodBoundary;
  var windowClose = opts.windowClose;
  if (periodBoundary == null) return windowClose != null ? windowClose : null;
  if (windowClose == null) return periodBoundary;
  return periodBoundary < windowClose ? periodBoundary : windowClose;
}

/**
 * AC-840-3 / AC-881-1: Fail-loud disjointness assertion — pure helper.
 * Checks each day's placements for overlapping time slots.
 *
 * @param {Object} dayPlacements — { 'YYYY-MM-DD': [ { task: { id }, start: int, dur: int } ] }
 * @returns {Array<{ date, a, b, aStart, aEnd, bStart }>} — one entry per violation.
 *   A violation is when prev.start + prev.dur > next.start (strictly greater; touching is allowed).
 *   Comparisons are strictly per-dateKey — never cross-day.
 */
function checkPlacementDisjointness(dayPlacements) {
  var violations = [];
  if (!dayPlacements) return violations;
  Object.keys(dayPlacements).forEach(function(dateKey) {
    var entries = dayPlacements[dateKey];
    if (!entries || entries.length < 2) return;
    // Sort ascending by start time within the day.
    var sorted = entries.slice().sort(function(a, b) { return a.start - b.start; });
    for (var i = 0; i < sorted.length - 1; i++) {
      var prev = sorted[i];
      var next = sorted[i + 1];
      var aEnd = prev.start + prev.dur;
      if (aEnd > next.start) {
        violations.push({
          date: dateKey,
          a: prev.task && prev.task.id,
          b: next.task && next.task.id,
          aStart: prev.start,
          aEnd: aEnd,
          bStart: next.start
        });
      }
    }
  });
  return violations;
}

// R50.0 recurrence-period boundary (isFlexibleTpcRecur + recurringPeriodEndKey) —
// 999.1198: moved VERBATIM to slices/scheduler/domain/logic/recurringPeriod.js
// (pure classification + delegation to the missedHelpers SSOT) so the task
// facade's implied-deadline write sites can call it WITHOUT lazy-requiring this
// module (the facade → runSchedule → SchedulerTaskProvider → facade cycle).
// Both functions are re-exported below unchanged; every in-file caller keeps
// the same local names.
var _recurringPeriod = require('../slices/scheduler/domain/logic/recurringPeriod');
var isFlexibleTpcRecur = _recurringPeriod.isFlexibleTpcRecur;
var recurringPeriodEndKey = _recurringPeriod.recurringPeriodEndKey;

/**
 * Get current date/time in user's timezone — delegated to the shared contract
 * (shared/scheduler/getNowInTimezone.js, W1 R50.8). The local duplicate is
 * removed; all callers continue to receive {todayKey, nowMins} unchanged.
 * (todayDate is also available but unused by the scheduler path.)
 */
var getNowInTimezone = require('juggler-shared/scheduler/getNowInTimezone').getNowInTimezone;

/**
 * Load user config values from DB and assemble into scheduler cfg object.
 * 999.1187: moved VERBATIM to ./loadSchedulerConfig.js — the single loader
 * shared with schedulerSession.js and schedule.routes.js (which previously
 * carried drifted camelCase-key copies).
 */
// H7 (999.1193): the user_config/locations reads go through
// ScheduleRepositoryPort (via _runScheduleCommand); only the PURE rows→cfg
// assembly is imported here, so cfg semantics stay byte-identical to
// loadSchedulerConfig(userId) (which schedulerSession/schedule.routes use).
var buildSchedulerCfg = require('./loadSchedulerConfig').buildSchedulerCfg;

/**
 * Run the scheduler and persist date moves to the DB.
 *
 * The scheduler reads current scheduled_at values and places tasks from
 * scratch. Only tasks whose scheduled_at actually changed are written back.
 * Pinned, fixed, marker, and template tasks are never modified.
 *
 * Returns stats: { updated, cleared, tasks: [...] }
 */
// NOTE (H7, 999.1193): the old Redis per-user scheduler lock
// (_acquireSchedulerLock/_releaseSchedulerLock, 'sched_lock:<userId>') was dead
// code — zero call sites repo-wide. Concurrency is owned by the caller's
// sync-lock claim (lib/sync-lock, see scheduleQueue). Deleted, not ported.

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

// Largest value we will ever treat as a genuine occurrence_ordinal when read
// out of an instance ID. occurrence_ordinal is a signed MySQL INT (max
// 2,147,483,647) and is semantically a small per-master occurrence counter
// (1..N, bounded by the expansion window). A ceiling of 10,000,000 (≈ 27,000
// years of daily occurrences) is far above any real count yet safely below
// both a realistic YYYYMMDD date suffix (20YYMMDD ≈ 2.0e7) and a 12-digit numeric
// uuid node segment (~1e12). Anything above this is NOT an ordinal — it is a
// date-format suffix or part of the sourceId, and must never be promoted into
// the ordinal space (doing so overflows the INT column on insert — 999.878).
var MAX_PLAUSIBLE_ORDINAL = 10000000;

// Extract the genuine occurrence-ordinal encoded in a recurring-instance ID.
//
// Instance IDs are "<sourceId>-<ordinal>" or, for split chunks,
// "<sourceId>-<ordinal>-<splitOrdinal>". sourceId is a uuid v7. The naive
// /-(\d+)(?:-\d+)?$/ regex is greedy + leftmost-anchored, so when a uuid's
// final node segment is ALL decimal digits (e.g. "...-481234567890-3") it
// captures the 12-digit uuid node as the "ordinal" and mistakes the real
// trailing "-3" ordinal for a split tail — yielding ~4.8e11, which overflows
// occurrence_ordinal's signed INT column (999.878: "decimal-tail" IDs).
//
// Fix: when the first captured numeric segment is implausibly large (a uuid
// node or a YYYYMMDD date), it cannot be an ordinal — fall back to the trailing
// numeric segment, which is the real ordinal. Returns null when no plausible
// ordinal suffix is present (so callers leave maxOrdByMaster untouched rather
// than poisoning it).
function ordinalSuffixOf(id) {
  var m = String(id).match(/-(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  var first = Number(m[1]);
  var second = m[2] != null ? Number(m[2]) : null;
  if (Number.isInteger(first) && first >= 0 && first <= MAX_PLAUSIBLE_ORDINAL) {
    return first;
  }
  // first segment is part of the sourceId (numeric uuid node) or a date suffix.
  if (second != null && Number.isInteger(second) && second >= 0 && second <= MAX_PLAUSIBLE_ORDINAL) {
    return second;
  }
  return null;
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

  // unscheduled flag (the dbUpdate sets unscheduled:null). W3 (sched-drop-
  // overdue-column, M-5): `overdue` is no longer a stored column — it is
  // computed-on-read only (taskMappers.js computeOverdueForRow) — so a
  // dbUpdate never carries an `overdue` field and there is nothing to compare
  // here anymore (the R-FR1 write-side persistence this comparison used to
  // protect has been deleted outright, not replaced).
  if (_flagOf(dbUpdate.unscheduled) !== _flagOf(rawRow.unscheduled)) return false;

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
  var tPerfStart = _clockNowMs();
  var tPerf = { loadEnd: 0, expandEnd: 0, reconcileEnd: 0, scheduleEnd: 0, persistEnd: 0 };

  // Note: Non-recurring split tasks are now handled by inline expansion in
  // unifiedScheduleV2 (placeSplitInline) — split on demand as needed. The
  // reconcileSplitsForUser() call has been removed per ROADMAP 999.097 (and
  // the dead reconcilers themselves deleted from lib/reconcile-splits per
  // 999.1179 — only computeChunks remains).
  // Recurring split tasks continue to be handled by the Phase 1 upfront
  // INSERT path in step 5b below (pre-insert before scheduling).

  // 1. Load schedulable tasks + templates + terminal-dedup + user config in
  //    parallel. All three are read-only and independent; serial awaits were
  //    adding the three queries' latencies on top of each other. Config uses
  //    its own connection (db) while the task rows use the transaction (trx)
  //    so the scheduler still sees a consistent snapshot.
  var _loadStart = _clockNowMs();
  var _p_taskRows = trx('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '')
        // Non-template rows with NULL status (legacy / one-shot tasks never given a status).
        .orWhere(function() {
          this.whereNull('status').whereNot('task_type', 'recurring_template');
        })
        // R55 / BUG-814: recurring_template rows always have status=NULL in tasks_v
        // (the view hardcodes NULL for the master branch), so the real cancel/disable
        // state lives in task_masters.status. Load a template ONLY if its master is
        // not cancelled/disabled — checked via NOT EXISTS on the master_id join key.
        // (The prior orWhereNull + whereNotIn was dead: NULL NOT IN (...) never excludes.)
        .orWhere(function() {
          this.where('task_type', 'recurring_template')
            .whereNotExists(function() {
              this.select(trx.raw('1'))
                .from('task_masters')
                .whereRaw('`task_masters`.`id` = `tasks_v`.`master_id`')
                .whereIn('task_masters.status', ['cancelled', 'disabled']);
            });
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
  // H7 (999.1193): user_config + locations reads via ScheduleRepositoryPort.
  // On the base connection (db), NOT the trx — same as the legacy
  // loadConfig(userId), whose reads ran on src/db outside the transaction.
  var _p_cfg = Promise.all([
    _runScheduleCommand.getUserConfigRows(db, userId),
    _runScheduleCommand.getLocations(db, userId)
  ]).then(function(cfgRows) { return buildSchedulerCfg(cfgRows[0], cfgRows[1]); });
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

  // Backfill: rolling tasks whose next_start is null because the last
  // completion happened before the unified-anchor feature shipped.
  // Without an anchor, getAnchor() falls back to recurStart, and the arithmetic
  // projection can land on a date that violates the spacing guarantee. Use the
  // latest done date from recurringHistoryByMaster as the in-memory anchor, and
  // persist it so subsequent runs don't repeat the work.
  var _rollingBackfills = [];
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_template') return;
    if (!t.recur || t.recur.type !== 'rolling') return;
    if (t.nextStart) return; // already set — normal path
    var latestDone = recurringHistoryByMaster[t.id];
    if (!latestDone) return;
    t.nextStart = latestDone; // fix in-memory for this run
    _rollingBackfills.push({ id: t.id, anchor: latestDone });
  });
  if (_rollingBackfills.length > 0) {
    var _backfillCounts = await Promise.all(_rollingBackfills.map(function(b) {
      // H6 / W3: rolling-anchor backfill via the repository (updated_at = new
      // Date(), P1 — the legacy trx.fn.now() corrected). T-TX: trx-bound.
      return _runScheduleCommand.backfillRollingAnchor(trx, userId, b.id, b.anchor);
    }));
    var _backfillActual = _backfillCounts.reduce(function(s, n) { return s + (n || 0); }, 0);
    logger.info('[SCHED] rolling-anchor backfill (next_start): ' + _backfillActual + '/' + _rollingBackfills.length + ' written: ' +
      _rollingBackfills.map(function(b) { return b.id + '→' + b.anchor; }).join(', '));
  }

  // 2a. Normalize empty `when` to the literal 'anytime' sentinel. Users treat
  // no-when-set as "place whenever," not "skip scheduling" — the placement
  // phase requires a non-empty when-tag to match against day windows.
  // 999.1410: the prior hand-maintained tag list ('morning,lunch,afternoon,
  // evening,night') predates the biz1/biz2 work-block split and never
  // included the 'biz' tag, so an empty-when task could NEVER be placed in
  // the 8am-12pm work block (biz1 starts before noon, so it doesn't even
  // get buildWindowsFromBlocks' biz→afternoon alias — only biz2 does).
  // 'anytime' resolves via getWhenWindows to windows.anytime, the
  // already-correct true union of every block for the day — matching the
  // comment's own stated intent with no tag list to keep in sync.
  var ALL_WINDOWS = 'anytime';
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

  // 4b. FR-1(b)/AC2 (juggler-recur-lifecycle-redesign, W2) — scheduler-run
  // sweep: "for every non-rolling master where next_start < today, advance to
  // the first pattern date >= today." Rolling masters are EXEMPT (no anchor
  // exists until first completion — see rolling-anchor.js). This is the
  // scheduler run's FIRST step that touches next_start, so it runs before this
  // same run's own recurring expansion (below) consults getAnchor() —
  // mirroring the pre-existing rolling_anchor backfill's in-memory-fix
  // pattern, this also patches `t.nextStart` on the in-memory allTasks entry
  // so THIS run's expansion sees the swept value, not just the next run's.
  //
  // nextMatchingDate(recur, afterDateKey, phaseAnchor) returns the first match
  // STRICTLY AFTER afterDateKey — pass "yesterday" (today - 1) so the result
  // can be today itself, matching FR-1(b)'s literal ">= today".
  //
  // NOTE (cookie ARCH-REVIEW-W2.json W2-ARCH-W2, tracked follow-on — NOT fixed
  // in this leg): this sweep is ONE of TWO independent next_start writers. The
  // OTHER is the terminal-status write path (facade.js applyRollingAnchor,
  // search "W2-ARCH-W2"), which computes the SAME "first pattern date >= X"
  // via computeRollingAnchor/computeNextOccurrenceAnchor — a DIFFERENT compute
  // function than this sweep's expandRecurringShared.nextMatchingDate. Both
  // MUST keep agreeing on the result for the same recur pattern + anchor, or
  // next_start becomes non-deterministic depending on which writer fires
  // last. See ARCH-REVIEW-W2.json for the scoped follow-on convergence work
  // (characterization test or single shared compute function).
  var _todayForSweep = parseDate(timeInfo.todayKey) || _runScheduleCommand.clockNow();
  var _sweepYesterday = new Date(_todayForSweep.getTime());
  _sweepYesterday.setDate(_sweepYesterday.getDate() - 1);
  var _sweepYesterdayKey = formatDateKey(_sweepYesterday);
  var _nextStartSweeps = [];
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_template') return;
    if (!t.recur || t.recur.type === 'rolling') return; // rolling exempt (FR-1b)
    if (!t.nextStart) return; // no anchor yet — nothing to sweep
    if (String(t.nextStart).slice(0, 10) >= timeInfo.todayKey) return; // not stale
    var _swept = expandRecurringShared.nextMatchingDate(t.recur, _sweepYesterdayKey, t.nextStart);
    if (!_swept) return;
    t.nextStart = _swept; // in-memory: this run's own getAnchor() sees it too
    _nextStartSweeps.push({ id: t.id, nextStart: _swept });
  });
  if (_nextStartSweeps.length > 0) {
    await Promise.all(_nextStartSweeps.map(function(s) {
      return _runScheduleCommand.setNextStart(trx, userId, s.id, s.nextStart);
    }));
    logger.info('[SCHED] next_start sweep: ' + _nextStartSweeps.length + ' advanced: ' +
      _nextStartSweeps.map(function(s) { return s.id + '→' + s.nextStart; }).join(', '));
  }

  // 5. Config was loaded in parallel with tasks above.
  var cfg = _preloadedCfg;
  cfg.timezone = TIMEZONE;

  tPerf.loadEnd = _clockNowMs() - tPerfStart;

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
      // 999.1490: guard against date-derived ordinal corruption. Prior runs
      // seeded maxOrdByMaster from raw occurrence_ordinal without the
      // MAX_PLAUSIBLE_ORDINAL gate that ordinalSuffixOf applies — so a
      // corrupted ordinal like 20260841 (a date in YYYYMMDD form) poisoned
      // the counter and all new occurrences inherited date-like ordinals.
      var o = Number(r.occurrence_ordinal) || 0;
      if (o > (maxOrdByMaster[mid] || 0) && o <= MAX_PLAUSIBLE_ORDINAL) maxOrdByMaster[mid] = o;
      // Also track the numeric suffix of the instance ID. IDs from prior runs
      // may have suffixes higher than occurrence_ordinal (they diverge when
      // collision-dropped desired occurrences leave holes in the ordinal space
      // while the actual inserted IDs advance further). If nextOrd starts below
      // an existing ID suffix, the new desired occurrence gets an ID that
      // matches an existing pending instance — existingPendingIds rejects it,
      // silently dropping the new instance from the calendar.
      var idNum = ordinalSuffixOf(r.id);
      if (idNum != null && idNum > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = idNum;
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
    // 999.1490: same MAX_PLAUSIBLE_ORDINAL guard as above.
    if (o > (maxOrdByMaster[mid] || 0) && o <= MAX_PLAUSIBLE_ORDINAL) maxOrdByMaster[mid] = o;
    var idNum = ordinalSuffixOf(r.id);
    if (idNum != null && idNum > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = idNum;
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
  tPerf.expandEnd = _clockNowMs() - tPerfStart;

  // R-FR2: id-keyed map storing the forward-roll last-valid-day deadline for each stranded
  // instance. Declared in outer scope so it survives the rowToTask rebuild that happens when
  // reconcileChanged=true. Populated by the IIFE below; consumed by the re-apply mirror (~1341).
  var forwardRollDeadlineById = {};

  // R-FR2 / R-FR3: forward-roll injection for rolling past-due stranded instances.
  // expandRecurring emits occurrences within [today..expandEnd] only. When a rolling
  // task's next arithmetic slot falls beyond expandEnd (e.g. intervalDays=60 with
  // anchor=today-30 → next slot=today+30 > expandEnd=today+14), no desired occurrence
  // is emitted and the reconciler has nothing to match — the stranded instance never
  // moves. For each rolling master with no desired occurrence AND a stranded past-due
  // active instance (date < today, cycle NOT ended), inject a synthetic desired
  // occurrence at today so the reconciler can move the existing row forward.
  // The reconciler's occIdOverrides replaces the synthetic id with the existing
  // instance's id — preserving single-active (R-FR3: same row moves, no new row created).
  (function() {
    var desiredSourceIds = {};
    desiredOccurrences.forEach(function(d) { desiredSourceIds[d.sourceId] = true; });
    allTasks.forEach(function(t) {
      if (t.taskType !== 'recurring_template') return;
      var r = t.recur;
      if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_e) { return; } }
      if (!r || r.type !== 'rolling') return;
      // Find a stranded past-due active instance BEFORE checking desiredSourceIds.
      // We need the stranded instance's date to compute the cycle boundary so we can
      // determine whether any existing desired occurrence is within the current cycle
      // (R-FR2 check below). Short-circuit to avoid the scan for masters with no
      // pending instance at all — that's the common non-stranded case.
      var stranded = null;
      for (var _fi = 0; _fi < allTasks.length; _fi++) {
        var _inst = allTasks[_fi];
        if (_inst.taskType !== 'recurring_instance') continue;
        if (_inst.sourceId !== t.id) continue;
        // R-FR3 / BLOCK-2: cal-linked rows (gcal/msft) are excluded by
        // reconcile.buildExistingGroups — a synthetic occurrence for them would be
        // unmatched → fanout INSERT → duplicate active row (AC2 violation). Skip them;
        // their existing cal-sync reconcile path already manages their placement.
        if (_inst.gcalEventId || _inst.msftEventId) continue;
        var _ist = statuses[_inst.id] || _inst.status || '';
        if (_ist && _ist !== '') continue; // terminal — not stranded
        var _instDate = parseDate(_inst.date);
        if (!_instDate || _instDate >= today) continue; // not in the past
        stranded = _inst;
        break;
      }
      if (!stranded) return;
      // Only forward-roll when the cycle has NOT ended (R-FR5: no slot → Phase 9 pins overdue).
      var _frPeriodEndKey = recurringPeriodEndKey(t.recur, stranded.date);
      var _frPeriodEnd = _frPeriodEndKey ? parseDate(_frPeriodEndKey) : null;
      if (!_frPeriodEnd || today.getTime() >= _frPeriodEnd.getTime()) return; // cycle ended
      // R-FR2 enforcement: expandRecurring runs against allTasksForExpand which excludes
      // all pending instances so the scheduler can do a clean expand. This means the
      // single-active guard inside expandRecurring does not see the stranded instance as
      // "active", and it projects the next anchor-grid occurrence — which may fall
      // OUTSIDE the current cycle (e.g. a weekly rolling task stranded at past-3 has
      // cycle [past-3, today+4) but anchor+35 = today+5 is past the boundary).
      //
      // When desiredSourceIds[t.id] is true it means expandRecurring DID emit at least
      // one desired occurrence. Check if any of those occurrences fall within the current
      // cycle (< _frPeriodEnd):
      //   - If yes → reconciler will move the stranded instance to that occurrence, which
      //     is within the cycle. Return; no synthetic injection needed.
      //   - If no  → all emitted occurrences are out-of-cycle. Remove them to prevent the
      //     reconciler from creating a new next-cycle row (R-FR3 single-active violation),
      //     then fall through to inject the synthetic today occurrence instead.
      if (desiredSourceIds[t.id]) {
        var _hasInCycle = false;
        var _outOfCycleIndices = [];
        for (var _di = 0; _di < desiredOccurrences.length; _di++) {
          if (desiredOccurrences[_di].sourceId !== t.id) continue;
          var _dDate = parseDate(desiredOccurrences[_di].date);
          if (_dDate && _dDate < _frPeriodEnd) {
            _hasInCycle = true;
            break;
          }
          _outOfCycleIndices.push(_di);
        }
        if (_hasInCycle) return; // in-cycle occurrence exists — reconciler handles it
        // All desired occurrences are outside the current cycle: remove them to prevent
        // a new next-cycle row from being created (violates R-FR3 single-active).
        for (var _rj = _outOfCycleIndices.length - 1; _rj >= 0; _rj--) {
          desiredOccurrences.splice(_outOfCycleIndices[_rj], 1);
        }
      }
      // R-FR2: compute the inclusive last valid placement day for this cycle.
      // _frPeriodEndKey is the START of the next cycle (exclusive upper bound);
      // the last valid day is one calendar day before it. Store it on the stranded
      // task object so the reconcile application step can preserve the deadline
      // (the re-apply placement-bracket step recomputes deadline from _candidateDate
      // using flex=0 for rolling type, which collapses the window to a single day;
      // by also setting earliestStart in the reconcile apply step we ensure the
      // re-apply guard sees both truthy and skips the overwrite — see line 1053).
      var _frPeriodEndDate = parseDate(_frPeriodEndKey);
      var _frLastValidDate = new Date(_frPeriodEndDate.getTime());
      _frLastValidDate.setDate(_frLastValidDate.getDate() - 1);
      stranded._forwardRollDeadline = formatDateKey(_frLastValidDate);
      forwardRollDeadlineById[stranded.id] = stranded._forwardRollDeadline; // survives rowToTask rebuild
      // Inject synthetic desired occurrence at today. The reconciler matches it to
      // the stranded instance via nearest-first and produces an occurrenceMove
      // (stranded.date → today). priorDate(_preReconDate) < todayKey causes the
      // placement persistence to write overdue=1 (R-FR1).
      desiredOccurrences.push({
        id: t.id + '-roll-fwd-' + timeInfo.todayKey,
        sourceId: t.id,
        date: timeInfo.todayKey,
        _candidateDate: timeInfo.todayKey,
        taskType: 'recurring_instance',
        text: t.text,
        dur: t.dur,
        pri: t.pri,
        dayReq: 'any',
        when: t.when,
        placement_mode: t.placementMode || t.placement_mode
      });
      logger.info('[SCHED] roll-fwd: master ' + t.id + ' stranded at ' + stranded.date + ' → synthetic target ' + timeInfo.todayKey + ' (cycle ends ' + _frPeriodEndKey + ')');
    });
  })();

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
  // 999.842 — freeze a definitively-past occurrence (recurrence period ENDED) at
  // its original slot rather than forward-moving it: preserves the history record
  // (e.g. a missed medication dose). A flexible-TPC instance still within its
  // period is NOT frozen (it may still forward-roll — §8 preserve-path).
  function shouldFreezePastOccurrence(masterId, group) {
    if (!group || !group.dateObj) return false;
    if (group.dateObj.getTime() >= today.getTime()) return false; // not past → eligible to move
    var master = srcMap[masterId];
    var periodEndKey = master ? recurringPeriodEndKey(master.recur, group.date) : null;
    if (!periodEndKey) return true; // no period info → preserve the past slot (safe default)
    var periodEnd = parseDate(periodEndKey);
    if (!periodEnd) return true;
    // recurringPeriodEndKey returns the first day PAST the period → missed when today >= it.
    return today.getTime() >= periodEnd.getTime();
  }
  var reconResult = reconcile.matchOccurrences(desiredOccurrences, existingGroupsByMaster, parseDate, shouldFreezePastOccurrence);
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
      // R-FR2: for forward-rolled rolling instances the IIFE pre-computed the last
      // valid placement day of the original cycle and stored it as _forwardRollDeadline.
      // Set BOTH earliestStart (= newDate/today) AND deadline (= _forwardRollDeadline)
      // so the re-apply placement-bracket step at line 1464 sees both truthy and skips
      // overwriting — otherwise it recalculates from the rolling flex=0 formula and
      // collapses the window to a single day (today only), discarding the cycle bound.
      // For all other reconcile moves (flexible-TPC, user-driven), both remain null so
      // re-apply runs normally.
      t.earliestStart = t._forwardRollDeadline != null ? mv.newDate : null;
      t.deadline = t._forwardRollDeadline != null ? t._forwardRollDeadline : null;
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
  // ponytail: desiredDatesByMaster tracks which (masterId, dateKey) pairs have a
  // desired occurrence. Used to detect duplicate same-day stale occurrences that
  // must be deleted even when the grandfather clause would otherwise spare them.
  var desiredDatesByMaster = {};
  desiredRows.forEach(function(r) {
    desiredIds[r.id] = true;
    desiredById[r.id] = r;
    if (r.sourceId && r.date) {
      var dk = r.sourceId + '|' + r.date;
      desiredDatesByMaster[dk] = true;
    }
  });
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
      // Use <= today (not <) so a today-dated instance whose occurrence is not in
      // desiredIds is also spared — today == today is still "at or past" and must
      // reach Phase-9, not be hard-deleted here.
      //
      // EXCEPTION (999.1490): if a desired occurrence EXISTS for this same
      // (master, date), this row is a stale duplicate from corrupted ordinals
      // — NOT a genuine past instance needing Phase-9 freeze. Delete it so
      // duplicate same-day occurrences don't accumulate and overlap on the grid.
      var mid = row.master_id || row.source_id;
      if (rowDate && rowDate <= today && row.task_type === 'recurring_instance') {
        if (mid && desiredDatesByMaster[mid + '|' + row.date]) return true;
        return false;
      }
    }
    // PATH-B grandfather: spare past pending recurring instances even when date=NULL
    // (never-placed / unscheduled=1).  The `if (row && row.date)` gate above is
    // falsy for these rows, so the horizon spare and the date-based grandfather both
    // silently skip them — they fall through to `return true` and are hard-deleted.
    // Fix: check task_type OUTSIDE the date gate.  Use scheduled_at as the effective
    // date fallback (dateStrings:true → bare UTC string; append 'Z' for correct parse).
    // If BOTH date and scheduled_at are null the instance was never placed on any day;
    // spare it unconditionally — it must reach Phase-9 to be frozen/missed rather than
    // silently erased. (R32.4 / R50.1 / LOCKED design 999.808)
    if (row && row.task_type === 'recurring_instance') {
      if (!row.date) {
        var effectiveDateForGrandfather = null;
        if (row.scheduled_at != null) {
          // dateStrings:true yields a bare UTC string; append 'Z' so new Date() parses
          // it as UTC rather than local time (see juggler dateStrings trap).
          var satStr = String(row.scheduled_at);
          effectiveDateForGrandfather = new Date(satStr.endsWith('Z') ? satStr : satStr + 'Z');
          if (isNaN(effectiveDateForGrandfather.getTime())) effectiveDateForGrandfather = null;
        }
        // Spare if: (a) the derived effective date is at-or-before today, meaning the
        // occurrence is past (Phase-9 will freeze it as missed), OR (b) no date can be
        // derived at all — a never-placed, never-scheduled pending recurring instance
        // must never be hard-deleted here regardless.
        if (!effectiveDateForGrandfather || effectiveDateForGrandfather <= today) return false;
      }
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
    // Routed through ScheduleRepositoryPort.writeChanged's otherUpdates bucket
    // (W3a, 999.941) — same call shape as the other _runScheduleCommand.persistDelta
    // sites in this file, but handed `db` (not `trx`) so the write commits
    // independently of the surrounding reconcile transaction.
    await _runScheduleCommand.persistDelta(db, userId, toDeleteIds.map(function(id) {
      return { id: id, dbUpdate: { unscheduled: 1, updated_at: _runScheduleCommand.clockNow() } };
    }), { instanceOnly: true });
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
        // R-FR2: read forward-roll deadline from forwardRollDeadlineById (id-keyed, set at
        // injection time in the IIFE). The in-memory prop t._forwardRollDeadline is NOT present
        // after rowToTask reconstructs allTasks from DB rows, so it cannot be read here.
        // Re-stash on t so the persist path and any later in-memory reads see the value.
        // For normal reconcile moves forwardRollDeadlineById has no entry → _fwd=null → both null.
        var _fwd = forwardRollDeadlineById[t.id] != null ? forwardRollDeadlineById[t.id] : null;
        t._forwardRollDeadline = _fwd;
        t.earliestStart = _fwd != null ? mv.newDate : null;
        t.deadline = _fwd != null ? _fwd : null;
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
        // Leg A (instance-owns-window): SOFT earliest-start floor, defaulting to the
        // occurrence's spaced target day. Stored now as the window foundation; the
        // scheduler does NOT yet read it (wiring + the relax-to-week-start behavior
        // land in Leg C with their own tests). Additive — no placement change here.
        earliest_start: occDate,
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
      // H7 (999.1193): routed through ScheduleRepositoryPort.insertTasksBatch
      // (→ lib/tasks-write.insertTasksBatch on the same trx — T-TX preserved).
      await _runScheduleCommand.insertTasksBatch(trx, chunkInsertRows);
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

  tPerf.reconcileEnd = _clockNowMs() - tPerfStart;

  // Load weather data for weather-constrained tasks (fail-open if no coords/cache).
  // Detection delegates to the canonical hasWeatherConstraint() in
  // unifiedScheduleV2.js (W2 dedupe, 999.941) — otherwise a task whose only
  // constraint is humidity skips the load and fails open silently.
  cfg.weatherByDateHour = {};
  var hasWeatherTasks = allTasks.some(unifiedScheduleV2.hasWeatherConstraint);
  if (hasWeatherTasks && cfg.locations && cfg.locations.length > 0) {
    try {
      cfg.weatherByDateHour = await _weatherProvider.loadWeatherForHorizon(cfg.locations, db);
    } catch (_e) {
      cfg.weatherByDateHour = {}; // fail-closed: no data → weatherOk rejects every slot → tasks go to Unplaced
    }
  } else {
    // No locations configured — weather-constrained tasks can't be placed
    cfg.weatherByDateHour = {};
  }

  // 6. Run scheduler. unifiedScheduleV2 is the ONLY scheduler (999.1433
  //    removed the historical shadow wrapper — no v1, no SCHEDULER_V2 env
  //    switch). The Wave C scheduled_at-required guard runs first.
  validateScheduledAt(allTasks);
  var result = unifiedScheduleV2(
    allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg, _runScheduleCommand.clock
  );
  tPerf.scheduleEnd = _clockNowMs() - tPerfStart;

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
  // 999.841 (David ruling 2026-06-23): split chunks persist as SEPARATE rows,
  // each with its OWN scheduled_at — the scheduler must NEVER merge-delete chunk
  // rows, so it can redistribute incomplete chunks to other slots/days later. The
  // visual+mathematical merge of contiguous same-occurrence chunks is now a
  // DISPLAY concern owned by the UI (juggler-frontend), not a DB mutation here.
  // (The former post-placement merge folded contiguous chunks into the primary
  // and hard-deleted the secondaries — that destroyed the per-chunk rows and lost
  // minutes via the drift-fix. Removed.)
  var mergedOutIds = []; // kept empty — no DB-side merge/delete (see above)

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
      // 999.848 — flexible-TPC forward roam: a flexible-TPC recurring instance is
      // NOT day-locked — the scheduler may legitimately place it on any allowed day
      // within its cycle (placement.dateKey != its nominal `date`). That roam MUST be
      // persisted. Previously this guard treated ALL recurring date moves as spurious
      // drift and `continue`d (skipping the write) unless the instance was past-and-
      // within-window. A roamed FUTURE flexible-TPC occurrence therefore had its
      // scheduled_at left NULL while it sat in placementByTaskId (not unplaced) — so
      // it never got unscheduled=1 and vanished (placed on no day, absent from the
      // Unplaced list). Allow the write for a flexible-TPC roam; the dbUpdate below
      // stores scheduled_at/date/time at the roamed slot. (Day-locked recurrings never
      // roam — the scheduler clamps them to their anchor — so they never reach here.)
      if (!isFlexibleTpcRecur(original.recur)) {
        var recurFlex = original.timeFlex != null ? original.timeFlex : 60;
        var recurDaysPast = origTd ? Math.round((today.getTime() - origTd.getTime()) / 86400000) : 0;
        if (!isBehind || recurFlex < recurDaysPast * 1440) continue;
      }
      // Flexible-TPC roam OR past-recurring-within-window — allow the date move
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

    // W3 (sched-drop-overdue-column, M-5): `overdue` is no longer a stored
    // column — nothing is written to it here. `_rawRow` is still needed below
    // for the implied_deadline recompute comparison.
    var _rawRow = rawRowById[taskId];

    var dbUpdate = {
      scheduled_at: newScheduledAt,
      date: newDate || null,
      day: newDay,
      time: newTime || null,
      unscheduled: null,
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

    // 999.990: recompute implied_deadline on every real write for a recurring
    // instance. Phase 1 (chunk pre-insert, ~:1417) materializes implied_deadline
    // ONCE at INSERT time; it was never recomputed afterward, so a later roam/
    // reschedule left the cycle-boundary deadline stale. Per R6 (instance-date-
    // rules.test.js:528-539), the cycle window is measured from the OCCURRENCE
    // ANCHOR (earliestStart), NOT the placed date — using newDate here would
    // give the wrong (later) deadline on a flexible-TPC roam. Routed as a
    // SEPARATE pendingUpdate: the batched CASE-expression path in
    // KnexScheduleRepository.writeChanged hand-builds its field list and does
    // not generically copy implied_deadline off dbUpdate, so folding it into
    // the main dbUpdate above would be silently dropped on every real move.
    // The per-row otherUpdates path (tasksWrite.updateTaskById →
    // splitUpdateFields) does write it — INSTANCE_UPDATE_FIELDS already
    // includes implied_deadline.
    if (original.recurring && original.recur) {
      var _impliedAnchor = original.earliestStart || newDate;
      var _recomputedDeadline = recurringPeriodEndKey(original.recur, _impliedAnchor);
      // Skip the write when it's a no-op (matches the main dbUpdate's
      // placementMatchesDbRow discipline above): most real writes here are
      // driven by an unrelated field (dur/slack_mins), not a cycle-boundary
      // move, so recomputing without comparing would fire an extra per-row
      // UPDATE on every one of them. Also guards the edge case where both
      // earliestStart and newDate are absent (_recomputedDeadline=null) from
      // ever clobbering a previously-valid stored deadline — only a computed
      // value that actually differs from the current row is written.
      var _rawImplied = _rawRow ? (_rawRow.implied_deadline || null) : undefined;
      if (_rawImplied === undefined || _recomputedDeadline !== _rawImplied) {
        pendingUpdates.push({
          id: taskId,
          dbUpdate: { implied_deadline: _recomputedDeadline, updated_at: _runScheduleCommand.clockNow() }
        });
      }
    }

    // W3 (sched-drop-overdue-column, M-5): the R-FR1 secondary pendingUpdate
    // that used to persist overdue=1 across a forward-roll (so it would
    // survive a future re-placement) is DELETED OUTRIGHT — not replaced with
    // a computed equivalent. David's ruling (2026-07-03, "let's skip the
    // future placement of overdue items — leave it to the user to change the
    // due date, as needed") means there is no longer any behavior to
    // preserve here: overdue is computed-on-read only (taskMappers.js
    // computeOverdueForRow), and a forward-rolled instance placed on a
    // genuinely future slot simply stops being overdue (AC6b) — the
    // today-or-earlier case (AC6a) is unaffected, produced by the same
    // existing R-OD3 branch with zero write-side involvement.

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
      // W3 (sched-drop-overdue-column, M-5): overdue is computed-on-read only
      // now — no stored flag to preserve or clear. Recompute the POST-move
      // value via the SAME single-source-of-truth rowToTask (sourceMap-merged,
      // exactly as any subsequent GET /tasks read would compute it) rather
      // than re-deriving the AC6a/AC6b rule inline, and only emit the patch
      // on a genuine transition (mirrors the unscheduled pattern above).
      if (_rawRow) {
        // 999.1102: fold the separately-routed implied_deadline recompute
        // (lines ~1823-1841) into the post-move row so computeOverdueForRow
        // sees the SAME implied_deadline the next GET will read. Without this,
        // a forward-rolled rolling/weekly-TPC instance can get an SSE
        // overdue=false (stale implied_deadline) while the next GET returns
        // overdue=true (recomputed implied_deadline) — a transient divergence
        // that self-corrects on the next GET/poll but causes a visible flicker.
        var _postMoveExtra = {};
        if (typeof _recomputedDeadline !== 'undefined' && _recomputedDeadline !== null) {
          _postMoveExtra.implied_deadline = _recomputedDeadline;
        }
        var _postMoveRow = Object.assign({}, _rawRow, dbUpdate, _postMoveExtra);
        var _postMoveOverdue = !!rowToTask(_postMoveRow, TIMEZONE, srcMap, null, timeInfo).overdue;
        if (_postMoveOverdue !== !!original.overdue) patch.overdue = _postMoveOverdue;
      }

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
      // sched-chunk-collision-lockbypass fix: a chunk unplaced this run because it
      // structurally overflowed its cycle's capacity (RECURRING_SPLIT_OVERFLOW —
      // unifiedScheduleV2.js's time-boxing pass) was never a genuinely-scheduled,
      // merely-overdue placement the R-FR5 pin below is meant to protect — its prior
      // scheduled_at is a stale artifact from a run whose chunk distribution no
      // longer holds (e.g. an earlier sibling chunk now occupies more of the day).
      // Pinning it in place risks re-surfacing exactly the sibling-collision bug
      // this fix addresses (two chunks left sharing one identical scheduled_at
      // forever, since neither the persist step nor a later run ever revisits a
      // pinned "already in place" row). Route it through the unscheduled path
      // below instead, same as a never-placed chunk.
      if (hasScheduledAt && t._unplacedReason === REASON_CODES.RECURRING_SPLIT_OVERFLOW) {
        hasScheduledAt = false;
      }
      if (hasScheduledAt) {
        // R-FR5: past-due rolling instance that couldn't be placed this run.
        // W3 (sched-drop-overdue-column, M-5): overdue is no longer written
        // here — a placed-in-the-past recurring instance already reads
        // overdue:true on the next GET via the computed R-OD3 branch
        // (taskMappers.js computeOverdueForRow), pinned on the calendar,
        // NEVER pushed to the next cycle. The writes below are scoped to
        // `unscheduled`/`date`/`scheduled_at`/reason fields only.
        var _origDateRaw = rawRec && rawRec.date ? String(rawRec.date).split('T')[0] : null;
        if (_origDateRaw && _origDateRaw < timeInfo.todayKey) {
          // R-OD1 / W1 fix: when the forward-roll IIFE moved this instance in-memory
          // (forwardRollDeadlineById[t.id] is set), reconcile set t.date=todayKey but
          // placement failed. Persist the date-move so the row advances to today and
          // appears in the unscheduled lane (unscheduled=1, scheduled_at=null;
          // overdue reads true via the computed branch, not a write here).
          // Without this the date stayed at the stale past date — the live
          // 'Get a Haircut' stuck-at-6/24 symptom (R-OD1 / juggy3 W1).
          // When NO forward-roll is pending (forwardRollDeadlineById not set — cycle-ended
          // or plain unplaced), fall through to the original R-FR5 pin: date
          // unchanged. AC4/AC1c (cycle-ended stays at past date) rely on this path.
          if (forwardRollDeadlineById[t.id] != null) {
            var _frUnplacedUpd = {
              date: timeInfo.todayKey,
              scheduled_at: null,
              unscheduled: 1,
              unplaced_reason: t._unplacedReason || REASON_CODES.NO_SLOT,
              unplaced_detail: t._unplacedDetail || 'No available slot in the schedule',
              updated_at: _runScheduleCommand.clockNow()
            };
            if (result.slackByTaskId && t.id in result.slackByTaskId) {
              _frUnplacedUpd.slack_mins = result.slackByTaskId[t.id];
            }
            pendingUpdates.push({ id: t.id, dbUpdate: _frUnplacedUpd });
            return;
          }
          // No forward-roll pending and nothing else to write here — the
          // computed branch already reads this instance as overdue on the
          // next GET without any DB write.
        }
        return;
      }
      var unplacedChunkUpdate = { unscheduled: 1, scheduled_at: null, unplaced_reason: t._unplacedReason || REASON_CODES.NO_SLOT, unplaced_detail: t._unplacedDetail || 'No available slot in the schedule', updated_at: _runScheduleCommand.clockNow() };
      if (result.slackByTaskId && t.id in result.slackByTaskId) {
        unplacedChunkUpdate.slack_mins = result.slackByTaskId[t.id];
      }
      // ernie fix-review WARN (sched-chunk-collision-lockbypass): a RECURRING_SPLIT_OVERFLOW
      // chunk diverted into this path above can ALSO be past-dated with a pending
      // forward-roll (forwardRollDeadlineById[t.id] set) — mirror the R-OD1/W1 date
      // advance the R-FR5 branch performs above (:1970-1972), or the row is left
      // unscheduled at a stale past `date` (the same "stuck at a past date" symptom
      // that fix addressed, reintroduced for this diverted path).
      if (forwardRollDeadlineById[t.id] != null) {
        unplacedChunkUpdate.date = timeInfo.todayKey;
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
      // W3 (sched-drop-overdue-column, M-5): no stale overdue flag to clear anymore —
      // a floating task's computed overdue (computeOverdueForRow) is already false
      // (no hasHardCommitment signal), so there is nothing to write here.
      //
      // CONSTRAINT-VIOLATION EXCEPTION: if the task was unplaced due to a structural
      // constraint failure (weather, tool_conflict, location_mismatch, impossible_window),
      // the stale position may itself violate those constraints — preserving it would
      // show the task at a slot where it CANNOT run (e.g. 8 PM when the `when` tags say
      // morning/afternoon, or outdoors when humidity exceeds the limit). Move it to the
      // unscheduled lane with the reason preserved instead. Capacity-only failures
      // (no_slot — calendar full) keep the old position: the task might fit later.
      if (!original.deadline) {
        var _constraintReason = t._unplacedReason && (
          t._unplacedReason === REASON_CODES.WEATHER ||
          t._unplacedReason === REASON_CODES.WEATHER_UNAVAILABLE ||
          t._unplacedReason === REASON_CODES.TOOL_CONFLICT ||
          t._unplacedReason === REASON_CODES.LOCATION_MISMATCH ||
          t._unplacedReason === REASON_CODES.IMPOSSIBLE_WINDOW
        );
        if (_constraintReason) {
          // ponytail: reuse Case C's unscheduled-lane write — no point duplicating it.
          var _constraintDbUpdate = {
            unscheduled: 1,
            unplaced_reason: t._unplacedReason,
            unplaced_detail: t._unplacedDetail || 'No available slot in the schedule',
            updated_at: _runScheduleCommand.clockNow()
          };
          if (result.slackByTaskId && t.id in result.slackByTaskId) {
            _constraintDbUpdate.slack_mins = result.slackByTaskId[t.id];
          }
          pendingUpdates.push({ id: t.id, dbUpdate: _constraintDbUpdate });
          cleared++;
          return;
        }
        cleared++;
        return;
      }
      // Guard: ANYTIME tasks without a passed deadline are not overdue when they
      // can't fit in today's time grid — the calendar is simply full right now.
      // Only pin in place (Case B below) if (a) the task was placed on a prior day
      // (rolled over without completion) OR (b) its deadline has already passed.
      // This prevents a full calendar from permanently locking ANYTIME tasks in an
      // overdue-looking pinned state on every subsequent scheduler run.
      if (original.placementMode === PLACEMENT_MODES.ANYTIME) {
        var _aDeadlineKey = original.deadline ? isoToDateKey(original.deadline) : null;
        var _aInPast = original.date && original.date < timeInfo.todayKey;
        var _aDeadlinePassed = _aDeadlineKey && _aDeadlineKey < timeInfo.todayKey;
        if (!_aInPast && !_aDeadlinePassed) {
          cleared++;
          return;
        }
      }
      // Case B: was previously placed — pin in place. Keep unscheduled=0 so the
      // task renders at its scheduled position; overdue is computed-on-read
      // (computeOverdueForRow) from `original.deadline`/date being in the past —
      // reaching this branch already implies that computed value is true (W3,
      // sched-drop-overdue-column: no write needed to make it read true).
      // `original.overdue` is the ALREADY-COMPUTED value from rowToTask at the
      // top of this run (not a raw column read) — the single source of truth
      // for "was this already overdue" continuity.
      var wasAlreadyOverdue = !!original.overdue;

      // Only write if there's a state change:
      // 1. If already in final state (unscheduled=0, no stale reason) → only write if slack_mins changed
      // 2. If unscheduled/reason needs fixing → write the full transition
      var needsUpdate = false;
      var overdueDbUpdate = {};
      var _alreadyFinalState = !!(rawRow && rawRow.unscheduled === 0 &&
        !rawRow.unplaced_reason && !rawRow.unplaced_detail);

      if (_alreadyFinalState) {
        // Already in final state (unscheduled=0, no stale reason).
        // Only update if slack_mins changed.
        if (result.slackByTaskId && t.id in result.slackByTaskId &&
            result.slackByTaskId[t.id] !== (rawRow.slack_mins || 0)) {
          overdueDbUpdate.slack_mins = result.slackByTaskId[t.id];
          needsUpdate = true;
        }
      } else {
        // unscheduled flag or stale reason needs fixing.
        overdueDbUpdate.unscheduled = 0;
        // DB-single-source (W1): pinned on the grid, NOT unplaced. Clear any
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
      var unplacedDbUpdate = { unscheduled: 1, unplaced_reason: t._unplacedReason || REASON_CODES.NO_SLOT, unplaced_detail: t._unplacedDetail || 'No available slot in the schedule', updated_at: _runScheduleCommand.clockNow() };
      // D-A (David ruling, 2026-07-02): a one-off/chain-member task that never
      // found a placement, carrying a real deadline, is pinned to its own
      // DEADLINE date — never left at whatever stale `date` the row already
      // had. unifiedScheduleV2.js's stillUnplaced pinning pass already mutates
      // `t.date` (== original.date, same object reference) to the deadline
      // in-memory for exactly this case (plain one-off, non-recurring,
      // non-split, real deadline); persist that pinned value so the DB row
      // doesn't retain the stale prior date. No-deadline tasks are unaffected
      // (original.deadline falsy → no `date` write, unchanged pre-existing
      // behavior).
      if (original.deadline && original.date) {
        unplacedDbUpdate.date = original.date;
      }
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

  // 8.6. [REMOVED — W3, sched-drop-overdue-column / M-5] Previously cleared a
  // stale stored overdue=1 flag on tasks that were overdue in the DB but are
  // now placed again (constraint resolved). Overdue is computed-on-read only
  // now (taskMappers.js computeOverdueForRow) — a task whose unplaceable
  // constraint has resolved and is placed again simply reads overdue:false on
  // the next GET (no hasHardCommitment signal survives from a prior run),
  // with nothing to clear. This entire sweep is dead code once nothing reads
  // the (soon-to-be-dropped) column.

  // 8.5 — R50.1/R50.2 (999.796): a past-due FIXED/ingested event. The placement
  // loop skips fixed tasks (user-anchored) and Phase 8/9 early-return them.
  // W3 (sched-drop-overdue-column, M-5): the overdue=1 persistence this block
  // used to write is REMOVED — a past-due FIXED event already reads
  // overdue:true on the next GET via computeOverdueForRow's FIXED branch
  // (dueKey derived directly from scheduled_at, no stored-column dependency).
  // The `unscheduled` clear is still needed (a stale unscheduled=1 flag is a
  // DIFFERENT, still-stored field) so the frontend shows the late event on its
  // day instead of in the Unscheduled lane / "Past Scheduled Date".
  allTasks.forEach(function(t) {
    if (t.generated || t.taskType === 'recurring_template') return;
    if (t.recurring) return; // recurring handled by their own lifecycle (Phase 9)
    if (t.placementMode !== PLACEMENT_MODES.FIXED) return;
    var stFx = statuses[t.id] || '';
    if (stFx === 'done' || stFx === 'cancel' || stFx === 'skip' || stFx === 'pause' || stFx === 'disabled') return;
    var rawFx = rawRowById[t.id];
    if (!rawFx) return;
    var schedMinsFx = t.time ? parseTimeToMinutes(t.time) : null;
    if (!computeIsPastDue(t, schedMinsFx, timeInfo)) return; // not past its due date/time
    if (!rawFx.unscheduled) return; // nothing stale to clear
    // DB-single-source (W1): a past-due FIXED event is OVERDUE on its day, not
    // unplaced — clear the stale unscheduled flag + any stale reason alongside it.
    pendingUpdates.push({
      id: t.id,
      dbUpdate: {
        unscheduled: 0,
        unplaced_reason: null,
        unplaced_detail: null,
        updated_at: _runScheduleCommand.clockNow()
      }
    });
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
        // AC-840-4 (REG-26/F9): use the explicit effective deadline = min(period-boundary, window-close),
        // per SCHEDULER-SPEC.md:700 LOCKED ruling (David 2026-06-23).
        // A past recurring instance stays live (not overdue) while today < effectiveDeadline.
        //  (1) timeFlex window: occurrence date + timeFlex minutes (scheduler may still place it late).
        //  (2) R50.0 recurrence-PERIOD boundary: a flexible-TPC instance may roam within its cycle
        //      (e.g. a 3×/week task is not missed until the week ends).
        // effectiveDeadline = min(windowClose, periodEnd) — overdue as soon as EITHER has passed, so
        // the sweep never lags a run where the scheduler already marked this same occurrence MISSED.
        var flex = t.timeFlex != null ? t.timeFlex : 60;
        var windowCloseDate = new Date(td.getTime() + flex * 60 * 1000);
        var periodEndKey = recurringPeriodEndKey(t.recur, effectiveDate);
        var periodEnd = periodEndKey ? parseDate(periodEndKey) : null;
        var effectiveDeadline = computeEffectiveDeadline({ periodBoundary: periodEnd, windowClose: windowCloseDate });
        if (!effectiveDeadline || today < effectiveDeadline) return; // still within effective deadline
        // Leg D (scheduler-recurring-rework §4) — AUTO-MISS REMOVED.
        // A past-incomplete recurring instance is NEVER auto-marked terminal 'missed'
        // by the system (David, 2026-06-24: "there should not be any auto-miss feature").
        // Per R50 + the never-missing invariant (memory: juggler-never-missing-invariant),
        // it stays a LIVE, VISIBLE commitment:
        //   - has a placement (scheduled_at set) → flag OVERDUE, pinned on its day. Do NOT
        //     move it, do NOT close it. The user may still manually skip/cancel.
        //   - never placed (scheduled_at NULL) → surface it in the Unplaced list here. The
        //     §9.6 no-limbo sweep scopes to [today, expandEnd] and does NOT cover this past
        //     occurrence, so without this flag it would end NULL/NULL/non-terminal = a
        //     never-missing VIOLATION. Flag unscheduled so it is always visible.
        // (Was: 999.808 freeze-as-missed at last real slot — retired with auto-miss.)
        if (rawRowPast.scheduled_at != null) {
          // W3 (sched-drop-overdue-column, M-5): overdue is computed-on-read
          // only — no write needed here, this instance already reads
          // overdue:true on the next GET via computeOverdueForRow.
          //
          // David ruling (2026-07-09): a past-incomplete recurring instance
          // that already HAD a placement must ALSO be pulled off the grid
          // (unscheduled=1), not left pinned/visible at its stale scheduled_at
          // — matching the never-placed branch below. It stays fully visible
          // via the Unplaced list (derivePlacements.js) with overdue=true; this
          // does not violate the never-missing invariant, it just moves WHERE
          // the still-live commitment is shown. Supersedes the prior "stay
          // pinned at the old slot" half of R50 for this specific branch.
          if (!rawRowPast.unscheduled) {
            pendingUpdates.push({
              id: t.id,
              dbUpdate: { unscheduled: 1, updated_at: _runScheduleCommand.clockNow() }
            });
          }
          // Emit SSE transition only when crossing placed → overdue. `t.overdue`
          // is the ALREADY-COMPUTED value from rowToTask at the top of this run
          // (not a raw column read) — the single source of truth for continuity.
          // 999.1102: verify the overdue value against computeOverdueForRow
          // using the raw DB row (with any pending unscheduled clear applied),
          // so the SSE patch matches what the next GET will return. Without
          // this, a rolling cycle-ended instance can get an SSE overdue=true
          // while computeOverdueForRow's next GET returns false (e.g. when the
          // effective deadline check here diverges from computeOverdueForRow's
          // hasHardCommitment / implied_deadline logic).
          if (!t.overdue) {
            // Simulate the pending update above: unscheduled becomes 1 unless
            // it already was (matches the `if (!rawRowPast.unscheduled)` guard).
            var _patchRow = rawRowPast.unscheduled
              ? rawRowPast
              : Object.assign({}, rawRowPast, { unscheduled: 1 });
            var _willBeOverdue = !!_computeOverdueForRow(_patchRow, TIMEZONE, timeInfo);
            if (_willBeOverdue) {
              updatedTasks.push({
                id: t.id, text: t.text, from: effectiveDate, to: effectiveDate, patch: { overdue: true }
              });
            }
          }
        } else if (!rawRowPast.unscheduled) {
          // F6 (sched-overdue-reasons leg, David ruling brain 101837): every
          // occurrence reaching this branch has ALREADY failed the
          // effectiveDeadline check above (today >= effectiveDeadline) AND
          // was never placed (scheduled_at NULL) — that is, by construction,
          // a genuinely MISSED past occurrence, not merely "no slot found
          // this run". Some shapes (e.g. a day-locked non-flexible-TPC
          // ANYTIME recurring instance whose date is in the past) are
          // dropped by unifiedScheduleV2's own buildItems filter
          // (:274-309) BEFORE an item is ever built, so t._unplacedReason
          // is never set upstream for them and this fallback was firing —
          // mirror unifiedScheduleV2's own pastAnchoredRecurrings pass
          // (:2493-2504), which stamps REASON_CODES.MISSED for the past-
          // anchored shapes IT reaches, instead of the generic NO_SLOT
          // capacity code (a real reason already set upstream, e.g. by a
          // dep/weather/tool block THIS run, is preserved via the `||`).
          pendingUpdates.push({
            id: t.id,
            dbUpdate: {
              unscheduled: 1,
              unplaced_reason: t._unplacedReason || REASON_CODES.MISSED,
              unplaced_detail: t._unplacedDetail || 'Past occurrence — recurring window missed',
              updated_at: _runScheduleCommand.clockNow()
            }
          });
        }
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
  // 9.6 — NO-LIMBO INVARIANT (999.848, David's rule): a pending recurring instance
  // must end every run EITHER placed (scheduled_at set) OR in the Unplaced list
  // (unscheduled=1) OR resolved (terminal status) — NEVER in limbo (scheduled_at NULL
  // AND unscheduled NULL AND non-terminal), which renders on no day and is absent from
  // Unplaced (invisible). The root fix above persists legitimate roams; this is the
  // defense-in-depth backstop: any recurring instance that still has a NULL final
  // scheduled_at and was neither flagged nor resolved this run is a dropped placement —
  // flag it unscheduled so it surfaces in Unplaced rather than vanishing.
  //
  // IMPORTANT: rawRowById is built from taskRows which is loaded BEFORE Phase 1's INSERT.
  // Phase 1 pre-inserts new recurring instance rows (scheduled_at=null) that are NOT in
  // rawRowById. phase1InsertedById tracks exactly those rows. The merged lookup
  // rawRowById[id] || phase1InsertedById[id] covers both cases so a roamed-and-dropped
  // Phase-1 instance (placed in-memory by the scheduler, skipped by L1's persist guard)
  // is correctly caught here rather than silently left in limbo.
  var pendingById = {};
  pendingUpdates.forEach(function(p) {
    pendingById[p.id] = Object.assign(pendingById[p.id] || {}, p.dbUpdate);
  });
  var noLimboUpdates = computeNoLimboUpdates(
    allTasks, rawRowById, phase1InsertedById, pendingById, statuses, today, expandEnd, _runScheduleCommand.clockNow()
  );
  noLimboUpdates.forEach(function(u) { pendingUpdates.push(u); });
  var limboFlagged = noLimboUpdates.length;
  if (limboFlagged > 0) logger.info('[SCHED] no-limbo invariant: flagged ' + limboFlagged + ' dropped recurring instance(s) as unplaced');

  // AC-840-3 / AC-881-1: fail-loud disjointness check at persist boundary (WARN-only).
  // Overlapping placements are surfaced here so they never silently reach the DB.
  var disjointViolations = checkPlacementDisjointness(dayPlacements);
  disjointViolations.forEach(function(v) {
    logger.warn('[SCHED] disjoint placement violation: ' + v.date + ' ' + v.a + '(' + v.aStart + '-' + v.aEnd + ') overlaps ' + v.b + '(start ' + v.bStart + ')');
  });

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
  tPerf.persistEnd = _clockNowMs() - tPerfStart;
  logger.info('[SCHED] perf user=' + userId
    + ' load=' + tPerf.loadEnd
    + 'ms expand=' + (tPerf.expandEnd - tPerf.loadEnd)
    + 'ms reconcile=' + (tPerf.reconcileEnd - tPerf.expandEnd)
    + 'ms schedule=' + (tPerf.scheduleEnd - tPerf.reconcileEnd)
    + 'ms persist=' + (tPerf.persistEnd - tPerf.scheduleEnd)
    + 'ms total=' + tPerf.persistEnd
    + 'ms tasks=' + taskRows.length
    + ' placed=' + updated);

  // 999.1217 (W4, SCHEDULER-SPEC.md D6): step 10 used to build a placementCache
  // blob (dayPlacements/unplaced/unplacedMeta) and upsert it into user_config as
  // schedule_cache, purely so cal-sync.controller.js could read split-part
  // placements + duration corrections back out of it. cal-sync no longer reads
  // schedule_cache (task_instances is authoritative for placements incl. split
  // parts, 999.841) — nothing reads this table anymore, so the write is removed
  // too. GET /placements also no longer reads it (see deriveSchedulePlacements.js
  // W3 note) — it derives placements from the live task list instead.

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
    var isTransient = err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT'
      || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'PROTOCOL_CONNECTION_LOST'
      || (err.message && /connection.*(reset|lost|closed|aborted)/i.test(err.message));
    if (isTransient && retries < MAX_RETRIES) {
      logger.info('[SCHED] transient error (' + err.code + ') — retry ' + (retries + 1) + '/' + MAX_RETRIES);
      await new Promise(function(r) { setTimeout(r, 500 * (retries + 1)); });
      return runScheduleAndPersist(userId, retries + 1, options);
    }
    throw err;
  }
}

/**
 * computeNoLimboUpdates — pure helper for the 9.6 no-limbo safety-net sweep.
 *
 * Exported so telly can unit-test L2 directly with a crafted in-memory
 * limbo input, without needing a full integration run (L1 prevents L2 from
 * firing in normal operation, so integration tests cannot exercise it once L1
 * is healthy). The inline sweep above calls this; no production caller should
 * import it directly.
 *
 * @param {Array}  allTasks          - All task objects for this run (from allTasks)
 * @param {Object} rawRowById        - id → raw DB row (from taskRows, pre-Phase-1)
 * @param {Object} phase1InsertedById - id → raw row for rows inserted in Phase 1 this run
 * @param {Object} pendingById       - id → merged dbUpdate object (accumulated pendingUpdates)
 * @param {Object} statuses          - id → status string (from statuses map)
 * @param {Date}   today             - Start of the scheduling window (today midnight, local)
 * @param {Date}   expandEnd         - End of the scheduling window (today + RECUR_EXPAND_DAYS)
 * @param {Date}   now               - Clock value for updated_at stamps
 * @returns {Array} Array of { id, dbUpdate } objects to append to pendingUpdates
 */
function computeNoLimboUpdates(allTasks, rawRowById, phase1InsertedById, pendingById, statuses, today, expandEnd, now) {
  var updates = [];
  allTasks.forEach(function(t) {
    if (!t || t.taskType !== 'recurring_instance') return;
    // Accept rows from the pre-Phase-1 snapshot OR rows inserted by Phase 1 this
    // run. Phase 1 rows are missing from rawRowById because taskRows was loaded
    // before the INSERT — falling back to phase1InsertedById fills that gap.
    var raw = rawRowById[t.id] || phase1InsertedById[t.id];
    if (!raw) return; // not a DB-persisted row — nothing to persist
    // Scope to the active scheduling window [today, expandEnd]. PAST instances are
    // Phase-9's domain (auto-miss/freeze); instances grandfathered BEYOND expandEnd
    // (from a prior larger horizon) were never placement candidates this run, so a
    // NULL scheduled_at there is expected, not limbo. Only today→horizon occurrences
    // are eligible for the no-limbo flag.
    // Exception (999.843, NEVER-MISSING): a NULL-date orphan ghost (date=NULL AND
    // scheduled_at=NULL, non-terminal) has NO domain in Phase-9 (it bails with no
    // anchor) — it must fall through here to be surfaced unscheduled. Only skip a
    // row that HAS a date and falls outside the window; never skip a null-date row.
    var nominalDate = raw.date ? parseDate(raw.date) : null;
    if (nominalDate && (nominalDate < today || nominalDate > expandEnd)) return;
    var pu = pendingById[t.id] || {};
    // Resolve the FINAL state this run would leave on the row (pendingUpdate wins).
    var finalStatus = ('status' in pu) ? pu.status : (statuses[t.id] || raw.status || '');
    if (TERMINAL_STATUSES.indexOf(finalStatus) >= 0) return; // resolved, not pending
    var finalSched = ('scheduled_at' in pu) ? pu.scheduled_at : raw.scheduled_at;
    if (finalSched != null) return; // placed — not limbo
    var finalUnsched = ('unscheduled' in pu) ? pu.unscheduled : raw.unscheduled;
    if (finalUnsched) return; // already in the Unplaced list
    // LIMBO → flag unplaced so the frontend renders it in Unplaced, never nowhere.
    var limboUpdate = Object.assign({}, pu, {
      unscheduled: 1,
      unplaced_reason: t._unplacedReason || REASON_CODES.NO_SLOT,
      unplaced_detail: t._unplacedDetail || 'No available slot in the recurrence window',
      updated_at: now
    });
    updates.push({ id: t.id, dbUpdate: limboUpdate });
  });
  return updates;
}

module.exports = {
  runScheduleAndPersist,
  computeWindowCloseUtc,
  computeEffectiveDeadline,
  checkPlacementDisjointness,
  recurringPeriodEndKey,
  computeIsPastDue,
  setWeatherProvider,
  getWeatherProvider,
  // Test-only exports — pure-function seams for unit tests.
  // Never call from production code.
  _placementMatchesDbRow: config.getString('NODE_ENV') === 'test' ? placementMatchesDbRow : undefined, // 999.1473
  _computeNoLimboUpdates: config.getString('NODE_ENV') === 'test' ? computeNoLimboUpdates : undefined, // 999.1473
  _ordinalSuffixOf: config.getString('NODE_ENV') === 'test' ? ordinalSuffixOf : undefined, // 999.1473
  // Test-only clock seam (999.1427): swap the ClockPort that drives
  // getNowInTimezone (todayKey/nowMins) and clockNow() stamps, so DB-backed
  // integration tests can freeze the scheduler wall clock deterministically
  // (e.g. with FakeClockAdapter). Returns the previous clock so callers can
  // restore it in a finally block. Never call from production code.
  _setClock: config.getString('NODE_ENV') === 'test' ? function _setClock(clock) { // 999.1473
    var prev = _runScheduleCommand.clock;
    _runScheduleCommand.clock = clock;
    return prev;
  } : undefined
};
