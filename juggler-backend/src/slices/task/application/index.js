/**
 * Task application layer — barrel re-export (Phase H3 / W5).
 *
 * The orchestration use-cases that reproduce the legacy task.controller.js 12
 * handlers' flows over the W3/W4 ports + injected collaborators (NO direct
 * DB/express/SDK here). The W6 facade wires the adapters → these use-cases; the
 * thin controller maps req→input / result→res.
 *
 * Handler → use-case mapping:
 *   getAllTasks        → queries/ListTasks
 *   getTask            → queries/GetTask
 *   getVersion         → queries/GetVersion
 *   getDisabledTasks   → queries/GetDisabledTasks
 *   createTask         → commands/CreateTask
 *   updateTask         → commands/UpdateTask        (fast + lock + complex paths)
 *   deleteTask         → commands/DeleteTask
 *   updateTaskStatus   → commands/UpdateTaskStatus  (incl. the done/complete path)
 *   (done path)        → commands/CompleteTask      (delegates to UpdateTaskStatus)
 *   (split-enable)     → commands/SplitTask         (delegates to Create/UpdateTask)
 *   batchCreateTasks   → commands/BatchCreateTasks
 *   batchUpdateTasks   → commands/BatchUpdateTasks
 *   reEnableTask       → commands/ReEnableTask
 *   takeOwnership      → commands/TakeOwnership
 */

'use strict';

module.exports = {
  // queries
  ListTasks: require('./queries/ListTasks'),
  GetTask: require('./queries/GetTask'),
  GetVersion: require('./queries/GetVersion'),
  GetDisabledTasks: require('./queries/GetDisabledTasks'),
  // commands (WBS-named)
  CreateTask: require('./commands/CreateTask'),
  UpdateTask: require('./commands/UpdateTask'),
  CompleteTask: require('./commands/CompleteTask'),
  SplitTask: require('./commands/SplitTask'),
  // commands (the remaining handlers)
  DeleteTask: require('./commands/DeleteTask'),
  UpdateTaskStatus: require('./commands/UpdateTaskStatus'),
  BatchCreateTasks: require('./commands/BatchCreateTasks'),
  BatchUpdateTasks: require('./commands/BatchUpdateTasks'),
  ReEnableTask: require('./commands/ReEnableTask'),
  TakeOwnership: require('./commands/TakeOwnership')
};
