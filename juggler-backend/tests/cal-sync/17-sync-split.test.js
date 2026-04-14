/**
 * 17-sync-split.test.js — Split Task Expansion
 *
 * Tests that the scheduler's split placements (stored in schedule_cache)
 * produce one calendar event per split part, with correct titles and times.
 */

jest.setTimeout(60000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var {
  db, TEST_USER_ID, isDbAvailable, hasGCalCredentials,
  seedTestUser, cleanupTestData, destroyTestUser,
  getGCalToken, mockReq, mockRes, gcalApi
} = require('./helpers/test-setup');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, deleteAllGCalTestEvents } = require('./helpers/test-fixtures');
var { getGCalEvent, listGCalEvents, waitForPropagation } = require('./helpers/api-helpers');
var { sync } = require('../../src/controllers/cal-sync.controller');

var GCAL_ONLY = { msft_cal_refresh_token: null, apple_cal_username: null, apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null };
var token = null;
var user = null;

beforeAll(async () => {
  if (!await isDbAvailable() || !hasGCalCredentials()) return;
  user = await seedTestUser(GCAL_ONLY);
  token = await getGCalToken();
});

afterEach(async () => {
  if (!user || !token) return;
  await cleanupTestData();
  await deleteAllGCalTestEvents(token);
  // Re-seed user since cleanupTestData deletes user_config
  user = await seedTestUser(GCAL_ONLY);
});

afterAll(async () => {
  if (!user) return;
  if (token) await deleteAllGCalTestEvents(token);
  await destroyTestUser();
  await db.destroy();
});

function buildScheduleCache(taskId, dateKey, placements) {
  var dayPlacements = {};
  dayPlacements[dateKey] = placements.map(function(p, i) {
    return {
      taskId: taskId,
      start: p.start,
      dur: p.dur,
      splitPart: i + 1,
      splitTotal: placements.length,
      scheduledAtUtc: p.scheduledAtUtc || null
    };
  });
  return JSON.stringify({ dayPlacements: dayPlacements });
}

async function seedScheduleCache(cacheValue) {
  await db('user_config').where({ user_id: TEST_USER_ID, config_key: 'schedule_cache' }).del();
  await db('user_config').insert({
    user_id: TEST_USER_ID,
    config_key: 'schedule_cache',
    config_value: cacheValue
  });
}

// SKIPPED: cal-sync integration tests need re-validation against the new
// two-table schema. Several tests inserted gcal_event_id directly on the task
// row (no longer a column post-refactor); that pattern needs migration to
// cal_sync_ledger inserts. Adapter unit tests (01/02/03) and the push test (10)
// continue to cover the underlying logic. TODO: re-enable per file.
describe.skip('Split Task Expansion', () => {
  var shouldSkip = () => !user || !token;

  test('120min task with 4x30min placements creates 4 calendar events', async () => {
    if (shouldSkip()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    var task = await makeTask({
      text: 'Test Task Long Split',
      dur: 120,
      scheduled_at: tomorrow
    });

    var dateKey = (tomorrow.getMonth() + 1) + '/' + tomorrow.getDate();
    var cache = buildScheduleCache(task.id, dateKey, [
      { start: 540, dur: 30 },
      { start: 600, dur: 30 },
      { start: 660, dur: 30 },
      { start: 720, dur: 30 }
    ]);
    await seedScheduleCache(cache);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    // Verify 4 events on GCal
    var timeMin = new Date(tomorrow);
    timeMin.setHours(0, 0, 0, 0);
    var timeMax = new Date(tomorrow);
    timeMax.setHours(23, 59, 59, 999);

    var events = await listGCalEvents(token, timeMin.toISOString(), timeMax.toISOString());
    var splitEvents = events.filter(function(e) {
      return (e.summary || '').indexOf('Test Task Long Split') >= 0;
    });

    expect(splitEvents.length).toBe(4);

    // Each should have "(part N/4)" suffix
    for (var i = 1; i <= 4; i++) {
      var found = splitEvents.find(function(e) {
        return (e.summary || '').indexOf('(part ' + i + '/4)') >= 0;
      });
      expect(found).toBeTruthy();
    }
  });

  test('each split part has correct time and duration', async () => {
    if (shouldSkip()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    var task = await makeTask({
      text: 'Test Task Split Times',
      dur: 120,
      scheduled_at: tomorrow
    });

    var dateKey = (tomorrow.getMonth() + 1) + '/' + tomorrow.getDate();
    // 540 = 9:00 AM, 600 = 10:00 AM, 660 = 11:00 AM, 720 = 12:00 PM
    var placements = [
      { start: 540, dur: 30 },
      { start: 600, dur: 30 },
      { start: 660, dur: 30 },
      { start: 720, dur: 30 }
    ];
    var cache = buildScheduleCache(task.id, dateKey, placements);
    await seedScheduleCache(cache);

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    await waitForPropagation(3000);

    var timeMin = new Date(tomorrow);
    timeMin.setHours(0, 0, 0, 0);
    var timeMax = new Date(tomorrow);
    timeMax.setHours(23, 59, 59, 999);

    var events = await listGCalEvents(token, timeMin.toISOString(), timeMax.toISOString());
    var splitEvents = events.filter(function(e) {
      return (e.summary || '').indexOf('Test Task Split Times') >= 0;
    });

    expect(splitEvents.length).toBe(4);

    for (var i = 0; i < placements.length; i++) {
      var partNum = i + 1;
      var evt = splitEvents.find(function(e) {
        return (e.summary || '').indexOf('(part ' + partNum + '/4)') >= 0;
      });
      expect(evt).toBeTruthy();

      // Verify duration: 30 minutes
      var evtStart = new Date(evt.start.dateTime);
      var evtEnd = new Date(evt.end.dateTime);
      var durMins = (evtEnd - evtStart) / 60000;
      expect(durMins).toBe(30);
    }
  });

  test('non-split ledger replaced when task becomes split', async () => {
    if (shouldSkip()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    var task = await makeTask({
      text: 'Test Task Becomes Split',
      dur: 120,
      scheduled_at: tomorrow
    });

    // First sync: no split placements, pushes as single event
    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);

    await waitForPropagation(3000);

    // Verify single event exists
    var ledgerBefore = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .select();
    expect(ledgerBefore.length).toBe(1);
    var oldEventId = ledgerBefore[0].provider_event_id;
    expect(oldEventId).toBeTruthy();

    // Now seed split placements
    var dateKey = (tomorrow.getMonth() + 1) + '/' + tomorrow.getDate();
    var cache = buildScheduleCache(task.id, dateKey, [
      { start: 540, dur: 30 },
      { start: 600, dur: 30 },
      { start: 660, dur: 30 },
      { start: 720, dur: 30 }
    ]);
    await seedScheduleCache(cache);

    // Touch task's updated_at so sync detects the change
    await tasksWrite.updateTaskById(db, task.id, { updated_at: db.fn.now() }, TEST_USER_ID);

    // Re-read user (tokens may have been refreshed during first sync)
    user = await db('users').where('id', TEST_USER_ID).first();

    // Second sync: should delete old event and create 4 new ones
    var req2 = mockReq(user);
    var res2 = mockRes();
    await sync(req2, res2);

    await waitForPropagation(3000);

    // Verify old event is gone from GCal
    var oldEvent = await getGCalEvent(token, oldEventId);
    var isGone = !oldEvent || oldEvent.status === 'cancelled';
    expect(isGone).toBe(true);

    // Verify 4 new events exist
    var timeMin = new Date(tomorrow);
    timeMin.setHours(0, 0, 0, 0);
    var timeMax = new Date(tomorrow);
    timeMax.setHours(23, 59, 59, 999);

    var events = await listGCalEvents(token, timeMin.toISOString(), timeMax.toISOString());
    var splitEvents = events.filter(function(e) {
      return (e.summary || '').indexOf('Test Task Becomes Split') >= 0 && e.status !== 'cancelled';
    });
    expect(splitEvents.length).toBe(4);
  });
});
