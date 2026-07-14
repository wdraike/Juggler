/**
 * InMemoryScheduleRepository — ScheduleRepositoryPort test double
 * (SCHEDULE_REPOSITORY_PORT_METHODS). Phase H6 / W2.
 *
 * A faithful in-memory implementation of the SAME ScheduleRepositoryPort contract
 * KnexScheduleRepository implements. It lets the application layer (W3
 * RunScheduleCommand) and any consumer be unit-tested with NO live DB, and lets a
 * contract suite prove the double is behaviorally equivalent for the contract
 * surface.
 *
 * ── STORE MODEL ──────────────────────────────────────────────────────────────
 * Rows live in a `_rows` map keyed by id (the tasks_v row shape). `writeChanged`
 * applies each `dbUpdate` patch over the matching row. `deleteTasksWhere` removes
 * rows the where-builder selects — modeled here with a small predicate captured
 * from a `whereIn('id', [...])` call (the only shape the scheduler uses).
 *
 * ── INVARIANTS HELD (same as the Knex adapter) ──────────────────────────────
 *   P1: writeChanged asserts every supplied date column is a JS Date; ZERO
 *       fn.now() (no DB here). `now()`/clock return new Date().
 *   S5: writeChanged writes ONLY the rows passed in `delta` — no write-all path.
 *   T-TENANCY: writes are scoped by opts.userId (rows carry user_id).
 */

'use strict';

var SCHEDULE_REPOSITORY_PORT_METHODS =
  require('../domain/ports/ScheduleRepositoryPort').SCHEDULE_REPOSITORY_PORT_METHODS;

var P1_DATE_COLUMNS = ['updated_at', 'created_at', 'completed_at', 'scheduled_at'];

/**
 * @param {Object} [deps]
 * @param {Object} [deps.rows] seed map { id: row } the double starts from.
 * @param {Object} [deps.clock] ClockPort (default: process clock).
 * @param {Array<Object>} [deps.userConfigRows] seed raw user_config rows (H7).
 * @param {Array<Object>} [deps.locations] seed raw locations rows (H7).
 * @param {Array<Object>} [deps.users] seed raw `users` rows `{id, timezone, ...}` (999.1532).
 */
function InMemoryScheduleRepository(deps) {
  var d = deps || {};
  this._rows = Object.assign({}, d.rows || {});
  this.clock = d.clock || { now: function () { return new Date(); } };
  this.writes = []; // audit log of applied dbUpdates (for assertions)
  this._userConfigRows = (d.userConfigRows || []).slice();
  this._locations = (d.locations || []).slice();
  this._users = (d.users || []).slice();
}

InMemoryScheduleRepository.prototype._assertDates = function _assertDates(dbUpdate) {
  for (var i = 0; i < P1_DATE_COLUMNS.length; i++) {
    var col = P1_DATE_COLUMNS[i];
    if (Object.prototype.hasOwnProperty.call(dbUpdate, col)) {
      var v = dbUpdate[col];
      if (v !== null && v !== undefined && !(v instanceof Date)) {
        throw new Error('[InMemoryScheduleRepository] P1 violation: ' + col +
          ' must be a JS Date (got ' + (typeof v) + ')');
      }
    }
  }
};

InMemoryScheduleRepository.prototype.writeChanged = async function writeChanged(delta, opts) {
  var self = this;
  var options = opts || {};
  if (!options.userId) throw new Error('[InMemoryScheduleRepository] writeChanged requires opts.userId');
  var pending = (delta || []).slice();
  pending.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  var written = 0;
  pending.forEach(function (pu) {
    self._assertDates(pu.dbUpdate);
    var row = self._rows[pu.id] || { id: pu.id, user_id: options.userId };
    self._rows[pu.id] = Object.assign(row, pu.dbUpdate);
    self.writes.push({ id: pu.id, dbUpdate: pu.dbUpdate });
    written += 1;
  });
  return { written: written };
};

/**
 * Models `deleteTasksWhere(userId, q => q.whereIn('id', ids))` — captures the
 * id list via a tiny query stub, then removes those rows. Returns rows removed.
 */
InMemoryScheduleRepository.prototype.deleteTasksWhere = async function deleteTasksWhere(userId, applyWhere) {
  var captured = [];
  var stub = { whereIn: function (_col, ids) { captured = ids.slice(); return stub; } };
  applyWhere(stub);
  var removed = 0;
  var self = this;
  captured.forEach(function (id) {
    if (self._rows[id] && self._rows[id].user_id === userId) {
      delete self._rows[id];
      removed += 1;
    }
  });
  return removed;
};

InMemoryScheduleRepository.prototype.backfillRollingAnchorIfNull = async function backfillRollingAnchorIfNull(masterId, userId, anchor) {
  var row = this._rows[masterId];
  if (row && row.user_id === userId && (row.next_start === null || row.next_start === undefined)) {
    row.next_start = anchor;
    row.updated_at = this.clock.now();
    return 1;
  }
  return 0;
};

// 999.1217 (W4, SCHEDULER-SPEC.md D6): `now()`/`getScheduleCache`/
// `upsertScheduleCache` removed — see KnexScheduleRepository.js for the
// rationale (schedule_cache has no remaining reader or writer).

/**
 * Read ALL user_config rows for the user. Seed via deps.userConfigRows
 * (array of raw user_config rows). H7 (999.1193).
 */
InMemoryScheduleRepository.prototype.getUserConfigRows = async function getUserConfigRows(userId) {
  return this._userConfigRows.filter(function (r) { return r.user_id === userId; });
};

/**
 * Read the user's locations rows ordered by sort_order. Seed via
 * deps.locations (array of raw locations rows). H7 (999.1193).
 */
InMemoryScheduleRepository.prototype.getLocations = async function getLocations(userId) {
  return this._locations
    .filter(function (r) { return r.user_id === userId; })
    .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
};

/**
 * Bulk-insert task rows into the in-memory store (P1-asserted), mirroring
 * lib/tasks-write.insertTasksBatch's early return on empty. H7 (999.1193).
 */
InMemoryScheduleRepository.prototype.insertTasksBatch = async function insertTasksBatch(rows) {
  if (!rows || rows.length === 0) return;
  var self = this;
  rows.forEach(function (r) {
    if (!r.user_id) throw new Error('[InMemoryScheduleRepository] insertTasksBatch: row missing user_id');
    self._assertDates(r);
    self._rows[r.id] = Object.assign({}, r);
    self.writes.push({ id: r.id, dbUpdate: r, inserted: true });
  });
};

/**
 * Batch drift-fix over the in-memory store — mirrors KnexScheduleRepository's
 * applySplitDriftFix (999.1019 / 999.1532). Only `split_ordinal`/`split_total`/
 * `dur`/`updated_at` are touched; `unscheduled`/`unplaced_reason`/
 * `unplaced_detail` are left alone (this is NOT writeChanged).
 */
InMemoryScheduleRepository.prototype.applySplitDriftFix = async function applySplitDriftFix(driftUpdates) {
  var self = this;
  (driftUpdates || []).forEach(function(u) {
    var row = self._rows[u.id];
    if (!row) return;
    ['split_ordinal', 'split_total', 'dur'].forEach(function(col) {
      if (u.changes[col] != null) row[col] = u.changes[col];
    });
    row.updated_at = self.clock.now();
  });
};

/**
 * Read `{ timezone }` for the user. Seed via deps.users (array of raw
 * `users` rows). Mirrors `.select('timezone').first()` — only the
 * `timezone` field is returned, matching the Knex adapter's projection.
 * H7 (999.1532).
 */
InMemoryScheduleRepository.prototype.getUserTimezone = async function getUserTimezone(userId) {
  var row = this._users.filter(function (r) { return r.id === userId; })[0];
  return row ? { timezone: row.timezone } : undefined;
};

module.exports = InMemoryScheduleRepository;
module.exports.InMemoryScheduleRepository = InMemoryScheduleRepository;
module.exports.SCHEDULE_REPOSITORY_PORT_METHODS = SCHEDULE_REPOSITORY_PORT_METHODS;
