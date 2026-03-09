exports.up = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.string('day_req', 30).comment('any, weekday, weekend, or comma-separated day codes (M,W,F)').alter();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('tasks', function(table) {
    table.string('day_req', 10).comment('any, weekday, weekend, M-Su').alter();
  });
};
