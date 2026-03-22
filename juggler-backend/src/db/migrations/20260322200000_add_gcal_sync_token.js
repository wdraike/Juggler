/**
 * Add gcal_sync_token column to users table.
 * Stores Google Calendar's incremental sync token so we can cheaply
 * detect whether any events have changed since the last sync.
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('users', function(table) {
    table.text('gcal_sync_token').nullable().after('gcal_token_expiry');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('users', function(table) {
    table.dropColumn('gcal_sync_token');
  });
};
