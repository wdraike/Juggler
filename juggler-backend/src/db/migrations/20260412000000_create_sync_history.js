/**
 * Create sync_history table — append-only audit log of calendar sync actions.
 * One row per action per sync run. Separate from the ledger (which is current state).
 */
exports.up = async function(knex) {
  var exists = await knex.schema.hasTable('sync_history');
  if (!exists) {
    await knex.schema.createTable('sync_history', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable();
      table.string('sync_run_id', 36).notNullable();
      table.string('provider', 10).notNullable();
      table.string('action', 20).notNullable();
      table.string('task_id', 100).nullable();
      table.string('task_text', 500).nullable();
      table.string('event_id', 255).nullable();
      table.json('old_values').nullable();
      table.json('new_values').nullable();
      table.string('detail', 500).nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index(['user_id', 'created_at']);
      table.index('sync_run_id');

      table.foreign('user_id').references('users.id').onDelete('CASCADE');
    });
  }
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('sync_history');
};
