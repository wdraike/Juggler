/**
 * ConstraintSolver — pure most-constrained-first ordering + classification core
 * (H6 W1 domain core).
 *
 * HOUSES the constraint-ordering primitives MOVED out of
 * `src/scheduler/unifiedScheduleV2.js`, byte-for-byte:
 *   - `compareItems`        — the S1 placement order: slack asc, pri asc, dur desc, id
 *   - `effectiveDuration`   — clamp/normalize a task's working duration
 *   - `recurringCycleDays`  — cycle length used to cap flexible-recurring search
 *   - `parseDayReq`         — day-of-week eligibility set
 * plus the S2 severity ranking (`severityRank`) over `Constraint.severity()`.
 *
 * `unifiedScheduleV2.js` imports and delegates to these — this class is now the
 * single source of truth for the ordering algorithm. The H6 golden-master S1
 * (slack ordering) and S2 (severity) tests run through the legacy entry point and
 * therefore through this code; they pin the behavior bit-for-bit. Do NOT change
 * any comparator branch, tie-break, or numeric constant.
 *
 * PURE: no I/O. Priority normalization/ranking delegates to the Priority VO
 * (itself a frozen PRI_RANK lookup).
 */

'use strict';

var Priority = require('../value-objects/Priority');
var Constraint = require('../entities/Constraint');

/**
 * Normalize an arbitrary priority-ish input to a canonical tier (P1..P4).
 * BYTE-IDENTICAL to the legacy `normalizePri` (delegates to Priority.normalize).
 * @param {*} p
 * @returns {string}
 */
function normalizePri(p) {
  return Priority.normalize(p);
}

/**
 * Effective working duration for a task, in minutes.
 * BYTE-IDENTICAL port of `unifiedScheduleV2.effectiveDuration`:
 *   prefer timeRemaining / time_remaining over dur; treat <0 as 30 (default),
 *   keep 0 as 0, and clamp the upper bound to 720.
 * @param {Object} t task object
 * @returns {number}
 */
function effectiveDuration(t) {
  var rd = t.timeRemaining != null ? t.timeRemaining
         : t.time_remaining != null ? t.time_remaining
         : t.dur;
  return Math.min(rd > 0 ? rd : (rd === 0 ? 0 : 30), 720);
}

/**
 * Recurrence cycle length in days. Used to cap the placement-search window for
 * flexible recurring instances. Returns 0 when the recurrence has no natural
 * cycle (caller skips the cap).
 * BYTE-IDENTICAL port of `unifiedScheduleV2.recurringCycleDays`.
 * @param {(string|Object)} recur
 * @returns {number}
 */
function recurringCycleDays(recur) {
  if (!recur) return 0;
  var r = recur;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return 0; } }
  var type = r && r.type;
  if (type === 'weekly') return 7;
  if (type === 'biweekly') return 14;
  if (type === 'monthly') return 30;
  if (type === 'daily') return 1;
  if (type === 'interval') {
    var every = Number(r.every) || 1;
    var unit = r.unit || 'days';
    if (unit === 'days') return every;
    if (unit === 'weeks') return every * 7;
    if (unit === 'months') return every * 30;
    if (unit === 'years') return every * 365;
  }
  return 0;
}

// Day-of-week code → index (Sun=0..Sat=6). BYTE-IDENTICAL to the legacy map.
var DOW_CODE_TO_IDX = { U: 0, Su: 0, M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, S: 6 };

/**
 * Parse `task.dayReq` into a set of allowed day-of-week indices, or null when all
 * days are allowed (undefined/empty/'any'/all-7).
 * BYTE-IDENTICAL port of `unifiedScheduleV2.parseDayReq`.
 * @param {*} dayReq
 * @returns {?Object} map of { dowIndex: true } or null for unconstrained
 */
function parseDayReq(dayReq) {
  if (!dayReq || dayReq === 'any') return null;
  if (dayReq === 'weekday') return { 1: true, 2: true, 3: true, 4: true, 5: true };
  if (dayReq === 'weekend') return { 0: true, 6: true };
  var parts = String(dayReq).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  if (parts.length === 0) return null;
  var set = {};
  var count = 0;
  parts.forEach(function(p) {
    if (DOW_CODE_TO_IDX[p] != null) { set[DOW_CODE_TO_IDX[p]] = true; count++; }
  });
  if (count === 0 || count >= 7) return null; // no parses recognized or all days → unconstrained
  return set;
}

/**
 * S1 ordering comparator: most-constrained → least-constrained.
 * Order: slack ascending (Infinity/null sentinel to the end), priority ascending
 * (P1 < P2 < P3 < P4), duration descending (longer first), then id ascending for
 * determinism.
 * BYTE-IDENTICAL port of `unifiedScheduleV2.compareItems`.
 * @param {Object} a item { slack, pri, dur, id }
 * @param {Object} b item { slack, pri, dur, id }
 * @returns {number} -1 / 0 / 1
 */
function compareItems(a, b) {
  // Slack asc (Infinity to end).
  var sa = a.slack == null ? 0 : a.slack;
  var sb = b.slack == null ? 0 : b.slack;
  if (sa !== sb) {
    if (!isFinite(sa) && isFinite(sb)) return 1;
    if (isFinite(sa) && !isFinite(sb)) return -1;
    if (sa < sb) return -1;
    if (sa > sb) return 1;
  }
  // Priority asc (P1 < P2 < P3 < P4).
  if (a.pri < b.pri) return -1;
  if (a.pri > b.pri) return 1;
  // Duration desc (longer first).
  if (a.dur !== b.dur) return b.dur - a.dur;
  // Deterministic id tiebreak.
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Sort a list of placement items in-place by `compareItems` and return it.
 * Mirrors the per-iteration `queue.sort(compareItems)` in the placement loop.
 * @param {Object[]} items
 * @returns {Object[]} the same array, sorted
 */
function order(items) {
  return items.sort(compareItems);
}

/**
 * S2 severity rank: lower number = more severe (placed/considered first).
 * fixed(0) > overdue(1) > deadline(2) > free(3). Reads `Constraint.severity()`.
 * @param {Constraint} constraint
 * @returns {number} index into Constraint.SEVERITY_ORDER (0 = most severe)
 */
function severityRank(constraint) {
  var sev = constraint.severity();
  var idx = Constraint.SEVERITY_ORDER.indexOf(sev);
  return idx < 0 ? Constraint.SEVERITY_ORDER.length : idx;
}

/**
 * Compare two constraints by S2 severity (most-severe first). Stable: equal
 * severities return 0 so the caller's secondary order (slack/pri) is preserved.
 * @param {Constraint} a
 * @param {Constraint} b
 * @returns {number}
 */
function compareSeverity(a, b) {
  return severityRank(a) - severityRank(b);
}

module.exports = {
  normalizePri: normalizePri,
  effectiveDuration: effectiveDuration,
  recurringCycleDays: recurringCycleDays,
  parseDayReq: parseDayReq,
  compareItems: compareItems,
  order: order,
  severityRank: severityRank,
  compareSeverity: compareSeverity,
  DOW_CODE_TO_IDX: DOW_CODE_TO_IDX
};
