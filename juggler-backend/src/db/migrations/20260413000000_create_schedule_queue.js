/**
 * Create schedule_queue table — lightweight DB-backed queue for scheduler
 * coordination. One row per mutation that needs a scheduler run.
 * The scheduler sweeps entries after a quiet period and deletes them.
 */
exports.up = async function(knex) {
  var exists = await knex.schema.hasTable('schedule_queue');
  if (!exists) {
    await knex.schema.createTable('schedule_queue', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable();
      table.string('source', 100).notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      table.index('user_id');
      table.foreign('user_id').references('users.id').onDelete('CASCADE');
    });
  }
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('schedule_queue');
};
