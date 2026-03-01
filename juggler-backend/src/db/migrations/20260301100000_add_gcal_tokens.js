/**
 * Add Google Calendar OAuth token columns to users table
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.text('gcal_access_token').nullable();
    table.text('gcal_refresh_token').nullable();
    table.timestamp('gcal_token_expiry').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.dropColumn('gcal_access_token');
    table.dropColumn('gcal_refresh_token');
    table.dropColumn('gcal_token_expiry');
  });
};
