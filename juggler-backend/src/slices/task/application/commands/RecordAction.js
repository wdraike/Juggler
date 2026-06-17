/**
 * RecordAction — application command that records a state-changing action
 * into the action log (999.681).
 *
 * This is called BY the other command use-cases (UpdateTaskStatus, UpdateTask,
 * DeleteTask) immediately BEFORE they persist the change, so the `before`
 * snapshot captures the pre-mutation state. The `after` snapshot is the
 * intended new state.
 *
 * Only the LATEST action per task is kept (single-undo semantics). Each call
 * to RecordAction replaces any previous entry for the same task.
 *
 * @typedef {Object} RecordActionDeps
 * @property {import('../domain/ports/ActionLogPort')} actionLog
 * @property {Function} uuidv7
 */

'use strict';

var assertDeps = require('../_assertDeps');

/** @param {RecordActionDeps} deps */
function RecordAction(deps) {
  var required = ['actionLog', 'uuidv7'];
  assertDeps('RecordAction', deps, required);
  this.actionLog = deps.actionLog;
  this.uuidv7 = deps.uuidv7;
}

/**
 * @param {Object} input
 * @param {string} input.taskId
 * @param {string} input.userId
 * @param {string} input.actionType  'status_change' | 'field_update' | 'delete'
 * @param {Object} [input.before]     Snapshot of affected fields BEFORE the action
 * @param {Object} [input.after]      Snapshot of affected fields AFTER the action
 * @returns {Promise<void>}
 */
RecordAction.prototype.execute = async function execute(input) {
  var entry = {
    id: this.uuidv7(),
    user_id: input.userId,
    task_id: input.taskId,
    action_type: input.actionType,
    before: input.before || null,
    after: input.after || null,
    created_at: new Date() // P1: new Date(), never fn.now()
  };
  await this.actionLog.record(entry);
};

module.exports = RecordAction;