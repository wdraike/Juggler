/**
 * ScheduleQueuePort — driven-port contract for the `schedule_queue` /
 * `task_write_queue` / `tasks_v` reads+writes behind the legacy
 * `src/scheduler/scheduleQueue.js` DB-backed event queue + poll loop
 * (JUG-SCHEDULER-LEGACY-DB-BYPASS / 999.1532).
 *
 * `scheduleQueue.js` claims/enqueues/dequeues/heartbeats/sweeps rows on the
 * BASE connection — never inside a scheduler transaction (atomic single-row
 * UPDATEs ARE the concurrency primitive; see the file's own claiming doc
 * comment on why a full transaction is not used here). Every method
 * therefore takes the caller's `db` handle explicitly as its first argument
 * (the same calling convention as `TaskProviderPort`), rather than binding a
 * `db` at construction time — the concrete adapter is a stateless singleton,
 * constructed once at module load like `SchedulerTaskProvider`.
 *
 * A queue row's claim/heartbeat/release/sweep lifecycle is a DISTINCT
 * aggregate from the scheduler's task-placement writes
 * (`ScheduleRepositoryPort`) and the task read model (`TaskProviderPort`) —
 * hence its own port rather than folding into either.
 *
 * Contract only — JSDoc `@typedef` + throw-not-implemented base, mirroring
 * `TaskProviderPort` / `ScheduleRepositoryPort`.
 *
 * @typedef {Object} ScheduleQueuePort
 *
 * @property {(db: Function, row: {user_id: string, source: string, created_at: Date}) => Promise<void>} upsertQueueRow
 *   Insert-or-merge the per-user queue row: `INSERT … ON DUPLICATE KEY
 *   UPDATE (source, created_at)` (verbatim — `scheduleQueue.js`
 *   `enqueueScheduleRun` ~192-195 `.onConflict('user_id').merge([...])`).
 *
 * @property {(db: Function, userId: string) => Promise<number>} deleteQueueRow
 *   Delete the queue row for `userId` (verbatim — `dequeueScheduleRun`
 *   ~252-254). Returns rows removed.
 *
 * @property {(db: Function, userId: string, instanceId: string, claimedAt: Date, ttlExpiry: Date) => Promise<number>} claimQueueRow
 *   Atomically claim `userId`'s row for `instanceId` — either unclaimed
 *   (`claimed_by IS NULL`) or an expired claim (`claimed_at < ttlExpiry`)
 *   (verbatim — `tryClaim` ~280-289). Returns rows updated (0 or 1).
 *
 * @property {(db: Function, userId: string) => Promise<Object|undefined>} getQueueRowByUser
 *   Read the queue row for `userId` (verbatim — `tryClaim`'s post-claim
 *   read-back ~300 AND its failed-claim existing-owner check ~292; the SAME
 *   query text serves both call sites).
 *
 * @property {(db: Function, userId: string, instanceId: string, claimedAt: Date) => Promise<number>} heartbeatClaim
 *   Refresh `claimed_at` for the row `userId`/`instanceId` currently owns
 *   (verbatim — `startClaimHeartbeat` ~420-423). Returns rows updated.
 *
 * @property {(db: Function, userId: string, instanceId: string) => Promise<number>} releaseQueueClaim
 *   Clear `claimed_by`/`claimed_at` for the row `userId`/`instanceId` owns
 *   (verbatim — `releaseClaim` ~443-446). Returns rows updated.
 *
 * @property {(db: Function, limit: number) => Promise<Array<{user_id: string}>>} getPendingQueueUsers
 *   Unclaimed rows older than the 2s anti-race window, oldest first, capped
 *   at `limit` (verbatim — `pollOnce`'s primary poll query ~460-465).
 *
 * @property {(db: Function) => Promise<Array<{c: number}>>} countPendingQueue
 *   Count of unclaimed rows older than the 2s anti-race window — the SAME
 *   WHERE clause as `getPendingQueueUsers`, count-shaped (verbatim —
 *   `pollOnce`'s `schedPending` idle-path diagnostic ~488).
 *
 * @property {(db: Function) => Promise<Array<{c: number}>>} countPendingWrites
 *   Count of pending `task_write_queue` rows (verbatim — `pollOnce`'s
 *   `writePending` diagnostic ~489).
 *
 * @property {(db: Function) => Promise<Array<{user_id: string}>>} countDistinctPendingUsers
 *   Distinct `user_id`s present in `tasks_v` (verbatim — `pollOnce`'s
 *   `total` diagnostic ~490). Despite the name this SELECTs distinct rows,
 *   not a COUNT(*) — kept verbatim to match the legacy query shape (the
 *   caller reads `total.length`).
 *
 * @property {(db: Function) => Promise<number>} sweepStuckClaims
 *   Clear claims older than 120s (dead-instance recovery) (verbatim —
 *   `pollOnce`'s stuck-claim sweep ~496-499). Returns rows updated.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function ScheduleQueuePort() {}

ScheduleQueuePort.prototype.upsertQueueRow = function upsertQueueRow(_db, _row) {
  throw new Error('ScheduleQueuePort.upsertQueueRow not implemented');
};

ScheduleQueuePort.prototype.deleteQueueRow = function deleteQueueRow(_db, _userId) {
  throw new Error('ScheduleQueuePort.deleteQueueRow not implemented');
};

ScheduleQueuePort.prototype.claimQueueRow = function claimQueueRow(_db, _userId, _instanceId, _claimedAt, _ttlExpiry) {
  throw new Error('ScheduleQueuePort.claimQueueRow not implemented');
};

ScheduleQueuePort.prototype.getQueueRowByUser = function getQueueRowByUser(_db, _userId) {
  throw new Error('ScheduleQueuePort.getQueueRowByUser not implemented');
};

ScheduleQueuePort.prototype.heartbeatClaim = function heartbeatClaim(_db, _userId, _instanceId, _claimedAt) {
  throw new Error('ScheduleQueuePort.heartbeatClaim not implemented');
};

ScheduleQueuePort.prototype.releaseQueueClaim = function releaseQueueClaim(_db, _userId, _instanceId) {
  throw new Error('ScheduleQueuePort.releaseQueueClaim not implemented');
};

ScheduleQueuePort.prototype.getPendingQueueUsers = function getPendingQueueUsers(_db, _limit) {
  throw new Error('ScheduleQueuePort.getPendingQueueUsers not implemented');
};

ScheduleQueuePort.prototype.countPendingQueue = function countPendingQueue(_db) {
  throw new Error('ScheduleQueuePort.countPendingQueue not implemented');
};

ScheduleQueuePort.prototype.countPendingWrites = function countPendingWrites(_db) {
  throw new Error('ScheduleQueuePort.countPendingWrites not implemented');
};

ScheduleQueuePort.prototype.countDistinctPendingUsers = function countDistinctPendingUsers(_db) {
  throw new Error('ScheduleQueuePort.countDistinctPendingUsers not implemented');
};

ScheduleQueuePort.prototype.sweepStuckClaims = function sweepStuckClaims(_db) {
  throw new Error('ScheduleQueuePort.sweepStuckClaims not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy ScheduleQueuePort.
 * @type {ReadonlyArray<string>}
 */
var SCHEDULE_QUEUE_PORT_METHODS = Object.freeze([
  'upsertQueueRow',
  'deleteQueueRow',
  'claimQueueRow',
  'getQueueRowByUser',
  'heartbeatClaim',
  'releaseQueueClaim',
  'getPendingQueueUsers',
  'countPendingQueue',
  'countPendingWrites',
  'countDistinctPendingUsers',
  'sweepStuckClaims'
]);

module.exports = ScheduleQueuePort;
module.exports.ScheduleQueuePort = ScheduleQueuePort;
module.exports.SCHEDULE_QUEUE_PORT_METHODS = SCHEDULE_QUEUE_PORT_METHODS;
