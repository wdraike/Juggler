/**
 * TaskSliceCalSyncAdapter — concrete CalSyncPort over the TASK SLICE FACADE
 * (999.354 — promotion 2/3).
 *
 * Delegates the cal-sync-linked task reads to `slices/task/facade` instead of the
 * legacy `controllers/task.controller`, removing user-config's cross-slice reach
 * into the legacy controller. Calls the CORRECT 2-arg
 * `fetchTasksWithEventIds(userId, queryBuilder)` signature — fixing the
 * ER_NO_TABLES_USED regression (999.488/489) at the export site.
 */

'use strict';

var CAL_SYNC_PORT_METHODS =
  require('../domain/ports/CalSyncPort').CAL_SYNC_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Object} [deps.taskFacade]  the task slice facade (default: real facade).
 *   Injected so tests can supply a fake without loading the whole task slice.
 */
function TaskSliceCalSyncAdapter(deps) {
  var d = deps || {};
  this.taskFacade = d.taskFacade || require('../../task/facade');
}

/**
 * @param {string} userId
 * @param {(q: Object) => void} [queryBuilder]
 * @returns {Promise<Object[]>}
 */
TaskSliceCalSyncAdapter.prototype.fetchTasksWithEventIds = function fetchTasksWithEventIds(userId, queryBuilder) {
  return this.taskFacade.fetchTasksWithEventIds(userId, queryBuilder);
};

/**
 * @param {Object} row
 * @param {string} tz
 * @returns {Object}
 */
TaskSliceCalSyncAdapter.prototype.rowToTask = function rowToTask(row, tz) {
  return this.taskFacade.rowToTask(row, tz);
};

TaskSliceCalSyncAdapter.CAL_SYNC_PORT_METHODS = CAL_SYNC_PORT_METHODS;

module.exports = TaskSliceCalSyncAdapter;
