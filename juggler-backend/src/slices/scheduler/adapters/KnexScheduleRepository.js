/**
 * KnexScheduleRepository — concrete ScheduleRepositoryPort
 * (SCHEDULE_REPOSITORY_PORT_METHODS). Phase H6 / W2.
 *
 * Owns ALL scheduler DB writes. Absorbs the persist surface that today lives
 * inline in `runSchedule.js`'s `runScheduleAndPersist` (the `pendingUpdates`
 * flush: the batched scheduled_at/dur CASE update chunked at 200, the per-row
 * "otherUpdates" loop, the merged-out-chunk delete, the rolling-anchor backfill,
 * and the `SELECT NOW(3)` cache-clock read). The write logic delegates to the
 * REAL master/instance write module `src/lib/tasks-write` (updateTasksWhere /
 * updateTaskById / deleteTasksWhere) — it does NOT reinvent master/instance
 * routing.
 *
 * REFACTOR (behavior-identical OUTPUT) EXCEPT the two human-approved changes:
 *   (P1) every timestamp via new Date(), NEVER the Knex now-builder (ADR-0003 — 19 sites);
 *   (S5) writeChanged writes ONLY the rows the caller computed as changed —
 *        there is NO write-all path here (the write-all→write-changed behavioral
 *        change; DESIGN §6 S5; user ruling 2026-06-12).
 *
 * ── CONNECTION (ADR-0002 — lib/db, NOT src/db.js) ────────────────────────────
 * Obtains its knex via `lib/db` (`require('../../../lib/db').getDefaultDb()`),
 * exactly like KnexTaskRepository. It never imports src/db.js. The
 * connection is injectable (and is a trx handle in the orchestrated path, so all
 * writes participate in the caller's transaction — INVARIANT T-TX).
 *
 * ── INVARIANT P1 (timestamps via new Date(), NEVER the Knex now-builder) ────────
 * The legacy persist passed the Knex now-builder (db.fn.now / trx.fn.now) on 19 update objects.
 * This repository takes the changed-row `dbUpdate` objects (whose `updated_at` is
 * already a JS Date set by the W3 command / the delta-builder) and stamps a JS
 * `new Date()` (via `this.clock.now()`) on the batched CASE update's
 * `updated_at`. There is intentionally ZERO Knex now-builder reference in this file.
 *
 * NO new `||`/`??` fallback is introduced — every `||` below is preserved
 * verbatim from the legacy persist (e.g. `pu.dbUpdate.day || null`).
 */

'use strict';

// 999.1199: lib/tasks-write is internal to slices/task/adapters (eslint
// boundary) now — this file is grandfathered to keep requiring it directly
// (it already sits under a pre-existing "**/slices/scheduler/adapters/**"
// boundary exemption, so the rule doesn't flag it) because writeChanged's
// batched CASE-expression path passes Knex `trx.raw()` objects for
// scheduled_at/dur/date/day/time — values the task slice's P1 assertDate
// guard (TaskRepositoryPort — "new Date()/null, never a raw") would reject
// outright. That single hot path stays on the raw module (documented below);
// insertTasksBatch/deleteTasksWhere (P1-clean, no raw() values) route through
// the task slice's exported KnexTaskRepository instead — see below.
var tasksWrite = require('../../../lib/tasks-write');

var SCHEDULE_REPOSITORY_PORT_METHODS =
  require('../domain/ports/ScheduleRepositoryPort').SCHEDULE_REPOSITORY_PORT_METHODS;

var P1_DATE_COLUMNS = ['updated_at', 'created_at', 'completed_at', 'scheduled_at'];

/**
 * @param {Object} [deps]
 * @param {Function} [deps.db] Knex instance or trx handle (default: lib/db's
 *   shared singleton via getDefaultDb() — ADR-0002). NEVER src/db.js.
 * @param {Object} [deps.tasksWrite] master/instance write module (default: the
 *   real `src/lib/tasks-write`) — injectable for unit tests.
 * @param {Object} [deps.clock] ClockPort (default: a process clock). Used for the
 *   P1 `new Date()` stamp and the DB-clock read.
 * @param {number} [deps.chunkSize] CASE-update batch size (default 200 — the
 *   legacy CHUNK constant).
 */
function KnexScheduleRepository(deps) {
  var d = deps || {};
  this.db = d.db || require('../../../lib/db').getDefaultDb();
  this.tasksWrite = d.tasksWrite || tasksWrite;
  this.clock = d.clock || { now: function () { return new Date(); } };
  this.chunkSize = d.chunkSize || 200;
}

/**
 * P1 guard: assert any caller-supplied date column is a real JS Date (never a
 * a Knex now-builder / string). Fail-loud — a non-Date here is a P1 violation. */
KnexScheduleRepository.prototype._assertDates = function _assertDates(dbUpdate) {
  for (var i = 0; i < P1_DATE_COLUMNS.length; i++) {
    var col = P1_DATE_COLUMNS[i];
    if (Object.prototype.hasOwnProperty.call(dbUpdate, col)) {
      var v = dbUpdate[col];
      if (v !== null && v !== undefined && !(v instanceof Date)) {
        throw new Error('[KnexScheduleRepository] P1 violation: ' + col +
          ' must be a JS Date (got ' + (typeof v) + ': ' + String(v) + ')');
      }
    }
  }
};

/**
 * writeChanged(delta, opts) — write ONLY the rows in `delta` (S5).
 *
 * `delta` is an array of `{ id, dbUpdate }` — EXACTLY the legacy `pendingUpdates`
 * shape, but containing ONLY rows whose placement actually changed (the caller
 * computed the skip). Splits into the batched scheduled_at/dur CASE path and the
 * per-row otherUpdates path, byte-for-byte the legacy persist logic — minus the
 * write-all (the caller already excluded unchanged rows) and minus the Knex now-builder * (new Date() via clock).
 *
 * @returns {Promise<{written: number}>}
 */
KnexScheduleRepository.prototype.writeChanged = async function writeChanged(delta, opts) {
  var self = this;
  var trx = this.db;
  var options = opts || {};
  // Caller owns userId via opts (the persist loop scopes every write to the user).
  var userId = options.userId;
  if (!userId) throw new Error('[KnexScheduleRepository] writeChanged requires opts.userId');
  var instanceOnly = options.instanceOnly !== false; // default true (legacy CASE update used instanceOnly:true)

  var pendingUpdates = (delta || []).slice();
  // Deterministic order — verbatim from the legacy persist (runSchedule.js ~1578).
  pendingUpdates.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });

  pendingUpdates.forEach(function (pu) { self._assertDates(pu.dbUpdate); });

  // Partition: batched scheduled_at/dur path vs per-row otherUpdates path
  // (verbatim — runSchedule.js ~1583-1589).
  var scheduledAtUpdates = [];
  var otherUpdates = [];
  pendingUpdates.forEach(function (pu) {
    if ((pu.dbUpdate.scheduled_at || pu.dbUpdate.dur) && !pu.dbUpdate.status) {
      scheduledAtUpdates.push(pu);
    } else {
      otherUpdates.push(pu);
    }
  });

  var written = 0;
  var CHUNK = this.chunkSize;
  // Batched CASE update in chunks (verbatim — runSchedule.js ~1593-1650), except
  // updated_at uses new Date() (P1) not the Knex now-builder.
  for (var ci = 0; ci < scheduledAtUpdates.length; ci += CHUNK) {
    var chunk = scheduledAtUpdates.slice(ci, ci + CHUNK);
    var ids = chunk.map(function (pu) { return pu.id; });

    // DB-single-source (W1): a row in the batched scheduled_at/dur path is being
    // PLACED — clear any stale unplaced reason from a prior run alongside the
    // unscheduled flag, so a now-placed instance never carries a reason.
    // W3 (sched-drop-overdue-column, M-5): `overdue` is no longer a stored
    // column — this hardcoded `overdue:0` is REMOVED (not replaced), which is
    // also what let the old R-FR1 secondary write in runSchedule.js override
    // it on the same transaction; both are gone now.
    var updateFields = { unscheduled: null, unplaced_reason: null, unplaced_detail: null, updated_at: this.clock.now() };

    var saChunk = chunk.filter(function (pu) { return !!pu.dbUpdate.scheduled_at; });
    if (saChunk.length > 0) {
      var saCaseExpr = 'CASE id';
      var saBindings = [];
      saChunk.forEach(function (pu) {
        saCaseExpr += ' WHEN ? THEN ?';
        saBindings.push(pu.id, pu.dbUpdate.scheduled_at);
      });
      saCaseExpr += ' ELSE scheduled_at END';
      updateFields.scheduled_at = trx.raw(saCaseExpr, saBindings);
    }

    var durChunk = chunk.filter(function (pu) { return !!pu.dbUpdate.dur; });
    if (durChunk.length > 0) {
      var durCaseExpr = 'CASE id';
      var durBindings = [];
      durChunk.forEach(function (pu) {
        durCaseExpr += ' WHEN ? THEN ?';
        durBindings.push(pu.id, pu.dbUpdate.dur);
      });
      durCaseExpr += ' ELSE dur END';
      updateFields.dur = trx.raw(durCaseExpr, durBindings);
    }

    // split_ordinal / split_total — drift-fix CASE branches (999.1019).
    // The legacy drift-fix path (runSchedule.js:1295-1303) emits CASEs for these
    // alongside dur; without these branches the batched path would silently drop
    // split-chunk metadata when a drift-fix delta is routed through writeChanged.
    ['split_ordinal', 'split_total'].forEach(function (col) {
      var splitChunk = chunk.filter(function (pu) { return pu.dbUpdate[col] != null; });
      if (splitChunk.length === 0) return;
      var splitCaseExpr = 'CASE id';
      var splitBindings = [];
      splitChunk.forEach(function (pu) {
        splitCaseExpr += ' WHEN ? THEN ?';
        splitBindings.push(pu.id, pu.dbUpdate[col]);
      });
      splitCaseExpr += ' ELSE `' + col + '` END';
      updateFields[col] = trx.raw(splitCaseExpr, splitBindings);
    });

    var dateChunk = chunk.filter(function (pu) { return pu.dbUpdate.date != null; });
    if (dateChunk.length > 0) {
      var dateCaseExpr = 'CASE id'; var dateBindings = [];
      var dayCaseExpr = 'CASE id'; var dayBindings = [];
      var timeCaseExpr = 'CASE id'; var timeBindings = [];
      dateChunk.forEach(function (pu) {
        dateCaseExpr += ' WHEN ? THEN ?'; dateBindings.push(pu.id, pu.dbUpdate.date);
        dayCaseExpr += ' WHEN ? THEN ?'; dayBindings.push(pu.id, pu.dbUpdate.day || null);
        timeCaseExpr += ' WHEN ? THEN ?'; timeBindings.push(pu.id, pu.dbUpdate.time || null);
      });
      dateCaseExpr += ' ELSE `date` END';
      dayCaseExpr += ' ELSE `day` END';
      timeCaseExpr += ' ELSE `time` END';
      updateFields.date = trx.raw(dateCaseExpr, dateBindings);
      updateFields.day = trx.raw(dayCaseExpr, dayBindings);
      updateFields.time = trx.raw(timeCaseExpr, timeBindings);
    }

    // NOTE: slack_mins is NOT folded into the batched CASE here — the legacy
    // inline batched flush (runSchedule.js:1714-1773) does not emit a slack_mins
    // CASE, so slack_mins is silently dropped by the batched path even when
    // dbUpdate carries it. writeChanged is byte-faithful to that behavior
    // (approved deviations: P1 new Date() + S5 delta-write only; no third change).
    await this.tasksWrite.updateTasksWhere(trx, userId, function (q) {
      return q.whereIn('id', ids);
    }, updateFields, { instanceOnly: instanceOnly });
    written += ids.length;
  }

  // Per-row otherUpdates (verbatim — runSchedule.js ~1653-1655).
  for (var pi = 0; pi < otherUpdates.length; pi++) {
    await this.tasksWrite.updateTaskById(trx, otherUpdates[pi].id, otherUpdates[pi].dbUpdate, userId);
    written += 1;
  }

  return { written: written };
};

/**
 * Bulk delete via a where-builder (the legacy merged-out-chunk cleanup,
 * runSchedule.js ~1660). Returns rows removed.
 *
 * 999.1199: routed through the task slice's KnexTaskRepository (constructed
 * over this repo's own db/trx handle as a transaction token) instead of the
 * raw tasksWrite module — no timestamp columns are touched by a delete, so
 * the P1-asserting port method is a safe, byte-identical substitution here
 * (unlike writeChanged's CASE-expression path — see the file header).
 */
KnexScheduleRepository.prototype.deleteTasksWhere = function deleteTasksWhere(userId, applyWhere) {
  var KnexTaskRepository = require('../../task/facade').KnexTaskRepository;
  return new KnexTaskRepository({ db: this.db }).deleteTasksWhere(userId, applyWhere);
};

/**
 * Rolling-anchor backfill: set next_start=anchor ONLY when currently NULL
 * (verbatim — runSchedule.js), with updated_at via new Date() (P1).
 */
KnexScheduleRepository.prototype.backfillRollingAnchorIfNull = function backfillRollingAnchorIfNull(masterId, userId, anchor) {
  return this.db('task_masters')
    .where({ id: masterId, user_id: userId })
    .whereNull('next_start')
    .update({ next_start: anchor, updated_at: this.clock.now() });
};

/**
 * FR-1(b)/AC2 (juggler-recur-lifecycle-redesign, W2): scheduler-run sweep —
 * unconditionally sets `next_start` to the caller-computed value. The caller
 * (runSchedule.js) already restricts calls to non-rolling masters whose
 * next_start is stale (< today), so no additional guard is needed here (unlike
 * backfillRollingAnchorIfNull's `whereNull`, this write intentionally
 * OVERWRITES a stale value, not just fills a null one).
 */
KnexScheduleRepository.prototype.setNextStart = function setNextStart(masterId, userId, nextStart) {
  return this.db('task_masters')
    .where({ id: masterId, user_id: userId })
    .update({ next_start: nextStart, updated_at: this.clock.now() });
};

// 999.1217 (W4, SCHEDULER-SPEC.md D6): `now()` (DB-clock read, was used only
// for the placement-cache generatedAt) and `getScheduleCache`/
// `upsertScheduleCache` (user_config `schedule_cache` blob read/write) are
// removed — cal-sync.controller.js no longer reads schedule_cache (reads
// task_instances directly; split chunks persist as their own rows, 999.841).

/**
 * Read ALL user_config rows for the user (verbatim — the legacy
 * loadSchedulerConfig.js:79 read). H7 boundary hardening (999.1193).
 */
KnexScheduleRepository.prototype.getUserConfigRows = function getUserConfigRows(userId) {
  return this.db('user_config').where('user_id', userId).select();
};

/**
 * Read the user's locations ordered by sort_order (verbatim — the legacy
 * loadSchedulerConfig.js:80 read). H7 (999.1193).
 */
KnexScheduleRepository.prototype.getLocations = function getLocations(userId) {
  return this.db('locations').where('user_id', userId).orderBy('sort_order');
};

/**
 * Bulk-insert task rows — exactly what the legacy phase-1 chunk pre-insert
 * (runSchedule.js ~1395) called inline. H7 (999.1193).
 *
 * 999.1199: routed through the task slice's KnexTaskRepository (constructed
 * over this repo's own db/trx handle as a transaction token) instead of a raw
 * `require('lib/tasks-write')`. Safe substitution: every row's created_at/
 * updated_at is already `_runScheduleCommand.clockNow()` (a JS `new Date()`,
 * P1) by the time it reaches here (runSchedule.js ~1389-1390), so the task
 * slice's P1 assertDate guard is a no-op assertion, not a behavior change.
 */
KnexScheduleRepository.prototype.insertTasksBatch = function insertTasksBatch(rows) {
  var KnexTaskRepository = require('../../task/facade').KnexTaskRepository;
  return new KnexTaskRepository({ db: this.db }).insertTasksBatch(rows);
};

/**
 * Batch drift-fix UPDATEs into CASE-WHEN expressions (999.1019), chunked at
 * `this.chunkSize` (200 — the same chunk constant `writeChanged` uses). This
 * is a SEPARATE write path from `writeChanged` — it only ever touches
 * `split_ordinal`/`split_total`/`dur`/`updated_at`, never `unscheduled`/
 * `unplaced_reason`/`unplaced_detail` (verbatim — runSchedule.js
 * ~1307-1328's recurring-split-chunk reconcile DRIFT_CHUNK loop, minus the
 * Knex now-builder — P1: `updated_at` via `this.clock.now()`).
 * JUG-SCHEDULER-LEGACY-DB-BYPASS (999.1532).
 */
KnexScheduleRepository.prototype.applySplitDriftFix = async function applySplitDriftFix(driftUpdates) {
  var self = this;
  var trx = this.db;
  var CHUNK = this.chunkSize;
  var updates = driftUpdates || [];
  for (var dci = 0; dci < updates.length; dci += CHUNK) {
    var driftChunk = updates.slice(dci, dci + CHUNK);
    var driftIds = driftChunk.map(function(u) { return u.id; });
    var driftFields = { updated_at: self.clock.now() };
    ['split_ordinal', 'split_total', 'dur'].forEach(function(col) {
      var touched = driftChunk.filter(function(u) { return u.changes[col] != null; });
      if (touched.length === 0) return;
      var expr = 'CASE id';
      var bindings = [];
      touched.forEach(function(u) { expr += ' WHEN ? THEN ?'; bindings.push(u.id, u.changes[col]); });
      expr += ' ELSE `' + col + '` END';
      driftFields[col] = trx.raw(expr, bindings);
    });
    await trx('task_instances').whereIn('id', driftIds).update(driftFields);
  }
};

/**
 * Read `users.timezone` for the user (verbatim — the legacy
 * deriveSchedulePlacements.js:66 read). H7 (999.1532).
 */
KnexScheduleRepository.prototype.getUserTimezone = function getUserTimezone(userId) {
  return this.db('users').where('id', userId).select('timezone').first();
};

module.exports = KnexScheduleRepository;
module.exports.KnexScheduleRepository = KnexScheduleRepository;
module.exports.SCHEDULE_REPOSITORY_PORT_METHODS = SCHEDULE_REPOSITORY_PORT_METHODS;
