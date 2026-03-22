/**
 * Migration: Enhance feature_events for longitudinal analysis
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('feature_events', (table) => {
    table.string('plan_id', 36);
    table.string('endpoint', 255);
    table.string('ip_address', 45);
    table.string('request_id', 36);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('feature_events', (table) => {
    table.dropColumn('plan_id');
    table.dropColumn('endpoint');
    table.dropColumn('ip_address');
    table.dropColumn('request_id');
  });
};
