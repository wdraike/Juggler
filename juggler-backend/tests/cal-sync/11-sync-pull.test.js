/**
 * 11-sync-pull.test.js — Calendar to Strive (Pull) Tests
 *
 * Tests that calendar events are correctly pulled as tasks.
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
var { makeTask, makeGCalEvent, makeMSFTEvent, deleteGCalEvent, deleteMSFTEvent } = require('./helpers/test-fixtures');
var { getGCalEvent, waitForPropagation } = require('./helpers/api-helpers');
var { assertPulledTaskMatchesGCalEvent, scheduledAtToUTC } = require('./helpers/assertions');

// Helper: find the juggler task created for a given GCal event ID by querying
// cal_sync_ledger (the source of truth for the new two-table schema).
async function pulledTaskForEvent(gcalEventId) {
  var ledger = await db('cal_sync_ledger')
    .where({ user_id: TEST_USER_ID, provider_event_id: gcalEventId, provider: 'gcal' })
    .whereIn('status', ['active'])
    .first();
  if (!ledger || !ledger.task_id) return null;
  return db('tasks_v').where('id', ledger.task_id).first();
}

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

function tomorrowISO(hours, minutes) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hours || 10, minutes || 0, 0, 0);
  return d.toISOString();
}

function tomorrowEndISO(hours, minutes, durMinutes) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hours || 10, minutes || 0, 0, 0);
  return new Date(d.getTime() + (durMinutes || 30) * 60000).toISOString();
}

function tomorrowDateStr() {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

describe('Sync Pull: Calendar -> Strive', () => {

  test('new GCal event -> task created with correct fields', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event GCal Pull',
      start: { dateTime: tomorrowISO(14, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(14, 0, 30), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);

    await waitForPropagation(1000);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.pulled).toBeGreaterThanOrEqual(1);

    var task = await pulledTaskForEvent(event.id);
    assertPulledTaskMatchesGCalEvent(task, event, TEST_TIMEZONE);
    expect(task.when).toBe('fixed');
  }));

  test('new MSFT event -> task created', skipIfNoDB(async () => {
    if (!hasMsftCredentials()) return;
    user = await seedTestUser({ gcal_refresh_token: null });

    var event = await makeMSFTEvent(msftToken, {
      subject: 'Test Event MSFT Pull',
      start: { dateTime: tomorrowISO(14, 0).replace('Z', ''), timeZone: 'Eastern Standard Time' },
      end: { dateTime: tomorrowEndISO(14, 0, 30).replace('Z', ''), timeZone: 'Eastern Standard Time' }
    });
    createdMSFTEventIds.push(event.id);

    await waitForPropagation(1000);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.pulled).toBeGreaterThanOrEqual(1);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, provider_event_id: event.id, provider: 'msft' })
      .first();
    expect(ledger).toBeTruthy();
    expect(ledger.task_id).toBeTruthy();
    var task = await db('tasks_v').where('id', ledger.task_id).first();
    expect(task).toBeTruthy();
    expect(task.when).toBe('fixed');
  }));

  test('event title -> task.text', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Title Match 42',
      start: { dateTime: tomorrowISO(15, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(15, 0, 60), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);
    await waitForPropagation(1000);
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var task = await pulledTaskForEvent(event.id);
    expect(task).toBeTruthy();
    expect(task.text).toBe('Test Event Title Match 42');
    assertPulledTaskMatchesGCalEvent(task, event, TEST_TIMEZONE);
  }));

  test('event duration -> task.dur', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Duration Match',
      start: { dateTime: tomorrowISO(15, 30), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(15, 30, 75), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);
    await waitForPropagation(1000);
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var task = await pulledTaskForEvent(event.id);
    expect(task).toBeTruthy();
    expect(task.dur).toBe(75);
    assertPulledTaskMatchesGCalEvent(task, event, TEST_TIMEZONE);
  }));

  test('event start time -> task.scheduled_at (UTC)', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event ScheduledAt Match',
      start: { dateTime: tomorrowISO(11, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(11, 0, 30), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);
    await waitForPropagation(1000);
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var task = await pulledTaskForEvent(event.id);
    expect(task).toBeTruthy();
    // scheduled_at must represent the same UTC moment as event start.
    // MySQL dateStrings:true returns "YYYY-MM-DD HH:MM:SS" (no tz); append Z.
    var expectedUTC = new Date(event.start.dateTime).getTime();
    var actualUTC = scheduledAtToUTC(task.scheduled_at);
    expect(Math.abs(actualUTC - expectedUTC)).toBeLessThan(60000);
    assertPulledTaskMatchesGCalEvent(task, event, TEST_TIMEZONE);
  }));

  test('transparent event -> task.marker = true', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Transparent',
      start: { dateTime: tomorrowISO(16, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(16, 0, 30), timeZone: 'America/New_York' },
      transparency: 'transparent'
    });
    createdGCalEventIds.push(event.id);
    await waitForPropagation(1000);
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var task = await pulledTaskForEvent(event.id);
    expect(task).toBeTruthy();
    expect(task.marker).toBeTruthy();
    assertPulledTaskMatchesGCalEvent(task, event, TEST_TIMEZONE);
  }));

  test('all-day event -> when=allday', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event All Day',
      start: { date: tomorrowDateStr() },
      end: { date: tomorrowDateStr() }
    });
    createdGCalEventIds.push(event.id);
    await waitForPropagation(1000);
    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var task = await pulledTaskForEvent(event.id);
    expect(task).toBeTruthy();
    expect(task.when).toBe('allday');
    assertPulledTaskMatchesGCalEvent(task, event, TEST_TIMEZONE);
  }));

  test('ledger entry created with origin=provider', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Ledger Origin',
      start: { dateTime: tomorrowISO(17, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(17, 0, 30), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);

    await waitForPropagation(1000);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, provider_event_id: event.id }).first();
    expect(ledger).toBeTruthy();
    expect(ledger.origin).toBe('gcal');
    expect(ledger.status).toBe('active');
    expect(ledger.last_pulled_hash).toBeTruthy();
  }));

  test('duplicate prevention: event with same text+date not imported twice', skipIfNoDB(async () => {
    if (!hasGCalCredentials()) return;
    user = await seedTestUser();

    var tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    tomorrowDate.setHours(10, 0, 0, 0);

    // Create task in DB first
    var task = await makeTask({
      text: 'Test Event Duplicate Check',
      scheduled_at: tomorrowDate,
      dur: 30,
      when: 'morning'
    });

    // Create matching event on GCal
    var event = await makeGCalEvent(gcalToken, {
      summary: 'Test Event Duplicate Check',
      start: { dateTime: tomorrowISO(10, 0), timeZone: 'America/New_York' },
      end: { dateTime: tomorrowEndISO(10, 0, 30), timeZone: 'America/New_York' }
    });
    createdGCalEventIds.push(event.id);

    await waitForPropagation(1000);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    // Should have linked, not duplicated
    var allTasks = await db('tasks_v')
      .where({ user_id: TEST_USER_ID })
      .where('text', 'Test Event Duplicate Check');
    expect(allTasks.length).toBe(1);

    // Ledger should reference the existing task
    var ledger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, provider_event_id: event.id }).first();
    expect(ledger).toBeTruthy();
    expect(ledger.task_id).toBe(task.id);
  }));

});
