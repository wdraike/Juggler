/**
 * 13-sync-conflict.test.js — Both Changed (Conflict Resolution)
 *
 * Tests conflict resolution when both task and event have changed
 * since last sync. Covers fixed-wins, last-modified, ingest-only,
 * and sync_history logging.
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

describe('Sync Conflict Resolution', () => {

  test('fixed task always wins', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Create a fixed task and push it
    var task = await makeTask({
      text: 'Test Task Fixed Wins',
      scheduled_at: tomorrow(10, 0),
      dur: 30,
      when: 'fixed',
      rigid: 1
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
    createdGCalEventIds.push(eventId);

    // Change BOTH: task text in DB + event title on GCal
    await tasksWrite.updateTaskById(db, task.id, {
      text: 'Fixed Task Updated In Strive',
      updated_at: db.fn.now()
    }, TEST_USER_ID);

    await gcalApi.patchEvent(gcalToken, eventId, {
      summary: 'Fixed Task Updated In Calendar',
      start: { dateTime: tomorrowISO(10, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(10, 0, 30), timeZone: 'America/New_York' }
    });
    await waitForPropagation(1000);

    // Sync — fixed task should win
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    // Event should have Strive's text
    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, eventId);
    expect(event).toBeTruthy();
    expect(event.summary).toBe('Fixed Task Updated In Strive');
  }));

  test('last-modified: task newer -> event updated', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Create a non-fixed task and push
    var task = await makeTask({
      text: 'Test Task Newer Wins',
      scheduled_at: tomorrow(11, 0),
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
    createdGCalEventIds.push(eventId);

    // Change event on GCal first (older)
    await gcalApi.patchEvent(gcalToken, eventId, {
      summary: 'Calendar Version Older',
      start: { dateTime: tomorrowISO(11, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(11, 0, 30), timeZone: 'America/New_York' }
    });

    // Wait, then change task in DB (newer)
    await waitForPropagation(1500);
    await tasksWrite.updateTaskById(db, task.id, {
      text: 'Strive Version Newer',
      updated_at: new Date()
    }, TEST_USER_ID);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    // Event should be updated to Strive's newer version
    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, eventId);
    expect(event).toBeTruthy();
    expect(event.summary).toBe('Strive Version Newer');
  }));

  test('last-modified: event newer -> task updated', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    var task = await makeTask({
      text: 'Original Text',
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

    // Wait > 2s so the patch timestamp exceeds last_modified_at (which is set to
    // event.lastModified + 2000ms on create to avoid false "externally modified" detections).
    await waitForPropagation(2500);

    // Change event title only — do NOT touch the task
    await gcalApi.patchEvent(gcalToken, eventId, {
      summary: 'Calendar Version Newer'
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var updatedTask = await db('tasks_v').where('id', task.id).first();
    expect(updatedTask.text).toBe('Calendar Version Newer');
  }));

  test('ingest-only: provider always wins', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Set ingest-only mode
    await db('user_config').insert({
      user_id: TEST_USER_ID,
      config_key: 'cal_sync_settings',
      config_value: JSON.stringify({ gcal: { mode: 'ingest' } })
    });

    // Create event on GCal first, then pull
    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Ingest Conflict',
      start: { dateTime: tomorrowISO(13, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(13, 0, 30), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);

    await waitForPropagation(1000);

    user = await db('users').where('id', TEST_USER_ID).first();
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    // Now find the pulled task via ledger
    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, provider_event_id: event.id, provider: 'gcal' })
      .whereIn('status', ['active', 'deleted_local', 'deleted_remote'])
      .first();
    expect(ledger).toBeTruthy();
    var pulledTask = await db('tasks_v').where('id', ledger.task_id).first();
    expect(pulledTask).toBeTruthy();

    await tasksWrite.updateTaskById(db, pulledTask.id, {
      text: 'Strive Edit Ingest',
      updated_at: new Date()
    }, TEST_USER_ID);

    await gcalApi.patchEvent(gcalToken, event.id, {
      summary: 'Calendar Edit Ingest',
      start: { dateTime: tomorrowISO(13, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(13, 0, 30), timeZone: 'America/New_York' }
    });
    await waitForPropagation(1000);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    // Provider should win in ingest-only mode
    var taskAfter = await db('tasks_v').where('id', pulledTask.id).first();
    expect(taskAfter.text).toBe('Calendar Edit Ingest');
  }));

  test('sync_history logs conflict_juggler or conflict_provider', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Non-fixed task so last-modified wins (not fixed-always-wins)
    var task = await makeTask({
      text: 'Conflict Test Task',
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

    // Wait > 2s so the patch timestamp exceeds last_modified_at (set to event.lastModified + 2000ms on create).
    await waitForPropagation(2500);

    // Change event on GCal (provider side)
    await gcalApi.patchEvent(gcalToken, eventId, {
      summary: 'Calendar Conflict Version'
    });
    // Wait, then change task in DB so both are modified
    await waitForPropagation(1500);
    await tasksWrite.updateTaskById(db, task.id, {
      text: 'Strive Conflict Version',
      updated_at: new Date()
    }, TEST_USER_ID);

    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var conflictRow = await db('sync_history')
      .where({ user_id: TEST_USER_ID })
      .whereIn('action', ['conflict_juggler', 'conflict_provider'])
      .first();
    expect(conflictRow).toBeTruthy();
  }));

});
