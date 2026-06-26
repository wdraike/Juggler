/**
 * 20260624160000_widen_task_masters_status_constraint.test.js
 * Bug 999.865 — task_masters status CHECK rejected 'wip'/'pause'
 *
 * Regression test for migration:
 *   juggler-backend/src/db/migrations/20260624160000_widen_task_masters_status_constraint.js
 *
 * BUG: The live schema had a stale narrow chk_task_masters_status_enum that
 * allowed only ('', 'pending', 'done', 'skip', 'cancel', 'missed') plus a
 * duplicate chk_task_masters_status. The status-update write path (tasks-write.js,
 * PUT /api/tasks/:id/status) writes 'wip' and 'pause' to task_masters.status,
 * producing ~96 ER_CHECK_CONSTRAINT_VIOLATED failures across status-transition
 * suites.
 *
 * FIX: Migration 20260624160000 drops both stale/duplicate constraints and
 * recreates ONE authoritative wide constraint (chk_task_masters_status_enum)
 * allowing the full lifecycle set:
 *   '', wip, done, cancel, skip, pause, disabled, missed, pending, archived,
 *   restored, cancelled
 * It also repairs chk_task_instances_status to include 'cancelled'.
 *
 * Run command (from juggler-backend/):
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass \
 *   DB_NAME=juggler_test NODE_ENV=test \
 *   npx jest tests/migrations/20260624160000_widen_task_masters_status_constraint.test.js \
 *   --forceExit --runInBand
 *
 * Test-bed: MySQL on 3407, juggler_test (migrated to latest).
 */

'use strict';

jest.setTimeout(30000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

// Force test environment — explicit defaults guard against a missing .env.test
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

// ── Availability probe ────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Non-tautological reject assertion: a bare .rejects.toThrow() would pass for
 * ANY rejection (FK violation, NOT NULL, wrong column count). We specifically
 * match ER_CHECK_CONSTRAINT_VIOLATED so the assertion is meaningful.
 */
var CHECK_VIOLATION = /ER_CHECK_CONSTRAINT_VIOLATED|check constraint/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

var counter = 0;
function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + (++counter);
}

async function ensureTestUser(userId) {
  await db.raw(`
    INSERT IGNORE INTO users (id, email, name, timezone, created_at, updated_at)
    VALUES (?, ?, 'Status Constraint Test User', 'UTC', NOW(), NOW())
  `, [userId, userId + '@865-test.com']);
}

/**
 * Insert a minimal task_masters row (status='') as FK anchor for task_instances.
 * Uses INSERT IGNORE so repeated calls are safe.
 */
async function insertTestMaster(masterId, userId) {
  await ensureTestUser(userId);
  await db.raw(`
    INSERT IGNORE INTO task_masters
      (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
    VALUES (?, ?, 'Status constraint regression 999.865', '', 'P3', 0, 0, NULL, NOW(), NOW())
  `, [masterId, userId]);
}

async function cleanup() {
  var testEmailPattern = '%@865-test.com';
  try {
    await db.raw(
      'DELETE i FROM task_instances i ' +
      'JOIN task_masters m ON i.master_id = m.id ' +
      'JOIN users u ON m.user_id = u.id ' +
      'WHERE u.email LIKE ?',
      [testEmailPattern]
    );
  } catch (_e) { /* no rows */ }
  try {
    await db.raw(
      'DELETE FROM task_masters WHERE user_id IN ' +
      '(SELECT id FROM users WHERE email LIKE ?)',
      [testEmailPattern]
    );
  } catch (_e) {}
  try {
    await db.raw('DELETE FROM users WHERE email LIKE ?', [testEmailPattern]);
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
// A) task_masters ACCEPTS the newly permitted status values
//
// Bug 999.865: 'wip' and 'pause' (and 'disabled', 'cancelled') were
// REJECTED by the stale narrow constraint. After the migration they must
// INSERT cleanly and read back correctly.
// ======================================================================

describe('A) task_masters — ACCEPTS statuses in the widened set (999.865 regression)', () => {
  var userId = uid('user-a');
  var anchorMasterId = uid('master-anchor-a');

  beforeAll(async () => {
    if (!await isDbAvailable()) return;
    await insertTestMaster(anchorMasterId, userId);
  });

  var acceptedStatuses = ['wip', 'pause', 'disabled', 'cancelled'];

  acceptedStatuses.forEach(function(status) {
    test('accepts status="' + status + '" (was rejected by stale constraint)', requireDB(async () => {
      var id = uid('tm-' + status);
      await db.raw(`
        INSERT INTO task_masters
          (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
        VALUES (?, ?, 'Regression 999.865', ?, 'P3', 0, 0, NULL, NOW(), NOW())
      `, [id, userId, status]);
      var row = await db('task_masters').where('id', id).first();
      expect(row).toBeDefined();
      expect(row.status).toBe(status);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));
  });

  // Also verify the pre-existing accepted statuses still work (no regression
  // in the other direction)
  var existingStatuses = ['', 'pending', 'done', 'skip', 'cancel', 'missed'];

  existingStatuses.forEach(function(status) {
    test('still accepts pre-existing status="' + status + '"', requireDB(async () => {
      var id = uid('tm-existing-' + (status || 'empty'));
      await db.raw(`
        INSERT INTO task_masters
          (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
        VALUES (?, ?, 'Pre-existing status', ?, 'P3', 0, 0, NULL, NOW(), NOW())
      `, [id, userId, status]);
      var row = await db('task_masters').where('id', id).first();
      expect(row).toBeDefined();
      expect(row.status).toBe(status);
      await db('task_masters').where('id', id).del();
    }, isDbAvailable));
  });
});

// ======================================================================
// B) task_masters REJECTS a bogus status
//
// Non-tautological: the rejection must match CHECK_VIOLATION, not just
// "something threw". This proves the constraint is still enforcing —
// the widen did not accidentally drop all enforcement.
// ======================================================================

describe('B) task_masters — REJECTS a bogus status value (constraint still enforces)', () => {
  var userId = uid('user-b');

  beforeAll(async () => {
    if (!await isDbAvailable()) return;
    await ensureTestUser(userId);
  });

  test('rejects status="bogus_zzz" with ER_CHECK_CONSTRAINT_VIOLATED', requireDB(async () => {
    await expect(db.raw(`
      INSERT INTO task_masters
        (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
      VALUES (?, ?, 'Should be rejected', 'bogus_zzz', 'P3', 0, 0, NULL, NOW(), NOW())
    `, [uid('tm-bogus'), userId])).rejects.toThrow(CHECK_VIOLATION);
  }, isDbAvailable));

  test('rejects status="xyzzy" with ER_CHECK_CONSTRAINT_VIOLATED', requireDB(async () => {
    // 'xyzzy' is 5 chars (within varchar(10)) and not in the allowed set —
    // triggers CHECK_CONSTRAINT_VIOLATED, not a data-too-long error.
    await expect(db.raw(`
      INSERT INTO task_masters
        (id, user_id, text, status, pri, flex_when, recurring, split, created_at, updated_at)
      VALUES (?, ?, 'Should be rejected', 'xyzzy', 'P3', 0, 0, NULL, NOW(), NOW())
    `, [uid('tm-xyzzy'), userId])).rejects.toThrow(CHECK_VIOLATION);
  }, isDbAvailable));
});

// ======================================================================
// C) information_schema — authoritative wide constraint is present
//
// The migration drops the stale narrow chk_task_masters_status_enum AND
// the duplicate chk_task_masters_status, then recreates ONE authoritative
// constraint: chk_task_masters_status_enum (wide).
//
// chk_task_masters_status (the former duplicate) must NOT exist.
// chk_task_masters_status_enum must exist AND contain 'wip' AND 'pause'
// in its CHECK_CLAUSE.
// ======================================================================

describe('C) information_schema — authoritative wide constraint structure', () => {

  test('chk_task_masters_status_enum exists with wip and pause in clause', requireDB(async () => {
    var [rows] = await db.raw(`
      SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
        AND tc.TABLE_NAME = 'task_masters'
        AND cc.CONSTRAINT_NAME = 'chk_task_masters_status_enum'
    `);
    expect(rows.length).toBe(1);
    var clause = rows[0].CHECK_CLAUSE;
    // The wide constraint must contain 'wip' and 'pause' — these are the two
    // values that were blocked by the stale narrow constraint (999.865 root cause)
    expect(clause).toContain('wip');
    expect(clause).toContain('pause');
    // Also verify the newly added values are present
    expect(clause).toContain('disabled');
    expect(clause).toContain('cancelled');
    expect(clause).toContain('archived');
    expect(clause).toContain('restored');
  }, isDbAvailable));

  test('exactly ONE status-vocabulary CHECK constraint on task_masters — single authoritative wide pair', requireDB(async () => {
    // Query by CHECK_CLAUSE content (status vocabulary terms) rather than by constraint
    // name — this is not pass-on-empty. It goes RED on:
    //   (a) pre-fix narrow state: clause lacks 'wip'/'pause' → either count is 0 (no matching
    //       constraint) or the name/clause assertion fails
    //   (b) regression that adds a second/duplicate status constraint: count > 1 → RED
    //   (c) widen migration not applied: constraint absent → count = 0 → RED
    //
    // Status-vocabulary filter excludes the boolean constraints (chk_task_masters_flex_when,
    // chk_task_masters_recurring, chk_task_masters_split) whose clauses contain only 0/1/NULL —
    // they will never contain 'wip', 'pause', 'cancel', or 'skip'.
    var [rows] = await db.raw(`
      SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
        AND tc.TABLE_NAME = 'task_masters'
        AND (
          cc.CHECK_CLAUSE LIKE '%wip%'
          OR cc.CHECK_CLAUSE LIKE '%pause%'
          OR cc.CHECK_CLAUSE LIKE '%cancel%'
          OR cc.CHECK_CLAUSE LIKE '%skip%'
        )
    `);
    // EXACTLY ONE status-vocabulary constraint must exist (the authoritative wide one).
    // count=0 → migration not applied; count>1 → stale duplicate re-introduced.
    expect(rows.length).toBe(1);
    expect(rows[0].CONSTRAINT_NAME).toBe('chk_task_masters_status_enum');
    // Confirm the clause is WIDE — contains the two statuses that triggered 999.865
    expect(rows[0].CHECK_CLAUSE).toContain('wip');
    expect(rows[0].CHECK_CLAUSE).toContain('pause');
  }, isDbAvailable));

  test('only ONE status constraint on task_masters (no stale narrow pair)', requireDB(async () => {
    var [rows] = await db.raw(`
      SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
        AND tc.TABLE_NAME = 'task_masters'
        AND (cc.CONSTRAINT_NAME LIKE '%status_enum%' OR cc.CONSTRAINT_NAME LIKE '%_status')
        AND cc.CONSTRAINT_NAME LIKE 'chk_task_masters_%'
    `);
    // Exactly ONE status constraint should exist: chk_task_masters_status_enum
    // (the wide one). Any stale narrow constraint or duplicate is a BLOCK.
    var statusConstraints = rows.filter(function(r) {
      return r.CONSTRAINT_NAME === 'chk_task_masters_status_enum' ||
             r.CONSTRAINT_NAME === 'chk_task_masters_status';
    });
    expect(statusConstraints.length).toBe(1);
    expect(statusConstraints[0].CONSTRAINT_NAME).toBe('chk_task_masters_status_enum');
  }, isDbAvailable));
});

// ======================================================================
// D) task_instances ACCEPTS 'cancelled' (chk_task_instances_status repair)
//
// The migration also repairs chk_task_instances_status to include
// 'cancelled' (the R55 soft-delete path writes status='cancelled' to
// instance rows). This section guards that repair.
// ======================================================================

describe('D) task_instances — ACCEPTS status="cancelled" (chk_task_instances_status repair)', () => {
  var userId = uid('user-d');
  var masterId = uid('master-d');

  beforeAll(async () => {
    if (!await isDbAvailable()) return;
    await insertTestMaster(masterId, userId);
  });

  test('task_instances accepts status="cancelled" and reads back correctly', requireDB(async () => {
    var instanceId = uid('inst-cancelled');
    await db.raw(`
      INSERT INTO task_instances
        (id, master_id, user_id, occurrence_ordinal, split_ordinal, split_total,
         status, dur, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, 1, 'cancelled', 30, NOW(), NOW())
    `, [instanceId, masterId, userId]);
    var row = await db('task_instances').where('id', instanceId).first();
    expect(row).toBeDefined();
    expect(row.status).toBe('cancelled');
    await db('task_instances').where('id', instanceId).del();
  }, isDbAvailable));

  test('task_instances chk_task_instances_status clause contains "cancelled"', requireDB(async () => {
    var [rows] = await db.raw(`
      SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS cc
      JOIN information_schema.TABLE_CONSTRAINTS tc
        ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
        AND tc.TABLE_NAME = 'task_instances'
        AND cc.CONSTRAINT_NAME = 'chk_task_instances_status'
    `);
    expect(rows.length).toBe(1);
    var clause = rows[0].CHECK_CLAUSE;
    expect(clause).toContain('cancelled');
    // Also confirm the standard statuses remain
    expect(clause).toContain('wip');
    expect(clause).toContain('pause');
  }, isDbAvailable));

  test('task_instances still rejects a bogus status', requireDB(async () => {
    await expect(db.raw(`
      INSERT INTO task_instances
        (id, master_id, user_id, occurrence_ordinal, split_ordinal, split_total,
         status, dur, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, 1, 'bogus_zzz', 30, NOW(), NOW())
    `, [uid('inst-bogus'), masterId, userId])).rejects.toThrow(CHECK_VIOLATION);
  }, isDbAvailable));
});
