/**
 * 10-sync-push.test.js — Strive to Calendar (Push) Tests
 *
 * Tests that tasks in the DB are correctly pushed as calendar events.
 * Uses real DB + real calendar APIs.
 */

jest.setTimeout(60000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var { sync } = require('../../src/controllers/cal-sync.controller');
var {
  db, TEST_USER_ID, isDbAvailable, hasGCalCredentials, hasMsftCredentials,
  seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes, getGCalToken, getMsftToken
} = require('./helpers/test-setup');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, makeTaskId } = require('./helpers/test-fixtures');
var { getGCalEvent, getMSFTEvent, waitForPropagation } = require('./helpers/api-helpers');
var { deleteGCalEvent, deleteMSFTEvent, deleteAllGCalTestEvents, deleteAllMSFTTestEvents } = require('./helpers/test-fixtures');

var user;
var gcalToken;
var msftToken;
var createdGCalEventIds = [];
var createdMSFTEventIds = [];

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  user = await seedTestUser();
  gcalToken = await getGCalToken();
  msftToken = await getMsftToken();
});

afterEach(async () => {
  if (!await isDbAvailable()) return;
  // Clean up created events
  if (gcalToken) {
    for (var id of createdGCalEventIds) {
      await deleteGCalEvent(gcalToken, id);
    }
  }
  if (msftToken) {
    for (var id of createdMSFTEventIds) {
      await deleteMSFTEvent(msftToken, id);
    }
  }
  createdGCalEventIds = [];
  createdMSFTEventIds = [];
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

describe('Sync Push: Strive -> Calendar', () => {

  test('new task with scheduled_at -> event created on GCal', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();
    var task = await makeTask({
      text: 'Test Task GCal Push',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.pushed).toBeGreaterThanOrEqual(1);

    // Verify task now has gcal_event_id
    var updated = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(updated.gcal_event_id).toBeTruthy();
    createdGCalEventIds.push(updated.gcal_event_id);

    // Verify event exists on GCal
    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, updated.gcal_event_id);
    expect(event).toBeTruthy();
    expect(event.summary).toBe('Test Task GCal Push');
  }));

  test('new task -> event created on MSFT', skipIfNoDB(async () => {
    if (!hasMsftCredentials()) return;
    user = await seedTestUser({ gcal_refresh_token: null });
    var task = await makeTask({
      text: 'Test Task MSFT Push',
      scheduled_at: tomorrow(11, 0),
      dur: 45,
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.pushed).toBeGreaterThanOrEqual(1);

    var updated = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(updated.msft_event_id).toBeTruthy();
    createdMSFTEventIds.push(updated.msft_event_id);

    await waitForPropagation(1000);
    var event = await getMSFTEvent(msftToken, updated.msft_event_id);
    expect(event).toBeTruthy();
    expect(event.subject).toBe('Test Task MSFT Push');
  }));

  test('done tasks NOT pushed', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();
    var task = await makeTask({
      text: 'Test Task Done',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      status: 'done',
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var updated = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(updated.gcal_event_id).toBeFalsy();
  }));

  test('recurring_template NOT pushed', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();
    var task = await makeTask({
      text: 'Test Recurring Template',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      task_type: 'recurring_template',
      recurring: 1,
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var updated = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(updated.gcal_event_id).toBeFalsy();
  }));

  test('task without scheduled_at NOT pushed', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();
    var task = await makeTask({
      text: 'Test Task No Date',
      scheduled_at: null,
      dur: 30,
      when: ''
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var updated = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(updated.gcal_event_id).toBeFalsy();
  }));

  test('past task NOT pushed', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();
    var pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5);
    pastDate.setHours(10, 0, 0, 0);

    var task = await makeTask({
      text: 'Test Task Past',
      scheduled_at: pastDate,
      dur: 30,
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var updated = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(updated.gcal_event_id).toBeFalsy();
  }));

  test('batch push of 5+ tasks', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();
    var tasks = [];
    for (var i = 0; i < 5; i++) {
      var t = await makeTask({
        text: 'Test Task Batch ' + i,
        scheduled_at: tomorrow(9 + i, 0),
        dur: 30,
        when: 'morning'
      });
      tasks.push(t);
    }

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.pushed).toBeGreaterThanOrEqual(5);

    for (var j = 0; j < tasks.length; j++) {
      var updated = await db('tasks_with_sync_v').where('id', tasks[j].id).first();
      expect(updated.gcal_event_id).toBeTruthy();
      createdGCalEventIds.push(updated.gcal_event_id);
    }
  }));

  test('ledger entry created after push', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();
    var task = await makeTask({
      text: 'Test Task Ledger Check',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var updated = await db('tasks_with_sync_v').where('id', task.id).first();
    createdGCalEventIds.push(updated.gcal_event_id);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();

    expect(ledger).toBeTruthy();
    expect(ledger.origin).toBe('juggler');
    expect(ledger.provider_event_id).toBe(updated.gcal_event_id);
    expect(ledger.status).toBe('active');
    expect(ledger.last_pushed_hash).toBeTruthy();
  }));

});
