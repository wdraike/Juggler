/**
 * 17-sync-split.test.js — Split Task Calendar Sync
 *
 * Path A (real chunk rows): scheduler writes task_instances rows with
 * split_ordinal/split_total > 1. Sync groups them by occurrence, merges
 * contiguous runs into one event, and pushes non-contiguous chunks as
 * separate events with "(X/N)" title suffixes.
 *
 * Path B (legacy cache-based): backward-compat path for old-style splits
 * where only schedule_cache has the split placement info.
 */

jest.setTimeout(60000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var crypto = require('crypto');
var {
  db, TEST_USER_ID, isDbAvailable, hasGCalCredentials,
  seedTestUser, cleanupTestData, destroyTestUser,
  getGCalToken, mockReq, mockRes
} = require('./helpers/test-setup');
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
  user = await seedTestUser(GCAL_ONLY);
});

afterAll(async () => {
  if (!user) return;
  if (token) await deleteAllGCalTestEvents(token);
  await destroyTestUser();
  await db.destroy();
});

// ─── Path A helpers ────────────────────────────────────────────────────────

function makeChunkGroupId() {
  return 'split-' + crypto.randomBytes(6).toString('hex');
}

// Returns a Date for tomorrow at the given UTC hour (midnight-anchored).
function tomorrowUTC(utcHour) {
  var d = new Date();
  d.setDate(d.getDate() + 1);
  d.setUTCHours(utcHour, 0, 0, 0);
  return d;
}

/**
 * Insert a split task into the DB as real chunk rows (Path A).
 * Creates one task_masters row + one task_instances row per chunk.
 * Secondary chunks (ordinal > 1) share the primary's master_id.
 *
 * @param {object} opts
 *   text     - task title
 *   chunks   - array of { scheduledAt: Date, dur: number }
 */
async function makeSplitTask(opts) {
  var primaryId = opts.id || makeChunkGroupId();
  var chunks = opts.chunks;
  var total = chunks.length;
  var text = opts.text || ('Test Split Task ' + primaryId.slice(-4));
  var totalDur = chunks.reduce(function(s, c) { return s + (c.dur || 60); }, 0);

  await db('task_masters').insert({
    id: primaryId,
    user_id: TEST_USER_ID,
    text: text,
    dur: totalDur,
    pri: 'P3',
    rigid: 0,
    recurring: 0,
    marker: 0,
    flex_when: 0,
    status: '',
    when: 'fixed',
    split: 1,
    split_min: chunks[0].dur || 60,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  var chunkIds = [];
  for (var i = 0; i < total; i++) {
    var chunk = chunks[i];
    var chunkId = i === 0 ? primaryId : primaryId + '-' + (i + 1);
    chunkIds.push(chunkId);
    await db('task_instances').insert({
      id: chunkId,
      master_id: primaryId,
      user_id: TEST_USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: i + 1,
      split_total: total,
      split_group: primaryId,
      dur: chunk.dur || 60,
      scheduled_at: chunk.scheduledAt,
      date_pinned: 1,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
  }

  return { id: primaryId, chunkIds: chunkIds, text: text };
}

async function runSync() {
  var req = mockReq(user);
  var res = mockRes();
  await sync(req, res);
  return res;
}

// ─── Path A: Real Chunk Rows ────────────────────────────────────────────────

describe('Split: Real Chunk Rows (Path A)', () => {
  var shouldSkip = () => !user || !token;

  test('contiguous chunks merge into single GCal event with total duration', async () => {
    if (shouldSkip()) return;

    // chunk1: 9–10 AM EDT (UTC 13–14), chunk2: 10–11 AM EDT (UTC 14–15)
    var task = await makeSplitTask({
      text: 'Test Split Task Contiguous',
      chunks: [
        { scheduledAt: tomorrowUTC(13), dur: 60 },
        { scheduledAt: tomorrowUTC(14), dur: 60 }
      ]
    });

    var res = await runSync();
    expect(res.statusCode).toBe(200);
    expect(res._json.pushed).toBeGreaterThanOrEqual(1);

    await waitForPropagation(1000);

    // Exactly one active ledger entry for the primary chunk id
    var ledgerRows = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, status: 'active' })
      .whereIn('task_id', task.chunkIds);
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].task_id).toBe(task.id);

    var event = await getGCalEvent(token, ledgerRows[0].provider_event_id);
    expect(event).toBeTruthy();
    expect(event.status).not.toBe('cancelled');

    // Title has no "(X/N)" suffix — contiguous full-cover run
    expect(event.summary).toBe(task.text);

    // Duration = 120 min total
    var durMs = new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime();
    expect(durMs / 60000).toBe(120);
  });

  test('non-contiguous chunks push as separate events with (X/N) suffix', async () => {
    if (shouldSkip()) return;

    // chunk1: 9–10 AM EDT (UTC 13), chunk2: 2–3 PM EDT (UTC 18)
    var task = await makeSplitTask({
      text: 'Test Split Task NonContig',
      chunks: [
        { scheduledAt: tomorrowUTC(13), dur: 60 },
        { scheduledAt: tomorrowUTC(18), dur: 60 }
      ]
    });

    var res = await runSync();
    expect(res.statusCode).toBe(200);
    expect(res._json.pushed).toBeGreaterThanOrEqual(2);

    await waitForPropagation(1000);

    // Two active ledger entries, one per chunk
    var ledgerRows = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, status: 'active' })
      .whereIn('task_id', task.chunkIds)
      .orderBy('task_id');
    expect(ledgerRows.length).toBe(2);

    for (var li = 0; li < ledgerRows.length; li++) {
      var event = await getGCalEvent(token, ledgerRows[li].provider_event_id);
      expect(event).toBeTruthy();
      expect(event.status).not.toBe('cancelled');

      // Each chunk gets its own "(X/2)" suffix
      var expectedSuffix = ledgerRows[li].task_id === task.id ? '(1/2)' : '(2/2)';
      expect(event.summary).toContain(expectedSuffix);

      // Each chunk duration = 60 min
      var durMs = new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime();
      expect(durMs / 60000).toBe(60);
    }
  });

  test('second sync is a no-op: hash match prevents re-push', async () => {
    if (shouldSkip()) return;

    var task = await makeSplitTask({
      text: 'Test Split Task Stable',
      chunks: [
        { scheduledAt: tomorrowUTC(13), dur: 60 },
        { scheduledAt: tomorrowUTC(18), dur: 60 }
      ]
    });

    var res1 = await runSync();
    expect(res1.statusCode).toBe(200);
    var firstPushCount = res1._json.pushed;
    expect(firstPushCount).toBeGreaterThanOrEqual(2);

    await waitForPropagation(500);

    user = await db('users').where('id', TEST_USER_ID).first();
    var res2 = await runSync();
    expect(res2.statusCode).toBe(200);
    expect(res2._json.pushed).toBe(0);
  });

  test('contiguous chunk follower has no separate ledger entry', async () => {
    if (shouldSkip()) return;

    var task = await makeSplitTask({
      text: 'Test Split Task Follower Clean',
      chunks: [
        { scheduledAt: tomorrowUTC(13), dur: 60 },
        { scheduledAt: tomorrowUTC(14), dur: 60 }
      ]
    });

    await runSync();
    await waitForPropagation(500);

    // Follower (chunk2) must have no ledger entry — it's covered by the merged leader event
    var followerLedger = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.chunkIds[1] })
      .first();
    expect(followerLedger).toBeUndefined();
  });
});

// ─── Path B: Legacy Cache-Based Splits ─────────────────────────────────────

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

describe('Split Task Expansion (legacy cache path)', () => {
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

    var timeMin = new Date(tomorrow);
    timeMin.setHours(0, 0, 0, 0);
    var timeMax = new Date(tomorrow);
    timeMax.setHours(23, 59, 59, 999);

    var events = await listGCalEvents(token, timeMin.toISOString(), timeMax.toISOString());
    var splitEvents = events.filter(function(e) {
      return (e.summary || '').indexOf('Test Task Long Split') >= 0;
    });

    expect(splitEvents.length).toBe(4);

    for (var i = 1; i <= 4; i++) {
      var found = splitEvents.find(function(e) {
        return (e.summary || '').indexOf('(part ' + i + '/4)') >= 0;
      });
      expect(found).toBeTruthy();
    }
  });

  test('each split part has correct duration', async () => {
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

      var evtStart = new Date(evt.start.dateTime);
      var evtEnd = new Date(evt.end.dateTime);
      expect((evtEnd - evtStart) / 60000).toBe(30);
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

    // First sync: no split placements → single event
    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);

    await waitForPropagation(3000);

    var ledgerBefore = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, task_id: task.id, provider: 'gcal', status: 'active' })
      .select();
    expect(ledgerBefore.length).toBe(1);
    var oldEventId = ledgerBefore[0].provider_event_id;
    expect(oldEventId).toBeTruthy();

    // Seed split placements
    var dateKey = (tomorrow.getMonth() + 1) + '/' + tomorrow.getDate();
    var cache = buildScheduleCache(task.id, dateKey, [
      { start: 540, dur: 30 },
      { start: 600, dur: 30 },
      { start: 660, dur: 30 },
      { start: 720, dur: 30 }
    ]);
    await seedScheduleCache(cache);

    user = await db('users').where('id', TEST_USER_ID).first();

    var req2 = mockReq(user);
    var res2 = mockRes();
    await sync(req2, res2);

    await waitForPropagation(3000);

    var oldEvent = await getGCalEvent(token, oldEventId);
    var isGone = !oldEvent || oldEvent.status === 'cancelled';
    expect(isGone).toBe(true);

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
