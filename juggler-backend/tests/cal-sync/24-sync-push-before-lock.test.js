/**
 * 24-sync-push-before-lock.test.js — 999.1457
 *
 * Bug: cal-sync push phase (Phase 3) runs BEFORE the sync lock is acquired.
 * A 409 lock-contention sync has already created remote calendar events
 * whose ledger inserts are then discarded — orphan remote events until
 * next sync's dedup.
 *
 * This test verifies that when the lock is already held (simulating
 * contention), sync() returns 409 WITHOUT calling createEvent on any
 * provider — no orphan remote events.
 */
jest.setTimeout(120000);
jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

// Mock sync-lock at module level so the facade's re-exported acquireLock
// is also intercepted. Same pattern as 23-sync-consistency.test.js.
jest.mock('../../src/lib/sync-lock', () => {
  var actual = jest.requireActual('../../src/lib/sync-lock');
  return Object.assign({}, actual, {
    acquireLock: jest.fn(function(userId) {
      return actual.acquireLock(userId);
    }),
    releaseLock: jest.fn(function(userId, token) {
      return actual.releaseLock(userId, token);
    }),
    refreshLock: jest.fn(function(userId, token) {
      return actual.refreshLock(userId, token);
    })
  });
});

var {
  db, TEST_USER_ID, isDbAvailable, seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes
} = require('./helpers/test-setup');
var { assertDbAvailable } = require('../helpers/requireDB');
var { makeTask } = require('./helpers/test-fixtures');
var { sync } = require('../../src/controllers/cal-sync.controller');
var syncLock = require('../../src/lib/sync-lock'); // mocked — used for mockImplementation per-test
var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');

var GCAL_ONLY = {
  gcal_refresh_token: 'mock-gcal-token',
  msft_cal_refresh_token: null, apple_cal_username: null,
  apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null
};

beforeAll(async () => {
  await assertDbAvailable();
  await destroyTestUser();
});

afterEach(async () => {
  // Reset acquireLock to the real implementation after each test
  var actual = jest.requireActual('../../src/lib/sync-lock');
  syncLock.acquireLock.mockImplementation(function(userId) {
    return actual.acquireLock(userId);
  });
  jest.restoreAllMocks();
  if (await isDbAvailable()) {
    await db('sync_locks').where('user_id', TEST_USER_ID).del();
    await cleanupTestData();
  }
});

afterAll(async () => {
  await destroyTestUser();
  await db.destroy();
});

describe('999.1457: push phase must not run before lock acquisition', () => {
  it('when lock is held by another caller, sync returns 409 and does NOT call createEvent', async () => {
    await assertDbAvailable();
    var user = await seedTestUser(GCAL_ONLY);

    // Create a task that would be pushed (unledgered, future, has time)
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    await makeTask({
      text: 'Push-Before-Lock Test Task',
      scheduled_at: tomorrow,
      dur: 30,
      when: 'morning'
    });

    // Mock gcal adapter so sync() can gather + push without real API calls.
    jest.spyOn(gcalAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
    jest.spyOn(gcalAdapter, 'listEvents').mockResolvedValue([]);
    jest.spyOn(gcalAdapter, 'hasChanges').mockResolvedValue({ hasChanges: false });
    var createEventSpy = jest.spyOn(gcalAdapter, 'createEvent').mockResolvedValue({
      providerEventId: 'evt-mock-' + Date.now(), raw: {}
    });
    var batchCreateSpy = jest.spyOn(gcalAdapter, 'batchCreateEvents').mockImplementation(
      async function(_token, pairs) {
        return pairs.map(function(p) {
          return { taskId: p.task.id, providerEventId: 'evt-batch-' + p.task.id, raw: {} };
        });
      }
    );

    // Override acquireLock to always return not-acquired — simulates a lock
    // held by a concurrent sync. The module-level jest.mock ensures the
    // facade's re-exported acquireLock is the same mocked function.
    syncLock.acquireLock.mockImplementation(function() {
      return Promise.resolve({ acquired: false });
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    // sync() should return 409 (lock_busy)
    expect(res.statusCode).toBe(409);

    // CRITICAL: neither push method must have been called — no orphan remote events
    expect(batchCreateSpy).not.toHaveBeenCalled();
    expect(createEventSpy).not.toHaveBeenCalled();
  });
});