/**
 * TaskRepositoryPort — driven-port contract for task persistence (Phase H3 / W3).
 *
 * Authoritative interface for the task slice's read/write data-access layer. It
 * is the typed seam that absorbs the 66 `getDb(` + 12 `trx(` call sites the
 * legacy `src/controllers/task.controller.js` performs against the master/instance
 * task model (`task_masters` + `task_instances` written through `lib/tasks-write`,
 * read through the `tasks_v` / `tasks_with_sync_v` views + `cal_sync_ledger`).
 *
 * The repository operates on **DB-shape rows** (the snake_case column shape
 * `taskToRow()` produces and `rowToTask()` consumes) — NOT on API task objects.
 * The row↔API mapping stays in the W2 pure mappers (`domain/mappers/taskMappers`).
 * Keeping the repository row-shaped means the legacy controller logic (which is
 * itself row-shaped at every DB call site) maps onto these methods 1:1, so the
 * W6 controller migration is a mechanical repoint rather than a rewrite.
 *
 * Contract only (W3) — a JSDoc `@typedef` plus a throw-not-implemented base,
 * mirroring `WeatherCacheRepositoryPort` / `CalendarPort`. The Knex + InMemory
 * adapters (this leg) implement it; a shared contract suite asserts both conform.
 *
 * ── BINDING INVARIANTS (implementations MUST honor; not optional) ───────────
 *
 * INVARIANT P1 (timestamps via new Date(), NEVER db.fn.now() — ADR-0003):
 *   Every write that sets `created_at` / `updated_at` MUST use a JS `new Date()`
 *   value, NEVER an inline Knex `db.fn.now()` / `trx.fn.now()`. A `fn.now()` raw
 *   embedded in an insert/update object is a Knex builder that breaks circular-
 *   JSON serialization on the write path (root-caused 2026-05-12; scheduler-rules
 *   veto). The legacy controller violates this on ~8 paths (`getDb().fn.now()` at
 *   992,1029,1033,1036,1147,1208,1223,1227 + `trx.fn.now()` 1261-62) — the
 *   in-scope, human-approved P1 correction (WBS "In-scope decision", 2026-06-10)
 *   is that THIS repository does it CORRECTLY. There is intentionally ZERO
 *   `fn.now()` reference in any TaskRepositoryPort implementation.
 *
 * INVARIANT T-TX (transaction boundaries preserved):
 *   `runInTransaction(work)` MUST run `work(trxRepo)` inside one DB transaction
 *   that COMMITS iff `work` resolves and ROLLS BACK iff `work` rejects — the exact
 *   commit/rollback boundary the legacy `getDb().transaction(async trx => …)`
 *   call sites had. The `trxRepo` passed to `work` exposes the SAME write/read
 *   methods, bound to the transaction handle (so reads-within-write see uncommitted
 *   state, matching the legacy `trx('…')` calls).
 *
 * INVARIANT T-TENANCY (user_id scoping preserved):
 *   Every read and write is scoped by `userId` exactly as the legacy queries were
 *   (`.where('user_id', userId)` / the `tasks-write` `requireUserId` guard). The
 *   repository never widens a query past its tenant.
 *
 * ── end binding invariants ─────────────────────────────────────────────────
 *
 * @typedef {Object} TaskRepositoryPort
 *
 * ── READS ───────────────────────────────────────────────────────────────────
 *
 * @property {(id: string, userId: string) => Promise<?Object>} fetchTaskWithEventIds
 *   Single-row lookup with calendar event ids attached. Reads `tasks_v` (the row)
 *   + `cal_sync_ledger` (active rows for the task) and folds gcal/msft/apple
 *   event ids + cal_sync_origin/cal_event_url/apple_calendar_name onto the row in
 *   the shape `tasks_with_sync_v` exposes. Resolves null when no row exists.
 *   (Legacy: `fetchTaskWithEventIds`, controller ~219.)
 *
 * @property {(userId: string, queryBuilder?: (q: Object) => void) => Promise<Object[]>} fetchTasksWithEventIds
 *   Bulk equivalent: `tasks_v` for the user (the optional `queryBuilder` applies
 *   .where/.orderBy/.limit/.offset to the tasks_v read before it runs) + one
 *   ledger query + the user's apple calendars, folding event ids onto each row.
 *   (Legacy: `fetchTasksWithEventIds`, controller ~266.)
 *
 * @property {(userId: string) => Promise<string>} getTasksVersion
 *   `MAX(updated_at) || '0'` + ':' + `COUNT(*)` over `tasks_v` for the user — the
 *   cache-busting version token. (Legacy: `getTasksVersion`, controller ~645.)
 *
 * @property {(userId: string) => Promise<Object[]>} getRecurringTemplateRows
 *   The user's recurring-template / recurring source rows from `tasks_v`
 *   (`task_type='recurring_template' OR recurring=1`) — the input to
 *   `buildSourceMap` for instance field inheritance. (Legacy: the templateRows
 *   leg of getTask ~694 and the srcMap reads in updateTask/status paths.)
 *
 * @property {(userId: string, ids: string[]) => Promise<string[]>} expandToAllInstanceIds
 *   Expand a set of ids to include every sibling instance under any recurring
 *   master the ids touch (two short `task_masters` + `task_instances` queries).
 *   Returns the deduped id set. (Legacy: `expandToAllInstanceIds`, controller ~112.)
 *
 * @property {(userId: string) => Promise<?Object>} getUserSplitPreference
 *   The user's `preferences` config row from `user_config`
 *   (`config_key='preferences'`), or null. Drives `applySplitDefault`. (Legacy:
 *   applySplitDefault ~739.)
 *
 * @property {(userId: string, query: string) => Promise<Object[]>} searchTasks
 *   FULLTEXT search across task descriptions and notes using MySQL
 *   MATCH…AGAINST IN BOOLEAN MODE on the `ft_tasks_search` index
 *   (task_masters.text, task_masters.notes). Returns task_masters rows
 *   enriched with calendar event ids, same shape as fetchTasksWithEventIds.
 *   (999.253)
 *
 * ── WRITES (all timestamps via new Date() — INVARIANT P1) ────────────────────
 *
 * @property {(row: Object) => Promise<void>} insertTask
 *   Insert ONE task (legacy tasks-shape row). Routes to master/instance via
 *   `lib/tasks-write.insertTask`. The caller supplies `created_at`/`updated_at`
 *   as JS Dates (P1); the repository asserts they are Dates, never substitutes a
 *   `fn.now()`. (Legacy: createTask `tasksWrite.insertTask` path.)
 *
 * @property {(rows: Object[]) => Promise<void>} insertTasksBatch
 *   Batch insert (legacy tasks-shape rows). Routes via
 *   `lib/tasks-write.insertTasksBatch`. Same P1 Date discipline per row.
 *   (Legacy: batchCreateTasks `tasksWrite.insertTasksBatch` path.)
 *
 * @property {(id: string, changes: Object, userId: string) => Promise<{masterUpdated: number, instanceUpdated: number}>} updateTaskById
 *   Update one task by id with field routing (`lib/tasks-write.updateTaskById`).
 *   When `changes` carries an `updated_at` it MUST be a JS Date (P1) — the
 *   repository sets it if the caller omitted it. Returns per-table row counts.
 *   (Legacy: the many `tasksWrite.updateTaskById(db|trx, …)` call sites.)
 *
 * @property {(id: string, userId: string) => Promise<number>} deleteTaskById
 *   Delete one task by id (both tables, tenancy-scoped) via
 *   `lib/tasks-write.deleteTaskById`. Returns rows removed (master+instance).
 *
 * @property {(userId: string, applyWhere: (q: Object) => Object, changes: Object, opts?: Object) => Promise<{masterUpdated: number, instanceUpdated: number}>} updateTasksWhere
 *   Bulk update via a where-builder with field routing
 *   (`lib/tasks-write.updateTasksWhere`). Any `changes.updated_at` MUST be a JS
 *   Date (P1).
 *
 * @property {(userId: string, applyWhere: (q: Object) => Object) => Promise<{instanceDeleted: number, masterDeleted: number}>} deleteTasksWhere
 *   Bulk delete via a where-builder (`lib/tasks-write.deleteTasksWhere`).
 *
 * @property {(userId: string, applyWhere: (q: Object) => Object, changes: Object) => Promise<number>} updateInstancesWhere
 *   Instance-only bulk update via a where-builder
 *   (`lib/tasks-write.updateInstancesWhere`). Any `changes.updated_at` is a JS
 *   Date (P1).
 *
 * @property {(userId: string, applyWhere: (q: Object) => Object) => Promise<number>} deleteInstancesWhere
 *   Instance-only bulk delete via a where-builder
 *   (`lib/tasks-write.deleteInstancesWhere`).
 *
 * ── TRANSACTIONS (INVARIANT T-TX) ────────────────────────────────────────────
 *
 * @property {<T>(work: (trxRepo: TaskRepositoryPort) => Promise<T>) => Promise<T>} runInTransaction
 *   Run `work(trxRepo)` inside one DB transaction. Commits on resolve, rolls back
 *   on reject. `trxRepo` is a TaskRepositoryPort bound to the transaction handle,
 *   so all its reads/writes participate in the same transaction (reads see
 *   uncommitted writes). (Legacy: every `getDb().transaction(async trx => …)`.)
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function TaskRepositoryPort() {}

// ── reads ────────────────────────────────────────────────────────────────────

TaskRepositoryPort.prototype.fetchTaskWithEventIds = function fetchTaskWithEventIds(_id, _userId) {
  throw new Error('TaskRepositoryPort.fetchTaskWithEventIds not implemented');
};

TaskRepositoryPort.prototype.fetchTasksWithEventIds = function fetchTasksWithEventIds(_userId, _queryBuilder) {
  throw new Error('TaskRepositoryPort.fetchTasksWithEventIds not implemented');
};

TaskRepositoryPort.prototype.getTasksVersion = function getTasksVersion(_userId) {
  throw new Error('TaskRepositoryPort.getTasksVersion not implemented');
};

TaskRepositoryPort.prototype.getRecurringTemplateRows = function getRecurringTemplateRows(_userId) {
  throw new Error('TaskRepositoryPort.getRecurringTemplateRows not implemented');
};

TaskRepositoryPort.prototype.expandToAllInstanceIds = function expandToAllInstanceIds(_userId, _ids) {
  throw new Error('TaskRepositoryPort.expandToAllInstanceIds not implemented');
};

TaskRepositoryPort.prototype.getUserSplitPreference = function getUserSplitPreference(_userId) {
  throw new Error('TaskRepositoryPort.getUserSplitPreference not implemented');
};

/**
 * FULLTEXT search across task descriptions and notes (999.253).
 * Uses MySQL MATCH…AGAINST on the `ft_tasks_search` FULLTEXT index.
 * Returns task_masters rows enriched with calendar event ids,
 * same shape as fetchTasksWithEventIds (rowToTask-mappable).
 * @param {string} _userId
 * @param {string} _query  BOOLEAN MODE search string
 * @returns {Promise<Object[]>}
 */
TaskRepositoryPort.prototype.searchTasks = function searchTasks(_userId, _query) {
  throw new Error('TaskRepositoryPort.searchTasks not implemented');
};

// ── writes ───────────────────────────────────────────────────────────────────

TaskRepositoryPort.prototype.insertTask = function insertTask(_row) {
  throw new Error('TaskRepositoryPort.insertTask not implemented');
};

TaskRepositoryPort.prototype.insertTasksBatch = function insertTasksBatch(_rows) {
  throw new Error('TaskRepositoryPort.insertTasksBatch not implemented');
};

TaskRepositoryPort.prototype.updateTaskById = function updateTaskById(_id, _changes, _userId) {
  throw new Error('TaskRepositoryPort.updateTaskById not implemented');
};

TaskRepositoryPort.prototype.deleteTaskById = function deleteTaskById(_id, _userId) {
  throw new Error('TaskRepositoryPort.deleteTaskById not implemented');
};

TaskRepositoryPort.prototype.updateTasksWhere = function updateTasksWhere(_userId, _applyWhere, _changes, _opts) {
  throw new Error('TaskRepositoryPort.updateTasksWhere not implemented');
};

TaskRepositoryPort.prototype.deleteTasksWhere = function deleteTasksWhere(_userId, _applyWhere) {
  throw new Error('TaskRepositoryPort.deleteTasksWhere not implemented');
};

TaskRepositoryPort.prototype.updateInstancesWhere = function updateInstancesWhere(_userId, _applyWhere, _changes) {
  throw new Error('TaskRepositoryPort.updateInstancesWhere not implemented');
};

TaskRepositoryPort.prototype.deleteInstancesWhere = function deleteInstancesWhere(_userId, _applyWhere) {
  throw new Error('TaskRepositoryPort.deleteInstancesWhere not implemented');
};

// ── transactions ───────────────────────────────────────────────────────────

TaskRepositoryPort.prototype.runInTransaction = function runInTransaction(_work) {
  throw new Error('TaskRepositoryPort.runInTransaction not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy TaskRepositoryPort.
 * A contract test asserts every adapter conforms.
 * @type {ReadonlyArray<string>}
 */
var TASK_REPOSITORY_PORT_METHODS = Object.freeze([
  // reads
  'fetchTaskWithEventIds',
  'fetchTasksWithEventIds',
  'getTasksVersion',
  'getRecurringTemplateRows',
  'expandToAllInstanceIds',
  'getUserSplitPreference',
  // search
  'searchTasks',
  // writes
  'insertTask',
  'insertTasksBatch',
  'updateTaskById',
  'deleteTaskById',
  'updateTasksWhere',
  'deleteTasksWhere',
  'updateInstancesWhere',
  'deleteInstancesWhere',
  // transactions
  'runInTransaction'
]);

module.exports = TaskRepositoryPort;
module.exports.TaskRepositoryPort = TaskRepositoryPort;
module.exports.TASK_REPOSITORY_PORT_METHODS = TASK_REPOSITORY_PORT_METHODS;
