/**
 * Add Microsoft Calendar OAuth token columns to users table
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.text('msft_cal_access_token').nullable();
    table.text('msft_cal_refresh_token').nullable();
    table.timestamp('msft_cal_token_expiry').nullable();
    table.timestamp('msft_cal_last_synced_at').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.dropColumn('msft_cal_access_token');
    table.dropColumn('msft_cal_refresh_token');
    table.dropColumn('msft_cal_token_expiry');
    table.dropColumn('msft_cal_last_synced_at');
  });
};
