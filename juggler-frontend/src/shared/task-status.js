/**
 * Shared Task Status Library for Juggler
 * 
 * This library provides a unified interface for task status management
 * that can be used by both frontend and backend components.
 */

const TaskStatus = Object.freeze({
  EMPTY: '',           // Default/empty status (task created but not started)
  DONE: 'done',        // Task completed successfully
  CANCEL: 'cancel',    // Task cancelled by user (instance action)
  CANCELLED: 'cancelled', // Series/instance cancelled (backend cancel path — tasks-write.js); terminal
  SKIP: 'skip',        // Task skipped (temporarily bypassed)
  PAUSE: 'pause',      // Task paused (recurring tasks only)
});

const TASK_STATUSES = Object.freeze([
  TaskStatus.EMPTY,
  TaskStatus.DONE,
  TaskStatus.CANCEL,
  TaskStatus.CANCELLED,
  TaskStatus.SKIP,
  TaskStatus.PAUSE
]);

const TERMINAL_STATUSES = Object.freeze([
  TaskStatus.DONE,
  TaskStatus.CANCEL,
  TaskStatus.CANCELLED,
  TaskStatus.SKIP,
  TaskStatus.PAUSE
]);

const ACTIVE_STATUSES = Object.freeze([
  TaskStatus.EMPTY
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
 * Gets the display name for a status value.
 * @param {string} status
 * @returns {string}
 */
function getTaskStatusDisplayName(status) {
  switch (status) {
    case TaskStatus.EMPTY:
      return 'Not Started';
    case TaskStatus.DONE:
      return 'Completed';
    case TaskStatus.CANCEL:
      return 'Cancelled';
    case TaskStatus.SKIP:
      return 'Skipped';
    case TaskStatus.PAUSE:
      return 'Paused';
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
    default:
      return 'Unknown status';
  }
}

/**
 * Validates boolean values to ensure they are 0/1 only
 * @param {number|null|undefined} value
 * @returns {boolean}
 */
function isValidBooleanValue(value) {
  return value === 0 || value === 1;
}

/**
 * Validates status values to ensure they are in the allowed set
 * @param {string|null|undefined} status
 * @param {string} context - Context for error messages (e.g., 'task status', 'cal_history status')
 * @returns {boolean}
 */
function validateStatusValue(status, context = 'status') {
  if (status == null) return false;
  
  if (typeof status !== 'string') {
    console.warn(`${context} must be a string, got ${typeof status}`);
    return false;
  }
  
  return isValidTaskStatus(status);
}

export {
  TaskStatus,
  TASK_STATUSES,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  isValidTaskStatus,
  isTerminalStatus,
  isActiveStatus,
  getTaskStatusDisplayName,
  getTaskStatusDescription,
  isValidBooleanValue,
  validateStatusValue
};