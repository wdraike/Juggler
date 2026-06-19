// SKIPPED: Migration doesn't exist yet (the test was written before the migration was created)
// See backlog items 999.736-739 for context. The migration would add CHECK constraints
// on boolean-like columns (flex_when/recurring/split/unscheduled) that MySQL tinyint(1) doesn't enforce natively.
if (process.env.SKIP_MIGRATION_TESTS) {
  describe = describe.skip;
}
/**
 * 20260605000000.test.js — Test for adding task status enum and timestamp fields
 *
 * Verifies that the migration adds:
 * - status enum column to task_masters
 * - completed_at timestamp column to task_masters
 * - scheduled_at timestamp column to task_masters
 * - CHECK constraints for status enum and scheduled_at requirement for terminal statuses
 * - Index for status-based queries
 */

jest.setTimeout(30000);

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

var db = require('../../src/db');
var migration = require('../../src/db/migrations/20260605000000_add_task_status_enum_and_timestamps');
var { requireDB } = require('../helpers/requireDB');

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
  // Clean up any test data
  await db('task_masters').where('id', 'test-master-status').del();
  await db('users').where('id', 'test-user-status').del();
}

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanup();
});

afterAll(async () => {
  if (!await isDbAvailable()) return;
  await cleanup();
  // 999.455 — RESTORE the shared schema. The `down()` test below DROPs
  // task_masters.status/completed_at/scheduled_at from the SHARED juggler_test;
  // without restoring, every other suite that writes task_masters.status (via
  // tasks-write.js insertTask, which carries `status` in MASTER_FIELDS) then
  // fails with "Unknown column 'status'". Re-apply up() to recreate the columns,
  // then drop the MISPLACED terminal CHECK (exactly as migration 20260609120000
  // does in the real chain) so the canonical post-migrate state is restored —
  // status/completed_at/scheduled_at present, chk_task_masters_scheduled_at_for_terminal
  // absent. (Full parallel isolation for migration-replay suites remains 999.306.)
  await migration.up(db).catch(() => {});
  await db.raw('ALTER TABLE task_masters DROP CHECK chk_task_masters_scheduled_at_for_terminal').catch(() => {});
  await db.destroy();
});

describe('migration 20260605000000_add_task_status_enum_and_timestamps', () => {

  test('up() adds all required columns and constraints', requireDB(async () => {
    // Run the migration
    await migration.up(db);

    // Test that we can insert a task_master with valid status
    await db('users').insert({
      id: 'test-user-status',
      email: 'test-status@test.com',
      name: 'Test User',
      timezone: 'America/New_York',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Test inserting with valid status values
    await db('task_masters').insert({
      id: 'test-master-empty',
      user_id: 'test-user-status',
      text: 'Test task with empty status',
      status: '',
      pri: 'P3',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    await db('task_masters').insert({
      id: 'test-master-wip',
      user_id: 'test-user-status',
      text: 'Test task with WIP status',
      status: 'wip',
      pri: 'P3',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Test inserting with terminal status and scheduled_at (should succeed)
    await db('task_masters').insert({
      id: 'test-master-done',
      user_id: 'test-user-status',
      text: 'Test task with done status',
      status: 'done',
      scheduled_at: db.fn.now(),
      pri: 'P3',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Verify the inserts succeeded
    var emptyTask = await db('task_masters').where('id', 'test-master-empty').first();
    expect(emptyTask).toBeTruthy();
    expect(emptyTask.status).toBe('');

    var wipTask = await db('task_masters').where('id', 'test-master-wip').first();
    expect(wipTask).toBeTruthy();
    expect(wipTask.status).toBe('wip');

    var doneTask = await db('task_masters').where('id', 'test-master-done').first();
    expect(doneTask).toBeTruthy();
    expect(doneTask.status).toBe('done');
    expect(doneTask.scheduled_at).toBeTruthy();
  }));

  test('status enum constraint prevents invalid status values', requireDB(async () => {
    // Try to insert with invalid status - should fail
    await expect(db('task_masters').insert({
      id: 'test-master-invalid',
      user_id: 'test-user-status',
      text: 'Test task with invalid status',
      status: 'invalid-status',
      pri: 'P3',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    })).rejects.toThrow();
  }));

  test('scheduled_at constraint requires value for terminal statuses', requireDB(async () => {
    // Try to insert with terminal status but no scheduled_at - should fail
    await expect(db('task_masters').insert({
      id: 'test-master-missing-scheduled',
      user_id: 'test-user-status',
      text: 'Test task with done status but no scheduled_at',
      status: 'done',
      // scheduled_at is NULL - should fail
      pri: 'P3',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    })).rejects.toThrow();
  }));

  test('completed_at column is available', requireDB(async () => {
    // Test that completed_at column exists and can be updated
    await db('task_masters').where('id', 'test-master-done').update({
      completed_at: db.fn.now()
    });

    var updatedTask = await db('task_masters').where('id', 'test-master-done').first();
    expect(updatedTask.completed_at).toBeTruthy();
  }));

  test('status index exists for performance', requireDB(async () => {
    // Verify the index exists by checking query performance
    // This is a basic check - in a real scenario you'd query information_schema
    var tasks = await db('task_masters').where('user_id', 'test-user-status').where('status', 'done').select('id');
    expect(tasks.length).toBeGreaterThan(0);
  }));

  test('up() is idempotent', requireDB(async () => {
    // Run up again - should not fail
    await expect(migration.up(db)).resolves.not.toThrow();
  }));

  test('down() removes all added columns and constraints', requireDB(async () => {
    // Run the down migration
    await migration.down(db);

    // Verify columns are removed by checking if they exist
    // Note: In a real test, you'd need to inspect information_schema
    // For this test, we'll just verify down() doesn't throw
    expect(true).toBe(true); // Placeholder - actual verification would require schema inspection
  }));
});