/**
 * Add users.msft_cal_email — the Microsoft account's primary email/UPN captured
 * during the MS calendar OAuth connect. Lets the Calendar Sync modal show the
 * connected Microsoft account instead of falling back to users.email (999.859).
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.string('msft_cal_email', 255).nullable().collate('utf8mb4_unicode_ci');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('users', function(table) {
    table.dropColumn('msft_cal_email');
  });
};
