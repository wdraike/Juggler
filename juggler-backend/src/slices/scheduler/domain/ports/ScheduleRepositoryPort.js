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
 *   Set `task_masters.rolling_anchor = anchor` (P1: `updated_at = new Date()`)
 *   ONLY when it is currently NULL — the legacy rolling-anchor backfill
 *   (runSchedule.js ~401-404, the `trx.fn.now()` at 404 corrected to new Date()).
 *   Returns rows updated (0 or 1).
 *
 * @property {() => Promise<Date>} now
 *   The DB clock (`SELECT NOW(3)`) the legacy persist reads for the placement
 *   cache `generatedAt` (runSchedule.js ~1682). Surfaced via the port so the
 *   command stays free of raw knex. Returns a JS Date.
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

ScheduleRepositoryPort.prototype.now = function now() {
  throw new Error('ScheduleRepositoryPort.now not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy ScheduleRepositoryPort.
 * @type {ReadonlyArray<string>}
 */
var SCHEDULE_REPOSITORY_PORT_METHODS = Object.freeze([
  'writeChanged',
  'deleteTasksWhere',
  'backfillRollingAnchorIfNull',
  'now'
]);

module.exports = ScheduleRepositoryPort;
module.exports.ScheduleRepositoryPort = ScheduleRepositoryPort;
module.exports.SCHEDULE_REPOSITORY_PORT_METHODS = SCHEDULE_REPOSITORY_PORT_METHODS;
