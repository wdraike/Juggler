exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('direction');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.text('direction').comment('For other status');
  });
};
