/**
 * Migration: Create plan_usage table for Juggler
 *
 * Tracks per-user feature usage for plan limit enforcement.
 * Uses atomic INSERT ON DUPLICATE KEY UPDATE for race-condition-free counting.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('plan_usage', (table) => {
    table.increments('id').primary();
    table.string('user_id', 36).notNullable();
    table.string('usage_key', 64).notNullable();
    table.timestamp('period_start').notNullable();
    table.timestamp('period_end').nullable()
      .comment('When this counter expires. NULL for count-based');
    table.integer('count').unsigned().notNullable().defaultTo(0);
    table.integer('limit_value').nullable()
      .comment('The limit at time of creation');
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['user_id', 'usage_key', 'period_start']);
    table.index(['user_id', 'usage_key']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('plan_usage');
};
