/**
 * Add composite indexes for common query patterns and drop redundant single-column indexes
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.index(['user_id', 'date'], 'idx_tasks_user_date');
    table.index(['user_id', 'status'], 'idx_tasks_user_status');
    table.dropIndex('date');
    table.dropIndex('status');
  });

  await knex.schema.alterTable('gcal_sync_ledger', function(table) {
    table.index(['user_id', 'status'], 'idx_ledger_user_status');
    table.dropIndex('status');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.dropIndex(null, 'idx_tasks_user_date');
    table.dropIndex(null, 'idx_tasks_user_status');
    table.index('date');
    table.index('status');
  });

  await knex.schema.alterTable('gcal_sync_ledger', function(table) {
    table.dropIndex(null, 'idx_ledger_user_status');
    table.index('status');
  });
};
