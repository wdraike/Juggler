/**
 * Clear stale `when='fixed'` and the cached instance fields (time/scheduled_at/
 * overdue/date) on masters whose placement_mode is 'anytime'.
 *
 * Phase 9 enum redesign (20260518000100) deprecated the `when='fixed'` token —
 * placement_mode='fixed' replaced it. But three sync paths kept writing the
 * legacy token without aligning placement_mode:
 *   - cal-adapters/{gcal,msft,apple}.adapter.js (promotion-on-change)
 *   - controllers/cal-sync.controller.js (ingest-only pull + provider-origin pull)
 *
 * Result: tasks the user authored as `placement_mode='anytime'` (truly flexible)
 * silently acquired `when='fixed'` + a leftover `time` value on their instance,
 * the scheduler treated them as time-anchored, and they went overdue when the
 * stale anchor minute had already passed.
 *
 * This one-shot migration clears the inconsistent state on every master that
 * sat in the broken bucket as of today. The sync-path code fixes (committed
 * alongside) prevent re-poisoning.
 *
 * Safe to run repeatedly — idempotent guard via WHERE clause.
 */

exports.up = async function(knex) {
  // 1. Strip stale legacy token from ANYTIME masters.
  var maskUpdated = await knex('task_masters')
    .where({ placement_mode: 'anytime', when: 'fixed' })
    .update({ when: null, updated_at: knex.fn.now() });

  // 2. Clear cached anchor/overdue state on instances whose master is ANYTIME.
  //    Scheduler will re-place them in the next run; UI will render without the
  //    stale "overdue/pinned" badge that the bug produced.
  //    Filter to instances that actually carry stale state — avoids touching
  //    rows the scheduler hasn't poisoned, keeping the diff narrow.
  var instUpdated = await knex.raw(
    'UPDATE task_instances ti ' +
    '  JOIN task_masters tm ON tm.id = ti.master_id ' +
    '  SET ti.time = NULL, ti.scheduled_at = NULL, ti.date = NULL, ' +
    '      ti.overdue = 0, ti.unscheduled = 0, ti.date_pinned = 0, ' +
    '      ti.updated_at = NOW() ' +
    '  WHERE tm.placement_mode = ? ' +
    '    AND (ti.overdue = 1 OR ti.time IS NOT NULL) ' +
    '    AND ti.status NOT IN (?, ?, ?, ?)',
    ['anytime', 'done', 'cancel', 'skip', 'missed']
  );

  console.log('[20260523000100] cleared when=\'fixed\' on ' + maskUpdated + ' anytime master(s)');
  // mysql2 returns [resultSetHeader, _fields] from raw; affectedRows lives on resultSetHeader.
  var affectedRows = (instUpdated && instUpdated[0] && instUpdated[0].affectedRows) || 0;
  console.log('[20260523000100] cleared stale anchor/overdue on ' + affectedRows + ' anytime instance(s)');
};

exports.down = async function() {
  // No rollback — the cleared values were inconsistent state, not user data.
  // Restoring the broken `when='fixed'` + leftover `time` combination would
  // re-trigger the scheduler bug this migration was written to fix.
};
