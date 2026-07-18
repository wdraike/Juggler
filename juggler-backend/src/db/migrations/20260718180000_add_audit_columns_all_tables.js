/**
 * 999.1576 increment 1 — audit columns on every juggler table (David request
 * 2026-07-13): who+when for BOTH create and modify (created_at, created_by,
 * updated_at, updated_by).
 *
 * Gap matrix measured against the live schema 2026-07-18 (information_schema
 * sweep; hasColumn guards keep this idempotent across environments that may
 * lag — the companion contract test tests/migrations/audit-columns-contract
 * .test.js is the net that catches a silently no-op'd guard, per the
 * rename-migration wrong-table landmine).
 *
 * Honesty rules (from the item):
 *  - who-columns: existing rows backfilled with the 'unknown-backfill'
 *    sentinel — never fake attribution. Columns stay NULLABLE until the
 *    write-path increments land (inserts don't supply them yet); a final
 *    tightening migration flips them NOT NULL.
 *  - when-columns added to legacy tables: existing rows keep NULL (their true
 *    create/update time is unknown) — added with DEFAULT NULL first, then the
 *    default is changed metadata-only so ONLY new rows get CURRENT_TIMESTAMP.
 *  - updated_at gains ON UPDATE CURRENT_TIMESTAMP; the sentinel backfill
 *    explicitly re-assigns updated_at = updated_at to suppress that trigger
 *    (MySQL skips ON UPDATE when the column is explicitly assigned).
 *  - COLLATE utf8mb4_unicode_ci explicit on the who-columns (repo convention;
 *    MySQL 8's 0900_ai_ci default silently breaks joins).
 *
 * Views: tasks_v / tasks_with_sync_v have frozen explicit column lists —
 * ADD COLUMN does not change their shape, so no view patching is needed (the
 * view-column-contract test stays green; verified in the pool run).
 */

// Measured 2026-07-18. ca/ua = has created_at/updated_at, cb/ub = has who-cols.
// knex_migrations* excluded (infra). cal_history already has ca+cb+ua.
const GAPS = {
  ai_command_log: { cb: 1, ua: 1, ub: 1 },
  ai_usage_outbox: { ca: 1, cb: 1, ua: 1, ub: 1 },
  cal_history: { ub: 1 },
  cal_sync_ledger: { cb: 1, ub: 1 },
  cron_locks: { ca: 1, cb: 1, ua: 1, ub: 1 },
  feature_events: { cb: 1, ua: 1, ub: 1 },
  impersonation_log: { cb: 1, ub: 1 },
  locations: { cb: 1, ub: 1 },
  oauth_auth_codes: { cb: 1, ua: 1, ub: 1 },
  oauth_clients: { cb: 1, ua: 1, ub: 1 },
  oauth_code_nonces: { ca: 1, cb: 1, ua: 1, ub: 1 },
  plan_usage: { ca: 1, cb: 1, ub: 1 },
  projects: { cb: 1, ub: 1 },
  push_subscriptions: { cb: 1, ua: 1, ub: 1 },
  schedule_queue: { cb: 1, ua: 1, ub: 1 },
  scheduler_sessions: { cb: 1, ua: 1, ub: 1 },
  sync_history: { cb: 1, ua: 1, ub: 1 },
  sync_locks: { ca: 1, cb: 1, ua: 1, ub: 1 },
  task_instances: { cb: 1, ub: 1 },
  task_masters: { cb: 1, ub: 1 },
  task_write_queue: { cb: 1, ua: 1, ub: 1 },
  tools: { cb: 1, ub: 1 },
  user_calendars: { cb: 1, ub: 1 },
  user_config: { cb: 1, ub: 1 },
  users: { cb: 1, ub: 1 },
  weather_cache: { ca: 1, cb: 1, ua: 1, ub: 1 },
};

const WHO_COL = "varchar(64) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL";

exports.up = async function up(knex) {
  for (const [table, gap] of Object.entries(GAPS)) {
    // Guards: environment may already carry a column (or lag the matrix).
    const [ca, cb, ua, ub] = await Promise.all(
      ['created_at', 'created_by', 'updated_at', 'updated_by'].map((c) =>
        knex.schema.hasColumn(table, c)
      )
    );

    const adds = [];
    if (gap.ca && !ca) adds.push('ADD COLUMN `created_at` timestamp NULL DEFAULT NULL');
    if (gap.cb && !cb) adds.push('ADD COLUMN `created_by` ' + WHO_COL);
    if (gap.ua && !ua) adds.push('ADD COLUMN `updated_at` timestamp NULL DEFAULT NULL');
    if (gap.ub && !ub) adds.push('ADD COLUMN `updated_by` ' + WHO_COL);
    if (adds.length) {
      await knex.raw('ALTER TABLE `' + table + '` ' + adds.join(', '));
    }

    // Sentinel backfill for who-columns — honest "we don't know", never fake
    // attribution. Keyed on ROW STATE (NULL values), not column freshness, so
    // an interrupted run (ADD implicit-commits in MySQL) completes on re-run
    // instead of silently skipping (harrison WARN-1). updated_at explicitly
    // reassigned to itself so tables whose updated_at already carries
    // ON UPDATE CURRENT_TIMESTAMP don't get every row's mtime bumped.
    const hasUpdatedAtNow = gap.ua || ua || (await knex.schema.hasColumn(table, 'updated_at'));
    const suppress = hasUpdatedAtNow ? { updated_at: knex.raw('`updated_at`') } : {};
    if (gap.cb) {
      await knex(table)
        .whereNull('created_by')
        .update(Object.assign({ created_by: 'unknown-backfill' }, suppress));
    }
    if (gap.ub) {
      await knex(table)
        .whereNull('updated_by')
        .update(Object.assign({ updated_by: 'unknown-backfill' }, suppress));
    }

    // Defaults for NEW rows only — metadata-level changes after backfill, so
    // legacy rows keep their honest NULLs. Keyed on the column's ACTUAL
    // configuration from information_schema, not on whether this run added it
    // (harrison WARN-1: re-run must finish a half-configured column). MODIFY,
    // not ALTER COLUMN SET DEFAULT — MySQL only accepts CURRENT_TIMESTAMP
    // inside a full column definition; metadata-only, existing NULLs stay.
    if (gap.ca) {
      const [[caCfg]] = await knex.raw(
        "SELECT COLUMN_DEFAULT AS d FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'created_at'",
        [table]
      );
      if (caCfg && caCfg.d === null) {
        await knex.raw(
          'ALTER TABLE `' + table + '` MODIFY COLUMN `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP'
        );
      }
    }
    if (gap.ua) {
      const [[uaCfg]] = await knex.raw(
        "SELECT EXTRA AS e FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'updated_at'",
        [table]
      );
      if (uaCfg && !/on update current_timestamp/i.test(uaCfg.e || '')) {
        await knex.raw(
          'ALTER TABLE `' +
            table +
            '` MODIFY COLUMN `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        );
      }
    }
  }
};

exports.down = async function down(knex) {
  // ROLLBACK IS MATRIX-BASED, NOT PROVENANCE-BASED (harrison WARN-2, declared
  // deliberately): in an environment that already carried a matrix-flagged
  // column before this migration ran, up() left it alone but down() WILL drop
  // it. Rollback under environment drift is therefore lossy — acceptable
  // because juggler policy forbids editing applied migrations, rollback is
  // prod-guarded (migrate-guard.js), and the supported direction is forward.
  for (const [table, gap] of Object.entries(GAPS)) {
    const drops = [];
    for (const [flag, col] of [
      ['ca', 'created_at'],
      ['cb', 'created_by'],
      ['ua', 'updated_at'],
      ['ub', 'updated_by'],
    ]) {
      if (gap[flag] && (await knex.schema.hasColumn(table, col))) {
        drops.push('DROP COLUMN `' + col + '`');
      }
    }
    if (drops.length) {
      await knex.raw('ALTER TABLE `' + table + '` ' + drops.join(', '));
    }
  }
};
