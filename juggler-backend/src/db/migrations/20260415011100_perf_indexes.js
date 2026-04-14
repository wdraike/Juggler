/**
 * Add composite indexes for two hot query patterns surfaced by the
 * post-refactor performance audit:
 *
 *   1. cal_sync_ledger(provider, status, task_id) — backs the three
 *      LEFT JOINed subqueries inside `tasks_with_sync_v` (one per
 *      provider, all filter on status='active' and group by task_id).
 *
 *   2. task_masters(user_id, split) — backs the per-scheduler-run
 *      query in reconcileSplitsForUser (all split=1 masters for a user).
 */
exports.up = async function(knex) {
  // Some MySQL setups won't tolerate adding an index that already exists;
  // guard with hasIndex / try-catch to be safe across re-runs.
  var ledgerIdxExists = false;
  try {
    var idxRows = await knex.raw("SHOW INDEX FROM cal_sync_ledger WHERE Key_name = 'idx_csl_provider_status_task'");
    ledgerIdxExists = idxRows[0].length > 0;
  } catch (e) { /* table may not exist on a fresh DB; let create handle it */ }
  if (!ledgerIdxExists) {
    await knex.raw(
      'CREATE INDEX idx_csl_provider_status_task ON cal_sync_ledger (provider, status, task_id) ' +
      "COMMENT 'tasks_with_sync_v provider join'"
    );
  }

  var masterIdxExists = false;
  try {
    var idxRows2 = await knex.raw("SHOW INDEX FROM task_masters WHERE Key_name = 'idx_tm_user_split'");
    masterIdxExists = idxRows2[0].length > 0;
  } catch (e) { /* same */ }
  if (!masterIdxExists) {
    await knex.raw(
      'CREATE INDEX idx_tm_user_split ON task_masters (user_id, split) ' +
      "COMMENT 'reconcileSplitsForUser scan'"
    );
  }
};

exports.down = async function(knex) {
  await knex.raw('DROP INDEX idx_tm_user_split ON task_masters').catch(function(){});
  await knex.raw('DROP INDEX idx_csl_provider_status_task ON cal_sync_ledger').catch(function(){});
};
