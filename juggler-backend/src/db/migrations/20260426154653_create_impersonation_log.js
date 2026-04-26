exports.up = async function(knex) {
  await knex.schema.createTable('impersonation_log', (table) => {
    table.increments('id').primary();
    table.string('admin_user_id', 36).notNullable().index();
    table.string('target_user_id', 36).nullable().index();
    table.string('action', 50).notNullable();
    table.string('ip_address', 45).nullable();
    table.string('user_agent', 500).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('impersonation_log');
};
