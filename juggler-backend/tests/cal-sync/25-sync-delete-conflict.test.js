/**
 * 25-sync-delete-conflict.test.js — 999.5270
 *
 * Direction (i): a user completing/editing a task WHILE a sync is running
 * must not be silently discarded by that same sync run.
 *
 * ROOT CAUSE (found by reading, not assumed): runSyncWritePhase's conflict
 * detection (slices/calendar/facade.js ~1640-1665) builds `freshById` and
 * `conflictSkipIds` ONLY from `taskUpdates` ids:
 *
 *   var taskIdsToCheck = taskUpdates.map(function(u) { return u.id; });
 *
 * `taskDeletes` (the miss-ladder's "event confirmed gone after
 * MISS_THRESHOLD consecutive syncs" outcome — missing-event-decision.js)
 * is applied in the SAME transaction with NO freshness check at all:
 *
 *   for (var wd = 0; wd < taskDeletes.length; wd++) {
 *     ... await taskRepo.tasksWrite.deleteTaskById(trx, del.id, userId);
 *   }
 *
 * So if a user completes a task at the exact moment a sync run has already
 * decided (from its Phase-1 snapshot) to delete that task because the
 * provider event has been missing for MISS_THRESHOLD consecutive syncs, the
 * completion is discarded and the task is deleted anyway — the classic
 * last-writer-wins-on-a-stale-read failure, just for DELETE instead of
 * UPDATE. Contrast with taskUpdates, which IS protected (BF-7 test in
 * 23-sync-consistency.test.js, and the "mid-sync task edit detected by
 * watermark" test in 20-sync-lock.test.js).
 */
jest.setTimeout(60000);
jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

jest.mock('../../src/lib/sync-lock', () => {
  var actual = jest.requireActual('../../src/lib/sync-lock');
  return Object.assign({}, actual, {
    acquireLock: jest.fn(function(userId) { return actual.acquireLock(userId); }),
    releaseLock: jest.fn(function(userId, token) { return actual.releaseLock(userId, token); }),
    refreshLock: jest.fn(function(userId, token) { return actual.refreshLock(userId, token); })
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

var GCAL_ONLY = {
  gcal_refresh_token: 'mock-gcal-token',
  msft_cal_refresh_token: null, apple_cal_username: null,
  apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null
};
var MISS_THRESHOLD = 3;

beforeAll(async () => {
  await assertDbAvailable();
  await destroyTestUser();
});

afterEach(async () => {
  jest.restoreAllMocks();
  if (await isDbAvailable()) await cleanupTestData();
});

afterAll(async () => {
  if (await isDbAvailable()) await destroyTestUser();
  await db.destroy();
});

describe('999.5270: task completed mid-sync must survive a concurrent miss-ladder delete', () => {
  it('does not delete a task that was completed WHILE the sync that decided to delete it was still running', async () => {
    await assertDbAvailable();
    var user = await seedTestUser(GCAL_ONLY);

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    var task = await makeTask({
      user_id: user.id,
      text: '999.5270 Delete-Conflict Task',
      scheduled_at: tomorrow,
      dur: 30,
      when: 'morning',
      status: ''
    });

    // Establish a real, correctly-hashed ledger row via a normal push sync —
    // avoids hand-writing last_pushed_hash/last_user_hash (999.4671 trap).
    jest.spyOn(gcalAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
    jest.spyOn(gcalAdapter, 'listEvents').mockResolvedValueOnce([]);
    var createdRaw = {
      id: 'gcal-evt-999-5270',
      summary: task.text,
      start: { dateTime: tomorrow.toISOString() },
      end: { dateTime: new Date(tomorrow.getTime() + 30 * 60000).toISOString() }
    };
    jest.spyOn(gcalAdapter, 'batchCreateEvents').mockImplementationOnce(async function(_token, pairs) {
      return pairs.map(function(p) {
        return { taskId: p.task.id, providerEventId: createdRaw.id, raw: createdRaw, error: null };
      });
    });

    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);
    expect(res1.statusCode).toBe(200);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    expect(ledger.miss_count).toBe(0);

    // Fast-forward the miss ladder to one short of the delete threshold, as
    // if the provider event had already been missing for MISS_THRESHOLD-1
    // prior syncs. event_start is already within the sync window (it was set
    // from the real push above).
    await db('cal_sync_ledger').where('id', ledger.id).update({ miss_count: MISS_THRESHOLD - 1 });

    // A second, unledgered task so Phase 3 (push) has something to push —
    // gives us a Phase-3 hook point that runs strictly AFTER the Phase-1
    // snapshot (gatherProviderSyncData reads tasks/ledger, THEN Phase 2
    // decides the delete for `task` from that snapshot) and strictly BEFORE
    // the write-phase's freshById conflict check (which runs after Phase 3).
    var trigger = await makeTask({
      user_id: user.id,
      text: '999.5270 Push Trigger Task',
      scheduled_at: new Date(tomorrow.getTime() + 2 * 3600000),
      dur: 30,
      when: 'morning',
      status: ''
    });

    // Second sync: event is (still) missing on the provider — this is the
    // sync run that will decide to delete `task`. Hook batchCreateEvents
    // (Phase 3, after the Phase-1 snapshot and the Phase-2 delete decision,
    // before the write-phase conflict check) to simulate the user completing
    // `task` WHILE this sync is in flight — same technique as the BF-7
    // mid-sync mutation test in 23-sync-consistency.test.js.
    jest.spyOn(gcalAdapter, 'listEvents').mockResolvedValueOnce([]);
    jest.spyOn(gcalAdapter, 'batchCreateEvents').mockImplementationOnce(async function(_token, pairs) {
      // updated_at column is second-granularity (MySQL TIMESTAMP) and this
      // whole request runs well under 1s, so a bare `new Date()` can collide
      // with the Phase-1 snapshot's second and falsely look "not newer".
      // Push it visibly into the future — same technique the existing
      // "mid-sync task edit detected by watermark" test
      // (20-sync-lock.test.js) uses for the same reason.
      await tasksWrite.updateTaskById(db, task.id, {
        status: 'done', completed_at: new Date(), updated_at: new Date(Date.now() + 60000)
      }, TEST_USER_ID);
      return pairs.map(function(p) {
        return {
          taskId: p.task.id, providerEventId: 'gcal-evt-999-5270-trigger',
          raw: {
            id: 'gcal-evt-999-5270-trigger', summary: p.task.text,
            start: { dateTime: trigger.scheduled_at ? new Date(trigger.scheduled_at).toISOString() : new Date().toISOString() },
            end: { dateTime: new Date(Date.now() + 3600000).toISOString() }
          },
          error: null
        };
      });
    });

    user = await db('users').where('id', TEST_USER_ID).first();
    var req2 = mockReq(user);
    var res2 = mockRes();
    await sync(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(gcalAdapter.batchCreateEvents).toHaveBeenCalled();

    // The concurrent completion must survive: the task must still exist and
    // still be 'done' — not deleted out from under the user by a sync that
    // decided based on a stale (pre-edit) snapshot.
    var taskAfter = await db('tasks_v').where('id', task.id).first();
    expect(taskAfter).toBeTruthy();
    expect(taskAfter.status).toBe('done');
  });
});
