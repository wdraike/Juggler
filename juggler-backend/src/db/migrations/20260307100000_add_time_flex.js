/**
 * Add time_flex column to tasks table.
 * For flexible habits, defines the +/- range in minutes around the preferred time.
 * Default null means use global default (60 minutes).
 */

exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.integer('time_flex').nullable().defaultTo(null).after('rigid');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('time_flex');
  });
};
