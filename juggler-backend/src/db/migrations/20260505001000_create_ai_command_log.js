exports.up = async function(knex) {
  await knex.schema.createTable('ai_command_log', function(t) {
    t.bigIncrements('id');
    t.integer('user_id').unsigned().notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at'], 'idx_ai_command_log_user_time');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('ai_command_log');
};
