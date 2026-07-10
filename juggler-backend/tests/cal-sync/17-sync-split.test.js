/**
 * 17-sync-split.test.js — Split Task Calendar Sync
 *
 * Real chunk rows only: the scheduler writes task_instances rows with
 * split_ordinal/split_total > 1. Sync groups them by occurrence, merges
 * contiguous runs into one event, and pushes non-contiguous chunks as
 * separate events with "(X/N)" title suffixes.
 *
 * 999.1217 (W4, SCHEDULER-SPEC.md D6): the legacy cache-based "Path B" (splits
 * whose placement info lived ONLY in schedule_cache, from before 999.841 made
 * split chunks persist as their own task_instances rows) is removed along with
 * the schedule_cache read/write it exercised — there is no longer a code path
 * where a split task's placements exist ONLY in the cache.
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
  db, TEST_USER_ID, hasGCalCredentials,
  seedTestUser, cleanupTestData, destroyTestUser,
  getGCalToken, mockReq, mockRes
} = require('./helpers/test-setup');
var { assertDbAvailable } = require('../helpers/requireDB');
var { deleteAllGCalTestEvents } = require('./helpers/test-fixtures');
var { getGCalEvent, waitForPropagation } = require('./helpers/api-helpers');
var { sync } = require('../../src/controllers/cal-sync.controller');
var { describeWithCreds } = require('./helpers/credentialGate');

var GCAL_ONLY = { msft_cal_refresh_token: null, apple_cal_username: null, apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null };
var token = null;
var user = null;

beforeAll(async () => {
  await assertDbAvailable();
  if (!hasGCalCredentials()) return;
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
    placement_mode: 'fixed',
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

describeWithCreds(() => hasGCalCredentials(), 'Split: Real Chunk Rows (Path A)', () => {
  test('contiguous chunks merge into single GCal event with total duration', async () => {
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

// 999.1217 (W4): the legacy "Path B" cache-based split-expansion suite lived
// here (schedule_cache seeded directly, asserting synthetic "(part X/N)"
// events). Removed along with the schedule_cache read/write in
// cal-sync.controller.js / runSchedule.js — split placements now come only
// from real task_instances chunk rows (Path A, above).
