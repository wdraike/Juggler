/**
 * Task Status Library - Shared task status management for Juggler
 *
 * This library provides a simplified, unified interface for working with task statuses
 * that is shared between backend components and can be used by frontend code.
 *
 * Status definitions:
 *   - done: Task completed successfully
 *   - skip: Task was skipped
 *   - cancel: Task was cancelled
 *   - missed: Task was missed (resolution window passed without action)
 *
 * @module lib/task-status
 */

/**
 * Array of all valid task status options for UI components.
 * Includes empty string for "not started" state.
 * @type {string[]}
 */
const STATUS_OPTIONS = Object.freeze(['', 'wip', 'done', 'skip', 'cancel', 'missed']);

/**
 * Array of terminal statuses - tasks in these states are considered complete
 * and are taken out of the active scheduling pool.
 * @type {string[]}
 */
const TERMINAL_STATUSES = Object.freeze(['done', 'skip', 'cancel', 'missed']);

/**
 * Checks if a status is terminal (task is complete/cancelled/skipped/missed).
 * @param {string|null|undefined} status - The status to check
 * @returns {boolean} True if the status is terminal, false otherwise
 * @example
 * // Returns true
 * isTerminalStatus('done');
 * @example
 * // Returns false
 * isTerminalStatus('wip');
 */
function isTerminalStatus(status) {
  if (status == null) return false;
  return TERMINAL_STATUSES.indexOf(status) !== -1;
}

/**
 * Checks if a status is valid (exists in STATUS_OPTIONS).
 * @param {string|null|undefined} status - The status to validate
 * @returns {boolean} True if the status is valid, false otherwise
 */
function isValidStatus(status) {
  if (status == null) return false;
  return STATUS_OPTIONS.indexOf(status) !== -1;
}

// Export all functions and constants for use by both backend and frontend
module.exports = {
  STATUS_OPTIONS,
  TERMINAL_STATUSES,
  isTerminalStatus,
  isValidStatus
};