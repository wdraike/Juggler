/**
 * done-frozen-policy.js — the two pure sides of the done_frozen ledger
 * lifecycle, carved from controllers/cal-sync.controller.js (999.2062,
 * residuals [done-frozen-skip] + [done-frozen-freeze]).
 *
 *   decideDoneFrozenSkip(ctx)  — [FIX D-03] rows already frozen after a prior
 *     successful push skip the push entirely; returns the ledger-update
 *     descriptor (event_summary refresh + miss_count reset) and the 'skipped'
 *     sync_history log descriptor ([FIX D-10]). calendarName is a call-site
 *     concern (needs pid → label resolution).
 *
 *   shouldFreezeDonePush(ctx)  — [FIX D-02] freeze a done task's ledger row
 *     after its first successful push, only under calCompletedBehavior
 *     'update' (delete-behavior rows never reach a push; keep-behavior rows
 *     must keep pushing so later edits propagate).
 *
 * Decisions in, effects out: no DB, no HTTP. ledgerUpdates.push, stats bumps,
 * and logSyncAction stay at the call site.
 *
 * @param {Object} ctx
 *   @param {Object|null} ctx.task    task for the ledger row (may be null)
 *   @param {Object|null} ctx.event   provider event for the row (may be null)
 *   @param {Object}      ctx.ledger  active ledger row under iteration
 * @returns {{action: 'none'}
 *         | {action: 'skip', ledgerUpdate: {id: *, fields: Object},
 *            log: {action: 'skipped', opts: Object}}}
 */

'use strict';

function decideDoneFrozenSkip(ctx) {
  var task = ctx.task;
  var event = ctx.event;
  var ledger = ctx.ledger;

  if (ledger.status !== 'done_frozen') return { action: 'none' };

  return {
    action: 'skip',
    ledgerUpdate: { id: ledger.id, fields: {
      event_summary: event ? (event.title || task.text) : task.text,
      miss_count: 0
    }},
    log: { action: 'skipped', opts: {
      taskId: task ? task.id : null,
      taskText: task ? task.text : null,
      eventId: ledger.provider_event_id
    }}
  };
}

/**
 * @param {Object} ctx
 *   @param {Object|null} ctx.task                 the just-pushed task (upd.task)
 *   @param {string}      ctx.calCompletedBehavior user's completed-task sync behavior
 * @returns {boolean} true iff the row should be frozen (status → done_frozen).
 */
function shouldFreezeDonePush(ctx) {
  var task = ctx.task;
  return !!(task && task.status === 'done' && ctx.calCompletedBehavior === 'update');
}

module.exports = {
  decideDoneFrozenSkip: decideDoneFrozenSkip,
  shouldFreezeDonePush: shouldFreezeDonePush
};
