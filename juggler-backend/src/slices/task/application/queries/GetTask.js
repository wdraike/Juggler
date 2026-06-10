/**
 * GetTask — application query use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `getTask` HTTP handler (task.controller.js ~686)
 * step-for-step, over the W3 repository port:
 *
 *   1. In parallel: fetch the single row with event ids
 *      (TaskRepositoryPort.fetchTaskWithEventIds) + the recurring-template rows
 *      for the srcMap (TaskRepositoryPort.getRecurringTemplateRows).
 *   2. null row → 404 (`{ status: 404, body: { error: 'Task not found' } }`).
 *   3. buildSourceMap (pure) over the template rows, rowToTask (pure, tz=null),
 *      return `{ status: 200, body: { task } }`.
 *
 * The use-case returns a `{ status, body }` envelope — the SAME status/payload
 * the handler produced via res.status(...).json(...). The W6 controller maps it
 * back onto express; this keeps the application layer express-free while
 * reproducing the handler's branch-for-branch behavior (incl. the 404).
 *
 * @typedef {Object} GetTaskDeps
 * @property {import('../../domain/ports/TaskRepositoryPort')} repo
 * @property {Object} mappers  W2 pure mappers (buildSourceMap, rowToTask).
 */

'use strict';

/** @param {GetTaskDeps} deps */
function GetTask(deps) {
  if (!deps || !deps.repo || !deps.mappers) {
    throw new Error('GetTask: { repo, mappers } are required');
  }
  this.repo = deps.repo;
  this.mappers = deps.mappers;
}

/**
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @returns {Promise<{ status: number, body: Object }>}
 */
GetTask.prototype.execute = function execute(input) {
  var self = this;
  var id = input.id;
  var userId = input.userId;
  return Promise.all([
    this.repo.fetchTaskWithEventIds(id, userId),
    this.repo.getRecurringTemplateRows(userId)
  ]).then(function (res) {
    var row = res[0];
    var templateRows = res[1];
    if (!row) return { status: 404, body: { error: 'Task not found' } };
    var srcMap = self.mappers.buildSourceMap(templateRows);
    return { status: 200, body: { task: self.mappers.rowToTask(row, null, srcMap) } };
  });
};

module.exports = GetTask;
