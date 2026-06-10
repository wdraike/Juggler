/**
 * ListTasks — application query use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `getAllTasks` HTTP handler (task.controller.js ~660)
 * step-for-step, over the W3/W4 ports:
 *
 *   1. cache hit → return cached `{ tasks, version }` (TaskCachePort.getTasks).
 *   2. miss → read tasks_v for the user (TaskRepositoryPort.fetchTasksWithEventIds
 *      with a queryBuilder applying the orderByRaw + optional limit/offset),
 *      buildSourceMap (pure W2 mapper), map each row via rowToTask (pure, tz=null),
 *      compute the version token (TaskRepositoryPort.getTasksVersion).
 *   3. cache the result (TaskCachePort.setTasks, legacy 300s TTL owned by the adapter).
 *
 * NO express/DB/SDK here — data enters via the injected ports + pure mappers.
 * The orderByRaw / limit / offset clauses are applied through the queryBuilder
 * callback the repository exposes (the SAME clauses the controller built inline),
 * so the Knex adapter runs them DB-side and the InMemory double returns the full
 * user set (the contract surface — see InMemoryTaskRepository.fetchTasksWithEventIds).
 *
 * Behavior-identical (REFACTOR): the response payload + cache key/TTL match the
 * legacy handler exactly. Errors propagate to the caller (the W6 controller keeps
 * the try/catch → 500 mapping; this use-case throws like the inline code did).
 *
 * @typedef {Object} ListTasksDeps
 * @property {import('../../domain/ports/TaskRepositoryPort')} repo
 * @property {import('../../domain/ports/TaskCachePort')} cache
 * @property {Object} mappers  W2 pure mappers (buildSourceMap, rowToTask).
 */

'use strict';

/**
 * @param {ListTasksDeps} deps
 */
function ListTasks(deps) {
  if (!deps || !deps.repo || !deps.cache || !deps.mappers) {
    throw new Error('ListTasks: { repo, cache, mappers } are required');
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.mappers = deps.mappers;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {Object} [input.query] `{ limit, offset }` (raw query-string values,
 *   parsed verbatim as the controller did — parseInt without radix, matching
 *   legacy `getAllTasks` L668-669 exactly).
 * @returns {Promise<{ tasks: Object[], version: string }>}
 */
ListTasks.prototype.execute = function execute(input) {
  var self = this;
  var userId = input.userId;
  var query = input.query || {};
  return this.cache.getTasks(userId).then(function (cached) {
    if (cached) return cached;
    return self.repo.fetchTasksWithEventIds(userId, function (q) {
      q.orderByRaw('(scheduled_at IS NULL) ASC, scheduled_at ASC');
      if (query.limit) q.limit(parseInt(query.limit) || 1000);
      if (query.offset) q.offset(parseInt(query.offset) || 0);
    }).then(function (rows) {
      var srcMap = self.mappers.buildSourceMap(rows);
      var tasks = rows.map(function (r) { return self.mappers.rowToTask(r, null, srcMap); });
      return self.repo.getTasksVersion(userId).then(function (version) {
        var result = { tasks: tasks, version: version };
        return self.cache.setTasks(userId, result).then(function () { return result; });
      });
    });
  });
};

module.exports = ListTasks;
