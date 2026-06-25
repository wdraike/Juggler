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
 *   task_instances.date_pinned→ chk_task_instances_date_pinned
 *
 * 20260601000000_add_validation_constraints intended to add these, but they are
 * absent from the snapshot this env restores from (the same drop/add no-op
 * landmine seen with the status constraints). Migrations are immutable once
 * applied (juggler policy), so this NEW migration adds them.
 *
 * All five columns are NULLABLE in this schema, so each CHECK permits NULL:
 *   (`col` IN (0, 1) OR `col` IS NULL)
 *
 * Idempotent: each constraint is dropped (guarded) before being (re)added.
 */

async function dropIfExists(knex, table, name) {
  try {
    await knex.raw('ALTER TABLE `' + table + '` DROP CONSTRAINT `' + name + '`');
  } catch (e) {
    /* constraint may not exist — safe to ignore */
  }
}

async function addNullableBoolCheck(knex, table, column, name) {
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
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_flex_when');
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_recurring');
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_split');
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_unscheduled');
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_date_pinned');
};
