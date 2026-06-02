/**
 * Task Status Writer - Guards against invalid terminal status transitions
 * 
 * This module provides functions for safely updating task statuses while
 * preventing transitions from terminal states.
 */

const { canTransition } = require('../lib/task-status');

/**
 * Writes a new status for a task, guarding against invalid transitions.
 * 
 * @param {Object} db - Database connection
 * @param {string} taskId - The ID of the task to update
 * @param {string} newStatus - The new status to set
 * @param {string} reason - Reason for the status change (for audit trail)
 * @returns {Promise<Object>} Result of the status update operation
 * @throws {Error} If the transition is invalid or database operation fails
 */
async function writeTaskStatus(db, taskId, newStatus, reason) {
  // First, get the current status of the task
  const currentTask = await db('tasks')
    .where({ id: taskId })
    .first('status')
    .catch(err => {
      throw new Error(`Failed to fetch current task status: ${err.message}`);
    });

  if (!currentTask) {
    throw new Error(`Task with ID ${taskId} not found`);
  }

  const currentStatus = currentTask.status;

  // Check if the transition is valid
  if (!canTransition(currentStatus, newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} -> ${newStatus}. ` +
      `Task is in terminal state or transition is not allowed.`
    );
  }

  // Perform the status update
  const result = await db('tasks')
    .where({ id: taskId })
    .update({
      status: newStatus,
      status_reason: reason,
      updated_at: db.fn.now()
    })
    .catch(err => {
      throw new Error(`Failed to update task status: ${err.message}`);
    });

  if (result === 0) {
    throw new Error(`No task updated - task ID ${taskId} may not exist`);
  }

  return {
    success: true,
    taskId,
    oldStatus: currentStatus,
    newStatus,
    reason
  };
}

/**
 * Writes a new status for a task instance, guarding against invalid transitions.
 * 
 * @param {Object} db - Database connection
 * @param {string} instanceId - The ID of the task instance to update
 * @param {string} newStatus - The new status to set
 * @param {string} reason - Reason for the status change (for audit trail)
 * @returns {Promise<Object>} Result of the status update operation
 * @throws {Error} If the transition is invalid or database operation fails
 */
async function writeTaskInstanceStatus(db, instanceId, newStatus, reason) {
  // First, get the current status of the task instance
  const currentInstance = await db('task_instances')
    .where({ id: instanceId })
    .first('status')
    .catch(err => {
      throw new Error(`Failed to fetch current task instance status: ${err.message}`);
    });

  if (!currentInstance) {
    throw new Error(`Task instance with ID ${instanceId} not found`);
  }

  const currentStatus = currentInstance.status;

  // Check if the transition is valid
  if (!canTransition(currentStatus, newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} -> ${newStatus}. ` +
      `Task instance is in terminal state or transition is not allowed.`
    );
  }

  // Perform the status update
  const result = await db('task_instances')
    .where({ id: instanceId })
    .update({
      status: newStatus,
      status_reason: reason,
      updated_at: db.fn.now()
    })
    .catch(err => {
      throw new Error(`Failed to update task instance status: ${err.message}`);
    });

  if (result === 0) {
    throw new Error(`No task instance updated - instance ID ${instanceId} may not exist`);
  }

  return {
    success: true,
    instanceId,
    oldStatus: currentStatus,
    newStatus,
    reason
  };
}

module.exports = {
  writeTaskStatus,
  writeTaskInstanceStatus,
  canTransition
};