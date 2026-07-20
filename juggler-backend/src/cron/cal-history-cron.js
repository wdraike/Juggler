// Cal History Cron Job
// Daily sharded cron for auto-marking missed tasks and purging old cal_history entries

const crypto = require('crypto');
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
    // 999.1576 inc.4: who-cols are NOT NULL — the cron's actor context
    // attributes the lock row; takeover of an expired row re-attributes it.
    const actor = require('../lib/audit-context').getActor();
    await knex.raw(
      `INSERT INTO cron_locks (lock_name, locked_by, locked_at, expires_at, created_by, updated_by)
       VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?)
       ON DUPLICATE KEY UPDATE
         locked_by  = IF(expires_at < NOW(), VALUES(locked_by),  locked_by),
         locked_at  = IF(expires_at < NOW(), VALUES(locked_at),  locked_at),
         updated_by = IF(expires_at < NOW(), VALUES(updated_by), updated_by),
         expires_at = IF(expires_at < NOW(), VALUES(expires_at), expires_at)`,
      [lockName, INSTANCE_ID, ttl, actor, actor]
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

// markMissedTasks (and the MissedAutoMarkCron job that wrapped it) retired —
// sched-drop-overdue-column / M-5 (999.1085). Its ENTIRE purpose was writing
// task_instances.overdue, a column this leg drops (W4); its query/write both
// referenced that column exclusively. Retiring it also satisfies the standing
// D1 ruling's precondition (brain 101228/97166/101304: "delete the legacy
// 2h/24h isTaskMissed/shouldAutoMarkMissed after verifying no live caller") —
// this cron was that live caller; both legacy helpers are now deleted from
// shared/scheduler/missedHelpers.js. See SPEC.md "cal-history-cron.js /
// markMissedTasks — retire the write entirely" for the full rationale.

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

    // markMissedTasks retired (sched-drop-overdue-column / M-5) — see comment above.
    await purgeOldEntries();

    logger.info('cal-history cron job completed');
  } catch (error) {
    logger.error('Error in cal-history cron job:', error);
  }
}

module.exports = {
  runCalHistoryCron,
  purgeOldEntries,
  acquireLock,
  releaseLock
};

