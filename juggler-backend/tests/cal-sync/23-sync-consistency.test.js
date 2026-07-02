/**
 * 23-sync-consistency.test.js — Write-phase consistency checks
 *
 * BF-7: If a task is deleted between the API-phase snapshot (tasksById) and the
 * write-phase fresh-read (freshById), the conflict check must add it to
 * conflictSkipIds so updateTaskById is NOT called for that deleted row.
 *
 * Root cause (cal-sync.controller.js ~line 1984):
 *   if (origTask && freshById[tu.id]) { ... conflictSkipIds.add(tu.id); }
 * When freshById[tu.id] is undefined (task deleted mid-sync), the whole condition
 * is falsy, the task is NOT added to conflictSkipIds, and updateTaskById is
 * still called for a non-existent row.
 *
 * Fix: when origTask exists but freshById[tu.id] is missing, add to conflictSkipIds.
 *
 * Simulation:
 *   1. Create a task with no ledger row (so it lands in pushQueue → batchCreateEvents).
 *   2. Mock batchCreateEvents to: delete the task from DB, then return a success
 *      result. This causes taskUpdates.push({ id: task.id, fields: { gcal_event_id } })
 *      AFTER allTasks was already loaded (so origTask is truthy), but BEFORE the
 *      write-phase freshById query (so freshById[task.id] is undefined).
 *   3. Assert updateTaskById is NOT called for the deleted task's ID.
 */
jest.setTimeout(60000);
jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

// Mock sync-lock so the controller's destructured acquireLock binding
// is a jest.fn() we can override per-test with mockImplementation().
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
var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var tasksWrite = require('../../src/lib/tasks-write');
var syncLock = require('../../src/lib/sync-lock'); // mocked — used for mockImplementation per-test

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
  if (await isDbAvailable()) await cleanupTestData();
});

afterAll(async () => {
  if (await isDbAvailable()) await destroyTestUser();
  await db.destroy();
});

describe('BF-7: task deleted during API phase is skipped in write phase', () => {
  it('does not call updateTaskById for a task deleted mid-sync', async () => {
    await assertDbAvailable();

    var user = await seedTestUser(GCAL_ONLY);

    // 1. Create a task with no ledger row. This task will land in pushQueue
    //    (unpushed tasks) and batchCreateEvents will be called for it in the
    //    API phase. On success, the controller does:
    //      taskUpdates.push({ id: task.id, fields: { gcal_event_id: newEventId } })
    //    That entry is what the write-phase conflict check should skip when
    //    the task no longer exists in freshById.
    //
    //    Must be a future task with date + time so it isn't filtered out of pushQueue.
    var futureDate = new Date(Date.now() + 30 * 86400000); // ~30 days out, within 60-day window
    var task = await makeTask({
      user_id: user.id,
      text: 'BF-7 Test Task',
      scheduled_at: futureDate,
      dur: 30,
      when: 'morning',
      status: ''  // not terminal
    });

    // 2. Stub GCal adapter methods so no real API calls are made.
    jest.spyOn(gcalAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
    // listEvents: return empty (no existing events) so the task isn't "already synced"
    jest.spyOn(gcalAdapter, 'listEvents').mockResolvedValue([]);
    // batchUpdateEvents: not expected to be called in this flow (no existing events)
    jest.spyOn(gcalAdapter, 'batchUpdateEvents').mockResolvedValue([]);
    jest.spyOn(gcalAdapter, 'updateEvent').mockResolvedValue({});

    // 3. Mock batchCreateEvents to simulate the race condition:
    //    The task exists in allTasks (tasksById) when batchCreateEvents is called,
    //    but we delete it from the DB here so that the write-phase freshById query
    //    (which runs after batchCreateEvents returns) won't find it.
    jest.spyOn(gcalAdapter, 'batchCreateEvents').mockImplementation(async function(token, pairs) {
      // Delete the task after the API-phase snapshot (allTasks) was built,
      // so origTask is truthy but freshById[task.id] will be undefined.
      await db('task_instances').where('id', task.id).del();
      await db('task_masters').where('id', task.id).del();

      // Return a successful creation result so taskUpdates gets the entry.
      // Include a minimal raw object so normalizeEvent doesn't throw on null.
      return pairs.map(function(pair) {
        return {
          taskId: pair.task.id,
          providerEventId: 'gcal-new-event-bf7',
          raw: {
            id: 'gcal-new-event-bf7',
            summary: pair.task.text,
            start: { dateTime: '2026-07-01T14:00:00Z' },
            end: { dateTime: '2026-07-01T14:30:00Z' }
          },
          error: null
        };
      });
    });

    // 4. Spy on updateTaskById — BUG: it would be called for task.id;
    //    FIXED: it must NOT be called for task.id.
    var updateSpy = jest.spyOn(tasksWrite, 'updateTaskById');

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    // Proof that the push phase actually executed: batchCreateEvents was called
    // with our task, and sync() returned a response (not a no-op early exit).
    expect(gcalAdapter.batchCreateEvents).toHaveBeenCalled();
    expect(res._json).not.toBeNull();

    // Assert: updateTaskById was never called with the deleted task's ID.
    // Other tasks (e.g. dependency transfers) may be updated — only check this ID.
    var calledForDeletedTask = updateSpy.mock.calls.some(function(args) {
      // signature: updateTaskById(trx, id, fields, userId)
      return args[1] === task.id;
    });
    expect(calledForDeletedTask).toBe(false);
  });
});

describe('Concurrent sync lock: second sync gets 409', () => {
  it('second concurrent sync returns 409 when first holds lock', async () => {
    await assertDbAvailable();
    var user = await seedTestUser(GCAL_ONLY);

    // Stub GCal adapter so token validation succeeds and sync reaches the
    // write-phase lock acquisition. Without these, getValidAccessToken throws
    // on the mock token and sync returns 200 before ever trying to acquire a lock.
    jest.spyOn(gcalAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
    jest.spyOn(gcalAdapter, 'listEvents').mockResolvedValue([]);

    // Override acquireLock to always return not-acquired — simulates a lock
    // held by a concurrent sync. mockImplementation on the already-mocked
    // jest.fn() in sync-lock intercepts the controller's destructured binding.
    // Also shim global.setTimeout → 0ms so the 8-retry backoff (~40s real
    // time) completes instantly; restore it immediately after sync() returns.
    syncLock.acquireLock.mockImplementation(function() {
      return Promise.resolve({ acquired: false });
    });
    var _realSetTimeout = global.setTimeout;
    global.setTimeout = function(fn, _ms) { return _realSetTimeout(fn, 0); };

    var req = mockReq(user);
    var res = mockRes();
    try {
      await sync(req, res);
    } finally {
      global.setTimeout = _realSetTimeout;
    }

    // Controller returns 409 after MAX_LOCK_ATTEMPTS (8) failed acquires
    expect(res.statusCode).toBe(409);
  });
});

describe('Stale lock recovery: expired lock cleared on next sync', () => {
  it('sync succeeds after expired lock is cleared', async () => {
    await assertDbAvailable();
    var user = await seedTestUser(GCAL_ONLY);

    // Insert an expired lock (both acquired_at and expires_at are in the past).
    // acquireLock() runs: DELETE WHERE expires_at <= NOW() then INSERT — so the
    // expired row is swept atomically before the new lock is inserted.
    await db('sync_locks').insert({
      user_id: user.id,
      lock_token: 'expired-lock',
      acquired_at: new Date(Date.now() - 60000),
      expires_at: new Date(Date.now() - 30000)
    });

    jest.spyOn(gcalAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
    jest.spyOn(gcalAdapter, 'listEvents').mockResolvedValue([]);
    jest.spyOn(gcalAdapter, 'hasChanges').mockResolvedValue({ hasChanges: false });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res.statusCode).toBe(200);
    // Expired lock row must have been cleared by acquireLock's DELETE sweep
    var lock = await db('sync_locks').where({ user_id: user.id, lock_token: 'expired-lock' }).first();
    expect(lock).toBeUndefined();
  });
});
