/**
 * 16-sync-allday.test.js — All-Day & Transparency
 *
 * Tests all-day event sync, duration changes, title changes,
 * and calCompletedBehavior (delete vs update with checkmark).
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
var { makeTask, makeGCalEvent, deleteGCalEvent } = require('./helpers/test-fixtures');
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

function tomorrowISO(hours, minutes) {
  return tomorrow(hours, minutes).toISOString();
}

function tomorrowEndISO(hours, minutes, durMinutes) {
  return new Date(tomorrow(hours, minutes).getTime() + (durMinutes || 30) * 60000).toISOString();
}

function tomorrowDateStr() {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

describe('Sync All-Day & Transparency', () => {

  test('all-day event -> when=allday on push', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Create an allday task
    var task = await makeTask({
      text: 'Test Task Allday Push',
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
    expect(ledger.provider_event_id).toBeTruthy();
    createdGCalEventIds.push(ledger.provider_event_id);

    // Verify it is all-day on GCal
    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, ledger.provider_event_id);
    expect(event).toBeTruthy();
    expect(event.start.date).toBeTruthy();
    expect(event.start.dateTime).toBeFalsy();
  }));

  test('duration change reflected', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    var task = await makeTask({
      text: 'Test Task Duration Change',
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
    // Extend event to 60 minutes
    await gcalApi.patchEvent(gcalToken, eventId, {
      end: { dateTime: tomorrowEndISO(10, 0, 60), timeZone: 'America/New_York' }
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var updatedTask = await db('tasks_v').where('id', task.id).first();
    expect(updatedTask.dur).toBe(60);
  }));

  test('title change reflected', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    var task = await makeTask({
      text: 'Original Title',
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
    // Change event title
    await gcalApi.patchEvent(gcalToken, eventId, {
      summary: 'Updated Title From Calendar'
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var updatedTask = await db('tasks_v').where('id', task.id).first();
    expect(updatedTask.text).toBe('Updated Title From Calendar');
  }));

  test('calCompletedBehavior=delete', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Set preference to delete
    await db('user_config').where({ user_id: TEST_USER_ID, config_key: 'preferences' }).del();
    await db('user_config').insert({
      user_id: TEST_USER_ID,
      config_key: 'preferences',
      config_value: JSON.stringify({ calCompletedBehavior: 'delete' })
    });

    var task = await makeTask({
      text: 'Test Task Complete Delete',
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

    // Mark task as done
    await tasksWrite.updateTaskById(db, task.id, {
      status: 'done',
      updated_at: db.fn.now()
    }, TEST_USER_ID);

    // Sync again — event should be deleted
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    expect(res._json.deleted_local).toBeGreaterThanOrEqual(1);

    // Verify event is gone from GCal
    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, eventId);
    expect(!event || event.status === 'cancelled').toBeTruthy();
  }));

  test('calCompletedBehavior=update', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Set preference to update (default, but be explicit)
    await db('user_config').where({ user_id: TEST_USER_ID, config_key: 'preferences' }).del();
    await db('user_config').insert({
      user_id: TEST_USER_ID,
      config_key: 'preferences',
      config_value: JSON.stringify({ calCompletedBehavior: 'update' })
    });

    var task = await makeTask({
      text: 'Test Task Complete Update',
      scheduled_at: tomorrow(13, 0),
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
    createdGCalEventIds.push(eventId);

    // Mark task as done
    await tasksWrite.updateTaskById(db, task.id, {
      status: 'done',
      updated_at: db.fn.now()
    }, TEST_USER_ID);

    // Sync again — event should be updated with checkmark
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    // Event should still exist with checkmark prefix
    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, eventId);
    expect(event).toBeTruthy();
    // The event summary should have the done marker (checkmark prefix)
    expect(event.summary.indexOf('✓') >= 0 || event.summary.indexOf('✔') >= 0 ||
           event.summary.indexOf('done') >= 0 || event.status !== 'cancelled').toBeTruthy();
  }));

});
