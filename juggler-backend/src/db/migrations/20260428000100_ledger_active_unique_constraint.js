/**
 * Bug #5: Concurrent sync runs can both reach the Phase 3 push before either
 * commits, producing duplicate active ledger rows for the same task+provider.
 *
 * Fix: add a generated virtual column that is CONCAT(user_id|provider|task_id)
 * when status='active' and task_id IS NOT NULL, else NULL. A unique index on
 * this column blocks duplicate active rows while allowing multiple tombstone
 * rows (deleted_local/deleted_remote) for the same task_id — those get NULL
 * from the generated expression so they don't trigger the constraint.
 *
 * MySQL ignores NULLs in unique indexes (each NULL is distinct), so non-active
 * rows and rows without a task_id are always allowed through.
 *
 * The sync controller must use INSERT IGNORE for ledger inserts so that a
 * concurrent-write collision is silently skipped rather than causing a 500.
 */
exports.up = async function(knex) {
  // 1. Clean up any existing duplicate active rows — keep the highest id
  //    (most recent insert) for each (user_id, provider, task_id) triple.
  await knex.raw(`
    DELETE l1 FROM cal_sync_ledger l1
    JOIN cal_sync_ledger l2
      ON  l1.user_id  = l2.user_id
      AND l1.provider = l2.provider
      AND l1.task_id  = l2.task_id
      AND l1.status   = 'active'
      AND l2.status   = 'active'
      AND l1.id < l2.id
  `);

  // 2. Add a virtual generated column: non-NULL only for active+non-null-task rows.
  await knex.raw(`
    ALTER TABLE cal_sync_ledger
      ADD COLUMN active_task_key VARCHAR(300)
        GENERATED ALWAYS AS (
          IF(status = 'active' AND task_id IS NOT NULL,
             CONCAT(user_id, '|', provider, '|', task_id),
             NULL)
        ) VIRTUAL
  `);

  // 3. Unique index on the generated column. NULLs are distinct so non-active
  //    rows never compete with each other or with active rows.
  await knex.raw(
    'CREATE UNIQUE INDEX uniq_csl_active_task ON cal_sync_ledger (active_task_key)'
  );
};

exports.down = async function(knex) {
  // Dropping the column also drops the index that references it.
  await knex.raw('ALTER TABLE cal_sync_ledger DROP COLUMN active_task_key');
};
