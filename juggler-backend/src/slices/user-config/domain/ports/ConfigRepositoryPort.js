/**
 * ConfigRepositoryPort — driven-port contract for user-config persistence
 * (Phase H4 / W3).
 *
 * Authoritative interface for the user-config slice's read/write data-access
 * layer. It is the typed seam that absorbs the config/limit/impersonation DB
 * call sites the legacy 4 files perform today:
 *
 *   - `src/controllers/config.controller.js`  (22 DB touches) — user_config CRUD,
 *       projects CRUD + reorder, locations replace, tools replace, the orphan
 *       when-tag tasks_v read.
 *   - `src/middleware/entity-limits.js`        (5 COUNT queries) — countActiveTasks,
 *       countRecurringTemplates, countProjects, countLocations,
 *       countScheduleTemplates.
 *   - `src/controllers/impersonation.controller.js` (3 DB touches) — the
 *       impersonation_log audit insert, the users search-list, the
 *       impersonation_log + admin-email join list.
 *   - `src/controllers/data.controller.js`      (6 config DB touches) — the
 *       export reads (locations/tools/projects/user_config) and the import
 *       wipe+insert of those same config tables (the TASK rows in import/export
 *       stay with the task slice's `tasks-write` / `fetchTasksWithEventIds`).
 *
 * The repository operates on **DB-shape rows** (snake_case columns exactly as the
 * legacy queries read/write them) — NOT on API objects and NOT on the W2
 * `UserConfig` entity directly. The row↔entity mapping (`UserConfig.fromRow`) is a
 * pure W2 concern; the repository exposes `getUserConfig` returning the W2 entity
 * for the consumers that want it, plus the raw row methods the legacy controller
 * logic maps onto 1:1. Keeping the contract row-shaped means the W6 controller
 * migration is a mechanical repoint rather than a rewrite.
 *
 * Contract only (W3) — a JSDoc `@typedef` plus a throw-not-implemented base,
 * mirroring `TaskRepositoryPort`. The Knex + InMemory adapters (this leg)
 * implement it; a shared contract suite asserts both conform.
 *
 * ── BINDING INVARIANTS (implementations MUST honor; not optional) ───────────
 *
 * INVARIANT P1 (timestamps via new Date(), NEVER db.fn.now() — ADR-0003):
 *   Every write that sets `created_at` / `updated_at` MUST use a JS `new Date()`
 *   value, NEVER an inline Knex `db.fn.now()` / `trx.fn.now()`. A `fn.now()` raw
 *   embedded in an insert/update object is a Knex builder that breaks circular-
 *   JSON serialization on the write path (root-caused 2026-05-12; scheduler-rules
 *   veto). The legacy code violates this on several config paths
 *   (`getDb().fn.now()` at config.controller.js:126,230,271,276;
 *   `trx.fn.now()` at data.controller.js:123-124) — the in-scope, human-approved
 *   P1 correction (WBS W3 acceptance (b), 2026-06-10) is that THIS repository does
 *   it CORRECTLY. There is intentionally ZERO `fn.now()` reference in any
 *   ConfigRepositoryPort implementation. (impersonation.controller.js already
 *   wrote `new Date()` for the audit row — that path was already P1-correct and is
 *   preserved verbatim.)
 *
 * INVARIANT C-TX (transaction boundaries preserved):
 *   `runInTransaction(work)` MUST run `work(trxRepo)` inside one DB transaction
 *   that COMMITS iff `work` resolves and ROLLS BACK iff `work` rejects — the exact
 *   commit/rollback boundary the legacy `getDb().transaction(async trx => …)` call
 *   sites had (config.controller reorderProjects/updateProject/replaceLocations/
 *   replaceTools; data.controller importData). The `trxRepo` passed to `work`
 *   exposes the SAME methods, bound to the transaction handle.
 *
 * INVARIANT C-TENANCY (user_id scoping preserved):
 *   Every config read and write is scoped by `userId` exactly as the legacy
 *   queries were (`.where('user_id', userId)` / `.where({ user_id, config_key })`).
 *   The repository never widens a config query past its tenant. The impersonation
 *   reads (targets list, log list) are admin-scoped queries that the legacy code
 *   does NOT tenant-scope — that is preserved as-is (they run behind the admin
 *   authz gate, which is a W5/W6 concern, not this repository's).
 *
 * ── end binding invariants ─────────────────────────────────────────────────
 *
 * @typedef {Object} ConfigRepositoryPort
 *
 * ── USER_CONFIG ──────────────────────────────────────────────────────────────
 *
 * @property {(userId: string) => Promise<Object[]>} getConfigRows
 *   All `user_config` rows for the user (raw rows: {config_key, config_value, …}).
 *   (Legacy: getAllConfig's `getDb()('user_config').where('user_id', userId)`,
 *   config.controller.js:48; export's same read, data.controller.js:224.)
 *
 * @property {(userId: string, configKey: string) => Promise<?import('../entities/UserConfig')>} getUserConfig
 *   Single config record by (user, key) mapped to the W2 `UserConfig` entity, or
 *   null when no row exists. (Legacy: updateConfig's existence probe
 *   `getDb()('user_config').where({ user_id, config_key }).first()`,
 *   config.controller.js:121; entity-limits countScheduleTemplates read:105.)
 *
 * @property {(userId: string, configKey: string) => Promise<?Object>} getConfigRow
 *   Same probe returning the RAW row (config.controller.js:121 / entity-limits:105)
 *   for callers that need the raw config_value (the entity drops it through
 *   parsedValue; some legacy paths inspect the raw string).
 *
 * @property {(userId: string, configKey: string, serializedValue: string) => Promise<void>} upsertConfig
 *   Insert-or-update one config row. UPDATE sets `config_value` + `updated_at`
 *   (P1 new Date()); INSERT sets only user_id/config_key/config_value (legacy
 *   INSERT did not set updated_at — the column default applies; preserved).
 *   (Legacy: updateConfig's existing?update:insert, config.controller.js:121-134.)
 *
 * ── PROJECTS ─────────────────────────────────────────────────────────────────
 *
 * @property {(userId: string) => Promise<Object[]>} getProjects
 *   The user's projects ordered by sort_order. (Legacy: getProjects:198 /
 *   getAllConfig:47 / export:223.)
 *
 * @property {(userId: string) => Promise<number>} getMaxProjectSortOrder
 *   `MAX(sort_order)` for the user (the new-project slot computation). Resolves the
 *   raw max (or null when no rows). (Legacy: createProject:246.)
 *
 * @property {(userId: string, project: Object) => Promise<number>} insertProject
 *   Insert one project row, returning the auto-increment id (legacy returned
 *   `[id]`). (Legacy: createProject:247.)
 *
 * @property {(userId: string, projectId: *, changes: Object, trxRepo?: ConfigRepositoryPort) => Promise<number>} updateProjectById
 *   Update one project by (id, user). When `changes` carries `updated_at` it MUST
 *   be a JS Date (P1); the repo stamps one when omitted. (Legacy: updateProject:269.)
 *
 * @property {(userId: string, projectId: *) => Promise<number>} deleteProjectById
 *   Delete one project by (id, user). (Legacy: deleteProject:292.)
 *
 * @property {(userId: string, idOrderPairs: Array<[number, number]>) => Promise<void>} reorderProjects
 *   Apply a sort_order reorder via a single CASE expression over whereIn(ids),
 *   stamping `updated_at` (P1). `idOrderPairs` is [[id, sortOrder], …]. (Legacy:
 *   reorderProjects' CASE-update, config.controller.js:218-231.)
 *
 * ── LOCATIONS ────────────────────────────────────────────────────────────────
 *
 * @property {(userId: string) => Promise<Object[]>} getLocations
 *   The user's locations ordered by sort_order. (Legacy: getLocations:305 /
 *   getAllConfig:45 / export:221.)
 *
 * @property {(userId: string, rows: Object[]) => Promise<void>} replaceLocations
 *   Delete-all-then-insert the user's locations (the legacy replace-all). MUST run
 *   inside a transaction (call within runInTransaction). (Legacy: replaceLocations
 *   trx body, config.controller.js:336-350.)
 *
 * ── TOOLS ────────────────────────────────────────────────────────────────────
 *
 * @property {(userId: string) => Promise<Object[]>} getTools
 *   The user's tools ordered by sort_order. (Legacy: getTools:364 /
 *   getAllConfig:46 / export:222.)
 *
 * @property {(userId: string, rows: Object[]) => Promise<void>} replaceTools
 *   Delete-all-then-insert the user's tools (replace-all). MUST run inside a
 *   transaction. (Legacy: replaceTools trx body, config.controller.js:378-389.)
 *
 * ── ENTITY-LIMIT COUNTS (entity-limits.js) ───────────────────────────────────
 *
 * @property {(userId: string) => Promise<number>} countActiveTasks
 *   Active (non done/cancel/skip/disabled, non recurring_template) task count from
 *   tasks_v, parseInt'd. (Legacy: countActiveTasks, entity-limits.js:66-76.)
 *
 * @property {(userId: string) => Promise<number>} countRecurringTemplates
 *   recurring_template (non done/cancel/skip/disabled) count from tasks_v. (Legacy:
 *   countRecurringTemplates, entity-limits.js:78-86.)
 *
 * @property {(userId: string) => Promise<number>} countProjects
 *   Project row count. (Legacy: countProjects, entity-limits.js:88-94.)
 *
 * @property {(userId: string) => Promise<number>} countLocations
 *   Location row count. (Legacy: countLocations, entity-limits.js:96-102.)
 *
 * @property {(userId: string, projectNames: string[]) => Promise<Object[]>} getProjectTaskCounts
 *   Per-project task counts from tasks_v: rows {project, total, done}. Filters
 *   by userId + whereIn('project', projectNames), grouped by project. (Legacy:
 *   MCP list_projects, mcp/tools/config.js:76-81.)
 *
 * ── ORPHAN WHEN-TAGS (config.controller schedule_templates save) ─────────────
 *
 * @property {(userId: string) => Promise<Object[]>} getActiveWhenTaggedTasks
 *   The active tasks (non done/cancel/skip/pause) that carry a non-empty,
 *   non-'anytime' `when` — the input to the orphaned-when-tag scan. Selects
 *   id, text, when. (Legacy: the activeTasks read in updateConfig,
 *   config.controller.js:148-154.)
 *
 * ── DATA EXPORT/IMPORT (config tables only) ──────────────────────────────────
 *
 * @property {(userId: string, configKeys?: string[]) => Promise<void>} clearUserConfigTables
 *   Delete the user's user_config, tools, locations, projects rows (the import
 *   wipe of CONFIG tables — task wipe is the task slice's `deleteTasksWhere`).
 *   MUST run inside a transaction. (Legacy: importData trx, data.controller.js:70-73.)
 *   999.1603: a non-empty `configKeys` array makes the user_config delete
 *   SELECTIVE (only those keys — rows the import does not rewrite survive);
 *   absent/empty = full user_config wipe. tools/locations/projects always full-wipe.
 *
 * @property {(userId: string, rows: Object[]) => Promise<void>} insertLocations
 *   Bulk insert location rows (import path — no prior delete). (Legacy: importData
 *   locations insert, data.controller.js:136.)
 *
 * @property {(userId: string, rows: Object[]) => Promise<void>} insertTools
 *   Bulk insert tool rows (import path). (Legacy: importData tools insert:149.)
 *
 * @property {(userId: string, rows: Object[]) => Promise<void>} insertProjects
 *   Bulk insert project rows (import path). (Legacy: importData projects insert:162.)
 *
 * @property {(userId: string, rows: Object[]) => Promise<void>} insertConfigRows
 *   Bulk insert user_config rows (import path). (Legacy: importData config insert,
 *   data.controller.js:184-190.)
 *
 * ── IMPERSONATION (impersonation.controller.js) ──────────────────────────────
 *
 * @property {(row: Object) => Promise<void>} insertImpersonationLog
 *   Insert one impersonation_log audit row. `created_at`/`updated_at` are JS Dates
 *   (P1 — legacy already used new Date() here, preserved). (Legacy: insertAuditRow,
 *   impersonation.controller.js:30-37.)
 *
 * @property {(opts: {search?: string, limit: number, offset: number}) => Promise<{users: Object[], total: number}>} listImpersonationTargets
 *   The admin user-search list: users (id, email, created_at) filtered by an
 *   escaped LIKE on email, ordered by email, paginated, PLUS the total count (the
 *   cloned count query). (Legacy: getImpersonationTargets, impersonation.controller.js:102-111.)
 *
 * @property {(opts: {limit: number, offset: number, adminUserId?: string, targetUserId?: string}) => Promise<{logs: Object[], total: number}>} listImpersonationLog
 *   The impersonation_log list joined to admin email, optionally filtered by
 *   admin/target, ordered by created_at desc, paginated, PLUS the total count.
 *   (Legacy: getImpersonationLog, impersonation.controller.js:130-144.)
 *
 * ── TRANSACTIONS (INVARIANT C-TX) ────────────────────────────────────────────
 *
 * @property {<T>(work: (trxRepo: ConfigRepositoryPort) => Promise<T>) => Promise<T>} runInTransaction
 *   Run `work(trxRepo)` inside one DB transaction. Commits on resolve, rolls back
 *   on reject. `trxRepo` is a ConfigRepositoryPort bound to the transaction handle.
 *   (Legacy: every `getDb().transaction(async trx => …)` config call site.)
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function ConfigRepositoryPort() {}

// ── user_config ──────────────────────────────────────────────────────────────

ConfigRepositoryPort.prototype.getConfigRows = function getConfigRows(_userId) {
  throw new Error('ConfigRepositoryPort.getConfigRows not implemented');
};

// The user's configured timezone (users.timezone), or null when unset (A1).
// Surfaced to the frontend so display uses the configured tz over the browser's.
ConfigRepositoryPort.prototype.getUserTimezone = function getUserTimezone(_userId) {
  throw new Error('ConfigRepositoryPort.getUserTimezone not implemented');
};

ConfigRepositoryPort.prototype.getUserConfig = function getUserConfig(_userId, _configKey) {
  throw new Error('ConfigRepositoryPort.getUserConfig not implemented');
};

ConfigRepositoryPort.prototype.getConfigRow = function getConfigRow(_userId, _configKey) {
  throw new Error('ConfigRepositoryPort.getConfigRow not implemented');
};

ConfigRepositoryPort.prototype.upsertConfig = function upsertConfig(_userId, _configKey, _serializedValue) {
  throw new Error('ConfigRepositoryPort.upsertConfig not implemented');
};

// ── projects ─────────────────────────────────────────────────────────────────

ConfigRepositoryPort.prototype.getProjects = function getProjects(_userId) {
  throw new Error('ConfigRepositoryPort.getProjects not implemented');
};

ConfigRepositoryPort.prototype.getMaxProjectSortOrder = function getMaxProjectSortOrder(_userId) {
  throw new Error('ConfigRepositoryPort.getMaxProjectSortOrder not implemented');
};

ConfigRepositoryPort.prototype.insertProject = function insertProject(_userId, _project) {
  throw new Error('ConfigRepositoryPort.insertProject not implemented');
};

ConfigRepositoryPort.prototype.updateProjectById = function updateProjectById(_userId, _projectId, _changes) {
  throw new Error('ConfigRepositoryPort.updateProjectById not implemented');
};

ConfigRepositoryPort.prototype.deleteProjectById = function deleteProjectById(_userId, _projectId) {
  throw new Error('ConfigRepositoryPort.deleteProjectById not implemented');
};

ConfigRepositoryPort.prototype.reorderProjects = function reorderProjects(_userId, _idOrderPairs) {
  throw new Error('ConfigRepositoryPort.reorderProjects not implemented');
};

// ── locations ────────────────────────────────────────────────────────────────

ConfigRepositoryPort.prototype.getLocations = function getLocations(_userId) {
  throw new Error('ConfigRepositoryPort.getLocations not implemented');
};

ConfigRepositoryPort.prototype.replaceLocations = function replaceLocations(_userId, _rows) {
  throw new Error('ConfigRepositoryPort.replaceLocations not implemented');
};

// ── tools ────────────────────────────────────────────────────────────────────

ConfigRepositoryPort.prototype.getTools = function getTools(_userId) {
  throw new Error('ConfigRepositoryPort.getTools not implemented');
};

ConfigRepositoryPort.prototype.replaceTools = function replaceTools(_userId, _rows) {
  throw new Error('ConfigRepositoryPort.replaceTools not implemented');
};

// ── entity-limit counts ──────────────────────────────────────────────────────

ConfigRepositoryPort.prototype.countActiveTasks = function countActiveTasks(_userId) {
  throw new Error('ConfigRepositoryPort.countActiveTasks not implemented');
};

ConfigRepositoryPort.prototype.countRecurringTemplates = function countRecurringTemplates(_userId) {
  throw new Error('ConfigRepositoryPort.countRecurringTemplates not implemented');
};

ConfigRepositoryPort.prototype.countProjects = function countProjects(_userId) {
  throw new Error('ConfigRepositoryPort.countProjects not implemented');
};

ConfigRepositoryPort.prototype.countLocations = function countLocations(_userId) {
  throw new Error('ConfigRepositoryPort.countLocations not implemented');
};

// ── project task counts (MCP list_projects) ──────────────────────────────────

ConfigRepositoryPort.prototype.getProjectTaskCounts = function getProjectTaskCounts(_userId, _projectNames) {
  throw new Error('ConfigRepositoryPort.getProjectTaskCounts not implemented');
};

// ── orphan when-tags ─────────────────────────────────────────────────────────

ConfigRepositoryPort.prototype.getActiveWhenTaggedTasks = function getActiveWhenTaggedTasks(_userId) {
  throw new Error('ConfigRepositoryPort.getActiveWhenTaggedTasks not implemented');
};

// ── data export/import (config tables) ───────────────────────────────────────

ConfigRepositoryPort.prototype.clearUserConfigTables = function clearUserConfigTables(_userId) {
  throw new Error('ConfigRepositoryPort.clearUserConfigTables not implemented');
};

ConfigRepositoryPort.prototype.insertLocations = function insertLocations(_userId, _rows) {
  throw new Error('ConfigRepositoryPort.insertLocations not implemented');
};

ConfigRepositoryPort.prototype.insertTools = function insertTools(_userId, _rows) {
  throw new Error('ConfigRepositoryPort.insertTools not implemented');
};

ConfigRepositoryPort.prototype.insertProjects = function insertProjects(_userId, _rows) {
  throw new Error('ConfigRepositoryPort.insertProjects not implemented');
};

ConfigRepositoryPort.prototype.insertConfigRows = function insertConfigRows(_userId, _rows) {
  throw new Error('ConfigRepositoryPort.insertConfigRows not implemented');
};

// ── impersonation ────────────────────────────────────────────────────────────

ConfigRepositoryPort.prototype.insertImpersonationLog = function insertImpersonationLog(_row) {
  throw new Error('ConfigRepositoryPort.insertImpersonationLog not implemented');
};

ConfigRepositoryPort.prototype.listImpersonationTargets = function listImpersonationTargets(_opts) {
  throw new Error('ConfigRepositoryPort.listImpersonationTargets not implemented');
};

ConfigRepositoryPort.prototype.listImpersonationLog = function listImpersonationLog(_opts) {
  throw new Error('ConfigRepositoryPort.listImpersonationLog not implemented');
};

// ── transactions ─────────────────────────────────────────────────────────────

ConfigRepositoryPort.prototype.runInTransaction = function runInTransaction(_work) {
  throw new Error('ConfigRepositoryPort.runInTransaction not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy ConfigRepositoryPort.
 * A contract test asserts every adapter conforms.
 * @type {ReadonlyArray<string>}
 */
var CONFIG_REPOSITORY_PORT_METHODS = Object.freeze([
  // user_config
  'getConfigRows',
  'getUserConfig',
  'getConfigRow',
  'upsertConfig',
  'getUserTimezone',
  // projects
  'getProjects',
  'getMaxProjectSortOrder',
  'insertProject',
  'updateProjectById',
  'deleteProjectById',
  'reorderProjects',
  // locations
  'getLocations',
  'replaceLocations',
  // tools
  'getTools',
  'replaceTools',
  // entity-limit counts
  'countActiveTasks',
  'countRecurringTemplates',
  'countProjects',
  'countLocations',
  // project task counts (MCP list_projects)
  'getProjectTaskCounts',
  // orphan when-tags
  'getActiveWhenTaggedTasks',
  // data export/import (config tables)
  'clearUserConfigTables',
  'insertLocations',
  'insertTools',
  'insertProjects',
  'insertConfigRows',
  // impersonation
  'insertImpersonationLog',
  'listImpersonationTargets',
  'listImpersonationLog',
  // transactions
  'runInTransaction'
]);

module.exports = ConfigRepositoryPort;
module.exports.ConfigRepositoryPort = ConfigRepositoryPort;
module.exports.CONFIG_REPOSITORY_PORT_METHODS = CONFIG_REPOSITORY_PORT_METHODS;
