/**
 * KnexConfigRepository — concrete ConfigRepositoryPort implementation
 * (CONFIG_REPOSITORY_PORT_METHODS). Phase H4 / W3.
 *
 * Absorbs the user-config DB reads/writes/counts that today live inline across
 * the 4 legacy files (config.controller 22, entity-limits 5, impersonation 3,
 * data.controller 6 config touches). Each query/write below is a VERBATIM
 * relocation of the legacy statement it replaces — same table, same where-clause,
 * same column set, same ordering, same escaping — EXCEPT the human-approved P1
 * timestamp correction (see INVARIANT P1).
 *
 * REFACTOR (behavior-identical) EXCEPT the P1 correction. The 4 legacy files are
 * NOT yet repointed (W6); this module only ADDS the adapter.
 *
 * ── CONNECTION (ADR-0002 — lib/db, NOT src/db.js) ────────────────────────────
 * Obtains its knex via `lib/db` (`require('../../../lib/db').getDefaultDb()`),
 * the same shared pool `src/db.js` re-exports — exactly the weather/task repo
 * pattern. It NEVER `require('../../../db')`. The connection is injectable so the
 * unit/contract tests run with a test-bed handle. Per-env values (host/port/etc.)
 * come from the knexfile, which reads typed env — the adapter itself reads no
 * `process.env` (lib-config discipline; `domain/` never reads env either).
 *
 * ── BINDING INVARIANTS ───────────────────────────────────────────────────────
 *
 * INVARIANT P1 (timestamps via new Date(), NEVER db.fn.now() — ADR-0003):
 *   The data-driven `P1_DATE_COLUMNS` set — `created_at`, `updated_at` — is
 *   stamped exclusively with JS `new Date()` throughout this repository. There is
 *   intentionally ZERO `fn.now()` reference in this file. The legacy code wrongly
 *   passes `getDb().fn.now()` on the config update paths (config.controller.js:126
 *   updateConfig, :230 reorderProjects, :271/:276 updateProject) and
 *   `trx.fn.now()` on the import insert path (data.controller.js:123-124) — a
 *   pre-existing P1/ADR-0003 violation (circular-JSON serialization break,
 *   root-caused 2026-05-12). `withTimestamp()` enforces the correction: it stamps
 *   `updated_at = new Date()` when omitted and asserts (fail-loud) that any
 *   caller-supplied value in P1_DATE_COLUMNS is a real JS Date.
 *
 *   The legacy INSERT paths that relied on the column DEFAULT for the timestamps
 *   (updateConfig INSERT :129-133, createProject :247, the import bulk inserts,
 *   the location/tool replace inserts) did NOT set created_at/updated_at at all —
 *   the `defaultTo(knex.fn.now())` column default fills them server-side. That is
 *   a DEFAULT clause, NOT a value-level `fn.now()` raw, so it is OUTSIDE the P1
 *   scope (no circular-JSON risk) and is preserved verbatim — this repo does not
 *   add timestamps to those inserts.
 *
 * INVARIANT C-TX (transaction boundaries preserved):
 *   `runInTransaction(work)` runs `work(trxRepo)` inside one `db.transaction`,
 *   committing on resolve / rolling back on reject — the legacy
 *   `getDb().transaction(async trx => …)` boundary. `trxRepo` is a
 *   KnexConfigRepository bound to the trx handle, so its reads/writes participate
 *   in the same transaction.
 *
 * INVARIANT C-TENANCY (user_id scoping preserved):
 *   Config reads/writes are scoped by userId exactly as the legacy queries were.
 *   The impersonation list queries are admin-scoped (NOT user-tenant-scoped) — the
 *   legacy code runs them behind the admin authz gate without a user_id filter;
 *   that is preserved as-is.
 *
 * ── NO NEW FALLBACKS ─────────────────────────────────────────────────────────
 * No `||`/`??` fallback for a maybe-missing value is introduced. The `row || null`
 * on the single-row reads matches the characterized legacy `.first()` shape (the
 * controller's `existing` probe is a truthy/falsy check on the row).
 */

'use strict';

var UserConfig = require('../domain/entities/UserConfig');
var { stampInsert, stampUpdate } = require('../../../lib/audit-context'); // 999.1576 inc.3b

var CONFIG_REPOSITORY_PORT_METHODS =
  require('../domain/ports/ConfigRepositoryPort').CONFIG_REPOSITORY_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Function} [deps.db] Knex instance or trx handle (default: lib/db's
 *   shared singleton via getDefaultDb() — the same pool src/db.js re-exports,
 *   ADR-0002). NEVER src/db.js.
 */
function KnexConfigRepository(deps) {
  var d = deps || {};
  this.db = d.db || require('../../../lib/db').getDefaultDb();
}

// ── P1 timestamp discipline ──────────────────────────────────────────────────

/**
 * Timestamp columns this repository writes that MUST be JS Dates (P1). The guard
 * is data-driven so any future addition of a date column to a write path is caught.
 */
var P1_DATE_COLUMNS = ['created_at', 'updated_at'];

/**
 * Assert a value is a JS Date (P1 fail-loud guard). A Knex `fn.now()` raw or a
 * string slipping into a P1_DATE_COLUMNS field is caught here rather than
 * corrupting the write (circular-JSON break, 2026-05-12). `null` is allowed (a
 * valid SQL value that cannot carry a Knex raw).
 * @param {*} v
 * @param {string} field
 */
function assertDate(v, field) {
  if (v !== null && !(v instanceof Date)) {
    throw new TypeError(
      'KnexConfigRepository: ' + field +
      ' must be a JS Date or null (INVARIANT P1 — new Date()/null, never db.fn.now())'
    );
  }
}

/**
 * Return a shallow copy of `changes` with `updated_at` guaranteed to be a JS Date
 * (P1), and all P1_DATE_COLUMNS asserted if present. Where the legacy code passed
 * `getDb().fn.now()`/`trx.fn.now()` for updated_at, the repository passes a real
 * Date instead.
 * @param {Object} changes
 * @returns {Object}
 */
function withTimestamp(changes) {
  var out = Object.assign({}, changes);
  P1_DATE_COLUMNS.forEach(function (col) {
    if (col !== 'updated_at' && out[col] !== undefined) {
      assertDate(out[col], col);
    }
  });
  if (out.updated_at !== undefined) {
    assertDate(out.updated_at, 'updated_at');
  } else {
    out.updated_at = new Date(); // P1: new Date(), NEVER db.fn.now()
  }
  // 999.1576 inc.3b: withTimestamp is the update choke for this repo — every
  // update also records WHO (soft until the inc.4 tightening).
  return stampUpdate(out);
}

// ── USER_CONFIG ──────────────────────────────────────────────────────────────

/**
 * All user_config rows for the user (raw rows). Verbatim relocation of
 * getAllConfig's read (config.controller.js:48) / export's read (data.controller:224).
 * @param {string} userId
 * @returns {Promise<Object[]>}
 */
KnexConfigRepository.prototype.getConfigRows = function getConfigRows(userId) {
  return this.db('user_config').where('user_id', userId);
};

/**
 * The user's configured timezone (users.timezone), or null when unset (A1).
 * @param {string} userId
 * @returns {Promise<?string>}
 */
KnexConfigRepository.prototype.getUserTimezone = function getUserTimezone(userId) {
  return this.db('users')
    .where('id', userId)
    .select('timezone')
    .first()
    .then(function (row) { return row && row.timezone ? row.timezone : null; });
};

/**
 * Single config record mapped to the W2 UserConfig entity, or null. Verbatim
 * relocation of updateConfig's existence probe (config.controller.js:121).
 * @param {string} userId
 * @param {string} configKey
 * @returns {Promise<?UserConfig>}
 */
KnexConfigRepository.prototype.getUserConfig = function getUserConfig(userId, configKey) {
  return this.db('user_config')
    .where({ user_id: userId, config_key: configKey })
    .first()
    .then(function (row) { return row ? UserConfig.fromRow(row) : null; });
};

/**
 * Single config record as the RAW row, or null. Same probe as getUserConfig.
 * Verbatim relocation of entity-limits countScheduleTemplates read
 * (entity-limits.js:105) and updateConfig's existence probe (config.controller:121).
 * @param {string} userId
 * @param {string} configKey
 * @returns {Promise<?Object>}
 */
KnexConfigRepository.prototype.getConfigRow = function getConfigRow(userId, configKey) {
  return this.db('user_config')
    .where({ user_id: userId, config_key: configKey })
    .first()
    .then(function (row) { return row || null; });
};

/**
 * Insert-or-update one config row. UPDATE sets config_value + updated_at (P1 new
 * Date()); INSERT sets user_id/config_key/config_value only (legacy INSERT did not
 * set updated_at — the column default applies; preserved). Verbatim relocation of
 * updateConfig's existing?update:insert (config.controller.js:121-134).
 * @param {string} userId
 * @param {string} configKey
 * @param {string} serializedValue  the JSON.stringify(value) the controller computed
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.upsertConfig = function upsertConfig(userId, configKey, serializedValue) {
  var db = this.db;
  return db('user_config').where({ user_id: userId, config_key: configKey }).first()
    .then(function (existing) {
      if (existing) {
        return db('user_config').where({ user_id: userId, config_key: configKey }).update(withTimestamp({
          config_value: serializedValue
        }));
      }
      return db('user_config').insert(stampInsert({
        user_id: userId,
        config_key: configKey,
        config_value: serializedValue
      }));
    })
    .then(function () { /* void — match legacy (no return value used) */ });
};

// ── PROJECTS ─────────────────────────────────────────────────────────────────

/**
 * The user's projects ordered by sort_order. Verbatim relocation of getProjects
 * (config.controller.js:198) / getAllConfig:47 / export:223.
 * @param {string} userId
 * @returns {Promise<Object[]>}
 */
KnexConfigRepository.prototype.getProjects = function getProjects(userId) {
  return this.db('projects').where('user_id', userId).orderBy('sort_order');
};

/**
 * MAX(sort_order) for the user, or null. Verbatim relocation of createProject's
 * max probe (config.controller.js:246).
 * @param {string} userId
 * @returns {Promise<?number>}
 */
KnexConfigRepository.prototype.getMaxProjectSortOrder = function getMaxProjectSortOrder(userId) {
  return this.db('projects').where('user_id', userId).max('sort_order as max').first()
    .then(function (row) { return row ? row.max : null; });
};

/**
 * Insert one project row, returning the auto-increment id. Verbatim relocation of
 * createProject's insert (config.controller.js:247, which destructured `[id]`).
 * @param {string} userId
 * @param {Object} project  { name, color, icon, sort_order }
 * @returns {Promise<number>}
 */
KnexConfigRepository.prototype.insertProject = function insertProject(userId, project) {
  return this.db('projects').insert(stampInsert({
    user_id: userId,
    name: project.name,
    color: project.color,
    icon: project.icon,
    sort_order: project.sort_order
  })).then(function (res) { return Array.isArray(res) ? res[0] : res; });
};

/**
 * Update one project by (id, user). P1: updated_at forced to new Date() when
 * omitted. Verbatim relocation of updateProject's update (config.controller.js:269).
 * @param {string} userId
 * @param {*} projectId
 * @param {Object} changes  e.g. { name, color, icon }
 * @returns {Promise<number>} rows updated
 */
KnexConfigRepository.prototype.updateProjectById = function updateProjectById(userId, projectId, changes) {
  return this.db('projects').where({ id: projectId, user_id: userId }).update(withTimestamp(changes));
};

/**
 * Delete one project by (id, user). Verbatim relocation of deleteProject
 * (config.controller.js:292).
 * @param {string} userId
 * @param {*} projectId
 * @returns {Promise<number>} rows deleted
 */
KnexConfigRepository.prototype.deleteProjectById = function deleteProjectById(userId, projectId) {
  return this.db('projects').where({ id: projectId, user_id: userId }).del();
};

/**
 * Apply a sort_order reorder via a single CASE expression over whereIn(ids),
 * stamping updated_at (P1). Verbatim relocation of reorderProjects' CASE-update
 * (config.controller.js:218-231) — the legacy code built the same CASE expression
 * and bindings, then `.update({ sort_order: trx.raw(caseExpr, bindings), updated_at })`.
 * @param {string} userId
 * @param {Array<[number, number]>} idOrderPairs  [[id, sortOrder], …]
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.reorderProjects = function reorderProjects(userId, idOrderPairs) {
  var db = this.db;
  if (!Array.isArray(idOrderPairs) || idOrderPairs.length === 0) return Promise.resolve();
  var ids = [];
  var caseExpr = 'CASE id';
  var bindings = [];
  idOrderPairs.forEach(function (pair) {
    var id = pair[0];
    var sortOrder = pair[1];
    ids.push(id);
    caseExpr += ' WHEN ? THEN ?';
    bindings.push(id, sortOrder);
  });
  caseExpr += ' ELSE sort_order END';
  return db('projects')
    .where('user_id', userId)
    .whereIn('id', ids)
    .update(withTimestamp({ sort_order: db.raw(caseExpr, bindings) }))
    .then(function () { /* void */ });
};

// ── LOCATIONS ────────────────────────────────────────────────────────────────

/**
 * The user's locations ordered by sort_order. Verbatim relocation of getLocations
 * (config.controller.js:305) / getAllConfig:45 / export:221.
 * @param {string} userId
 * @returns {Promise<Object[]>}
 */
KnexConfigRepository.prototype.getLocations = function getLocations(userId) {
  return this.db('locations').where('user_id', userId).orderBy('sort_order');
};

/**
 * Delete-all-then-insert the user's locations (replace-all). Verbatim relocation
 * of replaceLocations' trx body (config.controller.js:336-350). MUST be called
 * within runInTransaction (this.db is then the trx handle), matching the legacy
 * boundary. The `rows` are the legacy-shaped insert objects the controller built.
 * @param {string} userId
 * @param {Object[]} rows
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.replaceLocations = function replaceLocations(userId, rows) {
  var db = this.db;
  return db('locations').where('user_id', userId).del()
    .then(function () {
      if (rows && rows.length > 0) {
        return db('locations').insert(rows.map(stampInsert));
      }
    })
    .then(function () { /* void */ });
};

// ── TOOLS ────────────────────────────────────────────────────────────────────

/**
 * The user's tools ordered by sort_order. Verbatim relocation of getTools
 * (config.controller.js:364) / getAllConfig:46 / export:222.
 * @param {string} userId
 * @returns {Promise<Object[]>}
 */
KnexConfigRepository.prototype.getTools = function getTools(userId) {
  return this.db('tools').where('user_id', userId).orderBy('sort_order');
};

/**
 * Delete-all-then-insert the user's tools (replace-all). Verbatim relocation of
 * replaceTools' trx body (config.controller.js:378-389). MUST be called within
 * runInTransaction.
 * @param {string} userId
 * @param {Object[]} rows
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.replaceTools = function replaceTools(userId, rows) {
  var db = this.db;
  return db('tools').where('user_id', userId).del()
    .then(function () {
      if (rows && rows.length > 0) {
        return db('tools').insert(rows.map(stampInsert));
      }
    })
    .then(function () { /* void */ });
};

// ── ENTITY-LIMIT COUNTS (entity-limits.js) ───────────────────────────────────

/**
 * Active task count. Verbatim relocation of countActiveTasks
 * (entity-limits.js:66-76) — same tasks_v where-clause + the
 * `whereNull(task_type) OR task_type != 'recurring_template'` group, parseInt'd.
 * @param {string} userId
 * @returns {Promise<number>}
 */
KnexConfigRepository.prototype.countActiveTasks = function countActiveTasks(userId) {
  return this.db('tasks_v')
    .where('user_id', userId)
    .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled', 'cancelled'])
    .where(function () {
      this.whereNull('task_type').orWhereNot('task_type', 'recurring_template');
    })
    .count('* as count')
    .first()
    .then(function (result) { return parseInt(result.count, 10); });
};

/**
 * recurring_template count. Verbatim relocation of countRecurringTemplates
 * (entity-limits.js:78-86).
 *
 * CHARACTERIZED QUIRK (preserved, NOT fixed): the tasks_v view's recurring_template
 * branch hardcodes `status` to NULL, and `NULL NOT IN (…)` excludes the row, so this
 * count is effectively always 0 in practice. That is the legacy behavior — reproduced
 * verbatim here; any correction is out of W3 scope.
 * @param {string} userId
 * @returns {Promise<number>}
 */
KnexConfigRepository.prototype.countRecurringTemplates = function countRecurringTemplates(userId) {
  return this.db('tasks_v')
    .where('user_id', userId)
    .where('task_type', 'recurring_template')
    .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled', 'cancelled'])
    .count('* as count')
    .first()
    .then(function (result) { return parseInt(result.count, 10); });
};

/**
 * Project count. Verbatim relocation of countProjects (entity-limits.js:88-94).
 * @param {string} userId
 * @returns {Promise<number>}
 */
KnexConfigRepository.prototype.countProjects = function countProjects(userId) {
  return this.db('projects')
    .where('user_id', userId)
    .count('* as count')
    .first()
    .then(function (result) { return parseInt(result.count, 10); });
};

/**
 * Location count. Verbatim relocation of countLocations (entity-limits.js:96-102).
 * @param {string} userId
 * @returns {Promise<number>}
 */
KnexConfigRepository.prototype.countLocations = function countLocations(userId) {
  return this.db('locations')
    .where('user_id', userId)
    .count('* as count')
    .first()
    .then(function (result) { return parseInt(result.count, 10); });
};

// ── PROJECT TASK COUNTS (MCP list_projects) ────────────────────────────────────

/**
 * Per-project task counts from tasks_v. Verbatim relocation of the MCP
 * list_projects aggregation (mcp/tools/config.js:76-81): where('user_id') +
 * whereIn('project', names) + groupBy('project') + COUNT(*) as total +
 * SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done.
 *
 * Returns [] when projectNames is empty (whereIn with an empty array produces
 * no rows in MySQL; the in-memory double matches by short-circuiting).
 * @param {string} userId
 * @param {string[]} projectNames  project names to count (may be empty)
 * @returns {Promise<Array<{project: string, total: number, done: number}>>}
 */
KnexConfigRepository.prototype.getProjectTaskCounts = function getProjectTaskCounts(userId, projectNames) {
  if (!Array.isArray(projectNames) || projectNames.length === 0) return Promise.resolve([]);
  var db = this.db;
  return db('tasks_v')
    .where('user_id', userId)
    .whereIn('project', projectNames)
    .groupBy('project')
    .select(
      'project',
      db.raw('COUNT(*) as total'),
      db.raw("SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done")
    );
};

// ── ORPHAN WHEN-TAGS (config.controller schedule_templates save) ─────────────

/**
 * The active, non-empty/non-'anytime' when-tagged tasks. Verbatim relocation of
 * the activeTasks read in updateConfig (config.controller.js:148-154) — same
 * tasks_v where-clause, selecting id, text, when.
 * @param {string} userId
 * @returns {Promise<Object[]>}
 */
KnexConfigRepository.prototype.getActiveWhenTaggedTasks = function getActiveWhenTaggedTasks(userId) {
  return this.db('tasks_v')
    .where('user_id', userId)
    .whereNotIn('status', ['done', 'cancel', 'skip', 'pause', 'cancelled'])
    .whereNotNull('when')
    .where('when', '!=', '')
    .where('when', '!=', 'anytime')
    .select('id', 'text', 'when');
};

// ── DATA EXPORT/IMPORT (config tables only) ──────────────────────────────────

/**
 * Delete the user's user_config, tools, locations, projects rows (import wipe of
 * CONFIG tables). Relocation of importData's config wipe (data.controller.js:70-73).
 * MUST be called within runInTransaction. The task wipe (data.controller.js:75
 * deleteTasksWhere) stays with the task slice.
 *
 * 999.1603: when `configKeys` is a non-empty array, the user_config delete is
 * SELECTIVE (only those keys) so config rows the import does not rewrite survive
 * a replace-mode import. Omitted/empty → full user_config wipe (legacy behavior).
 * tools/locations/projects are always a full wipe (v7 replace contract).
 * @param {string} userId
 * @param {string[]} [configKeys]  config_key values to delete; absent = all.
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.clearUserConfigTables = function clearUserConfigTables(userId, configKeys) {
  var db = this.db;
  var configDelete = db('user_config').where('user_id', userId);
  if (Array.isArray(configKeys) && configKeys.length > 0) {
    configDelete = configDelete.whereIn('config_key', configKeys);
  }
  return configDelete.del()
    .then(function () { return db('tools').where('user_id', userId).del(); })
    .then(function () { return db('locations').where('user_id', userId).del(); })
    .then(function () { return db('projects').where('user_id', userId).del(); })
    .then(function () { /* void */ });
};

/**
 * Bulk insert location rows (import path — no prior delete). Verbatim relocation of
 * importData's locations insert (data.controller.js:136).
 * @param {string} userId
 * @param {Object[]} rows
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.insertLocations = function insertLocations(userId, rows) {
  if (!rows || rows.length === 0) return Promise.resolve();
  return this.db('locations').insert(rows.map(stampInsert)).then(function () { /* void */ });
};

/**
 * Bulk insert tool rows (import path). Verbatim relocation of importData's tools
 * insert (data.controller.js:149).
 * @param {string} userId
 * @param {Object[]} rows
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.insertTools = function insertTools(userId, rows) {
  if (!rows || rows.length === 0) return Promise.resolve();
  return this.db('tools').insert(rows.map(stampInsert)).then(function () { /* void */ });
};

/**
 * Bulk insert project rows (import path). Verbatim relocation of importData's
 * projects insert (data.controller.js:162).
 * @param {string} userId
 * @param {Object[]} rows
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.insertProjects = function insertProjects(userId, rows) {
  if (!rows || rows.length === 0) return Promise.resolve();
  return this.db('projects').insert(rows.map(stampInsert)).then(function () { /* void */ });
};

/**
 * Bulk insert user_config rows (import path). Verbatim relocation of importData's
 * config insert (data.controller.js:184-190). The legacy code always inserts the
 * 7 config rows (no empty short-circuit); callers pass the full set.
 * @param {string} userId
 * @param {Object[]} rows
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.insertConfigRows = function insertConfigRows(userId, rows) {
  if (!rows || rows.length === 0) return Promise.resolve();
  return this.db('user_config').insert(rows.map(stampInsert)).then(function () { /* void */ });
};

// ── IMPERSONATION (impersonation.controller.js) ──────────────────────────────

/**
 * Insert one impersonation_log audit row. created_at/updated_at are JS Dates (P1)
 * — the legacy already wrote new Date() here (impersonation.controller.js:36-37),
 * preserved and asserted. Verbatim relocation of insertAuditRow's insert
 * (impersonation.controller.js:30-37).
 * @param {Object} row  { admin_user_id, target_user_id, action, ip_address,
 *   user_agent, created_at, updated_at }
 * @returns {Promise<void>}
 */
KnexConfigRepository.prototype.insertImpersonationLog = function insertImpersonationLog(row) {
  if (row) {
    P1_DATE_COLUMNS.forEach(function (col) {
      if (row[col] !== undefined) assertDate(row[col], col);
    });
  }
  return this.db('impersonation_log').insert(stampInsert(row)).then(function () { /* void */ });
};

/**
 * Admin user-search list + total. Verbatim relocation of getImpersonationTargets'
 * queries (impersonation.controller.js:102-111): users(id,email,created_at) with
 * the escaped LIKE on email, the cloned count, ordered by email, paginated.
 * NOT user-tenant-scoped (admin query behind the authz gate) — preserved as-is.
 * @param {{search?: string, limit: number, offset: number}} opts
 * @returns {Promise<{users: Object[], total: number}>}
 */
KnexConfigRepository.prototype.listImpersonationTargets = function listImpersonationTargets(opts) {
  var o = opts || {};
  var query = this.db('users').select('id', 'email', 'created_at');
  if (o.search) {
    var escaped = String(o.search).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    query = query.where('email', 'like', '%' + escaped + '%');
  }
  var countQuery = query.clone().clearSelect().count('* as count');
  return countQuery.then(function (countRows) {
    var count = countRows[0].count;
    return query.orderBy('email').limit(o.limit).offset(o.offset).then(function (users) {
      return { users: users, total: parseInt(count) };
    });
  });
};

/**
 * impersonation_log list joined to admin email + total. Verbatim relocation of
 * getImpersonationLog's queries (impersonation.controller.js:130-144): the
 * leftJoin to admin email, optional admin/target filters, ordered by
 * created_at desc, the cloned count (clearSelect + clearOrder), paginated.
 * @param {{limit: number, offset: number, adminUserId?: string, targetUserId?: string}} opts
 * @returns {Promise<{logs: Object[], total: number}>}
 */
KnexConfigRepository.prototype.listImpersonationLog = function listImpersonationLog(opts) {
  var o = opts || {};
  var query = this.db('impersonation_log')
    .select('impersonation_log.*', 'admin_users.email as admin_email')
    .leftJoin('users as admin_users', 'impersonation_log.admin_user_id', 'admin_users.id')
    .orderBy('impersonation_log.created_at', 'desc');

  if (o.adminUserId) query = query.where('impersonation_log.admin_user_id', o.adminUserId);
  if (o.targetUserId) query = query.where('impersonation_log.target_user_id', o.targetUserId);

  var countQuery = query.clone().clearSelect().clearOrder().count('impersonation_log.id as count');
  return countQuery.then(function (countRows) {
    var count = countRows[0].count;
    return query.limit(o.limit).offset(o.offset).then(function (logs) {
      return { logs: logs, total: parseInt(count) };
    });
  });
};

// ── TRANSACTIONS (INVARIANT C-TX) ────────────────────────────────────────────

/**
 * Run `work(trxRepo)` inside one DB transaction — commits on resolve, rolls back
 * on reject (the legacy `getDb().transaction(async trx => …)` boundary). `trxRepo`
 * is a KnexConfigRepository bound to the trx handle.
 * @template T
 * @param {(trxRepo: KnexConfigRepository) => Promise<T>} work
 * @returns {Promise<T>}
 */
KnexConfigRepository.prototype.runInTransaction = function runInTransaction(work) {
  return this.db.transaction(function (trx) {
    var trxRepo = new KnexConfigRepository({ db: trx });
    return work(trxRepo);
  });
};

KnexConfigRepository.CONFIG_REPOSITORY_PORT_METHODS = CONFIG_REPOSITORY_PORT_METHODS;

module.exports = KnexConfigRepository;
