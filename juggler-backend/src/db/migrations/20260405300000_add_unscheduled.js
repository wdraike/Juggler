exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.boolean('unscheduled').nullable().defaultTo(null)
      .comment('Set by scheduler when task cannot be placed. Prevents overwriting scheduled_at with midnight.');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('unscheduled');
  });
};
