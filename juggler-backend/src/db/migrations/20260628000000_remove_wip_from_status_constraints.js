'use strict';

/**
 * Remove 'wip' from the status CHECK constraints on task_masters and
 * task_instances (999.xxx — wip lifecycle removal).
 *
 * 'wip' (work-in-progress) has been removed from the task lifecycle.
 * The lifecycle is now: '' (todo) → done (or cancel/skip/pause/missed).
 *
 * This migration:
 *   1. Resets any existing rows with status='wip' to '' (pending/todo)
 *   2. Drops the existing CHECK constraints
 *   3. Recreates them without 'wip'
 *
 * down() restores the previous constraint set (with 'wip') but does NOT
 * re-wip any rows — that state was never semantically meaningful to restore.
 */

var MASTER_STATUS_VALUES =
  "'', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
  "'pending', 'archived', 'restored', 'cancelled'";

var INSTANCE_STATUS_VALUES =
  "'', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
  "'archived', 'restored', 'cancelled'";

async function dropIfExists(knex, table, name) {
  try {
    await knex.raw('ALTER TABLE `' + table + '` DROP CONSTRAINT `' + name + '`');
  } catch (e) {
    /* constraint may not exist — safe to ignore */
  }
}

exports.up = async function up(knex) {
  // Reset any existing wip rows to pending (todo).
  await knex('task_masters').where('status', 'wip').update({ status: '' });
  await knex('task_instances').where('status', 'wip').update({ status: '' });

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
  // Restore the previous constraint set (with 'wip').
  // Does NOT re-wip any rows — that state was never semantically meaningful.

  var OLD_MASTER =
    "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
    "'pending', 'archived', 'restored', 'cancelled'";

  var OLD_INSTANCE =
    "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
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
