'use strict';

/**
 * Add {0,1} CHECK constraints to the boolean (TINYINT(1)) columns that the
 * boolean-columns validation suite requires but that this schema snapshot is
 * missing (999.868).
 *
 * Without a CHECK, MySQL TINYINT(1) silently accepts 2, -1, 127, etc. The suite
 * tests/migrations/20260601000000_boolean_columns_validation.test.js requires a
 * {0,1} CHECK on the following columns (and treats every OTHER boolean column as
 * a documented gap in its KNOWN_GAPS list):
 *
 *   task_masters.flex_when    → chk_task_masters_flex_when
 *   task_masters.recurring    → chk_task_masters_recurring
 *   task_masters.split        → chk_task_masters_split
 *   task_instances.unscheduled→ chk_task_instances_unscheduled
 *
 * NOTE — task_instances.date_pinned (documented gap):
 *   date_pinned was DROPPED by migration
 *   20260526000000_drop_pinned_and_rigid_columns.js. This migration's
 *   addNullableBoolCheck helper guards with knex.schema.hasColumn() before
 *   issuing the ALTER TABLE, so the absent column is silently skipped rather
 *   than crashing with ER 1054. The boolean-validation suite lists date_pinned
 *   in KNOWN_GAPS accordingly. Both up() and down() apply the same guard.
 *
 * 20260601000000_add_validation_constraints intended to add these, but they are
 * absent from the snapshot this env restores from (the same drop/add no-op
 * landmine seen with the status constraints). This migration was REPAIRED IN
 * PLACE (not as a new migration). Editing it in place is justified under the
 * juggler immutability policy (juggler/CLAUDE.md 999.733) precisely because the
 * prior version ALWAYS crashed with ER 1054 (CHECK on the dropped column
 * date_pinned) and was therefore NEVER recorded as successfully applied in any
 * environment — knex only records a migration after up() resolves without error.
 * A new repair migration would have sorted AFTER this one and never been reached.
 * There is no environment with the old version recorded, so no environment is
 * inconsistent with this in-place repair.
 *
 * All surviving columns are NULLABLE in this schema, so each CHECK permits NULL:
 *   (`col` IN (0, 1) OR `col` IS NULL)
 *
 * Idempotent: each constraint is dropped (guarded) before being (re)added.
 * Both up() and down() guard with hasColumn so absent columns are skipped.
 */

async function dropIfExists(knex, table, name) {
  try {
    await knex.raw('ALTER TABLE `' + table + '` DROP CONSTRAINT `' + name + '`');
  } catch (e) {
    /* constraint may not exist — safe to ignore */
  }
}

async function addNullableBoolCheck(knex, table, column, name) {
  if (!(await knex.schema.hasColumn(table, column))) { return; }
  await dropIfExists(knex, table, name);
  await knex.raw(
    'ALTER TABLE `' + table + '` ADD CONSTRAINT `' + name + '` ' +
    'CHECK ((`' + column + '` IN (0, 1) OR `' + column + '` IS NULL))'
  );
}

exports.up = async function up(knex) {
  await addNullableBoolCheck(knex, 'task_masters', 'flex_when', 'chk_task_masters_flex_when');
  await addNullableBoolCheck(knex, 'task_masters', 'recurring', 'chk_task_masters_recurring');
  await addNullableBoolCheck(knex, 'task_masters', 'split', 'chk_task_masters_split');
  await addNullableBoolCheck(knex, 'task_instances', 'unscheduled', 'chk_task_instances_unscheduled');
  await addNullableBoolCheck(knex, 'task_instances', 'date_pinned', 'chk_task_instances_date_pinned');
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('task_masters', 'flex_when')) {
    await dropIfExists(knex, 'task_masters', 'chk_task_masters_flex_when');
  }
  if (await knex.schema.hasColumn('task_masters', 'recurring')) {
    await dropIfExists(knex, 'task_masters', 'chk_task_masters_recurring');
  }
  if (await knex.schema.hasColumn('task_masters', 'split')) {
    await dropIfExists(knex, 'task_masters', 'chk_task_masters_split');
  }
  if (await knex.schema.hasColumn('task_instances', 'unscheduled')) {
    await dropIfExists(knex, 'task_instances', 'chk_task_instances_unscheduled');
  }
  if (await knex.schema.hasColumn('task_instances', 'date_pinned')) {
    await dropIfExists(knex, 'task_instances', 'chk_task_instances_date_pinned');
  }
};
