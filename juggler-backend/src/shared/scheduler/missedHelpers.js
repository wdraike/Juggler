// Shared helpers for missed status computation
// Used by both cron job and scheduler

const { CalHistoryStatus } = require('../../constants/status-enum');
const { isTerminalStatus } = require('../../lib/task-status');

/**
 * Determine if a task should be marked as missed
 * @param {Object} task - Task object
 * @param {Date} currentTime - Current time for comparison
 * @param {number} resolutionWindowHours - Resolution window in hours
 * @returns {boolean} True if task should be marked as missed
 */
function shouldMarkAsMissed(task, currentTime, resolutionWindowHours = 24) {
  if (!task || !task.scheduled_at || !currentTime) {
    return false;
  }

  const scheduledTime = new Date(task.scheduled_at);
  const resolutionDeadline = new Date(scheduledTime.getTime() + (resolutionWindowHours * 60 * 60 * 1000));
  
  // Task is missed if current time is past the resolution deadline
  // and task is not in a terminal status
  return currentTime > resolutionDeadline && 
         !isTerminalStatus(task.status);
}

/**
 * Calculate resolution deadline for a task
 * @param {Date|string} scheduledAt - Scheduled time
 * @param {number} resolutionWindowHours - Resolution window in hours (default: 24)
 * @returns {Date} Resolution deadline
 */
function calculateResolutionDeadline(scheduledAt, resolutionWindowHours = 24) {
  const scheduledTime = new Date(scheduledAt);
  return new Date(scheduledTime.getTime() + (resolutionWindowHours * 60 * 60 * 1000));
}

/**
 * Get calendar history status for a task
 * @param {Object} task - Task object
 * @param {Date} currentTime - Current time
 * @returns {string} Calendar history status
 */
function getCalHistoryStatus(task, currentTime) {
  if (!task || !task.scheduled_at) {
    return CalHistoryStatus.SCHEDULED;
  }

  if (task.status === 'done' || task.status === 'completed') {
    return CalHistoryStatus.COMPLETED;
  }

  if (task.status === 'cancel' || task.status === 'cancelled') {
    return CalHistoryStatus.CANCELLED;
  }

  if (shouldMarkAsMissed(task, currentTime)) {
    return CalHistoryStatus.MISSED;
  }

  return CalHistoryStatus.SCHEDULED;
}

module.exports = {
  shouldMarkAsMissed,
  calculateResolutionDeadline,
  getCalHistoryStatus
};