/**
 * ScheduleRepositoryPort — driven-port contract for the scheduler slice's
 * persistence layer (Phase H6 / W2).
 *
 * Authoritative interface for the scheduler's DB writes. It is the typed seam
 * that absorbs the 42 DB touchpoints `runSchedule.js` performs against the
 * task model (`tasks_v` read, `task_instances` / `task_masters` written through
 * `lib/tasks-write`, `cal_sync_ledger` touched on cascades). The legacy
 * `runScheduleAndPersist` builds a `pendingUpdates` array of `{ id, dbUpdate }`
 * and flushes it via a batched CASE-update inside one `db.transaction`. This
 * port models that flush surface so the W3 `RunScheduleCommand` can pull, run
 * the pure core, and write the delta WITHOUT inlining knex.
 *
 * The repository operates on **DB-shape rows** (the snake_case column shape
 * `tasks_v` exposes / `taskToRow()` produces) — NOT on API task objects — exactly
 * as the legacy `pendingUpdates` `dbUpdate` objects do.
 *
 * Contract only (W2) — a JSDoc `@typedef` plus a throw-not-implemented base,
 * mirroring `slices/task/domain/ports/TaskRepositoryPort`. The Knex + InMemory
 * adapters (this leg) implement it; a contract test asserts both conform.
 *
 * ── BINDING INVARIANTS (implementations MUST honor; not optional) ───────────
 *
 * INVARIANT P1 (timestamps via new Date(), NEVER db.fn.now() — ADR-0003):
 *   Every write that sets `updated_at` / `created_at` / `completed_at` /
 *   `scheduled_at` MUST use a JS `new Date()` value, NEVER an inline Knex
 *   `db.fn.now()` / `trx.fn.now()`. The legacy `runSchedule.js` violates this on
 *   19 sites (404,789,804,912-913,1241,1281,1375,1399,1428,1453,1476,1486,
 *   1532,1539,1555,1597 + the 1532 fallback) — the in-scope, human-approved P1
 *   correction (WBS "P1 fix in-scope", 2026-06-12) is that THIS repository does it
 *   CORRECTLY. There is intentionally ZERO `fn.now()` reference in any
 *   ScheduleRepositoryPort implementation.
 *
 * INVARIANT S5 (delta-write — write ONLY changed tasks):
 *   `writeChanged(delta, opts)` writes exactly the rows in `delta` and nothing
 *   else. The CALLER (W3 command / the legacy persist loop) is responsible for
 *   computing the delta — the skip-condition is "the DB row already equals the
 *   computed placement" (scheduled_at/date/day/time/dur/unscheduled/overdue/
 *   slack_mins all already match). The repository does NOT re-write unchanged
 *   rows; it has no "write-all" path. This is the H6 write-all→write-changed
 *   behavioral change (DESIGN §6 S5; user ruling 2026-06-12). It is SYNC-SAFE:
 *   cal-sync change-detection is content-hash based (taskHash over scheduled_at/
 *   dur/etc), NOT updated_at-freshness based — see W2 sync-safety finding.
 *
 * INVARIANT T-TX (transaction boundaries preserved):
 *   The legacy persist runs inside `db.transaction(async trx => …)`. The
 *   repository accepts an injected `db` that MAY be a trx handle, so the caller's
 *   transaction boundary is preserved (the W3 command opens the trx and hands the
 *   trx-bound repo to `writeChanged`). The repository never opens its own
 *   transaction around `writeChanged` — it participates in the caller's.
 *
 * INVARIANT T-TENANCY (user_id scoping preserved):
 *   Every write is scoped by `userId` exactly as the legacy
 *   `tasksWrite.updateTasksWhere(trx, userId, …)` / `updateTaskById(trx, id, …, userId)`
 *   calls were. The repository never widens past its tenant.
 *
 * ── end binding invariants ─────────────────────────────────────────────────
 *
 * @typedef {Object} ScheduleDeltaRow
 * @property {string} id  task_instances id to update.
 * @property {Object} dbUpdate  the snake_case column→value patch (e.g.
 *   `{ scheduled_at, date, day, time, unscheduled, overdue, dur, slack_mins }`
 *   for a placement, or `{ unscheduled: 1 }` / `{ overdue: 1 }` / `{ status:
 *   'missed', scheduled_at, completed_at }` for the unplaced/past paths). Any
 *   timestamp value MUST be a JS Date (P1) — the repository asserts it.
 *
 * @typedef {Object} ScheduleRepositoryPort
 *
 * @property {(delta: ScheduleDeltaRow[], opts?: {instanceOnly?: boolean}) => Promise<{written: number}>} writeChanged
 *   Write ONLY the rows in `delta` (S5). Splits into the batched scheduled_at/dur
 *   CASE update (the legacy "scheduledAtUpdates" path, chunked at 200) and the
 *   per-row "otherUpdates" path (status changes / flag-only updates), exactly as
 *   the legacy persist did — but over ONLY the changed rows the caller passed.
 *   Returns the number of rows written. `opts.instanceOnly` routes the batched
 *   update to instances only (the legacy `{ instanceOnly: true }` on the CASE
 *   update — the scheduler must not overwrite master.dur).
 *
 * @property {(userId: string, applyWhere: (q: Object) => Object) => Promise<number>} deleteTasksWhere
 *   Bulk delete via a where-builder (`lib/tasks-write.deleteTasksWhere`) — the
 *   legacy merged-out-chunk cleanup (runSchedule.js ~1660). Returns rows removed.
 *
 * @property {(masterId: string, userId: string, anchor: string) => Promise<number>} backfillRollingAnchorIfNull
 *   Set `task_masters.next_start = anchor` (P1: `updated_at = new Date()`)
 *   ONLY when it is currently NULL — the rolling-anchor backfill
 *   (runSchedule.js ~401-404, the `trx.fn.now()` at 404 corrected to new Date()).
 *   Returns rows updated (0 or 1).
 *
 * @typedef {Object} SplitDriftUpdate
 * @property {string} id  task_instances id to update.
 * @property {Object} changes  `{ split_ordinal?, split_total?, dur? }` — the
 *   drift-fixed field values (999.1019). Only fields present (`!= null`) are
 *   folded into the CASE update; the others are left at their current value.
 *
 * @property {(driftUpdates: SplitDriftUpdate[]) => Promise<void>} applySplitDriftFix
 *   Batch drift-fix UPDATEs into CASE-WHEN expressions, chunked at the
 *   repository's chunk size (200), for `split_ordinal`/`split_total`/`dur`
 *   only (`updated_at` via P1 `new Date()`). This is a SEPARATE write path
 *   from `writeChanged` — it does NOT touch `unscheduled`/`unplaced_reason`/
 *   `unplaced_detail` (unlike writeChanged's batched CASE path), so routing a
 *   drift-fix delta through `writeChanged` instead would add unwanted field
 *   writes. (Legacy: runSchedule.js ~1307-1328 — the recurring-split-chunk
 *   reconcile pass's DRIFT_CHUNK loop.) JUG-SCHEDULER-LEGACY-DB-BYPASS
 *   (999.1532).
 *
 * @property {(userId: string) => Promise<Object|undefined>} getUserTimezone
 *   Read `users.timezone` for `userId` (legacy `deriveSchedulePlacements.js`
 *   ~66 `db('users').where('id', userId).select('timezone').first()`) — used
 *   to resolve the display timezone for the MCP `get_schedule` read-derivation
 *   path. JUG-SCHEDULER-LEGACY-DB-BYPASS (999.1532).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function ScheduleRepositoryPort() {}

ScheduleRepositoryPort.prototype.writeChanged = function writeChanged(_delta, _opts) {
  throw new Error('ScheduleRepositoryPort.writeChanged not implemented');
};

ScheduleRepositoryPort.prototype.deleteTasksWhere = function deleteTasksWhere(_userId, _applyWhere) {
  throw new Error('ScheduleRepositoryPort.deleteTasksWhere not implemented');
};

ScheduleRepositoryPort.prototype.backfillRollingAnchorIfNull = function backfillRollingAnchorIfNull(_masterId, _userId, _anchor) {
  throw new Error('ScheduleRepositoryPort.backfillRollingAnchorIfNull not implemented');
};

ScheduleRepositoryPort.prototype.applySplitDriftFix = function applySplitDriftFix(_driftUpdates) {
  throw new Error('ScheduleRepositoryPort.applySplitDriftFix not implemented');
};

// 999.1217 (W4, SCHEDULER-SPEC.md D6): `now()` (DB-clock read) and
// `getScheduleCache`/`upsertScheduleCache` (user_config schedule_cache blob)
// were removed — they existed solely to serve the legacy placement-cache
// `generatedAt`/read/write for cal-sync's split-part+duration correction.
// cal-sync now reads task_instances directly (999.841 — split chunks persist
// as their own rows) and recomputes duration via
// ConstraintSolver.effectiveDuration; nothing reads or writes schedule_cache
// anymore.

/**
 * Read ALL user_config rows for a user (legacy loadSchedulerConfig read,
 * loadSchedulerConfig.js ~79). Raw rows — parsing/assembly stays in the
 * pure `buildSchedulerCfg` helper. H7 boundary hardening (999.1193).
 * @param {string} userId tenant scope.
 * @returns {Promise<Array<Object>>} raw user_config rows.
 */
ScheduleRepositoryPort.prototype.getUserConfigRows = function getUserConfigRows(_userId) {
  throw new Error('ScheduleRepositoryPort.getUserConfigRows not implemented');
};

/**
 * Read the user's locations rows ordered by sort_order (legacy
 * loadSchedulerConfig read, loadSchedulerConfig.js ~80). H7 (999.1193).
 * @param {string} userId tenant scope.
 * @returns {Promise<Array<Object>>} raw locations rows.
 */
ScheduleRepositoryPort.prototype.getLocations = function getLocations(_userId) {
  throw new Error('ScheduleRepositoryPort.getLocations not implemented');
};

/**
 * Bulk-insert task rows (legacy phase-1 chunk pre-insert,
 * runSchedule.js ~1395 via lib/tasks-write.insertTasksBatch). H7 (999.1193).
 * @param {Array<Object>} rows DB-shape task rows (already owner-scoped).
 * @returns {Promise<void>}
 */
ScheduleRepositoryPort.prototype.insertTasksBatch = function insertTasksBatch(_rows) {
  throw new Error('ScheduleRepositoryPort.insertTasksBatch not implemented');
};

/**
 * Read `users.timezone` for `userId` (legacy `deriveSchedulePlacements.js`
 * ~66). H7 (999.1532).
 * @param {string} userId tenant scope.
 * @returns {Promise<Object|undefined>} `{ timezone }` row, or undefined if not found.
 */
ScheduleRepositoryPort.prototype.getUserTimezone = function getUserTimezone(_userId) {
  throw new Error('ScheduleRepositoryPort.getUserTimezone not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy ScheduleRepositoryPort.
 * @type {ReadonlyArray<string>}
 */
var SCHEDULE_REPOSITORY_PORT_METHODS = Object.freeze([
  'writeChanged',
  'deleteTasksWhere',
  'backfillRollingAnchorIfNull',
  'getUserConfigRows',
  'getLocations',
  'insertTasksBatch',
  'applySplitDriftFix',
  'getUserTimezone'
]);

module.exports = ScheduleRepositoryPort;
module.exports.ScheduleRepositoryPort = ScheduleRepositoryPort;
module.exports.SCHEDULE_REPOSITORY_PORT_METHODS = SCHEDULE_REPOSITORY_PORT_METHODS;
