/**
 * Initial schema for Juggler task tracker
 */

exports.up = function(knex) {
  return knex.schema
    .createTable('users', function(table) {
      table.string('id', 36).primary();
      table.string('email', 255).notNullable().unique();
      table.string('name', 255);
      table.string('picture_url', 500);
      table.string('google_id', 255).unique();
      table.string('timezone', 100).defaultTo('America/New_York');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    })

    .createTable('tasks', function(table) {
      table.string('id', 100).primary();
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('text', 1000);
      table.string('date', 10).comment('M/D format');
      table.string('day', 3).comment('Mon, Tue, etc.');
      table.string('time', 20).comment('9:00 AM format');
      table.integer('dur').defaultTo(30);
      table.integer('time_remaining').nullable();
      table.string('pri', 5).defaultTo('P3');
      table.string('project', 255);
      table.string('status', 10).defaultTo('').comment('empty, done, wip, cancel, skip, other');
      table.text('direction').comment('For other status');
      table.string('section', 255);
      table.text('notes');
      table.string('due', 10).comment('Deadline M/D');
      table.string('start_after', 10);
      table.json('location').comment('["home","work"]');
      table.json('tools').comment('["phone"]');
      table.string('when', 255).comment('Time windows');
      table.string('day_req', 10).comment('any, weekday, weekend, M-Su');
      table.boolean('habit').defaultTo(false);
      table.boolean('rigid').defaultTo(false);
      table.boolean('split').nullable();
      table.integer('split_min').nullable();
      table.json('recur').comment('{type, days, every}');
      table.string('source_id', 100).comment('For generated instances');
      table.boolean('generated').defaultTo(false);
      table.string('gcal_event_id', 255);
      table.json('depends_on').comment('["t01","t02"]');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.index('user_id');
      table.index('date');
      table.index('status');
      table.index('project');
    })

    .createTable('projects', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('name', 255).notNullable();
      table.string('color', 50);
      table.string('icon', 50);
      table.integer('sort_order').defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.unique(['user_id', 'name']);
    })

    .createTable('locations', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('location_id', 100).notNullable();
      table.string('name', 255).notNullable();
      table.string('icon', 50);
      table.integer('sort_order').defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.unique(['user_id', 'location_id']);
    })

    .createTable('tools', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('tool_id', 100).notNullable();
      table.string('name', 255).notNullable();
      table.string('icon', 50);
      table.integer('sort_order').defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.unique(['user_id', 'tool_id']);
    })

    .createTable('user_config', function(table) {
      table.increments('id').primary();
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('config_key', 100).notNullable();
      table.json('config_value');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.unique(['user_id', 'config_key']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('user_config')
    .dropTableIfExists('tools')
    .dropTableIfExists('locations')
    .dropTableIfExists('projects')
    .dropTableIfExists('tasks')
    .dropTableIfExists('users');
};
