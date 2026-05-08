/**
 * Tests for the juggler-cal-history Plan A migration:
 *   20260509000300_add_missed_status_and_completed_at.js
 *
 * Asserts:
 *   - task_instances.status CHECK constraint accepts 'missed', rejects 'bogus'
 *   - task_masters.status CHECK constraint accepts 'missed'
 *   - task_instances.completed_at column exists
 *   - tasks_v view exposes completed_at
 *   - Legacy terminal rows backfilled (completed_at = updated_at)
 *
 * Skips automatically when no test DB is available.
 */
process.env.NODE_ENV = 'test';

var testDb = require('../helpers/testDb');

var hasDb = false;

beforeAll(async function() {
  hasDb = await testDb.isAvailable();
});

afterAll(async function() {
  if (hasDb) await testDb.destroy();
});

function maybeTest(name, fn) {
  // Only run when a real DB is reachable. CI without a DB skips.
  return (hasDb ? test : test.skip)(name, fn);
}

describe('migration: 20260509000300_add_missed_status_and_completed_at', function() {
  maybeTest('task_instances.status CHECK accepts missed', async function() {
    var db = testDb.getDb();
    await testDb.cleanup();
    await testDb.seedUser({ id: 'mig-test-user' });
    var t = await testDb.seedTask({ id: 'mig-task-1', user_id: 'mig-test-user', scheduled_at: db.fn.now() });

    // Direct UPDATE (bypass controller validation) to assert DB layer accepts missed
    await expect(
      db('task_instances').where({ id: t.id }).update({ status: 'missed', updated_at: db.fn.now() })
    ).resolves.toBeDefined();

    var row = await db('task_instances').where({ id: t.id }).first();
    expect(row.status).toBe('missed');
  });

  maybeTest('task_instances.status CHECK rejects bogus', async function() {
    var db = testDb.getDb();
    await testDb.cleanup();
    await testDb.seedUser({ id: 'mig-test-user' });
    var t = await testDb.seedTask({ id: 'mig-task-2', user_id: 'mig-test-user', scheduled_at: db.fn.now() });

    await expect(
      db('task_instances').where({ id: t.id }).update({ status: 'bogus', updated_at: db.fn.now() })
    ).rejects.toThrow(/CHECK|constraint|chk_task_instances_status/i);
  });

  maybeTest('task_masters.status CHECK accepts missed', async function() {
    var db = testDb.getDb();
    await testDb.cleanup();
    await testDb.seedUser({ id: 'mig-test-user' });
    var tpl = await testDb.seedTemplate({ id: 'mig-tpl-1', user_id: 'mig-test-user' });
    await expect(
      db('task_masters').where({ id: tpl.id }).update({ status: 'missed', updated_at: db.fn.now() })
    ).resolves.toBeDefined();
  });

  maybeTest('task_instances.completed_at column exists', async function() {
    var db = testDb.getDb();
    var rows = await db.raw(
      "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_instances' AND COLUMN_NAME = 'completed_at'"
    );
    var found = rows[0] && rows[0].length > 0 ? rows[0][0] : null;
    expect(found).toBeTruthy();
    expect(String(found.DATA_TYPE).toLowerCase()).toBe('datetime');
  });

  maybeTest('tasks_v view exposes completed_at', async function() {
    var db = testDb.getDb();
    var rows = await db.raw('SELECT completed_at FROM tasks_v LIMIT 1');
    // rows[0] is the data array (mysql2 driver returns [rows, fields])
    expect(Array.isArray(rows[0])).toBe(true);
  });

  maybeTest('purge index idx_task_instances_purge exists', async function() {
    var db = testDb.getDb();
    var rows = await db.raw(
      "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_instances' AND INDEX_NAME = 'idx_task_instances_purge'"
    );
    expect(rows[0].length).toBeGreaterThan(0);
  });

  maybeTest('legacy terminal rows have completed_at populated', async function() {
    // Idempotency invariant: after migration, no terminal rows should have null completed_at.
    var db = testDb.getDb();
    var orphans = await db('task_instances')
      .whereIn('status', ['done', 'skip', 'cancel'])
      .whereNull('completed_at')
      .count('* as n')
      .first();
    expect(Number(orphans.n)).toBe(0);
  });
});
