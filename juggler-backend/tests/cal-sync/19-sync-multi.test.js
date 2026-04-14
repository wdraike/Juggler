/**
 * 19-sync-multi.test.js — Multi-Provider Sync
 *
 * Tests that tasks sync to BOTH GCal and MSFT when both are connected,
 * and that changes on one provider propagate through the task to the other.
 *
 * Requires both GCal AND MSFT credentials in .env.test.
 */

jest.setTimeout(60000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var {
  db, TEST_USER_ID, isDbAvailable, hasGCalCredentials, hasMsftCredentials,
  seedTestUser, cleanupTestData, destroyTestUser,
  getGCalToken, getMsftToken, mockReq, mockRes, gcalApi
} = require('./helpers/test-setup');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, deleteAllGCalTestEvents, deleteAllMSFTTestEvents } = require('./helpers/test-fixtures');
var { getGCalEvent, getMSFTEvent, waitForPropagation } = require('./helpers/api-helpers');
var { sync } = require('../../src/controllers/cal-sync.controller');

var NO_APPLE = { apple_cal_username: null, apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null };
var gcalToken = null;
var msftToken = null;
var user = null;

beforeAll(async () => {
  if (!await isDbAvailable() || !hasGCalCredentials() || !hasMsftCredentials()) return;
  user = await seedTestUser(NO_APPLE);
  gcalToken = await getGCalToken();
  msftToken = await getMsftToken();
});

afterEach(async () => {
  if (!user || !gcalToken || !msftToken) return;
  await cleanupTestData();
  await deleteAllGCalTestEvents(gcalToken);
  await deleteAllMSFTTestEvents(msftToken);
  user = await seedTestUser(NO_APPLE);
});

afterAll(async () => {
  if (!user) return;
  if (gcalToken) await deleteAllGCalTestEvents(gcalToken);
  if (msftToken) await deleteAllMSFTTestEvents(msftToken);
  await destroyTestUser();
  await db.destroy();
});

// SKIPPED: cal-sync integration tests need re-validation against the new
// two-table schema. Several tests inserted gcal_event_id directly on the task
// row (no longer a column post-refactor); that pattern needs migration to
// cal_sync_ledger inserts. Adapter unit tests (01/02/03) and the push test (10)
// continue to cover the underlying logic. TODO: re-enable per file.
describe.skip('Multi-Provider Sync', () => {
  var shouldSkip = () => !user || !gcalToken || !msftToken;

  test('task pushed to both GCal and MSFT', async () => {
    if (shouldSkip()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    var task = await makeTask({
      text: 'Test Task Multi Provider',
      dur: 30,
      scheduled_at: tomorrow
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    // Verify 2 ledger entries (one per provider)
    var ledgerRows = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, status: 'active' })
      .select();
    expect(ledgerRows.length).toBe(2);

    var providers = ledgerRows.map(function(r) { return r.provider; }).sort();
    expect(providers).toEqual(['gcal', 'msft']);

    // Verify events exist on both calendars
    var gcalLedger = ledgerRows.find(function(r) { return r.provider === 'gcal'; });
    var msftLedger = ledgerRows.find(function(r) { return r.provider === 'msft'; });

    var gcalEvent = await getGCalEvent(gcalToken, gcalLedger.provider_event_id);
    expect(gcalEvent).toBeTruthy();
    expect(gcalEvent.summary).toContain('Test Task Multi Provider');

    var msftEvent = await getMSFTEvent(msftToken, msftLedger.provider_event_id);
    expect(msftEvent).toBeTruthy();
    expect(msftEvent.subject).toContain('Test Task Multi Provider');
  });

  test('event changed on GCal -> task updated -> MSFT updated on next sync', async () => {
    if (shouldSkip()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    var task = await makeTask({
      text: 'Test Task Cross Update',
      dur: 30,
      scheduled_at: tomorrow
    });

    // Initial sync — push to both
    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);

    await waitForPropagation(3000);

    // Move event on GCal to 2:00 PM
    var gcalLedger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    expect(gcalLedger).toBeTruthy();

    var newStart = new Date(tomorrow);
    newStart.setHours(14, 0, 0, 0);
    var newEnd = new Date(newStart.getTime() + 30 * 60000);

    await gcalApi.patchEvent(gcalToken, gcalLedger.provider_event_id, {
      start: { dateTime: newStart.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: newEnd.toISOString(), timeZone: 'America/New_York' }
    });

    await waitForPropagation(3000);

    // Re-read user (tokens may have been refreshed during first sync)
    user = await db('users').where('id', TEST_USER_ID).first();

    // Second sync — pull change from GCal, update task
    var req2 = mockReq(user);
    var res2 = mockRes();
    await sync(req2, res2);

    await waitForPropagation(2000);

    // Verify task promoted to fixed
    var updatedTask = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(updatedTask).toBeTruthy();
    expect(updatedTask.when).toContain('fixed');

    // Re-read user again
    user = await db('users').where('id', TEST_USER_ID).first();

    // Third sync — push updated task to MSFT
    var req3 = mockReq(user);
    var res3 = mockRes();
    await sync(req3, res3);

    await waitForPropagation(3000);

    // Verify MSFT event now has the new time
    var msftLedger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'msft', status: 'active' })
      .first();
    expect(msftLedger).toBeTruthy();

    var msftEvent = await getMSFTEvent(msftToken, msftLedger.provider_event_id);
    expect(msftEvent).toBeTruthy();
    var msftStartTime = new Date(msftEvent.start.dateTime + 'Z');
    // Allow some timezone flex — just verify it's in the afternoon
    expect(msftStartTime.getUTCHours()).toBeGreaterThanOrEqual(14);
  });

  test('event deleted on one provider -> task deleted -> other provider cleaned up', async () => {
    if (shouldSkip()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    var task = await makeTask({
      text: 'Test Task Delete Cross',
      dur: 30,
      scheduled_at: tomorrow
    });

    // Initial sync
    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);

    await waitForPropagation(3000);

    // Delete event on GCal
    var gcalLedger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    expect(gcalLedger).toBeTruthy();
    await gcalApi.deleteEvent(gcalToken, gcalLedger.provider_event_id);

    await waitForPropagation(2000);

    // Sync 3 times (miss_count must reach threshold)
    for (var i = 0; i < 3; i++) {
      user = await db('users').where('id', TEST_USER_ID).first();
      var reqN = mockReq(user);
      var resN = mockRes();
      await sync(reqN, resN);
      if (i < 2) await waitForPropagation(2000);
    }

    await waitForPropagation(3000);

    // Verify task is deleted
    var deletedTask = await db('tasks_with_sync_v').where('id', task.id).first();
    expect(deletedTask).toBeFalsy();

    // One more sync to let MSFT provider discover the task is gone and clean up its ledger
    user = await db('users').where('id', TEST_USER_ID).first();
    var reqFinal = mockReq(user);
    var resFinal = mockRes();
    await sync(reqFinal, resFinal);

    await waitForPropagation(2000);

    // Verify MSFT event is also cleaned up (deleted because the task was deleted)
    var msftLedger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'msft' })
      .first();
    // Ledger should be in a non-active state or gone
    if (msftLedger) {
      expect(msftLedger.status).not.toBe('active');
    }
  });
});
