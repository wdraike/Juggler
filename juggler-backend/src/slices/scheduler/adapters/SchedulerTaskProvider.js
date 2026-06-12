/**
 * SchedulerTaskProvider — concrete TaskProviderPort (TASK_PROVIDER_PORT_METHODS).
 * Phase H6 / W2.
 *
 * CUTS the task.controller coupling. `runSchedule.js:92-95` today does:
 *     var taskController = require('../controllers/task.controller');
 *     var rowToTask     = taskController.rowToTask;
 *     var buildSourceMap = taskController.buildSourceMap;
 *     var taskToRow     = taskController.taskToRow;
 * This adapter sources those three mappers from the TASK SLICE FACADE
 * (`slices/task/facade.js`), which re-exports the byte-identical W2 domain
 * mappers (`mappers.rowToTask` / `taskToRow` / `buildSourceMap`). The legacy
 * controller ALSO re-exports those same function objects from the task slice
 * domain (the H3 extraction), so this is the SAME code reached without the
 * scheduler depending on the controller — the golden-master proves the resulting
 * placements are bit-for-bit identical.
 *
 * ── CONNECTION (ADR-0002 — lib/db, NOT src/db.js) ────────────────────────────
 * `loadSchedulableRows(db, userId)` runs against the injected `db` (a trx handle
 * in the orchestrated path, so the read participates in the caller's transaction
 * snapshot — exactly as runSchedule.js used `trx('tasks_v')`). The adapter does
 * not import src/db.js.
 *
 * NO new `||`/`??` fallback is introduced — the load query is lifted verbatim.
 */

'use strict';

var TASK_PROVIDER_PORT_METHODS =
  require('../domain/ports/TaskProviderPort').TASK_PROVIDER_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Object} [deps.taskFacade] the task slice facade (default: the real
 *   `slices/task/facade`) — source of rowToTask/taskToRow/buildSourceMap.
 *   Injectable so unit tests can stub the mappers.
 */
function SchedulerTaskProvider(deps) {
  var d = deps || {};
  var facade = d.taskFacade || require('../../task/facade');
  // Re-export the SAME function objects the task slice owns (byte-identical to
  // what the legacy controller exposed). NOT re-implemented here.
  this.rowToTask = facade.rowToTask;
  this.taskToRow = facade.taskToRow;
  this.buildSourceMap = facade.buildSourceMap;
}

/**
 * Load the scheduler's working set from `tasks_v` (verbatim — runSchedule.js
 * ~324-329): status ''/'wip'/NULL OR task_type='recurring_template', scoped to
 * the user. `db` may be a trx handle.
 */
SchedulerTaskProvider.prototype.loadSchedulableRows = function loadSchedulableRows(db, userId) {
  return db('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        .orWhere('task_type', 'recurring_template');
    })
    .select();
};

module.exports = SchedulerTaskProvider;
module.exports.SchedulerTaskProvider = SchedulerTaskProvider;
module.exports.TASK_PROVIDER_PORT_METHODS = TASK_PROVIDER_PORT_METHODS;
