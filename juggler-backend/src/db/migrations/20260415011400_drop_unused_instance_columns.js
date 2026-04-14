/**
 * Drop unused task_instances.original_date / original_day / original_time
 * columns. They were carried over from the legacy `tasks` schema during the
 * refactor, but no app code reads or writes them, and no view exposes them.
 * Pure dead schema.
 */
exports.up = async function(knex) {
  var cols = ['original_date', 'original_day', 'original_time'];
  for (var i = 0; i < cols.length; i++) {
    var has = await knex.schema.hasColumn('task_instances', cols[i]);
    if (has) {
      await knex.schema.alterTable('task_instances', function(table) {
        table.dropColumn(cols[i]);
      });
    }
  }
};

exports.down = async function(knex) {
  await knex.schema.alterTable('task_instances', function(table) {
    table.string('original_date', 10).nullable();
    table.string('original_day', 3).nullable();
    table.string('original_time', 20).nullable();
  });
};
