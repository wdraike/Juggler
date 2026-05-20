/**
 * Tests for scheduleQueue.js — event queue, single-flight, retry, error handling.
 *
 * Strategy: stop the real poll loop, set DEBOUNCE_MS=0 and LOCK_RETRY_MS=0,
 * then call processUser() directly so tests are deterministic with no waits.
 */

jest.mock('../src/scheduler/runSchedule', () => ({
  runScheduleAndPersist: jest.fn()
}));

jest.mock('../src/lib/sync-lock', () => ({
  withLock: jest.fn()
}));

jest.mock('../src/lib/task-write-queue', () => ({
  flushQueueInLock: jest.fn().mockResolvedValue()
}));

jest.mock('../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

const db = require('../src/db');
const { enqueueScheduleRun, stopPollLoop, _internal } = require('../src/scheduler/scheduleQueue');
const { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
const { withLock } = require('../src/lib/sync-lock');

const TEST_USER_IDS = ['user1', 'userA', 'userB', 'user_err', 'user_locked', 'user_retry'];

var dbAvailable = false;

async function isDbAvailable() {
  try {
    await db.raw('SELECT 1');
    return true;
  } catch (e) {
    return false;
  }
}

beforeAll(async () => {
  // Stop the real poll loop so it doesn't interfere
  stopPollLoop();

  // Make debounce and lock-retry instant so processUser runs synchronously
  _internal.setDebounceMs(0);
  _internal.setLockRetryMs(0);

  dbAvailable = await isDbAvailable();
  if (!dbAvailable) return;

  // Seed test users (schedule_queue has FK to users)
  try {
    await db('schedule_queue').whereIn('user_id', TEST_USER_IDS).del();
    await db('users').whereIn('id', TEST_USER_IDS).del();
    var rows = TEST_USER_IDS.map(function(id) {
      return {
        id: id, email: id + '@test.com', name: id,
        timezone: 'America/New_York',
        created_at: db.fn.now(), updated_at: db.fn.now()
      };
    });
    await db('users').insert(rows);
  } catch (e) { console.warn('[scheduleQueue.test] seed failed:', e.message); }
});

afterAll(async () => {
  if (dbAvailable) {
    try {
      await db('schedule_queue').whereIn('user_id', TEST_USER_IDS).del();
      await db('users').whereIn('id', TEST_USER_IDS).del();
    } catch (e) {}
  }
  await db.destroy();
});

beforeEach(async () => {
  runScheduleAndPersist.mockReset();
  runScheduleAndPersist.mockResolvedValue({ updated: 5, cleared: 2 });
  withLock.mockReset();
  withLock.mockImplementation(async function(userId, fn) { return fn(); });
  try { await db('schedule_queue').whereIn('user_id', TEST_USER_IDS).del(); } catch (e) {}
});

describe('scheduleQueue', () => {
  test('enqueue triggers scheduler run', async () => {
    if (!dbAvailable) return;
    await enqueueScheduleRun('user1', 'test');
    await _internal.processUser('user1');
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(1);
    expect(runScheduleAndPersist).toHaveBeenCalledWith('user1', undefined, expect.objectContaining({ timezone: expect.any(String) }));
  });

  test('different users run independently', async () => {
    if (!dbAvailable) return;
    await enqueueScheduleRun('userA', 'test');
    await enqueueScheduleRun('userB', 'test');
    await _internal.processUser('userA');
    await _internal.processUser('userB');
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(2);
  });

  test('error in scheduler is caught (does not crash)', async () => {
    if (!dbAvailable) return;
    runScheduleAndPersist.mockRejectedValue(new Error('DB connection lost'));
    var errSpy = jest.spyOn(console, 'error').mockImplementation();
    await enqueueScheduleRun('user_err', 'test');
    await _internal.processUser('user_err');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SCHED-QUEUE]'),
      expect.any(Error)
    );
    errSpy.mockRestore();
  });

  test('lock contention retries up to 3 times', async () => {
    if (!dbAvailable) return;
    withLock.mockResolvedValue(null); // never acquires lock
    var warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    await enqueueScheduleRun('user_locked', 'test');
    await _internal.processUser('user_locked');
    expect(withLock).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not acquire lock'));
    warnSpy.mockRestore();
  });

  test('lock acquired on retry succeeds', async () => {
    if (!dbAvailable) return;
    var callCount = 0;
    withLock.mockImplementation(async function(userId, fn) {
      callCount++;
      if (callCount < 3) return null; // fail first 2
      return fn();                    // succeed on 3rd
    });
    await enqueueScheduleRun('user_retry', 'test');
    await _internal.processUser('user_retry');
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(1);
  });
});
