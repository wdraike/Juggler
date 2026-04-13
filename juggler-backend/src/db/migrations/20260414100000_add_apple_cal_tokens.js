/**
 * Add Apple Calendar (CalDAV) columns to users table and
 * apple_event_id to tasks table for iCloud Calendar sync.
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('users', function(table) {
    table.string('apple_cal_server_url', 500).nullable();
    table.string('apple_cal_username', 255).nullable();
    table.text('apple_cal_password').nullable();        // encrypted at rest
    table.string('apple_cal_calendar_url', 500).nullable();
    table.string('apple_cal_sync_token', 500).nullable();
    table.timestamp('apple_cal_last_synced_at').nullable();
  });

  await knex.schema.alterTable('tasks', function(table) {
    table.string('apple_event_id', 500).nullable();
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('tasks', function(table) {
    table.dropColumn('apple_event_id');
  });

  await knex.schema.alterTable('users', function(table) {
    table.dropColumn('apple_cal_server_url');
    table.dropColumn('apple_cal_username');
    table.dropColumn('apple_cal_password');
    table.dropColumn('apple_cal_calendar_url');
    table.dropColumn('apple_cal_sync_token');
    table.dropColumn('apple_cal_last_synced_at');
  });
};
