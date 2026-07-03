/**
 * TaskStatusPort — driven-port contract for task status constants + validation
 * (999.944 H7 — lib/task-status.js, re-exports shared/task-status.js).
 *
 * Mirrors the LockPort/SSEPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps the surface of `src/lib/task-status.js` (which re-exports
 * `shared/task-status.js`) — the canonical source of truth for task status
 * constants, validation, and state-transition checks used across the backend.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT TS-1 (frozen constants): TaskStatus, TASK_STATUSES,
 *   TERMINAL_STATUSES, ACTIVE_STATUSES, and STATUS_OPTIONS are Object.freeze'd
 *   and must never be mutated at runtime.
 *
 * INVARIANT TS-2 (terminal immutability): canTransition returns false if
 *   currentStatus is terminal — terminal statuses are irreversible.
 *
 * INVARIANT TS-3 (EMPTY is the only active status): only EMPTY can transition
 *   to done/skip/cancel/pause. All other non-terminal states are undefined.
 *
 * @typedef {Object} TaskStatusPort
 *
 * @property {Object} TaskStatus — frozen enum { EMPTY, DONE, CANCEL, SKIP, PAUSE }
 * @property {ReadonlyArray<string>} TASK_STATUSES — all valid status values
 * @property {ReadonlyArray<string>} TERMINAL_STATUSES — [done, cancel, skip, pause]
 * @property {ReadonlyArray<string>} ACTIVE_STATUSES — [empty]
 * @property {ReadonlyArray<string>} STATUS_OPTIONS — all valid options (same as TASK_STATUSES)
 * @property {(status: string) => boolean} isValidTaskStatus — true if status is in TASK_STATUSES
 * @property {(status: string) => boolean} isTerminalStatus — true if status is in TERMINAL_STATUSES
 * @property {(status: string) => boolean} isActiveStatus — true if status is in ACTIVE_STATUSES
 * @property {(status: string) => string} getTaskStatusDisplayName — human-readable name
 * @property {(status: string) => string} getTaskStatusDescription — longer description
 * @property {Object} CalHistoryStatus — frozen enum { SCHEDULED, COMPLETED, MISSED, CANCELLED }
 * @property {ReadonlyArray<string>} CAL_HISTORY_STATUSES — all cal-history status values
 * @property {ReadonlyArray<string>} CAL_HISTORY_TERMINAL_STATUSES — [COMPLETED, MISSED, CANCELLED]
 * @property {(status: string) => boolean} isValidCalHistoryStatus — true if status is a valid cal-history status
 * @property {(status: string) => boolean} isCalHistoryTerminalStatus — true if status is a terminal cal-history status
 * @property {(value: number|null|undefined) => boolean} isValidBooleanValue — true if value is 0 or 1
 * @property {(status: string|null|undefined, context?: string) => boolean} validateStatusValue — validates a status value with context
 * @property {(currentStatus: string, newStatus: string) => boolean} canTransition — state-transition check (INVARIANT TS-2)
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function TaskStatusPort() {}

TaskStatusPort.prototype.TaskStatus = Object.freeze({});
TaskStatusPort.prototype.TASK_STATUSES = Object.freeze([]);
TaskStatusPort.prototype.TERMINAL_STATUSES = Object.freeze([]);
TaskStatusPort.prototype.ACTIVE_STATUSES = Object.freeze([]);
TaskStatusPort.prototype.STATUS_OPTIONS = Object.freeze([]);
TaskStatusPort.prototype.CalHistoryStatus = Object.freeze({});
TaskStatusPort.prototype.CAL_HISTORY_STATUSES = Object.freeze([]);
TaskStatusPort.prototype.CAL_HISTORY_TERMINAL_STATUSES = Object.freeze([]);

TaskStatusPort.prototype.isValidTaskStatus = function isValidTaskStatus(_status) {
  throw new Error('TaskStatusPort.isValidTaskStatus not implemented');
};

TaskStatusPort.prototype.isTerminalStatus = function isTerminalStatus(_status) {
  throw new Error('TaskStatusPort.isTerminalStatus not implemented');
};

TaskStatusPort.prototype.isActiveStatus = function isActiveStatus(_status) {
  throw new Error('TaskStatusPort.isActiveStatus not implemented');
};

TaskStatusPort.prototype.getTaskStatusDisplayName = function getTaskStatusDisplayName(_status) {
  throw new Error('TaskStatusPort.getTaskStatusDisplayName not implemented');
};

TaskStatusPort.prototype.getTaskStatusDescription = function getTaskStatusDescription(_status) {
  throw new Error('TaskStatusPort.getTaskStatusDescription not implemented');
};

TaskStatusPort.prototype.canTransition = function canTransition(_currentStatus, _newStatus) {
  throw new Error('TaskStatusPort.canTransition not implemented');
};

TaskStatusPort.prototype.isValidCalHistoryStatus = function isValidCalHistoryStatus(_status) {
  throw new Error('TaskStatusPort.isValidCalHistoryStatus not implemented');
};

TaskStatusPort.prototype.isCalHistoryTerminalStatus = function isCalHistoryTerminalStatus(_status) {
  throw new Error('TaskStatusPort.isCalHistoryTerminalStatus not implemented');
};

TaskStatusPort.prototype.isValidBooleanValue = function isValidBooleanValue(_value) {
  throw new Error('TaskStatusPort.isValidBooleanValue not implemented');
};

TaskStatusPort.prototype.validateStatusValue = function validateStatusValue(_status, _context) {
  throw new Error('TaskStatusPort.validateStatusValue not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy TaskStatusPort.
 * @type {ReadonlyArray<string>}
 */
var TASK_STATUS_PORT_METHODS = Object.freeze([
  'isValidTaskStatus',
  'isTerminalStatus',
  'isActiveStatus',
  'getTaskStatusDisplayName',
  'getTaskStatusDescription',
  'canTransition',
  'isValidCalHistoryStatus',
  'isCalHistoryTerminalStatus',
  'isValidBooleanValue',
  'validateStatusValue'
]);

module.exports = TaskStatusPort;
module.exports.TaskStatusPort = TaskStatusPort;
module.exports.TASK_STATUS_PORT_METHODS = TASK_STATUS_PORT_METHODS;