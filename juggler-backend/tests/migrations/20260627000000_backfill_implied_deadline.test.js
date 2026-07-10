/**
 * 20260627000000_backfill_implied_deadline.test.js
 *
 * Migration regression test — BUG-879 (999.879 overdue recurring)
 *
 * Verifies migration 20260627000000_backfill_implied_deadline.js:
 *   (up)  backfills implied_deadline = date + 1 day for recurring
 *         instances where implied_deadline IS NULL and date IS NOT NULL
 *   (down) is no-op (does not re-NULL)
 *
 * Run (isolated DB — juggler_sweep_test; test-bed 3407 must be up):
 *   export DB_PORT=3407 DB_HOST=127.0.0.1 DB_USER=root DB_PASSWORD=***
 *          DB_NAME=juggler_sweep_test NODE_ENV=test
 *   npx jest tests/migrations/20260627000000_backfill_implied_deadline.test.js \
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
// 999.1420 (pattern 6e12b41f / 999.1409): self-provision the isolated DB so this
// suite RUNS on a fresh test-bed instead of silently skipping via console.warn
// (juggler_sweep_test doesn't exist until something creates it — globalSetup
// only provisions juggler_test). ensureIsolatedDbExists creates the DB only;
// this suite drives migrate.latest() itself in beforeEach.
var { ensureIsolatedDbExists } = require('../helpers/ensureIsolatedDb');

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

var MIGRATION_NAME = '20260627000000_backfill_implied_deadline.js';
var TEST_ID_PREFIX = 'impl879-';
// 999.1420: task_instances FKs user_id → users (ON DELETE CASCADE); seed a real
// user so fixture inserts satisfy the constraint.
var TEST_USER_ID = 'impl879-user';

var _idCounter = 0;
function uniqueRowId() {
  _idCounter += 1;
  return TEST_ID_PREFIX + Date.now() + '-' + _idCounter;
}

describe('Migration 20260627000000 (implied_deadline backfill)', () => {

  beforeAll(async () => {
    // 999.1420: create juggler_sweep_test if absent (throws TEST-FR-001 if the
    // test-bed MySQL itself is unreachable — loud failure, not a silent skip).
    await ensureIsolatedDbExists();
    if (!(await isDbAvailable())) {
      console.warn('⚠ DB not available — migration tests will be skipped');
    }
  });

  beforeEach(async () => {
    if (!(await isDbAvailable())) return;
    // Apply all pending migrations so ours is in place
    await db.migrate.latest();
    // 999.1420: seed the FK-required user (idempotent — cleaned in afterEach)
    await db.raw(
      'INSERT IGNORE INTO users (id, email, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
      [TEST_USER_ID, TEST_USER_ID + '@impl879.local']
    );
  });

  afterEach(async () => {
    if (!(await isDbAvailable())) return;
    // Cleanup test rows (instances cascade-delete with the user, but be explicit)
    await db('task_instances').where('id', 'like', TEST_ID_PREFIX + '%').del();
    await db('users').where('id', TEST_USER_ID).del();
  });

  it('backfills implied_deadline = date + 1 day for rows with date but no implied_deadline', async () => {
    if (!(await isDbAvailable())) return;
    var id = uniqueRowId();
    // 999.1420: fixture aligned to the live master/instance schema —
    // task_instances has no text/task_type columns (text lives on task_masters;
    // master_id is nullable so no master row is needed for this backfill test).
    await db('task_instances').insert({
      id: id,
      user_id: TEST_USER_ID,
      date: '2026-06-24',
      implied_deadline: null,
      dur: 30,
      status: '',
      // overdue field removed (sched-drop-overdue-column, M-5): stored column gone.
    });

    // Re-run our migration up
    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var row = await db('task_instances').where('id', id).select('implied_deadline').first();
    expect(row).not.toBeNull();
    var actual = new Date(row.implied_deadline);
    var expected = new Date('2026-06-25');
    expect(actual.getTime()).toBe(expected.getTime());
  });

  it('does NOT update rows where date IS NULL', async () => {
    if (!(await isDbAvailable())) return;
    var id = uniqueRowId();
    await db('task_instances').insert({
      id: id,
      user_id: TEST_USER_ID,
      date: null,
      implied_deadline: null,
      dur: 30,
      status: '',
      // overdue field removed (sched-drop-overdue-column, M-5): stored column gone.
    });

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var row = await db('task_instances').where('id', id).select('implied_deadline').first();
    expect(row.implied_deadline).toBeNull();
  });

  it('does NOT update rows where implied_deadline is already set', async () => {
    if (!(await isDbAvailable())) return;
    var id = uniqueRowId();
    await db('task_instances').insert({
      id: id,
      user_id: TEST_USER_ID,
      date: '2026-06-30',
      implied_deadline: '2026-07-01',
      dur: 30,
      status: '',
      // overdue field removed (sched-drop-overdue-column, M-5): stored column gone.
    });

    await db.migrate.down({ name: MIGRATION_NAME });
    await db.migrate.latest();

    var row = await db('task_instances').where('id', id).select('implied_deadline').first();
    var actual = new Date(row.implied_deadline);
    var expected = new Date('2026-07-01');
    expect(actual.getTime()).toBe(expected.getTime());
  });

  it('down is safe no-op (does not throw)', async () => {
    if (!(await isDbAvailable())) return;
    await expect(db.migrate.down({ name: MIGRATION_NAME })).resolves.not.toThrow();
  });
});