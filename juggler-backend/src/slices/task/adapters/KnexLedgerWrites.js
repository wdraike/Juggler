/**
 * KnexLedgerWrites — cal_sync_ledger + task_masters.next_start writes moved
 * VERBATIM from task/facade.js's raw-table collaborators (handleTemplatePause,
 * applyRollingAnchor, reactivateDoneFrozen) so the facade carries no direct db
 * access (adapters are the slice's only DB layer — see
 * eslint.boundaries.config.js DB_DIRECT_SELECTORS).
 *
 * Deliberately NOT on KnexTaskRepository: these writes stamp `synced_at`
 * (cal_sync_ledger) / the anchor `updated_at` (task_masters) with Knex's
 * `fn.now()`, which KnexTaskRepository's INVARIANT P1 forbids ("intentionally
 * ZERO fn.now() reference in this file" — enforced by a SOURCE PROOF test).
 * Per the pre-existing Oscar-gated W3 RE-REVIEW decision (facade.js header),
 * these two columns are OUT of P1 scope and were never routed through
 * KnexTaskRepository's write path — this adapter preserves that split,
 * reproducing `fn.now()` verbatim (no behavior change) instead of silently
 * correcting it to `new Date()`.
 *
 * @param {Object} [deps]
 * @param {Function} [deps.db] Knex instance (default: lib/db's shared
 *   singleton via getDefaultDb(), ADR-0002 — same connection KnexTaskRepository
 *   uses by default).
 */
var { stampUpdate } = require('../../../lib/audit-context'); // 999.1576 inc.3b
function KnexLedgerWrites(deps) {
  var d = deps || {};
  this.db = d.db || require('../../../lib/db').getDefaultDb();
}

/**
 * Soft-clear active cal_sync_ledger rows for a set of task ids (non-
 * transactional — the caller wraps the call site in its own .catch, exactly
 * as the legacy handler did). Verbatim relocation of facade.js's
 * handleTemplatePause pause-branch ledger cleanup.
 * @param {string} userId
 * @param {string[]} taskIds
 * @returns {Promise<number>}
 */
KnexLedgerWrites.prototype.clearActiveLedgerForTasks = function clearActiveLedgerForTasks(userId, taskIds) {
  return this.db('cal_sync_ledger')
    .where('user_id', userId)
    .whereIn('task_id', taskIds)
    .where('status', 'active')
    .update(stampUpdate({ status: 'deleted_local', task_id: null, synced_at: this.db.fn.now() }));
};

/**
 * Recurrence-anchor projection write — the single unified `next_start` column
 * on task_masters, advanced monotonically via GREATEST(COALESCE(...)) so a
 * concurrent terminal write can never regress the anchor. Verbatim relocation
 * of facade.js's applyRollingAnchor write (both the rolling and pattern-recur
 * branches share this same update shape).
 *
 * `dbOrTrx` is REQUIRED (not defaulted here) — the caller (facade.js
 * applyRollingAnchor) computes `ctx.db || _repo.db` itself and threads the
 * result through, preserving the pre-existing trx-escape-hazard guard
 * (WARN ernie-w1-anchor-trx-escape / cookie-C1) verbatim: a moved function
 * that silently defaulted to the base pool inside a caller's transaction
 * would be a partial-commit data bug.
 * @param {Function} dbOrTrx  knex instance or active trx handle
 * @param {string} masterId
 * @param {string} userId
 * @param {string} newAnchor  date key (YYYY-MM-DD)
 * @returns {Promise<number>}
 */
KnexLedgerWrites.prototype.updateNextStartAnchor = function updateNextStartAnchor(dbOrTrx, masterId, userId, newAnchor) {
  return dbOrTrx('task_masters')
    .where({ id: masterId, user_id: userId })
    .update(stampUpdate({
      next_start: dbOrTrx.raw('GREATEST(COALESCE(next_start, ?), ?)', [newAnchor, newAnchor]),
      updated_at: dbOrTrx.fn.now()
    }));
};

/**
 * updateTaskStatus done-frozen reactivation — flips a `done_frozen`
 * cal_sync_ledger row back to `active`. Verbatim relocation of facade.js's
 * reactivateDoneFrozen.
 * @param {string} userId
 * @param {string} taskId
 * @returns {Promise<number>}
 */
KnexLedgerWrites.prototype.reactivateDoneFrozenLedger = function reactivateDoneFrozenLedger(userId, taskId) {
  return this.db('cal_sync_ledger')
    .where({ user_id: userId, task_id: taskId, status: 'done_frozen' })
    .update(stampUpdate({ status: 'active', synced_at: this.db.fn.now() }));
};

/**
 * takeOwnership ledger detach — soft-clears ALL active cal_sync_ledger rows for
 * one task. Verbatim relocation of facade.js's detachLedger (controller
 * L2403-2405). Unlike clearActiveLedgerForTasks above (batch of task ids, own
 * `this.db`, nulls task_id), this call does NOT null task_id and runs inside
 * the CALLER's transaction (JUG-FACADE-DB-VIOLATIONS final stage).
 *
 * `dbOrTrx` is REQUIRED (not defaulted) — same trx-escape-hazard discipline as
 * updateNextStartAnchor above: TakeOwnership.js always invokes this inside
 * repo.runInTransaction and passes the transaction-bound trxRepo's own `db`
 * handle, so a silent default to the base pool would let this write escape the
 * caller's commit/rollback boundary.
 * @param {Function} dbOrTrx  knex instance or active trx handle
 * @param {string} userId
 * @param {string} taskId
 * @returns {Promise<number>}
 */
KnexLedgerWrites.prototype.detachTaskLedger = function detachTaskLedger(dbOrTrx, userId, taskId) {
  return dbOrTrx('cal_sync_ledger')
    .where({ task_id: taskId, user_id: userId, status: 'active' })
    .update(stampUpdate({ status: 'deleted_local', synced_at: dbOrTrx.fn.now() }));
};

module.exports = KnexLedgerWrites;
