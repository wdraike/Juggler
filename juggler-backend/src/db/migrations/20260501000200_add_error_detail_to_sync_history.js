/**
 * Add error_detail column to sync_history.
 *
 * Stores a structured JSON object on error rows so the UI can display
 * a plain-language summary, affected task names, retryable status, and
 * user action guidance instead of a raw exception message.
 *
 * Shape: { summary, affectedTasks, provider, calendar, retryable, userAction }
 */
exports.up = async function(knex) {
  var hasCol = await knex.schema.hasColumn('sync_history', 'error_detail');
  if (!hasCol) {
    await knex.schema.alterTable('sync_history', function(table) {
      table.text('error_detail').nullable();
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('sync_history', function(table) {
    table.dropColumn('error_detail');
  });
};
