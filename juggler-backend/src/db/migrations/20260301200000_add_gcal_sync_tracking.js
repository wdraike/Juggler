/**
 * Add gcal_last_synced_at to users + gcal_deleted_events table
 */
exports.up = function(knex) {
  return knex.schema
    .alterTable('users', function(table) {
      table.timestamp('gcal_last_synced_at').nullable();
    })
    .createTable('gcal_deleted_events', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('gcal_event_id', 255).notNullable();
      table.timestamp('deleted_at').defaultTo(knex.fn.now());

      table.index('user_id');
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('gcal_deleted_events')
    .alterTable('users', function(table) {
      table.dropColumn('gcal_last_synced_at');
    });
};
