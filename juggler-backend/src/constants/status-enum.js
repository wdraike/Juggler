/**
 * CalHistory status constants — re-exports from shared/task-status.js
 *
 * The canonical source of truth lives in shared/task-status.js. This used
 * to be a full hand-copied duplicate that had already diverged in function
 * naming (999.1181) — it is now a thin re-export shim. `isTerminalCalHistoryStatus`
 * is kept as the local name (canonical calls it `isCalHistoryTerminalStatus`)
 * for backward compatibility with existing callers/tests.
 */
var shared = require('juggler-shared/task-status');

module.exports = {
  CalHistoryStatus: shared.CalHistoryStatus,
  CAL_HISTORY_STATUSES: shared.CAL_HISTORY_STATUSES,
  CAL_HISTORY_TERMINAL_STATUSES: shared.CAL_HISTORY_TERMINAL_STATUSES,
  isValidCalHistoryStatus: shared.isValidCalHistoryStatus,
  isTerminalCalHistoryStatus: shared.isCalHistoryTerminalStatus,
  getCalHistoryStatusDisplayName: shared.getCalHistoryStatusDisplayName,
};
