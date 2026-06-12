/**
 * Constraint — the placement constraints a single task imposes on the solver.
 *
 * This entity is the named, characterized projection of the per-task fields the
 * legacy `buildItems` loop derives (`unifiedScheduleV2.js`): when-windows,
 * deadline, day-of-week eligibility, recurrence day-lock, dependencies, severity.
 * It does NOT replace the legacy `item` object the placement loop mutates (that
 * stays in `unifiedScheduleV2.js` this wave); it is the domain-level vocabulary
 * for the constraint a task carries, used by `ConstraintSolver` for ordering and
 * severity classification.
 *
 * SEVERITY (S2 contract — fixed > overdue > deadline > free): `Constraint.severity`
 * names the four tiers the scheduler already encodes implicitly through its
 * placement passes (immovable fixed pass → overdue boost → deadline-slack queue →
 * free tail). `ConstraintSolver.severityRank` reads this.
 *
 * BEHAVIOR-PRESERVING: this is a value-carrying record with no I/O. Constructing
 * one does not run the scheduler; it only describes a task's constraint shape.
 */

'use strict';

var Deadline = require('../value-objects/Deadline');

/**
 * Severity tiers, most-severe first. Mirrors the S2 hierarchy the scheduler
 * enforces through its pass order (fixed immovable, overdue boost, deadline
 * slack-sort, free tail).
 * @enum {string}
 */
var SEVERITY = Object.freeze({
  FIXED: 'fixed',
  OVERDUE: 'overdue',
  DEADLINE: 'deadline',
  FREE: 'free'
});

// Most-severe → least-severe ordering used by ConstraintSolver.severityRank.
var SEVERITY_ORDER = Object.freeze([
  SEVERITY.FIXED, SEVERITY.OVERDUE, SEVERITY.DEADLINE, SEVERITY.FREE
]);

/**
 * @param {Object} spec
 * @param {string} spec.taskId
 * @param {?string} [spec.deadlineKey] ISO deadline date-key, or null/undefined
 * @param {boolean} [spec.fixed] true for immovable (pinned/fixed) placement
 * @param {boolean} [spec.overdue] true when the task is past-due and boosted
 * @param {boolean} [spec.dayLocked] true when the task must stay on its anchor day
 * @param {string[]} [spec.dependsOn] task IDs this task must follow
 */
function Constraint(spec) {
  spec = spec || {};
  this.taskId = spec.taskId;
  this.deadlineKey = (spec.deadlineKey != null && Deadline.isValid(spec.deadlineKey))
    ? spec.deadlineKey : (spec.deadlineKey || null);
  this.fixed = !!spec.fixed;
  this.overdue = !!spec.overdue;
  this.dayLocked = !!spec.dayLocked;
  this.dependsOn = Array.isArray(spec.dependsOn) ? spec.dependsOn.slice() : [];
  Object.freeze(this.dependsOn);
  Object.freeze(this);
}

Constraint.SEVERITY = SEVERITY;
Constraint.SEVERITY_ORDER = SEVERITY_ORDER;

/** @returns {boolean} whether this task carries a (present) deadline. */
Constraint.prototype.hasDeadline = function hasDeadline() {
  return this.deadlineKey != null;
};

/**
 * The S2 severity tier this constraint resolves to.
 * Precedence: fixed > overdue > deadline > free (first match wins).
 * @returns {string} one of Constraint.SEVERITY
 */
Constraint.prototype.severity = function severity() {
  if (this.fixed) return SEVERITY.FIXED;
  if (this.overdue) return SEVERITY.OVERDUE;
  if (this.hasDeadline()) return SEVERITY.DEADLINE;
  return SEVERITY.FREE;
};

module.exports = Constraint;
