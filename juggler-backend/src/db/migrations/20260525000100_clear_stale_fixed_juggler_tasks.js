/**
 * Clear stale placement_mode='fixed' on juggler-native tasks missed by
 * 20260523000100_clear_stale_when_fixed.js.
 *
 * The 2026-05-23 migration cleared tasks where placement_mode='anytime' AND
 * when='fixed'. But 9 tasks had already been converted to placement_mode='fixed'
 * by the 2026-05-18 enum-redesign backfill (which saw their legacy when='fixed'
 * token), so the cleanup predicate did not match them. They are stuck with
 * placement_mode='fixed' even though:
 *   - cal_sync_ledger.origin='juggler' for all active rows (juggler created them)
 *   - when IS NULL or '' (no user-set time constraint)
 *   - preferred_time_mins IS NULL (no preferred time)
 *
 * Correct mode: 'anytime'. Scheduler will re-place them normally.
 *
 * Also clears stale instance anchor/overdue state, same as 20260523000100.
 */

exports.up = async function(knex) {
  // 1. Identify affected masters: placement_mode='fixed', no user constraint,
  //    ALL active ledger entries have origin='juggler' (juggler is the owner).
  const affected = await knex.raw(`
    SELECT tm.id
    FROM task_masters tm
    WHERE tm.placement_mode = 'fixed'
      AND (tm.\`when\` IS NULL OR tm.\`when\` = '')
      AND tm.preferred_time_mins IS NULL
      AND EXISTS (
        SELECT 1 FROM cal_sync_ledger csl
        WHERE csl.task_id = tm.id AND csl.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM cal_sync_ledger csl
        WHERE csl.task_id = tm.id AND csl.status = 'active' AND csl.origin != 'juggler'
      )
  `);
  const ids = affected[0].map(r => r.id);

  if (ids.length === 0) {
    console.log('[20260525000100] no affected tasks found — already clean');
    return;
  }

  // 2. Reset placement_mode to 'anytime'.
  const mastersUpdated = await knex('task_masters')
    .whereIn('id', ids)
    .update({ placement_mode: 'anytime', updated_at: knex.fn.now() });

  // 3. Clear stale anchor/overdue state on instances.
  const instResult = await knex.raw(
    'UPDATE task_instances ti ' +
    '  JOIN task_masters tm ON tm.id = ti.master_id ' +
    '  SET ti.time = NULL, ti.scheduled_at = NULL, ti.date = NULL, ' +
    '      ti.overdue = 0, ti.unscheduled = 0, ti.date_pinned = 0, ' +
    '      ti.updated_at = NOW() ' +
    '  WHERE tm.id IN (?) ' +
    '    AND (ti.overdue = 1 OR ti.time IS NOT NULL) ' +
    '    AND ti.status NOT IN (?, ?, ?, ?)',
    [ids, 'done', 'cancel', 'skip', 'missed']
  );
  const instUpdated = (instResult[0] && instResult[0].affectedRows) || 0;

  console.log('[20260525000100] reset placement_mode on ' + mastersUpdated + ' master(s): ' + ids.join(', '));
  console.log('[20260525000100] cleared stale anchor/overdue on ' + instUpdated + ' instance(s)');
};

exports.down = async function() {
  // No rollback — the cleared values were inconsistent state from the
  // 2026-05-18 backfill bug. Restoring placement_mode='fixed' would
  // re-trigger the "Calendar-managed" display bug.
};
