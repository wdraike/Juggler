/**
 * Drop the original_scheduled_at column. All code references have been
 * removed and values were cleared in migration 20260406000000.
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('original_scheduled_at');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.datetime('original_scheduled_at').nullable().after('scheduled_at');
  });
};
