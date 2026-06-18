'use strict';

/**
 * Fix collation drift on tables NOT covered by 20260508000100_fix_core_tables_collation.js.
 *
 * Root cause: these tables were created without an explicit charset/collate directive.
 * MySQL 8 defaults to utf8mb4_0900_ai_ci which silently breaks joins against tables
 * with utf8mb4_unicode_ci. CONVERT TO CHARACTER SET is idempotent and safe to re-run.
 *
 * Tables covered here:
 *   - feature_events     (20260322000000) — no charset/collate
 *   - plan_usage         (20260322100000) — no charset/collate
 *   - sync_locks         (20260401200000) — no charset/collate
 *   - sync_history       (20260412000000) — no charset/collate
 *   - ai_command_log     (20260505001000) — no charset/collate
 *   - weather_cache      (20260505002000) — forecast_json column had explicit collate
 *                                           but the table-level collation was not set
 *   - oauth_clients      (20260308000000) — no charset/collate
 *   - oauth_auth_codes   (20260308000000) — no charset/collate
 *
 * Tables already correct (excluded):
 *   - users, task_masters, task_instances, projects, locations, tools, user_config,
 *     schedule_queue, task_write_queue, user_calendars, cal_sync_ledger
 *     → fixed by 20260508000100_fix_core_tables_collation.js
 *   - impersonation_log  → fixed by 20260426155031_fix_impersonation_log_collation.js
 *   - ai_usage_outbox    → inline CONVERT in 20260507000001_create_ai_usage_outbox.js
 *   - scheduler_sessions → t.charset()/t.collate() in 20260506000400
 *   - oauth_code_nonces  → inline CONVERT in 20260514000200_create_oauth_code_nonces.js
 */

const TABLES_TO_FIX = [
  'feature_events',
  'plan_usage',
  'sync_locks',
  'sync_history',
  'ai_command_log',
  'weather_cache',
  'oauth_clients',
  'oauth_auth_codes',
];

exports.up = async function(knex) {
  // Disable FK checks so we can convert tables independently without MySQL
  // complaining about cross-table collation mismatches mid-conversion.
  await knex.raw('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of TABLES_TO_FIX) {
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

exports.down = async function(_knex) {
  // No-op: converting back to 0900_ai_ci would be destructive and is not
  // reversible safely. Rollback is a no-op by design.
};
