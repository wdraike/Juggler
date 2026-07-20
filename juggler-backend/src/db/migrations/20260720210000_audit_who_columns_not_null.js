/**
 * 999.1576 inc.4 — the tightening migration: every base table's who-columns
 * (created_by / updated_by) flip to NOT NULL.
 *
 * Preconditions shipped before this runs (same increment):
 *  - strict stampInsert/stampUpdate (getActor — no silent NULLs at any stamped
 *    write path), strict enqueueWrite carrier, and the residual unstamped
 *    insert sites stamped (sync_locks, cron_locks, plan_usage, oauth_code_nonces,
 *    scheduler_sessions, ai_usage_outbox, ai_command_log, push_subscriptions,
 *    weather_cache, user_calendars discovery, config-import bulk inserts,
 *    impersonation_log).
 *
 * Honesty rules (unchanged from inc.1, 20260718180000):
 *  - residual NULL who-values are backfilled with the 'unknown-backfill'
 *    sentinel first — honest "we don't know", never fake attribution. Keyed on
 *    ROW STATE so an interrupted run (MODIFY implicit-commits) completes on
 *    re-run.
 *  - the backfill explicitly reassigns updated_at = updated_at so tables whose
 *    updated_at carries ON UPDATE CURRENT_TIMESTAMP don't get every row's
 *    mtime bumped.
 *  - when-columns are NOT flipped NOT NULL — legacy rows keep their honest
 *    NULL create/update times (inc.1 decision).
 *  - timestamps: created_at gains DEFAULT CURRENT_TIMESTAMP where a table
 *    still lacks it (push_subscriptions), metadata-only. updated_at ON UPDATE
 *    is deliberately NOT normalized — task_masters/task_instances and friends
 *    manage updated_at at the APP level (cal-sync dirty-detection reads it:
 *    KnexSyncStateRepository `.where('updated_at','>',since)`); auto-bump
 *    would corrupt modified-since semantics. The contract test pins the
 *    app-managed allowlist instead.
 *  - who-column definition is restated from information_schema COLUMN_TYPE
 *    (never assumed varchar(64)) so a pre-existing wider column is not
 *    silently truncated; collation is normalized to utf8mb4_unicode_ci in the
 *    same MODIFY (repo convention — 0900_ai_ci silently breaks joins).
 *
 * Rollback: down() reverts nullability (NULL DEFAULT NULL) — DECLARED LOSSY:
 * sentinel backfills are indistinguishable from organic values and stay.
 */

'use strict';

const SENTINEL = 'unknown-backfill';

async function whoColumns(knex) {
  const [rows] = await knex.raw(
    `SELECT c.table_name AS tbl, c.column_name AS col, c.column_type AS coltype,
            c.is_nullable AS nullable, c.collation_name AS coll
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = DATABASE()
       AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT LIKE 'knex_migrations%'
       AND c.column_name IN ('created_by', 'updated_by')
     ORDER BY c.table_name, c.column_name`
  );
  return rows;
}

exports.up = async function up(knex) {
  const cols = await whoColumns(knex);

  // Group by table for the backfill's updated_at suppression probe.
  const byTable = {};
  for (const r of cols) {
    (byTable[r.tbl] = byTable[r.tbl] || []).push(r);
  }

  for (const [table, tableCols] of Object.entries(byTable)) {
    const hasUpdatedAt = await knex.schema.hasColumn(table, 'updated_at');
    const suppress = hasUpdatedAt ? { updated_at: knex.raw('`updated_at`') } : {};

    for (const c of tableCols) {
      // 1. Sentinel backfill — keyed on row state (re-run safe).
      await knex(table)
        .whereNull(c.col)
        .update(Object.assign({ [c.col]: SENTINEL }, suppress));

      // 2. NOT NULL + collation, restating the ACTUAL column type. Skip when
      //    already tight (idempotent across environments that may lead).
      if (c.nullable === 'YES' || c.coll !== 'utf8mb4_unicode_ci') {
        await knex.raw(
          'ALTER TABLE `' + table + '` MODIFY COLUMN `' + c.col + '` ' +
          c.coltype + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL'
        );
      }
    }
  }

  // 3. created_at DEFAULT CURRENT_TIMESTAMP where still absent
  //    (push_subscriptions as of 2026-07-20; info-schema-keyed, metadata-only,
  //    existing NULLs stay). Fractional-precision-aware.
  const [caRows] = await knex.raw(
    `SELECT c.table_name AS tbl, c.column_type AS coltype, c.is_nullable AS nullable
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = DATABASE()
       AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT LIKE 'knex_migrations%'
       AND c.column_name = 'created_at'
       AND c.column_default IS NULL`
  );
  for (const r of caRows) {
    const m = /\((\d+)\)/.exec(r.coltype);
    const cur = m ? `CURRENT_TIMESTAMP(${m[1]})` : 'CURRENT_TIMESTAMP';
    // Restate the ACTUAL nullability (harrison INFO-4) — this migration only
    // adds the default, never loosens a NOT NULL created_at to nullable.
    const nullability = r.nullable === 'NO' ? 'NOT NULL' : 'NULL';
    await knex.raw(
      'ALTER TABLE `' + r.tbl + '` MODIFY COLUMN `created_at` ' + r.coltype +
      ' ' + nullability + ' DEFAULT ' + cur
    );
  }
};

exports.down = async function down(knex) {
  // LOSSY: sentinel backfills stay; only nullability reverts.
  const cols = await whoColumns(knex);
  for (const c of cols) {
    if (c.nullable === 'NO') {
      await knex.raw(
        'ALTER TABLE `' + c.tbl + '` MODIFY COLUMN `' + c.col + '` ' +
        c.coltype + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL'
      );
    }
  }
};
