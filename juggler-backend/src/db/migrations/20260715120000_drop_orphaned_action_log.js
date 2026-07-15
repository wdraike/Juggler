'use strict';

/**
 * Drop orphaned action_log table.
 *
 * The entire Undo Last Action subsystem (999.681) — UndoTask, RecordAction,
 * ActionLogPort, adapters — was removed in 999.1227 (commit ae590547).
 * The action_log table is now unwritten and unread by any code, but the
 * table itself was never dropped. This migration drops it.
 *
 * Rollback recreates the table (same schema as 20260618000000_create_action_log).
 */
exports.up = async function (knex) {
  await knex.schema.dropTableIfExists('action_log');
};

exports.down = async function (knex) {
  await knex.schema.createTable('action_log', function (table) {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable();
    table.string('task_id', 36).notNullable();
    table.string('action_type', 30).notNullable()
      .comment('status_change | field_update | delete');
    table.json('before').nullable()
      .comment('JSON snapshot of affected fields before the action');
    table.json('after').nullable()
      .comment('JSON snapshot of affected fields after the action');
    table.timestamp('created_at', { useTz: false }).notNullable();
    table.index(['task_id', 'user_id'], 'idx_action_log_task_user');
  });
};