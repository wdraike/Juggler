exports.up = async function(knex) {
  await knex.schema.createTable('ai_usage_outbox', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).nullable();
    table.string('use_case', 100).notNullable();
    table.string('model_name', 100).notNullable();
    table.json('model_params').nullable();
    table.integer('tokens_in').notNullable();
    table.integer('tokens_out').notNullable();
    table.integer('latency_ms').notNullable();
    table.boolean('error_flag').notNullable().defaultTo(false);
    table.string('error_type', 100).nullable();
    table.string('correlation_id', 100).nullable();
    table.timestamp('occurred_at').notNullable();
    table.timestamp('queued_at').notNullable();
    table.integer('flush_attempts').notNullable().defaultTo(0);
  });
  await knex.raw("ALTER TABLE ai_usage_outbox CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  await knex.schema.table('ai_usage_outbox', (table) => {
    table.index(['flush_attempts', 'queued_at']);
  });
};
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('ai_usage_outbox');
};
