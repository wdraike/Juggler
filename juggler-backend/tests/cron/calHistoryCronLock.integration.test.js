/**
 * Integration tests for cal-history cron leader election + DB-handle fix
 * (jug-elected-sweeper-topology / 999.555). Runs against test-bed MySQL @3407.
 *
 * Before this fix the cron was a 100% no-op: `require('../lib/db')` returned a
 * non-callable module object, and `acquireLock` queried a `name` column that does
 * not exist on `sync_locks` (the per-user FK'd lock) — every query threw, was
 * swallowed, and the job silently never ran. The fix uses getDefaultDb() and a
 * dedicated atomic `cron_locks` table.
 */
const { assertDbAvailable } = require('../helpers/requireDB');
const dbModule = require('../../src/lib/db');
const cron = require('../../src/cron/cal-history-cron');

let db;

beforeAll(async () => {
  await assertDbAvailable();
  db = dbModule.getDefaultDb();
});

const TEST_USER = 'cron-lock-test-user';

afterEach(async () => {
  await db('cron_locks').del();
});

afterAll(async () => {
  await db('cron_locks').del();
  await db('cal_history').where('user_id', TEST_USER).del();
  await db('task_instances').where('user_id', TEST_USER).del();
  await db('task_masters').where('user_id', TEST_USER).del();
  await db('users').where('id', TEST_USER).del();
  await db.destroy();
});

describe('cal-history cron leader election (999.555)', () => {
  test('acquireLock claims a free lock and writes a cron_locks row', async () => {
    const got = await cron.acquireLock('test:free', 3600);
    expect(got).toBe(true);
    const row = await db('cron_locks').where('lock_name', 'test:free').first();
    expect(row).toBeTruthy();
    expect(row.locked_by).toBeTruthy();
  });

  test('acquireLock returns false while another instance holds an UNEXPIRED lock', async () => {
    await db('cron_locks').insert({
      lock_name: 'test:held',
      locked_by: 'other-instance',
      locked_at: db.raw('NOW()'),
      expires_at: db.raw('DATE_ADD(NOW(), INTERVAL 1 HOUR)')
    });
    const got = await cron.acquireLock('test:held', 3600);
    expect(got).toBe(false);
    // The foreign owner must be untouched — no silent takeover of a live lock.
    const row = await db('cron_locks').where('lock_name', 'test:held').first();
    expect(row.locked_by).toBe('other-instance');
  });

  test('acquireLock atomically takes over an EXPIRED foreign lock', async () => {
    await db('cron_locks').insert({
      lock_name: 'test:expired',
      locked_by: 'dead-instance',
      locked_at: db.raw('DATE_SUB(NOW(), INTERVAL 2 HOUR)'),
      expires_at: db.raw('DATE_SUB(NOW(), INTERVAL 1 HOUR)')
    });
    const got = await cron.acquireLock('test:expired', 3600);
    expect(got).toBe(true);
    const row = await db('cron_locks').where('lock_name', 'test:expired').first();
    expect(row.locked_by).not.toBe('dead-instance');
  });

  test('releaseLock frees a lock this instance holds', async () => {
    expect(await cron.acquireLock('test:rel', 3600)).toBe(true);
    await cron.releaseLock('test:rel');
    const row = await db('cron_locks').where('lock_name', 'test:rel').first();
    expect(row).toBeFalsy();
  });

  // markMissedTasks (and its two lock/single-flight tests formerly here) retired —
  // sched-drop-overdue-column / M-5 (999.1085). Its ENTIRE purpose was writing
  // task_instances.overdue, a column this leg drops; see src/cron/cal-history-cron.js
  // for the retirement rationale. acquireLock/releaseLock (generic leader-election,
  // still used by purgeOldEntries) keep their coverage above.
});
