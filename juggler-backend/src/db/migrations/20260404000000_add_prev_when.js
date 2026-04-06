/**
 * Add prev_when column to tasks table.
 * Stores the task's scheduling mode before a drag-pin operation
 * so it can be restored on unpin.
 */
exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.string('prev_when', 255).nullable().defaultTo(null);
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('prev_when');
  });
};
