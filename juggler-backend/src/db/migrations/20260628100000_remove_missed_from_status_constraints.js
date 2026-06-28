'use strict';

/**
 * Remove 'missed' from the status CHECK constraints on task_masters and
 * task_instances.
 *
 * The 'missed' status is dead. The cal-history cron no longer sets it (David,
 * 2026-06-24: "there should not be any auto-miss feature") — it sets overdue=1
 * instead. R50's computed-on-read overdue display subsumes the auto-missed
 * mechanism. The 403 STATUS_MISSED_SYSTEM_ONLY guard has been removed from
 * UpdateTaskStatus; 'missed' is no longer in VALID_STATUSES. The rolling-anchor
 * missed branch (+1 day nudge) is removed as dead code.
 *
 * This migration:
 *   1. Migrates any existing status='missed' rows to status='' + overdue=1
 *      (preserving the "past-due, not acted on" semantic via the overdue flag)
 *   2. Drops the existing CHECK constraints
 *   3. Recreates them without 'missed'
 *
 * down() restores the previous constraint set (with 'missed') but does NOT
 * revert any rows — the overdue flag stays set.
 */

var MASTER_STATUS_VALUES =
  "'', 'done', 'cancel', 'skip', 'pause', 'disabled', " +
  "'pending', 'archived', 'restored', 'cancelled'";

var INSTANCE_STATUS_VALUES =
  "'', 'done', 'cancel', 'skip', 'pause', 'disabled', " +
  "'archived', 'restored', 'cancelled'";

async function dropIfExists(knex, table, name) {
  try {
    await knex.raw('ALTER TABLE `' + table + '` DROP CONSTRAINT `' + name + '`');
  } catch (e) {
    /* constraint may not exist — safe to ignore */
  }
}

exports.up = async function up(knex) {
  // Migrate any existing missed rows to status='' + overdue=1.
  // The overdue flag preserves the "past-due, not acted on" semantic.
  // ponytail: task_instances has the overdue column; task_masters does not.
  await knex('task_instances').where('status', 'missed').update({
    status: '',
    overdue: 1
  });
  // task_masters: just clear the status (no overdue column on masters).
  await knex('task_masters').where('status', 'missed').update({
    status: ''
  });

  // ── task_masters ──────────────────────────────────────────────────────────
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status_enum');
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status');

  await knex.raw(
    'ALTER TABLE `task_masters` ADD CONSTRAINT `chk_task_masters_status_enum` ' +
    'CHECK ((`status` IN (' + MASTER_STATUS_VALUES + ') OR `status` IS NULL))'
  );

  // ── task_instances ────────────────────────────────────────────────────────
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status_enum');

  await knex.raw(
    'ALTER TABLE `task_instances` ADD CONSTRAINT `chk_task_instances_status` ' +
    'CHECK (`status` IN (' + INSTANCE_STATUS_VALUES + '))'
  );
};

exports.down = async function down(knex) {
  // Restore the previous constraint set (with 'missed').
  // Does NOT revert any rows — the overdue flag stays set.

  var OLD_MASTER =
    "'', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
    "'pending', 'archived', 'restored', 'cancelled'";

  var OLD_INSTANCE =
    "'', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
    "'archived', 'restored', 'cancelled'";

  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status_enum');
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status');
  await knex.raw(
    'ALTER TABLE `task_masters` ADD CONSTRAINT `chk_task_masters_status_enum` ' +
    'CHECK ((`status` IN (' + OLD_MASTER + ') OR `status` IS NULL))'
  );

  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status_enum');
  await knex.raw(
    'ALTER TABLE `task_instances` ADD CONSTRAINT `chk_task_instances_status` ' +
    'CHECK (`status` IN (' + OLD_INSTANCE + '))'
  );
};