/**
 * Tests for scheduleQueue.js — event queue, single-flight, retry, error handling.
 */

jest.mock('../src/scheduler/runSchedule', () => ({
  runScheduleAndPersist: jest.fn()
}));

jest.mock('../src/lib/sync-lock', () => ({
  withLock: jest.fn()
}));

const { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
const { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
const { withLock } = require('../src/lib/sync-lock');

beforeEach(() => {
  runScheduleAndPersist.mockReset();
  runScheduleAndPersist.mockResolvedValue({ updated: 5, cleared: 2 });
  withLock.mockReset();
  withLock.mockImplementation(async function(userId, fn) { return fn(); });
});

describe('scheduleQueue', () => {
  test('enqueue triggers scheduler run', async () => {
    jest.spyOn(console, 'log').mockImplementation();
    enqueueScheduleRun('user1', 'test');
    await new Promise(r => setTimeout(r, 100));
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(1);
    console.log.mockRestore();
  });

  test('different users run independently', async () => {
    jest.spyOn(console, 'log').mockImplementation();
    enqueueScheduleRun('userA', 'test');
    enqueueScheduleRun('userB', 'test');
    await new Promise(r => setTimeout(r, 200));
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(2);
    console.log.mockRestore();
  });

  test('error in scheduler is caught (does not crash)', async () => {
    runScheduleAndPersist.mockRejectedValue(new Error('DB connection lost'));
    var errSpy = jest.spyOn(console, 'error').mockImplementation();
    var logSpy = jest.spyOn(console, 'log').mockImplementation();
    enqueueScheduleRun('user_err', 'test');
    await new Promise(r => setTimeout(r, 200));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[SCHED-QUEUE]'), expect.any(Error));
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  test('lock contention retries up to 3 times', async () => {
    withLock.mockResolvedValue(null); // always fail to acquire
    var warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    var logSpy = jest.spyOn(console, 'log').mockImplementation();
    enqueueScheduleRun('user_locked', 'test');
    // Wait for 3 retries × 2s each
    await new Promise(r => setTimeout(r, 7500));
    expect(withLock).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not acquire lock'));
    warnSpy.mockRestore();
    logSpy.mockRestore();
  }, 10000);

  test('lock acquired on retry succeeds', async () => {
    var callCount = 0;
    withLock.mockImplementation(async function(userId, fn) {
      callCount++;
      if (callCount < 3) return null; // fail first 2
      return fn(); // succeed on 3rd
    });
    var logSpy = jest.spyOn(console, 'log').mockImplementation();
    enqueueScheduleRun('user_retry', 'test');
    await new Promise(r => setTimeout(r, 6000));
    expect(runScheduleAndPersist).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  }, 10000);
});
