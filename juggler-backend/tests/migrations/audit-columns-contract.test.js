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
