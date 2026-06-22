'use strict';

/**
 * Add `unplaced_reason` + `unplaced_detail` to task_instances.
 *
 * Part of the DB-single-source-of-truth design (David, 2026-06-22): the scheduler
 * writes ALL placement state onto the instance row, and every view reads the DB —
 * there is no separate schedule_cache read model. The placed-vs-unplaced state and
 * overdue already live on the row (`unscheduled`, `overdue`); the ONE missing piece
 * was the unplaced REASON, which previously lived only in the in-memory/cache blob
 * (`_unplacedReason`/`_unplacedDetail`). Persisting it here lets the Unplaced/Issues
 * views read the reason straight from the instance.
 *
 * - unplaced_reason: a REASON_CODES enum string (e.g. 'no_slot','weather',
 *   'when_conflict','tool_conflict'), NULL when the instance is placed.
 * - unplaced_detail: a human-readable detail string, NULL when placed.
 *
 * Invariant (enforced by the scheduler write, not the schema): an instance is
 * exactly one of placed / overdue / unplaceable. unplaced_reason is non-null ONLY
 * for the unplaceable state.
 *
 * Idempotent (hasColumn guard) + reversible.
 */

exports.up = async function up(knex) {
  const hasReason = await knex.schema.hasColumn('task_instances', 'unplaced_reason');
  const hasDetail = await knex.schema.hasColumn('task_instances', 'unplaced_detail');
  if (!hasReason || !hasDetail) {
    await knex.schema.alterTable('task_instances', function (t) {
      if (!hasReason) t.string('unplaced_reason', 64).nullable().collate('utf8mb4_unicode_ci');
      if (!hasDetail) t.string('unplaced_detail', 500).nullable().collate('utf8mb4_unicode_ci');
    });
  }
};

exports.down = async function down(knex) {
  const hasReason = await knex.schema.hasColumn('task_instances', 'unplaced_reason');
  const hasDetail = await knex.schema.hasColumn('task_instances', 'unplaced_detail');
  if (hasReason || hasDetail) {
    await knex.schema.alterTable('task_instances', function (t) {
      if (hasReason) t.dropColumn('unplaced_reason');
      if (hasDetail) t.dropColumn('unplaced_detail');
    });
  }
};
