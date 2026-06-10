/**
 * CompleteTask — application command use-case (Phase H3 / W5; WBS-named command).
 *
 * The "mark task done" path. In the legacy controller this is NOT a separate
 * handler — `updateTaskStatus` routes status='done' through the SAME body (the
 * completed_at stamp, the scheduled_at-preservation rule, the
 * publishTaskCompleted branch). To preserve that behavior-identity, CompleteTask
 * is a thin command that delegates to UpdateTaskStatus with status forced to
 * 'done', then is its own named entry-point for the WBS/facade (and for callers
 * that semantically "complete" a task).
 *
 * It does NOT duplicate the done orchestration — duplicating it would risk drift
 * from the single characterized path. The done-specific behavior (completed_at,
 * scheduled_at preservation, done_frozen reactivation, publishTaskCompleted) all
 * lives in UpdateTaskStatus and is exercised here via status='done'.
 *
 * @typedef {Object} CompleteTaskDeps
 * @property {import('./UpdateTaskStatus')|Object} updateTaskStatus  an
 *   UpdateTaskStatus instance (has .execute). Injected so the facade wires one.
 */

'use strict';

/** @param {CompleteTaskDeps} deps */
function CompleteTask(deps) {
  if (!deps || !deps.updateTaskStatus || typeof deps.updateTaskStatus.execute !== 'function') {
    throw new Error('CompleteTask: { updateTaskStatus } (an UpdateTaskStatus instance) is required');
  }
  this.updateTaskStatus = deps.updateTaskStatus;
}

/**
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @param {Object} [input.body]  optional `{ completedAt }`; status is forced to 'done'.
 * @param {string} [input.timezoneHeader]
 * @returns {Promise<{ status: number, body: Object }>}
 */
CompleteTask.prototype.execute = function execute(input) {
  var body = Object.assign({}, input.body || {}, { status: 'done' });
  return this.updateTaskStatus.execute({
    id: input.id,
    userId: input.userId,
    body: body,
    timezoneHeader: input.timezoneHeader
  });
};

module.exports = CompleteTask;
