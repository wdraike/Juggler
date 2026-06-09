'use strict';

/**
 * Drop the misplaced `chk_task_masters_scheduled_at_for_terminal` CHECK constraint.
 *
 * Migration 20260605000000 added, to task_masters:
 *   - a `scheduled_at` column, and
 *   - a CHECK constraint requiring scheduled_at IS NOT NULL when status is terminal
 *     ('done','skip','cancel','missed').
 *
 * But `scheduled_at` is an INSTANCE-level field, not a master-level one:
 *   - src/lib/tasks-write.js MASTER_FIELDS carries `status` but NOT `scheduled_at`;
 *     `scheduled_at` lives in INSTANCE_FIELDS only.
 *   - So task_masters.scheduled_at is never populated, and any task_master row with
 *     a terminal status (which pickMaster legitimately writes for one-off/completed
 *     tasks) ALWAYS violates the constraint → INSERT fails with a CHECK violation.
 *
 * The meaningful invariant ("a terminal occurrence has a scheduled_at") is already
 * correctly enforced on task_instances by `chk_task_instances_terminal_scheduled`
 * (migration 20260527213906). This master-level constraint is redundant AND broken,
 * so it is dropped. The unused task_masters.scheduled_at column is left in place
 * (dropping a column is higher-risk and not required to fix the bug).
 *
 * Surfaced by tests/cal-sync/12-sync-deletion (done_frozen reset) once the juggler
 * test suite was restored (999.301/999.304). Pre-existing prod schema bug — any
 * insert of a terminal-status task_master would 500.
 */
async function checkExists(knex, table, name) {
  const rows = await knex.raw(
    "SELECT 1 FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ? LIMIT 1",
    [table, name]
  );
  return rows[0].length > 0;
}

exports.up = async function(knex) {
  if (await checkExists(knex, 'task_masters', 'chk_task_masters_scheduled_at_for_terminal')) {
    await knex.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_scheduled_at_for_terminal');
    console.log('[MIGRATION] dropped misplaced chk_task_masters_scheduled_at_for_terminal');
  } else {
    console.log('[MIGRATION] chk_task_masters_scheduled_at_for_terminal not present, skipping');
  }
};

exports.down = async function(knex) {
  // Best-effort restore of prior state. NOTE: re-adding will FAIL if any terminal
  // task_master rows exist (which is exactly why the constraint was dropped), so
  // this is guarded and may legitimately no-op.
  if (await checkExists(knex, 'task_masters', 'chk_task_masters_scheduled_at_for_terminal')) {
    return;
  }
  try {
    await knex.raw(`
      ALTER TABLE task_masters
      ADD CONSTRAINT chk_task_masters_scheduled_at_for_terminal
      CHECK (
        (status NOT IN ('done', 'skip', 'cancel', 'missed') OR scheduled_at IS NOT NULL)
        OR
        (status IS NULL OR status = '')
      )
    `);
  } catch (e) {
    console.warn('[MIGRATION] could not restore chk_task_masters_scheduled_at_for_terminal (terminal rows exist): ' + e.message);
  }
};
