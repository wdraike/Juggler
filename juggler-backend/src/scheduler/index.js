/**
 * Scheduler Index - Main entry point for scheduler operations
 * 
 * This module coordinates scheduler operations and integrates with
 * the status writers to ensure proper status transitions.
 */

const { writeTaskStatus, writeTaskInstanceStatus } = require('../calendar/task-status-writer');
const { writeCalendarEventStatus, writeCalendarEventInstanceStatus } = require('../calendar/instance-status-writer');
const { createLogger } = require('../lib/logger');

const logger = createLogger('scheduler.index');

/**
 * Main scheduler function that runs the scheduling algorithm
 * and updates task/statuses using the guarded writers.
 * 
 * @param {Object} options - Scheduler options
 * @param {Object} options.db - Database connection
 * @param {string} options.userId - User ID for scheduling
 * @param {Date} options.startDate - Start date for scheduling window
 * @param {Date} options.endDate - End date for scheduling window
 * @param {boolean} options.dryRun - Whether to perform a dry run (default: false)
 * @returns {Promise<Object>} Scheduler result
 */
async function runScheduler(options) {
  const { db, userId, startDate, endDate, dryRun = false } = options;

  // Import the actual scheduling algorithm
  const { unifiedScheduleV2 } = require('./unifiedScheduleV2');

  // Run the scheduling algorithm
  const scheduleResult = await unifiedScheduleV2({
    db,
    userId,
    startDate,
    endDate,
    dryRun
  });

  // If not a dry run, update statuses using the guarded writers
  if (!dryRun && scheduleResult.tasksToUpdate) {
    for (const taskUpdate of scheduleResult.tasksToUpdate) {
      try {
        await writeTaskStatus(db, taskUpdate.taskId, taskUpdate.newStatus, taskUpdate.reason);
      } catch (error) {
        logger.error(`Failed to update task status for ${taskUpdate.taskId}: ${error.message}`);
        // Continue with other updates even if one fails
      }
    }
  }

  if (!dryRun && scheduleResult.taskInstancesToUpdate) {
    for (const instanceUpdate of scheduleResult.taskInstancesToUpdate) {
      try {
        await writeTaskInstanceStatus(db, instanceUpdate.instanceId, instanceUpdate.newStatus, instanceUpdate.reason);
      } catch (error) {
        logger.error(`Failed to update task instance status for ${instanceUpdate.instanceId}: ${error.message}`);
        // Continue with other updates even if one fails
      }
    }
  }

  if (!dryRun && scheduleResult.calendarEventsToUpdate) {
    for (const eventUpdate of scheduleResult.calendarEventsToUpdate) {
      try {
        await writeCalendarEventStatus(db, eventUpdate.eventId, eventUpdate.newStatus, eventUpdate.reason);
      } catch (error) {
        logger.error(`Failed to update calendar event status for ${eventUpdate.eventId}: ${error.message}`);
        // Continue with other updates even if one fails
      }
    }
  }

  if (!dryRun && scheduleResult.calendarEventInstancesToUpdate) {
    for (const eventInstanceUpdate of scheduleResult.calendarEventInstancesToUpdate) {
      try {
        await writeCalendarEventInstanceStatus(db, eventInstanceUpdate.instanceId, eventInstanceUpdate.newStatus, eventInstanceUpdate.reason);
      } catch (error) {
        logger.error(`Failed to update calendar event instance status for ${eventInstanceUpdate.instanceId}: ${error.message}`);
        // Continue with other updates even if one fails
      }
    }
  }

  return {
    ...scheduleResult,
    statusUpdatesApplied: !dryRun
  };
}

/**
 * Updates a task status using the guarded writer.
 * 
 * @param {Object} db - Database connection
 * @param {string} taskId - Task ID
 * @param {string} newStatus - New status
 * @param {string} reason - Reason for status change
 * @returns {Promise<Object>} Status update result
 */
async function updateTaskStatus(db, taskId, newStatus, reason) {
  return writeTaskStatus(db, taskId, newStatus, reason);
}

/**
 * Updates a task instance status using the guarded writer.
 * 
 * @param {Object} db - Database connection
 * @param {string} instanceId - Task instance ID
 * @param {string} newStatus - New status
 * @param {string} reason - Reason for status change
 * @returns {Promise<Object>} Status update result
 */
async function updateTaskInstanceStatus(db, instanceId, newStatus, reason) {
  return writeTaskInstanceStatus(db, instanceId, newStatus, reason);
}

/**
 * Updates a calendar event status using the guarded writer.
 * 
 * @param {Object} db - Database connection
 * @param {string} eventId - Calendar event ID
 * @param {string} newStatus - New status
 * @param {string} reason - Reason for status change
 * @returns {Promise<Object>} Status update result
 */
async function updateCalendarEventStatus(db, eventId, newStatus, reason) {
  return writeCalendarEventStatus(db, eventId, newStatus, reason);
}

/**
 * Updates a calendar event instance status using the guarded writer.
 * 
 * @param {Object} db - Database connection
 * @param {string} instanceId - Calendar event instance ID
 * @param {string} newStatus - New status
 * @param {string} reason - Reason for status change
 * @returns {Promise<Object>} Status update result
 */
async function updateCalendarEventInstanceStatus(db, instanceId, newStatus, reason) {
  return writeCalendarEventInstanceStatus(db, instanceId, newStatus, reason);
}

module.exports = {
  runScheduler,
  updateTaskStatus,
  updateTaskInstanceStatus,
  updateCalendarEventStatus,
  updateCalendarEventInstanceStatus,
  // Export the canTransition function for external use
  canTransition: require('../lib/task-status').canTransition
};