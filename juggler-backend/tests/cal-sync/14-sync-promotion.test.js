/**
 * 14-sync-promotion.test.js — Event Moves (Promotion)
 *
 * Tests that moving events on the calendar promotes tasks to fixed,
 * pins dates, tracks prev_when, and detects backward dependencies.
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
  db, TEST_USER_ID, isDbAvailable, hasGCalCredentials,
  seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes, getGCalToken, gcalApi
} = require('./helpers/test-setup');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, makeTaskId, deleteGCalEvent } = require('./helpers/test-fixtures');
var { getGCalEvent, waitForPropagation } = require('./helpers/api-helpers');

var GCAL_ONLY = { msft_cal_refresh_token: null, apple_cal_username: null, apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null };
var user;
var gcalToken;
var createdGCalEventIds = [];

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  user = await seedTestUser(GCAL_ONLY);
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

function dayAfterTomorrow(hours, minutes) {
  var d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(hours || 10, minutes || 0, 0, 0);
  return d;
}

function tomorrowISO(hours, minutes) {
  return tomorrow(hours, minutes).toISOString();
}

function tomorrowEndISO(hours, minutes, durMinutes) {
  return new Date(tomorrow(hours, minutes).getTime() + (durMinutes || 30) * 60000).toISOString();
}

function dayAfterISO(hours, minutes) {
  return dayAfterTomorrow(hours, minutes).toISOString();
}

function dayAfterEndISO(hours, minutes, durMinutes) {
  return new Date(dayAfterTomorrow(hours, minutes).getTime() + (durMinutes || 30) * 60000).toISOString();
}

describe('Sync Promotion: Event Moves', () => {

  test('event moved same day -> when=fixed', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    var task = await makeTask({
      text: 'Test Task Move Same Day',
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

    await waitForPropagation(2500); // ensure patch timestamp > last_modified_at (event.lastModified + 2000ms)
    // Move event to 3 PM same day
    await gcalApi.patchEvent(gcalToken, eventId, {
      start: { dateTime: tomorrowISO(15, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(15, 0, 30), timeZone: 'America/New_York' }
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var updatedTask = await db('tasks_v').where('id', task.id).first();
    expect(updatedTask.when).toBe('fixed');
    // scheduled_at is stored as UTC in MySQL and returned as "YYYY-MM-DD HH:MM:SS"
    var newSched = new Date(String(updatedTask.scheduled_at).replace(' ', 'T') + 'Z');
    var expected = tomorrow(15, 0);
    expect(Math.abs(newSched - expected)).toBeLessThan(2 * 60 * 1000);
  }));

  test('event moved different day -> fixed + date_pinned=1', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    var task = await makeTask({
      text: 'Test Task Move Different Day',
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

    await waitForPropagation(2500); // ensure patch timestamp > last_modified_at (event.lastModified + 2000ms)
    // Move event to day-after-tomorrow
    await gcalApi.patchEvent(gcalToken, eventId, {
      start: { dateTime: dayAfterISO(10, 0), timeZone: 'America/New_York' },
      end: { dateTime: dayAfterEndISO(10, 0, 30), timeZone: 'America/New_York' }
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var updatedTask = await db('tasks_v').where('id', task.id).first();
    expect(updatedTask.when).toBe('fixed');
    expect(updatedTask.date_pinned).toBeTruthy();
    var newSched = new Date(String(updatedTask.scheduled_at).replace(' ', 'T') + 'Z');
    var expected = dayAfterTomorrow(10, 0);
    expect(Math.abs(newSched - expected)).toBeLessThan(2 * 60 * 1000);
  }));

  test('all-day -> timed -> promoted', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Create all-day task
    var task = await makeTask({
      text: 'Test Task Allday Timed Promote',
      scheduled_at: tomorrow(0, 0),
      dur: 0,
      when: 'allday'
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

    await waitForPropagation(2500); // ensure patch timestamp > last_modified_at (event.lastModified + 2000ms)
    // Convert all-day event to timed at 2 PM — must also clear the 'date' field
    // GCal PATCH does a deep merge, so omitting 'date' leaves it set; null clears it
    await gcalApi.patchEvent(gcalToken, eventId, {
      start: { date: null, dateTime: tomorrowISO(14, 0), timeZone: 'America/New_York' },
      end: { date: null, dateTime: tomorrowEndISO(14, 0, 30), timeZone: 'America/New_York' }
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var updatedTask = await db('tasks_v').where('id', task.id).first();
    expect(updatedTask.when).toBe('fixed');
    var newSched = new Date(String(updatedTask.scheduled_at).replace(' ', 'T') + 'Z');
    var expected = tomorrow(14, 0);
    expect(Math.abs(newSched - expected)).toBeLessThan(2 * 60 * 1000);
  }));

  test('prev_when preserved', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    var task = await makeTask({
      text: 'Test Task Prev When',
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

    await waitForPropagation(2500); // ensure patch timestamp > last_modified_at (event.lastModified + 2000ms)
    // Move event to a different time
    await gcalApi.patchEvent(gcalToken, eventId, {
      start: { dateTime: tomorrowISO(15, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(15, 0, 30), timeZone: 'America/New_York' }
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var updatedTask = await db('tasks_v').where('id', task.id).first();
    expect(updatedTask.when).toBe('fixed');
    expect(updatedTask.prev_when).toBe('morning');
  }));

  test('backwardsDep warning', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // taskA is at 10 AM; taskB depends on taskA and is at 11 AM
    var taskA = await makeTask({
      text: 'Test Task Backward Dep A',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      when: 'morning'
    });
    var taskB = await makeTask({
      text: 'Test Task Backward Dep B',
      scheduled_at: tomorrow(11, 0),
      dur: 30,
      when: 'morning',
      depends_on: JSON.stringify([taskA.id])
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledgerA = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: taskA.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledgerA).toBeTruthy();
    createdGCalEventIds.push(ledgerA.provider_event_id);

    var ledgerB = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: taskB.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledgerB).toBeTruthy();
    createdGCalEventIds.push(ledgerB.provider_event_id);

    await waitForPropagation(2500); // ensure patch timestamp > last_modified_at (event.lastModified + 2000ms)
    // Move taskB's event to 9 AM — before taskA (its dependency at 10 AM)
    await gcalApi.patchEvent(gcalToken, ledgerB.provider_event_id, {
      start: { dateTime: tomorrowISO(9, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(9, 0, 30), timeZone: 'America/New_York' }
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    // taskB should be promoted to fixed
    var updatedB = await db('tasks_v').where('id', taskB.id).first();
    expect(updatedB.when).toBe('fixed');

    // sync_history should have a 'promoted' row for taskB with backward dep warning
    var historyRow = await db('sync_history')
      .where({ user_id: TEST_USER_ID, action: 'promoted' })
      .whereRaw('detail LIKE ?', ['%dependency%'])
      .first();
    expect(historyRow).toBeTruthy();
  }));

});
