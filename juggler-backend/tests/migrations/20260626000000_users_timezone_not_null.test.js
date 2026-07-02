/**
 * 20260626000000_users_timezone_not_null.test.js
 *
 * Migration regression test — BUG-892 (999.892-tz-notnull)
 *
 * Verifies migration 20260626000000_users_timezone_not_null.js:
 *   (up)  backfills users.timezone NULLs → 'America/New_York',
 *         then ALTERs column to NOT NULL DEFAULT 'America/New_York'
 *         COLLATE utf8mb4_unicode_ci
 *   (down) reverts column to nullable
 *
 * Tests are RED before the migration file exists (assertions 1, 5, 6, 7 fail).
 * Tests are GREEN once bert's migration lands in src/db/migrations/.
 *
 * Run (isolated DB — juggler_sweep_test; test-bed 3407 must be up):
 *   export DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=rootpass \
 *          DB_NAME=juggler_sweep_test NODE_ENV=test
 *   npx jest tests/migrations/20260626000000_users_timezone_not_null.test.js \
 *          --runInBand --forceExit
 */

'use strict';

jest.setTimeout(60000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

// Force test environment; prefer env vars set by caller, fall back to test-bed defaults
process.env.NODE_ENV     = 'test';
process.env.DB_HOST      = process.env.DB_HOST     || '127.0.0.1';
process.env.DB_PORT      = process.env.DB_PORT     || '3407';
process.env.DB_USER      = process.env.DB_USER     || 'root';
process.env.DB_PASSWORD  = process.env.DB_PASSWORD || 'rootpass';
// Default to juggler_sweep_test — this leg's isolated DB; do NOT default to juggler_test
// 999.1037 fix-follow-up: unconditional (not `if (!process.env.DB_NAME)`).
// jest.config.js's setupFiles now loads .env.test (DB_NAME=juggler_test) BEFORE
// this file's own top-level code runs, so a conditional guard here is a
// permanent no-op (ernie BLOCK, 2026-07-01) and this file would silently run
// against the SHARED juggler_test schema instead of its isolated one — exactly
// the testbed-juggler-test-pollution class already hit once (2026-06-21).
// Reassert unconditionally so this file's isolation always wins.
process.env.DB_NAME      = 'juggler_sweep_test';

var knex       = require('knex');
var knexConfig = require('../../knexfile');
var { requireDB } = require('../helpers/requireDB');

var db = knex(knexConfig.test);

// -----------------------------------------------------------------------
// DB availability probe (cached — avoids repeated roundtrips)
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

var MIGRATION_NAME = '20260626000000_users_timezone_not_null.js';
var TEST_ID_PREFIX = 'tz892-';   // recognizable for targeted cleanup

// -----------------------------------------------------------------------
// Unique-id generator (avoids test-run collisions)
// -----------------------------------------------------------------------

var _counter = 0;
function uid(label) {
  return TEST_ID_PREFIX + label + '-' + Date.now().toString(36) + '-' + (++_counter);
}

// -----------------------------------------------------------------------
// Schema query helper
// -----------------------------------------------------------------------

/** Returns the INFORMATION_SCHEMA row for users.timezone in the current DB. */
async function getTimezoneColumnInfo() {
  var result = await db.raw(`
    SELECT IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'timezone'
  `);
  var rows = result[0];
  if (!rows || !rows.length) {
    throw new Error('users.timezone column not found in information_schema');
  }
  return rows[0];
}

// -----------------------------------------------------------------------
// Migration state helpers
// -----------------------------------------------------------------------

/** True when MIGRATION_NAME is recorded in knex_migrations (i.e. it has been applied). */
async function isMigrationApplied() {
  var result = await db.raw(
    'SELECT 1 FROM knex_migrations WHERE name = ? LIMIT 1',
    [MIGRATION_NAME]
  );
  return result[0].length > 0;
}

/**
 * Apply all pending migrations via migrate.latest().
 * GREEN state: applies 20260626000000_users_timezone_not_null.
 * RED state (file absent): is a silent no-op — no error thrown.
 */
async function applyMigration() {
  await db.migrate.latest();
}

/**
 * Roll back ONLY our named migration via migrate.down({ name }).
 * Throws clearly when the migration was never applied — safety guard
 * that prevents accidentally rolling back the pre-existing batch-1 schema.
 */
async function rollbackMigration() {
  var applied = await isMigrationApplied();
  if (!applied) {
    throw new Error(
      '[TEST-SAFETY] ' + MIGRATION_NAME + ' is not recorded in knex_migrations. ' +
      'Refusing rollback to protect the existing schema. ' +
      'Ensure the migration file exists in src/db/migrations/ and migrate.latest() ran.'
    );
  }
  // knex v3: migrate.down({ name }) rolls back only the named migration
  await db.migrate.down({ name: MIGRATION_NAME });
}

// -----------------------------------------------------------------------
// Row manipulation helpers
// -----------------------------------------------------------------------

/**
 * Insert a minimal users row WITHOUT specifying timezone — lets the column DEFAULT fire.
 * Required fields: id, email. created_at/updated_at have CURRENT_TIMESTAMP defaults.
 */
async function insertUserNoTimezone(id) {
  await db.raw(
    'INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
    [id, id + '@tz892.local']
  );
  return id;
}

/**
 * INSERT a users row with an EXPLICIT timezone = NULL via raw SQL.
 * Raw SQL bypasses knex/ORM type coercion that might silently omit the column.
 * This should be rejected when the column is NOT NULL; allowed when nullable.
 */
async function insertUserNullTimezone(id) {
  return db.raw(
    'INSERT INTO users (id, email, timezone, created_at, updated_at) VALUES (?, ?, NULL, NOW(), NOW())',
    [id, id + '@tz892.local']
  );
}

/**
 * INSERT a users row with an EXPLICIT non-null timezone value.
 * Used in the backfill-selectivity test (test 6b) to prove that up() does NOT
 * overwrite rows whose timezone IS NOT NULL — i.e. the WHERE timezone IS NULL
 * clause is real and cannot be silently removed (Mutation C).
 */
async function insertUserWithTimezone(id, tz) {
  await db.raw(
    'INSERT INTO users (id, email, timezone, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    [id, id + '@tz892.local', tz]
  );
}

/** Delete all rows created by this suite — keyed by the recognizable ID prefix. */
async function cleanup() {
  try {
    await db.raw('DELETE FROM users WHERE id LIKE ?', [TEST_ID_PREFIX + '%']);
  } catch (_e) {
    // Ignore — users table may not exist if the schema is in a transient state
  }
}

// -----------------------------------------------------------------------
// Global setup / teardown
// -----------------------------------------------------------------------

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanup();       // remove any rows left from a prior aborted run
  await applyMigration(); // apply the new migration (no-op if file is absent)
});

afterAll(async () => {
  if (!await isDbAvailable()) {
    await db.destroy();
    return;
  }
  await cleanup();
  // Restore DB to pre-migration state so sibling test suites are unaffected.
  // If the migration was never applied (RED state / file absent) isMigrationApplied()
  // returns false and rollbackMigration() would have been a no-op; afterAll catches any
  // error from rollbackMigration to avoid masking test failures.
  try {
    await rollbackMigration();
  } catch (_e) {
    // Migration may already be rolled back (e.g. test 6/7 ended with it down)
    // or was never applied (RED state). Either way, no action needed.
  }
  await db.destroy();
});

// ======================================================================
// 1–3. Schema assertions — executed while migration is UP (applied in beforeAll)
// ======================================================================

describe('Schema: users.timezone after migrate.latest()', () => {

  /**
   * ASSERTION 1 — IS_NULLABLE
   * Pre-migration state: IS_NULLABLE = 'YES'  → RED
   * Post-migration state: IS_NULLABLE = 'NO'  → GREEN
   */
  test('1. IS_NULLABLE = "NO" — column enforces NOT NULL', requireDB(async () => {
    var col = await getTimezoneColumnInfo();
    expect(col.IS_NULLABLE).toBe('NO');
  }, isDbAvailable));

  /**
   * ASSERTION 2 — COLUMN_DEFAULT
   * Pre-migration: default is already 'America/New_York' → GREEN (pre-existing)
   * Post-migration: migration preserves/sets default → GREEN
   * This assertion validates the migration does not clobber the default.
   */
  test('2. COLUMN_DEFAULT = "America/New_York"', requireDB(async () => {
    var col = await getTimezoneColumnInfo();
    expect(col.COLUMN_DEFAULT).toBe('America/New_York');
  }, isDbAvailable));

  /**
   * ASSERTION 3 — COLLATION_NAME
   * Pre-migration: collation is utf8mb4_unicode_ci (initial schema) → GREEN (pre-existing)
   * Post-migration: migration explicitly sets/preserves collation → GREEN
   * Validates the ALTER does not silently flip to utf8mb4_0900_ai_ci (MySQL 8 default).
   */
  test('3. COLLATION_NAME = "utf8mb4_unicode_ci"', requireDB(async () => {
    var col = await getTimezoneColumnInfo();
    expect(col.COLLATION_NAME).toBe('utf8mb4_unicode_ci');
  }, isDbAvailable));

});

// ======================================================================
// 4. DEFAULT fires when timezone is omitted from INSERT
// ======================================================================

describe('Default: INSERT without timezone column → "America/New_York"', () => {

  /**
   * ASSERTION 4 — DEFAULT fires
   * Works in both nullable and NOT NULL states (column has DEFAULT in both).
   * Validates the migration preserves the default and does not break plain inserts.
   */
  test('4. Omitting timezone on INSERT yields timezone = "America/New_York"', requireDB(async () => {
    var id = uid('dflt');
    await insertUserNoTimezone(id);
    var row = await db('users').where('id', id).first();
    expect(row.timezone).toBe('America/New_York');
    // Cleanup immediately — do not leave rows that could confuse later tests
    await db('users').where('id', id).del();
  }, isDbAvailable));

});

// ======================================================================
// 5. NOT NULL enforcement — explicit timezone=NULL must be rejected
// ======================================================================

describe('NOT NULL enforcement: INSERT timezone=NULL is rejected', () => {

  /**
   * ASSERTION 5 — NULL rejection
   * Pre-migration (nullable): NULL is accepted → assertion .rejects.toThrow() FAILS → RED
   * Post-migration (NOT NULL): NULL is rejected → PASS → GREEN
   */
  test('5. Explicit timezone=NULL INSERT throws; row is not persisted', requireDB(async () => {
    var id = uid('nullrej');
    await expect(insertUserNullTimezone(id)).rejects.toThrow();
    // Verify the row was not inserted (NOT NULL rejection is transactional)
    var row = await db('users').where('id', id).first();
    expect(row).toBeUndefined();
  }, isDbAvailable));

});

// ======================================================================
// 6. Backfill proof
//    Sequence: migrate.down() → insert NULL → migrate.up() → row is backfilled
// ======================================================================

describe('Backfill proof: pre-existing NULL rows are backfilled by migrate.up()', () => {

  /**
   * ASSERTION 6 — backfill SELECTIVITY
   * Pre-migration (file absent): isMigrationApplied() → false → throws → RED
   * Post-migration: down → NULL insert + non-NULL 'Europe/London' insert → up →
   *   NULL row backfilled to 'America/New_York' AND 'Europe/London' row is UNCHANGED.
   *
   * This pins the WHERE timezone IS NULL clause in up(). Mutation C (removing
   * .whereNull() so up() overwrites EVERY row) causes the 'Europe/London' assertion
   * to fail — the mutation is caught, not just the null→default path.
   *
   * NOTE: This test modifies the schema mid-suite. --runInBand is REQUIRED so that
   * this test does not execute concurrently with schema-assumption tests 1–5.
   */
  test('6. migrate.down() → NULL insert + Europe/London insert → migrate.up() → NULL backfilled; Europe/London unchanged',
    requireDB(async () => {

      // Safety: verify migration was applied in beforeAll before attempting rollback
      var applied = await isMigrationApplied();
      if (!applied) {
        throw new Error(
          '[BUG-892] ' + MIGRATION_NAME + ' is not applied — backfill proof cannot run. ' +
          'Ensure the migration file exists in src/db/migrations/.'
        );
      }

      var backfillId  = uid('bkfill');    // will have NULL timezone — should be backfilled
      var preservedId = uid('preserved'); // will have 'Europe/London' — must NOT be clobbered

      // (a) Roll back the migration — column becomes nullable again
      await rollbackMigration();

      // (b) Insert a row with explicit NULL timezone — must succeed while nullable
      await insertUserNullTimezone(backfillId);
      var before = await db('users').where('id', backfillId).first();
      expect(before).toBeDefined();
      expect(before.timezone).toBeNull();   // confirm it was stored as NULL

      // (c) Insert a row with a pre-configured, non-default timezone.
      //     This represents a real user who has chosen a timezone — the backfill
      //     must NOT overwrite it (WHERE timezone IS NULL selectivity).
      await insertUserWithTimezone(preservedId, 'Europe/London');
      var beforePreserved = await db('users').where('id', preservedId).first();
      expect(beforePreserved).toBeDefined();
      expect(beforePreserved.timezone).toBe('Europe/London'); // confirm stored correctly

      // (d) Re-apply the migration — up() must backfill NULL → 'America/New_York'
      //     but must NOT touch rows where timezone IS NOT NULL
      await applyMigration();

      // (e) Assert the NULL row was backfilled
      var after = await db('users').where('id', backfillId).first();
      expect(after).toBeDefined();
      expect(after.timezone).toBe('America/New_York');

      // (f) Assert the pre-configured timezone row was NOT clobbered.
      //     If up() removes WHERE timezone IS NULL (Mutation C), this row becomes
      //     'America/New_York' and this assertion fails → mutation is caught.
      var afterPreserved = await db('users').where('id', preservedId).first();
      expect(afterPreserved).toBeDefined();
      expect(afterPreserved.timezone).toBe('Europe/London'); // must remain unchanged

      // Cleanup — migration is now UP (NOT NULL) so both deletes succeed
      await db('users').where('id', backfillId).del();
      await db('users').where('id', preservedId).del();

    }, isDbAvailable));

});

// ======================================================================
// 7. Reversibility — up→down→up cycle is clean
// ======================================================================

describe('Reversibility: migrate.down() restores nullable; migrate.up() re-enforces NOT NULL', () => {

  /**
   * ASSERTION 7 — full cycle
   * Pre-migration (file absent): isMigrationApplied() → false → throws → RED
   * Post-migration: cycle completes cleanly → GREEN
   *
   * NOTE: Like test 6, this test modifies the schema mid-suite. --runInBand required.
   */
  test('7. down()→IS_NULLABLE="YES"+NULL insert succeeds; up()→IS_NULLABLE="NO"+NULL rejected',
    requireDB(async () => {

      // Safety: verify migration is applied before attempting rollback
      var applied = await isMigrationApplied();
      if (!applied) {
        throw new Error(
          '[BUG-892] ' + MIGRATION_NAME + ' is not applied — reversibility test cannot run. ' +
          'Ensure the migration file exists in src/db/migrations/.'
        );
      }

      var nullId = uid('rev-null');
      var rejId  = uid('rev-rej');

      // ---- DOWN phase ----
      await rollbackMigration();

      var downCol = await getTimezoneColumnInfo();
      expect(downCol.IS_NULLABLE).toBe('YES');   // column is nullable again

      // NULL insert must succeed while the column is nullable
      await insertUserNullTimezone(nullId);
      var nullRow = await db('users').where('id', nullId).first();
      expect(nullRow).toBeDefined();
      expect(nullRow.timezone).toBeNull();
      await db('users').where('id', nullId).del();

      // ---- UP phase ----
      await applyMigration();

      var upCol = await getTimezoneColumnInfo();
      expect(upCol.IS_NULLABLE).toBe('NO');      // NOT NULL restored

      // NULL insert must be rejected again
      await expect(insertUserNullTimezone(rejId)).rejects.toThrow();
      var rejRow = await db('users').where('id', rejId).first();
      expect(rejRow).toBeUndefined();

    }, isDbAvailable));

});
