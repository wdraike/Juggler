/**
 * Task status library — re-exports from shared/task-status.js
 *
 * The canonical source of truth lives in shared/task-status.js. This used to
 * be a full hand-copied fork that drifted (999.1181, 999.1294) — it is now a
 * thin re-export shim, same idiom as juggler-frontend/src/scheduler/*.js.
 */
const shared = require('juggler-shared/task-status');

export const {
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
  validateStatusValue,
} = shared;
