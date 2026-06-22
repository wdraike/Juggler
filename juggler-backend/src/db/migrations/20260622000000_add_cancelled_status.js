'use strict';

/**
 * Add 'cancelled' as a NON-TERMINAL status to the task_instances + task_masters
 * status CHECK constraints (R55, leg juggler-cancel-soft-delete).
 *
 * WHY non-terminal: the terminal_scheduled_at CHECK (chk_task_*_terminal_scheduled)
 * requires done/skip/cancel/missed rows to have a non-null scheduled_at. A
 * soft-cancelled instance must persist as a RECORD even when it was never placed
 * (scheduled_at NULL) — so 'cancelled' is deliberately kept OUT of TERMINAL_STATUSES
 * (task-status.js) and out of the terminal_scheduled_at gate. It only needs to be a
 * legal enum value the scheduler load-filter (status not in ''|'wip'|NULL) excludes.
 *
 * LANDMINE (why each constraint is listed explicitly): the schema carries TWO
 * overlapping status-enum CHECKs per table with DIFFERENT value sets —
 *   task_instances: chk_..._status (has 'disabled') + chk_..._status_enum (has 'archived','restored')
 *   task_masters:   chk_..._status (has 'disabled') + chk_..._status_enum (has 'disabled','pending','archived','restored')
 * A migration that recreates one with a guessed value set silently DROPS the values
 * the other set carries. So each constraint is recreated from its FULL existing value
 * set + 'cancelled' — never a uniform hardcoded list.
 *
 * Idempotent (DROP-then-ADD); reversible.
 */

// Each entry: [table, constraintName, existingValuesCSV]. 'cancelled' is appended.
const ENUM_CONSTRAINTS = [
  ['task_instances', 'chk_task_instances_status',      "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed'"],
  ['task_instances', 'chk_task_instances_status_enum', "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed', 'archived', 'restored'"],
  ['task_masters',   'chk_task_masters_status',        "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed'"],
  ['task_masters',   'chk_task_masters_status_enum',   "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'pending', 'archived', 'restored'"],
];

async function recreate(knex, table, name, valuesCsv) {
  try { await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`); }
  catch (e) { /* may not exist on a fresh/older schema — (re)create below */ }
  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (status IN (${valuesCsv}) OR status IS NULL)`);
}

exports.up = async function up(knex) {
  for (const [table, name, values] of ENUM_CONSTRAINTS) {
    await recreate(knex, table, name, `${values}, 'cancelled'`);
  }
};

exports.down = async function down(knex) {
  // Restore each constraint to its prior value set (drops 'cancelled'). Callers
  // must migrate any rows already carrying 'cancelled' before rollback.
  for (const [table, name, values] of ENUM_CONSTRAINTS) {
    await recreate(knex, table, name, values);
  }
};
