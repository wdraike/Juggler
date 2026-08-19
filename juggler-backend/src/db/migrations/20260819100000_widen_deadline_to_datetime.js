'use strict';

/**
 * 999.15816 — Widen task_masters.deadline from DATE to DATETIME.
 *
 * Ruling (David 2026-08-18): A task deadline should be able to carry a
 * specific time of day, not just a date. This preserves existing rows
 * (DATE values coerce cleanly to midnight DATETIME). The time component
 * survives round trips through taskMappers.js, and computeOverdueForRow
 * gains an intra-day threshold on the deadline branch when a non-midnight
 * time is present. Scheduler stays day-granular for now — a timed deadline
 * does NOT tighten slack computation (follow-up if needed).
 *
 * The tasks_v view selects `m.deadline AS deadline` — MySQL resolves view
 * column types at query time, so altering the underlying column type is
 * transparent to the view. No view recreation needed.
 *
 * Migration policy (juggler CLAUDE.md 999.733):
 *   - Never edit an already-applied migration. This is a NEW migration.
 *   - No view recreation needed (column name unchanged, type change is
 *     transparent to MySQL views).
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  // ALTER COLUMN from DATE to DATETIME. Existing DATE values coerce to
  // midnight DATETIME (2026-08-25 → 2026-08-25 00:00:00).
  const hasTable = await knex.schema.hasTable('task_masters');
  if (!hasTable) return;

  const hasCol = await knex.schema.hasColumn('task_masters', 'deadline');
  if (!hasCol) return;

  // Check current column type — only alter if still DATE
  const colInfo = await knex.raw(`
    SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'task_masters'
      AND COLUMN_NAME = 'deadline'
  `);
  const dataType = colInfo[0] && colInfo[0][0] && colInfo[0][0].DATA_TYPE;
  if (dataType === 'datetime') return; // idempotent — already widened

  await knex.raw('ALTER TABLE `task_masters` MODIFY COLUMN `deadline` DATETIME NULL');
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('task_masters');
  if (!hasTable) return;

  const hasCol = await knex.schema.hasColumn('task_masters', 'deadline');
  if (!hasCol) return;

  const colInfo = await knex.raw(`
    SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'task_masters'
      AND COLUMN_NAME = 'deadline'
  `);
  const dataType = colInfo[0] && colInfo[0][0] && colInfo[0][0].DATA_TYPE;
  if (dataType === 'date') return; // idempotent — already DATE

  // Revert to DATE. Time components are truncated (information loss —
  // acceptable since this is a downgrade, not a normal operation).
  await knex.raw('ALTER TABLE `task_masters` MODIFY COLUMN `deadline` DATE NULL');
};
