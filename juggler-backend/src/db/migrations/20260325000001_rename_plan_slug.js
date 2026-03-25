/**
 * Migration: Rename plan_slug to planId in feature_events table
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('feature_events', (table) => {
    table.dropIndex(['plan_slug', 'created_at'], 'idx_fe_plan');
  });
  await knex.schema.alterTable('feature_events', (table) => {
    table.renameColumn('plan_slug', 'planId');
  });
  await knex.schema.alterTable('feature_events', (table) => {
    table.index(['planId', 'created_at'], 'idx_fe_plan');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('feature_events', (table) => {
    table.dropIndex(['planId', 'created_at'], 'idx_fe_plan');
  });
  await knex.schema.alterTable('feature_events', (table) => {
    table.renameColumn('planId', 'plan_slug');
  });
  await knex.schema.alterTable('feature_events', (table) => {
    table.index(['plan_slug', 'created_at'], 'idx_fe_plan');
  });
};
