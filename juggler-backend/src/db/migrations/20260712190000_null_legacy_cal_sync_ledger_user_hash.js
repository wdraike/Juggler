'use strict';

/**
 * One-time data correction for the userHash() marker-field removal (999.1549).
 *
 * userHash() previously included `task.marker` in its join array (a non-user
 * -editable, scheduler/adapter-derived field). Removing it changes the join
 * arity (9 fields -> 8), so on deploy EVERY existing juggler-origin
 * cal_sync_ledger.last_user_hash value (computed by the OLD formula) will
 * mismatch the NEW formula's output exactly once — even for rows where the
 * user made no edit at all.
 *
 * If, at that moment, a row's calendar event happens to be missing
 * (miss_count >= 1), the repush guard (cal-sync.controller.js ~743-761,
 * gated on `ledger.last_user_hash !== null && userHash(task) !== ledger.last_user_hash`)
 * would fire ONE spurious repush — the same class of bug as the incident
 * this leg fixes, just bounded/self-healing instead of an endless loop.
 *
 * The repush guard's existing legacy escape hatch only protects rows where
 * last_user_hash IS NULL (they fall through to the normal deletion ladder
 * instead of triggering repush). Nulling out every existing last_user_hash
 * here routes ALL pre-deploy rows through that safe fall-through instead of
 * the false-mismatch repush path. The ledger naturally re-populates
 * last_user_hash (via the new formula) on next push, so this is a one-time,
 * safe-to-lose value, not durable state.
 *
 * Scoped to origin='juggler' — last_user_hash is only meaningful for
 * juggler-origin rows; the repush guard itself is gated on
 * `ledger.origin === JUGGLER_ORIGIN` (cal-sync.controller.js:40,745), so
 * non-juggler-origin rows can never take the repush branch regardless of
 * their last_user_hash value.
 *
 * Traceability: 999.1549 (zoe-999-1549-w1 deploy-transition WARN mitigation)
 */

exports.up = async function up(knex) {
  await knex('cal_sync_ledger')
    .where('origin', 'juggler')
    .whereNotNull('last_user_hash')
    .update({ last_user_hash: null });
};

exports.down = async function down(knex) {
  // No-op — the pre-deploy last_user_hash values were computed by the OLD
  // (marker-included) formula and are not recoverable/meaningful once the
  // code fix (userHash without marker) is live. Re-populating them would
  // require re-deriving from historical task state, which is out of scope
  // for a rollback of this one-time correction.
};
