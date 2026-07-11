/**
 * Task row ↔ entity/API mappers — PURE relocation of the legacy
 * `task.controller.js` transform helpers (Phase H3 / W2).
 *
 * ── BEHAVIOR-IDENTICAL RELOCATION (B6), NOT A REWRITE ─────────────────────────
 * Every function here is the VERBATIM logic of the corresponding helper in
 * `src/controllers/task.controller.js` (as of the W1 golden-master snapshot):
 *
 *     this file            ←  task.controller.js
 *     ─────────────────       ─────────────────────────────────
 *     safeParseJSON        ←  ~line 141
 *     normalizePri         ←  ~line 151
 *     scheduledAtToISO     ←  ~line 162
 *     parseISOToDate       ←  ~line 179
 *     TEMPLATE_FIELDS      ←  ~line 192
 *     buildSourceMap       ←  ~line 316
 *     rowToTask            ←  ~line 333
 *     taskToRow            ←  ~line 512
 *
 * The W2 mapper-characterization tests (tests/slices/task/domain/) feed identical
 * inputs to BOTH the legacy controller export and these functions and deep-equal
 * the output — the proof the relocation is byte-identical.
 *
 * ── PURITY (W2 (c), DESIGN §7) ────────────────────────────────────────────────
 * This module has ZERO `require('knex')`, `require('../../db')`, `lib/db`,
 * `express`, or any SDK. Its only requires are PURE transform helpers:
 *   - ../../../../scheduler/dateHelpers  (re-exports shared/scheduler/dateHelpers
 *      — localToUtc / utcToLocal / toDateISO / fromDateISO; pure date math, no I/O)
 *   - ../../value-objects/TaskStatus     (closed-enum VO; folds in task-status'
 *      isTerminalStatus for the rowToTask terminal-clamp — same predicate)
 * Data enters via arguments only.
 *
 * ── LOGGER INJECTION (purity-preserving) ──────────────────────────────────────
 * The legacy `rowToTask` calls `logger.warn(...)` for an orphaned recurring
 * instance (template missing). DESIGN §7 says the domain stays log-free, so
 * instead of `require`-ing a logger (an infra concern) the warn is emitted
 * through an OPTIONAL injected logger (4th arg / default no-op). The W1
 * golden-master never asserts the warn (verified — no `warn`/`logger` assertions
 * in the suite), and the 3-arg call sites produce byte-identical task output, so
 * the warn behavior is preserved without coupling the domain to a logger.
 *
 * ── NO NEW FALLBACKS ──────────────────────────────────────────────────────────
 * Every `||` / `??` / default below is PRESERVED VERBATIM as characterized
 * behavior (e.g. `row.task_type || 'task'`, `weatherPrecip || 'any'`,
 * `safeParseJSON(..., [])`). No new fallback is introduced.
 */

'use strict';

var dateHelpers = require('../../../../scheduler/dateHelpers');
var TaskStatus = require('../value-objects/TaskStatus');
// W4 (R50.8): shared now-contract — pure, no I/O. Used by the computed-on-read
// overdue predicate in rowToTask. Kept at module level so the shared/ module is
// loaded once (CJS singleton); rowToTask remains pure (now injected via optional
// 5th arg; default computes from this shared contract using the row's timezone).
// Path: mappers/ → domain/ → task/ → slices/ → src/ → juggler-backend/ → juggler/ → shared/
// (6 parent dirs up from mappers/ to reach juggler/, then into shared/)
var _getNowInTimezoneModule = require('juggler-shared/scheduler/getNowInTimezone');
var _getNowInTimezone = _getNowInTimezoneModule.getNowInTimezone;
// R50.8 canonical default — approved fallback for null-tz rows (WBS-fixy-crud-rot RC2).
// Any row with no stored timezone falls back to America/New_York, matching the shared
// module's own default (getNowInTimezone.js:30) and the project DEFAULT_TIMEZONE constant.
var _DEFAULT_TIMEZONE = _getNowInTimezoneModule.DEFAULT_TIMEZONE;
// Path: mappers/ → domain/ → task/ → slices/ → src/ → lib/
// (4 parent dirs up from mappers/ to reach src/, then into lib/)
var _PLACEMENT_MODES = require('../../../../lib/placementModes').PLACEMENT_MODES;

var utcToLocal = dateHelpers.utcToLocal;
var toDateISO = dateHelpers.toDateISO;
var fromDateISO = dateHelpers.fromDateISO;
var localToUtc = dateHelpers.localToUtc;

// ponytail: guard against MySQL zero-dates (0000-00-00) which produce
// Invalid Date objects — isNaN(d.getTime()) is true for those.
function isValidDate(val) {
  if (val === null || val === undefined) return false;
  var d = val instanceof Date ? val : new Date(val);
  return !isNaN(d.getTime());
}

// isTerminalStatus predicate — characterized identical to lib/task-status via the
// TaskStatus VO's TERMINAL set (rowToTask uses it for the terminal-clamp below).
function isTerminalStatus(s) {
  return TaskStatus.TERMINAL.indexOf(s) !== -1;
}

// No-op logger default — keeps the domain log-free while preserving the legacy
// warn call shape when a logger is injected.
var NOOP_LOGGER = { warn: function () {} };

/**
 * Normalize a DB DATE column value to a canonical "YYYY-MM-DD" string.
 *
 * The `date` column on task_instances/task_masters comes back from knex EITHER as
 * a "YYYY-MM-DD" string (dateStrings mode) OR as a JS Date pinned to UTC midnight
 * (default mode). Both must collapse to the same calendar day with NO timezone
 * shift — the DATE column has no time-of-day, so applying the display timezone
 * (which `utcToLocal` does for `scheduled_at`) would wrongly roll a UTC-midnight
 * Date back to the previous day west of UTC. We therefore read the Date's UTC
 * components directly, and parse the leading YYYY-MM-DD out of a string verbatim.
 *
 * Returns null for null/undefined/unparseable input (no fallback — a bad date
 * column surfaces as null rather than a silently substituted value).
 */
function dateColumnToISO(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    var y = val.getUTCFullYear();
    var m = val.getUTCMonth() + 1;
    var d = val.getUTCDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  var s = String(val);
  var match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : null;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Fields that live on the source template and are inherited by recurring
 * instances. SINGLE source of truth — verbatim from task.controller.js ~line 192.
 * ───────────────────────────────────────────────────────────────────────────── */
var TEMPLATE_FIELDS = ['text', 'dur', 'pri', 'project', 'section', 'location', 'tools',
  'when', 'day_req', 'recurring', 'time_flex', 'split', 'split_min',
  'travel_before', 'travel_after', 'depends_on',
  'notes', 'url', 'flex_when', 'recur', 'recur_start', 'recur_end',
  'preferred_time_mins', 'placement_mode',
  'weather_precip', 'weather_cloud', 'weather_temp_min', 'weather_temp_max',
  'weather_temp_unit', 'weather_humidity_min', 'weather_humidity_max'];

/** Safely parse a JSON string, returning fallback on any error. (controller ~141) */
function safeParseJSON(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== 'string') return val;
  if (val === '' || val === 'null') return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

/** Normalize priority to P1-P4 format. Accepts "P1", "1", "p2", etc. (controller ~151) */
function normalizePri(pri) {
  if (!pri) return 'P3';
  var s = String(pri).trim();
  if (/^P[1-4]$/i.test(s)) return s.toUpperCase();
  if (/^[1-4]$/.test(s)) return 'P' + s;
  return 'P3';
}

/** Convert a DB scheduled_at value to an ISO UTC string. (controller ~162) */
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
 * Parse an ISO timestamp string into a Date for DB storage. (controller ~179)
 * Accepts UTC ("2026-03-10T14:30:00Z") or with offset ("2026-03-10T10:30:00-04:00").
 */
function parseISOToDate(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Build a { sourceId: row } lookup from an array of task rows. (controller ~316)
 * Includes both recurring_template rows AND legacy rows that act as recurring
 * sources (task_type='task' with recurring=1).
 */
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
 * computeOverdueForRow — SINGLE SOURCE OF TRUTH for "is this row overdue",
 * computed-on-read ONLY (M-5 / 999.1085, leg sched-drop-overdue-column).
 *
 * Extracted from rowToTask's `overdue` IIFE (was inline at :348-506). The
 * stored-flag short-circuit (`if (!!row.overdue) return true;`) has been
 * REMOVED — `task_instances.overdue` is being dropped as a persisted column;
 * every consumer (rowToTask below, and the scheduler's continuity checks in
 * runSchedule.js — W3) now calls this SAME function instead of maintaining a
 * second implementation or reading a raw stored flag.
 *
 * AC6 (David ruling, 2026-07-03): "let's skip the future placement of overdue
 * items — leave it to the user to change the due date, as needed." No new
 * comparison rule was needed to implement this — the existing R-OD3 branch
 * below (`_placedDateKey <= _now.todayKey`) already produces `false` for a
 * forward-rolled recurring instance placed on a genuinely FUTURE slot (AC6b)
 * and `true` for a today-or-earlier placement (AC6a). Removing the short-
 * circuit is sufficient; W3 deletes the write-side persistence that used to
 * override this computed value.
 *
 * Exported (module.exports) so `runSchedule.js` (via the task slice facade,
 * matching the existing `deriveSchedulePlacements.js`/`SchedulerTaskProvider`
 * pattern of sourcing task-slice pure helpers) can call the identical
 * predicate for its own continuity checks instead of re-deriving the rule or
 * reading a raw column.
 *
 * @param {Object} row - a task_instances/task_masters row (raw DB shape,
 *   snake_case columns), OR the sourceMap-merged row rowToTask builds for a
 *   recurring instance (TEMPLATE_FIELDS already copied on).
 * @param {?string} timezone
 * @param {{todayKey:string,nowMins:number}} [nowInfo] OPTIONAL injected now-context
 *   (W4 R50.8) — when absent, defaults to computing from the shared contract
 *   using the row's timezone. Inject a fixed now-context in tests to keep the
 *   predicate deterministic.
 * @returns {boolean}
 */
function computeOverdueForRow(row, timezone, nowInfo) {
  // Suppress computed path for terminal-status rows
  var st = row.status || '';
  if (isTerminalStatus(st)) return false;
  // Suppress computed path for disabled (frozen) instances — disabled is not
  // in TERMINAL_STATUSES (intentionally: it behaves differently elsewhere),
  // but a frozen recurring instance must never compute as overdue (B1 fix).
  if (st === 'disabled') return false;
  // Resolve now-context: inject for tests, default to shared contract for the row's tz
  var _now = nowInfo || _getNowInTimezone(timezone || _DEFAULT_TIMEZONE); // RC2: null tz → R50.8 default
  // hasHardCommitment mirrors computeIsPastDue's gate exactly (runSchedule.js:109):
  //   deadline OR implied_deadline OR FIXED placementMode
  // Reuse dateColumnToISO (defined at :92) to avoid duplicating Date/string parsing inline.
  var impliedDeadlineISO = dateColumnToISO(row.implied_deadline);
  // R50: a PLACED **daily** recurring instance is committed to its scheduled
  // slot — its recurrence period IS the occurrence day, so once today's time
  // passes incomplete it pins overdue (can't do today's breakfast tomorrow).
  // A WEEKLY/flexible-TPC recurrence (timesPerCycle/fillPolicy, roams across the
  // cycle's days — e.g. "Call Mom" 3×/week) can still be RESCHEDULED to a later
  // slot in its cycle, so it is NOT overdue until the cycle boundary (honored via
  // implied_deadline once materialized). A floating one-off (no recurrence, no
  // deadline) is never committed → 999.671 roll-forward holds.
  var _recurObj = (typeof row.recur === 'string') ? safeParseJSON(row.recur, null) : row.recur;
  var _isDailyRecur = !!(_recurObj && _recurObj.type === 'daily');
  var isPlacedRecurringInstance = !!(row.task_type === 'recurring_instance' &&
    row.scheduled_at && row.placement_mode !== _PLACEMENT_MODES.FIXED && _isDailyRecur);
  // R-OD2: implied_deadline is a derived scheduler artifact, not a user commitment.
  // It should only confer hasHardCommitment for recurring instances (where it represents
  // the recurrence-period/cycle boundary). A non-recurring flexible task with no user
  // deadline must never be overdue from a derived implied_deadline alone.
  var _isRecurringInstance = row.task_type === 'recurring_instance';
  // 999.1083 (M-1, SPEC FR-1/FR-2): all_day rows get their own hard-commitment
  // gate — the day itself (not a deadline/implied_deadline) IS the commitment,
  // computed ONLY when a day is actually resolvable (never guess a due day
  // for a dateless/TBD all-day row, AC-5). Resolve dueKey up front here (not
  // inside the FIXED/isPlacedRecurringInstance dueKey block below, which is
  // gated on a DIFFERENT placement_mode and must stay byte-identical) so
  // hasHardCommitment can see whether a day resolved. Priority mirrors SPEC
  // FR-1 exactly: end_date (multiday) > scheduled_at local date (single day)
  // > date column (scheduled_at null) — deadline is NOT part of this formula.
  var _allDayDueKey = null;
  if (row.placement_mode === _PLACEMENT_MODES.ALL_DAY) {
    if (row.end_date) {
      _allDayDueKey = dateColumnToISO(row.end_date);
    } else if (row.scheduled_at) {
      var _allDayLocal = utcToLocal(row.scheduled_at, timezone || _DEFAULT_TIMEZONE); // RC2: null tz → R50.8 default
      _allDayDueKey = _allDayLocal ? _allDayLocal.date : null;
    } else if (row.date && row.date !== 'TBD') {
      _allDayDueKey = dateColumnToISO(row.date);
    }
  }
  var _isAllDayWithResolvableDate = row.placement_mode === _PLACEMENT_MODES.ALL_DAY && !!_allDayDueKey;
  var hasHardCommitment = !!(row.deadline || (_isRecurringInstance && impliedDeadlineISO) ||
    row.placement_mode === _PLACEMENT_MODES.FIXED || isPlacedRecurringInstance ||
    _isAllDayWithResolvableDate);
  if (!hasHardCommitment) return false;
  // Determine the effective due date key and time (minutes).
  // For FIXED: the task's scheduled date IS its due — use it directly.
  //   implied_deadline is a scheduler artifact for non-FIXED tasks; using it
  //   here causes a cross-day comparison when the scheduler sets it to a
  //   different day than the actual scheduled_at (ponytail: 999.810 bug).
  // For deadline: prefer deadline; then implied_deadline; then task date.
  var dueKey;
  if (row.placement_mode === _PLACEMENT_MODES.FIXED || isPlacedRecurringInstance) {
    if (row.scheduled_at) {
      var _local = utcToLocal(row.scheduled_at, timezone || _DEFAULT_TIMEZONE); // RC2: null tz → R50.8 default
      dueKey = _local ? _local.date : null;
    }
  } else if (_isAllDayWithResolvableDate) {
    // 999.1083: dueKey already resolved above (_allDayDueKey) — midnight
    // boundary only, no intra-day check (scheduledMins is never computed
    // for all_day below, since that block is gated on FIXED/isPlacedRecurringInstance).
    dueKey = _allDayDueKey;
  }
  if (!dueKey) {
    // Explicit, user-set deadline is authoritative.
    dueKey = dateColumnToISO(row.deadline);
  }
  // REG-25/F5: tracks whether dueKey below ends up sourced from
  // impliedDeadlineISO (the recurrence-PERIOD boundary, R50.0) rather than
  // an explicit user deadline — only the period-boundary case gets the
  // "missed ON periodEnd" same-day treatment further down.
  var _dueIsImpliedPeriodEnd = false;
  if (!dueKey && impliedDeadlineISO) {
    // implied_deadline is a DERIVED scheduler artifact (recurrence-period
    // boundary), NOT a user commitment. When the scheduler rolls an instance
    // forward it can leave implied_deadline in the PAST while the task is now
    // placed on a FUTURE day — using it raw then marks a future-dated task
    // overdue (999.810: "future tasks shown as overdue"). A strictly-future
    // placement supersedes the stale artifact; placed-today / placed-past /
    // unplaced keep the original behavior (R50.6 case #1).
    var _implLocal = row.scheduled_at ? utcToLocal(row.scheduled_at, timezone || _DEFAULT_TIMEZONE) : null;
    var _placedDateKey = _implLocal ? _implLocal.date
      : (row.date && row.date !== 'TBD' ? row.date : null);
    if (!_placedDateKey || _placedDateKey <= _now.todayKey) {
      // R-OD3 RULING (David 2026-06-30, "Keep overdue (revert Exercise fix)"): a
      // recurring instance's past implied_deadline (recurrence-period boundary) IS a
      // real overdue signal even when placed today — the R50.6 catch-up contract is
      // KEPT, no today-placed stale-suppression. Non-recurring tasks never reach this
      // branch (R-OD2 gates implied_deadline on recurring_instance above).
      dueKey = impliedDeadlineISO;
      _dueIsImpliedPeriodEnd = true;
    }
  }
  if (!dueKey || dueKey === 'TBD') return false;
  // For time-precision (FIXED or scheduled): derive scheduled minutes.
  // For deadline/implied_deadline: no time check — past-day is sufficient.
  var scheduledMins = null;
  // 999.1083 (M-1, SPEC FR-1/AC-2): isPlacedRecurringInstance is
  // placement_mode-agnostic (only excludes FIXED, see above) — an
  // all_day row that is ALSO a placed daily recurring_instance must
  // NEVER compute an intra-day scheduledMins/window-close threshold;
  // all_day's only hard-commitment boundary is the midnight dueKey
  // resolved above. Explicitly excluded here (not just relying on the
  // isPlacedRecurringInstance gate) so this stays true regardless of
  // any future change to that predicate.
  if ((row.placement_mode === _PLACEMENT_MODES.FIXED ||
       (isPlacedRecurringInstance && row.placement_mode !== _PLACEMENT_MODES.ALL_DAY)) &&
      row.scheduled_at) {
    var _fixedLocal = utcToLocal(row.scheduled_at, timezone || _DEFAULT_TIMEZONE); // RC2: null tz → R50.8 default
    if (_fixedLocal && _fixedLocal.time) {
      var _tm = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(_fixedLocal.time);
      if (_tm) {
        var _h = parseInt(_tm[1], 10); var _m = parseInt(_tm[2], 10);
        var _ap = (_tm[3] || '').toUpperCase();
        if (_ap === 'PM' && _h < 12) _h += 12;
        if (_ap === 'AM' && _h === 12) _h = 0;
        scheduledMins = _h * 60 + _m;
      }
    }
  }
  // Past-due check: day in the past, OR same day with intra-day threshold passed.
  // Threshold semantics (LOCKED design AC2/AC4):
  //   FIXED: overdue when scheduled slot time is past (scheduledMins < nowMins).
  //   Windowed daily recurring (isPlacedRecurringInstance + time_flex != null):
  //     overdue when WINDOW CLOSES = (preferred_time_mins ?? scheduledMins) + time_flex (AC2b).
  //     time_flex==0: zero-width window → overdue at the slot (or preferred) minute itself (AC2c).
  //     The instance is roamable until the window closes — a 08:00 preferred with 3h
  //     window closes at 11:00; at 09:00 the window is still open → NOT overdue.
  //     preferred_time_mins (AC2b): window anchors to the preferred time, not the
  //     placed slot — the task may be placed early but the window is open until
  //     preferred_time_mins + time_flex.
  //   Window-less daily recurring (time_flex null, e.g. anytime):
  //     no intra-day overdue before midnight — falls through to false here; overdue
  //     fires the next day when dueKey < todayKey (period-boundary = midnight).
  //   REG-25/F5 (R50.0): a NEVER-PLACED instance (row.scheduled_at falsy — no
  //     FIXED/daily-recurring anchor was ever committed, so there's no intra-day
  //     slot/window to wait on) has nothing to roam within its own period —
  //     the "live through periodEnd-1, missed ON periodEnd" rule applies directly:
  //     when dueKey is the recurrence-PERIOD boundary itself (_dueIsImpliedPeriodEnd),
  //     periodEnd===today reads overdue TODAY, not the day after. Scoped tightly to
  //     avoid two false-positive expansions: (a) an explicit user `deadline` due
  //     today for an unscheduled task is a DIFFERENT commitment, not R50.0's period
  //     boundary, and keeps its existing (strict, day-after) behavior; (b) a
  //     non-daily (e.g. weekly-TPC) instance that WAS placed today (row.scheduled_at
  //     set) but doesn't qualify for the intra-day scheduledMins branches above (only
  //     FIXED/daily-recurring compute scheduledMins) still gets the pre-existing
  //     "boundary day itself is not yet overdue" behavior — the boundary-day
  //     regression guard in taskMappers-overdue-juggy3.test.js (AC3a-boundary) locks
  //     this: a placed weekly-TPC instance at its cycle boundary reads overdue only
  //     the day AFTER, same as before this fix.
  if (dueKey < _now.todayKey) return true;
  if (dueKey === _now.todayKey) {
    if (scheduledMins !== null) {
      if (row.placement_mode === _PLACEMENT_MODES.FIXED) {
        // FIXED: overdue once the scheduled slot is past
        if (scheduledMins < _now.nowMins) return true;
      } else if (isPlacedRecurringInstance && row.placement_mode !== _PLACEMENT_MODES.ALL_DAY && row.time_flex != null) {
        // AC2b/AC2c (R50): overdue when the window closes.
        // window-close = (preferred_time_mins ?? scheduledMins) + time_flex.
        // time_flex==0: zero-width window → overdue at the slot/preferred minute (AC2c).
        // (placement_mode!==ALL_DAY here is defense-in-depth — scheduledMins is
        // already null for all_day above, so this branch is unreachable for it,
        // but the explicit guard keeps this line correct independent of that.)
        var preferredTimeMins = (row.preferred_time_mins != null ? row.preferred_time_mins : scheduledMins);
        var windowCloseMins = preferredTimeMins + row.time_flex;
        if (_now.nowMins >= windowCloseMins) return true;
      }
      // Window-less daily (time_flex null): no intra-day overdue — falls through
    } else if (_dueIsImpliedPeriodEnd && !row.scheduled_at) {
      // Never-placed (no scheduled_at at all) recurring instance whose period
      // ends today — R50.0 "missed ON periodEnd", no intra-day grace to extend
      // it to tomorrow.
      return true;
    }
  }
  return false;
}

/**
 * Map task row from DB to API format. (controller ~333)
 * Derives date/time/day from scheduled_at (UTC) using the user's timezone.
 * If sourceMap is provided, recurring instances inherit template fields from their source.
 *
 * @param {Object} row
 * @param {?string} timezone
 * @param {?Object} sourceMap
 * @param {{warn: Function}} [logger] OPTIONAL injected logger (default no-op) —
 *   keeps the legacy orphaned-instance warn without coupling the domain to a
 *   logger require. Output is byte-identical regardless of which logger is passed.
 * @param {{todayKey:string,nowMins:number}} [nowInfo] OPTIONAL injected now-context
 *   (W4 R50.8) — used by the computed-on-read overdue predicate. When absent,
 *   defaults to computing from the shared contract using the row's timezone. Inject
 *   a fixed now-context in tests to keep the predicate deterministic.
 * @returns {Object} the API task object.
 */
function rowToTask(row, timezone, sourceMap, logger, nowInfo) {
  var log = logger || NOOP_LOGGER;
  // Null-safety: a missing/not-found row (e.g. a re-read that returns no row)
  // must not be dereferenced. Return null so callers can treat it as not-found
  // rather than crashing on `row.source_id`.
  if (row == null) return null;
  // Merge template fields from source for thin recurring instances.
  var src = sourceMap && row.source_id ? sourceMap[row.source_id] : null;
  if (!src && row.source_id && sourceMap && row.task_type === 'recurring_instance') {
    log.warn('[rowToTask] Orphaned instance: ' + row.id + ' references missing template ' + row.source_id);
  }
  // Disabled instances are frozen — do not inherit template fields so they stay locked in place
  if (src && row.status !== 'disabled') {
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
  if (row.scheduled_at && isTerminalStatus(row.status)) {
    var sa = new Date(row.scheduled_at);
    if (isNaN(sa.getTime())) { row.scheduled_at = null; }
    else {
      var now = new Date();
      if (sa > now) {
        var ua = (row.updated_at && isValidDate(row.updated_at)) ? new Date(row.updated_at) : now;
        row.scheduled_at = ua <= now ? ua : now;
      }
    }
  }

  var date = null;
  var time = null;
  var day = null;
  var earliestStart = null;

  var displayTz = timezone || null;
  if (displayTz && row.scheduled_at) {
    var local = utcToLocal(row.scheduled_at, displayTz);
    if (local.date) date = local.date;
    if (local.time) time = local.time;
    if (local.day) day = local.day;
  }

  // Bug A (FR3 / AC3.1): an UNPLACED recurring instance has scheduled_at=NULL but
  // still carries its target calendar day in the `date` DATE column (set by
  // expandRecurring / reconcileOccurrences). Without this the scheduler sees
  // date=null and can't assign the right cycle window → wrong/absent unplaced
  // reason. Derive task.date from row.date ONLY when scheduled_at is null, ONLY
  // for recurring_instance rows (task_type guard — templates and non-recurring
  // rows are unaffected, AC3.2), and ONLY when the date column is non-null.
  // Placed instances (scheduled_at set) keep deriving date from scheduled_at above.
  if (date === null && row.scheduled_at == null && row.task_type === 'recurring_instance') {
    var instDate = dateColumnToISO(row.date);
    if (instDate) date = instDate;
  }

  // BUG-811: preferred_time_mins must NOT overwrite the live time for WIP tasks.
  // WIP tasks have a live scheduled_at — the time was already derived from it above.
  // Only apply preferred_time_mins for statuses that don't have a live scheduled_at
  // (unplaced instances with status='' or 'todo'). Excluding 'wip' (and other
  // placed statuses) prevents the template time from overwriting the live slot.
  if (src && src.preferred_time_mins != null && row.status !== 'disabled' && !time) {
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
  // Derive earliestStart. Prefer `earliest_start` (migration 20260624120000 —
  // the newer per-instance column on task_instances, a stable anchor persisted
  // at materialization time). Fall back to `start_after_at` (the task_masters
  // DATE column; the planned rename never landed on task_masters — writing the
  // phantom name throws ER_BAD_FIELD_ERROR, 999.866) for rows that predate the
  // newer column or are template rows. BUG3 (W3, leg sched-anchor-split-bugs):
  // `earliest_start` was never read here, so runSchedule.js's stable-anchor
  // recompute always fell through to the current placement date.
  var _earliestStartRaw = row.earliest_start || row.start_after_at;
  if (_earliestStartRaw) {
    earliestStart = fromDateISO(_earliestStartRaw instanceof Date
      ? _earliestStartRaw.toISOString().split('T')[0]
      : String(_earliestStartRaw).split('T')[0]);
  }
  return {
    id: row.id,
    taskType: row.task_type || 'task',
    text: row.text,
    // UTC source of truth
    scheduledAt: scheduledAtToISO(row.scheduled_at),
    // juggler-cal-history Plan A/E — completion timestamp on terminal transition.
    completedAt: row.completed_at ? scheduledAtToISO(row.completed_at) : null,
    // JUG-CLOSE-NOW (David ruling: actual elapsed, not estimated): local
    // "H:MM AM/PM" string, same shape as `time` above — derivePlacements
    // needs this format (parseTimeToMinutes), not the UTC ISO `completedAt`.
    completedAtTime: (displayTz && row.completed_at) ? (utcToLocal(row.completed_at, displayTz).time || null) : null,
    tz: row.tz || null,
    deadline: deadlineISO,
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
    earliestStart: earliestStart,
    location: safeParseJSON(row.location, []),
    tools: safeParseJSON(row.tools, []),
    when: row.when,
    dayReq: row.day_req,
    recurring: !!row.recurring,
    timeFlex: row.time_flex != null ? row.time_flex : undefined,
    split: row.split === null ? undefined : !!row.split,
    splitMin: row.split_min,
    recur: safeParseJSON(row.recur, null),
    sourceId: row.source_id,
    generated: !!row.generated,
    gcalEventId: row.gcal_event_id,
    msftEventId: row.msft_event_id,
    appleEventId: row.apple_event_id,
    calLocked: !!row.cal_locked,
    appleCalendarName: row.apple_calendar_name || null,
    calSyncOrigin: row.cal_sync_origin || null,
    calEventUrl: row.cal_event_url || null,
    dependsOn: safeParseJSON(row.depends_on, []),
    marker: !!row.marker,
    placementMode: row.placement_mode,
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
    preferredTimeMins: row.preferred_time_mins != null ? row.preferred_time_mins : null,
    desiredAt: row.desired_at ? new Date(row.desired_at).toISOString() : null,
    unscheduled: !!row.unscheduled,
    // W1 (M-5 / 999.1085): computed-on-read ONLY -- the stored-flag short-circuit
    // is REMOVED (task_instances.overdue is being dropped, W4). Delegates to the
    // shared, exported computeOverdueForRow (which now also covers 999.1083 all_day
    // dueKey resolution + the recurring-precedence guard) so rowToTask and
    // runSchedule.js (W3, via the task slice facade) share exactly ONE implementation.
    overdue: computeOverdueForRow(row, timezone, nowInfo),
    slackMins: row.slack_mins != null ? Number(row.slack_mins) : null,
    // ponytail: guard against MySQL zero-dates (0000-00-00) which produce
    // Invalid Date → toISOString() throws RangeError, poisoning the entire
    // task list response. Return null instead of crashing.
    createdAt: row.created_at && isValidDate(row.created_at) ? new Date(row.created_at).toISOString() : null,
    recurStart: row.recur_start || null,
    recurEnd: row.recur_end || null,
    // Multiday all-day task support: endDate for tasks spanning multiple days
    endDate: row.end_date ? toDateISO(row.end_date) : null,
    // next_start is the single unified anchor for ALL recurring types.
    // The legacy rolling_anchor / next_occurrence_anchor columns have been dropped.
    nextStart: row.next_start || null,
    disabledAt: row.disabled_at ? scheduledAtToISO(row.disabled_at) : null,
    disabledReason: row.disabled_reason || null,
    occurrenceOrdinal: row.occurrence_ordinal != null ? Number(row.occurrence_ordinal) : undefined,
    splitOrdinal: row.split_ordinal != null ? Number(row.split_ordinal) : undefined,
    splitTotal: row.split_total != null ? Number(row.split_total) : undefined,
    splitGroup: row.split_group || null,
    // DB-single-source (W1): the scheduler persists why an instance is unplaced onto
    // the row (task_instances.unplaced_reason/_detail). Surface them as the same
    // _unplacedReason/_unplacedDetail the in-memory scheduler set, so the Unplaced
    // view (ConflictsView) and schedulerSession read the reason from the DB read
    // model instead of the deleted /schedule/placements cache. Null for placed rows.
    _unplacedReason: row.unplaced_reason || null,
    _unplacedDetail: row.unplaced_detail || null,
    // Anchor date (date-only, YYYY-MM-DD): for instances, from the template; for templates, from self
    anchorDate: (function() {
      var sa = src ? src.scheduled_at : row.scheduled_at;
      if (sa) {
        var iso = scheduledAtToISO(sa);
        return iso ? iso.slice(0, 10) : null;
      }
      // Bug A (AC3.3): an UNPLACED recurring instance whose template has no
      // scheduled_at (a never-yet-placed recurring) gets its anchorDate from the
      // instance's own `date` DATE column — the same source task.date now uses.
      // This gives the reason classifier the correct cycle anchor instead of null.
      // Guarded to recurring_instance rows with scheduled_at=null so placed
      // instances (sa present above) and other row types are unaffected (AC3.3-b).
      if (row.scheduled_at == null && row.task_type === 'recurring_instance') {
        return dateColumnToISO(row.date);
      }
      return null;
    })()
  };
}

/**
 * Map API task to DB row. (controller ~512)
 * Converts date+time → scheduled_at (UTC) and deadline/earliestStart →
 * deadline/start_after_at.
 *
 * P1 NOTE (flagged for W3): this mapper sets `row.updated_at = new Date()` (a JS
 * Date — P1-COMPLIANT). It is the WRITE-row builder; the legacy controller's
 * fast-path updateTask separately overwrites updated_at with `getDb().fn.now()`
 * (controller ~992) — that fn.now() write is a REPOSITORY concern, lives OUTSIDE
 * this pure mapper, and is the P1 correction W3 owns (WBS "In-scope decision —
 * P1 correction"). taskToRow itself already emits `new Date()`.
 *
 * @param {Object} task
 * @param {string} userId
 * @param {?string} timezone
 * @param {Object} [_currentTask] preserved arg (legacy signature parity; unused
 *   here exactly as in the controller — underscore-prefixed for the no-unused-vars
 *   allowed-args convention).
 * @returns {Object} the DB write row.
 */
function taskToRow(task, userId, timezone, _currentTask) {
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
  if (task.earliestStart !== undefined) {
    // task_masters column is `start_after_at` (see read mapper note, 999.866).
    row.start_after_at = task.earliestStart ? toDateISO(task.earliestStart) || null : null;
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
  if (task.flexWhen !== undefined) row.flex_when = task.flexWhen ? 1 : 0;
  if (task.travelBefore !== undefined) row.travel_before = task.travelBefore || null;
  else if (task.travel_before !== undefined) row.travel_before = task.travel_before || null;
  if (task.travelAfter !== undefined) row.travel_after = task.travelAfter || null;
  else if (task.travel_after !== undefined) row.travel_after = task.travel_after || null;
  if (task.tz !== undefined) row.tz = task.tz || null;
  if (task.recurStart !== undefined) row.recur_start = task.recurStart || null;
  if (task.recurEnd !== undefined) row.recur_end = task.recurEnd || null;
  if (task.preferredTimeMins !== undefined) row.preferred_time_mins = task.preferredTimeMins;
  if (task.weatherPrecip   !== undefined) row.weather_precip    = task.weatherPrecip;
  if (task.weatherCloud    !== undefined) row.weather_cloud     = task.weatherCloud;
  if (task.weatherTempMin      !== undefined) row.weather_temp_min      = task.weatherTempMin;
  if (task.weatherTempMax      !== undefined) row.weather_temp_max      = task.weatherTempMax;
  if (task.weatherTempUnit     !== undefined) row.weather_temp_unit     = task.weatherTempUnit;
  if (task.weatherHumidityMin  !== undefined) row.weather_humidity_min  = task.weatherHumidityMin;
  if (task.weatherHumidityMax  !== undefined) row.weather_humidity_max  = task.weatherHumidityMax;

  // Multiday all-day task support: endDate maps to end_date column
  if (task.endDate !== undefined) {
    row.end_date = task.endDate ? toDateISO(task.endDate) || task.endDate : null;
  }

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
      if (row.desired_at === undefined) {
        row.desired_at = timeVal
          ? row.scheduled_at
          : localToUtc(dateVal, '12:00 PM', timezone) || null;
      }
    } else if (task.date !== undefined && !dateVal) {
      row.scheduled_at = null;
      if (row.desired_at === undefined) row.desired_at = null;
    }
    if (task.date === undefined && task.time !== undefined) {
      row._pendingTimeOnly = timeVal;
    }
  }


  if (task.placementMode !== undefined) {
    row.placement_mode = task.placementMode;
  }

  row.updated_at = new Date();
  return row;
}

module.exports = {
  safeParseJSON,
  normalizePri,
  scheduledAtToISO,
  parseISOToDate,
  buildSourceMap,
  rowToTask,
  taskToRow,
  TEMPLATE_FIELDS,
  computeOverdueForRow
};
