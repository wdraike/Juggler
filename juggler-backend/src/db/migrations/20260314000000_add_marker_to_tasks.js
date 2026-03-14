/**
 * Add marker column to tasks table for non-blocking calendar markers
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.boolean('marker').defaultTo(false);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('marker');
  });
};
