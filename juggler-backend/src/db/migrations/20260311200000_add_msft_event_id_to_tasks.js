/**
 * Add msft_event_id column to tasks table for Microsoft Calendar sync
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.string('msft_event_id', 255).nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('msft_event_id');
  });
};
