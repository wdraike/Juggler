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
 */
KnexScheduleRepository.prototype.deleteTasksWhere = function deleteTasksWhere(userId, applyWhere) {
  return this.tasksWrite.deleteTasksWhere(this.db, userId, applyWhere);
};

/**
 * Rolling-anchor backfill: set rolling_anchor=anchor ONLY when currently NULL
 * (verbatim — runSchedule.js ~401-405), with updated_at via new Date() (P1 —
 * the legacy Knex now-builder at line 404 corrected). Returns rows updated.
 */
KnexScheduleRepository.prototype.backfillRollingAnchorIfNull = function backfillRollingAnchorIfNull(masterId, userId, anchor) {
  return this.db('task_masters')
    .where({ id: masterId, user_id: userId })
    .whereNull('rolling_anchor')
    .update({ rolling_anchor: anchor, updated_at: this.clock.now() });
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

/**
 * DB clock read (legacy `SELECT NOW(3)`, runSchedule.js ~1682) → JS Date. Used
 * for the placement-cache generatedAt so it matches MySQL updated_at.
 */
KnexScheduleRepository.prototype.now = async function now() {
  var _nowRow = await this.db.raw('SELECT NOW(3) as ts');
  var _dbNow = _nowRow[0][0].ts;
  return new Date(String(_dbNow).replace(' ', 'T') + 'Z');
};

/**
 * Read the schedule_cache blob from user_config (legacy placement cache read,
 * cal-sync.controller.js ~524). Returns the raw row or null.
 */
KnexScheduleRepository.prototype.getScheduleCache = async function getScheduleCache(userId) {
  return this.db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
};

/**
 * Upsert the schedule_cache blob into user_config (legacy runSchedule.js:2428-2433).
 * Update if the row exists, insert if it does not. Identical semantics.
 */
KnexScheduleRepository.prototype.upsertScheduleCache = async function upsertScheduleCache(userId, cacheJson) {
  var existing = await this.db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
  if (existing) {
    await this.db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).update({ config_value: cacheJson });
  } else {
    await this.db('user_config').insert({ user_id: userId, config_key: 'schedule_cache', config_value: cacheJson });
  }
};

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
 * Bulk-insert task rows — delegates to the REAL master/instance write module
 * (`lib/tasks-write.insertTasksBatch`), exactly what the legacy phase-1 chunk
 * pre-insert (runSchedule.js ~1395) called inline. H7 (999.1193).
 */
KnexScheduleRepository.prototype.insertTasksBatch = function insertTasksBatch(rows) {
  return this.tasksWrite.insertTasksBatch(this.db, rows);
};

module.exports = KnexScheduleRepository;
module.exports.KnexScheduleRepository = KnexScheduleRepository;
module.exports.SCHEDULE_REPOSITORY_PORT_METHODS = SCHEDULE_REPOSITORY_PORT_METHODS;
