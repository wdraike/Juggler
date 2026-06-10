/**
 * TaskStatus — closed-enum value object over the task lifecycle status.
 *
 * CHARACTERIZED (W2), NOT assumed: the accepted set is the EXACT contents of
 * `src/lib/task-status.js`'s frozen `STATUS_OPTIONS`, which is the single source
 * of truth the controller already uses (`isTerminalStatus` is imported from it
 * and `rowToTask` surfaces `status: row.status || ''`). Verified against:
 *   - src/lib/task-status.js  STATUS_OPTIONS = ['', 'wip', 'done', 'cancel',
 *                                               'skip', 'pause', 'missed']
 *   - the W1 golden-master makeTaskRow default `status: ''` and the
 *     updateTaskStatus('done') / terminal-status paths.
 *
 * This VO does NOT introduce the S7 "task-type" terms — those are a SEPARATE
 * classification (see TaskTypeTerm.js). `status` is the lifecycle column; it is a
 * distinct closed enum and is modelled here so the application layer can reject
 * an unknown status before it reaches the DB (the legacy controller relied on the
 * frozen STATUS_OPTIONS list + the DB ENUM for this).
 *
 * S7 PARALLEL: TaskStatus is a closed enum that rejects unknown terms exactly the
 * way the S7 contract requires of the task-type VOs — the canonical set here is
 * the status set, characterized from STATUS_OPTIONS.
 *
 * BEHAVIOR-PRESERVING: the mappers do NOT wrap status in this VO (rowToTask still
 * emits the raw string `row.status || ''`); TaskStatus is a guard for the
 * application/repository layers, so no mapper output changes.
 */

'use strict';

var taskStatusLib = require('../../../../lib/task-status');

// The canonical, closed set — characterized from STATUS_OPTIONS (the single
// source of truth the controller imports). '' is the empty/active status.
var VALUES = Object.freeze(taskStatusLib.STATUS_OPTIONS.slice());
var TERMINAL = Object.freeze(taskStatusLib.TERMINAL_STATUSES.slice());

/**
 * @param {string} value One of the canonical status strings (incl. `''`).
 * @throws {Error} if `value` is not in the canonical STATUS_OPTIONS set.
 */
function TaskStatus(value) {
  if (VALUES.indexOf(value) === -1) {
    throw new Error(
      'TaskStatus must be one of [' + VALUES.map(function(v) { return "'" + v + "'"; }).join(', ') +
      '], got: ' + JSON.stringify(value)
    );
  }
  this.value = value;
  Object.freeze(this);
}

/**
 * The canonical accepted values (closed set), incl. the empty/active `''`.
 * @type {ReadonlyArray<string>}
 */
TaskStatus.VALUES = VALUES;

/**
 * The terminal subset (done/cancel/skip/pause/missed) — characterized from
 * TERMINAL_STATUSES.
 * @type {ReadonlyArray<string>}
 */
TaskStatus.TERMINAL = TERMINAL;

/**
 * True iff `value` is an accepted status (does not throw).
 * @param {*} value
 * @returns {boolean}
 */
TaskStatus.isValid = function isValid(value) {
  return VALUES.indexOf(value) !== -1;
};

/**
 * @returns {boolean} whether this status is terminal (matches
 *   `task-status.isTerminalStatus` exactly).
 */
TaskStatus.prototype.isTerminal = function isTerminal() {
  return TERMINAL.indexOf(this.value) !== -1;
};

/** @returns {string} the raw status string. */
TaskStatus.prototype.toString = function toString() {
  return this.value;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
TaskStatus.prototype.equals = function equals(other) {
  return other instanceof TaskStatus && other.value === this.value;
};

/**
 * Factory. Returns the input unchanged if it is already a TaskStatus.
 * @param {(TaskStatus|string)} value
 * @returns {TaskStatus}
 */
TaskStatus.from = function from(value) {
  if (value instanceof TaskStatus) return value;
  return new TaskStatus(value);
};

module.exports = TaskStatus;
