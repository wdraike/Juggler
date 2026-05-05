'use strict';

exports.up = async function(knex) {
  await knex.schema.createTable('scheduler_sessions', function(t) {
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
    t.string('session_id', 36).primary();
    t.string('user_id', 36).notNullable().index();
    t.string('today_key', 10).notNullable();
    t.integer('now_mins').notNullable();
    t.string('timezone', 64).notNullable();
    t.json('snapshots').notNullable();
    t.json('tasks_by_id').notNullable();
    t.json('unplaced').notNullable();
    t.json('score').notNullable();
    t.json('warnings').notNullable();
    t.json('slack_by_task_id').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at').notNullable().index('idx_scheduler_sessions_expires');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('scheduler_sessions');
};
