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
  // cross-field: deadline >= startAfter (body-only check; for updates that
  // patch only one field, use validateStartAfterDeadlineCrossField below)
  if (body.deadline && body.startAfter) {
    var dlD = new Date(body.deadline);
    var saD = new Date(body.startAfter);
    if (!isNaN(dlD.getTime()) && !isNaN(saD.getTime()) && dlD < saD) errors.push('Deadline must be on or after start-after date');
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
  return errors;
}

/**
 * Cross-field validation for startAfter > deadline that accounts for
 * partially-patched updates. When only one of startAfter/deadline is supplied
 * in the body, the OTHER value is read from the existing task row. Returns an
 * error string if the merged values produce an impossible window
 * (startAfter > deadline), or null if valid. (999.558)
 *
 * Clearing semantics: if the body explicitly sets a field to '' or null,
 * that field is being CLEARED (removed), and we should not fall through to
 * the existing value — a cleared field removes the constraint.
 *
 * @param {Object} body   The request body (partial patch).
 * @param {Object} [existing] The existing task row (DB shape: start_after_at, deadline).
 * @returns {?string} Error string or null.
 */
function validateStartAfterDeadlineCrossField(body, existing) {
  // Only run the cross-field check when at least one of the two fields is
  // being modified in this PATCH. If neither field is in the body, we do NOT
  // retroactively validate existing data that predates this rule.
  if (!('startAfter' in body) && !('deadline' in body)) return null;

  // Determine whether each field is being explicitly set (including cleared).
  // A field is "explicitly present in the body" if the key exists, even if the
  // value is empty string or null (which means "clear the field").
  // If the key is absent, fall through to existing.
  var startAfterExplicit = 'startAfter' in body;
  var deadlineExplicit = 'deadline' in body;

  // Resolve effective startAfter: body value if set (even if cleared),
  // otherwise existing value. Cleared fields → null.
  var effectiveStartAfter;
  if (startAfterExplicit) {
    effectiveStartAfter = (body.startAfter !== null && body.startAfter !== '') ? body.startAfter : null;
  } else {
    effectiveStartAfter = (existing && existing.start_after_at) ? existing.start_after_at : null;
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
  if (!effectiveStartAfter || !effectiveDeadline) return null;

  var saDate = new Date(effectiveStartAfter);
  var dlDate = new Date(effectiveDeadline);
  if (isNaN(saDate.getTime()) || isNaN(dlDate.getTime())) return null;

  if (dlDate < saDate) {
    return 'Deadline must be on or after start-after date';
  }
  return null;
}

module.exports = {
  validateTaskInput,
  validateStartAfterDeadlineCrossField,
  checkCalSyncEditGuard,
  guardFixedCalendarWhen,
  VALID_WHEN_KEYWORDS,
  VALID_DAY_REQ,
  VALID_DAY_CODES,
  VALID_RECUR_DAY_CODES
};
