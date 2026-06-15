// Cal History Cron Job
// Daily sharded cron for auto-marking missed tasks and purging old cal_history entries

const crypto = require('crypto');
const { TERMINAL_STATUSES } = require('../lib/task-status');
const { CalHistoryStatus } = require('../constants/status-enum');
const { shouldAutoMarkMissed } = require('../../../shared/scheduler/missedHelpers');
const dbModule = require('../lib/db');
const { createLogger } = require('../lib/logger');
const logger = createLogger('cron.cal-history');

// lib/db exports a module object — the live knex handle comes from getDefaultDb().
// (The previous `require('../lib/db')` used the object itself as `knex(...)`, which
// is NOT callable — every query threw "knex is not a function", so the cron never ran.
// jug-elected-sweeper-topology / 999.555.)
function getDb() {
  return dbModule.getDefaultDb();
}

// Stable per-process identity for lock ownership — distinct across Cloud Run instances.
const INSTANCE_ID = crypto.randomUUID();

/**
 * Leader election via the dedicated `cron_locks` table (999.555).
 *
 * ATOMIC: a single `INSERT … ON DUPLICATE KEY UPDATE` claims the lock, taking over
 * an existing row ONLY when it has expired (`expires_at < NOW()`). MySQL serializes
 * the unique-key (PRIMARY KEY lock_name) conflict, so two racing instances cannot
 * both win; the read-back by (lock_name, locked_by = this instance) confirms which
 * one actually holds it. Replaces the previous non-atomic read-then-update against
 * `sync_locks` — the per-user FK'd calendar-sync lock, which has no `name` column,
 * so the cron's acquire always threw and the job silently never ran.
 */
async function acquireLock(lockName, ttl = 3600) {
  const knex = getDb();
  try {
    await knex.raw(
      `INSERT INTO cron_locks (lock_name, locked_by, locked_at, expires_at)
       VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE
         locked_by  = IF(expires_at < NOW(), VALUES(locked_by),  locked_by),
         locked_at  = IF(expires_at < NOW(), VALUES(locked_at),  locked_at),
         expires_at = IF(expires_at < NOW(), VALUES(expires_at), expires_at)`,
      [lockName, INSTANCE_ID, ttl]
    );
    // We hold the lock only if our token owns a still-unexpired row.
    const held = await knex('cron_locks')
      .where('lock_name', lockName)
      .where('locked_by', INSTANCE_ID)
      .where('expires_at', '>', knex.raw('NOW()'))
      .first();
    return !!held;
  } catch (error) {
    logger.error(`Failed to acquire lock ${lockName}:`, error);
    return false;
  }
}

/** Release a held lock (best-effort) so a restarted instance need not wait out the TTL. */
async function releaseLock(lockName) {
  try {
    await getDb()('cron_locks')
      .where('lock_name', lockName)
      .where('locked_by', INSTANCE_ID)
      .del();
  } catch (error) {
    logger.warn(`Failed to release lock ${lockName}:`, error.message);
  }
}

// In-process single-flight guard (999.555 WARN): markMissedTasks is wired into BOTH
// CalHistoryCron and MissedAutoMarkCron (server.js), which fire in the SAME process with
// the SAME INSTANCE_ID. The cron_locks lock is a cross-INSTANCE mutex — it does NOT stop
// two same-process callers (each read-back matches its own INSTANCE_ID), so without this
// guard the boot double-run would write duplicate cal_history rows + double status writes.
// The check+set is synchronous (no await between), so it is atomic on the single JS thread.
let markMissedInFlight = false;

// Mark missed tasks automatically
async function markMissedTasks() {
  if (markMissedInFlight) {
    logger.info('Skipping markMissedTasks - already running in this process');
    return;
  }
  markMissedInFlight = true;
  const lockName = 'cal-history-cron:mark-missed';
  try {
    if (!await acquireLock(lockName)) {
      logger.info(`Skipping markMissedTasks - lock ${lockName} held by another process`);
      return;
    }
    try {
      const knex = getDb();
      const currentTime = new Date();
      logger.info('Starting missed tasks auto-mark process...');

      // Find tasks that should be marked as missed.
      // select task_instances.* explicitly: task_masters ALSO has `scheduled_at` and
      // `status` columns, so a bare SELECT * across the join clobbers the instance's
      // values with the master's (NULL scheduled_at) — which made shouldAutoMarkMissed
      // see scheduled_at=null and mark NOTHING. (999.555 — third latent cron bug.)
      const tasksToMark = await knex('task_instances')
        .join('task_masters', 'task_instances.master_id', 'task_masters.id')
        .whereNotNull('task_instances.scheduled_at')
        .whereNotIn('task_instances.status', TERMINAL_STATUSES)
        .where(knex.raw('task_instances.scheduled_at < ?', [new Date(currentTime.getTime() - 24 * 60 * 60 * 1000)]))
        .select('task_instances.*');

      let markedCount = 0;

      for (const task of tasksToMark) {
        if (shouldAutoMarkMissed(task, currentTime)) {
          await knex('task_instances')
            .where('id', task.id)
            .update({
              status: 'missed',
              completed_at: currentTime
            });

          // Add to cal_history
          await knex('cal_history').insert({
            task_id: task.id,
            user_id: task.user_id,
            scheduled_at: task.scheduled_at,
            completed_at: currentTime,
            status: CalHistoryStatus.MISSED,
            previous_status: task.status,
            status_reason: 'Auto-marked as missed after resolution window',
            created_by: 'system:cal-history-cron'
          });

          markedCount++;
        }
      }

      logger.info(`Marked ${markedCount} tasks as missed`);
    } catch (error) {
      logger.error('Error in markMissedTasks:', error);
    } finally {
      await releaseLock(lockName);
    }
  } finally {
    markMissedInFlight = false;
  }
}

// Purge old cal_history entries (>12 months)
async function purgeOldEntries() {
  const lockName = 'cal-history-cron:purge-old';
  
  if (!await acquireLock(lockName)) {
    logger.info(`Skipping purgeOldEntries - lock ${lockName} held by another process`);
    return;
  }
  
  try {
    const knex = getDb();
    logger.info('Starting cal_history purge process...');

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const result = await knex('cal_history')
      .where('created_at', '<', twelveMonthsAgo)
      .del();

    logger.info(`Purged ${result} old cal_history entries`);
  } catch (error) {
    logger.error('Error in purgeOldEntries:', error);
  } finally {
    await releaseLock(lockName);
  }
}

// Main cron function
async function runCalHistoryCron() {
  try {
    logger.info('Starting cal-history cron job...');
    
    // Process in shards for large user bases
    const userShards = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 
                       'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
    
    const currentShard = userShards[new Date().getDate() % userShards.length];
    logger.info(`Processing shard ${currentShard}`);
    
    await markMissedTasks();
    await purgeOldEntries();
    
    logger.info('cal-history cron job completed');
  } catch (error) {
    logger.error('Error in cal-history cron job:', error);
  }
}

module.exports = {
  runCalHistoryCron,
  markMissedTasks,
  purgeOldEntries,
  acquireLock,
  releaseLock
};

