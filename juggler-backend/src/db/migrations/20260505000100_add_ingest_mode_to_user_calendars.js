exports.up = async function(knex) {
  await knex.schema.alterTable('user_calendars', function(table) {
    table.string('ingest_mode', 10).notNullable().defaultTo('task').after('sync_direction');
    // 'task'     = ingest as time-blocking task (current default)
    // 'reminder' = ingest as date-pinned flexible task (no time block)
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('user_calendars', function(table) {
    table.dropColumn('ingest_mode');
  });
};
