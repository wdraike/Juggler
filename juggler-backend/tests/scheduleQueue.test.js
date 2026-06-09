/**
 * Tests for scheduleQueue.js — event queue, single-flight, retry, error handling.
 *
 * Strategy: stop the real poll loop, then call processUser() directly so tests
 * are deterministic with no waits.
 *
 * Debounce bypass: clear _lastEnqueueTime for the user before calling processUser()
 * so the 2-second quiet-period guard is satisfied.
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
const { enqueueScheduleRun, processUser, stopPollLoop, _lastEnqueueTime } = require('../src/scheduler/scheduleQueue');
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

/** Clear the debounce timestamp so processUser() won't bail early. */
function clearDebounce(userId) {
  if (_lastEnqueueTime && typeof _lastEnqueueTime.delete === 'function') {
    _lastEnqueueTime.delete(userId);
  }
}

describe('scheduleQueue', () => {
  test('enqueue triggers scheduler run', async () => {
    if (!dbAvailable) return;
    await enqueueScheduleRun('user1', 'test');
    clearDebounce('user1');
    await processUser('user1');
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(1);
    // runScheduleAndPersist is called with (userId, source)
    expect(runScheduleAndPersist).toHaveBeenCalledWith('user1', expect.anything());
  });

  test('different users run independently', async () => {
    if (!dbAvailable) return;
    await enqueueScheduleRun('userA', 'test');
    await enqueueScheduleRun('userB', 'test');
    clearDebounce('userA');
    clearDebounce('userB');
    await processUser('userA');
    await processUser('userB');
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(2);
  });

  test('error in scheduler is caught (does not crash)', async () => {
    if (!dbAvailable) return;
    runScheduleAndPersist.mockRejectedValue(new Error('DB connection lost'));
    await enqueueScheduleRun('user_err', 'test');
    clearDebounce('user_err');
    // Should not throw
    await expect(processUser('user_err')).resolves.not.toThrow();
    // runScheduleAndPersist was attempted
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(1);
  });

  test('withLock not firing callback skips scheduler run', async () => {
    // When withLock resolves without calling fn (lock never acquired),
    // runScheduleAndPersist is not called and processUser returns without crashing.
    if (!dbAvailable) return;
    withLock.mockResolvedValue(null); // lock callback never invoked
    await enqueueScheduleRun('user_locked', 'test');
    clearDebounce('user_locked');
    await expect(processUser('user_locked')).resolves.not.toThrow();
    // Scheduler was not run because the lock never fired the callback
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(0);
  });

  test('lock fires callback on first try and scheduler runs', async () => {
    if (!dbAvailable) return;
    // withLock immediately invokes the callback (normal success path)
    withLock.mockImplementation(async function(userId, fn) {
      return fn();
    });
    await enqueueScheduleRun('user_retry', 'test');
    clearDebounce('user_retry');
    await processUser('user_retry');
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(1);
  });
});
