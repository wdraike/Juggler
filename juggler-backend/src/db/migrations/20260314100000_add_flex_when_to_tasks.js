/**
 * Add flex_when column to tasks table for opt-in scheduler when-relaxation
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.boolean('flex_when').defaultTo(false);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('flex_when');
  });
};
