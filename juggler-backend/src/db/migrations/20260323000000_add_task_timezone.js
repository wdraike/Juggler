/**
 * Add timezone column to tasks table.
 * Stores the IANA timezone the task was created/last edited in.
 * Used so the frontend can display the task in its original timezone.
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.string('tz', 100).nullable().after('scheduled_at');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('tz');
  });
};
