/**
 * 15-sync-ingest.test.js — One-Way (Ingest-Only) Sync
 *
 * Tests that ingest-only mode pulls events but never pushes tasks,
 * and that provider always wins conflicts.
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

async function setIngestOnly() {
  await db('user_config').insert({
    user_id: TEST_USER_ID,
    config_key: 'cal_sync_settings',
    config_value: JSON.stringify({ gcal: { mode: 'ingest' } })
  });
}

// SKIPPED: cal-sync integration tests need re-validation against the new
// two-table schema. Several tests inserted gcal_event_id directly on the task
// row (no longer a column post-refactor); that pattern needs migration to
// cal_sync_ledger inserts. Adapter unit tests (01/02/03) and the push test (10)
// continue to cover the underlying logic. TODO: re-enable per file.
describe.skip('Sync Ingest-Only Mode', () => {

  test('push phase skipped', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);
    await setIngestOnly();

    // Create a task in DB
    var task = await makeTask({
      text: 'Test Task Ingest No Push',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      when: 'morning'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res.statusCode).toBe(200);

    // Task should NOT have a gcal_event_id
    var updated = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(updated.gcal_event_id).toBeFalsy();

    // No events pushed
    var providerStats = res._json.providers && res._json.providers.gcal;
    if (providerStats) {
      expect(providerStats.pushed || 0).toBe(0);
    }
  }));

  test('events pulled as tasks', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);
    await setIngestOnly();

    // Create event on GCal
    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Ingest Pull',
      start: { dateTime: tomorrowISO(14, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(14, 0, 45), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);

    await waitForPropagation(1000);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res._json.pulled).toBeGreaterThanOrEqual(1);

    // Task should exist in DB
    var tasks = await db('tasks_with_sync_v')
      .where({ user_id: TEST_USER_ID, gcal_event_id: event.id });
    expect(tasks.length).toBe(1);
    expect(tasks[0].text).toBe('Test Event Ingest Pull');
  }));

  test('task edits NOT pushed back', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);
    await setIngestOnly();

    // Create event on GCal and pull it
    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Ingest No Pushback',
      start: { dateTime: tomorrowISO(15, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(15, 0, 30), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);

    await waitForPropagation(1000);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    // Edit task text in DB
    var task = await db('tasks_with_sync_v')
      .where({ user_id: TEST_USER_ID, gcal_event_id: event.id }).first();
    expect(task).toBeTruthy();

    await tasksWrite.updateTaskById(db, task.id, {
      text: 'Edited In Strive Should Not Push',
      updated_at: db.fn.now()
    }, TEST_USER_ID);

    // Sync again
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    // Verify GCal event still has original title
    await waitForPropagation(1000);
    var gcalEvent = await getGCalEvent(gcalToken, event.id);
    expect(gcalEvent).toBeTruthy();
    expect(gcalEvent.summary).toBe('Test Event Ingest No Pushback');
  }));

  test('conflict: provider always wins', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);
    await setIngestOnly();

    // Create event and pull it
    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Ingest Conflict',
      start: { dateTime: tomorrowISO(16, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(16, 0, 30), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);

    await waitForPropagation(1000);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var task = await db('tasks_with_sync_v')
      .where({ user_id: TEST_USER_ID, gcal_event_id: event.id }).first();
    expect(task).toBeTruthy();

    // Change both task and event
    await tasksWrite.updateTaskById(db, task.id, {
      text: 'Strive Conflict Version',
      updated_at: new Date()
    }, TEST_USER_ID);

    await gcalApi.patchEvent(gcalToken, event.id, {
      summary: 'Calendar Conflict Winner',
      start: { dateTime: tomorrowISO(16, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(16, 0, 30), timeZone: 'America/New_York' }
    });
    await waitForPropagation(1000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    // Provider should always win
    var taskAfter = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(taskAfter.text).toBe('Calendar Conflict Winner');
  }));

});
