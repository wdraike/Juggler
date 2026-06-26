/**
 * 20260624170000_boolean_columns_check_constraints.test.js
 * BUG-999.868 — Regression test: ER 1054 from CHECK on dropped column
 *
 * THE BUG:
 *   Migration 20260624170000_boolean_columns_check_constraints.js calls
 *   addNullableBoolCheck(knex, 'task_instances', 'date_pinned', 'chk_task_instances_date_pinned')
 *   but column `task_instances.date_pinned` was DROPPED by an earlier migration
 *   (20260526000000_drop_pinned_and_rigid_columns.js).
 *
 *   MySQL 8 responds with ER_BAD_FIELD_ERROR (ER 1054) "Unknown column
 *   'date_pinned' in 'task_instances'", causing knex.migrate.latest() to throw
 *   and blocking the entire jest globalSetup (which calls db.migrate.latest()).
 *
 * ASSERTIONS (RED now / GREEN after fix):
 *   A1 — migrate:latest completes WITHOUT throwing.
 *   A2 — The four SURVIVING boolean-column CHECK constraints are present in
 *          information_schema after migration:
 *            chk_task_masters_flex_when
 *            chk_task_masters_recurring
 *            chk_task_masters_split
 *            chk_task_instances_unscheduled
 *   A3 — Behavioral: value 2 and -1 are REJECTED for task_masters.flex_when
 *          (non-nullable — lightest insert burden; tests 0, 1, 2, -1).
 *          NULL is ACCEPTED for the nullable task_masters.split column.
 *          NULL is ACCEPTED for the nullable task_instances.unscheduled column.
 *   A4 — `task_instances.date_pinned` column does NOT exist AND no
 *          chk_task_instances_date_pinned constraint is registered (confirming
 *          the migration correctly SKIPS the dropped column rather than crashing).
 *
 * ISOLATION:
 *   Uses a throwaway DB `juggler_868_red_test` created/dropped here via
 *   `docker exec ra-mysql-test`. The knex instance uses knexfile.test config
 *   with `connection.database` overridden. NO contact with port 3308 (dev-bed).
 *
 * Test-bed: MySQL on 127.0.0.1:3407, container ra-mysql-test, root/rootpass.
 *
 * IMPORTANT — globalSetup bypass:
 *   jest.globalSetup runs migrate:latest on whatever DB_NAME resolves to. On broken
 *   code the same ER 1054 crash would abort globalSetup before any tests ran. To
 *   prevent that, point DB_NAME at the throwaway DB (which is pre-dropped so
 *   globalSetup's SELECT 1 fails and it returns early). This test's beforeAll then
 *   creates the DB itself and runs its own isolated migrate:latest.
 *
 * Run:
 *   docker exec ra-mysql-test mysql -uroot -prootpass \
 *     -e "DROP DATABASE IF EXISTS juggler_868_red_test" 2>/dev/null
 *   DB_NAME=juggler_868_red_test DB_HOST=127.0.0.1 DB_PORT=3407 \
 *   DB_USER=root DB_PASSWORD=rootpass NODE_ENV=test \
 *   npx jest tests/migrations/20260624170000_boolean_columns_check_constraints.test.js \
 *     --forceExit --testTimeout=120000
 */

'use strict';

// Allow up to 2 minutes — migrate:latest runs the full chain (60+ migrations)
jest.setTimeout(120000);

var path = require('path');
var { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

// Force test environment — picks up test config from knexfile
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3407';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';

var THROWAWAY_DB = 'juggler_868_red_test';

var knex = require('knex');
var knexConfig = require('../../knexfile');
var { requireDB } = require('../helpers/requireDB');

// Knex instance wired to the throwaway DB, not the shared juggler_test.
// This prevents any interference with the shared test DB and lets us run
// migrate:latest from a clean slate on every test run.
var db = null;

// -----------------------------------------------------------------------
// Reachability guard — TEST-FR-001 pattern
// -----------------------------------------------------------------------
var _dbAvailable = null;
async function isDbAvailable() {
  if (_dbAvailable !== null) return _dbAvailable;
  // Probe the MySQL server (not the throwaway DB — it may not exist yet)
  var probe = knex(Object.assign({}, knexConfig.test, {
    connection: Object.assign({}, knexConfig.test.connection, {
      database: 'mysql', // system DB always exists
      port: Number(process.env.DB_PORT) || 3407,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'rootpass',
    }),
    pool: { min: 1, max: 1 }
  }));
  try {
    await probe.raw('SELECT 1');
    _dbAvailable = true;
  } catch (e) {
    console.warn('[BUG-999.868] Test DB not available:', e.message);
    _dbAvailable = false;
  } finally {
    await probe.destroy().catch(() => {});
  }
  return _dbAvailable;
}

// -----------------------------------------------------------------------
// Helpers: create / drop the throwaway DB via docker exec (bypasses sandbox
// restrictions on direct TCP to 3407 via mysql CLI inside container)
// -----------------------------------------------------------------------
function dockerMysql(sql) {
  execSync(
    'docker exec ra-mysql-test mysql -uroot -prootpass -e "' + sql.replace(/"/g, '\\"') + '"',
    { stdio: 'pipe' }
  );
}

function createThrowawayDb() {
  dockerMysql('DROP DATABASE IF EXISTS ' + THROWAWAY_DB + '; CREATE DATABASE ' + THROWAWAY_DB +
    ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
}

function dropThrowawayDb() {
  dockerMysql('DROP DATABASE IF EXISTS ' + THROWAWAY_DB + ';');
}

// -----------------------------------------------------------------------
// Suite lifecycle
// -----------------------------------------------------------------------
beforeAll(async () => {
  if (!await isDbAvailable()) return;

  // Create the throwaway DB fresh
  createThrowawayDb();

  // Wire our knex instance to the throwaway DB
  db = knex(Object.assign({}, knexConfig.test, {
    connection: Object.assign({}, knexConfig.test.connection, {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3407,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'rootpass',
      database: THROWAWAY_DB,
    }),
    pool: { min: 1, max: 3 }
  }));
});

afterAll(async () => {
  if (db) {
    await db.destroy().catch(() => {});
  }
  // Always attempt cleanup
  try { dropThrowawayDb(); } catch (_e) {}
});

// -----------------------------------------------------------------------
// A1 — migrate:latest MUST complete without throwing
// -----------------------------------------------------------------------
describe('BUG-999.868 — regression: CHECK constraint on dropped date_pinned column', () => {

  test('A1: migrate:latest completes without ER 1054 or any other error', requireDB(async () => {
    // This is the core RED assertion. On broken code, migrate:latest throws:
    //   ER_BAD_FIELD_ERROR: Unknown column 'date_pinned' in 'task_instances'
    // because 20260624170000 tries to ALTER TABLE task_instances ADD CONSTRAINT
    // ... CHECK ((`date_pinned` IN (0, 1) OR `date_pinned` IS NULL)) on a
    // column that was DROPPED by 20260526000000.
    var migrateLatest = db.migrate.latest({
      directory: path.join(__dirname, '../../src/db/migrations'),
      tableName: 'knex_migrations'
    });

    // On pre-fix code: rejects with ER_BAD_FIELD_ERROR (errno 1054)
    // On fixed code: resolves with [batchNo, appliedNames]
    await expect(migrateLatest).resolves.toBeDefined();
  }, isDbAvailable));

  // -----------------------------------------------------------------------
  // A2 — The four SURVIVING CHECK constraints must be present
  // -----------------------------------------------------------------------
  describe('A2: four surviving boolean-column CHECK constraints are registered', () => {

    async function getCheckConstraints(tableName) {
      var [rows] = await db.raw(`
        SELECT cc.CONSTRAINT_NAME
        FROM information_schema.CHECK_CONSTRAINTS cc
        JOIN information_schema.TABLE_CONSTRAINTS tc
          ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
         AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE cc.CONSTRAINT_SCHEMA = ?
          AND tc.TABLE_NAME = ?
        ORDER BY cc.CONSTRAINT_NAME
      `, [THROWAWAY_DB, tableName]);
      return rows.map(function(r) { return r.CONSTRAINT_NAME; });
    }

    test('A2a: chk_task_masters_flex_when exists on task_masters', requireDB(async () => {
      var names = await getCheckConstraints('task_masters');
      expect(names).toContain('chk_task_masters_flex_when');
    }, isDbAvailable));

    test('A2b: chk_task_masters_recurring exists on task_masters', requireDB(async () => {
      var names = await getCheckConstraints('task_masters');
      expect(names).toContain('chk_task_masters_recurring');
    }, isDbAvailable));

    test('A2c: chk_task_masters_split exists on task_masters', requireDB(async () => {
      var names = await getCheckConstraints('task_masters');
      expect(names).toContain('chk_task_masters_split');
    }, isDbAvailable));

    test('A2d: chk_task_instances_unscheduled exists on task_instances', requireDB(async () => {
      var names = await getCheckConstraints('task_instances');
      expect(names).toContain('chk_task_instances_unscheduled');
    }, isDbAvailable));
  });

  // -----------------------------------------------------------------------
  // A3 — Behavioral: CHECK enforcement on surviving columns
  // -----------------------------------------------------------------------
  describe('A3: CHECK constraints enforce {0,1} and allow NULL on surviving columns', () => {

    // We need a minimal user row to satisfy FK for task_masters inserts.
    var TEST_USER_ID = 'telly-868-user-a3';
    var CHECK_VIOLATION = /ER_CHECK_CONSTRAINT_VIOLATED|check constraint/i;

    beforeAll(requireDB(async () => {
      await db.raw(`
        INSERT IGNORE INTO users (id, email, name, timezone, created_at, updated_at)
        VALUES (?, 'telly-868@test.invalid', 'Telly 868', 'UTC', NOW(), NOW())
      `, [TEST_USER_ID]);
    }, isDbAvailable));

    afterAll(requireDB(async () => {
      // Clean up FK order: instances -> masters -> users
      await db.raw(
        'DELETE ti FROM task_instances ti JOIN task_masters tm ON ti.master_id = tm.id WHERE tm.user_id = ?',
        [TEST_USER_ID]
      ).catch(() => {});
      await db.raw('DELETE FROM task_masters WHERE user_id = ?', [TEST_USER_ID]).catch(() => {});
      await db.raw('DELETE FROM users WHERE id = ?', [TEST_USER_ID]).catch(() => {});
    }, isDbAvailable));

    // --- task_masters.flex_when (NOT NULL DEFAULT 0) ---
    // This is the lightest insert burden: flex_when and recurring are non-nullable with defaults.

    test('A3a: task_masters.flex_when accepts 0', requireDB(async () => {
      var id = 'telly-868-fw-0';
      await db.raw(`
        INSERT INTO task_masters
          (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'BUG-999.868 fw=0', '', 'P3', 0, 0, NOW(), NOW())
      `, [id, TEST_USER_ID]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.flex_when).toBe(0);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('A3b: task_masters.flex_when accepts 1', requireDB(async () => {
      var id = 'telly-868-fw-1';
      await db.raw(`
        INSERT INTO task_masters
          (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'BUG-999.868 fw=1', '', 'P3', 1, 0, NOW(), NOW())
      `, [id, TEST_USER_ID]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.flex_when).toBe(1);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('A3c: task_masters.flex_when REJECTS value 2 (CHECK_CONSTRAINT_VIOLATED)', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters
          (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES ('telly-868-fw-2', ?, 'BUG-999.868 fw=2', '', 'P3', 2, 0, NOW(), NOW())
      `, [TEST_USER_ID])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));

    test('A3d: task_masters.flex_when REJECTS value -1 (CHECK_CONSTRAINT_VIOLATED)', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters
          (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES ('telly-868-fw-neg1', ?, 'BUG-999.868 fw=-1', '', 'P3', -1, 0, NOW(), NOW())
      `, [TEST_USER_ID])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));

    // --- task_masters.split (nullable) — NULL accept ---
    test('A3e: task_masters.split (nullable) accepts NULL', requireDB(async () => {
      var id = 'telly-868-split-null';
      await db.raw(`
        INSERT INTO task_masters
          (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
        VALUES (?, ?, 'BUG-999.868 split=null', '', 'P3', 0, 0, NULL, NOW(), NOW())
      `, [id, TEST_USER_ID]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.split).toBeNull();
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    // --- task_instances.unscheduled (nullable) — NULL accept ---
    // Need a master first
    test('A3f: task_instances.unscheduled (nullable) accepts NULL', requireDB(async () => {
      var masterId = 'telly-868-mi-master';
      var instanceId = 'telly-868-unsch-null';

      await db.raw(`
        INSERT IGNORE INTO task_masters
          (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'BUG-999.868 mi master', '', 'P3', 0, 0, NOW(), NOW())
      `, [masterId, TEST_USER_ID]);

      await db.raw(`
        INSERT INTO task_instances
          (id, master_id, user_id, status, occurrence_ordinal,
           split_ordinal, split_total, unscheduled, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, NULL, NOW(), NOW())
      `, [instanceId, masterId, TEST_USER_ID]);

      var row = await db('task_instances').where('id', instanceId).first();
      expect(row.unscheduled).toBeNull();

      await db('task_instances').where('id', instanceId).del();
      await db('task_masters').where('id', masterId).del();
    }, isDbAvailable));
  });

  // -----------------------------------------------------------------------
  // A4 — date_pinned column absent + no chk_task_instances_date_pinned constraint
  // -----------------------------------------------------------------------
  describe('A4: dropped date_pinned column is absent and has no CHECK constraint', () => {

    test('A4a: task_instances.date_pinned column does NOT exist', requireDB(async () => {
      var [rows] = await db.raw(`
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = 'task_instances'
          AND COLUMN_NAME = 'date_pinned'
      `, [THROWAWAY_DB]);
      // The column must be absent — it was dropped by 20260526000000.
      // If present, the DROP migration never ran (chain is broken).
      expect(rows).toHaveLength(0);
    }, isDbAvailable));

    test('A4b: chk_task_instances_date_pinned constraint does NOT exist', requireDB(async () => {
      var [rows] = await db.raw(`
        SELECT cc.CONSTRAINT_NAME
        FROM information_schema.CHECK_CONSTRAINTS cc
        JOIN information_schema.TABLE_CONSTRAINTS tc
          ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
         AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE cc.CONSTRAINT_SCHEMA = ?
          AND tc.TABLE_NAME = 'task_instances'
          AND cc.CONSTRAINT_NAME = 'chk_task_instances_date_pinned'
      `, [THROWAWAY_DB]);
      // On pre-fix code: migrate:latest crashes before this constraint could be added (A1 fails).
      // On fixed code: the migration detects the column is absent and skips adding this constraint.
      expect(rows).toHaveLength(0);
    }, isDbAvailable));
  });
});
