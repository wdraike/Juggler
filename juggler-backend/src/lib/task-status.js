/**
 * Task status helpers — single source of truth for terminal-state classification.
 *
 * Terminal statuses are statuses that take a task out of the active scheduling pool:
 *   - done    : user marked complete
 *   - cancel  : user marked won't-do
 *   - skip    : user-initiated skip (kept on schedule for the day)
 *   - pause   : template-level pause (recurring masters only)
 *   - missed  : system auto-applied because resolution window closed without action
 *
 * See:
 *   - .planning/phases/juggler-cal-history/juggler-cal-history-A-PLAN.md
 *   - juggler-backend/docs/TASK-STATE-MATRIX.md
 */

var TERMINAL_STATUSES = Object.freeze(['done', 'cancel', 'skip', 'pause', 'missed']);

function isTerminalStatus(s) {
  if (s == null) return false;
  return TERMINAL_STATUSES.indexOf(s) !== -1;
}

module.exports = {
  TERMINAL_STATUSES: TERMINAL_STATUSES,
  isTerminalStatus: isTerminalStatus
};
