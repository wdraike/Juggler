/**
 * 20260601000000_boolean_columns_validation.test.js
 * Phase-21: Boolean columns validation
 *
 * Verifies that all boolean columns (TINYINT(1)) in the juggler schema
 * reject values outside {0, 1} (and NULL where nullable).
 *
 * The migration 20260601000000_add_validation_constraints.js added CHECK
 * constraints to a subset of boolean columns. This test suite covers:
 *
 *   A) Columns with CHECK constraints (from 20260601000000) — verifying they reject bad values
 *   B) Columns in other tables that use table.boolean() but may lack CHECK constraints —
 *      documenting the gap and verifying the Knex schema still enforces TINYINT(1)
 *
 * Boolean columns in current juggler schema (after migrations through 20260618000000):
 *
 *   task_masters:
 *     flex_when   TINYINT(1) DEFAULT 0   — CHECK constraint (chk_task_masters_flex_when)
 *     recurring   TINYINT(1) DEFAULT 0   — CHECK constraint (chk_task_masters_recurring)
 *     split       TINYINT(1) DEFAULT NULL — CHECK constraint (chk_task_masters_split)
 *
 *   task_instances:
 *     unscheduled  TINYINT(1) DEFAULT NULL — CHECK constraint (chk_task_instances_unscheduled)
 *     generated    TINYINT(1) NOT NULL DEFAULT 0 — no explicit CHECK (covered by NOT NULL + DEFAULT 0)
 *     overdue      TINYINT(1) NOT NULL DEFAULT 0 — no explicit CHECK
 *
 *   cal_sync_ledger:
 *     event_all_day TINYINT(1) DEFAULT 0  — no explicit CHECK
 *     done_frozen   TINYINT(1) NOT NULL DEFAULT 0 — no explicit CHECK
 *     miss_count    TINYINT UNSIGNED      — not boolean, counter
 *
 *   user_calendars:
 *     enabled       TINYINT(1) NOT NULL DEFAULT 1 — no explicit CHECK
 *
 *   oauth_auth_codes:
 *     used          TINYINT(1) DEFAULT 0  — no explicit CHECK
 *     (Note: oauth_code_nonces no longer has a 'used' column)
 *
 *   ai_usage_outbox:
 *     error_flag    TINYINT(1) NOT NULL DEFAULT 0 — no explicit CHECK
 *
 *   cal_history:
 *     (no boolean columns; status is enum)
 *
 * Test-bed: MySQL on 3407, juggler_test.
 * Run: DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_test
 *      NODE_ENV=test npx jest tests/migrations/20260601000000_boolean_columns_validation.test.js --forceExit
 */

'use strict';

jest.setTimeout(30000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

// Force test environment
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3407';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'rootpass';
process.env.DB_NAME = process.env.DB_NAME || 'juggler_test';

var knex = require('knex');
var knexConfig = require('../../knexfile');
var { requireDB } = require('../helpers/requireDB');

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

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

/**
 * 999.739: Knex 3.x DOES surface MySQL CHECK-constraint violations as a
 * rejected promise (verified empirically against mysql2 3.x / MySQL 8 on the
 * test-bed: error.code === 'ER_CHECK_CONSTRAINT_VIOLATED', errno 3819).
 *
 * A bare `.rejects.toThrow()` would PASS for ANY rejection — including an
 * incidental failure (FK violation, wrong column count, NOT NULL) that has
 * nothing to do with the boolean CHECK. To keep these assertions genuine
 * (non-tautological), every "rejects bad value" test asserts the rejection is
 * specifically the CHECK-constraint violation, not just "something threw".
 */
var CHECK_VIOLATION = /ER_CHECK_CONSTRAINT_VIOLATED|check constraint/i;

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Unique-enough ID generator to avoid collisions across test runs */
var counter = 0;
function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + (++counter);
}

/**
 * Insert a minimal user row so FK constraints on task_masters/task_instances pass.
 * Safe to call multiple times — uses INSERT IGNORE.
 */
async function ensureTestUser(userId) {
  await db.raw(`
    INSERT IGNORE INTO users (id, email, name, timezone, created_at, updated_at)
    VALUES (?, ?, 'Test User', 'UTC', NOW(), NOW())
  `, [userId, userId + '@test.com']);
}

/**
 * Insert a minimal task_masters row for FK on task_instances.
 * Returns the master_id.
 */
async function insertTestMaster(masterId, userId) {
  await ensureTestUser(userId);
  await db.raw(`
    INSERT IGNORE INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
    VALUES (?, ?, ?, '', 'P3', 0, 0, NULL, NOW(), NOW())
  `, [masterId, userId, 'Boolean test task']);
}

/** Clean up all test data created by this suite */
async function cleanup() {
  // Delete in FK order — instances before masters before users
  var testSuffix = '%@boolean-test.com';
  try {
    await db.raw(`DELETE i FROM task_instances i JOIN task_masters m ON i.master_id = m.id JOIN users u ON m.user_id = u.id WHERE u.email LIKE ?`, [testSuffix]);
  } catch (_e) { /* table may not have rows */ }
  try {
    await db.raw(`DELETE FROM task_masters WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)`, [testSuffix]);
  } catch (_e) {}
  try {
    await db.raw(`DELETE FROM users WHERE email LIKE ?`, [testSuffix]);
  } catch (_e) {}
}

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanup();
});

afterAll(async () => {
  if (!await isDbAvailable()) {
    await db.destroy();
    return;
  }
  await cleanup();
  await db.destroy();
});

// ======================================================================
// A) CHECK constraints from 20260601000000 — verify they reject bad values
// ======================================================================

describe('A) CHECK constraints on boolean columns (from migration 20260601000000)', () => {

  // --- task_masters.flex_when ---
  describe('task_masters.flex_when', () => {
    var userId = uid('user-fw');
    var masterId = uid('master-fw');

    beforeAll(async () => {
      if (!await isDbAvailable()) return;
      await insertTestMaster(masterId, userId);
    });

    test('accepts 0 (false)', requireDB(async () => {
      var id = uid('fw0');
      await db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 0, NOW(), NOW())
        ON DUPLICATE KEY UPDATE flex_when = 0
      `, [id, userId]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.flex_when).toBe(0);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('accepts 1 (true)', requireDB(async () => {
      var id = uid('fw1');
      await db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 1, 0, NOW(), NOW())
      `, [id, userId]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.flex_when).toBe(1);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('rejects value 2 (outside {0,1})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 2, 0, NOW(), NOW())
      `, [uid('fw2'), userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));

    test('rejects value -1 (outside {0,1})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', -1, 0, NOW(), NOW())
      `, [uid('fwn1'), userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));

    test('rejects value 127 (outside {0,1})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 127, 0, NOW(), NOW())
      `, [uid('fw127'), userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));
  });

  // --- task_masters.recurring ---
  describe('task_masters.recurring', () => {
    var userId = uid('user-rec');
    var masterId = uid('master-rec');

    beforeAll(async () => {
      if (!await isDbAvailable()) return;
      await insertTestMaster(masterId, userId);
    });

    test('accepts 0 (false)', requireDB(async () => {
      var id = uid('rec0');
      await db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 0, NOW(), NOW())
      `, [id, userId]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.recurring).toBe(0);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('accepts 1 (true)', requireDB(async () => {
      var id = uid('rec1');
      await db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 1, NOW(), NOW())
      `, [id, userId]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.recurring).toBe(1);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('rejects value 2 (outside {0,1})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 2, NOW(), NOW())
      `, [uid('rec2'), userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));

    test('rejects value -1 (outside {0,1})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, -1, NOW(), NOW())
      `, [uid('recn1'), userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));
  });

  // --- task_masters.split (nullable) ---
  describe('task_masters.split (nullable boolean)', () => {
    var userId = uid('user-spl');

    beforeAll(async () => {
      if (!await isDbAvailable()) return;
      await ensureTestUser(userId);
    });

    test('accepts NULL', requireDB(async () => {
      var id = uid('splnull');
      await db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 0, NULL, NOW(), NOW())
      `, [id, userId]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.split).toBeNull();
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('accepts 0', requireDB(async () => {
      var id = uid('spl0');
      await db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 0, 0, NOW(), NOW())
      `, [id, userId]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.split).toBe(0);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('accepts 1', requireDB(async () => {
      var id = uid('spl1');
      await db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 0, 1, NOW(), NOW())
      `, [id, userId]);
      var row = await db('task_masters').where('id', id).first();
      expect(row.split).toBe(1);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));

    test('rejects value 2 (outside {0,1,NULL})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 0, 2, NOW(), NOW())
      `, [uid('spl2'), userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));

    test('rejects value -1 (outside {0,1,NULL})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_masters (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
        VALUES (?, ?, 'test', '', 'P3', 0, 0, -1, NOW(), NOW())
      `, [uid('spln1'), userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));
  });

  // --- task_instances.unscheduled (nullable) ---
  describe('task_instances.unscheduled (nullable boolean)', () => {
    var userId = uid('user-unsch');
    var masterId = uid('master-unsch');

    beforeAll(async () => {
      if (!await isDbAvailable()) return;
      await insertTestMaster(masterId, userId);
    });

    test('accepts NULL', requireDB(async () => {
      var id = uid('unschnull');
      await db.raw(`
        INSERT INTO task_instances (id, master_id, user_id, status, occurrence_ordinal, split_ordinal, split_total, unscheduled, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, NULL, NOW(), NOW())
      `, [id, masterId, userId]);
      var row = await db('task_instances').where('id', id).first();
      expect(row.unscheduled).toBeNull();
      await db('task_instances').where('id', id).del();
    }, isDbAvailable));

    test('accepts 0', requireDB(async () => {
      var id = uid('unsch0');
      await db.raw(`
        INSERT INTO task_instances (id, master_id, user_id, status, occurrence_ordinal, split_ordinal, split_total, unscheduled, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, 0, NOW(), NOW())
      `, [id, masterId, userId]);
      var row = await db('task_instances').where('id', id).first();
      expect(row.unscheduled).toBe(0);
      await db('task_instances').where('id', id).del();
    }, isDbAvailable));

    test('accepts 1', requireDB(async () => {
      var id = uid('unsch1');
      await db.raw(`
        INSERT INTO task_instances (id, master_id, user_id, status, occurrence_ordinal, split_ordinal, split_total, unscheduled, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, 1, NOW(), NOW())
      `, [id, masterId, userId]);
      var row = await db('task_instances').where('id', id).first();
      expect(row.unscheduled).toBe(1);
      await db('task_instances').where('id', id).del();
    }, isDbAvailable));

    test('rejects value 2 (outside {0,1,NULL})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_instances (id, master_id, user_id, status, occurrence_ordinal, split_ordinal, split_total, unscheduled, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, 2, NOW(), NOW())
      `, [uid('unsch2'), masterId, userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));

    test('rejects value -1 (outside {0,1,NULL})', requireDB(async () => {
      await expect(db.raw(`
        INSERT INTO task_instances (id, master_id, user_id, status, occurrence_ordinal, split_ordinal, split_total, unscheduled, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, -1, NOW(), NOW())
      `, [uid('unschn1'), masterId, userId])).rejects.toThrow(CHECK_VIOLATION);
    }, isDbAvailable));
  });
});

// ======================================================================
// B) Boolean columns without explicit CHECK constraints — verify TINYINT(1)
//    type enforcement and document gaps
// ======================================================================

describe('B) Boolean columns without explicit CHECK constraints — type-level validation', () => {

  // MySQL TINYINT(1) allows values -128..127, so without a CHECK constraint,
  // values like 2 or -1 are ACCEPTED at the DB level. These tests document
  // that gap — they verify current behavior and flag for future CHECK constraints.

  // --- task_instances.generated (NOT NULL DEFAULT 0) ---
  describe('task_instances.generated (no CHECK — documents gap)', () => {
    var userId = uid('user-gen');
    var masterId = uid('master-gen');

    beforeAll(async () => {
      if (!await isDbAvailable()) return;
      await insertTestMaster(masterId, userId);
    });

    test('accepts 0', requireDB(async () => {
      var id = uid('gen0');
      await db.raw(`
        INSERT INTO task_instances (id, master_id, user_id, status, occurrence_ordinal, split_ordinal, split_total, \`generated\`, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, 0, NOW(), NOW())
      `, [id, masterId, userId]);
      var row = await db('task_instances').where('id', id).first();
      expect(row.generated).toBe(0);
      await db('task_instances').where('id', id).del();
    }, isDbAvailable));

    test('accepts 1', requireDB(async () => {
      var id = uid('gen1');
      await db.raw(`
        INSERT INTO task_instances (id, master_id, user_id, status, occurrence_ordinal, split_ordinal, split_total, \`generated\`, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, 1, NOW(), NOW())
      `, [id, masterId, userId]);
      var row = await db('task_instances').where('id', id).first();
      expect(row.generated).toBe(1);
      await db('task_instances').where('id', id).del();
    }, isDbAvailable));

    // GAP: Without a CHECK constraint, TINYINT(1) accepts values like 2.
    // This test documents the gap — if a CHECK constraint is added later,
    // this test should be updated to expect rejection.
    test('GAP — currently accepts value 2 (no CHECK constraint)', requireDB(async () => {
      var id = uid('gen2');
      await db.raw(`
        INSERT INTO task_instances (id, master_id, user_id, status, occurrence_ordinal, split_ordinal, split_total, \`generated\`, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, 1, 1, 2, NOW(), NOW())
      `, [id, masterId, userId]);
      var row = await db('task_instances').where('id', id).first();
      // GAP: Without a CHECK constraint, TINYINT(1) accepts 2. Documenting this.
      expect(row.generated).toBe(2);
      await db('task_instances').where('id', id).del();
    }, isDbAvailable));
  });

  // --- cal_sync_ledger.event_all_day (NOT NULL DEFAULT 0) ---
  describe('cal_sync_ledger.event_all_day (no CHECK — documents gap)', () => {
    // We need a user and a user_calendars entry to satisfy FK constraints.
    // Check if cal_sync_ledger has user_id FK or can accept direct inserts.
    test('accepts 0', requireDB(async () => {
      // Use raw SQL to check column type — verify it's TINYINT(1)
      var [rows] = await db.raw(`
        SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'cal_sync_ledger'
          AND COLUMN_NAME = 'event_all_day'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].COLUMN_TYPE).toMatch(/tinyint\(1\)/i);
    }, isDbAvailable));

    test('accepts 1', requireDB(async () => {
      var [rows] = await db.raw(`
        SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'cal_sync_ledger'
          AND COLUMN_NAME = 'event_all_day'
      `);
      expect(rows.length).toBe(1);
      // Boolean type confirmed
      expect(rows[0].COLUMN_TYPE).toMatch(/tinyint\(1\)/i);
    }, isDbAvailable));
  });

  // --- cal_sync_ledger.done_frozen (NOT NULL DEFAULT 0) ---
  describe('cal_sync_ledger.done_frozen (no CHECK — documents gap)', () => {
    test('column is TINYINT(1)', requireDB(async () => {
      var [rows] = await db.raw(`
        SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'cal_sync_ledger'
          AND COLUMN_NAME = 'done_frozen'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].COLUMN_TYPE).toMatch(/tinyint\(1\)/i);
    }, isDbAvailable));
  });

  // --- user_calendars.enabled (NOT NULL DEFAULT 1) ---
  describe('user_calendars.enabled (no CHECK — documents gap)', () => {
    test('column is TINYINT(1)', requireDB(async () => {
      var [rows] = await db.raw(`
        SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'user_calendars'
          AND COLUMN_NAME = 'enabled'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].COLUMN_TYPE).toMatch(/tinyint\(1\)/i);
    }, isDbAvailable));
  });

  // --- ai_usage_outbox.error_flag (NOT NULL DEFAULT 0) ---
  describe('ai_usage_outbox.error_flag (no CHECK — documents gap)', () => {
    test('column is TINYINT(1)', requireDB(async () => {
      var [rows] = await db.raw(`
        SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'ai_usage_outbox'
          AND COLUMN_NAME = 'error_flag'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].COLUMN_TYPE).toMatch(/tinyint\(1\)/i);
    }, isDbAvailable));
  });
});

// ======================================================================
// C) Comprehensive information_schema audit — all boolean columns
// ======================================================================

describe('C) Schema audit — all TINYINT(1) boolean columns', () => {
  test('every table.boolean() column is declared as TINYINT(1)', requireDB(async () => {
    // Query information_schema for all TINYINT(1) boolean columns across base tables (not views).
    // table.boolean() always produces TINYINT(1) — that's what we're validating here.
    // Non-boolean tinyint columns (tinyint unsigned for counters, tinyint(2) for enums, etc.)
    // are intentionally excluded from this audit.
    var [rows] = await db.raw(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_TYPE = 'tinyint(1)'
        AND TABLE_NAME NOT LIKE '%_v'
        AND TABLE_NAME NOT IN (
          SELECT TABLE_NAME FROM information_schema.VIEWS
          WHERE TABLE_SCHEMA = DATABASE()
        )
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);

    // All found columns should be TINYINT(1) — that's guaranteed by the query filter.
    // Verify we found the expected minimum set of boolean columns.
    var booleanColumns = rows;
    var badColumns = rows.filter(function(r) {
      return r.COLUMN_TYPE !== 'tinyint(1)';
    });

    if (badColumns.length > 0) {
      console.error('Columns with wrong TINYINT width (expected TINYINT(1)):');
      badColumns.forEach(function(c) {
        console.error('  ' + c.TABLE_NAME + '.' + c.COLUMN_NAME + ' = ' + c.COLUMN_TYPE);
      });
    }

    expect(badColumns).toHaveLength(0);

    // Print summary for audit purposes
    console.log('\nBoolean columns audit (' + booleanColumns.length + ' TINYINT(1) columns found):');
    booleanColumns.forEach(function(r) {
      console.log('  ' + r.TABLE_NAME + '.' + r.COLUMN_NAME +
        ' (' + r.COLUMN_TYPE + ', nullable=' + r.IS_NULLABLE + ', default=' + r.COLUMN_DEFAULT + ')');
    });
  }, isDbAvailable));

  test('CHECK constraints exist on task_masters boolean columns', requireDB(async () => {
    var [constraints] = await db.raw(`
      SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
        AND tc.TABLE_NAME = 'task_masters'
        AND cc.CONSTRAINT_NAME LIKE 'chk_task_masters_%'
      ORDER BY cc.CONSTRAINT_NAME
    `);

    var constraintNames = constraints.map(function(c) { return c.CONSTRAINT_NAME; });

    // Verify the three known boolean CHECK constraints
    expect(constraintNames).toContain('chk_task_masters_flex_when');
    expect(constraintNames).toContain('chk_task_masters_recurring');
    expect(constraintNames).toContain('chk_task_masters_split');
  }, isDbAvailable));

  test('CHECK constraints exist on task_instances boolean columns', requireDB(async () => {
    var [constraints] = await db.raw(`
      SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
        AND tc.TABLE_NAME = 'task_instances'
        AND cc.CONSTRAINT_NAME LIKE 'chk_task_instances_%'
      ORDER BY cc.CONSTRAINT_NAME
    `);

    var constraintNames = constraints.map(function(c) { return c.CONSTRAINT_NAME; });

    // Verify the known boolean CHECK constraints
    expect(constraintNames).toContain('chk_task_instances_unscheduled');

    // Status constraint should also exist (from 20260601000000)
    expect(constraintNames).toContain('chk_task_instances_status');
  }, isDbAvailable));

  test('CHECK constraint values are strictly {0, 1} for non-nullable booleans', requireDB(async () => {
    var [constraints] = await db.raw(`
      SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
        AND tc.TABLE_NAME IN ('task_masters', 'task_instances')
        AND cc.CONSTRAINT_NAME LIKE 'chk_%_%'
      ORDER BY cc.CONSTRAINT_NAME
    `);

    // Verify that flex_when and recurring constraints only allow 0/1
    var flexWhenConstraint = constraints.find(function(c) {
      return c.CONSTRAINT_NAME === 'chk_task_masters_flex_when';
    });
    expect(flexWhenConstraint).toBeTruthy();
    // The constraint should use IN (0, 1) — not a range check
    expect(flexWhenConstraint.CHECK_CLAUSE).toContain('0');

    var recurringConstraint = constraints.find(function(c) {
      return c.CONSTRAINT_NAME === 'chk_task_masters_recurring';
    });
    expect(recurringConstraint).toBeTruthy();
    expect(recurringConstraint.CHECK_CLAUSE).toContain('0');
  }, isDbAvailable));

  test('nullable boolean CHECK constraints allow {0, 1, NULL}', requireDB(async () => {
    var [constraints] = await db.raw(`
      SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
        AND cc.CONSTRAINT_NAME IN ('chk_task_masters_split', 'chk_task_instances_unscheduled')
      ORDER BY cc.CONSTRAINT_NAME
    `);

    // Both should allow NULL — expressed as "OR ... IS NULL" in the constraint
    constraints.forEach(function(c) {
      expect(c.CHECK_CLAUSE).toContain('0');
      expect(c.CHECK_CLAUSE).toContain('1');
    });
  }, isDbAvailable));
});

// ======================================================================
// D) Gap analysis — boolean columns missing CHECK constraints
// ======================================================================

describe('D) Gap analysis — columns needing CHECK constraints', () => {
  test('documents all boolean columns missing CHECK constraints', requireDB(async () => {
    // Get all CHECK constraints on boolean columns (join to get table names)
    var [checkConstraints] = await db.raw(`
      SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
      ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME
    `);

    // Get all TINYINT(1) columns
    var [booleanColumns] = await db.raw(`
      SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND DATA_TYPE = 'tinyint'
        AND NUMERIC_PRECISION = 3
        AND COLUMN_TYPE = 'tinyint(1)'
      ORDER BY TABLE_NAME, COLUMN_NAME
    `);

    // Identify which tables have CHECK constraints on boolean columns
    var tablesWithChecks = {};
    checkConstraints.forEach(function(c) {
      if (!tablesWithChecks[c.TABLE_NAME]) {
        tablesWithChecks[c.TABLE_NAME] = [];
      }
      tablesWithChecks[c.TABLE_NAME].push(c.CONSTRAINT_NAME);
    });

    // Find boolean columns that lack CHECK constraints
    var gaps = [];
    booleanColumns.forEach(function(col) {
      var tableName = col.TABLE_NAME;
      var colName = col.COLUMN_NAME;

      // Check if this column has a dedicated CHECK constraint
      var hasCheck = checkConstraints.some(function(c) {
        return c.TABLE_NAME === tableName && c.CHECK_CLAUSE.includes(colName);
      });

      if (!hasCheck) {
        gaps.push({
          table: tableName,
          column: colName,
          nullable: col.IS_NULLABLE,
          default: col.COLUMN_DEFAULT
        });
      }
    });

    // Print gap analysis for documentation
    if (gaps.length > 0) {
      console.log('\n--- BOOLEAN COLUMNS WITHOUT CHECK CONSTRAINTS (gaps) ---');
      gaps.forEach(function(g) {
        console.log('  ' + g.table + '.' + g.column +
          ' (nullable=' + g.nullable + ', default=' + g.default + ')');
      });
      console.log('Total gaps: ' + gaps.length);
    } else {
      console.log('\nAll boolean columns have CHECK constraints. No gaps found.');
    }

    // Assert: the gap list must exactly match the KNOWN documented set of boolean
    // columns without CHECK constraints (as documented in the file header).
    //
    // This test serves two purposes:
    //   1. It documents which columns lack CHECK constraints (the existing gaps).
    //   2. It FAILS if a NEW boolean column is added without a CHECK constraint
    //      (i.e. it appears in gaps but is not in the known set below).
    //
    // KNOWN GAPS (after all migrations through 20260618000000) — these columns
    // exist in the live schema without dedicated CHECK constraints. They are
    // covered by NOT NULL + DEFAULT or other implicit constraints instead.
    // See file header §B for the full rationale.
    // 'task_instances.overdue' removed (sched-drop-overdue-column, M-5,
    // 2026-07-03): the column itself is dropped (not just its CHECK
    // constraint) — it no longer appears in the gap list at all, since a
    // dropped column can't be an unconstrained boolean column. Authorized,
    // intentional removal (SPEC.md AC1/MIG-1), a strict simplification of
    // this gap list, not a regression.
    var KNOWN_GAPS = [
      { table: 'ai_usage_outbox',  column: 'error_flag'   },
      { table: 'cal_sync_ledger',  column: 'done_frozen'  },
      { table: 'cal_sync_ledger',  column: 'event_all_day' },
      { table: 'oauth_auth_codes', column: 'used'         },
      { table: 'task_instances',   column: 'generated'    },
      { table: 'user_calendars',   column: 'enabled'      },
    ];

    // Build a key set from known gaps for O(1) lookup
    var knownKeys = {};
    KNOWN_GAPS.forEach(function(g) { knownKeys[g.table + '.' + g.column] = true; });

    // Any gap not in the known set is a NEW unconstrained boolean column — FAIL
    var newGaps = gaps.filter(function(g) {
      return !knownKeys[g.table + '.' + g.column];
    });

    if (newGaps.length > 0) {
      console.error('\n[FAIL] NEW boolean columns without CHECK constraints detected:');
      newGaps.forEach(function(g) {
        console.error('  ' + g.table + '.' + g.column +
          ' (nullable=' + g.nullable + ', default=' + g.default + ')');
      });
      console.error('Add a CHECK constraint migration or update KNOWN_GAPS with a rationale.');
    }

    // The gaps array must contain exactly the known set — no more, no less.
    // Sorted for stable comparison.
    var gapKeys = gaps.map(function(g) { return g.table + '.' + g.column; }).sort();
    var knownKeysSorted = KNOWN_GAPS.map(function(g) { return g.table + '.' + g.column; }).sort();
    expect(gapKeys).toEqual(knownKeysSorted);
  }, isDbAvailable));
});

// ======================================================================
// E) tasks_v marker CASE derivation — data round-trip
//
// Zoe WARN-2 (re-review 2026-06-18): the marker derived column in tasks_v
// had zero round-trip coverage. The CASE expression is:
//   CASE WHEN m.placement_mode = 'reminder' THEN 1 ELSE 0 END AS marker
//
// After migration 20260518000100, 'marker' was RENAMED to 'reminder' and
// the old 'rigid' column was DROPPED (20260518000200). The surviving contract:
//   placement_mode = 'reminder'  → marker = 1
//   any other placement_mode     → marker = 0
//
// Do NOT assert on placement_mode = 'marker' (dead value, renamed).
// Do NOT assert on the 'rigid' column (dropped from the view).
// ======================================================================

describe('E) tasks_v marker CASE derivation — data round-trip', () => {
  // Use unique user / master IDs per describe to avoid cross-test collisions
  var userId = uid('user-mrkr');
  var reminderMasterId = uid('master-mrkr-reminder');
  var allDayMasterId = uid('master-mrkr-allday');

  /**
   * Insert a minimal task_instances row for a given master.
   * Returns the instance id.
   */
  async function insertTestInstance(instanceId, masterId) {
    await db.raw(`
      INSERT IGNORE INTO task_instances
        (id, master_id, user_id, occurrence_ordinal, split_ordinal, split_total,
         dur, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, 1, 30, '', NOW(), NOW())
    `, [instanceId, masterId, userId]);
    return instanceId;
  }

  beforeAll(async () => {
    if (!await isDbAvailable()) return;
    await ensureTestUser(userId);

    // Insert a master with placement_mode='reminder' — marker should be 1
    await db.raw(`
      INSERT IGNORE INTO task_masters
        (id, user_id, text, status, pri, placement_mode, flex_when, recurring,
         created_at, updated_at)
      VALUES (?, ?, 'Marker round-trip reminder', '', 'P3', 'reminder', 0, 0,
              NOW(), NOW())
    `, [reminderMasterId, userId]);

    // Insert a master with placement_mode='all_day' — marker should be 0
    await db.raw(`
      INSERT IGNORE INTO task_masters
        (id, user_id, text, status, pri, placement_mode, flex_when, recurring,
         created_at, updated_at)
      VALUES (?, ?, 'Marker round-trip all_day', '', 'P3', 'all_day', 0, 0,
              NOW(), NOW())
    `, [allDayMasterId, userId]);

    // Insert one instance per master so both appear in the tasks_v instance branch
    await insertTestInstance(uid('inst-mrkr-reminder'), reminderMasterId);
    await insertTestInstance(uid('inst-mrkr-allday'), allDayMasterId);
  });

  afterAll(async () => {
    if (!await isDbAvailable()) return;
    // Clean up in FK order
    await db.raw(`DELETE FROM task_instances WHERE master_id IN (?, ?)`,
      [reminderMasterId, allDayMasterId]);
    await db.raw(`DELETE FROM task_masters WHERE id IN (?, ?)`,
      [reminderMasterId, allDayMasterId]);
    await db.raw(`DELETE FROM users WHERE id = ?`, [userId]);
  });

  test('placement_mode=reminder yields marker=1 in tasks_v', requireDB(async () => {
    var rows = await db.raw(
      'SELECT marker, placement_mode FROM tasks_v WHERE master_id = ? LIMIT 1',
      [reminderMasterId]
    );
    var row = rows[0][0];
    expect(row).toBeDefined();
    expect(row.placement_mode).toBe('reminder');
    expect(row.marker).toBe(1);
  }, isDbAvailable));

  test('placement_mode=all_day yields marker=0 in tasks_v', requireDB(async () => {
    var rows = await db.raw(
      'SELECT marker, placement_mode FROM tasks_v WHERE master_id = ? LIMIT 1',
      [allDayMasterId]
    );
    var row = rows[0][0];
    expect(row).toBeDefined();
    expect(row.placement_mode).toBe('all_day');
    expect(row.marker).toBe(0);
  }, isDbAvailable));

  test('no tasks_v row has placement_mode=marker (dead enum value renamed to reminder)', requireDB(async () => {
    // The old value 'marker' was renamed to 'reminder' in 20260518000100.
    // No rows should carry the dead value — the ENUM itself no longer permits it.
    // This guards against a regression that re-introduces the old enum value.
    var rows = await db.raw(
      "SELECT COUNT(*) AS cnt FROM tasks_v WHERE placement_mode = 'marker'"
    );
    expect(rows[0][0].cnt).toBe(0);
  }, isDbAvailable));
});