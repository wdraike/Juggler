/**
 * Migration: Feature Events Log
 *
 * Tracks feature gate interactions for analytics.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('feature_events', (table) => {
    table.bigIncrements('id').primary();
    table.string('user_id', 36).notNullable();
    table.string('feature_key', 100).notNullable();
    table.string('event_type', 20).notNullable();
    table.string('plan_slug', 50);
    table.json('value');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['user_id', 'created_at'], 'idx_fe_user');
    table.index(['feature_key', 'event_type', 'created_at'], 'idx_fe_feature');
    table.index(['plan_slug', 'created_at'], 'idx_fe_plan');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('feature_events');
};
