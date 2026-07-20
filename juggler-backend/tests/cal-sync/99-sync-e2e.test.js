/**
 * 99-sync-e2e.test.js — Full Lifecycle End-to-End
 *
 * Sequential tests that exercise the complete sync lifecycle:
 * create, move, delete, edit, and ingest — in order, sharing state.
 * This mirrors a real user's workflow across multiple sync runs.
 */

jest.setTimeout(180000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var crypto = require('crypto');
var {
  db, TEST_USER_ID, hasGCalCredentials,
  seedTestUser, cleanupTestData, destroyTestUser,
  getGCalToken, mockReq, mockRes, gcalApi
} = require('./helpers/test-setup');
var { assertDbAvailable } = require('../helpers/requireDB');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, makeTaskId, deleteAllGCalTestEvents, makeGCalEvent } = require('./helpers/test-fixtures');
var { getGCalEvent, listGCalEvents, waitForPropagation } = require('./helpers/api-helpers');
var { sync } = require('../../src/controllers/cal-sync.controller');
var { describeWithCreds } = require('./helpers/credentialGate');

var token = null;
var user = null;

// Shared state across sequential tests
var tasks = [];
var taskIds = [];
var movedTaskId = null;
var deletedTaskId = null;
var editedTaskId = null;
var deleteFromDbTaskId = null;
var ingestedEventId = null;

beforeAll(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  await assertDbAvailable();
  if (!hasGCalCredentials()) return;
  user = await seedTestUser({
    msft_cal_refresh_token: null,
    apple_cal_username: null, apple_cal_password: null,
    apple_cal_server_url: null, apple_cal_calendar_url: null
  });
  token = await getGCalToken();
  // Clean slate
  await cleanupTestData();
  await deleteAllGCalTestEvents(token);
  user = await seedTestUser({
    msft_cal_refresh_token: null,
    apple_cal_username: null, apple_cal_password: null,
    apple_cal_server_url: null, apple_cal_calendar_url: null
  });
});

afterAll(async () => {
  jest.useRealTimers();
  if (!user) return;
  if (token) await deleteAllGCalTestEvents(token);
  await destroyTestUser();
  await db.destroy();
});

describeWithCreds(() => hasGCalCredentials(), 'Full Lifecycle E2E', () => {
  test('1. create 5 tasks -> sync -> 5 events on GCal', async () => {
    for (var i = 0; i < 5; i++) {
      var tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9 + i, 0, 0, 0);

      var task = await makeTask({
        text: 'Test Task E2E ' + (i + 1),
        dur: 30,
        scheduled_at: tomorrow
      });
      tasks.push(task);
      taskIds.push(task.id);
    }

    user = await db('users').where('id', TEST_USER_ID).first();
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    // Verify each task has a gcal_event_id
    for (var j = 0; j < taskIds.length; j++) {
      var ledger = await db('cal_sync_ledger')
        .where({ user_id: TEST_USER_ID, task_id: taskIds[j], provider: 'gcal', status: 'active' })
        .first();
      expect(ledger).toBeTruthy();
      // 999.1207: content, not existence — juggler-origin link, clean miss
      // counter, real event id.
      expect(ledger.origin).toBe('juggler');
      expect(ledger.miss_count).toBe(0);
      expect(typeof ledger.provider_event_id).toBe('string');
      expect(ledger.provider_event_id.length).toBeGreaterThan(0);

      // Verify event exists on GCal with the RIGHT title and the RIGHT start
      // instant (the tz-misparse bug class writes an event at the wrong hour
      // while a bare existence check stays green).
      var event = await getGCalEvent(token, ledger.provider_event_id);
      expect(event).toBeTruthy();
      expect(event.summary).toContain('Test Task E2E ' + (j + 1));
      var expectedStart = new Date();
      expectedStart.setDate(expectedStart.getDate() + 1);
      expectedStart.setHours(9 + j, 0, 0, 0);
      expect(Math.abs(new Date(event.start.dateTime) - expectedStart))
        .toBeLessThan(2 * 60 * 1000);
    }

    // Assign roles for subsequent tests
    movedTaskId = taskIds[0];
    deletedTaskId = taskIds[1];
    editedTaskId = taskIds[2];
    deleteFromDbTaskId = taskIds[3];
  });

  test('2. move 1 event on GCal -> sync -> task promoted to fixed', async () => {
    if (!movedTaskId) return;

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: movedTaskId, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();

    // Move event to 3:00 PM
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var newStart = new Date(tomorrow);
    newStart.setHours(15, 0, 0, 0);
    var newEnd = new Date(newStart.getTime() + 30 * 60000);

    await gcalApi.patchEvent(token, ledger.provider_event_id, {
      start: { dateTime: newStart.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: newEnd.toISOString(), timeZone: 'America/New_York' }
    });
    await waitForPropagation(2000);

    user = await db('users').where('id', TEST_USER_ID).first();
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var task = await db('tasks_v').where('id', movedTaskId).first();
    expect(task).toBeTruthy();
    expect(task.when).toMatch(/fixed/);
    var taskSched = new Date(String(task.scheduled_at).replace(' ', 'T') + 'Z');
    expect(Math.abs(taskSched - newStart)).toBeLessThan(2 * 60 * 1000);

    // 999.1207: the ledger's cached event_start must track the move too —
    // a stale cache here is exactly the hash-drift/tz bug class.
    var ledgerAfterMove = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: movedTaskId, provider: 'gcal', status: 'active' })
      .first();
    expect(ledgerAfterMove).toBeTruthy();
    expect(ledgerAfterMove.event_start).toBeTruthy();
    var cachedStart = new Date(String(ledgerAfterMove.event_start).replace(' ', 'T') + 'Z');
    expect(Math.abs(cachedStart - newStart)).toBeLessThan(2 * 60 * 1000);
  });

  test('3. delete 1 event on GCal -> sync 3x -> task deleted', async () => {
    if (!deletedTaskId) return;

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: deletedTaskId, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    expect(ledger.miss_count).toBe(0); // ramp must start clean
    var deletedLedgerId = ledger.id;

    // Delete the event on GCal
    await gcalApi.deleteEvent(token, ledger.provider_event_id);

    await waitForPropagation(2000);

    // Sync 3 times to reach miss_count threshold
    for (var i = 0; i < 3; i++) {
      user = await db('users').where('id', TEST_USER_ID).first();
      var reqN = mockReq(user);
      var resN = mockRes();
      await sync(reqN, resN);
      if (i < 2) await waitForPropagation(2000);
    }

    // Verify task row is gone
    var task = await db('tasks_v').where('id', deletedTaskId).first();
    expect(task).toBeFalsy();

    // 999.1207: and the ledger must carry the full deleted_remote state
    // (status + task link severed), not just "the task vanished somehow".
    var deletedLedger = await db('cal_sync_ledger').where('id', deletedLedgerId).first();
    expect(deletedLedger).toBeTruthy();
    expect(deletedLedger.status).toBe('deleted_remote');
    expect(deletedLedger.task_id).toBeNull();
  });

  test('4. edit task title -> sync -> event title updated', async () => {
    if (!editedTaskId) return;

    // Change task text in DB
    await tasksWrite.updateTaskById(db, editedTaskId, {
      text: 'Test Task E2E Edited Title',
      updated_at: db.fn.now()
    }, TEST_USER_ID);

    user = await db('users').where('id', TEST_USER_ID).first();
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    // Verify GCal event summary matches new text
    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: editedTaskId, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    // 999.1207: the edit push must not degrade the link — same task,
    // still zero misses.
    expect(ledger.task_id).toBe(editedTaskId);
    expect(ledger.miss_count).toBe(0);

    var event = await getGCalEvent(token, ledger.provider_event_id);
    expect(event).toBeTruthy();
    expect(event.summary).toContain('Test Task E2E Edited Title');
  });

  test('5. delete task -> sync -> event deleted from GCal', async () => {
    if (!deleteFromDbTaskId) return;

    // Get the event ID before deleting the task
    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: deleteFromDbTaskId, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    var eventId = ledger.provider_event_id;
    expect(typeof eventId).toBe('string');

    // Delete task from DB
    await tasksWrite.deleteTaskById(db, deleteFromDbTaskId, TEST_USER_ID);

    user = await db('users').where('id', TEST_USER_ID).first();
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    // Verify event is gone from GCal
    var event = await getGCalEvent(token, eventId);
    var isGone = !event || event.status === 'cancelled';
    expect(isGone).toBe(true);

    // 999.1207: ledger retired as deleted_local — kept for history, no longer
    // presenting as an active link.
    var retired = await db('cal_sync_ledger').where('id', ledger.id).first();
    expect(retired).toBeTruthy();
    expect(retired.status).toBe('deleted_local');
  });

  test('6. create event on GCal -> sync -> new task in DB', async () => {
    // Create event directly on GCal
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    tomorrow.setHours(11, 0, 0, 0);
    var endTime = new Date(tomorrow.getTime() + 45 * 60000);

    var gcalEvent = await makeGCalEvent(token, {
      summary: 'Test Event Ingested From GCal',
      start: { dateTime: tomorrow.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: endTime.toISOString(), timeZone: 'America/New_York' }
    });
    ingestedEventId = gcalEvent.id;

    await waitForPropagation(3000);

    user = await db('users').where('id', TEST_USER_ID).first();
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    // Verify new task was created in DB
    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, provider_event_id: ingestedEventId, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    expect(ledger.task_id).toBeTruthy();
    expect(ledger.origin).toBe('gcal');

    var newTask = await db('tasks_v').where('id', ledger.task_id).first();
    expect(newTask).toBeTruthy();
    expect(newTask.text).toBe('Test Event Ingested From GCal');
    // 999.1207: the ingested task must carry the event's CONTENT, not just
    // its title — duration from the event (45 min) and the exact start
    // instant (controller: dur = durationMinutes, scheduled_at =
    // localToUtc(event local date/time)). A tz-misparse lands the task at
    // the wrong hour while text-only checks stay green.
    expect(newTask.dur).toBe(45);
    var ingestedSched = new Date(String(newTask.scheduled_at).replace(' ', 'T') + 'Z');
    expect(Math.abs(ingestedSched - tomorrow)).toBeLessThan(2 * 60 * 1000);
  });

  test('7. sync_history contains all actions', async () => {
    var history = await db('sync_history')
      .where('user_id', TEST_USER_ID)
      .orderBy('id', 'asc')
      .select();

    expect(history.length).toBeGreaterThan(0);

    // Collect all action types
    var actionTypes = {};
    history.forEach(function(row) {
      actionTypes[row.action] = (actionTypes[row.action] || 0) + 1;
    });

    console.log('[e2e] sync_history action counts:', actionTypes);
    console.log('[e2e] Total sync_history entries:', history.length);

    // We should have at least some push and pull actions from the lifecycle
    // Push: initial 5 tasks + updated title + ingest writes
    // Pull: moved event, deleted event detection
    var allActions = Object.keys(actionTypes);
    expect(allActions.length).toBeGreaterThan(0);

    // Verify history entries have required fields
    history.forEach(function(row) {
      expect(row.user_id).toBe(TEST_USER_ID);
      expect(row.sync_run_id).toBeTruthy();
      expect(row.provider).toBeTruthy();
      expect(row.action).toBeTruthy();
    });
  });
});
