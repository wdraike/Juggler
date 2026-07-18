/**
 * SchedulerQueueRepository — concrete ScheduleQueuePort
 * (SCHEDULE_QUEUE_PORT_METHODS). JUG-SCHEDULER-LEGACY-DB-BYPASS (999.1532).
 *
 * Every query is a VERBATIM relocation of what `src/scheduler/scheduleQueue.js`
 * ran inline — no behavior change. The module never runs inside a scheduler
 * transaction (atomic single-row UPDATEs are the concurrency primitive), so
 * every method takes the caller's `db` handle explicitly as its first
 * argument, matching `SchedulerTaskProvider`'s calling convention. Stateless
 * singleton — no constructor deps needed.
 */

'use strict';

var SCHEDULE_QUEUE_PORT_METHODS =
  require('../domain/ports/ScheduleQueuePort').SCHEDULE_QUEUE_PORT_METHODS;
var { stampInsert, stampUpdate } = require('../../../lib/audit-context'); // 999.1576 inc.3b.2

function SchedulerQueueRepository() {}

/**
 * Insert-or-merge the per-user queue row (verbatim — scheduleQueue.js
 * `enqueueScheduleRun` ~192-195).
 */
SchedulerQueueRepository.prototype.upsertQueueRow = function upsertQueueRow(db, row) {
  return db('schedule_queue')
    .insert(stampInsert(row))
    .onConflict('user_id')
    .merge(['source', 'created_at']);
};

/**
 * Delete the queue row for userId (verbatim — `dequeueScheduleRun` ~252-254).
 */
SchedulerQueueRepository.prototype.deleteQueueRow = function deleteQueueRow(db, userId) {
  return db('schedule_queue')
    .where('user_id', userId)
    .del();
};

/**
 * Atomically claim userId's row for instanceId (verbatim — `tryClaim`
 * ~280-289).
 */
SchedulerQueueRepository.prototype.claimQueueRow = function claimQueueRow(db, userId, instanceId, claimedAt, ttlExpiry) {
  return db('schedule_queue')
    .where('user_id', userId)
    .andWhere(function() {
      this.whereNull('claimed_by')
          .orWhere('claimed_at', '<', ttlExpiry);
    })
    .update(stampUpdate({
      claimed_by: instanceId,
      claimed_at: claimedAt
    }));
};

/**
 * Read the queue row for userId (verbatim — `tryClaim`'s post-claim
 * read-back ~300 and its failed-claim existing-owner check ~292; the SAME
 * query text serves both call sites).
 */
SchedulerQueueRepository.prototype.getQueueRowByUser = function getQueueRowByUser(db, userId) {
  return db('schedule_queue').where('user_id', userId).first();
};

/**
 * Refresh claimed_at for the row userId/instanceId currently owns
 * (verbatim — `startClaimHeartbeat` ~420-423).
 */
SchedulerQueueRepository.prototype.heartbeatClaim = function heartbeatClaim(db, userId, instanceId, claimedAt) {
  return db('schedule_queue')
    .where('user_id', userId)
    .where('claimed_by', instanceId)
    .update(stampUpdate({ claimed_at: claimedAt }));
};

/**
 * Clear claimed_by/claimed_at for the row userId/instanceId owns
 * (verbatim — `releaseClaim` ~443-446).
 */
SchedulerQueueRepository.prototype.releaseQueueClaim = function releaseQueueClaim(db, userId, instanceId) {
  return db('schedule_queue')
    .where('user_id', userId)
    .where('claimed_by', instanceId)
    .update(stampUpdate({ claimed_by: null, claimed_at: null }));
};

/**
 * Unclaimed rows older than the 2s anti-race window, oldest first, capped at
 * limit (verbatim — `pollOnce`'s primary poll query ~460-465).
 */
SchedulerQueueRepository.prototype.getPendingQueueUsers = function getPendingQueueUsers(db, limit) {
  return db('schedule_queue')
    .whereNull('claimed_at')
    .where('created_at', '<', db.raw('NOW() - INTERVAL 2 SECOND'))
    .orderBy('created_at', 'asc')
    .limit(limit)
    .select('user_id');
};

/**
 * Count of unclaimed rows older than the 2s anti-race window — the SAME
 * WHERE as getPendingQueueUsers, count-shaped (verbatim — `pollOnce`'s
 * `schedPending` idle-path diagnostic ~488).
 */
SchedulerQueueRepository.prototype.countPendingQueue = function countPendingQueue(db) {
  return db('schedule_queue')
    .whereNull('claimed_at')
    .where('created_at', '<', db.raw('NOW() - INTERVAL 2 SECOND'))
    .count('* as c');
};

/**
 * Count of pending task_write_queue rows (verbatim — `pollOnce`'s
 * `writePending` diagnostic ~489).
 */
SchedulerQueueRepository.prototype.countPendingWrites = function countPendingWrites(db) {
  return db('task_write_queue').count('* as c');
};

/**
 * Distinct user_ids present in tasks_v (verbatim — `pollOnce`'s `total`
 * diagnostic ~490).
 */
SchedulerQueueRepository.prototype.countDistinctPendingUsers = function countDistinctPendingUsers(db) {
  return db('tasks_v').distinct('user_id');
};

/**
 * Clear claims older than 120s — dead-instance recovery (verbatim —
 * `pollOnce`'s stuck-claim sweep ~496-499).
 */
SchedulerQueueRepository.prototype.sweepStuckClaims = function sweepStuckClaims(db) {
  return db('schedule_queue')
    .whereNotNull('claimed_by')
    .whereRaw('claimed_at < DATE_SUB(NOW(), INTERVAL 120 SECOND)')
    .update(stampUpdate({ claimed_by: null, claimed_at: null }));
};

module.exports = SchedulerQueueRepository;
module.exports.SchedulerQueueRepository = SchedulerQueueRepository;
module.exports.SCHEDULE_QUEUE_PORT_METHODS = SCHEDULE_QUEUE_PORT_METHODS;
