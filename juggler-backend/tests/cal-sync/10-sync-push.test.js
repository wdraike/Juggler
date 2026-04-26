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
  db, TEST_USER_ID, TEST_TIMEZONE, isDbAvailable, hasGCalCredentials, hasMsftCredentials,
  seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes, getGCalToken, getMsftToken
} = require('./helpers/test-setup');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, makeTaskId } = require('./helpers/test-fixtures');
var { getGCalEvent, getMSFTEvent, waitForPropagation } = require('./helpers/api-helpers');
var { deleteGCalEvent, deleteMSFTEvent, deleteAllGCalTestEvents, deleteAllMSFTTestEvents } = require('./helpers/test-fixtures');
var { assertGCalEventMatchesTask } = require('./helpers/assertions');

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

// ─── Field-level assertions: every dimension buildEventBody sets ────────────
//
// These tests explicitly set task.date + task.time so the expected GCal event
// fields are deterministic — no dependency on the test runner's local timezone.
// After sync, each test fetches the raw GCal event and calls
// assertGCalEventMatchesTask which covers: summary, start dateTime, end
// dateTime, duration (ms arithmetic), timezone, description (project / notes /
// url / footer), and transparency.

describe('Sync Push: field-level assertions', () => {

  function tomorrowDateStr() {
    var d = new Date();
    d.setDate(d.getDate() + 2); // +2 to avoid any "past" filter edge cases
    return d.toISOString().split('T')[0];
  }

  async function pushAndFetchEvent(task) {
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);
    expect(res.statusCode).toBe(200);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    expect(ledger).toBeTruthy();
    expect(ledger.provider_event_id).toBeTruthy();
    createdGCalEventIds.push(ledger.provider_event_id);

    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, ledger.provider_event_id);
    expect(event).toBeTruthy();

    // Re-read the task from the view to get exactly what the sync consumed
    var taskRow = await db('tasks_v').where('id', task.id).first();
    return { event, taskRow, eventId: ledger.provider_event_id };
  }

  beforeEach(async () => {
    if (!await isDbAvailable()) return;
    user = await seedTestUser();
  });

  test('title: event.summary matches task.text exactly', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    var task = await makeTask({
      text: 'Field Assertion — Title Check',
      date: tomorrowDateStr(),
      time: '10:00 AM',
      dur: 45,
      when: 'fixed',
      date_pinned: 1
    });
    var { event, taskRow } = await pushAndFetchEvent(task);
    expect(event.summary).toBe('Field Assertion — Title Check');
    assertGCalEventMatchesTask(event, taskRow, TEST_TIMEZONE);
  }));

  test('start + end + duration: event spans exactly task.dur minutes', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    var task = await makeTask({
      text: 'Field Assertion — Duration Check',
      date: tomorrowDateStr(),
      time: '2:00 PM',
      dur: 90,
      when: 'fixed',
      date_pinned: 1
    });
    var { event, taskRow } = await pushAndFetchEvent(task);
    var durMs = new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime();
    expect(durMs / 60000).toBe(90);
    assertGCalEventMatchesTask(event, taskRow, TEST_TIMEZONE);
  }));

  test('description: project + notes + url all present; footer always present', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    var task = await makeTask({
      text: 'Field Assertion — Description Check',
      date: tomorrowDateStr(),
      time: '11:00 AM',
      dur: 30,
      when: 'fixed',
      date_pinned: 1,
      notes: 'These are the test notes',
      url: 'https://example.com/sync-test',
      project: 'TestProject'
    });
    var { event, taskRow } = await pushAndFetchEvent(task);
    var desc = event.description || '';
    expect(desc).toContain('Project: TestProject');
    expect(desc).toContain('Notes: These are the test notes');
    expect(desc).toContain('Link: https://example.com/sync-test');
    expect(desc).toContain('Synced from Raike & Sons');
    assertGCalEventMatchesTask(event, taskRow, TEST_TIMEZONE);
  }));

  test('description: no spurious fields when project/notes/url are absent', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    var task = await makeTask({
      text: 'Field Assertion — Empty Description',
      date: tomorrowDateStr(),
      time: '9:00 AM',
      dur: 30,
      when: 'fixed',
      date_pinned: 1,
      notes: null,
      url: null,
      project: null
    });
    var { event, taskRow } = await pushAndFetchEvent(task);
    var desc = event.description || '';
    expect(desc).not.toContain('Project:');
    expect(desc).not.toContain('Notes:');
    expect(desc).not.toContain('Link:');
    expect(desc).toContain('Synced from Raike & Sons');
    assertGCalEventMatchesTask(event, taskRow, TEST_TIMEZONE);
  }));

  test('done task: summary has ✓ prefix and transparency=transparent', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    // Phase 3 (new-task push) skips done tasks, so we must push it as pending
    // first, then mark done and re-sync so Phase 2 (update path) propagates.
    var task = await makeTask({
      text: 'Field Assertion — Done Task',
      date: tomorrowDateStr(),
      time: '3:00 PM',
      dur: 60,
      when: 'fixed',
      date_pinned: 1,
      status: ''
    });
    // First sync: creates the GCal event
    var { eventId } = await pushAndFetchEvent(task);

    // Mark done in DB
    await db('task_instances').where('id', task.id).update({ status: 'done', updated_at: db.fn.now() });

    // Reload user so sync sees fresh state
    user = await db('users').where('id', TEST_USER_ID).first();

    // Second sync: Phase 2 updates the event with ✓ prefix + transparent
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);
    expect(res.statusCode).toBe(200);

    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, eventId);
    expect(event).toBeTruthy();
    expect(event.summary).toBe('✓ Field Assertion — Done Task');
    expect(event.transparency).toBe('transparent');
    // Time assertion skipped: rowToTask clamps scheduled_at to updated_at for
    // future done tasks, so the event start intentionally differs from the DB value.
  }));

  test('marker task: transparency=transparent', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    var task = await makeTask({
      text: 'Field Assertion — Marker Task',
      date: tomorrowDateStr(),
      time: '4:00 PM',
      dur: 30,
      when: 'fixed',
      date_pinned: 1,
      marker: 1,
      status: ''
    });
    var { event, taskRow } = await pushAndFetchEvent(task);
    expect(event.transparency).toBe('transparent');
    assertGCalEventMatchesTask(event, taskRow, TEST_TIMEZONE);
  }));

  test('normal task: no transparency (opaque or absent)', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    var task = await makeTask({
      text: 'Field Assertion — Normal Task',
      date: tomorrowDateStr(),
      time: '10:30 AM',
      dur: 45,
      when: 'fixed',
      date_pinned: 1,
      marker: 0,
      status: ''
    });
    var { event, taskRow } = await pushAndFetchEvent(task);
    expect(event.transparency == null || event.transparency === 'opaque').toBe(true);
    assertGCalEventMatchesTask(event, taskRow, TEST_TIMEZONE);
  }));

  test('timezone: event start.timeZone matches user timezone', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    var task = await makeTask({
      text: 'Field Assertion — Timezone Check',
      date: tomorrowDateStr(),
      time: '8:00 AM',
      dur: 30,
      when: 'fixed',
      date_pinned: 1
    });
    var { event } = await pushAndFetchEvent(task);
    expect(event.start.timeZone).toBe(TEST_TIMEZONE);
    expect(event.end.timeZone).toBe(TEST_TIMEZONE);
  }));

  test('update: edit task -> all changed fields reflected on GCal', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    var task = await makeTask({
      text: 'Field Assertion — Pre-Edit',
      date: tomorrowDateStr(),
      time: '9:00 AM',
      dur: 30,
      when: 'fixed',
      date_pinned: 1
    });

    // Initial push
    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);
    var ledger1 = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .first();
    createdGCalEventIds.push(ledger1.provider_event_id);

    // Edit the task
    await db('task_masters').where('id', task.master_id || task.id).update({ text: 'Field Assertion — Post-Edit' });
    await db('task_instances').where('id', task.id).update({
      time: '11:00 AM',
      dur: 60,
      updated_at: db.fn.now()
    });
    // Clear hash to force re-push
    await db('cal_sync_ledger').where('id', ledger1.id).update({ last_pushed_hash: '' });

    // Re-sync
    var req2 = mockReq(user);
    var res2 = mockRes();
    await sync(req2, res2);
    expect(res2._json.pushed).toBeGreaterThanOrEqual(1);

    await waitForPropagation(1000);
    var event = await getGCalEvent(gcalToken, ledger1.provider_event_id);
    expect(event.summary).toBe('Field Assertion — Post-Edit');
    var durMs = new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime();
    expect(durMs / 60000).toBe(60);

    var taskRow = await db('tasks_v').where('id', task.id).first();
    assertGCalEventMatchesTask(event, taskRow, TEST_TIMEZONE);
  }));

});
