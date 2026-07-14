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
// Same pattern as the calendar slice adapters (GoogleCalendarAdapter.js /
// MicrosoftCalendarAdapter.js) — slice adapters require lib/task-status
// directly rather than taking it as a caller-supplied parameter.
var TERMINAL_STATUSES = require('../../../lib/task-status').TERMINAL_STATUSES;

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
 * ~324-329): status ''/NULL OR task_type='recurring_template', scoped to
 * the user. `db` may be a trx handle.
 *
 * BUG-814 (R55): recurring_template rows always have status=NULL in tasks_v
 * (the view hardcodes NULL for the master branch). A cancelled or disabled
 * master is therefore indistinguishable from an active one via tasks_v.status.
 * We exclude cancelled/disabled masters by checking task_masters.status
 * directly via a NOT EXISTS subquery on the master_id join key.
 */
SchedulerTaskProvider.prototype.loadSchedulableRows = function loadSchedulableRows(db, userId) {
  // BUG-814 (R55): tasks_v always exposes status=NULL for recurring_template rows
  // regardless of the real task_masters.status. The original query's
  // `orWhereNull('status')` branch therefore matches both active AND cancelled
  // templates — a cancelled series re-enters the placement pool.
  //
  // Fix: split NULL-status into two branches:
  //   (a) non-template rows with NULL status — pass as before
  //   (b) recurring_template rows — pass ONLY if task_masters.status is not
  //       'cancelled' or 'disabled' (checked via NOT EXISTS on master_id)
  return db('tasks_v').where('user_id', userId)
    .where(function() {
      // Live non-template tasks (status='')
      this.where('status', '')
        // Non-template rows with NULL status (legacy / one-shot tasks never given a status)
        .orWhere(function() {
          this.whereNull('status').whereNot('task_type', 'recurring_template');
        })
        // recurring_template rows whose master is not cancelled/disabled
        .orWhere(function() {
          this.where('task_type', 'recurring_template')
            .whereNotExists(function() {
              this.select(db.raw('1'))
                .from('task_masters')
                .whereRaw('`task_masters`.`id` = `tasks_v`.`master_id`')
                .whereIn('task_masters.status', ['cancelled', 'disabled']);
            });
        });
    })
    .select();
};

/**
 * Read terminal-status `task_instances` rows for the reconcile dedup pass
 * (verbatim — runSchedule.js ~551). Some legacy / partially-created rows end
 * up with NULL `date` but a valid `scheduled_at`; the caller falls back to
 * deriving the date key from `scheduled_at` in that case. `db` may be a trx
 * handle. JUG-SCHEDULER-LEGACY-DB-BYPASS (999.1532).
 */
SchedulerTaskProvider.prototype.getTerminalDedupRows = function getTerminalDedupRows(db, userId) {
  return db('task_instances').where('user_id', userId)
    .whereNotNull('master_id')
    .whereIn('status', TERMINAL_STATUSES)
    .select('master_id as source_id', 'date', 'scheduled_at', 'occurrence_ordinal', 'id');
};

/**
 * Cross-cycle spacing history: latest `done` placement date per recurring
 * master (verbatim — runSchedule.js ~590). Only `done` counts — `skip`/
 * `cancel` mean the user opted out of that slot and shouldn't be treated as
 * the real cadence. Pending instances are excluded because they include the
 * rows about to be placed; within-run placements contribute via
 * noteMasterPlacement in v2. See docs/RECURRING-SPACING-DESIGN.md. `db` may
 * be a trx handle. JUG-SCHEDULER-LEGACY-DB-BYPASS (999.1532).
 */
SchedulerTaskProvider.prototype.getRecurringDoneHistory = function getRecurringDoneHistory(db, userId) {
  return db('task_instances').where('user_id', userId)
    .whereNotNull('master_id')
    .whereNotNull('date')
    .where('status', 'done')
    .select('master_id')
    .max('date as latest_date')
    .groupBy('master_id');
};

/**
 * Defensive dedup: which of `ids` are already present in `task_instances`
 * (verbatim — runSchedule.js ~1453 phase-1 chunk pre-insert collision guard).
 * Structurally impossible given the caller's existingPendingIds filter, but
 * guards against future code changes breaking that invariant. `db` may be a
 * trx handle. JUG-SCHEDULER-LEGACY-DB-BYPASS (999.1532).
 */
SchedulerTaskProvider.prototype.findExistingInstanceIds = function findExistingInstanceIds(db, ids) {
  return db('task_instances').whereIn('id', ids).select('id');
};

/**
 * Load the admin Stepper UI's working set from `tasks_v` (verbatim —
 * schedulerSession.js ~78-83). DELIBERATELY NOT `loadSchedulableRows`: the
 * stepper's filter has never carried the BUG-814 fix (excluding
 * recurring_template rows whose master is cancelled/disabled), so this method
 * preserves that pre-existing, narrower filter rather than silently pulling
 * in the exclusion via reuse. `db` is the base connection (no trx).
 * JUG-SCHEDULER-LEGACY-DB-BYPASS (999.1532).
 */
SchedulerTaskProvider.prototype.loadStepperRows = function loadStepperRows(db, userId) {
  return db('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhereNull('status')
        .orWhere('task_type', 'recurring_template');
    })
    .select();
};

module.exports = SchedulerTaskProvider;
module.exports.SchedulerTaskProvider = SchedulerTaskProvider;
module.exports.TASK_PROVIDER_PORT_METHODS = TASK_PROVIDER_PORT_METHODS;
