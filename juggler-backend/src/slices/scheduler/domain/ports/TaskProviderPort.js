/**
 * TaskProviderPort — driven-port contract for the scheduler's READ side of the
 * task model (Phase H6 / W2).
 *
 * The scheduler loads schedulable rows from `tasks_v`, builds a recurring
 * source-map, and maps DB rows ↔ in-memory task objects via the task slice's
 * pure mappers (`rowToTask` / `taskToRow` / `buildSourceMap`). Today
 * `runSchedule.js:92-95` reaches into `src/controllers/task.controller` directly
 * for those three functions — a hard coupling to the legacy controller. This
 * port is the seam that CUTS that coupling: the `SchedulerTaskProvider` adapter
 * sources the three mappers from the task slice facade (`slices/task/facade.js`,
 * which re-exports the byte-identical W2 domain mappers) and owns the `tasks_v`
 * read.
 *
 * Contract only (W2) — JSDoc `@typedef` + throw-not-implemented base, mirroring
 * `slices/task/domain/ports/TaskRepositoryPort`.
 *
 * ── BINDING INVARIANT (mapper fidelity) ──────────────────────────────────────
 * `rowToTask` / `taskToRow` / `buildSourceMap` MUST be byte-identical to what
 * `runSchedule.js` consumed (the golden-master pins the resulting placements
 * bit-for-bit). The adapter does NOT re-implement them — it re-exports the SAME
 * function objects the task slice owns. The legacy controller itself now
 * re-exports those from the task slice domain (the H3 extraction), so sourcing
 * via the facade is the same code, one fewer coupling.
 *
 * @typedef {Object} TaskProviderPort
 *
 * @property {(row: Object, timezone: string, srcMap: Object) => Object} rowToTask
 *   Map ONE `tasks_v` row to the scheduler's in-memory task object. (Legacy:
 *   `taskController.rowToTask`.)
 *
 * @property {(task: Object, userId: string, timezone: string, existing?: Object) => Object} taskToRow
 *   Map an in-memory task object back to a DB-shape row. (Legacy:
 *   `taskController.taskToRow`.)
 *
 * @property {(rows: Object[]) => Object} buildSourceMap
 *   Build the recurring-template source map from the loaded rows (instance field
 *   inheritance). (Legacy: `taskController.buildSourceMap`.)
 *
 * @property {(db: Function, userId: string) => Promise<Object[]>} loadSchedulableRows
 *   Load the scheduler's working set from `tasks_v`: rows with status ''/
 *   NULL OR task_type='recurring_template', scoped to the user. (Legacy:
 *   runSchedule.js ~324 `trx('tasks_v')…select()`.) `db` may be a trx handle so
 *   the read participates in the caller's transaction snapshot.
 *
 * @property {(db: Function, userId: string) => Promise<Object[]>} getTerminalDedupRows
 *   Read terminal-status (done/cancel/skip/…) `task_instances` rows for the
 *   user, aliased for the reconcile dedup pass (JUG-SCHEDULER-LEGACY-DB-BYPASS /
 *   999.1532). (Legacy: `runSchedule.js` ~551 `trx('task_instances')…select(
 *   'master_id as source_id', 'date', 'scheduled_at', 'occurrence_ordinal',
 *   'id')`.) `db` may be a trx handle.
 *
 * @property {(db: Function, userId: string) => Promise<Object[]>} getRecurringDoneHistory
 *   Read the latest `done` placement date per recurring master (cross-cycle
 *   spacing history — see docs/RECURRING-SPACING-DESIGN.md). (Legacy:
 *   `runSchedule.js` ~590 `trx('task_instances')…max('date as latest_date')
 *   .groupBy('master_id')`.) `db` may be a trx handle.
 *
 * @property {(db: Function, ids: string[]) => Promise<Object[]>} findExistingInstanceIds
 *   Defensive pre-insert collision check: which of `ids` already exist in
 *   `task_instances`. (Legacy: `runSchedule.js` ~1453
 *   `trx('task_instances').whereIn('id', ids).select('id')`.) `db` may be a
 *   trx handle so the read participates in the caller's transaction.
 *
 * @property {(db: Function, userId: string) => Promise<Object[]>} loadStepperRows
 *   Load the admin Stepper UI's working set from `tasks_v` (JUG-SCHEDULER-
 *   LEGACY-DB-BYPASS / 999.1532). DELIBERATELY a DIFFERENT query from
 *   `loadSchedulableRows`: it does NOT carry the BUG-814 fix that excludes
 *   recurring_template rows whose master is cancelled/disabled — the stepper
 *   has never applied that exclusion, so this method preserves the stepper's
 *   existing (pre-BUG-814-fix) behavior verbatim rather than silently
 *   changing it by reusing `loadSchedulableRows`. (Legacy: `schedulerSession.js`
 *   ~78-83 `db('tasks_v')…where(status ''/NULL OR recurring_template)…select()`.)
 *   `db` is the base connection (the stepper never runs inside a trx).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function TaskProviderPort() {}

TaskProviderPort.prototype.rowToTask = function rowToTask(_row, _timezone, _srcMap) {
  throw new Error('TaskProviderPort.rowToTask not implemented');
};

TaskProviderPort.prototype.taskToRow = function taskToRow(_task, _userId, _timezone, _existing) {
  throw new Error('TaskProviderPort.taskToRow not implemented');
};

TaskProviderPort.prototype.buildSourceMap = function buildSourceMap(_rows) {
  throw new Error('TaskProviderPort.buildSourceMap not implemented');
};

TaskProviderPort.prototype.loadSchedulableRows = function loadSchedulableRows(_db, _userId) {
  throw new Error('TaskProviderPort.loadSchedulableRows not implemented');
};

TaskProviderPort.prototype.getTerminalDedupRows = function getTerminalDedupRows(_db, _userId) {
  throw new Error('TaskProviderPort.getTerminalDedupRows not implemented');
};

TaskProviderPort.prototype.getRecurringDoneHistory = function getRecurringDoneHistory(_db, _userId) {
  throw new Error('TaskProviderPort.getRecurringDoneHistory not implemented');
};

TaskProviderPort.prototype.findExistingInstanceIds = function findExistingInstanceIds(_db, _ids) {
  throw new Error('TaskProviderPort.findExistingInstanceIds not implemented');
};

TaskProviderPort.prototype.loadStepperRows = function loadStepperRows(_db, _userId) {
  throw new Error('TaskProviderPort.loadStepperRows not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy TaskProviderPort.
 * @type {ReadonlyArray<string>}
 */
var TASK_PROVIDER_PORT_METHODS = Object.freeze([
  'rowToTask',
  'taskToRow',
  'buildSourceMap',
  'loadSchedulableRows',
  'getTerminalDedupRows',
  'getRecurringDoneHistory',
  'findExistingInstanceIds',
  'loadStepperRows'
]);

module.exports = TaskProviderPort;
module.exports.TaskProviderPort = TaskProviderPort;
module.exports.TASK_PROVIDER_PORT_METHODS = TASK_PROVIDER_PORT_METHODS;
