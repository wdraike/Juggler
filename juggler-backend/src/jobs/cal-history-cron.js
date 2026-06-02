const knex = require('../db');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('calHistoryCron');
const { CalHistoryStatus, isValidCalHistoryStatus } = require('../constants/status-enum');
const { shouldMarkAsMissed, getCalHistoryStatus } = require('../shared/scheduler/missedHelpers');

// Sharded daily cron job for calendar history operations
class CalHistoryCron {
  constructor() {
    this.cronInterval = null;
    this.shardId = process.env.CRON_SHARD_ID || '0';
    this.totalShards = process.env.CRON_TOTAL_SHARDS ? parseInt(process.env.CRON_TOTAL_SHARDS) : 1;
    this.batchSize = process.env.CRON_BATCH_SIZE ? parseInt(process.env.CRON_BATCH_SIZE) : 100;
    this.resolutionWindowHours = 24; // 24 hours resolution window
    this.isRunning = false;
  }

  /**
   * Start the cron job using setInterval
   */
  start() {
    // Run daily at 3:15 AM using setInterval
    this.cronInterval = setInterval(async () => {
      const now = new Date();
      const targetHour = 3;
      const targetMinute = 15;
      
      // Check if current time matches target time (3:15 AM)
      if (now.getHours() === targetHour && now.getMinutes() === targetMinute) {
        if (!this.isRunning) {
          this.isRunning = true;
          try {
            await this.runDailyOperations();
          } catch (error) {
            logger.error('CalHistoryCron: Error in daily operations', { error: error.message });
          } finally {
            this.isRunning = false;
          }
        }
      }
    }, 60000); // Check every minute

    logger.info('CalHistoryCron: Started daily cron job using setInterval', {
      shard: this.shardId,
      totalShards: this.totalShards
    });
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronInterval) {
      clearInterval(this.cronInterval);
      logger.info('CalHistoryCron: Stopped daily cron job');
    }
  }

  /**
   * Run daily operations: auto-mark missed tasks and purge old entries
   */
  async runDailyOperations() {
    logger.info('CalHistoryCron: Starting daily operations');
    
    // Acquire leader lock for this operation
    const isLeader = await this.acquireLock();
    
    if (!isLeader) {
      logger.info('CalHistoryCron: Not leader, skipping daily operations');
      return;
    }
    
    try {
      // Auto-mark missed tasks
      await this.autoMarkMissedTasks();
      
      // Purge old cal_history entries (>12 months)
      await this.purgeOldEntries();
      
      logger.info('CalHistoryCron: Daily operations completed');
    } finally {
      // Always release the lock when done
      await this.releaseLock();
    }
  }

  /**
   * Auto-mark missed tasks
   */
  async autoMarkMissedTasks() {
    logger.info('CalHistoryCron: Starting auto-mark missed tasks');
    
    const currentTime = new Date();
    const resolutionDeadline = new Date(currentTime.getTime() - (this.resolutionWindowHours * 60 * 60 * 1000));
    
    // Find tasks that should be marked as missed, filtered by shard
    const tasksToMark = await knex('task_instances')
      .select('id', 'user_id', 'scheduled_at', 'status', 'updated_at')
      .where('status', 'not in', ['done', 'cancel', 'skip', 'pause', 'missed'])
      .where('scheduled_at', '<=', resolutionDeadline)
      .limit(this.batchSize);
    
    // Filter tasks by shard
    const shardedTasks = tasksToMark.filter(task => this.shouldProcessUser(task.user_id));
    
    if (shardedTasks.length === 0) {
      logger.info('CalHistoryCron: No tasks to mark as missed (shard filter)');
      return;
    }
    
    logger.info(`CalHistoryCron: Found ${shardedTasks.length} tasks to mark as missed (${tasksToMark.length} total, ${shardedTasks.length} in shard)`);
    
    // Process tasks in batches
    for (const task of shardedTasks) {
      try {
        await knex.transaction(async (trx) => {
          // Update task status to missed
          const updateData = {
            status: 'missed',
            updated_at: knex.fn.now()
          };
          
          await trx('task_instances')
            .where('id', task.id)
            .update(updateData);
          
          // Create cal_history entry
          await trx('cal_history').insert({
            task_id: task.id,
            user_id: task.user_id,
            scheduled_at: task.scheduled_at,
            completed_at: currentTime,
            status: CalHistoryStatus.MISSED,
            previous_status: task.status,
            status_reason: 'Auto-marked as missed by cron job',
            created_by: 'system:cal-history-cron',
            created_at: currentTime,
            updated_at: currentTime
          });
        });
      } catch (error) {
        logger.error('CalHistoryCron: Error marking task as missed', {
          taskId: task.id,
          error: error.message
        });
      }
    }
    
    logger.info('CalHistoryCron: Completed auto-mark missed tasks');
  }

  /**
   * Purge old cal_history entries (>12 months)
   */
  async purgeOldEntries() {
    logger.info('CalHistoryCron: Starting purge of old entries');
    
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 12); // 12 months ago
    
    const result = await knex('cal_history')
      .where('created_at', '<', cutoffDate)
      .del();
    
    logger.info(`CalHistoryCron: Purged ${result} old cal_history entries`);
  }

  /**
   * Leader election using sync_locks pattern
   * @returns {boolean} True if this instance is the leader
   */
  async acquireLock() {
    const lockName = 'cal_history_cron_leader';
    const lockDurationMinutes = 60; // 1 hour lock duration
    const currentTime = new Date();
    const expiresAt = new Date(currentTime.getTime() + (lockDurationMinutes * 60 * 1000));
    const instanceId = `${require('os').hostname()}:${process.pid}:${this.shardId}`;
    
    try {
      // Try to insert a new lock
      const result = await knex('sync_locks').insert({
        lock_name: lockName,
        locked_by: instanceId,
        locked_at: currentTime,
        expires_at: expiresAt
      }).onConflict('lock_name')
      .merge();
      
      // Check if we successfully acquired the lock
      const lock = await knex('sync_locks').where('lock_name', lockName).first();
      
      if (lock && lock.locked_by === instanceId) {
        logger.info('CalHistoryCron: Successfully acquired leader lock', {
          lockName,
          instanceId
        });
        return true;
      }
      
      // Check if existing lock is expired
      if (lock && new Date(lock.expires_at) < currentTime) {
        // Try to steal the expired lock
        const stolen = await knex('sync_locks')
          .where('lock_name', lockName)
          .where('expires_at', '<', currentTime)
          .update({
            locked_by: instanceId,
            locked_at: currentTime,
            expires_at: expiresAt
          });
          
        if (stolen > 0) {
          logger.info('CalHistoryCron: Stole expired leader lock', {
            lockName,
            instanceId
          });
          return true;
        }
      }
      
      logger.info('CalHistoryCron: Failed to acquire leader lock - another instance is leader', {
        lockName,
        currentLeader: lock ? lock.locked_by : 'none'
      });
      return false;
      
    } catch (error) {
      logger.error('CalHistoryCron: Error during leader election', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Release leader lock
   */
  async releaseLock() {
    const lockName = 'cal_history_cron_leader';
    const instanceId = `${require('os').hostname()}:${process.pid}:${this.shardId}`;
    
    try {
      const result = await knex('sync_locks')
        .where('lock_name', lockName)
        .where('locked_by', instanceId)
        .del();
      
      if (result > 0) {
        logger.info('CalHistoryCron: Released leader lock', {
          lockName,
          instanceId
        });
      }
    } catch (error) {
      logger.error('CalHistoryCron: Error releasing leader lock', {
        error: error.message
      });
    }
  }

  /**
   * Get shard range for this instance
   * @returns {Object} { start, end } user_id range
   */
  getShardRange() {
    // For user_id sharding, we'll use a hash-based approach
    // This allows for consistent sharding even with arbitrary user IDs
    const shardId = parseInt(this.shardId) || 0;
    
    return {
      shardId,
      totalShards: this.totalShards
    };
  }

  /**
   * Get user ID hash for sharding
   * @param {string} userId - User ID
   * @returns {number} Shard index for this user
   */
  getUserShard(userId) {
    // Simple hash function to determine shard
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash << 5) - hash + userId.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash) % this.totalShards;
  }

  /**
   * Check if this instance should process a user based on shard
   * @param {string} userId - User ID
   * @returns {boolean} True if this instance should process the user
   */
  shouldProcessUser(userId) {
    const userShard = this.getUserShard(userId);
    const myShardId = parseInt(this.shardId) || 0;
    return userShard === myShardId;
  }
}

module.exports = CalHistoryCron;