'use strict';

/**
 * 999.1576 — audit-column contract (spec part 5, David request 2026-07-13):
 * EVERY juggler base table carries created_at, created_by, updated_at,
 * updated_by — so a new table can never ship without audit columns and a
 * silently no-op'd hasColumn guard (the rename-migration wrong-table
 * landmine) surfaces here instead of hiding.
 *
 * DB-backed (information_schema on the migrated test DB, TEST-FR-001
 * fail-loud). Who-columns must carry utf8mb4_unicode_ci (repo convention —
 * the 0900_ai_ci default silently breaks joins).
 */

const db = require('../../src/db');

const AUDIT_COLS = ['created_at', 'created_by', 'updated_at', 'updated_by'];
// Infra tables knex owns — not application data, exempt.
const EXEMPT = ['knex_migrations', 'knex_migrations_lock'];

afterAll(async () => {
  await db.destroy();
});

test('every base table carries all four audit columns', async () => {
  const [rows] = await db.raw(
    `SELECT t.table_name AS table_name,
            SUM(c.column_name = 'created_at') AS ca,
            SUM(c.column_name = 'created_by') AS cb,
            SUM(c.column_name = 'updated_at') AS ua,
            SUM(c.column_name = 'updated_by') AS ub
     FROM information_schema.tables t
     LEFT JOIN information_schema.columns c
       ON c.table_schema = t.table_schema AND c.table_name = t.table_name
     WHERE t.table_schema = DATABASE() AND t.table_type = 'BASE TABLE'
     GROUP BY t.table_name`
  );

  const offenders = rows
    .filter((r) => !EXEMPT.includes(r.table_name))
    .filter((r) => !(Number(r.ca) && Number(r.cb) && Number(r.ua) && Number(r.ub)))
    .map(
      (r) =>
        `${r.table_name} (missing: ${[
          !Number(r.ca) && 'created_at',
          !Number(r.cb) && 'created_by',
          !Number(r.ua) && 'updated_at',
          !Number(r.ub) && 'updated_by',
        ]
          .filter(Boolean)
          .join(', ')})`
    );

  expect(offenders).toEqual([]);
});

test('who-columns carry utf8mb4_unicode_ci', async () => {
  const [rows] = await db.raw(
    `SELECT table_name, column_name, collation_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND column_name IN ('created_by', 'updated_by')
       AND table_name NOT IN (${EXEMPT.map(() => '?').join(',')})
       AND collation_name IS NOT NULL
       AND collation_name <> 'utf8mb4_unicode_ci'`,
    EXEMPT
  );
  expect(rows.map((r) => `${r.table_name}.${r.column_name}: ${r.collation_name}`)).toEqual([]);
});

// ── inc.4 tightening (20260720210000) ────────────────────────────────────────

test('who-columns are NOT NULL on every base table — zero silent NULL attribution', async () => {
  const [rows] = await db.raw(
    `SELECT c.table_name AS table_name, c.column_name AS column_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = DATABASE()
       AND t.table_type = 'BASE TABLE'
       AND c.column_name IN ('created_by', 'updated_by')
       AND c.table_name NOT IN (${EXEMPT.map(() => '?').join(',')})
       AND c.is_nullable = 'YES'`,
    EXEMPT
  );
  expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
});

test('created_at carries a CURRENT_TIMESTAMP default on every base table', async () => {
  const [rows] = await db.raw(
    `SELECT c.table_name AS table_name, c.column_default AS column_default
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = DATABASE()
       AND t.table_type = 'BASE TABLE'
       AND c.column_name = 'created_at'
       AND c.table_name NOT IN (${EXEMPT.map(() => '?').join(',')})
       AND (c.column_default IS NULL OR c.column_default NOT LIKE 'CURRENT_TIMESTAMP%')`,
    EXEMPT
  );
  expect(rows.map((r) => `${r.table_name}: ${r.column_default}`)).toEqual([]);
});

// Tables whose updated_at is deliberately APP-MANAGED (no ON UPDATE
// CURRENT_TIMESTAMP): cal-sync dirty-detection reads updated_at
// (KnexSyncStateRepository `.where('updated_at','>',since)`) and the task
// repos force-stamp it (P1) — a DB-side auto-bump on internal writes would
// corrupt modified-since semantics. Additions to this list need the same
// justification; NEW tables get ON UPDATE by default and this test enforces it.
const APP_MANAGED_UPDATED_AT = [
  'cal_history',
  'impersonation_log',
  'plan_usage',
  'projects',
  'task_instances',
  'task_masters',
  'user_calendars',
  'user_config',
  'users',
];

test('updated_at carries ON UPDATE CURRENT_TIMESTAMP outside the app-managed allowlist', async () => {
  const [rows] = await db.raw(
    `SELECT c.table_name AS table_name, c.extra AS extra
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = DATABASE()
       AND t.table_type = 'BASE TABLE'
       AND c.column_name = 'updated_at'
       AND c.table_name NOT IN (${EXEMPT.concat(APP_MANAGED_UPDATED_AT).map(() => '?').join(',')})
       AND c.extra NOT LIKE '%on update CURRENT_TIMESTAMP%'`,
    EXEMPT.concat(APP_MANAGED_UPDATED_AT)
  );
  expect(rows.map((r) => `${r.table_name}: ${r.extra}`)).toEqual([]);
});

test('no row carries a NULL who-value anywhere (backfill completeness)', async () => {
  const [tables] = await db.raw(
    `SELECT DISTINCT c.table_name AS table_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = DATABASE()
       AND t.table_type = 'BASE TABLE'
       AND c.column_name IN ('created_by', 'updated_by')
       AND c.table_name NOT IN (${EXEMPT.map(() => '?').join(',')})`,
    EXEMPT
  );
  const offenders = [];
  for (const { table_name: tbl } of tables) {
    const [[{ n }]] = await db.raw(
      'SELECT COUNT(*) AS n FROM `' + tbl + '` WHERE created_by IS NULL OR updated_by IS NULL'
    );
    if (Number(n) > 0) offenders.push(`${tbl}: ${n} rows`);
  }
  expect(offenders).toEqual([]);
});
