// Cal History Cron Job
// Daily sharded cron for auto-marking missed tasks and purging old cal_history entries

const { TERMINAL_STATUSES } = require('../lib/task-status');
const { CalHistoryStatus } = require('../constants/status-enum');
const { shouldAutoMarkMissed } = require('../../../shared/scheduler/missedHelpers');
const knex = require('../lib/db');
const { createLogger } = require('../lib/logger');
const logger = createLogger('cron.cal-history');

// Leader election using sync_locks pattern
async function acquireLock(lockName, ttl = 3600) {
  try {
    const result = await knex('sync_locks')
      .where('name', lockName)
      .first();
    
    const now = new Date();
    
    if (result) {
      // Lock exists - check if it's expired
      const expiresAt = new Date(result.expires_at);
      if (now > expiresAt) {
        // Lock expired - take it
        await knex('sync_locks')
          .where('name', lockName)
          .update({
            expires_at: new Date(now.getTime() + ttl * 1000),
            acquired_at: now
          });
        return true;
      } else {
        // Lock still active
        return false;
      }
    } else {
      // No lock - create it
      await knex('sync_locks').insert({
        name: lockName,
        expires_at: new Date(now.getTime() + ttl * 1000),
        acquired_at: now
      });
      return true;
    }
  } catch (error) {
    logger.error(`Failed to acquire lock ${lockName}:`, error);
    return false;
  }
}

// Mark missed tasks automatically
async function markMissedTasks() {
  const lockName = 'cal-history-cron:mark-missed';
  
  if (!await acquireLock(lockName)) {
    logger.info(`Skipping markMissedTasks - lock ${lockName} held by another process`);
    return;
  }
  
  try {
    const currentTime = new Date();
    logger.info('Starting missed tasks auto-mark process...');
    
    // Find tasks that should be marked as missed
    const tasksToMark = await knex('task_instances')
      .join('task_masters', 'task_instances.master_id', 'task_masters.id')
      .whereNotNull('task_instances.scheduled_at')
      .whereNotIn('task_instances.status', TERMINAL_STATUSES)
      .where(knex.raw('task_instances.scheduled_at < ?', [new Date(currentTime.getTime() - 24 * 60 * 60 * 1000)]));
    
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
    logger.info('Starting cal_history purge process...');
    
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const result = await knex('cal_history')
      .where('created_at', '<', twelveMonthsAgo)
      .del();
    
    logger.info(`Purged ${result} old cal_history entries`);
  } catch (error) {
    logger.error('Error in purgeOldEntries:', error);
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
  purgeOldEntries
};

