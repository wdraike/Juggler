'use strict';

/**
 * @typedef {import('knex').Knex} Knex
 */

/**
 * Fix existing data corruption from Bug #4 and Bug #5
 *
 * Bug #4: Tasks were incorrectly deleted when MISS_THRESHOLD reached on one provider,
 * even if other providers still actively had them. Result: tasks deleted in Juggler
 * while active ledgers remain in other providers → orphaned ledgers.
 *
 * Bug #5: Concurrent syncs could create duplicate active ledger rows per
 * (user_id, task_id, provider) pair.
 *
 * @param {Knex} knex
 */
exports.up = async function(knex) {
  // ==========================================================
  // PASS 1: De-duplicate active ledger rows (Bug #5)
  // Keep only the newest active row per (user_id, task_id, provider)
  // ==========================================================
  await knex.transaction(async (trx) => {
    const duplicates = await trx('cal_sync_ledger')
      .select('user_id', 'task_id', 'provider', trx.raw('COUNT(*) as cnt'), trx.raw('MAX(id) as newest_id'))
      .where('status', 'active')
      .groupBy('user_id', 'task_id', 'provider')
      .having('cnt', '>', 1);

    for (const dup of duplicates) {
      const idsToDelete = await trx('cal_sync_ledger')
        .where({ user_id: dup.user_id, task_id: dup.task_id, provider: dup.provider, status: 'active' })
        .whereNot('id', dup.newest_id)
        .pluck('id');

      if (idsToDelete.length > 0) {
        console.log(`[BUG-5-CLEANUP] Dedup: user=${dup.user_id} task=${dup.task_id} provider=${dup.provider} — deleting ${idsToDelete.length} duplicate rows (keeping id=${dup.newest_id})`);
        await trx('cal_sync_ledger').whereIn('id', idsToDelete).del();
      }
    }
  });

  // ==========================================================
  // PASS 2: Find orphaned active ledgers (Bug #4)
  // Tasks that no longer exist in tasks_v but have active ledgers
  // These are from the multi-provider premature deletion.
  // ==========================================================
  await knex.transaction(async (trx) => {
    const orphaned = await trx('cal_sync_ledger as l')
      .leftJoin('tasks_v as t', 'l.task_id', 't.id')
      .whereNull('t.id')
      .where('l.status', 'active')
      .select('l.id as ledger_id', 'l.task_id', 'l.provider', 'l.user_id');

    if (orphaned.length > 0) {
      console.log(`[BUG-4-CLEANUP] Found ${orphaned.length} orphaned active ledgers (task no longer exists):`);
      for (const o of orphaned) {
        console.log(`  ledger=${o.ledger_id} task=${o.task_id} provider=${o.provider}`);
      }

      // Mark them deleted_remote (correct state for missing task)
      for (const o of orphaned) {
        await trx('cal_sync_ledger').where('id', o.ledger_id).update({
          status: 'deleted_remote',
          task_id: null,
          miss_count: 0,
          updated_at: trx.fn.now()
        });
      }
    }
  });

  // ==========================================================
  // PASS 3: Handle tasks that exist but have mixed ledger states
  // (active on some providers, deleted_remote on others)
  // The task survived Bug #4 (fixed code now prevents deletion).
  // But the deleted_remote ledgers are valid state — skip them.
  // ==========================================================
  await knex.transaction(async (trx) => {
    // Find tasks with at least one active AND at least one deleted_remote ledger
    // These are the survivors of Bug #4 where the code incorrectly
    // deleted the task, but user/MCP recreated it, or a future sync fixed it.
    // With the new code fix, these shouldn't happen again. We just audit.
    const mixed = await trx.raw(`
      SELECT DISTINCT a.task_id, a.user_id
      FROM cal_sync_ledger a
      INNER JOIN cal_sync_ledger d
        ON a.task_id = d.task_id AND a.provider != d.provider
      WHERE a.status = 'active'
        AND d.status = 'deleted_remote'
    `);

    if (mixed[0].length > 0) {
      console.log(`[BUG-4-CLEANUP] ${mixed[0].length} tasks have active + deleted_remote mixed providers — code fix will prevent future deletions`);
    }
  });

  console.log('[BUG-CLEANUP] Complete');
};

/**
 * @param {Knex} knex
 */
exports.down = async function(knex) {
  // Irreversible: data corruption fix
  console.warn('[BUG-CLEANUP] Down migration not supported: data corruption fix is one-way');
};
