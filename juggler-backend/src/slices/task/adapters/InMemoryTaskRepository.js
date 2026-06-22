/**
 * InMemoryTaskRepository — TaskRepositoryPort test double (Phase H3 / W3).
 *
 * A faithful in-memory implementation of the SAME TaskRepositoryPort contract
 * KnexTaskRepository implements (TASK_REPOSITORY_PORT_METHODS). It exists so the
 * application layer (W5) and any consumer can be unit-tested with NO live DB,
 * and so the shared contract suite (taskRepository.contract.test.js) proves the
 * double is behaviorally equivalent to the Knex adapter for the contract surface.
 *
 * ── STORE MODEL ──────────────────────────────────────────────────────────────
 * Rows are stored in a single `_rows` map keyed by id, each carrying the
 * legacy tasks-shape columns (what `taskToRow` produces / `tasks_v` exposes:
 * a merged master+instance view). This mirrors how the controller reads a task
 * back as ONE row from `tasks_v` after writing through the split master/instance
 * tables — the contract operates at the row level, so the double models the row.
 *
 * Event ids (gcal/msft/apple/origin/url/apple_calendar_name) are surfaced as
 * null on read (no ledger in memory) — matching `fetchTaskWithEventIds` for a
 * task with no active ledger rows. A `_ledger` hook lets a test seed event ids
 * if it needs to exercise that fold, but the default (and the contract suite) use
 * the no-ledger path.
 *
 * ── INVARIANTS HELD (same as the Knex adapter) ──────────────────────────────
 *   P1: every write that stamps updated_at/created_at uses new Date() (or asserts
 *       a caller-supplied JS Date). ZERO fn.now() — there is no DB here at all.
 *   T-TX: runInTransaction snapshots the store; on the work function rejecting,
 *       the snapshot is restored (rollback). On resolve, the mutations stay
 *       (commit). This reproduces the legacy commit/rollback boundary in-memory.
 *   T-TENANCY: reads/writes are scoped by userId; cross-tenant rows are never
 *       returned or mutated.
 *
 * NO `||`/`??` fallback for a maybe-missing value is used as silent substitution;
 * the `|| null` on event-id surfacing matches the characterized Knex read shape.
 */

'use strict';

var TASK_REPOSITORY_PORT_METHODS =
  require('../domain/ports/TaskRepositoryPort').TASK_REPOSITORY_PORT_METHODS;

// Mirror of tasks-write MASTER_UPDATE_FIELDS / INSTANCE_UPDATE_FIELDS — used by
// updateTaskById to compute per-table counts that match Knex's splitUpdateFields
// routing (FIX W3-2). Keep in sync with src/lib/tasks-write.js.
var MASTER_UPDATE_FIELDS = [
  'text', 'project', 'section', 'notes', 'url', 'dur', 'pri',
  'desired_at', 'deadline', 'start_after_at',
  'when', 'day_req', 'time_flex', 'flex_when', 'placement_mode',
  'preferred_time_mins', 'tz',
  'recurring', 'recur', 'recur_start', 'recur_end',
  'split', 'split_min',
  'depends_on', 'location', 'tools', 'travel_before', 'travel_after',
  'disabled_at', 'disabled_reason',
  'weather_precip', 'weather_cloud', 'weather_temp_min', 'weather_temp_max',
  'weather_temp_unit', 'weather_humidity_min', 'weather_humidity_max',
  'status'
];
var INSTANCE_UPDATE_FIELDS = [
  'scheduled_at', 'dur',
  'date', 'day', 'time',
  'status', 'time_remaining', 'unscheduled', 'overdue', 'generated',
  'split_group',
  'completed_at'
];

/**
 * Mirror of tasks-write splitUpdateFields — returns {master, instance} objects
 * containing only the keys that belong to each table. `updated_at` mirrors to
 * both (same logic as Knex). Used by updateTaskById to compute Knex-identical
 * per-table counts.
 */
function splitUpdateFields(changes) {
  var master = {};
  var instance = {};
  Object.keys(changes).forEach(function (k) {
    if (MASTER_UPDATE_FIELDS.indexOf(k) >= 0) master[k] = changes[k];
    if (INSTANCE_UPDATE_FIELDS.indexOf(k) >= 0) instance[k] = changes[k];
  });
  if (changes.updated_at !== undefined) {
    master.updated_at = changes.updated_at;
    instance.updated_at = changes.updated_at;
  }
  return { master: master, instance: instance };
}

/**
 * P1 date columns — same set as KnexTaskRepository.P1_DATE_COLUMNS.
 * Any of these present in a changes/row object must be a JS Date.
 */
var P1_DATE_COLUMNS = ['created_at', 'updated_at', 'completed_at', 'scheduled_at'];

function assertDate(v, field) {
  if (!(v instanceof Date)) {
    throw new TypeError(
      'InMemoryTaskRepository: ' + field + ' must be a JS Date (INVARIANT P1 — new Date(), never db.fn.now())'
    );
  }
}

/**
 * @param {Object} [deps]
 * @param {Object[]} [deps.rows] seed rows (legacy tasks-shape).
 * @param {Object} [deps.ledger] optional { [taskId]: { gcal_event_id, msft_event_id,
 *   apple_event_id, cal_sync_origin, cal_event_url, apple_calendar_name } } to seed
 *   event-id folding on read.
 * @param {Object} [deps.preferences] optional { [userId]: prefRow }.
 */
function InMemoryTaskRepository(deps) {
  var d = deps || {};
  this._rows = {};
  if (Array.isArray(d.rows)) {
    var self = this;
    d.rows.forEach(function (r) { self._rows[r.id] = Object.assign({}, r); });
  }
  this._ledger = d.ledger || {};
  this._preferences = d.preferences || {};
}

// Event-id columns surfaced (as null by default) to match fetchTaskWithEventIds.
var EVENT_ID_FIELDS = [
  'gcal_event_id', 'msft_event_id', 'apple_event_id',
  'cal_sync_origin', 'cal_event_url', 'apple_calendar_name',
  'cal_locked'
];

InMemoryTaskRepository.prototype._withEventIds = function _withEventIds(row) {
  var out = Object.assign({}, row);
  var ev = this._ledger[row.id] || {};
  EVENT_ID_FIELDS.forEach(function (f) {
    out[f] = ev[f] !== undefined ? ev[f] : null;
  });
  return out;
};

InMemoryTaskRepository.prototype._allFor = function _allFor(userId) {
  var rows = [];
  var store = this._rows;
  Object.keys(store).forEach(function (id) {
    if (store[id].user_id === userId) rows.push(store[id]);
  });
  return rows;
};

// ── READS ────────────────────────────────────────────────────────────────────

InMemoryTaskRepository.prototype.fetchTaskWithEventIds = function fetchTaskWithEventIds(id, userId) {
  var row = this._rows[id];
  if (!row || row.user_id !== userId) return Promise.resolve(null);
  return Promise.resolve(this._withEventIds(row));
};

/** Cheap recurring-state lookup for one task (mirrors KnexTaskRepository.fetchTaskRecurring). */
InMemoryTaskRepository.prototype.fetchTaskRecurring = function fetchTaskRecurring(id, userId) {
  var row = this._rows[id];
  if (!row || row.user_id !== userId) return Promise.resolve(null);
  return Promise.resolve({ recurring: row.recurring, task_type: row.task_type });
};

/**
 * Bulk read. `queryBuilder` is intentionally NOT applied to in-memory rows (the
 * double returns the user's full row set; callers that need filtering/ordering
 * compose it after). This matches the contract surface: the Knex queryBuilder is
 * a DB-side convenience, and the contract suite asserts the no-builder path.
 */
InMemoryTaskRepository.prototype.fetchTasksWithEventIds = function fetchTasksWithEventIds(userId, _queryBuilder) {
  var self = this;
  return Promise.resolve(this._allFor(userId).map(function (r) { return self._withEventIds(r); }));
};

InMemoryTaskRepository.prototype.getTasksVersion = function getTasksVersion(userId) {
  var rows = this._allFor(userId);
  // Use getTime() for chronological max — Date objects compare correctly by
  // numeric epoch value; String(Date) gives locale string whose lexical order
  // != chronological order (FIX W3-3).
  var maxMs = null;
  var maxDate = null;
  rows.forEach(function (r) {
    if (r.updated_at != null) {
      var d = r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at);
      var ms = d.getTime();
      if (!isNaN(ms) && (maxMs === null || ms > maxMs)) {
        maxMs = ms;
        maxDate = d;
      }
    }
  });
  // Emit the same token format MySQL MAX(updated_at) produces via Knex:
  // "YYYY-MM-DD HH:MM:SS" (UTC, zero-padded). Knex returns the MySQL datetime
  // string and String() passes it through; we must match that format exactly.
  var ts;
  if (maxDate !== null) {
    var yr  = maxDate.getUTCFullYear();
    var mo  = String(maxDate.getUTCMonth() + 1).padStart(2, '0');
    var dy  = String(maxDate.getUTCDate()).padStart(2, '0');
    var hr  = String(maxDate.getUTCHours()).padStart(2, '0');
    var min = String(maxDate.getUTCMinutes()).padStart(2, '0');
    var sec = String(maxDate.getUTCSeconds()).padStart(2, '0');
    ts = yr + '-' + mo + '-' + dy + ' ' + hr + ':' + min + ':' + sec;
  } else {
    ts = '0';
  }
  var cnt = String(rows.length);
  return Promise.resolve(ts + ':' + cnt);
};

InMemoryTaskRepository.prototype.getRecurringTemplateRows = function getRecurringTemplateRows(userId) {
  var rows = this._allFor(userId).filter(function (r) {
    return r.task_type === 'recurring_template' || r.recurring === 1 || r.recurring === true;
  });
  return Promise.resolve(rows.map(function (r) { return Object.assign({}, r); }));
};

// 999.354 (recurrence-read fold): raw master row by id, or null.
InMemoryTaskRepository.prototype.getMasterById = function getMasterById(masterId, userId) {
  var row = this._rows[masterId];
  if (!row || row.user_id !== userId) return Promise.resolve(null);
  return Promise.resolve(Object.assign({}, row));
};

// 999.354 (recurrence-read fold): split-sibling ids (same user/master/occurrence,
// excluding excludeId).
InMemoryTaskRepository.prototype.getSplitSiblingIds = function getSplitSiblingIds(userId, masterId, occurrenceOrdinal, excludeId) {
  var rows = this._allFor(userId).filter(function (r) {
    return r.master_id === masterId
      && r.occurrence_ordinal === occurrenceOrdinal
      && r.id !== excludeId;
  });
  return Promise.resolve(rows.map(function (r) { return { id: r.id }; }));
};

// In-memory counterpart of KnexTaskRepository.fetchOneShottedInstanceId.
// Finds the surviving (occurrence_ordinal=1, split_ordinal=1) instance id for
// a master that was just toggled off; returns the id string or null.
InMemoryTaskRepository.prototype.fetchOneShottedInstanceId = function fetchOneShottedInstanceId(masterId, userId) {
  var rows = this._allFor(userId).filter(function (r) {
    return r.master_id === masterId
      && r.occurrence_ordinal === 1
      && r.split_ordinal === 1;
  });
  return Promise.resolve(rows.length > 0 ? rows[0].id : null);
};

InMemoryTaskRepository.prototype.expandToAllInstanceIds = function expandToAllInstanceIds(userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return Promise.resolve(ids || []);
  var store = this._rows;
  var masterIds = new Set();
  // Inputs that are recurring masters themselves.
  ids.forEach(function (id) {
    var r = store[id];
    if (r && r.user_id === userId && (r.recurring === 1 || r.recurring === true)) {
      // master rows in the merged model carry master_id === id
      var mId = r.master_id != null ? r.master_id : r.id;
      if (mId === r.id) masterIds.add(r.id);
    }
  });
  // Inputs that are instances → their master_id.
  ids.forEach(function (id) {
    var r = store[id];
    if (r && r.user_id === userId && r.master_id != null) masterIds.add(r.master_id);
  });
  if (masterIds.size === 0) return Promise.resolve(ids);
  var out = {};
  ids.forEach(function (i) { out[i] = true; });
  masterIds.forEach(function (m) { out[m] = true; });
  Object.keys(store).forEach(function (id) {
    var r = store[id];
    if (r.user_id === userId && r.master_id != null && masterIds.has(r.master_id)) out[r.id] = true;
  });
  return Promise.resolve(Object.keys(out));
};

InMemoryTaskRepository.prototype.getUserSplitPreference = function getUserSplitPreference(userId) {
  var pref = this._preferences[userId];
  return Promise.resolve(pref !== undefined ? pref : null);
};

// ── WRITES (P1: new Date() timestamps) ───────────────────────────────────────

InMemoryTaskRepository.prototype.insertTask = function insertTask(row) {
  if (row) {
    P1_DATE_COLUMNS.forEach(function (col) {
      if (row[col] !== undefined && row[col] !== null) {
        if (typeof row[col] === 'string') row[col] = new Date(row[col]);
        assertDate(row[col], col);
      }
    });
  }
  var stored = Object.assign({}, row);
  if (stored.created_at === undefined) stored.created_at = new Date();
  if (stored.updated_at === undefined) stored.updated_at = new Date();
  // Master/instance merged-row model: master_id defaults to id (non-recurring),
  // or to source_id for a recurring_instance — matching pickInstance routing.
  if (stored.master_id === undefined) {
    stored.master_id = stored.task_type === 'recurring_instance' && stored.source_id != null
      ? stored.source_id
      : stored.id;
  }
  this._rows[stored.id] = stored;
  return Promise.resolve();
};

InMemoryTaskRepository.prototype.insertTasksBatch = function insertTasksBatch(rows) {
  var self = this;
  if (!Array.isArray(rows)) return Promise.resolve();
  return rows.reduce(function (p, row) {
    return p.then(function () { return self.insertTask(row); });
  }, Promise.resolve());
};

InMemoryTaskRepository.prototype.updateTaskById = function updateTaskById(id, changes, userId) {
  var c = Object.assign({}, changes);
  // Assert all P1 date columns supplied by the caller (FIX W3-1: column-complete guard).
  // Allow null for nullable date cols (completed_at, scheduled_at).
  // Convert ISO strings back to Date (action log deep-clone can stringify).
  P1_DATE_COLUMNS.forEach(function (col) {
    if (col !== 'updated_at' && c[col] !== undefined && c[col] !== null) {
      if (typeof c[col] === 'string') c[col] = new Date(c[col]);
      assertDate(c[col], col);
    }
  });
  if (c.updated_at !== undefined) assertDate(c.updated_at, 'updated_at');
  else c.updated_at = new Date(); // P1

  var row = this._rows[id];
  var masterUpdated = 0;
  var instanceUpdated = 0;
  if (row && row.user_id === userId) {
    // Compute per-table counts using the same splitUpdateFields routing as Knex
    // (FIX W3-2): a master-only change yields {masterUpdated:1, instanceUpdated:0};
    // an instance-only change yields {masterUpdated:0, instanceUpdated:1}.
    var split = splitUpdateFields(c);
    var hasMasterFields = Object.keys(split.master).length > 0;
    var hasInstanceFields = Object.keys(split.instance).length > 0;
    Object.assign(row, c);
    masterUpdated = hasMasterFields ? 1 : 0;
    instanceUpdated = hasInstanceFields ? 1 : 0;
  }
  return Promise.resolve({ masterUpdated: masterUpdated, instanceUpdated: instanceUpdated });
};

InMemoryTaskRepository.prototype.deleteTaskById = function deleteTaskById(id, userId) {
  var row = this._rows[id];
  if (row && row.user_id === userId) {
    delete this._rows[id];
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
};

// A minimal where-builder recorder so `applyWhere` callbacks (q.where / q.whereIn)
// can be evaluated against the in-memory rows for the bulk *Where helpers.
function makePredicate(applyWhere) {
  var conds = [];
  var builder = {
    where: function (colOrObj, val) {
      if (typeof colOrObj === 'object') {
        Object.keys(colOrObj).forEach(function (k) { conds.push({ type: 'eq', col: k, val: colOrObj[k] }); });
      } else {
        conds.push({ type: 'eq', col: colOrObj, val: val });
      }
      return this;
    },
    whereIn: function (col, vals) { conds.push({ type: 'in', col: col, val: vals }); return this; }
  };
  if (typeof applyWhere === 'function') applyWhere(builder);
  return function (row) {
    return conds.every(function (c) {
      if (c.type === 'eq') return row[c.col] === c.val;
      if (c.type === 'in') return Array.isArray(c.val) && c.val.indexOf(row[c.col]) !== -1;
      return true;
    });
  };
}

InMemoryTaskRepository.prototype.updateTasksWhere = function updateTasksWhere(userId, applyWhere, changes, _opts) {
  if (!userId) return Promise.reject(new Error('updateTasksWhere: userId is required (tenancy safety).'));
  var c = Object.assign({}, changes);
  if (c.updated_at !== undefined) assertDate(c.updated_at, 'updated_at');
  else c.updated_at = new Date(); // P1
  var pred = makePredicate(applyWhere);
  var n = 0;
  var store = this._rows;
  Object.keys(store).forEach(function (id) {
    var row = store[id];
    if (row.user_id === userId && pred(row)) { Object.assign(row, c); n++; }
  });
  return Promise.resolve({ masterUpdated: n, instanceUpdated: n });
};

InMemoryTaskRepository.prototype.deleteTasksWhere = function deleteTasksWhere(userId, applyWhere) {
  if (!userId) return Promise.reject(new Error('deleteTasksWhere: userId is required (tenancy safety).'));
  var pred = makePredicate(applyWhere);
  var store = this._rows;
  var n = 0;
  Object.keys(store).forEach(function (id) {
    var row = store[id];
    if (row.user_id === userId && pred(row)) { delete store[id]; n++; }
  });
  return Promise.resolve({ instanceDeleted: n, masterDeleted: n });
};

InMemoryTaskRepository.prototype.updateInstancesWhere = function updateInstancesWhere(userId, applyWhere, changes) {
  if (!userId) return Promise.reject(new Error('updateInstancesWhere: userId is required (tenancy safety).'));
  var c = Object.assign({}, changes);
  if (c.updated_at !== undefined) assertDate(c.updated_at, 'updated_at');
  else c.updated_at = new Date(); // P1
  var pred = makePredicate(applyWhere);
  var store = this._rows;
  var n = 0;
  Object.keys(store).forEach(function (id) {
    var row = store[id];
    if (row.user_id === userId && pred(row)) { Object.assign(row, c); n++; }
  });
  return Promise.resolve(n);
};

InMemoryTaskRepository.prototype.deleteInstancesWhere = function deleteInstancesWhere(userId, applyWhere) {
  if (!userId) return Promise.reject(new Error('deleteInstancesWhere: userId is required (tenancy safety).'));
  var pred = makePredicate(applyWhere);
  var store = this._rows;
  var n = 0;
  Object.keys(store).forEach(function (id) {
    var row = store[id];
    if (row.user_id === userId && pred(row)) { delete store[id]; n++; }
  });
  return Promise.resolve(n);
};

// ── TRANSACTIONS (snapshot/restore = commit/rollback) ────────────────────────

InMemoryTaskRepository.prototype.runInTransaction = function runInTransaction(work) {
  var self = this;
  // Deep-ish snapshot: clone each row so a mutation inside `work` can be rolled
  // back. The trxRepo SHARES the same _rows reference (so reads see uncommitted
  // writes — T-TX), and on reject we restore the snapshot.
  var snapshot = {};
  Object.keys(this._rows).forEach(function (id) { snapshot[id] = Object.assign({}, self._rows[id]); });

  return Promise.resolve()
    .then(function () { return work(self); })
    .catch(function (err) {
      // Rollback: restore the snapshot.
      Object.keys(self._rows).forEach(function (id) { delete self._rows[id]; });
      Object.keys(snapshot).forEach(function (id) { self._rows[id] = snapshot[id]; });
      throw err;
    });
};

InMemoryTaskRepository.TASK_REPOSITORY_PORT_METHODS = TASK_REPOSITORY_PORT_METHODS;

module.exports = InMemoryTaskRepository;
