exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.integer('travel_before').nullable().comment('Travel buffer before task in minutes');
    table.integer('travel_after').nullable().comment('Travel buffer after task in minutes');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('travel_before');
    table.dropColumn('travel_after');
  });
};
