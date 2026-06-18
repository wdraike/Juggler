/**
 * CalSyncPort — driven-port contract for the user-config slice's cross-slice
 * read of cal-sync-linked task data (999.354 — promotion 2/3).
 *
 * ExportData needs to read the user's tasks JOINED with their calendar-sync event
 * ids (gcal/msft/apple, sourced from tasks_v + cal_sync_ledger) and map the rows
 * to API task objects. Historically the user-config facade reached straight into
 * the legacy `controllers/task.controller` for this (`fetchTasksWithEventIds` +
 * `rowToTask`) — a direct cross-slice + legacy-controller dependency. This port
 * promotes that read cluster to a typed seam; the adapter delegates to the TASK
 * SLICE FACADE, so user-config no longer requires the legacy controller.
 *
 * ⚠ Signature correctness (999.488 / 999.489 root cause): the slice read is
 * `fetchTasksWithEventIds(userId, queryBuilder)` — TWO args. The legacy callers
 * still passed the old `(db, userId, queryBuilder)` 3-arg shape, so `getDb()`
 * landed in the `userId` slot and serialized to an empty `(select *)` subquery →
 * `ER_NO_TABLES_USED` against cal_sync_ledger/tasks_v (silently empty export).
 * This port's contract pins the correct 2-arg shape.
 *
 * @typedef {Object} CalSyncPort
 * @property {(userId: string, queryBuilder?: (q: Object) => void) => Promise<Object[]>} fetchTasksWithEventIds
 *   Read the user's task rows (tasks_v) enriched with cal-sync event ids. The
 *   optional queryBuilder mutates the knex query (e.g. ordering).
 * @property {(row: Object, tz: string) => Object} rowToTask
 *   Map a task DB row to an API task object (pure; delegates to the task mapper).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function CalSyncPort() {}

CalSyncPort.prototype.fetchTasksWithEventIds = function fetchTasksWithEventIds(_userId, _queryBuilder) {
  throw new Error('CalSyncPort.fetchTasksWithEventIds not implemented');
};

CalSyncPort.prototype.rowToTask = function rowToTask(_row, _tz) {
  throw new Error('CalSyncPort.rowToTask not implemented');
};

var CAL_SYNC_PORT_METHODS = Object.freeze([
  'fetchTasksWithEventIds',
  'rowToTask'
]);

module.exports = CalSyncPort;
module.exports.CalSyncPort = CalSyncPort;
module.exports.CAL_SYNC_PORT_METHODS = CAL_SYNC_PORT_METHODS;
