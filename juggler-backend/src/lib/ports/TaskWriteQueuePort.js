/**
 * TaskWriteQueuePort — driven-port contract for the durable task-write queue
 * (999.1535 — lib/task-write-queue.js).
 *
 * Mirrors the GcalApiPort/AppleCalApiPort/MsftCalApiPort idiom: a JSDoc
 * `@typedef`, a throw-not-implemented prototype base, and a frozen METHODS
 * array.
 *
 * Wraps `src/lib/task-write-queue.js` — the per-user durable queue for
 * scheduling-relevant task writes, consumed by mutation endpoints when the
 * sync lock is held — so it exposes EXACTLY that function surface:
 * `isLocked` / `enqueueWrite` / `flushQueue` / `flushQueueInLock` /
 * `splitFields`.
 *
 * NOTE: `NON_SCHEDULING_FIELDS` is a Set constant (not a function) and is
 * deliberately excluded from the port METHODS array — it has no
 * "not implemented" contract to satisfy. The same exclusion pattern as
 * AppleCalApiPort excluding DEFAULT_SERVER_URL.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT TWQ-1 (coalescing): queue entries are coalesced per task_id,
 *   preserving order within each group. Delete cancels prior create;
 *   create resets accumulated updates; update merges into whatever we have.
 *   Applied in a single transaction.
 *
 * INVARIANT TWQ-2 (field classification): non-scheduling fields (text,
 *   notes, project, section, gcal_event_id, msft_event_id, tz, updated_at)
 *   always write directly to the DB. Everything else is scheduling-relevant
 *   and queues when the lock is held.
 *
 * INVARIANT TWQ-3 (flush on lock release): pending writes are flushed BEFORE
 *   the lock releases (via flushQueueInLock called from sync-lock's withLock
 *   finally block) so the scheduler cannot grab the lock between release
 *   and flush.
 *
 * INVARIANT TWQ-4 (post-flush side effects): after a successful flush,
 *   invalidate the task cache, broadcast a tasks:changed SSE event (expanding
 *   recurring-family ids), and enqueue a schedule run.
 *
 * @typedef {Object} TaskWriteQueuePort
 *
 * @property {(userId: string) => Promise<boolean>} isLocked
 *   Fast check: is the per-user sync lock currently held? PK lookup.
 *
 * @property {(userId: string, taskId: string, operation: string, fields: Object, source?: string) => Promise<void>} enqueueWrite
 *   Insert a pending write into the queue. Fields must be a pre-converted DB
 *   row fragment (timezone conversion done BEFORE calling).
 *
 * @property {(userId: string) => Promise<boolean>} flushQueue
 *   Flush all pending writes for a user. Acquires the lock first. Returns
 *   true if flushed (or nothing to flush), false if lock couldn't be acquired.
 *
 * @property {(userId: string) => Promise<void>} flushQueueInLock
 *   Flush pending writes when the caller already holds the lock. Used by
 *   scheduler and cal-sync inside their lock callbacks (TWQ-3).
 *
 * @property {(row: Object) => {schedulingFields: Object, nonSchedulingFields: Object}} splitFields
 *   Split a DB row fragment into scheduling and non-scheduling fields (TWQ-2).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function TaskWriteQueuePort() {}

TaskWriteQueuePort.prototype.isLocked = function isLocked(_userId) {
  throw new Error('TaskWriteQueuePort.isLocked not implemented');
};

TaskWriteQueuePort.prototype.enqueueWrite = function enqueueWrite(_userId, _taskId, _operation, _fields, _source) {
  throw new Error('TaskWriteQueuePort.enqueueWrite not implemented');
};

TaskWriteQueuePort.prototype.flushQueue = function flushQueue(_userId) {
  throw new Error('TaskWriteQueuePort.flushQueue not implemented');
};

TaskWriteQueuePort.prototype.flushQueueInLock = function flushQueueInLock(_userId) {
  throw new Error('TaskWriteQueuePort.flushQueueInLock not implemented');
};

TaskWriteQueuePort.prototype.splitFields = function splitFields(_row) {
  throw new Error('TaskWriteQueuePort.splitFields not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy TaskWriteQueuePort.
 * @type {ReadonlyArray<string>}
 */
var TASK_WRITE_QUEUE_PORT_METHODS = Object.freeze([
  'isLocked',
  'enqueueWrite',
  'flushQueue',
  'flushQueueInLock',
  'splitFields'
]);

module.exports = TaskWriteQueuePort;
module.exports.TaskWriteQueuePort = TaskWriteQueuePort;
module.exports.TASK_WRITE_QUEUE_PORT_METHODS = TASK_WRITE_QUEUE_PORT_METHODS;