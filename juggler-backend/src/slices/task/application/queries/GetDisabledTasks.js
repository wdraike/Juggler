/**
 * GetDisabledTasks — application query use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `getDisabledTasks` HTTP handler (task.controller.js ~2268)
 * step-for-step, over the W3 repository port:
 *
 *   1. fetch the user's disabled rows with event ids
 *      (TaskRepositoryPort.fetchTasksWithEventIds with a queryBuilder applying
 *      `where status='disabled' orderBy disabled_at desc`).
 *   2. buildSourceMap (pure) over the recurring-template rows
 *      (TaskRepositoryPort.getRecurringTemplateRows).
 *   3. rowToTask (pure, tz=null) each row → `{ tasks }`.
 *
 * Behavior-identical: same filter/order + payload shape as the legacy handler.
 * Errors propagate (W6 keeps the 500 mapping).
 *
 * @typedef {Object} GetDisabledTasksDeps
 * @property {import('../../domain/ports/TaskRepositoryPort')} repo
 * @property {Object} mappers  W2 pure mappers (buildSourceMap, rowToTask).
 */

'use strict';

/** @param {GetDisabledTasksDeps} deps */
function GetDisabledTasks(deps) {
  if (!deps || !deps.repo || !deps.mappers) {
    throw new Error('GetDisabledTasks: { repo, mappers } are required');
  }
  this.repo = deps.repo;
  this.mappers = deps.mappers;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @returns {Promise<{ tasks: Object[] }>}
 */
GetDisabledTasks.prototype.execute = function execute(input) {
  var self = this;
  var userId = input.userId;
  return this.repo.fetchTasksWithEventIds(userId, function (q) {
    q.where('status', 'disabled').orderBy('disabled_at', 'desc');
  }).then(function (rows) {
    return self.repo.getRecurringTemplateRows(userId).then(function (templateRows) {
      var srcMap = self.mappers.buildSourceMap(templateRows);
      var tasks = rows.map(function (r) { return self.mappers.rowToTask(r, null, srcMap); });
      return { tasks: tasks };
    });
  });
};

module.exports = GetDisabledTasks;
