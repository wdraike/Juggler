/**
 * KnexTaskRepository — concrete TaskRepositoryPort implementation
 * (TASK_REPOSITORY_PORT_METHODS). Phase H3 / W3.
 *
 * Absorbs the task DB reads/writes that today live inline across the 2,461-ln
 * `src/controllers/task.controller.js` (the 66 `getDb(` + 12 `trx(` call sites).
 * The read logic is lifted VERBATIM from the controller's data-access helpers
 * (`fetchTaskWithEventIds` ~219, `fetchTasksWithEventIds` ~266, `getTasksVersion`
 * ~645, `expandToAllInstanceIds` ~112, the getTask templateRows read ~694, the
 * applySplitDefault user_config read ~739). The write logic delegates to the
 * REAL master/instance write module `src/lib/tasks-write` (insertTask /
 * insertTasksBatch / updateTaskById / deleteTaskById / *Where) — the repository
 * does NOT reinvent the master/instance routing.
 *
 * REFACTOR (behavior-identical) EXCEPT the human-approved P1 correction below.
 * The controller is NOT yet repointed (W6); this module only ADDS the adapter.
 *
 * ── CONNECTION (ADR-0002 — lib/db, NOT src/db.js) ────────────────────────────
 * Obtains its knex via `lib/db` (`require('../../../lib/db').getDefaultDb()`),
 * the same shared pool `src/db.js` re-exports — exactly the weather repo pattern.
 * It NEVER `require('../../../db')`. This is the ADR-0002 delta that removes the
 * task slice from the `src/db.js` importer set (completed at W6 when the
 * controller repoints). The connection is injectable so the unit/contract tests
 * run with a stub or a test-bed handle.
 *
 * ── BINDING INVARIANTS ───────────────────────────────────────────────────────
 *
 * INVARIANT P1 (timestamps via new Date(), NEVER db.fn.now() — ADR-0003):
 *   The data-driven `P1_DATE_COLUMNS` set — `created_at`, `updated_at`,
 *   `completed_at`, `scheduled_at` — is stamped exclusively with JS `new Date()`
 *   throughout this repository. There is intentionally ZERO `fn.now()` reference
 *   in this file. The legacy controller wrongly passes `getDb().fn.now()` on ~8
 *   update paths (992,1029,1033,1036,1147,1208,1223,1227) + `trx.fn.now()`
 *   (1261-62) — a pre-existing P1/ADR-0003 violation (circular-JSON serialization
 *   break, root-caused 2026-05-12). `withTimestamp()` enforces the correction:
 *   it stamps `updated_at = new Date()` when omitted, and asserts (fail-loud) that
 *   any caller-supplied value in P1_DATE_COLUMNS is a real JS Date.
 *
 *   `synced_at` (cal_sync_ledger) and `rolling_anchor` (task_masters) are
 *   intentionally NOT in P1_DATE_COLUMNS: they are written via direct `.update()`
 *   calls in the controller, not routed through `updateTaskById` / `splitUpdateFields`
 *   (this repo's write path), so they are outside this repository's timestamp scope.
 *
 * INVARIANT T-TX (transaction boundaries preserved):
 *   `runInTransaction(work)` runs `work(trxRepo)` inside one `db.transaction`,
 *   committing on resolve / rolling back on reject — the legacy
 *   `getDb().transaction(async trx => …)` boundary. `trxRepo` is a
 *   KnexTaskRepository bound to the trx handle, so its reads see the
 *   transaction's uncommitted writes (the legacy `trx('…')` reads).
 *
 * INVARIANT T-TENANCY (user_id scoping preserved):
 *   Reads/writes are scoped by userId exactly as the legacy queries were; the
 *   tasks-write `requireUserId` guard is preserved (delegated, not bypassed).
 *
 * ── NO NEW FALLBACKS ─────────────────────────────────────────────────────────
 * Every `||` below is PRESERVED VERBATIM from the legacy helper it relocates
 * (e.g. `ev && ev.gcal_event_id || null`, `row.max_updated ? … : '0'`). No new
 * `||`/`??` fallback is introduced.
 */

'use strict';

var tasksWrite = require('../../../lib/tasks-write');

var TASK_REPOSITORY_PORT_METHODS =
  require('../domain/ports/TaskRepositoryPort').TASK_REPOSITORY_PORT_METHODS;

/**
 * @param {Object} [deps]
 * @param {Function} [deps.db] Knex instance or trx handle (default: lib/db's
 *   shared singleton via getDefaultDb() — the same pool src/db.js re-exports,
 *   ADR-0002). NEVER src/db.js.
 * @param {Object} [deps.tasksWrite] master/instance write module (default: the
 *   real `src/lib/tasks-write`) — injectable for unit tests.
 */
function KnexTaskRepository(deps) {
  var d = deps || {};
  this.db = d.db || require('../../../lib/db').getDefaultDb();
  this.tasksWrite = d.tasksWrite || tasksWrite;
}

// ── P1 timestamp discipline ──────────────────────────────────────────────────

/**
 * All timestamp columns this repository writes via updateTaskById / updateTasksWhere
 * / updateInstancesWhere that MUST be JS Dates (P1). The guard is data-driven so
 * any future addition of a date column to the write path is caught automatically.
 *
 * Columns included and why:
 *   created_at  — MASTER_FIELDS + INSTANCE_FIELDS (insert paths)
 *   updated_at  — mirrors to both tables in splitUpdateFields
 *   completed_at — INSTANCE_UPDATE_FIELDS (controller L1751 stamps fn.now())
 *   scheduled_at — INSTANCE_UPDATE_FIELDS (controller L1765,1783 stamps fn.now())
 *
 * NOT included (out of this repo's write path):
 *   synced_at    — lives on cal_sync_ledger, written via direct .update() in controller,
 *                  not routed through updateTaskById/splitUpdateFields
 *   rolling_anchor — DATE column on task_masters, written via direct .update() in
 *                    controller (L1805), not routed through this repo's write methods
 */
var P1_DATE_COLUMNS = ['created_at', 'updated_at', 'completed_at', 'scheduled_at'];

/**
 * Assert a value is a JS Date (P1 fail-loud guard). A Knex `fn.now()` raw or a
 * string slipping into any P1_DATE_COLUMNS field is caught here rather than
 * corrupting the write (circular-JSON break, 2026-05-12).
 *
 * `null` is EXPLICITLY ALLOWED: the legacy controller writes a real `null` to
 * clear these columns (e.g. `completed_at = null` on reopen — controller L1753;
 * `scheduled_at = null`). `null` is a valid SQL value and CANNOT carry a
 * circular-JSON Knex raw, so it is not a P1 violation. The guard rejects only a
 * NON-Date, NON-null value (a string/`fn.now()` raw).
 * @param {*} v
 * @param {string} field
 */
function assertDate(v, field) {
  if (v !== null && !(v instanceof Date)) {
    throw new TypeError(
      'KnexTaskRepository: ' + field + ' must be a JS Date or null (INVARIANT P1 — new Date()/null, never db.fn.now())'
    );
  }
}

/**
 * Return a shallow copy of `changes` with `updated_at` guaranteed to be a JS
 * Date (P1), and ALL P1_DATE_COLUMNS asserted to be Dates if present. If
 * `updated_at` is absent, stamp `new Date()`. This is the P1 correction: where
 * the legacy controller passed `getDb().fn.now()` for updated_at, completed_at,
 * or scheduled_at, the repository passes a real Date instead.
 * @param {Object} changes
 * @returns {Object}
 */
function withTimestamp(changes) {
  var out = Object.assign({}, changes);
  // Assert every P1 date column that the caller supplied (fail-loud on fn.now() raws).
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
  return out;
}

// ── READS (lifted verbatim from the controller helpers) ──────────────────────

/**
 * Single-row lookup with calendar event ids attached. Verbatim relocation of
 * the legacy `fetchTaskWithEventIds` (controller ~219).
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<?Object>}
 */
KnexTaskRepository.prototype.fetchTaskWithEventIds = function fetchTaskWithEventIds(id, userId) {
  var dbOrTrx = this.db;
  return Promise.all([
    dbOrTrx('tasks_v').where({ id: id, user_id: userId }).first(),
    dbOrTrx('cal_sync_ledger')
      .where({ task_id: id, status: 'active' })
      .select('provider', 'provider_event_id', 'origin', 'event_url')
  ]).then(function (res) {
    var row = res[0];
    var ledgerRows = res[1];
    if (!row) return null;
    // Attach event ids in the same shape tasks_with_sync_v exposes.
    row.gcal_event_id = null;
    row.msft_event_id = null;
    row.apple_event_id = null;
    row.cal_sync_origin = null;
    row.cal_event_url = null;
    row.apple_calendar_name = null;
    row.cal_locked = 0;
    var appleCalendarId = null;
    for (var i = 0; i < ledgerRows.length; i++) {
      var p = ledgerRows[i].provider;
      if (p === 'gcal') { row.gcal_event_id = ledgerRows[i].provider_event_id; }
      else if (p === 'msft') { row.msft_event_id = ledgerRows[i].provider_event_id; }
      else if (p === 'apple') {
        row.apple_event_id = ledgerRows[i].provider_event_id;
        if (ledgerRows[i].calendar_id) appleCalendarId = ledgerRows[i].calendar_id;
      }
      // Use the first active ledger row for origin/url (multi-provider: pick non-juggler origin if present)
      if (!row.cal_sync_origin || row.cal_sync_origin === 'juggler') {
        row.cal_sync_origin = ledgerRows[i].origin || null;
        row.cal_event_url = ledgerRows[i].event_url || null;
      }
      // cal_locked: task is calendar-born if any active ledger row has a provider origin
      if (ledgerRows[i].origin && ledgerRows[i].origin !== 'juggler') {
        row.cal_locked = 1;
      }
    }
    if (appleCalendarId) {
      return dbOrTrx('user_calendars')
        .where({ user_id: userId, provider: 'apple', calendar_id: appleCalendarId })
        .select('display_name').first()
        .then(function (appleCalRow) {
          if (appleCalRow && appleCalRow.display_name) row.apple_calendar_name = appleCalRow.display_name;
          return row;
        });
    }
    return row;
  });
};

/**
 * Bulk equivalent of fetchTaskWithEventIds. Verbatim relocation of the legacy
 * `fetchTasksWithEventIds` (controller ~266). `queryBuilder` lets callers add
 * .where/.orderBy/.limit/.offset to the tasks_v read before it runs.
 * @param {string} userId
 * @param {(q: Object) => void} [queryBuilder]
 * @returns {Promise<Object[]>}
 */
KnexTaskRepository.prototype.fetchTasksWithEventIds = function fetchTasksWithEventIds(userId, queryBuilder) {
  var dbOrTrx = this.db;
  var q = dbOrTrx('tasks_v').where('user_id', userId);
  if (typeof queryBuilder === 'function') queryBuilder(q);
  return Promise.all([
    q,
    dbOrTrx('cal_sync_ledger')
      .where({ user_id: userId, status: 'active' })
      .select('task_id', 'provider', 'provider_event_id', 'origin', 'event_url'),
    dbOrTrx('user_calendars')
      .where({ user_id: userId, provider: 'apple', enabled: true })
      .select('calendar_id', 'display_name')
  ]).then(function (res) {
    var rows = res[0];
    var ledgerRows = res[1];
    var appleCalRows = res[2];
    var appleCalMap = {};
    for (var ac = 0; ac < appleCalRows.length; ac++) {
      if (appleCalRows[ac].calendar_id && appleCalRows[ac].display_name) {
        appleCalMap[appleCalRows[ac].calendar_id] = appleCalRows[ac].display_name;
      }
    }
    var byTask = {};
    for (var j = 0; j < ledgerRows.length; j++) {
      var lr = ledgerRows[j];
      if (!lr.task_id) continue;
      var slot = byTask[lr.task_id] || (byTask[lr.task_id] = { cal_locked: 0 });
      if (lr.provider === 'gcal') slot.gcal_event_id = lr.provider_event_id;
      else if (lr.provider === 'msft') slot.msft_event_id = lr.provider_event_id;
      else if (lr.provider === 'apple') {
        slot.apple_event_id = lr.provider_event_id;
        if (lr.calendar_id) {
          slot.apple_calendar_name = appleCalMap[lr.calendar_id] || slot.apple_calendar_name || null;
        }
      }
      // Use non-juggler origin if present (prefer provider-origin over juggler-origin)
      if (!slot.cal_sync_origin || slot.cal_sync_origin === 'juggler') {
        slot.cal_sync_origin = lr.origin || null;
        slot.cal_event_url = lr.event_url || null;
      }
      // cal_locked: task is calendar-born if any active ledger row has a provider origin
      if (lr.origin && lr.origin !== 'juggler') {
        slot.cal_locked = 1;
      }
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var ev = byTask[r.id];
      r.gcal_event_id = ev && ev.gcal_event_id || null;
      r.msft_event_id = ev && ev.msft_event_id || null;
      r.apple_event_id = ev && ev.apple_event_id || null;
      r.cal_sync_origin = ev && ev.cal_sync_origin || null;
      r.cal_event_url = ev && ev.cal_event_url || null;
      r.apple_calendar_name = ev && ev.apple_calendar_name || null;
      r.cal_locked = ev ? ev.cal_locked : 0;
    }
    return rows;
  });
};

/**
 * FULLTEXT search across task descriptions and notes (999.253).
 *
 * Uses MySQL MATCH…AGAINST IN BOOLEAN MODE on the `ft_tasks_search`
 * FULLTEXT index (task_masters.text, task_masters.notes). The search
 * hits `task_masters` directly because FULLTEXT indexes cannot be
 * placed on views. Since `tasks_v` UNIONs task_masters with
 * task_instances↔task_masters (where text/notes always come from
 * task_masters), matching task_masters covers all tasks.
 *
 * Returns the same row shape as `fetchTasksWithEventIds` (tasks_v rows
 * + folded calendar event ids), so the caller can map them through
 * `rowToTask` identically to the list endpoint.
 *
 * @param {string} userId
 * @param {string} query  The search string (BOOLEAN MODE operators +,-,* are honored)
 * @returns {Promise<Object[]>}
 */
KnexTaskRepository.prototype.searchTasks = function searchTasks(userId, query) {
  var dbOrTrx = this.db;
  var searchExpr = '+(' + query.split(/\s+/).filter(Boolean).map(function (w) {
    return '+' + w + '*';
  }).join(' ') + ')';

  return Promise.all([
    dbOrTrx.raw(
      'SELECT m.*, ' +
      'MATCH(m.text, m.notes) AGAINST (? IN BOOLEAN MODE) AS _score ' +
      'FROM task_masters m ' +
      'WHERE m.user_id = ? AND MATCH(m.text, m.notes) AGAINST (? IN BOOLEAN MODE) ' +
      'ORDER BY _score DESC',
      [searchExpr, userId, searchExpr]
    ).then(function (res) {
      // MySQL2 wraps in [rows, fields] — normalize
      var rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
      // MySQL2 with dateStrings returns a plain array
      if (Array.isArray(rows) && rows.length > 0 && rows[0]._score !== undefined) {
        return rows;
      }
      // mysql2 .raw() may return { [0]: rows, [1]: fields } shape
      if (rows[0] && rows[0]._score !== undefined) {
        return rows;
      }
      return Array.isArray(rows) ? rows : [];
    }),
    dbOrTrx('cal_sync_ledger')
      .where({ user_id: userId, status: 'active' })
      .select('task_id', 'provider', 'provider_event_id', 'origin', 'event_url'),
    dbOrTrx('user_calendars')
      .where({ user_id: userId, provider: 'apple', enabled: true })
      .select('calendar_id', 'display_name')
  ]).then(function (res) {
    var masterRows = res[0];
    var ledgerRows = res[1];
    var appleCalRows = res[2];
    var appleCalMap = {};
    for (var ac = 0; ac < appleCalRows.length; ac++) {
      if (appleCalRows[ac].calendar_id && appleCalRows[ac].display_name) {
        appleCalMap[appleCalRows[ac].calendar_id] = appleCalRows[ac].display_name;
      }
    }
    var byTask = {};
    for (var j = 0; j < ledgerRows.length; j++) {
      var lr = ledgerRows[j];
      if (!lr.task_id) continue;
      var slot = byTask[lr.task_id] || (byTask[lr.task_id] = {});
      if (lr.provider === 'gcal') slot.gcal_event_id = lr.provider_event_id;
      else if (lr.provider === 'msft') slot.msft_event_id = lr.provider_event_id;
      else if (lr.provider === 'apple') {
        slot.apple_event_id = lr.provider_event_id;
        if (lr.calendar_id) {
          slot.apple_calendar_name = appleCalMap[lr.calendar_id] || slot.apple_calendar_name || null;
        }
      }
      if (!slot.cal_sync_origin || slot.cal_sync_origin === 'juggler') {
        slot.cal_sync_origin = lr.origin || null;
        slot.cal_event_url = lr.event_url || null;
      }
    }
    // Build tasks_v-style rows from the master rows, enriched with event ids.
    // Master-only fields come directly; instance-only fields are null (matching
    // the recurring_template branch of tasks_v).
    for (var i = 0; i < masterRows.length; i++) {
      var r = masterRows[i];
      var ev = byTask[r.id];
      r.gcal_event_id = ev && ev.gcal_event_id || null;
      r.msft_event_id = ev && ev.msft_event_id || null;
      r.apple_event_id = ev && ev.apple_event_id || null;
      r.cal_sync_origin = ev && ev.cal_sync_origin || null;
      r.cal_event_url = ev && ev.cal_event_url || null;
      r.apple_calendar_name = ev && ev.apple_calendar_name || null;
      // Remove internal score column — not part of the tasks_v row shape
      delete r._score;
    }
    return masterRows;
  });
};

/**
 * Cache-busting version token. Verbatim relocation of `getTasksVersion`
 * (controller ~645). `MAX(updated_at) || '0'` + ':' + `COUNT(*)`.
 * @param {string} userId
 * @returns {Promise<string>}
 */
KnexTaskRepository.prototype.getTasksVersion = function getTasksVersion(userId) {
  return this.db('tasks_v')
    .where('user_id', userId)
    .max('updated_at as max_updated')
    .count('* as cnt')
    .first()
    .then(function (row) {
      var ts = row && row.max_updated ? String(row.max_updated) : '0';
      var cnt = row ? String(row.cnt) : '0';
      return ts + ':' + cnt;
    });
};

/**
 * Cheap recurring-state lookup for one task (999.586 / ernie WARN-2): used by
 * UpdateTask to decide whether to skip depends_on existence validation, since a
 * recurring task's deps are stripped downstream. Only `recurring` + `task_type`
 * are read; user-scoped. Returns null if the task is not the user's.
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<{recurring:number, task_type:string, placement_mode:string|null}|null>}
 */
KnexTaskRepository.prototype.fetchTaskRecurring = function fetchTaskRecurring(id, userId) {
  return this.db('tasks_v')
    .where({ id: id, user_id: userId })
    .first('recurring', 'task_type', 'placement_mode');
};

/**
 * The user's recurring-template / recurring source rows (input to buildSourceMap).
 * Verbatim relocation of the getTask templateRows read (controller ~694).
 * @param {string} userId
 * @returns {Promise<Object[]>}
 */
KnexTaskRepository.prototype.getRecurringTemplateRows = function getRecurringTemplateRows(userId) {
  return this.db('tasks_v').where('user_id', userId)
    .where(function () { this.where('task_type', 'recurring_template').orWhere('recurring', 1); })
    .select();
};

/**
 * Expand a set of ids to include every sibling instance under any recurring
 * master they touch. Verbatim relocation of `expandToAllInstanceIds`
 * (controller ~112).
 * @param {string} userId
 * @param {string[]} ids
 * @returns {Promise<string[]>}
 */
KnexTaskRepository.prototype.expandToAllInstanceIds = function expandToAllInstanceIds(userId, ids) {
  var dbOrTrx = this.db;
  if (!Array.isArray(ids) || ids.length === 0) return Promise.resolve(ids || []);
  var masterIds = new Set();
  return dbOrTrx('task_masters')
    .where('user_id', userId)
    .whereIn('id', ids)
    .where('recurring', 1)
    .select('id')
    .then(function (masters) {
      masters.forEach(function (r) { masterIds.add(r.id); });
      return dbOrTrx('task_instances')
        .where('user_id', userId)
        .whereIn('id', ids)
        .select('id', 'master_id');
    })
    .then(function (insts) {
      insts.forEach(function (r) { if (r.master_id) masterIds.add(r.master_id); });
      if (masterIds.size === 0) return ids;
      return dbOrTrx('task_instances')
        .where('user_id', userId)
        .whereIn('master_id', Array.from(masterIds))
        .select('id')
        .then(function (siblings) {
          var out = {};
          ids.forEach(function (i) { out[i] = true; });
          masterIds.forEach(function (m) { out[m] = true; });
          siblings.forEach(function (r) { out[r.id] = true; });
          return Object.keys(out);
        });
    });
};

/**
 * The user's `preferences` config row from user_config, or null.
 * Verbatim relocation of the applySplitDefault read (controller ~739).
 * @param {string} userId
 * @returns {Promise<?Object>}
 */
KnexTaskRepository.prototype.getUserSplitPreference = function getUserSplitPreference(userId) {
  return this.db('user_config')
    .where({ user_id: userId, config_key: 'preferences' })
    .first()
    .then(function (row) { return row || null; });
};

/**
 * The raw task_masters row for (masterId, userId), or null. Verbatim relocation
 * of the loadMaster / applyRollingAnchor master read (controller ~1727/1790).
 * 999.354 (recurrence-read fold).
 * @param {string} masterId
 * @param {string} userId
 * @returns {Promise<?Object>}
 */
KnexTaskRepository.prototype.getMasterById = function getMasterById(masterId, userId) {
  return this.db('task_masters')
    .where({ id: masterId, user_id: userId })
    .first()
    .then(function (row) { return row || null; });
};

/**
 * The `{ id }` rows of a task's split siblings — same (user, master,
 * occurrence_ordinal), excluding `excludeId`. Verbatim relocation of
 * loadSplitSiblings (controller ~1818). 999.354 (recurrence-read fold).
 * @param {string} userId
 * @param {string} masterId
 * @param {number} occurrenceOrdinal
 * @param {string} excludeId
 * @returns {Promise<Object[]>}
 */
KnexTaskRepository.prototype.getSplitSiblingIds = function getSplitSiblingIds(userId, masterId, occurrenceOrdinal, excludeId) {
  return this.db('task_instances')
    .where({ user_id: userId, master_id: masterId, occurrence_ordinal: occurrenceOrdinal })
    .whereNot('id', excludeId)
    .select('id');
};

/**
 * After a recurring→one-shot toggle-off with .ignore(), the INSERT at
 * (master_id, occurrence_ordinal=1, split_ordinal=1) is skipped when a
 * pre-existing instance already owns that ordinal slot. This method finds the
 * surviving instance's OWN id so UpdateTask can re-read via tasks_v by the
 * correct id (not the master id, which is no longer in tasks_v after recurring=0).
 * Returns the instance id string, or null if no such row exists.
 * @param {string} masterId
 * @param {string} userId
 * @returns {Promise<?string>}
 */
KnexTaskRepository.prototype.fetchOneShottedInstanceId = function fetchOneShottedInstanceId(masterId, userId) {
  return this.db('task_instances')
    .where({ master_id: masterId, user_id: userId, occurrence_ordinal: 1, split_ordinal: 1 })
    .select('id')
    .first()
    .then(function (r) { return r ? r.id : null; });
};

// ── WRITES (delegate to lib/tasks-write; P1 new Date() timestamps) ────────────

/**
 * Insert ONE task (legacy tasks-shape row). The caller supplies created_at /
 * updated_at as JS Dates (P1); we assert + never substitute fn.now().
 * @param {Object} row
 * @returns {Promise<void>}
 */
KnexTaskRepository.prototype.insertTask = function insertTask(row) {
  if (row) {
    P1_DATE_COLUMNS.forEach(function (col) {
      if (row[col] !== undefined) assertDate(row[col], col);
    });
  }
  return Promise.resolve(this.tasksWrite.insertTask(this.db, row));
};

/**
 * Batch insert (legacy tasks-shape rows). Same P1 Date discipline per row.
 * @param {Object[]} rows
 * @returns {Promise<void>}
 */
KnexTaskRepository.prototype.insertTasksBatch = function insertTasksBatch(rows) {
  if (Array.isArray(rows)) {
    rows.forEach(function (row) {
      if (row) {
        P1_DATE_COLUMNS.forEach(function (col) {
          if (row[col] !== undefined) assertDate(row[col], col);
        });
      }
    });
  }
  return Promise.resolve(this.tasksWrite.insertTasksBatch(this.db, rows));
};

/**
 * Update one task by id (field-routed). P1: `updated_at` is forced to new Date()
 * when the caller omits it — replacing the legacy `getDb().fn.now()` writes.
 * @param {string} id
 * @param {Object} changes
 * @param {string} userId
 * @returns {Promise<{masterUpdated: number, instanceUpdated: number}>}
 */
KnexTaskRepository.prototype.updateTaskById = function updateTaskById(id, changes, userId) {
  return Promise.resolve(this.tasksWrite.updateTaskById(this.db, id, withTimestamp(changes), userId));
};

/**
 * Delete one task by id (both tables, tenancy-scoped).
 * @param {string} id
 * @param {string} userId
 * @returns {Promise<number>}
 */
KnexTaskRepository.prototype.deleteTaskById = function deleteTaskById(id, userId) {
  return Promise.resolve(this.tasksWrite.deleteTaskById(this.db, id, userId));
};

/**
 * Bulk update via a where-builder (field-routed). P1: `updated_at` forced to
 * new Date() when omitted.
 * @param {string} userId
 * @param {(q: Object) => Object} applyWhere
 * @param {Object} changes
 * @param {Object} [opts]
 * @returns {Promise<{masterUpdated: number, instanceUpdated: number}>}
 */
KnexTaskRepository.prototype.updateTasksWhere = function updateTasksWhere(userId, applyWhere, changes, opts) {
  return Promise.resolve(this.tasksWrite.updateTasksWhere(this.db, userId, applyWhere, withTimestamp(changes), opts));
};

/**
 * Bulk delete via a where-builder.
 * @param {string} userId
 * @param {(q: Object) => Object} applyWhere
 * @returns {Promise<{instanceDeleted: number, masterDeleted: number}>}
 */
KnexTaskRepository.prototype.deleteTasksWhere = function deleteTasksWhere(userId, applyWhere) {
  return Promise.resolve(this.tasksWrite.deleteTasksWhere(this.db, userId, applyWhere));
};

/**
 * Instance-only bulk update via a where-builder. P1: `updated_at` forced to
 * new Date() when omitted.
 * @param {string} userId
 * @param {(q: Object) => Object} applyWhere
 * @param {Object} changes
 * @returns {Promise<number>}
 */
KnexTaskRepository.prototype.updateInstancesWhere = function updateInstancesWhere(userId, applyWhere, changes) {
  return Promise.resolve(this.tasksWrite.updateInstancesWhere(this.db, userId, applyWhere, withTimestamp(changes)));
};

/**
 * Instance-only bulk delete via a where-builder.
 * @param {string} userId
 * @param {(q: Object) => Object} applyWhere
 * @returns {Promise<number>}
 */
KnexTaskRepository.prototype.deleteInstancesWhere = function deleteInstancesWhere(userId, applyWhere) {
  return Promise.resolve(this.tasksWrite.deleteInstancesWhere(this.db, userId, applyWhere));
};

// ── TRANSACTIONS (INVARIANT T-TX) ────────────────────────────────────────────

/**
 * Run `work(trxRepo)` inside one DB transaction — commits on resolve, rolls
 * back on reject (the legacy `getDb().transaction(async trx => …)` boundary).
 * `trxRepo` is a KnexTaskRepository bound to the trx handle, so its reads see
 * the transaction's uncommitted writes.
 * @template T
 * @param {(trxRepo: KnexTaskRepository) => Promise<T>} work
 * @returns {Promise<T>}
 */
KnexTaskRepository.prototype.runInTransaction = function runInTransaction(work) {
  var self = this;
  return this.db.transaction(function (trx) {
    var trxRepo = new KnexTaskRepository({ db: trx, tasksWrite: self.tasksWrite });
    return work(trxRepo);
  });
};

KnexTaskRepository.TASK_REPOSITORY_PORT_METHODS = TASK_REPOSITORY_PORT_METHODS;

module.exports = KnexTaskRepository;
