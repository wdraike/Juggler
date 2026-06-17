'use strict';

/**
 * Create action_log table for the Undo Last Action feature (999.681).
 *
 * Records each state-changing action (status change, field update, delete)
 * so the most recent action on a task can be reversed.
 *
 * Design decisions:
 * - One row per action per task, scoped by user_id (tenancy).
 * - `action_type` is an enum-like string: 'status_change' | 'field_update' | 'delete'.
 * - `before` and `after` are JSON columns storing the field snapshot before/after.
 * - Only the LATEST action per task is kept — every new action for a task
 *   deletes the previous one (single-undo, not a full history).
 * - `created_at` is set by the application (P1: new Date(), never fn.now()).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('action_log', function (table) {
    table.string('id', 36).primary(); // uuidv7
    table.string('user_id', 36).notNullable();
    table.string('task_id', 36).notNullable();
    table.string('action_type', 30).notNullable()
      .comment('status_change | field_update | delete');
    table.json('before').nullable()
      .comment('JSON snapshot of affected fields before the action');
    table.json('after').nullable()
      .comment('JSON snapshot of affected fields after the action');
    table.timestamp('created_at', { useTz: false }).notNullable();

    // Index for fast "find latest action for task" queries
    table.index(['task_id', 'user_id'], 'idx_action_log_task_user');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('action_log');
};