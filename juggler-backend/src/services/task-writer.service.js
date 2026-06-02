/**
 * Task Writer Service — Backend writers guard for juggler-cal-history Phase C
 * 
 * Implements scheduled_at-required guard (D-05 from plan C):
 * - Block transitions to done/skip/cancel without scheduled_at
 * - Set completed_at timestamp on task completion
 * - Provide isTerminalStatus helper
 */

const db = require('../db');
const { isTerminalStatus } = require('../lib/task-status');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('task-writer');

// Terminal statuses that require scheduled_at (juggler-cal-history Plan C)
const TERMINAL_REQUIRES_SCHEDULE = ['done', 'skip', 'cancel'];

class TaskWriterService {
  /**
   * Guard function to check if a task can transition to a terminal status
   * 
   * @param {Object} task - The task object
   * @param {string} newStatus - The proposed new status
   * @param {Object} [options] - Optional parameters
   * @param {boolean} [options.allowUnscheduled] - Allow transition even without scheduled_at
   * @returns {Object} - Result with valid (boolean) and error (string|null)
   */
  static canTransitionToTerminal(task, newStatus, options = {}) {
    const { allowUnscheduled = false } = options;
    
    // If not a terminal status, allow the transition
    if (!isTerminalStatus(newStatus)) {
      return { valid: true, error: null };
    }
    
    // If explicitly allowed to bypass schedule check, allow the transition
    if (allowUnscheduled) {
      return { valid: true, error: null };
    }
    
    // Check if this terminal status requires scheduled_at
    if (TERMINAL_REQUIRES_SCHEDULE.indexOf(newStatus) === -1) {
      return { valid: true, error: null };
    }
    
    // Guard: cannot transition to terminal status without scheduled_at
    if (!task.scheduled_at) {
      return {
        valid: false,
        error: `Cannot mark task ${newStatus} without a scheduled time. Schedule it first.`,
        code: 'SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS'
      };
    }
    
    return { valid: true, error: null };
  }
  
  /**
   * Update task status with Phase C guards and automatic completed_at
   * 
   * @param {Object} trx - Knex transaction object
   * @param {string} taskId - Task ID
   * @param {string} newStatus - New status
   * @param {string} userId - User ID
   * @param {Object} [additionalUpdates] - Additional fields to update
   * @returns {Promise<Object>} - Updated task
   */
  static async updateTaskStatus(trx, taskId, newStatus, userId, additionalUpdates = {}) {
    // Get current task state
    const existingTask = await trx('task_instances')
      .where({ id: taskId, user_id: userId })
      .first();
    
    if (!existingTask) {
      throw new Error('Task not found');
    }
    
    // Apply Phase C guard: scheduled_at required for terminal transitions
    const guardResult = this.canTransitionToTerminal(existingTask, newStatus);
    if (!guardResult.valid) {
      const error = new Error(guardResult.error);
      error.code = guardResult.code;
      throw error;
    }
    
    // Build update object
    const update = {
      status: newStatus,
      updated_at: db.fn.now()
    };
    
    // Phase C: set completed_at on terminal transition (D-12)
    if (isTerminalStatus(newStatus) && !isTerminalStatus(existingTask.status)) {
      update.completed_at = db.fn.now();
    } else if (!isTerminalStatus(newStatus) && isTerminalStatus(existingTask.status)) {
      // Reopening a terminal task: clear completed_at
      update.completed_at = null;
    }
    
    // Merge additional updates
    Object.assign(update, additionalUpdates);
    
    // Execute update
    await trx('task_instances')
      .where({ id: taskId, user_id: userId })
      .update(update);
    
    // Return updated task
    return trx('task_instances')
      .where({ id: taskId, user_id: userId })
      .first();
  }
  
  /**
   * Create a cal_history entry for a terminal status transition
   * 
   * @param {Object} trx - Knex transaction object
   * @param {string} taskId - Task ID
   * @param {string} userId - User ID
   * @param {string} newStatus - New status
   * @param {string} previousStatus - Previous status
   * @param {string} [statusReason] - Reason for status change
   * @returns {Promise<Object>} - Created cal_history entry
   */
  static async createCalHistoryEntry(trx, taskId, userId, newStatus, previousStatus, statusReason = null) {
    const task = await trx('task_instances')
      .where({ id: taskId, user_id: userId })
      .first();
    
    if (!task) {
      throw new Error('Task not found for cal_history entry');
    }
    
    // Map task status to cal_history status
    const calHistoryStatusMap = {
      'done': 'COMPLETED',
      'cancel': 'CANCELLED',
      'skip': 'CANCELLED',
      'missed': 'MISSED'
    };
    
    const historyStatus = calHistoryStatusMap[newStatus] || 'COMPLETED';
    
    const entry = {
      task_id: taskId,
      user_id: userId,
      scheduled_at: task.scheduled_at,
      completed_at: task.completed_at || new Date(),
      status: historyStatus,
      previous_status: previousStatus,
      status_reason: statusReason || `User marked task as ${newStatus}`,
      created_by: 'system:task-writer',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    };
    
    const [createdEntry] = await trx('cal_history')
      .insert(entry)
      .returning('*');
    
    return createdEntry;
  }
  
  /**
   * Complete task transition with guards, completed_at, and cal_history entry
   * 
   * @param {Object} trx - Knex transaction object
   * @param {string} taskId - Task ID
   * @param {string} newStatus - New status
   * @param {string} userId - User ID
   * @param {Object} [options] - Additional options
   * @returns {Promise<Object>} - Result with updated task and cal_history entry
   */
  static async completeTaskTransition(trx, taskId, newStatus, userId, options = {}) {
    const result = {};
    
    // Update task status
    result.updatedTask = await this.updateTaskStatus(trx, taskId, newStatus, userId, options.additionalUpdates);
    
    // Create cal_history entry for terminal transitions
    if (isTerminalStatus(newStatus)) {
      const taskBefore = await trx('task_instances')
        .where({ id: taskId, user_id: userId })
        .first();
      
      result.calHistoryEntry = await this.createCalHistoryEntry(
        trx,
        taskId,
        userId,
        newStatus,
        taskBefore.status,
        options.statusReason
      );
    }
    
    return result;
  }
}

module.exports = TaskWriterService;