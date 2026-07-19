/**
 * stale-instance-heal-decision.js — pure "should this stale recurring-instance
 * ledger row be healed?" decision for cal-sync's sync() Phase 2 loop.
 *
 * 999.2062 (residual [self-heal-stale-instance]): carves the self-heal block out
 * of controllers/cal-sync.controller.js. Reconcile re-numbers occurrence_ordinal
 * over time; ledger task_ids end up pointing to instances that were replaced by
 * new rows for the same date. Before the `!task && event` branch (which deletes
 * the provider event + marks the ledger deleted_local, followed by a fresh push
 * that creates a duplicate event), rewrite the ledger to the current live
 * instance when one can be found by (master, date).
 *
 * Scope: recurring instance task_ids of the form `<masterId>-<ordinal>`. The
 * trailing `-\d+` captures numeric ordinals for both UUID masters
 * (dash-separated v7 UUIDs) and legacy short-id masters like
 * `t1775853066082nuxt-1157`. Split chunks use `_part<N>` (underscore) so they
 * are not matched — they fall through to the original branch. event_start is an
 * ISO datetime from the provider; its leading YYYY-MM-DD is compared against the
 * instance's `date`.
 *
 * Decisions in, effects out: no DB, no HTTP. The ledgerUpdates.push and the
 * in-memory ledger/task rebinding stay at the call site.
 *
 * @param {Object} ctx
 *   @param {Object|null} ctx.task              task resolved for the ledger row (heal only runs when null)
 *   @param {Object}      ctx.ledger            active ledger row under iteration
 *   @param {Object}      ctx.tasksByMasterDate '<masterId>|<YYYY-MM-DD>' → live instance task
 *   @param {Array}       ctx.activeLedgers     this provider's active ledger rows (pLedger)
 * @returns {{action: 'none'}
 *         | {action: 'mark-replaced', ledgerId: *, fields: {status: 'replaced'}}
 *         | {action: 'relink', ledgerId: *, fields: {task_id: *}, healedTask: Object}}
 *   'mark-replaced' — the healed task is already tracked by ANOTHER active row;
 *   relinking would violate the active_task_key unique constraint.
 */

'use strict';

function decideStaleInstanceHeal(ctx) {
  var task = ctx.task;
  var ledger = ctx.ledger;

  if (task || !ledger.task_id || !ledger.event_start) return { action: 'none' };

  var masterMatch = ledger.task_id.match(/^(.+)-\d+$/);
  var dateMatch = ledger.event_start.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!masterMatch || !dateMatch) return { action: 'none' };

  var healed = ctx.tasksByMasterDate[masterMatch[1] + '|' + dateMatch[1]];
  if (!healed) return { action: 'none' };

  var healAlreadyTracked = ctx.activeLedgers.some(function (l) {
    return l.task_id === healed.id && l.id !== ledger.id;
  });
  if (healAlreadyTracked) {
    return { action: 'mark-replaced', ledgerId: ledger.id, fields: { status: 'replaced' } };
  }
  return { action: 'relink', ledgerId: ledger.id, fields: { task_id: healed.id }, healedTask: healed };
}

module.exports = { decideStaleInstanceHeal: decideStaleInstanceHeal };
