/**
 * Add OAuth tables for MCP Custom Connectors
 */

exports.up = async function(knex) {
  await knex.schema.createTable('oauth_clients', (table) => {
    table.string('client_id', 255).primary();
    table.string('client_secret', 255).notNullable();
    table.string('client_name', 255);
    table.json('redirect_uris');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('oauth_auth_codes', (table) => {
    table.string('code', 255).primary();
    table.string('user_id', 255).notNullable();
    table.string('client_id', 255).notNullable();
    table.text('redirect_uri').notNullable();
    table.string('code_challenge', 255);
    table.string('code_challenge_method', 10).defaultTo('S256');
    table.text('original_state');
    table.string('juggler_state', 255).unique();
    table.timestamp('expires_at').notNullable();
    table.boolean('used').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('oauth_auth_codes');
  await knex.schema.dropTableIfExists('oauth_clients');
};
