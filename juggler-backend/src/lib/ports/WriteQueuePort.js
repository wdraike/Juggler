/**
 * WriteQueuePort — driven-port contract for the durable task-write queue
 * (H2 / W2 — lib-task-write-queue). Authoritative interface for the queue
 * that buffers scheduling-relevant task mutations when the per-user lock
 * is held.
 *
 * Mirrors the CachePort idiom: a JSDoc `@typedef`, a throw-not-implemented
 * prototype base, and a frozen `WRITE_QUEUE_PORT_METHODS` array.
 *
 * This port wraps the behavior of `src/lib/task-write-queue.js` — the de-facto
 * write queue API the codebase already uses — so it exposes EXACTLY that surface:
 * `enqueueWrite` / `isLocked` / `splitFields` / `flushQueue` / `flushQueueInLock`
 * / `NON_SCHEDULING_FIELDS`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT W-1 (field classification):
 *   splitFields classifies a DB row fragment into scheduling and non-scheduling
 *   fields. Any field NOT in NON_SCHEDULING_FIELDS is classified as scheduling.
 *
 * INVARIANT W-2 (lock check):
 *   isLocked checks the sync_locks table directly (PK lookup, sub-millisecond).
 *
 * INVARIANT W-3 (coalescing):
 *   flushQueueInLock reads all pending entries, coalesces them per task_id
 *   (delete cancels create, updates merge), applies them in a single transaction,
 *   then deletes processed entries. Post-flush: invalidates cache, notifies
 *   frontend via SSE, and enqueues a schedule run.
 *
 * INVARIANT W-4 (lock acquisition in flushQueue):
 *   flushQueue acquires the lock first, flushes, then releases. Returns true
 *   if flushed, false if lock couldn't be acquired.
 *
 * @typedef {Object} WriteQueuePort
 *
 * @property {(row: object) => { schedulingFields: object, nonSchedulingFields: object }} splitFields
 *   Split a DB row fragment into scheduling and non-scheduling fields
 *   (INVARIANT W-1).
 *
 * @property {(userId: string) => Promise<boolean>} isLocked
 *   Fast check: is the per-user lock currently held? (INVARIANT W-2).
 *
 * @property {(userId: string, taskId: string, operation: string, fields: object, source?: string) => Promise<void>} enqueueWrite
 *   Insert a pending write into the queue. Fields must be pre-converted DB
 *   row fragments.
 *
 * @property {(userId: string) => Promise<boolean>} flushQueue
 *   Flush all pending writes for a user. Acquires the lock first (INVARIANT W-4).
 *   Returns true if flushed, false if lock couldn't be acquired.
 *
 * @property {(userId: string) => Promise<void>} flushQueueInLock
 *   Flush all pending writes for a user. Caller already holds the lock
 *   (INVARIANT W-3).
 *
 * @property {ReadonlySet<string>} NON_SCHEDULING_FIELDS
 *   The set of field names that are NOT scheduling-relevant.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function WriteQueuePort() {}

/**
 * @param {object} row
 * @returns {{ schedulingFields: object, nonSchedulingFields: object }}
 */
WriteQueuePort.prototype.splitFields = function splitFields(_row) {
  throw new Error('WriteQueuePort.splitFields not implemented');
};

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
WriteQueuePort.prototype.isLocked = function isLocked(_userId) {
  throw new Error('WriteQueuePort.isLocked not implemented');
};

/**
 * @param {string} userId
 * @param {string} taskId
 * @param {string} operation
 * @param {object} fields
 * @param {string} [source]
 * @returns {Promise<void>}
 */
WriteQueuePort.prototype.enqueueWrite = function enqueueWrite(_userId, _taskId, _operation, _fields, _source) {
  throw new Error('WriteQueuePort.enqueueWrite not implemented');
};

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
WriteQueuePort.prototype.flushQueue = function flushQueue(_userId) {
  throw new Error('WriteQueuePort.flushQueue not implemented');
};

/**
 * @param {string} userId
 * @returns {Promise<void>}
 */
WriteQueuePort.prototype.flushQueueInLock = function flushQueueInLock(_userId) {
  throw new Error('WriteQueuePort.flushQueueInLock not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy WriteQueuePort.
 * @type {ReadonlyArray<string>}
 */
var WRITE_QUEUE_PORT_METHODS = Object.freeze([
  'splitFields',
  'isLocked',
  'enqueueWrite',
  'flushQueue',
  'flushQueueInLock',
  'NON_SCHEDULING_FIELDS'
]);

module.exports = WriteQueuePort;
module.exports.WriteQueuePort = WriteQueuePort;
module.exports.WRITE_QUEUE_PORT_METHODS = WRITE_QUEUE_PORT_METHODS;
