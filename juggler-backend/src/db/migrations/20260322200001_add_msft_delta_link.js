/**
 * Add msft_cal_delta_link column to users table.
 * Stores Microsoft Graph's delta link for lightweight change detection.
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('users', function(table) {
    table.text('msft_cal_delta_link').nullable().after('msft_cal_token_expiry');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('users', function(table) {
    table.dropColumn('msft_cal_delta_link');
  });
};
