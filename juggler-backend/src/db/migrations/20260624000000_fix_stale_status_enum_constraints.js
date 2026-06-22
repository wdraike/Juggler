'use strict';

/**
 * Fix stale/incomplete status CHECK constraints (RC3, 999.816).
 *
 * Problem A — chk_task_masters_status_enum:
 *   The 20260622000000 migration added 'cancelled' to chk_task_masters_status_enum
 *   but its DROP silently no-oped, leaving the STALE pre-migration constraint that
 *   only allows ('', 'pending', 'done', 'skip', 'cancel', 'missed') — missing
 *   'wip', 'pause', 'disabled', 'cancelled', 'archived', 'restored'. This blocks
 *   any attempt to write status='pause'/'disabled'/'cancelled' to task_masters.
 *
 * Problem B — chk_task_instances_status:
 *   The parallel chk_task_instances_status constraint does NOT include 'cancelled'.
 *   The R55 soft-delete path writes status='cancelled' to task_instances rows.
 *
 * Problem C — chk_task_instances_status_enum:
 *   This constraint is missing 'disabled'. The seeds and paths that write
 *   status='disabled' to task_instances are blocked by it.
 *
 * Fix:
 *   - DROP + re-add chk_task_masters_status_enum with the full correct value set.
 *   - ADD chk_task_masters_status (parallel to chk_task_instances_status)
 *     with 'disabled' and 'pause' included — mirrors the instances constraint.
 *   - DROP + re-add chk_task_instances_status to add 'cancelled'.
 *   - DROP + re-add chk_task_instances_status_enum to add 'disabled'.
 *
 * All DROPs are guarded (try/catch) because the constraint may not exist on
 * a freshly migrated schema. All ADDs are drop-first (idempotent).
 *
 * Note: chk_task_masters_status already existed on task_masters in some envs
 * with a narrower value set; we always drop-then-recreate to ensure consistency.
 */

async function dropIfExists(knex, table, name) {
  try {
    await knex.raw(`ALTER TABLE \`${table}\` DROP CONSTRAINT \`${name}\``);
  } catch (e) {
    /* constraint may not exist — safe to ignore */
  }
}

exports.up = async function up(knex) {
  // ── task_masters ──────────────────────────────────────────────────────────

  // A: Fix the stale chk_task_masters_status_enum (was missing pause/wip/disabled/cancelled)
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status_enum');
  await knex.raw(
    `ALTER TABLE \`task_masters\` ADD CONSTRAINT \`chk_task_masters_status_enum\`
     CHECK ((\`status\` IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed',
                            'pending', 'archived', 'restored', 'cancelled')
             OR \`status\` IS NULL))`
  );

  // A2: Ensure chk_task_masters_status exists (mirrors chk_task_instances_status shape)
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status');
  await knex.raw(
    `ALTER TABLE \`task_masters\` ADD CONSTRAINT \`chk_task_masters_status\`
     CHECK (\`status\` IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'cancelled'))`
  );

  // ── task_instances ────────────────────────────────────────────────────────

  // B: Add 'cancelled' to chk_task_instances_status
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await knex.raw(
    `ALTER TABLE \`task_instances\` ADD CONSTRAINT \`chk_task_instances_status\`
     CHECK (\`status\` IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed', 'cancelled'))`
  );

  // C: Add 'disabled' to chk_task_instances_status_enum
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status_enum');
  await knex.raw(
    `ALTER TABLE \`task_instances\` ADD CONSTRAINT \`chk_task_instances_status_enum\`
     CHECK ((\`status\` IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed',
                            'archived', 'restored', 'cancelled')
             OR \`status\` IS NULL))`
  );
};

exports.down = async function down(knex) {
  // Restore pre-fix state (before 'cancelled' was added to these constraints).

  // task_masters: restore narrow (stale) chk_task_masters_status_enum
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status_enum');
  await knex.raw(
    `ALTER TABLE \`task_masters\` ADD CONSTRAINT \`chk_task_masters_status_enum\`
     CHECK ((\`status\` IN ('', 'pending', 'done', 'skip', 'cancel', 'missed') OR \`status\` IS NULL))`
  );

  // task_masters: drop chk_task_masters_status (did not exist before this migration)
  await dropIfExists(knex, 'task_masters', 'chk_task_masters_status');

  // task_instances: restore chk_task_instances_status without 'cancelled'
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status');
  await knex.raw(
    `ALTER TABLE \`task_instances\` ADD CONSTRAINT \`chk_task_instances_status\`
     CHECK (\`status\` IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'disabled', 'missed'))`
  );

  // task_instances: restore chk_task_instances_status_enum without 'disabled'
  await dropIfExists(knex, 'task_instances', 'chk_task_instances_status_enum');
  await knex.raw(
    `ALTER TABLE \`task_instances\` ADD CONSTRAINT \`chk_task_instances_status_enum\`
     CHECK ((\`status\` IN ('', 'wip', 'done', 'cancel', 'skip', 'pause', 'missed',
                            'archived', 'restored', 'cancelled')
             OR \`status\` IS NULL))`
  );
};
