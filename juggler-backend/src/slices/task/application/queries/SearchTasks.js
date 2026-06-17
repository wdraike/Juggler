/**
 * SearchTasks — application query use-case for FULLTEXT search (999.253).
 *
 * Searches task descriptions and notes using MySQL MATCH…AGAINST
 * (BOOLEAN MODE) on the `ft_tasks_search` FULLTEXT index. Returns
 * task rows in the same shape as ListTasks (rowToTask-mappable),
 * ordered by relevance score (highest first).
 *
 * The search hits `task_masters` directly (FULLTEXT indexes cannot
 * exist on views). Since `tasks_v` UNIONs task_masters with
 * task_instances↔task_masters (where text/notes always come from
 * task_masters), matching task_masters covers all tasks.
 *
 * Input validation:
 *   - `q` is required, must be a non-empty string after trimming.
 *   - `q` is capped at 200 chars to prevent abuse.
 *   - Returns 400 on invalid input.
 *
 * @typedef {Object} SearchTasksDeps
 * @property {import('../../domain/ports/TaskRepositoryPort')} repo
 * @property {Object} mappers  W2 pure mappers (buildSourceMap, rowToTask).
 */

'use strict';

var MAX_QUERY_LENGTH = 200;

/**
 * @param {SearchTasksDeps} deps
 */
function SearchTasks(deps) {
  if (!deps || !deps.repo || !deps.mappers) {
    throw new Error('SearchTasks: { repo, mappers } are required');
  }
  this.repo = deps.repo;
  this.mappers = deps.mappers;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {string} input.q  The search query string
 * @returns {Promise<{ tasks: Object[] }>}
 */
SearchTasks.prototype.execute = function execute(input) {
  var self = this;
  var userId = input.userId;
  var q = (input.q || '').trim();

  if (!q) {
    return Promise.resolve({ tasks: [] });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    q = q.substring(0, MAX_QUERY_LENGTH);
  }

  return this.repo.searchTasks(userId, q).then(function (rows) {
    var srcMap = self.mappers.buildSourceMap(rows);
    var tasks = rows.map(function (r) { return self.mappers.rowToTask(r, null, srcMap); });
    return { tasks: tasks };
  });
};

module.exports = SearchTasks;