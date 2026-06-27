/**
 * Shared Task Status Library for Juggler
 * 
 * This library provides a unified interface for task status management
 * that can be used by both frontend and backend components.
 * 
 * Single source of truth for all task status constants, validation, and utilities.
 */

const TaskStatus = Object.freeze({
  EMPTY: '',           // Default/empty status (task created but not started)
  DONE: 'done',        // Task completed successfully
  CANCEL: 'cancel',    // Task cancelled by user
  SKIP: 'skip',        // Task skipped (temporarily bypassed)
  PAUSE: 'pause',      // Task paused (recurring tasks only)
  MISSED: 'missed'     // Task was missed (resolution window passed without action)
});

const TASK_STATUSES = Object.freeze([
  TaskStatus.EMPTY,
  TaskStatus.DONE,
  TaskStatus.CANCEL,
  TaskStatus.SKIP,
  TaskStatus.PAUSE,
  TaskStatus.MISSED
]);

const TERMINAL_STATUSES = Object.freeze([
  TaskStatus.DONE,
  TaskStatus.CANCEL,
  TaskStatus.SKIP,
  TaskStatus.PAUSE,
  TaskStatus.MISSED
]);

const ACTIVE_STATUSES = Object.freeze([
  TaskStatus.EMPTY
]);

const STATUS_OPTIONS = Object.freeze([
  TaskStatus.EMPTY,
  TaskStatus.DONE,
  TaskStatus.CANCEL,
  TaskStatus.SKIP,
  TaskStatus.PAUSE,
  TaskStatus.MISSED
]);

// Cal History Statuses (juggler-cal-history Plan C)
const CalHistoryStatus = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  COMPLETED: 'COMPLETED',
  MISSED: 'MISSED',
  CANCELLED: 'CANCELLED'
});

const CAL_HISTORY_STATUSES = Object.freeze([
  CalHistoryStatus.SCHEDULED,
  CalHistoryStatus.COMPLETED,
  CalHistoryStatus.MISSED,
  CalHistoryStatus.CANCELLED
]);

const CAL_HISTORY_TERMINAL_STATUSES = Object.freeze([
  CalHistoryStatus.COMPLETED,
  CalHistoryStatus.MISSED,
  CalHistoryStatus.CANCELLED
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
    case TaskStatus.MISSED:
      return 'Missed';
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
    default:
      return 'Unknown status';
  }
}

/**
 * Checks if a cal_history status is valid.
 * @param {string|null|undefined} status
 * @returns {boolean}
 */
function isValidCalHistoryStatus(status) {
  if (status == null) return false;
  return CAL_HISTORY_STATUSES.indexOf(status) !== -1;
}

/**
 * Checks if a cal_history status is terminal.
 * @param {string|null|undefined} status
 * @returns {boolean}
 */
function isCalHistoryTerminalStatus(status) {
  if (status == null) return false;
  return CAL_HISTORY_TERMINAL_STATUSES.indexOf(status) !== -1;
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

/**
 * Checks if a transition from currentStatus to newStatus is valid.
 * Based on the state transition matrix in docs/architecture/TASK-STATE-MATRIX.md
 * 
 * @param {string} currentStatus - Current task status
 * @param {string} newStatus - Proposed new status
 * @returns {boolean}
 */
function canTransition(currentStatus, newStatus) {
  if (!STATUS_OPTIONS.includes(currentStatus) || !STATUS_OPTIONS.includes(newStatus)) {
    return false;
  }

  // Terminal statuses cannot transition to any other status
  if (isTerminalStatus(currentStatus)) {
    return false;
  }

  // Special transition rules based on current status
  switch (currentStatus) {
    case TaskStatus.EMPTY:
      // EMPTY can transition to: done, skip, cancel, pause
      return ['done', 'skip', 'cancel', 'pause'].indexOf(newStatus) !== -1;

    default:
      // For any other status (shouldn't happen since we checked terminal above)
      return false;
  }
}

// Export for CommonJS (Node.js backend)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TaskStatus,
    TASK_STATUSES,
    TERMINAL_STATUSES,
    ACTIVE_STATUSES,
    STATUS_OPTIONS,
    CalHistoryStatus,
    CAL_HISTORY_STATUSES,
    CAL_HISTORY_TERMINAL_STATUSES,
    isValidTaskStatus,
    isTerminalStatus,
    isActiveStatus,
    getTaskStatusDisplayName,
    getTaskStatusDescription,
    isValidCalHistoryStatus,
    isCalHistoryTerminalStatus,
    isValidBooleanValue,
    validateStatusValue,
    canTransition
  };
}