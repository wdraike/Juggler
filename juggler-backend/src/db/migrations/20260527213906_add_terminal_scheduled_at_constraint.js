/**
 * juggler-cal-history Phase A — scheduled_at constraint for terminal statuses.
 *
 * Adds a CHECK constraint enforcing that terminal-status rows (done, skip, cancel, missed)
 * must have a non-null scheduled_at value. This prevents data integrity issues where
 * terminal tasks lack placement timestamps, which breaks calendar history views
 * and the sharded purge cron.
 *
 * The constraint is:
 *   (status NOT IN ('done','skip','cancel','missed') OR scheduled_at IS NOT NULL)
 *
 * Backfill: before adding the constraint, any terminal-status rows with NULL scheduled_at
 * get scheduled_at = updated_at (best available approximation), and status = '' for
 * any rows that cannot be fixed.
 *
 * See:
 *   - .planning/phases/juggler-cal-history/juggler-cal-history-A-PLAN.md (D-05)
 *   - juggler-backend/docs/TASK-STATE-MATRIX.md
 */

const { _TERMINAL_STATUSES } = require('../../lib/task-status');

async function dropCheckIfExists(knex, table, name) {
  try {
    await knex.raw('ALTER TABLE ?? DROP CHECK ??', [table, name]);
  } catch (_e) {
    // Constraint may not exist — idempotency guard
  }
}

exports.up = async function(knex) {
  // ── 1. Backfill: fix rows that would violate the constraint ─────────────────
  // Find terminal-status rows with NULL scheduled_at — these are data integrity issues.
  // Best approximation: use updated_at as the scheduled_at time. If updated_at is
  // also NULL (shouldn't happen but be defensive), clear status to keep constraint valid.

  const fixed = await knex.raw(`
    UPDATE task_instances
    SET scheduled_at = updated_at
    WHERE status IN ('done','skip','cancel','missed')
      AND scheduled_at IS NULL
      AND updated_at IS NOT NULL
  `);
  const fixedCount = fixed[0] ? fixed[0].affectedRows || fixed[0].changedRows || 0 : 0;

  // For any remaining rows with no updated_at (should be rare/impossible), clear
  // status to non-terminal to avoid constraint violation. This is a last-resort
  // fix for data integrity — the scheduler will re-place these if needed.
  const cleared = await knex.raw(`
    UPDATE task_instances
    SET status = '',
        updated_at = NOW()
    WHERE status IN ('done','skip','cancel','missed')
      AND scheduled_at IS NULL
  `);
  const clearedCount = cleared[0] ? cleared[0].affectedRows || cleared[0].changedRows || 0 : 0;

  if (fixedCount > 0) {
    console.log(`[MIGRATION] backfilled scheduled_at (${fixedCount} rows)`);
  }
  if (clearedCount > 0) {
    console.log(`[MIGRATION] cleared invalid terminal status (${clearedCount} rows)`);
  }

  // ── 2. Add CHECK constraint ─────────────────────────────────────────────────
  // Drop existing constraint if present (idempotency for re-runs)
  await dropCheckIfExists(knex, 'task_instances', 'chk_task_instances_terminal_scheduled');

  // Add constraint: if status is terminal, scheduled_at must not be NULL
  await knex.raw(`
    ALTER TABLE task_instances
      ADD CONSTRAINT chk_task_instances_terminal_scheduled
        CHECK (status NOT IN ('done','skip','cancel','missed') OR scheduled_at IS NOT NULL)
  `);

  console.log('[MIGRATION] added chk_task_instances_terminal_scheduled constraint');
};

exports.down = async function(knex) {
  // Drop the constraint
  await dropCheckIfExists(knex, 'task_instances', 'chk_task_instances_terminal_scheduled');
  // Note: backfill changes are not reversible — we cannot restore original NULL
  // scheduled_at values. This is intentional; terminal tasks without placement
  // timestamps are invalid data per the Phase A design.
};
