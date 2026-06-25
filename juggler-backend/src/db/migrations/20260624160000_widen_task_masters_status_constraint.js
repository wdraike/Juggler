'use strict';

/**
 * Widen the task_masters status CHECK constraint to allow the full status set
 * (999.865).
 *
 * David ruling: a paused / in-progress task affects ALL future occurrences, so
 * the MASTER row must be allowed to hold 'wip' and 'pause' (and the rest of the
 * lifecycle statuses). The controller already WRITES these to task_masters via
 * tasks-write.js (status is a MASTER_FIELDS entry) and the status update path
 * (PUT /api/tasks/:id/status). The fix is to WIDEN the constraint, not the
 * controller.
 *
 * Why a new migration (not editing 20260624000000_fix_stale_status_enum_constraints):
 *   That migration is recorded as applied, yet the live test-bed schema STILL
 *   shows the STALE narrow chk_task_masters_status_enum
 *   (('', 'pending', 'done', 'skip', 'cancel', 'missed') — no wip/pause/disabled/
 *   cancelled/archived/restored) and has NO chk_task_masters_status at all. Its
 *   drop-then-add evidently no-oped against the snapshot this env restores from
 *   (the classic idempotent-rename / pre-existing-snapshot landmine). Migrations
 *   are immutable once applied (juggler policy), so the correct repair is a NEW
 *   migration that drops the stale/duplicate constraints and recreates ONE
 *   authoritative constraint.
 *
 * Authoritative task_masters status set (superset of every status the product
 * writes + the historical extras already present in earlier constraints):
 *   '', wip, done, cancel, skip, pause, disabled, missed,
 *   pending, archived, restored, cancelled
 * This is a SUPERSET of the task_instances allowed set (which already permits
 * wip/pause/disabled/cancelled).
 *
 * Also repairs chk_task_instances_status, which on this snapshot is missing
 * 'cancelled' (the R55 soft-delete path writes status='cancelled' to instance
 * rows) — same intent as 20260624000000 Problem B, which likewise no-oped here.
 *
 * All DROPs are guarded (constraint may not exist on a freshly migrated schema).
 * All ADDs are drop-first (idempotent). Collation follows the schema convention
 * (utf8mb4_unicode_ci); string literals in the CHECK clause are plain ASCII.
 */

var MASTER_STATUS_VALUES =
  "'', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', " +
  "'pending', 'archived', 'restored', 'cancelled'";

// task_instances rows are also written with 'archived'/'restored' (the
// archive→restore lifecycle, TS-320/321) — keep chk_task_instances_status a
// superset that matches chk_task_instances_status_enum so neither blocks.
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
  // ── task_masters ──────────────────────────────────────────────────────────
  // Drop every known task_masters status constraint name (stale narrow enum +
  // the mirror constraint), then recreate the ONE authoritative enum constraint.
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status_enum');
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status');

  await knex.raw(
    'ALTER TABLE `task_masters` ADD CONSTRAINT `chk_task_masters_status_enum` ' +
    'CHECK ((`status` IN (' + MASTER_STATUS_VALUES + ') OR `status` IS NULL))'
  );

  // ── task_instances ────────────────────────────────────────────────────────
  // Repair chk_task_instances_status to include 'cancelled' (no-oped in
  // 20260624000000 on this snapshot).
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await knex.raw(
    'ALTER TABLE `task_instances` ADD CONSTRAINT `chk_task_instances_status` ' +
    'CHECK (`status` IN (' + INSTANCE_STATUS_VALUES + '))'
  );
};

exports.down = async function down(knex) {
  // Restore the pre-fix (stale narrow) task_masters enum and drop the mirror.
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status_enum');
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status');
  await knex.raw(
    'ALTER TABLE `task_masters` ADD CONSTRAINT `chk_task_masters_status_enum` ' +
    "CHECK ((`status` IN ('', 'pending', 'done', 'skip', 'cancel', 'missed') OR `status` IS NULL))"
  );

  // Restore chk_task_instances_status without 'cancelled'.
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await knex.raw(
    'ALTER TABLE `task_instances` ADD CONSTRAINT `chk_task_instances_status` ' +
    "CHECK (`status` IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed'))"
  );
};
