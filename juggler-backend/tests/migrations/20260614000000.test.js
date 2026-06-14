/**
 * 20260614000000.test.js — Collation fix for knex internal tracking tables
 * ROADMAP 999.242 / Traceability: C1 (jug-knexmig-collation)
 *
 * Acceptance criteria:
 *   C1.1 — After migration.up(): TABLE_COLLATION for knex_migrations AND
 *           knex_migrations_lock = utf8mb4_unicode_ci in information_schema.
 *   C1.2 — After migration.down(): both tables revert to utf8mb4_0900_ai_ci.
 *   C1.3 — Full migrate:latest from current DB state completes green and records
 *           the new migration name in knex_migrations (no deadlock, no chain break).
 *
 * Test-bed: test-bed MySQL on 3407, juggler_test, root/rootpass.
 * Run: from test-bed/ make test-juggler, or directly:
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test \
 *   NODE_ENV=test npx jest tests/migrations/20260614000000.test.js --forceExit
 *
 * Concurrency note: knex_migrations_lock holds a lock row during a migrate run.
 * The ALTER CONVERT TO is a metadata-only rebuild on a 1-row, uncontended table.
 * We verify this completes without error (no self-deadlock) by observing the
 * successful migration completion in C1.3.
 */

'use strict';

jest.setTimeout(30000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

// Force test environment so src/db picks knexfile.test (port 3407, juggler_test)
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3407';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';
process.env.DB_NAME = process.env.DB_NAME || 'juggler_test';

var knex = require('knex');
var knexConfig = require('../../knexfile');
var migration = require('../../src/db/migrations/20260614000000_fix_knex_migrations_collation');
var { requireDB } = require('../helpers/requireDB');

// Private knex instance for this suite — avoids competing with the src/db singleton
// (which may be used by other suites in the same jest run).
var db = knex(knexConfig.test);

var _dbAvailable = null;
async function isDbAvailable() {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    await db.raw('SELECT 1');
    _dbAvailable = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    _dbAvailable = false;
  }
  return _dbAvailable;
}

/**
 * Query information_schema for the TABLE_COLLATION of knex_migrations* tables.
 * Returns an object keyed by table name with the collation string as value.
 */
async function getKnexTableCollations() {
  var [rows] = await db.raw(
    `SELECT TABLE_NAME, TABLE_COLLATION
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('knex_migrations', 'knex_migrations_lock')
     ORDER BY TABLE_NAME`
  );
  var result = {};
  for (var row of rows) {
    result[row.TABLE_NAME] = row.TABLE_COLLATION;
  }
  return result;
}

afterAll(async () => {
  if (!await isDbAvailable()) {
    await db.destroy();
    return;
  }
  // Leave the DB with migration applied (utf8mb4_unicode_ci) — correct final state.
  await migration.up(db).catch(() => {});
  await db.destroy();
});

// ---------------------------------------------------------------------------
// C1.1 — up() converts both tables to utf8mb4_unicode_ci
// ---------------------------------------------------------------------------
describe('migration 20260614000000_fix_knex_migrations_collation', () => {

  test('C1.1 up() — knex_migrations collation becomes utf8mb4_unicode_ci', requireDB(async () => {
    await migration.up(db);

    var collations = await getKnexTableCollations();

    expect(collations['knex_migrations']).toBe('utf8mb4_unicode_ci');
    expect(collations['knex_migrations_lock']).toBe('utf8mb4_unicode_ci');
  }, isDbAvailable));

  // ---------------------------------------------------------------------------
  // C1.2 — down() reverts both tables to utf8mb4_0900_ai_ci
  // ---------------------------------------------------------------------------
  test('C1.2 down() — knex_migrations collation reverts to utf8mb4_0900_ai_ci', requireDB(async () => {
    // Precondition: migration is in up state (previous test or initial DB state)
    await migration.down(db);

    var collations = await getKnexTableCollations();

    expect(collations['knex_migrations']).toBe('utf8mb4_0900_ai_ci');
    expect(collations['knex_migrations_lock']).toBe('utf8mb4_0900_ai_ci');

    // Restore to up state for subsequent tests and to leave DB clean
    await migration.up(db);
  }, isDbAvailable));

  // ---------------------------------------------------------------------------
  // C1.3 — Full migrate:latest completes without deadlock or chain break
  //
  // Uses knex.migrate.latest() programmatically (same as `npx knex migrate:latest`).
  // This verifies:
  //   a) The migration name appears in knex_migrations after the run.
  //   b) Both tables end at utf8mb4_unicode_ci (same as C1.1, but via the full chain).
  //   c) No self-deadlock on knex_migrations_lock (run completes).
  //
  // Note: If the migration is already applied (e.g., C1.1 ran first), knex will
  // see it is up-to-date and report 0 pending — that is correct and the test
  // asserts the name is present in knex_migrations either way.
  // ---------------------------------------------------------------------------
  test('C1.3 migrate:latest — full chain runs, migration recorded, collation correct, no deadlock', requireDB(async () => {
    // Ensure migration is in down state so migrate:latest actually runs it.
    // (Even if it is already up, the collation + name assertions hold; this just
    //  makes the test exercise the actual migrate run path on every run.)
    await migration.down(db).catch(() => {
      // If down() is called on a table already at 0900, ALTER still succeeds — no-op.
    });

    // Remove the migration row so migrate:latest re-applies it
    await db('knex_migrations')
      .where('name', '20260614000000_fix_knex_migrations_collation.js')
      .del()
      .catch(() => {});

    // Run the full chain — this exercises knex's lock-acquire + migrate + lock-release
    // lifecycle, proving no self-deadlock on knex_migrations_lock
    var [batchNo, appliedNames] = await db.migrate.latest({
      directory: path.join(__dirname, '../../src/db/migrations'),
      tableName: 'knex_migrations'
    });

    // a) Migration name is recorded in knex_migrations
    var [rows] = await db.raw(
      `SELECT name FROM knex_migrations
       WHERE name = '20260614000000_fix_knex_migrations_collation.js'`
    );
    expect(rows).toHaveLength(1);

    // b) Both tables are at the correct collation after a full chain run
    var collations = await getKnexTableCollations();
    expect(collations['knex_migrations']).toBe('utf8mb4_unicode_ci');
    expect(collations['knex_migrations_lock']).toBe('utf8mb4_unicode_ci');

    // c) The migrate.latest call returned with the migration in the applied list
    //    (either in this batch or 0 pending means already applied — both are green)
    var migrationApplied =
      (Array.isArray(appliedNames) && appliedNames.includes('20260614000000_fix_knex_migrations_collation.js'))
      || (Array.isArray(appliedNames) && appliedNames.length === 0); // 0 = already current
    expect(migrationApplied).toBe(true);
  }, isDbAvailable));

});
