/**
 * Task input validation + edit guards — PURE relocation of the legacy
 * `task.controller.js` helpers (Phase H3 / W2).
 *
 * ── BEHAVIOR-IDENTICAL RELOCATION, NOT A REWRITE ──────────────────────────────
 * VERBATIM logic from `src/controllers/task.controller.js`:
 *     validateTaskInput      ←  ~line 749
 *     checkCalSyncEditGuard   ←  ~line 84
 *     guardFixedCalendarWhen  ←  ~line 626
 *     VALID_WHEN_KEYWORDS / VALID_DAY_REQ / VALID_DAY_CODES ← ~line 745
 *
 * ── PURITY (W2 (c), DESIGN §7) ────────────────────────────────────────────────
 * Zero infra requires. Only pure deps:
 *   - ../value-objects/PlacementMode      (closed-enum VO over placement_mode — pure)
 *   - ../../../../../../shared/scheduler/expandRecurring  (isAnchorDependentRecur
 *      — pure recur-shape predicate, no I/O)
 *   - ../../../../../../shared/scheduler/getNowInTimezone  (getNowInTimezone/
 *      DEFAULT_TIMEZONE — pure Intl.DateTimeFormat computation, no injected
 *      clock support needed here since the create-time plausibility check
 *      only needs "today's date key", not a mockable instant; same helper
 *      computeOverdueForRow — taskMappers.js:227 — uses as the display SSOT)
 *   - ../../../../scheduler/dateHelpers  (isoToDateKey — re-exports
 *      shared/scheduler/dateHelpers.js; pure regex-based date-key
 *      normalization, format-aware for the MCP-documented "YYYY-MM-DD or
 *      M/D" deadline contract — see ernie-tz-2, no Date-object round-trip)
 * All data enters via arguments.
 *
 * ── NO NEW FALLBACKS ──────────────────────────────────────────────────────────
 * Every `||` default below is preserved verbatim from the controller
 * (e.g. `(body.recur.type || '')`, `existing && existing.cal_sync_origin`). No
 * new fallback introduced.
 */

'use strict';

var PlacementMode = require('../value-objects/PlacementMode');
var { isAnchorDependentRecur } = require('../../../../../../shared/scheduler/expandRecurring');
var { getNowInTimezone, DEFAULT_TIMEZONE } = require('../../../../../../shared/scheduler/getNowInTimezone');
var { isoToDateKey } = require('../../../../scheduler/dateHelpers');

// Verbatim from task.controller.js ~745.
var VALID_WHEN_KEYWORDS = ['', 'fixed', 'allday', 'anytime'];
var VALID_DAY_REQ = ['any', 'weekday', 'weekend'];
var VALID_DAY_CODES = ['M', 'T', 'W', 'R', 'F', 'Sa', 'Su', 'S', 'U'];

// Valid single-character day codes for `recur.days` (DISTINCT from VALID_DAY_CODES,
// which is the comma-separated `dayReq` vocabulary). These are the exact codes the
// scheduler's expandRecurring consumes: `dayMap = { U:0, M:1, T:2, W:3, R:4, F:5,
// S:6 }` (shared/scheduler/expandRecurring.js). `recur.days` is a STRING of these
// chars (e.g. 'MTWRF', 'MTWRFSU') OR an OBJECT keyed by them (e.g. { M:'required' }).
// 999.586 (JSON schema gap) — application-level validation of recur.days.
var VALID_RECUR_DAY_CODES = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];

/**
 * Returns a 403-response payload if `existing` is an externally-ingested
 * calendar-synced task and `body` contains disallowed fields. Returns `null`
 * when editing is permitted. (controller ~84)
 *
 * @param {Object} existing
 * @param {Object} body
 * @returns {?{error: string, code: string, blockedFields: string[]}}
 */
function checkCalSyncEditGuard(existing, body) {
  var origin = existing && existing.cal_sync_origin;
  if (!origin || origin === 'juggler') return null;
  var allowed = ['status', 'notes', '_allowUnfix'];
  if (body && body._allowUnfix) allowed.push('placementMode');
  var blocked = Object.keys(body)
    .filter(function(k) { return k !== 'id'; })
    .filter(function(k) { return allowed.indexOf(k) === -1; });
  if (blocked.length === 0) return null;
  return {
    error: 'This task is synced from an external calendar. Only status and notes can be changed here.',
    code: 'CAL_SYNCED_READONLY',
    blockedFields: blocked
  };
}

/**
 * Prevent stripping/altering placement_mode off calendar-linked tasks.
 * MUTATES `row` (deletes `row.placement_mode`) exactly as the controller does.
 * (controller ~626)
 *
 * @param {Object} row The write row whose placement_mode may be deleted.
 * @param {Object} guardTarget The row that owns the cal-link (gcal/msft/apple ids).
 * @param {{allowUnfix?: boolean}} [opts]
 */
function guardFixedCalendarWhen(row, guardTarget, opts) {
  if (!guardTarget) return;
  if (opts && opts.allowUnfix) return;
  var isCalLinked = !!(guardTarget.gcal_event_id || guardTarget.msft_event_id || guardTarget.apple_event_id);
  if (!isCalLinked) return;
  if ('placement_mode' in row && row.placement_mode !== 'fixed') {
    delete row.placement_mode;
  }
}

/**
 * Returns true when the EFFECTIVE placementMode + recurring combination violates
 * the fixed/recurring XOR rule: a task cannot be BOTH fixed AND recurring.
 *
 * This is the SINGLE source of the XOR decision. All code paths that enforce
 * 999.867 (create, HTTP update, import, MCP update) call this helper instead of
 * inlining `placementMode==='fixed' && recurring===true`.
 *
 * @param {{ placementMode?: string, recurring?: * }} opts
 * @returns {boolean}
 */
function isFixedRecurringConflict(opts) {
  return opts.placementMode === 'fixed' && !!opts.recurring;
}

/**
 * Validate a task input body, returning an array of error strings (empty = valid).
 * VERBATIM from task.controller.js ~749. (controller ~749)
 * @param {Object} body
 * @returns {string[]}
 */
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
    if (whenParts.some(function(p) { return p.length > 30; })) {
      errors.push('Invalid when value: tag names must be 30 characters or less');
    }
  }
  // dayReq validation
  if (body.dayReq !== undefined && body.dayReq !== null) {
    var dr = String(body.dayReq);
    if (VALID_DAY_REQ.indexOf(dr) === -1) {
      var dayParts = dr.split(',');
      var allValid = dayParts.every(function(p) { return VALID_DAY_CODES.indexOf(p.trim()) !== -1; });
      if (!allValid) errors.push('Invalid dayReq: must be any, weekday, weekend, or comma-separated day codes (M,T,W,R,F,Sa,Su)');
    }
  }
  // dur validation
  if (body.dur !== undefined && body.dur !== null) {
    var durVal = Number(body.dur);
    if (isNaN(durVal) || durVal <= 0) errors.push('Duration must be greater than 0');
    else if (durVal > 480) errors.push('Duration must not exceed 480 minutes (8 hours)');
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
    else if (body._requireText) {
      // Creation-time plausibility check (BUG-5 / AC4): a deadline already in
      // the past on CREATE mints a task overdue from the moment it exists
      // (computeOverdueForRow — taskMappers.js:270). Gated on _requireText
      // (the existing create-only discriminator, see CreateTask.js:101/104)
      // so update paths (editing an already-overdue task) are unaffected.
      //
      // ernie-tz-1 (re-review fix): comparing a UTC-parsed date-only `dlDate`
      // against a server-LOCAL midnight `new Date()` skews by the server's
      // UTC offset and false-rejects legitimate same-day deadlines (west-of-
      // UTC servers/users — fires every evening on Cloud Run, TZ=UTC). Resolve
      // "today" the SAME tz-aware way the display SSOT does (computeOverdueForRow
      // — taskMappers.js:227, via getNowInTimezone) and compare date-only KEYS
      // as strings, never raw Date objects, so create-time rejection agrees
      // with the display predicate that decides overdue-ness afterward.
      //
      // ernie-tz-2 (re-review fix): `String(body.deadline).slice(0,10)` is
      // only a correct date KEY when body.deadline is already a zero-padded
      // ISO string. The MCP create_task contract documents "YYYY-MM-DD or
      // M/D format" (src/mcp/tools/tasks.js:89) and the format-validity check
      // above admits ANY Date-parseable string, so a lexicographic compare of
      // an un-normalized prefix gives wrong answers in both directions for
      // non-zero-padded input (e.g. '2026-1-5'). Normalize with the same
      // format-aware, pure (no Date/tz round-trip) parser the rest of the
      // codebase uses for this exact "calendar date, not an instant" model.
      // A deadline string in neither documented format (isoToDateKey ->
      // null) is not one the create-time plausibility check can key against;
      // skip the past-deadline check for it rather than risk a wrong
      // comparison — the "Deadline must be a valid date" check above still
      // catches non-Date-parseable garbage.
      var _todayKey = getNowInTimezone(body.timezone || DEFAULT_TIMEZONE).todayKey;
      var _dlKey = isoToDateKey(body.deadline);
      if (_dlKey !== null && _dlKey < _todayKey) {
        errors.push('Deadline must not be in the past');
      }
    }
  }
  // earliestStart validation
  if (body.earliestStart !== undefined && body.earliestStart !== null && body.earliestStart !== '') {
    var saDate = new Date(body.earliestStart);
    if (isNaN(saDate.getTime())) errors.push('Earliest start must be a valid date');
  }
  // cross-field: deadline >= earliestStart (body-only check; for updates that
  // patch only one field, use validateEarliestStartDeadlineCrossField below)
  if (body.deadline && body.earliestStart) {
    var dlD = new Date(body.deadline);
    var saD = new Date(body.earliestStart);
    if (!isNaN(dlD.getTime()) && !isNaN(saD.getTime()) && dlD < saD) errors.push('Deadline must be on or after earliest start date');
  }
  // recur config validation
  if (body.recur && typeof body.recur === 'object') {
    var validRecurTypes = ['daily', 'weekly', 'biweekly', 'monthly', 'interval', 'none', 'rolling'];
    var rType = (body.recur.type || '').toLowerCase();
    if (!rType) errors.push('Recurrence type is required when recur object is provided');
    if (rType && validRecurTypes.indexOf(rType) === -1) errors.push('Invalid recurrence type: ' + rType);
    var r = body.recur;
    if ((rType === 'rolling' || rType === 'interval') && r.every !== undefined) {
      var everyVal = Number(r.every);
      if (!Number.isFinite(everyVal) || everyVal < 1 || !Number.isInteger(everyVal)) {
        errors.push('Recurrence interval (every) must be a positive integer');
      }
    }
    var VALID_RECUR_UNITS = ['days', 'weeks', 'months'];
    if ((rType === 'rolling' || rType === 'interval') && r.unit !== undefined) {
      if (VALID_RECUR_UNITS.indexOf(String(r.unit)) === -1) {
        errors.push('Recurrence unit must be days, weeks, or months');
      }
    }
    // recur.days validation (999.586) — weekly/biweekly carry a day spec the
    // scheduler reads via doesDayMatch(). It accepts EITHER a string of day codes
    // ('MTWRF') OR an object keyed by day codes ({ M:'required' }). Reject any
    // other type and any code outside VALID_RECUR_DAY_CODES. Only validated when
    // `days` is present (it is optional; expandRecurring defaults to 'MTWRF').
    if (r.days !== undefined && r.days !== null) {
      if (typeof r.days === 'string') {
        var badChars = r.days.split('').filter(function (c) {
          return VALID_RECUR_DAY_CODES.indexOf(c) === -1;
        });
        if (r.days.length === 0 || badChars.length > 0) {
          errors.push('Recurrence days must be a string of day codes (U,M,T,W,R,F,S)');
        }
      } else if (typeof r.days === 'object' && !Array.isArray(r.days)) {
        var badKeys = Object.keys(r.days).filter(function (k) {
          return VALID_RECUR_DAY_CODES.indexOf(k) === -1;
        });
        if (badKeys.length > 0) {
          errors.push('Recurrence days object keys must be day codes (U,M,T,W,R,F,S)');
        }
      } else {
        errors.push('Recurrence days must be a string of day codes or an object keyed by day codes');
      }
    }
    // recur.monthDays validation (999.586) — monthly carries an array of
    // day-of-month entries: integers 1..31, OR the literals 'first'/'last'
    // (the scheduler consumes both — expandRecurring.js / dateMatchesRecurrence.js).
    if (r.monthDays !== undefined && r.monthDays !== null) {
      if (!Array.isArray(r.monthDays)) {
        errors.push("Recurrence monthDays must be an array of day-of-month integers (1-31) or 'first'/'last'");
      } else {
        var badMonthDay = r.monthDays.some(function (d) {
          if (d === 'first' || d === 'last') return false;
          var n = Number(d);
          return !Number.isInteger(n) || n < 1 || n > 31;
        });
        if (badMonthDay) errors.push("Recurrence monthDays must be integers 1-31 or 'first'/'last'");
      }
    }
    // recur.timesPerCycle validation (999.586) — positive integer when present.
    if (r.timesPerCycle !== undefined && r.timesPerCycle !== null) {
      var tpcVal = Number(r.timesPerCycle);
      if (!Number.isInteger(tpcVal) || tpcVal < 1) {
        errors.push('Recurrence timesPerCycle must be a positive integer');
      }
    }
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
    // dayReq ∉ recur.days conflict guard. For weekly/biweekly, expandRecurring picks
    // candidates from recur.days then HARD-filters them by dayReq (expandRecurring.js:509-521).
    // If dayReq's day-of-week set and recur.days' set don't intersect, EVERY candidate is
    // rejected → zero instances materialize → the task silently vanishes (never-missing
    // violation; real case: Certify-NJ had recur.days='MTWRF' + dayReq='Su'). Reject the combo.
    if ((rType === 'weekly' || rType === 'biweekly') &&
        body.dayReq !== undefined && body.dayReq !== null && String(body.dayReq) !== 'any') {
      var DAYREQ_DOW = { M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, Su: 0, S: 6, U: 0 };
      var RECURDAY_DOW = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
      var reqDows = {};
      var drStr = String(body.dayReq).trim();
      if (drStr === 'weekday') { [1, 2, 3, 4, 5].forEach(function (d) { reqDows[d] = true; }); }
      else if (drStr === 'weekend') { [0, 6].forEach(function (d) { reqDows[d] = true; }); }
      else {
        drStr.split(',').forEach(function (p) {
          var d = DAYREQ_DOW[p.trim()];
          if (d !== undefined) reqDows[d] = true;
        });
      }
      var recurDows = {};
      var rDays = (r.days === undefined || r.days === null) ? 'MTWRF' : r.days;
      if (typeof rDays === 'string') {
        rDays.split('').forEach(function (c) {
          var d = RECURDAY_DOW[c];
          if (d !== undefined) recurDows[d] = true;
        });
      } else if (typeof rDays === 'object') {
        Object.keys(rDays).forEach(function (k) {
          var d = RECURDAY_DOW[k];
          if (d !== undefined) recurDows[d] = true;
        });
      }
      var reqKeys = Object.keys(reqDows);
      var hasOverlap = reqKeys.some(function (d) { return recurDows[d]; });
      // Only flag a genuine, parseable conflict: both sets non-empty and no overlap.
      if (reqKeys.length > 0 && Object.keys(recurDows).length > 0 && !hasOverlap) {
        errors.push('dayReq "' + drStr + '" never matches recur.days "' +
          (typeof rDays === 'string' ? rDays : Object.keys(rDays).join('')) +
          '" — the task would never schedule. Align the recurrence days with the day requirement.');
      }
    }
  }
  // placementMode enum validation
  if (body.placementMode !== undefined) {
    if (!PlacementMode.isValid(body.placementMode)) {
      errors.push('placementMode "' + body.placementMode + '" is not valid');
    }
  }
  // depends_on / location / tools SHAPE validation (999.586). These are JSON
  // arrays of string IDs. The EXISTENCE of the referenced IDs (the dep task must
  // be the user's, the location/tool must be configured) is checked separately
  // in the DB-backed validateTaskReferences() because it requires user-scoped
  // queries — here we only reject a malformed shape (non-array, non-string
  // elements). Empty array is valid (clears the field).
  if (body.dependsOn !== undefined && body.dependsOn !== null) {
    if (!Array.isArray(body.dependsOn) || body.dependsOn.some(function (x) { return typeof x !== 'string' || x.trim() === ''; })) {
      errors.push('dependsOn must be an array of task IDs');
    }
  }
  if (body.location !== undefined && body.location !== null) {
    if (!Array.isArray(body.location) || body.location.some(function (x) { return typeof x !== 'string' || x.trim() === ''; })) {
      errors.push('location must be an array of location IDs');
    }
  }
  if (body.tools !== undefined && body.tools !== null) {
    if (!Array.isArray(body.tools) || body.tools.some(function (x) { return typeof x !== 'string' || x.trim() === ''; })) {
      errors.push('tools must be an array of tool IDs');
    }
  }
  // cross-field: fixed placementMode requires scheduling info
  if (body.placementMode === 'fixed') {
    var hasDate = body.date !== undefined && body.date !== null && body.date !== '';
    var hasTime = body.time !== undefined && body.time !== null && body.time !== '';
    var hasScheduledAt = body.scheduledAt !== undefined && body.scheduledAt !== null && body.scheduledAt !== '';
    if (!hasDate && !hasTime && !hasScheduledAt) {
      errors.push('placementMode "fixed" requires a date, time, or scheduledAt');
    }
  }
  // 999.867: fixed + recurring is a contradiction — a recurring template cannot be
  // pinned to a single fixed slot. The UI blocks this combination; the backend must
  // enforce it too (create/update/MCP/import all flow through validateTaskInput).
  // Emit the machine-readable code 'invalid_combination' as the SOLE error so the
  // use-case's `errors.join('; ')` yields exactly { error: 'invalid_combination' }.
  if (isFixedRecurringConflict({ placementMode: body.placementMode, recurring: body.recurring })) {
    return ['invalid_combination'];
  }
  return errors;
}

/**
 * Cross-field validation for earliestStart > deadline that accounts for
 * partially-patched updates. When only one of earliestStart/deadline is supplied
 * in the body, the OTHER value is read from the existing task row. Returns an
 * error string if the merged values produce an impossible window
 * (earliestStart > deadline), or null if valid. (999.558)
 *
 * Clearing semantics: if the body explicitly sets a field to '' or null,
 * that field is being CLEARED (removed), and we should not fall through to
 * the existing value — a cleared field removes the constraint.
 *
 * @param {Object} body   The request body (partial patch).
 * @param {Object} [existing] The existing task row (DB shape: start_after_at, deadline).
 * @returns {?string} Error string or null.
 */
function validateEarliestStartDeadlineCrossField(body, existing) {
  // Only run the cross-field check when at least one of the two fields is
  // being modified in this PATCH. If neither field is in the body, we do NOT
  // retroactively validate existing data that predates this rule.
  if (!('earliestStart' in body) && !('deadline' in body)) return null;

  // Determine whether each field is being explicitly set (including cleared).
  // A field is "explicitly present in the body" if the key exists, even if the
  // value is empty string or null (which means "clear the field").
  // If the key is absent, fall through to existing.
  var earliestStartExplicit = 'earliestStart' in body;
  var deadlineExplicit = 'deadline' in body;

  // Resolve effective earliestStart: body value if set (even if cleared),
  // otherwise existing value. Cleared fields → null.
  var effectiveEarliestStart;
  if (earliestStartExplicit) {
    effectiveEarliestStart = (body.earliestStart !== null && body.earliestStart !== '') ? body.earliestStart : null;
  } else {
    // task_masters column is `start_after_at` (999.866).
    effectiveEarliestStart = (existing && existing.start_after_at) ? existing.start_after_at : null;
  }

  // Resolve effective deadline: body value if set (even if cleared),
  // otherwise existing value. Cleared fields → null.
  var effectiveDeadline;
  if (deadlineExplicit) {
    effectiveDeadline = (body.deadline !== null && body.deadline !== '') ? body.deadline : null;
  } else {
    effectiveDeadline = (existing && existing.deadline) ? existing.deadline : null;
  }

  // Both must be present and non-null to compare.
  if (!effectiveEarliestStart || !effectiveDeadline) return null;

  var saDate = new Date(effectiveEarliestStart);
  var dlDate = new Date(effectiveDeadline);
  if (isNaN(saDate.getTime()) || isNaN(dlDate.getTime())) return null;

  if (dlDate < saDate) {
    return 'Deadline must be on or after earliest start date';
  }
  return null;
}

module.exports = {
  isFixedRecurringConflict,
  validateTaskInput,
  validateEarliestStartDeadlineCrossField,
  validateStartAfterDeadlineCrossField: validateEarliestStartDeadlineCrossField,
  checkCalSyncEditGuard,
  guardFixedCalendarWhen,
  VALID_WHEN_KEYWORDS,
  VALID_DAY_REQ,
  VALID_DAY_CODES,
  VALID_RECUR_DAY_CODES
};
