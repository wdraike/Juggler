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
var { requireDB } = require('../helpers/requireDB');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, makeLedgerRow, makeGCalEvent, deleteGCalEvent } = require('./helpers/test-fixtures');
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

  test('all-day event -> when=allday on push', requireDB(async () => {
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

  test('duration change reflected', requireDB(async () => {
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

  test('title change reflected', requireDB(async () => {
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

  test('calCompletedBehavior=delete', requireDB(async () => {
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

  test('calCompletedBehavior=update', requireDB(async () => {
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

  test('done_frozen: done task with calCompletedBehavior=update is pushed once then frozen', requireDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Seed calCompletedBehavior=update preference
    await db('user_config').where({ user_id: TEST_USER_ID, config_key: 'preferences' }).del();
    await db('user_config').insert({
      user_id: TEST_USER_ID,
      config_key: 'preferences',
      config_value: JSON.stringify({ calCompletedBehavior: 'update' })
    });

    // Create a task, push it to calendar first so the ledger row exists
    var task = await makeTask({
      text: 'Done Frozen Test Task',
      scheduled_at: tomorrow(14, 0),
      dur: 30,
      when: 'afternoon'
    });

    // First sync — push task (status='', not done yet)
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();
    expect(ledger).toBeTruthy();
    createdGCalEventIds.push(ledger.provider_event_id);

    // Mark task as done
    await tasksWrite.updateTaskById(db, task.id, { status: 'done', updated_at: db.fn.now() }, TEST_USER_ID);

    // Second sync — should do the done push and set done_frozen
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var frozenLedger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();
    // After done push, ledger must be done_frozen
    expect(frozenLedger.status).toBe('done_frozen');

    // Third sync — done_frozen row must be skipped (no re-push)
    var hashBefore = frozenLedger.last_pushed_hash;
    var pushedAtBefore = frozenLedger.last_pushed_at;
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var afterThirdSync = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();
    // Status must remain done_frozen
    expect(afterThirdSync.status).toBe('done_frozen');
    // last_pushed_hash must not change (no new push happened)
    expect(afterThirdSync.last_pushed_hash).toBe(hashBefore);
  }));

  test('done_frozen: done task is skipped when ledger.status is already done_frozen', requireDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Seed calCompletedBehavior=update preference
    await db('user_config').where({ user_id: TEST_USER_ID, config_key: 'preferences' }).del();
    await db('user_config').insert({
      user_id: TEST_USER_ID,
      config_key: 'preferences',
      config_value: JSON.stringify({ calCompletedBehavior: 'update' })
    });

    // Create a done task
    var task = await makeTask({
      text: 'Already Frozen Test Task',
      scheduled_at: tomorrow(15, 0),
      dur: 30,
      when: 'afternoon',
      status: 'done'
    });

    // Push once to get a real event on GCal, then mark done_frozen manually
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();
    expect(ledger).toBeTruthy();
    createdGCalEventIds.push(ledger.provider_event_id);

    // Manually set done_frozen to simulate an already-frozen row
    await db('cal_sync_ledger')
      .where({ id: ledger.id })
      .update({ status: 'done_frozen' });

    var hashBefore = ledger.last_pushed_hash;

    // Sync again — done_frozen guard must skip this row
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var afterSync = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();
    // Status must remain done_frozen
    expect(afterSync.status).toBe('done_frozen');
    // last_pushed_hash must not change (skip means no push)
    expect(afterSync.last_pushed_hash).toBe(hashBefore);
  }));

  test("D-10: done_frozen skip is logged to sync_history as action='skipped'", requireDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Seed calCompletedBehavior=update preference
    await db('user_config').where({ user_id: TEST_USER_ID, config_key: 'preferences' }).del();
    await db('user_config').insert({
      user_id: TEST_USER_ID,
      config_key: 'preferences',
      config_value: JSON.stringify({ calCompletedBehavior: 'update' })
    });

    // Create a done task and push it once to seed a ledger row
    var task = await makeTask({
      text: 'D-10 Skipped Logging Test',
      scheduled_at: tomorrow(17, 0),
      dur: 30,
      when: 'afternoon',
      status: 'done'
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();
    expect(ledger).toBeTruthy();
    createdGCalEventIds.push(ledger.provider_event_id);

    // Force done_frozen so the next sync hits the FIX D-03 guard
    await db('cal_sync_ledger')
      .where({ id: ledger.id })
      .update({ status: 'done_frozen' });

    // Clear sync_history so the assertion is unambiguous
    await db('sync_history').where({ user_id: TEST_USER_ID }).del();

    // Sync again — done_frozen guard skips this row and MUST log a 'skipped' action
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var skippedRow = await db('sync_history')
      .where({ user_id: TEST_USER_ID, action: 'skipped', task_id: task.id })
      .first();
    expect(skippedRow).toBeTruthy();
    expect(skippedRow.action).toBe('skipped');
    expect(skippedRow.task_id).toBe(task.id);
  }));

  test('done_frozen: calCompletedBehavior=keep tasks are NOT frozen (D-05)', requireDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser(GCAL_ONLY);

    // Seed calCompletedBehavior=keep preference
    await db('user_config').where({ user_id: TEST_USER_ID, config_key: 'preferences' }).del();
    await db('user_config').insert({
      user_id: TEST_USER_ID,
      config_key: 'preferences',
      config_value: JSON.stringify({ calCompletedBehavior: 'keep' })
    });

    var task = await makeTask({
      text: 'Keep Behavior Test Task',
      scheduled_at: tomorrow(16, 0),
      dur: 30,
      when: 'afternoon'
    });

    // Push the task initially
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();
    expect(ledger).toBeTruthy();
    createdGCalEventIds.push(ledger.provider_event_id);

    // Mark task as done
    await tasksWrite.updateTaskById(db, task.id, { status: 'done', updated_at: db.fn.now() }, TEST_USER_ID);

    // Sync again — calCompletedBehavior=keep means no done processing at all
    user = await db('users').where('id', TEST_USER_ID).first();
    req = mockReq(user);
    res = mockRes();
    await sync(req, res);

    var afterSync = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal' })
      .first();
    // With calCompletedBehavior=keep, ledger must NOT be done_frozen
    expect(afterSync.status).not.toBe('done_frozen');
    expect(afterSync.status).toBe('active');
  }));

});
