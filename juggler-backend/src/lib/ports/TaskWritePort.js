/**
 * TaskWritePort — driven-port contract for the task write-path
 * (H2 / W2 — lib-tasks-write). Authoritative interface for mutating the
 * master/instance task model. All application code that creates, updates,
 * or deletes tasks goes through this port.
 *
 * Mirrors the CachePort idiom: a JSDoc `@typedef`, a throw-not-implemented
 * prototype base, and a frozen `TASK_WRITE_PORT_METHODS` array.
 *
 * This port wraps the behavior of `src/lib/tasks-write.js` — the de-facto
 * task write API the codebase already uses — so it exposes EXACTLY that
 * surface: `insertTask` / `insertTasksBatch` / `updateTaskById` /
 * `deleteTaskById` / `softCancelById` / `softCancelWhere` / `updateTasksWhere`
 * / `deleteTasksWhere` / `deleteInstancesWhere` / `updateInstancesWhere` /
 * `resetRecurringInstances` / `splitUpdateFields` / `isTemplate` / `isInstance`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT T-1 (tenancy safety):
 *   Every write operation enforces user_id. insertTask/insertTasksBatch require
 *   row.user_id; update/delete helpers accept userId and filter by it.
 *
 * INVARIANT T-2 (field routing):
 *   updateTaskById and updateTasksWhere split changes into master and instance
 *   fields based on MASTER_UPDATE_FIELDS / INSTANCE_UPDATE_FIELDS. Only the
 *   relevant table is updated for each set of fields.
 *
 * INVARIANT T-3 (classification):
 *   isTemplate: task_type='recurring_template' OR (recurring=1 AND
 *   task_type!='recurring_instance'). isInstance: task_type='recurring_instance'.
 *   Everything else is non-recurring (master + instance share row.id).
 *
 * INVARIANT T-4 (soft delete):
 *   softCancelById and softCancelWhere set status='cancelled' on both tables
 *   (R55 — no hard delete for acted-on rows).
 *
 * @typedef {Object} TaskWritePort
 *
 * @property {(dbOrTrx: object, row: object) => Promise<void>} insertTask
 *   INSERT a task. Routes to master/instance/both based on classification
 *   (INVARIANT T-3). Requires row.user_id (INVARIANT T-1).
 *
 * @property {(dbOrTrx: object, rows: object[]) => Promise<void>} insertTasksBatch
 *   Batch INSERT for many tasks. Classifies each row and writes in bulk
 *   (templates → task_masters, non-recurring → both, recurring_instances
 *   → task_instances with ordinal assignment).
 *
 * @property {(dbOrTrx: object, id: string, changes: object, userId?: string) => Promise<{ masterUpdated: number, instanceUpdated: number }>} updateTaskById
 *   UPDATE a task by id. Routes fields to master/instance (INVARIANT T-2).
 *   Pass userId for tenancy safety (INVARIANT T-1).
 *
 * @property {(dbOrTrx: object, id: string, userId?: string) => Promise<{ instanceDeleted: number, masterDeleted: number }>} deleteTaskById
 *   DELETE a task by id from both tables. Pass userId for tenancy safety.
 *
 * @property {(dbOrTrx: object, id: string, userId?: string) => Promise<{ instanceCancelled: number, masterCancelled: number }>} softCancelById
 *   SOFT-cancel a task by id (INVARIANT T-4). Sets status='cancelled' on both tables.
 *
 * @property {(dbOrTrx: object, userId: string, applyWhere: Function) => Promise<{ instanceCancelled: number, masterCancelled: number }>} softCancelWhere
 *   SOFT-cancel rows matching a where-builder (INVARIANT T-4).
 *
 * @property {(dbOrTrx: object, userId: string, applyWhere: Function, changes: object, opts?: { instanceOnly?: boolean }) => Promise<{ masterUpdated: number, instanceUpdated: number }>} updateTasksWhere
 *   Bulk UPDATE via a where-builder callback. Enforces user_id filter.
 *   Routes fields to master/instance (INVARIANT T-2).
 *
 * @property {(dbOrTrx: object, userId: string, applyWhere: Function) => Promise<{ instanceDeleted: number, masterDeleted: number }>} deleteTasksWhere
 *   Bulk DELETE via a where-builder callback. Enforces user_id filter.
 *
 * @property {(dbOrTrx: object, userId: string, applyWhere: Function) => Promise<number>} deleteInstancesWhere
 *   Delete only instance rows matching a filter. Enforces user_id.
 *
 * @property {(dbOrTrx: object, userId: string, applyWhere: Function, changes: object) => Promise<number>} updateInstancesWhere
 *   Update only instance rows matching a filter. Enforces user_id.
 *   Only INSTANCE_UPDATE_FIELDS are written.
 *
 * @property {(dbOrTrx: object, userId: string, masterId: string, logTag?: string) => Promise<number>} resetRecurringInstances
 *   Drop + reshape a recurring template's future not-started instances (R53).
 *   Cleans cal_sync_ledger first. Returns number of instances dropped.
 *
 * @property {(changes: object) => { master: object, instance: object }} splitUpdateFields
 *   Split changes into master and instance field subsets.
 *
 * @property {(row: object) => boolean} isTemplate
 *   Classify a row as a recurring template (INVARIANT T-3).
 *
 * @property {(row: object) => boolean} isInstance
 *   Classify a row as a recurring instance (INVARIANT T-3).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function TaskWritePort() {}

/**
 * @param {object} dbOrTrx
 * @param {object} row
 * @returns {Promise<void>}
 */
TaskWritePort.prototype.insertTask = function insertTask(_dbOrTrx, _row) {
  throw new Error('TaskWritePort.insertTask not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {object[]} rows
 * @returns {Promise<void>}
 */
TaskWritePort.prototype.insertTasksBatch = function insertTasksBatch(_dbOrTrx, _rows) {
  throw new Error('TaskWritePort.insertTasksBatch not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} id
 * @param {object} changes
 * @param {string} [userId]
 * @returns {Promise<{ masterUpdated: number, instanceUpdated: number }>}
 */
TaskWritePort.prototype.updateTaskById = function updateTaskById(_dbOrTrx, _id, _changes, _userId) {
  throw new Error('TaskWritePort.updateTaskById not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} id
 * @param {string} [userId]
 * @returns {Promise<{ instanceDeleted: number, masterDeleted: number }>}
 */
TaskWritePort.prototype.deleteTaskById = function deleteTaskById(_dbOrTrx, _id, _userId) {
  throw new Error('TaskWritePort.deleteTaskById not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} id
 * @param {string} [userId]
 * @returns {Promise<{ instanceCancelled: number, masterCancelled: number }>}
 */
TaskWritePort.prototype.softCancelById = function softCancelById(_dbOrTrx, _id, _userId) {
  throw new Error('TaskWritePort.softCancelById not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} userId
 * @param {Function} applyWhere
 * @returns {Promise<{ instanceCancelled: number, masterCancelled: number }>}
 */
TaskWritePort.prototype.softCancelWhere = function softCancelWhere(_dbOrTrx, _userId, _applyWhere) {
  throw new Error('TaskWritePort.softCancelWhere not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} userId
 * @param {Function} applyWhere
 * @param {object} changes
 * @param {{ instanceOnly?: boolean }} [opts]
 * @returns {Promise<{ masterUpdated: number, instanceUpdated: number }>}
 */
TaskWritePort.prototype.updateTasksWhere = function updateTasksWhere(_dbOrTrx, _userId, _applyWhere, _changes, _opts) {
  throw new Error('TaskWritePort.updateTasksWhere not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} userId
 * @param {Function} applyWhere
 * @returns {Promise<{ instanceDeleted: number, masterDeleted: number }>}
 */
TaskWritePort.prototype.deleteTasksWhere = function deleteTasksWhere(_dbOrTrx, _userId, _applyWhere) {
  throw new Error('TaskWritePort.deleteTasksWhere not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} userId
 * @param {Function} applyWhere
 * @returns {Promise<number>}
 */
TaskWritePort.prototype.deleteInstancesWhere = function deleteInstancesWhere(_dbOrTrx, _userId, _applyWhere) {
  throw new Error('TaskWritePort.deleteInstancesWhere not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} userId
 * @param {Function} applyWhere
 * @param {object} changes
 * @returns {Promise<number>}
 */
TaskWritePort.prototype.updateInstancesWhere = function updateInstancesWhere(_dbOrTrx, _userId, _applyWhere, _changes) {
  throw new Error('TaskWritePort.updateInstancesWhere not implemented');
};

/**
 * @param {object} dbOrTrx
 * @param {string} userId
 * @param {string} masterId
 * @param {string} [logTag]
 * @returns {Promise<number>}
 */
TaskWritePort.prototype.resetRecurringInstances = function resetRecurringInstances(_dbOrTrx, _userId, _masterId, _logTag) {
  throw new Error('TaskWritePort.resetRecurringInstances not implemented');
};

/**
 * @param {object} changes
 * @returns {{ master: object, instance: object }}
 */
TaskWritePort.prototype.splitUpdateFields = function splitUpdateFields(_changes) {
  throw new Error('TaskWritePort.splitUpdateFields not implemented');
};

/**
 * @param {object} row
 * @returns {boolean}
 */
TaskWritePort.prototype.isTemplate = function isTemplate(_row) {
  throw new Error('TaskWritePort.isTemplate not implemented');
};

/**
 * @param {object} row
 * @returns {boolean}
 */
TaskWritePort.prototype.isInstance = function isInstance(_row) {
  throw new Error('TaskWritePort.isInstance not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy TaskWritePort.
 * @type {ReadonlyArray<string>}
 */
var TASK_WRITE_PORT_METHODS = Object.freeze([
  'insertTask',
  'insertTasksBatch',
  'updateTaskById',
  'deleteTaskById',
  'softCancelById',
  'softCancelWhere',
  'updateTasksWhere',
  'deleteTasksWhere',
  'deleteInstancesWhere',
  'updateInstancesWhere',
  'resetRecurringInstances',
  'splitUpdateFields',
  'isTemplate',
  'isInstance'
]);

module.exports = TaskWritePort;
module.exports.TaskWritePort = TaskWritePort;
module.exports.TASK_WRITE_PORT_METHODS = TASK_WRITE_PORT_METHODS;
