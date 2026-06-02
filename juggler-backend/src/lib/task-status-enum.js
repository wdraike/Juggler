/**
 * Task Status Enum
 *
 * Defines the valid status values for task records.
 * These statuses track the lifecycle of tasks in the juggler system.
 *
 * Usage:
 *   const { TaskStatus } = require('./task-status-enum');
 *   if (status === TaskStatus.DONE) { ... }
 *
 * See:
 *   - juggler-backend/docs/TASK-STATE-MATRIX.md
 *   - juggler-backend/src/schemas/task.schema.js
 */

/**
 * Status values for task records.
 * These represent the different states a task can be in.
 */
var TaskStatus = Object.freeze({
  EMPTY: '',           // Default/empty status (task created but not started)
  WIP: 'wip',          // Work In Progress (task is actively being worked on)
  DONE: 'done',        // Task completed successfully
  CANCEL: 'cancel',    // Task cancelled by user
  SKIP: 'skip',        // Task skipped (temporarily bypassed)
  PAUSE: 'pause',      // Task paused (recurring tasks only)
  MISSED: 'missed',    // Task was missed (resolution window passed without action)
  ARCHIVED: 'archived', // Task moved to history/archive
  RESTORED: 'restored'  // Task restored from history/archive
});

/**
 * Array of all valid task status values.
 */
var TASK_STATUSES = Object.freeze([
  TaskStatus.EMPTY,
  TaskStatus.WIP,
  TaskStatus.DONE,
  TaskStatus.CANCEL,
  TaskStatus.SKIP,
  TaskStatus.PAUSE,
  TaskStatus.MISSED,
  TaskStatus.ARCHIVED,
  TaskStatus.RESTORED
]);

/**
 * Terminal statuses — tasks in these states are considered completed
 * and are taken out of the active scheduling pool.
 */
var TERMINAL_STATUSES = Object.freeze([
  TaskStatus.DONE,
  TaskStatus.CANCEL,
  TaskStatus.SKIP,
  TaskStatus.PAUSE,
  TaskStatus.MISSED,
  TaskStatus.ARCHIVED,
  TaskStatus.RESTORED
]);

/**
 * Active statuses — tasks in these states are still in the active scheduling pool.
 */
var ACTIVE_STATUSES = Object.freeze([
  TaskStatus.EMPTY,
  TaskStatus.WIP
]);

/**
 * Validates if a status value is valid for tasks.
 * @param {string|null|undefined} status
 * @returns {boolean}
 */
function isValidTaskStatus(status) {
  if (status == null) return false;
  return TASK_STATUSES.indexOf(status) !== -1;
}

/**
 * Checks if a status is terminal (task is complete/cancelled/skipped/paused/missed).
 * @param {string|null|undefined} status
 * @returns {boolean}
 */
function isTerminalStatus(status) {
  if (status == null) return false;
  return TERMINAL_STATUSES.indexOf(status) !== -1;
}

/**
 * Checks if a status is active (task is still in the scheduling pool).
 * @param {string|null|undefined} status
 * @returns {boolean}
 */
function isActiveStatus(status) {
  if (status == null) return false;
  return ACTIVE_STATUSES.indexOf(status) !== -1;
}

/**
 * Checks if a transition from currentStatus to newStatus is valid.
 * Based on the state transition matrix in docs/architecture/TASK-STATE-MATRIX.md
 * 
 * @param {string} currentStatus - Current task status
 * @param {string} newStatus - Proposed new status
 * @returns {boolean}
 */
function canTransition(currentStatus, newStatus) {
  if (!isValidTaskStatus(currentStatus) || !isValidTaskStatus(newStatus)) {
    return false;
  }

  // Terminal statuses cannot transition to any other status
  if (isTerminalStatus(currentStatus)) {
    return false;
  }

  // Special transition rules based on current status
  switch (currentStatus) {
    case TaskStatus.EMPTY:
      // EMPTY can transition to: done, wip, skip, cancel, pause
      return [
        TaskStatus.DONE,
        TaskStatus.WIP,
        TaskStatus.SKIP,
        TaskStatus.CANCEL,
        TaskStatus.PAUSE
      ].indexOf(newStatus) !== -1;

    case TaskStatus.WIP:
      // WIP can transition to: done, EMPTY (reopen), skip, cancel
      return [
        TaskStatus.DONE,
        TaskStatus.EMPTY,
        TaskStatus.SKIP,
        TaskStatus.CANCEL
      ].indexOf(newStatus) !== -1;

    default:
      // For any other status (shouldn't happen since we checked terminal above)
      return false;
  }
}

/**
 * Gets the display name for a status value.
 * @param {string} status
 * @returns {string}
 */
function getTaskStatusDisplayName(status) {
  switch (status) {
    case TaskStatus.EMPTY:
      return 'Not Started';
    case TaskStatus.WIP:
      return 'In Progress';
    case TaskStatus.DONE:
      return 'Completed';
    case TaskStatus.CANCEL:
      return 'Cancelled';
    case TaskStatus.SKIP:
      return 'Skipped';
    case TaskStatus.PAUSE:
      return 'Paused';
    case TaskStatus.MISSED:
      return 'Missed';
    case TaskStatus.ARCHIVED:
      return 'Archived';
    case TaskStatus.RESTORED:
      return 'Restored';
    default:
      return 'Unknown';
  }
}

/**
 * Gets a short description for a status value.
 * @param {string} status
 * @returns {string}
 */
function getTaskStatusDescription(status) {
  switch (status) {
    case TaskStatus.EMPTY:
      return 'Task created but not yet started';
    case TaskStatus.WIP:
      return 'Task is actively being worked on';
    case TaskStatus.DONE:
      return 'Task completed successfully';
    case TaskStatus.CANCEL:
      return 'Task cancelled by user';
    case TaskStatus.SKIP:
      return 'Task temporarily bypassed';
    case TaskStatus.PAUSE:
      return 'Recurring task paused';
    case TaskStatus.MISSED:
      return 'Resolution window passed without action';
    case TaskStatus.ARCHIVED:
      return 'Task moved to history/archive';
    case TaskStatus.RESTORED:
      return 'Task restored from history/archive';
    default:
      return 'Unknown status';
  }
}

module.exports = {
  TaskStatus: TaskStatus,
  TASK_STATUSES: TASK_STATUSES,
  TERMINAL_STATUSES: TERMINAL_STATUSES,
  ACTIVE_STATUSES: ACTIVE_STATUSES,
  isValidTaskStatus: isValidTaskStatus,
  isTerminalStatus: isTerminalStatus,
  isActiveStatus: isActiveStatus,
  getTaskStatusDisplayName: getTaskStatusDisplayName,
  getTaskStatusDescription: getTaskStatusDescription,
  canTransition: canTransition
};