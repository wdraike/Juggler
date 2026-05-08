'use strict';

/**
 * Fix collation drift on all core tables that were created before explicit
 * utf8mb4_unicode_ci was enforced in migrations (see scheduler_sessions
 * 20260506000400 for the correct pattern going forward).
 *
 * Root cause: early migrations used Knex table builders without .charset()/.collate().
 * MySQL 8 defaults to utf8mb4_0900_ai_ci which silently breaks joins with tables
 * that have the correct collation. The fix: CONVERT TO CHARACTER SET is idempotent —
 * safe to run even if the table is already on unicode_ci.
 *
 * Precedent: 20260426155031_fix_impersonation_log_collation.js did the same for
 * impersonation_log after the drift was confirmed in production.
 */

const TABLES_TO_FIX = [
  'users',
  'task_masters',
  'task_instances',
  'projects',
  'locations',
  'tools',
  'user_config',
  'schedule_queue',
  'task_write_queue',
  'user_calendars',
  'cal_sync_ledger',
];

exports.up = async function(knex) {
  // Disable FK checks so we can convert all tables independently without
  // MySQL complaining that referencing/referenced columns have incompatible collations
  // mid-conversion. All tables end up on the same collation, so FK integrity is preserved.
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of TABLES_TO_FIX) {
      // Guard: skip tables that don't exist yet (fresh DB mid-migration)
      const exists = await knex.schema.hasTable(table);
      if (!exists) continue;
      await knex.raw(
        `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    }
  } finally {
    await knex.raw('SET FOREIGN_KEY_CHECKS = 1');
  }
};

exports.down = async function(knex) {
  // Converting back to 0900_ai_ci would be destructive — no-op down migration.
  // If rollback is needed, review table usage before converting.
};
