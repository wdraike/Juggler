/**
 * Create sync_locks table for transactional per-user locking.
 * First to INSERT wins; all others are rebuffed.
 * Owner can refresh the lock periodically to extend it.
 */
exports.up = function(knex) {
  return knex.schema.createTable('sync_locks', function(table) {
    table.integer('user_id').unsigned().notNullable().primary();
    table.string('lock_token', 36).notNullable();
    table.timestamp('acquired_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('sync_locks');
};
