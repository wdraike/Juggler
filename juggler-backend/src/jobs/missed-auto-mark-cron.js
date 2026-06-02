/**
 * Missed Auto-Mark Cron Job - Phase D
 * 
 * Sharded daily cron for auto-marking missed tasks with leader election.
 * Follows the sync-lock pattern from lib/sync-lock.js
 */

const knex = require('../db');
const { createLogger } = require('../lib/logger');
const logger = createLogger('missedAutoMarkCron');
const { CalHistoryStatus } = require('../constants/status-enum');

class MissedAutoMarkCron {
  constructor() {
    this.cronInterval = null;
    this.shardId = process.env.CRON_SHARD_ID || '0';
    this.totalShards = process.env.CRON_TOTAL_SHARDS ? parseInt(process.env.CRON_TOTAL_SHARDS) : 1;
    this.batchSize = process.env.CRON_BATCH_SIZE ? parseInt(process.env.CRON_BATCH_SIZE) : 100;
    this.resolutionWindowHours = 24; // 24 hours resolution window
    this.isRunning = false;
    this.leaderLockName = 'missed_auto_mark_cron_leader';
    this.lockDurationMinutes = 60; // 1 hour lock duration
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
            logger.error('MissedAutoMarkCron: Error in daily operations', { error: error.message });
          } finally {
            this.isRunning = false;
          }
        }
      }
    }, 60000); // Check every minute

    logger.info('MissedAutoMarkCron: Started daily cron job using setInterval', {
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
      logger.info('MissedAutoMarkCron: Stopped daily cron job');
    }
  }

  /**
   * Run daily operations: auto-mark missed tasks
   */
  async runDailyOperations() {
    logger.info('MissedAutoMarkCron: Starting daily operations');
    
    // Acquire leader lock for this operation
    const isLeader = await this.acquireLock();
    
    if (!isLeader) {
      logger.info('MissedAutoMarkCron: Not leader, skipping daily operations');
      return;
    }
    
    try {
      // Auto-mark missed tasks
      await this.autoMarkMissedTasks();
      
      logger.info('MissedAutoMarkCron: Daily operations completed');
    } finally {
      // Always release the lock when done
      await this.releaseLock();
    }
  }

  /**
   * Auto-mark missed tasks
   */
  async autoMarkMissedTasks() {
    logger.info('MissedAutoMarkCron: Starting auto-mark missed tasks');
    
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
      logger.info('MissedAutoMarkCron: No tasks to mark as missed (shard filter)');
      return;
    }
    
    logger.info(`MissedAutoMarkCron: Found ${shardedTasks.length} tasks to mark as missed (${tasksToMark.length} total, ${shardedTasks.length} in shard)`);
    
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
            created_by: 'system:missed-auto-mark-cron',
            created_at: currentTime,
            updated_at: currentTime
          });
        });
      } catch (error) {
        logger.error('MissedAutoMarkCron: Error marking task as missed', {
          taskId: task.id,
          error: error.message
        });
      }
    }
    
    logger.info('MissedAutoMarkCron: Completed auto-mark missed tasks');
  }

  /**
   * Leader election using sync_locks pattern
   * @returns {boolean} True if this instance is the leader
   */
  async acquireLock() {
    const currentTime = new Date();
    const expiresAt = new Date(currentTime.getTime() + (this.lockDurationMinutes * 60 * 1000));
    const instanceId = `${require('os').hostname()}:${process.pid}:${this.shardId}`;
    
    try {
      // Try to insert a new lock
      const result = await knex('sync_locks').insert({
        lock_name: this.leaderLockName,
        locked_by: instanceId,
        locked_at: currentTime,
        expires_at: expiresAt
      }).onConflict('lock_name')
      .merge();
      
      // Check if we successfully acquired the lock
      const lock = await knex('sync_locks').where('lock_name', this.leaderLockName).first();
      
      if (lock && lock.locked_by === instanceId) {
        logger.info('MissedAutoMarkCron: Successfully acquired leader lock', {
          lockName: this.leaderLockName,
          instanceId
        });
        return true;
      }
      
      // Check if existing lock is expired
      if (lock && new Date(lock.expires_at) < currentTime) {
        // Try to steal the expired lock
        const stolen = await knex('sync_locks')
          .where('lock_name', this.leaderLockName)
          .where('expires_at', '<', currentTime)
          .update({
            locked_by: instanceId,
            locked_at: currentTime,
            expires_at: expiresAt
          });
          
        if (stolen > 0) {
          logger.info('MissedAutoMarkCron: Stole expired leader lock', {
            lockName: this.leaderLockName,
            instanceId
          });
          return true;
        }
      }
      
      logger.info('MissedAutoMarkCron: Failed to acquire leader lock - another instance is leader', {
        lockName: this.leaderLockName,
        currentLeader: lock ? lock.locked_by : 'none'
      });
      return false;
      
    } catch (error) {
      logger.error('MissedAutoMarkCron: Error during leader election', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Release leader lock
   */
  async releaseLock() {
    const instanceId = `${require('os').hostname()}:${process.pid}:${this.shardId}`;
    
    try {
      const result = await knex('sync_locks')
        .where('lock_name', this.leaderLockName)
        .where('locked_by', instanceId)
        .del();
      
      if (result > 0) {
        logger.info('MissedAutoMarkCron: Released leader lock', {
          lockName: this.leaderLockName,
          instanceId
        });
      }
    } catch (error) {
      logger.error('MissedAutoMarkCron: Error releasing leader lock', {
        error: error.message
      });
    }
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

module.exports = MissedAutoMarkCron;