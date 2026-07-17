/**
 * cal-sync-helpers.js — Helper functions for calendar sync terminal status handling
 *
 * Extracted from cal-sync.controller.js as part of juggler-cal-history Plan C refactoring.
 * Provides clean separation of concerns for terminal status sync logic.
 */

var { isTerminalStatus } = require('./task-status');

// NOTE (999.1025 inc. 4): the terminal-status DECISION was lifted out of the
// old impure `handleTerminalTaskSync` (which awaited adapter.deleteEvent) into
// the pure use-case src/slices/calendar/domain/terminal-task-decision.js
// (`decideTerminalTaskSync`). The deleteEvent/throttle effect now lives at the
// controller call site. This file keeps only the pure terminal classifier.

/**
 * Check if a task status is terminal for calendar sync purposes
 *
 * @param {string} status - Task status
 * @returns {boolean} - True if status is terminal
 */
function isTerminalForSync(status) {
  return isTerminalStatus(status);
}

module.exports = {
  isTerminalForSync: isTerminalForSync
};