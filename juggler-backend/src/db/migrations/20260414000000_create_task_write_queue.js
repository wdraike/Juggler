/**
 * Create task_write_queue table — durable queue for scheduling-relevant
 * field changes that arrive while the per-user lock is held.
 * Entries are coalesced and flushed when the lock releases.
 */
exports.up = async function(knex) {
  var exists = await knex.schema.hasTable('task_write_queue');
  if (!exists) {
    await knex.schema.createTable('task_write_queue', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable();
      table.string('task_id', 36).notNullable();
      table.string('operation', 10).notNullable();  // 'create', 'update', 'delete'
      table.json('fields').notNullable();            // pre-converted DB row fragment
      table.string('source', 100).notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index(['user_id', 'created_at']);
      table.foreign('user_id').references('users.id').onDelete('CASCADE');
    });
  }
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('task_write_queue');
};
