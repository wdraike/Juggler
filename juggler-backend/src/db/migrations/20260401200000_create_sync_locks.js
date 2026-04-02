/**
 * Create sync_locks table for transactional per-user locking.
 * First to INSERT wins; all others are rebuffed.
 * Owner can refresh the lock periodically to extend it.
 */
exports.up = async function(knex) {
  var exists = await knex.schema.hasTable('sync_locks');
  if (!exists) {
    await knex.schema.createTable('sync_locks', function(table) {
      table.string('user_id', 36).notNullable().primary();
      table.string('lock_token', 36).notNullable();
      table.timestamp('acquired_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('expires_at').notNullable();
    });
  }
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('sync_locks');
};
