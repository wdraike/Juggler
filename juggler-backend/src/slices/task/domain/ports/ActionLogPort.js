/**
 * ActionLogPort — driven-port contract for action-log persistence (999.681).
 *
 * Records state-changing actions on tasks so they can be reversed via undo.
 * Only the LATEST action per task is stored — each new action replaces any
 * previous one (single-undo, not a full audit history).
 *
 * @typedef {Object} ActionLogPort
 * @property {(entry: ActionLogEntry) => Promise<void>} record
 *   Store an action log entry. Deletes any existing entry for the same task
 *   first (single-undo semantics — only the most recent action is reversible).
 *
 * @property {(taskId: string, userId: string) => Promise<?ActionLogEntry>} findLatest
 *   Retrieve the most recent action log entry for a task + user.
 *   Returns null if no entry exists.
 *
 * @property {(taskId: string, userId: string) => Promise<number>} remove
 *   Delete the action log entry for a task + user. Returns rows removed (0 or 1).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function ActionLogPort() {}

ActionLogPort.prototype.record = function record(_entry) {
  throw new Error('ActionLogPort.record not implemented');
};

ActionLogPort.prototype.findLatest = function findLatest(_taskId, _userId) {
  throw new Error('ActionLogPort.findLatest not implemented');
};

ActionLogPort.prototype.remove = function remove(_taskId, _userId) {
  throw new Error('ActionLogPort.remove not implemented');
};

var ACTION_LOG_PORT_METHODS = Object.freeze([
  'record',
  'findLatest',
  'remove'
]);

module.exports = ActionLogPort;
module.exports.ActionLogPort = ActionLogPort;
module.exports.ACTION_LOG_PORT_METHODS = ACTION_LOG_PORT_METHODS;