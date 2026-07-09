/**
 * RunScheduleCommand — the scheduler slice's I/O orchestrator (Phase H6 / W3).
 *
 * THE SOLE PERSIST SEAM. Before W3 the scheduler had TWO delta-write impls:
 * the LIVE inline flush in `runSchedule.js` (`runScheduleAndPersist`'s
 * `pendingUpdates` batched CASE-update + per-row otherUpdates loop, ~lines
 * 1694-1771) AND the dormant W2 `KnexScheduleRepository.writeChanged` adapter.
 * W3 COLLAPSES the two to ONE: `runScheduleAndPersist` now routes EVERY scheduler
 * DB write through this command's W2 adapters. The inline knex flush is gone.
 *
 * It pulls nothing and runs no domain logic itself — the pure core
 * (`unifiedScheduleV2`) is invoked in-memory by the caller, the delta (which
 * rows changed) is computed by the caller's existing `placementMatchesDbRow`
 * skip (the SAME skip the legacy inline flush used), and this command is handed
 * the resulting `pendingUpdates` to flush. Concretely it exposes the typed
 * persist primitives over the W2 ports:
 *
 *   persistDelta(trx, userId, delta, opts)      → ScheduleRepositoryPort.writeChanged (S5 delta-write)
 *   deleteTasksWhere(trx, userId, applyWhere)   → ScheduleRepositoryPort.deleteTasksWhere
 *   backfillRollingAnchor(trx, userId, m, a)    → ScheduleRepositoryPort.backfillRollingAnchorIfNull
 *   dbNow(trx)                                  → ScheduleRepositoryPort.now (cache generatedAt clock)
 *   clockNow()                                  → ClockPort.now (JS new Date() — P1 stamp)
 *
 * ── WHY a thin per-primitive orchestrator (the seam) ─────────────────────────
 * `runScheduleAndPersist` is one ~1,600-line transaction body that interleaves
 * reads, the pure-core call, the delta computation, and writes. Lifting the whole
 * body into a command would be a behavior-risk rewrite on the HIGHEST-risk hex
 * phase (scheduler bugs cascade and corrupt all task data — CLAUDE.md §Scheduler).
 * Instead, `runScheduleAndPersist` stays the public entry (signature + deadlock-
 * retry + the trx boundary unchanged) and DELEGATES each persist touchpoint to
 * this command, which owns the W2 adapter wiring. This is the cleaner seam: it
 * removes the inline knex flush + the 19 inline `db.fn.now()` (P1) WITHOUT
 * restructuring the read/compute interleaving the golden-master pins bit-for-bit.
 *
 * ── INVARIANT S4/S6 (NEVER import scheduleQueue) ─────────────────────────────
 * This module MUST NOT require `scheduleQueue` (nor reference `enqueueScheduleRun`).
 * The golden-master static require-closure assert pins that `RunScheduleCommand`
 * is not in the scheduleQueue closure (and vice-versa). The command persists; it
 * does not trigger. Triggering stays the mutation→queue seam's job.
 *
 * ── INVARIANT T-TX (caller owns the transaction) ─────────────────────────────
 * Every primitive takes the caller's `trx` and binds a fresh trx-scoped
 * `KnexScheduleRepository` for the call, so all writes participate in the
 * caller's `db.transaction(...)` (commit/rollback together). This command never
 * opens its own transaction. Deadlock-retry (MAX_RETRIES=3 on ER_LOCK_DEADLOCK)
 * and the sync-lock claim stay in the caller (`runScheduleAndPersist` /
 * `getSchedulePlacements`), NOT here — the retry must re-open the WHOLE
 * transaction (read + compute + write), which only the caller can do.
 *
 * ── INVARIANT P1 (new Date(), never the Knex now-builder) ────────────────────
 * `clockNow()` returns a JS `new Date()` (via the injected ClockPort). The caller
 * uses it for every timestamp it previously stamped with `db.fn.now()` /
 * `trx.fn.now()`. The repository's `_assertDates` fails loud if a non-Date
 * timestamp ever reaches `writeChanged` — so a regressed `fn.now()` cannot slip
 * through. There is ZERO `fn.now()` reference in this file or its adapters.
 *
 * ── NO NEW FALLBACKS ── no `||`/`??` defaulting of a maybe-missing value is
 * introduced; required deps fail loud.
 */

'use strict';

var KnexScheduleRepository = require('../adapters/KnexScheduleRepository');
var MysqlClockAdapter = require('../adapters/MysqlClockAdapter');

/**
 * @param {Object} [deps]
 * @param {Function} [deps.repositoryFactory] (db) => ScheduleRepositoryPort —
 *   builds a repository bound to the given trx/db handle. Default: a
 *   `KnexScheduleRepository` over that handle (ADR-0002 lib/db inside the adapter).
 *   Injectable so tests can supply an InMemoryScheduleRepository.
 * @param {Object} [deps.clock] ClockPort (default: MysqlClockAdapter). Supplies
 *   the P1 `new Date()` stamp via `now()`.
 */
function RunScheduleCommand(deps) {
  var d = deps || {};
  this.clock = d.clock || new MysqlClockAdapter();
  var clock = this.clock;
  this.repositoryFactory = d.repositoryFactory || function (db) {
    return new KnexScheduleRepository({ db: db, clock: clock });
  };
}

/**
 * Build a repository bound to the caller's trx handle (T-TX). Internal.
 * @param {Function} trx Knex trx handle (the caller's transaction).
 */
RunScheduleCommand.prototype._repo = function _repo(trx) {
  if (!trx) throw new Error('RunScheduleCommand: a trx/db handle is required (T-TX)');
  return this.repositoryFactory(trx);
};

/**
 * Flush the changed-rows delta (S5). `delta` is the legacy `pendingUpdates`
 * array of `{ id, dbUpdate }` — already filtered to ONLY changed rows by the
 * caller's `placementMatchesDbRow` skip. Routes to the SINGLE delta-write impl
 * (`KnexScheduleRepository.writeChanged`), which reproduces the legacy two-path
 * flush (batched scheduled_at/dur CASE update chunked at 200 + per-row
 * otherUpdates) byte-for-byte, with `updated_at` via new Date() (P1).
 *
 * @param {Function} trx caller's transaction handle (T-TX).
 * @param {string} userId tenant scope (T-TENANCY).
 * @param {Array<{id:string, dbUpdate:Object}>} delta the changed rows.
 * @param {Object} [opts] { instanceOnly?: boolean } (default true — the legacy
 *   batched CASE update used instanceOnly:true so master.dur is never overwritten).
 * @returns {Promise<{written: number}>}
 */
RunScheduleCommand.prototype.persistDelta = function persistDelta(trx, userId, delta, opts) {
  var options = opts || {};
  return this._repo(trx).writeChanged(delta || [], {
    userId: userId,
    instanceOnly: options.instanceOnly !== false
  });
};

/**
 * Bulk delete via a where-builder — the merged-out-chunk cleanup
 * (legacy runSchedule.js ~1776). Delegates to the repository's deleteTasksWhere.
 * @param {Function} trx caller's transaction handle.
 * @param {string} userId tenant scope.
 * @param {(q: Object) => Object} applyWhere
 * @returns {Promise<{instanceDeleted:number, masterDeleted:number}>}
 */
RunScheduleCommand.prototype.deleteTasksWhere = function deleteTasksWhere(trx, userId, applyWhere) {
  return this._repo(trx).deleteTasksWhere(userId, applyWhere);
};

/**
 * Set `task_masters.rolling_anchor = anchor` (updated_at = new Date(), P1) ONLY
 * when currently NULL — the legacy rolling-anchor backfill (runSchedule.js
 * ~490-496, the `trx.fn.now()` at 495 corrected). Delegates to the repository.
 * @returns {Promise<number>} rows updated (0 or 1).
 */
RunScheduleCommand.prototype.backfillRollingAnchor = function backfillRollingAnchor(trx, userId, masterId, anchor) {
  return this._repo(trx).backfillRollingAnchorIfNull(masterId, userId, anchor);
};

/**
 * FR-1(b)/AC2 (juggler-recur-lifecycle-redesign, W2): unconditionally set
 * `task_masters.next_start = nextStart` (updated_at via clock.now(), P1).
 * The caller has already computed a fresh, non-stale value for a non-rolling
 * master — see KnexScheduleRepository.setNextStart.
 * @returns {Promise<number>} rows updated (0 or 1).
 */
RunScheduleCommand.prototype.setNextStart = function setNextStart(trx, userId, masterId, nextStart) {
  return this._repo(trx).setNextStart(masterId, userId, nextStart);
};

/**
 * DB clock (`SELECT NOW(3)`) → JS Date for the placement-cache `generatedAt`
 * (legacy runSchedule.js ~1798). Surfaced via the port so the caller stays free
 * of raw knex for this read.
 * @param {Function} trx caller's transaction handle.
 * @returns {Promise<Date>}
 */
RunScheduleCommand.prototype.dbNow = function dbNow(trx) {
  return this._repo(trx).now();
};

/**
 * Process wall-clock as a JS Date (P1). The caller uses this for every timestamp
 * it previously stamped with `db.fn.now()` / `trx.fn.now()` on the inline
 * reconcile / phase-1 / pendingUpdates writes. NEVER the Knex now-builder.
 * @returns {Date}
 */
RunScheduleCommand.prototype.clockNow = function clockNow() {
  return this.clock.now();
};

/**
 * Read the schedule_cache blob (delegates to the repository's getScheduleCache).
 * @param {Function} trx caller's transaction handle.
 * @param {string} userId tenant scope.
 * @returns {Promise<Object|null>} the user_config row or null.
 */
RunScheduleCommand.prototype.getScheduleCache = function getScheduleCache(trx, userId) {
  return this._repo(trx).getScheduleCache(userId);
};

/**
 * Upsert the schedule_cache blob (delegates to the repository's upsertScheduleCache).
 * @param {Function} trx caller's transaction handle.
 * @param {string} userId tenant scope.
 * @param {string} cacheJson JSON.stringify'd placement cache.
 * @returns {Promise<void>}
 */
RunScheduleCommand.prototype.upsertScheduleCache = function upsertScheduleCache(trx, userId, cacheJson) {
  return this._repo(trx).upsertScheduleCache(userId, cacheJson);
};

module.exports = RunScheduleCommand;
module.exports.RunScheduleCommand = RunScheduleCommand;
