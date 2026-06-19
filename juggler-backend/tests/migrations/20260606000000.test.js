/**
 * 20260606000000.test.js — Test for adding missed status to task_instances CHECK constraint
 *
 * Verifies that the migration adds 'missed' status to the task_instances.status CHECK constraint
 */

jest.setTimeout(30000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

var db = require('../../src/db');
var migration = require('../../src/db/migrations/20260606000000_add_missed_status_to_task_instances');
var { requireDB } = require('../helpers/requireDB');

// 999.739: pin the "rejects 'missed'" assertion to the CHECK constraint. After
// down() restores the constraint that excludes 'missed', the insert must be
// rejected by chk_task_instances_status (ER_CHECK_CONSTRAINT_VIOLATED) — not by
// some incidental error. A bare .rejects.toThrow() would pass either way.
var CHECK_VIOLATION = /ER_CHECK_CONSTRAINT_VIOLATED|check constraint/i;

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

async function cleanup() {
  // Clean up any test data (order matters — FK: instances before masters before users)
  await db('task_instances').where('user_id', 'test-user-missed').del();
  await db('task_masters').where('user_id', 'test-user-missed').del();
  await db('users').where('id', 'test-user-missed').del();
  // Ensure the migration is left in its applied (up) state for subsequent suites.
  await migration.up(db).catch(() => {});
}

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanup();
});

afterAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanup();
  await db.destroy();
});

describe('migration 20260606000000_add_missed_status_to_task_instances', () => {

  test('up() adds missed status to CHECK constraint', requireDB(async () => {
    // Run the migration
    await migration.up(db);

    // Test that we can insert a task_instance with 'missed' status
    await db('users').insert({
      id: 'test-user-missed',
      email: 'test-missed@test.com',
      name: 'Test User',
      timezone: 'America/New_York',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Create a task_master first
    await db('task_masters').insert({
      id: 'test-master-missed',
      user_id: 'test-user-missed',
      text: 'Test task for missed status',
      status: '',
      pri: 'P3',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Insert a task_instance with 'missed' status - this should succeed.
    // 999.739: the legacy `date_pinned` column no longer exists in the
    // task_instances schema (removed by a later migration). Use the real `date`
    // column instead, otherwise the insert fails with "Unknown column
    // 'date_pinned'" and the test asserts nothing about the missed-status CHECK.
    await db('task_instances').insert({
      id: 'test-instance-missed',
      master_id: 'test-master-missed',
      user_id: 'test-user-missed',
      status: 'missed',
      date: '2026-06-06',
      scheduled_at: db.fn.now(),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Verify the insert succeeded
    var instance = await db('task_instances').where('id', 'test-instance-missed').first();
    expect(instance).toBeTruthy();
    expect(instance.status).toBe('missed');
  }));

  test('down() removes missed status from CHECK constraint', requireDB(async () => {
    // MySQL enforces CHECK constraints against existing rows when the constraint is
    // re-added. We must delete any 'missed' rows before calling down() so that the
    // restored constraint (which excludes 'missed') can be applied cleanly.
    await db('task_instances').where('user_id', 'test-user-missed').del();

    // Run the down migration
    await migration.down(db);

    // Try to insert another task_instance with 'missed' status - this should fail
    await expect(db('task_instances').insert({
      id: 'test-instance-missed-down',
      master_id: 'test-master-missed',
      user_id: 'test-user-missed',
      status: 'missed',
      date: '2026-06-06',
      scheduled_at: db.fn.now(),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    })).rejects.toThrow(CHECK_VIOLATION);
  }));

  test('up() is idempotent', requireDB(async () => {
    // Run up again - should not fail
    await expect(migration.up(db)).resolves.not.toThrow();
  }));

});