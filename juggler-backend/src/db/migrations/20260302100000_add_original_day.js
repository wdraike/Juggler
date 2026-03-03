/**
 * Add original_day column to tasks table (companions original_date).
 */

exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.string('original_day', 3).nullable().after('original_date');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('original_day');
  });
};
