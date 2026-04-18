/**
 * Add error_detail column to cal_sync_ledger.
 *
 * When a batch push fails for a specific task and the retry also fails,
 * the sync engine inserts a ledger record with status='error' and stores
 * the error message here. This prevents the task from being retried every
 * sync. Error records are cleared at the start of the next manual sync
 * so the user can force a fresh retry.
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.text('error_detail').nullable().after('miss_count');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('cal_sync_ledger', function(table) {
    table.dropColumn('error_detail');
  });
};
