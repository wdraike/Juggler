/**
 * Drop the legacy `tasks` table and its three trigger mirrors.
 *
 * This is the terminal step of the multi-session task-model refactor:
 *   - sessions 1–2: build task_masters + task_instances, backfill from tasks,
 *     install AFTER INSERT/UPDATE/DELETE triggers on tasks that mirror writes
 *     into the new tables
 *   - session 3: add tasks_v view (master/instance projected in old tasks shape)
 *   - sessions 4–13: flip every reader off tasks onto tasks_v / tasks_with_sync_v
 *   - session 14: build tasks-write.js helper
 *   - sessions 15–17: flip every writer onto the helper (helper dual-wrote
 *     to tasks + new tables during transition)
 *   - session 18: FK change to ON DELETE SET NULL so completed recurring
 *     instances survive template deletion
 *   - session 19 (this migration): remove legacy-mirror writes from app code,
 *     remove tasks write from helper, drop triggers, drop tasks
 *
 * After this migration:
 *   - No code references `tasks` except migration history
 *   - Views (tasks_v, tasks_with_sync_v) read exclusively from task_masters /
 *     task_instances (and cal_sync_ledger for event_ids)
 *   - The new two-table schema is the sole authoritative store
 */
exports.up = async function(knex) {
  // Triggers must be dropped first — they reference `tasks` and would error
  // on its DROP, but dropping triggers explicitly is cleaner.
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_insert');
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_update');
  await knex.raw('DROP TRIGGER IF EXISTS tasks_after_delete');

  await knex.schema.dropTableIfExists('tasks');
};

exports.down = async function(knex) {
  // Non-reversible: rebuilding the legacy tasks table from master/instance
  // would require re-creating the old flat shape (including deprecated
  // gcal_event_id / msft_event_id / apple_event_id columns that have moved
  // to cal_sync_ledger) and re-installing all prior triggers. Restore from
  // backup if a rollback is ever needed.
  throw new Error('Dropping `tasks` is non-reversible via migration. Restore from DB backup.');
};
