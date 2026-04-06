exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.boolean('preferred_time').nullable().defaultTo(null)
      .comment('Recurring scheduling mode: true = Time window (anchored time ± flex), false = Time blocks, null = legacy (derive from when tag count)');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('preferred_time');
  });
};
