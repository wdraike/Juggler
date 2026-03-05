/**
 * Add date_pinned column to tasks table.
 * When true, the user explicitly set the date and the scheduler should honor it.
 * When false/null, the scheduler freely controls the date.
 */

exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.boolean('date_pinned').nullable().defaultTo(false).after('original_day');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('date_pinned');
  });
};
