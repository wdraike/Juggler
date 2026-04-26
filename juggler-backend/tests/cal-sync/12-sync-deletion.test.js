/**
 * 12-sync-deletion.test.js — Deletion Scenarios
 *
 * Tests miss_count-based deletion, Strive->Calendar deletion,
 * ingest-only delete protection, and dependency transfer.
 */

jest.setTimeout(60000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var { sync } = require('../../src/controllers/cal-sync.controller');
var { deleteTask } = require('../../src/controllers/task.controller');
var {
  db, TEST_USER_ID, isDbAvailable, hasGCalCredentials,
  seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes, getGCalToken
} = require('./helpers/test-setup');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, makeTaskId, makeLedgerRow, deleteGCalEvent } = require('./helpers/test-fixtures');
var { getGCalEvent, waitForPropagation } = require('./helpers/api-helpers');

var user;
var gcalToken;
var createdGCalEventIds = [];

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  user = await seedTestUser();
  gcalToken = await getGCalToken();
});

afterEach(async () => {
  if (!await isDbAvailable()) return;
  if (gcalToken) {
    for (var id of createdGCalEventIds) {
      await deleteGCalEvent(gcalToken, id);
    }
  }
  createdGCalEventIds = [];
  await cleanupTestData();
});

afterAll(async () => {
  if (!await isDbAvailable()) return;
  await destroyTestUser();
  await db.destroy();
});

function skipIfNoDB(fn) {
  return async () => {
    if (!await isDbAvailable()) return;
    await fn();
  };
}

function tomorrow(hours, minutes) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hours || 10, minutes || 0, 0, 0);
  return d;
}

describe('Sync Deletion Scenarios', () => {

  test('event deleted from GCal: miss_count increments', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    // Create task + push it to get an event
    var task = await makeTask({
      text: 'Test Task Miss Count',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    var eventId = ledger.provider_event_id;
    expect(eventId).toBeTruthy();

    // Delete event from GCal
    await deleteGCalEvent(gcalToken, eventId);
    await waitForPropagation(1000);

    // Reload user between syncs
    user = await db('users').where('id', TEST_USER_ID).first();

    // Sync again — miss_count should increment
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var ledgerAfter = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' }).first();
    expect(ledgerAfter).toBeTruthy();
    expect(ledgerAfter.miss_count).toBe(1);

    // Task should still exist
    var taskStill = await db('tasks_v').where('id', task.id).first();
    expect(taskStill).toBeTruthy();
  }));

  test('after 3 syncs with event deleted: task deleted', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var task = await makeTask({
      text: 'Test Task 3x Miss Delete',
      scheduled_at: tomorrow(11, 0),
      dur: 30,
      when: 'morning'
    });

    // Push
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    var eventId = ledger.provider_event_id;

    // Delete event from GCal
    await deleteGCalEvent(gcalToken, eventId);
    await waitForPropagation(1000);

    // Save ledger ID before the deletion loop — the controller nulls task_id
    // on deleted_remote, so we cannot query by task_id afterward.
    var ledgerId = ledger.id;

    // Sync 3 times (MISS_THRESHOLD = 3)
    for (var i = 0; i < 3; i++) {
      user = await db('users').where('id', TEST_USER_ID).first();
      req = mockReq(user);
      res = mockRes();
      await sync(req, res);
    }

    // Task should be deleted
    var taskGone = await db('tasks_v').where('id', task.id).first();
    expect(taskGone).toBeFalsy();

    // Ledger should be marked deleted_remote (task_id is nulled by controller)
    var ledgerAfter = await db('cal_sync_ledger').where('id', ledgerId).first();
    expect(ledgerAfter).toBeTruthy();
    expect(ledgerAfter.status).toBe('deleted_remote');
  }));

  test('task deleted from Strive: event deleted from GCal', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var task = await makeTask({
      text: 'Test Task Delete From Strive',
      scheduled_at: tomorrow(12, 0),
      dur: 30,
      when: 'morning'
    });

    // Push
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    var eventId = ledger.provider_event_id;
    expect(eventId).toBeTruthy();

    // Delete task from DB
    await tasksWrite.deleteTaskById(db, task.id, TEST_USER_ID);

    // Reload user between syncs
    user = await db('users').where('id', TEST_USER_ID).first();

    // Sync again — event should be deleted from GCal
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    expect(res._json.deleted_local).toBeGreaterThanOrEqual(1);

    // Verify event is gone from GCal
    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, eventId);
    // Event should be null or cancelled
    expect(!event || event.status === 'cancelled').toBeTruthy();
  }));

  test('ingest-only: task deletion blocked', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    // Set ingest-only mode
    await db('user_config').insert({
      user_id: TEST_USER_ID,
      config_key: 'cal_sync_settings',
      config_value: JSON.stringify({ gcal: { mode: 'ingest' } })
    });

    // Create a task that looks like it came from a provider. Insert a ledger
    // entry so the ingest guard recognises the linkage.
    var task = await makeTask({
      text: 'Test Task Ingest Delete Block',
      scheduled_at: tomorrow(13, 0),
      dur: 30,
      when: 'fixed'
    });
    await db('cal_sync_ledger').insert({
      user_id: TEST_USER_ID, provider: 'gcal', task_id: task.id,
      provider_event_id: 'fake-event-id-ingest-test', origin: 'gcal',
      status: 'active', synced_at: db.fn.now(), created_at: db.fn.now()
    });

    // Try to delete via task controller
    var delReq = mockReq(user, {
      params: { id: task.id }
    });
    var delRes = mockRes();
    await deleteTask(delReq, delRes);

    expect(delRes.statusCode).toBe(403);
    expect(delRes._json.code).toBe('INGEST_DELETE_BLOCKED');

    // Task should still exist
    var taskStill = await db('tasks_v').where('id', task.id).first();
    expect(taskStill).toBeTruthy();
  }));

  test('dependency transfer on deletion', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    // Create taskB (will be deleted) and taskA (depends on taskB)
    var taskB = await makeTask({
      id: makeTaskId('depB'),
      text: 'Test Task DepB',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      when: 'morning'
    });
    var taskA = await makeTask({
      id: makeTaskId('depA'),
      text: 'Test Task DepA',
      scheduled_at: tomorrow(11, 0),
      dur: 30,
      when: 'morning',
      depends_on: JSON.stringify([taskB.id])
    });

    // Push taskB
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledgerB = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: taskB.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledgerB).toBeTruthy();
    var eventId = ledgerB.provider_event_id;

    // Delete event from GCal
    await deleteGCalEvent(gcalToken, eventId);
    await waitForPropagation(1000);

    // Sync 3 times to trigger deletion (MISS_THRESHOLD = 3)
    for (var i = 0; i < 3; i++) {
      user = await db('users').where('id', TEST_USER_ID).first();
      req = mockReq(user);
      res = mockRes();
      await sync(req, res);
    }

    // taskB should be deleted
    var taskBGone = await db('tasks_v').where('id', taskB.id).first();
    expect(taskBGone).toBeFalsy();

    // taskA should have its depends_on updated (taskB removed)
    var taskAUpdated = await db('tasks_v').where('id', taskA.id).first();
    expect(taskAUpdated).toBeTruthy();
    var depsRaw = taskAUpdated.depends_on;
    var deps = [];
    if (depsRaw) {
      try { deps = JSON.parse(depsRaw); } catch (e) { deps = []; }
    }
    expect(deps).not.toContain(taskB.id);
  }), 120000);

  test('event outside sync window NOT counted as miss', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    // Push a real task first so the ledger has the correct last_pushed_hash.
    // Without it the controller treats the entry as stale and tries to recreate
    // the event rather than checking the sync window.
    var task = await makeTask({
      text: 'Test Task Outside Window',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    var eventId = ledger.provider_event_id;
    createdGCalEventIds.push(eventId);

    // Delete the real event and backdate event_start so it looks like
    // it was scheduled far outside the 14-day sync window.
    await deleteGCalEvent(gcalToken, eventId);
    var farPast = new Date();
    farPast.setDate(farPast.getDate() - 30);
    await db('cal_sync_ledger').where('id', ledger.id).update({
      event_start: farPast.toISOString()
    });

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    // miss_count should stay 0 because cached event_start is outside sync window
    var ledgerAfter = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' }).first();
    expect(ledgerAfter).toBeTruthy();
    expect(ledgerAfter.miss_count).toBe(0);
  }));

});
