/**
 * Add original_date and original_time columns to tasks table.
 * These track the user-intended date/time so the scheduler can reset
 * before each run and re-derive placements from scratch.
 */

exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.string('original_date', 10).nullable().after('date');
    table.string('original_time', 20).nullable().after('time');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('original_date');
    table.dropColumn('original_time');
  });
};
