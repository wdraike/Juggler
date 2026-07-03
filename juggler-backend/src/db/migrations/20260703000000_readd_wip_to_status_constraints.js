'use strict';

/**
 * Re-add 'wip' to task status CHECK constraints.
 *
 * Migrations 20260628000000 + 20260628100000 removed 'wip' and 'missed' from
 * the constraints, but the application code (UpdateTaskStatus.VALID_STATUSES)
 * still includes 'wip'. The DB constraint must match the application's
 * accepted values — otherwise todo→wip transitions fail with
 * ER_CHECK_CONSTRAINT_VIOLATED.
 *
 * This migration re-adds 'wip' to both task_masters and task_instances
 * constraints, aligning the DB with the code.
 */

var MASTER_STATUS_VALUES =
  "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
  "'pending', 'archived', 'restored', 'cancelled'";

var INSTANCE_STATUS_VALUES =
  "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
  "'archived', 'restored', 'cancelled'";

async function dropIfExists(knex, table, name) {
  try {
    await knex.raw('ALTER TABLE `' + table + '` DROP CONSTRAINT `' + name + '`');
  } catch (e) {
    /* constraint may not exist — safe to ignore */
  }
}

exports.up = async function up(knex) {
  // task_masters
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status_enum');
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status');
  await knex.raw(
    'ALTER TABLE `task_masters` ADD CONSTRAINT `chk_task_masters_status_enum` ' +
    'CHECK ((`status` IN (' + MASTER_STATUS_VALUES + ') OR `status` IS NULL))'
  );

  // task_instances
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status_enum');
  await knex.raw(
    'ALTER TABLE `task_instances` ADD CONSTRAINT `chk_task_instances_status` ' +
    'CHECK (`status` IN (' + INSTANCE_STATUS_VALUES + '))'
  );
};

exports.down = async function down(knex) {
  // Revert to the post-removal constraints (without wip)
  var MASTER_NO_WIP =
    "'', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
    "'pending', 'archived', 'restored', 'cancelled'";

  var INSTANCE_NO_WIP =
    "'', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
    "'archived', 'restored', 'cancelled'";

  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status_enum');
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status');
  await knex.raw(
    'ALTER TABLE `task_masters` ADD CONSTRAINT `chk_task_masters_status_enum` ' +
    'CHECK ((`status` IN (' + MASTER_NO_WIP + ') OR `status` IS NULL))'
  );

  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status_enum');
  await knex.raw(
    'ALTER TABLE `task_instances` ADD CONSTRAINT `chk_task_instances_status` ' +
    'CHECK (`status` IN (' + INSTANCE_NO_WIP + '))'
  );
};