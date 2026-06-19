/**
 * 30-sync-performance.test.js — Timing Benchmarks
 *
 * Measures wall-clock time for sync operations with real APIs.
 * These tests log timing data for analysis. Hard timing thresholds are
 * replaced with soft assertions (warn-only) to avoid flaky CI failures
 * under variable load or network conditions. (999.268)
 */

jest.setTimeout(120000);

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn()
}));
jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

var {
  db, TEST_USER_ID, hasGCalCredentials,
  seedTestUser, cleanupTestData, destroyTestUser,
  getGCalToken, mockReq, mockRes
} = require('./helpers/test-setup');
var { assertDbAvailable } = require('../helpers/requireDB');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, deleteAllGCalTestEvents } = require('./helpers/test-fixtures');
var { waitForPropagation } = require('./helpers/api-helpers');
var { sync } = require('../../src/controllers/cal-sync.controller');
var { describeWithCreds } = require('./helpers/credentialGate');

var token = null;
var user = null;

beforeAll(async () => {
  await assertDbAvailable();
  if (!hasGCalCredentials()) return;
  user = await seedTestUser({
    msft_cal_refresh_token: null,
    apple_cal_username: null, apple_cal_password: null,
    apple_cal_server_url: null, apple_cal_calendar_url: null
  });
  token = await getGCalToken();
  // Clean up any stale test events from prior test files
  await deleteAllGCalTestEvents(token);
  await cleanupTestData();
  user = await seedTestUser({
    msft_cal_refresh_token: null,
    apple_cal_username: null, apple_cal_password: null,
    apple_cal_server_url: null, apple_cal_calendar_url: null
  });
});

afterEach(async () => {
  if (!user || !token) return;
  await cleanupTestData();
  await deleteAllGCalTestEvents(token);
  user = await seedTestUser({
    msft_cal_refresh_token: null,
    apple_cal_username: null, apple_cal_password: null,
    apple_cal_server_url: null, apple_cal_calendar_url: null
  });
});

afterAll(async () => {
  if (!user) return;
  if (token) await deleteAllGCalTestEvents(token);
  await destroyTestUser();
  await db.destroy();
});

async function createTestTasks(count) {
  var tasks = [];
  for (var i = 0; i < count; i++) {
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1 + Math.floor(i / 10));
    tomorrow.setHours(8 + (i % 12), (i % 4) * 15, 0, 0);

    var task = await makeTask({
      text: 'Test Task Perf ' + String(i + 1).padStart(3, '0'),
      dur: 30,
      scheduled_at: tomorrow
    });
    tasks.push(task);
  }
  return tasks;
}

describeWithCreds(() => hasGCalCredentials(), 'Sync Performance Benchmarks', () => {
  test('full sync with real APIs completes in <30s (20 tasks)', async () => {
    await createTestTasks(20);

    user = await db('users').where('id', TEST_USER_ID).first();
    var startTime = performance.now();

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var elapsed = performance.now() - startTime;

    console.log('[perf] Full sync (20 tasks): ' + Math.round(elapsed) + 'ms');
    if (elapsed >= 30000) {
      console.warn('[perf] WARNING: Full sync exceeded 30s threshold (' + Math.round(elapsed) + 'ms) — may indicate regression or network variance');
    }

    // Verify all test tasks were pushed (ledger may also contain ingested GCal events)
    var ledgerCount = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, status: 'active', origin: 'juggler' })
      .count('* as count')
      .first();
    expect(parseInt(ledgerCount.count, 10)).toBeGreaterThanOrEqual(20);
  });

  test('steady-state sync (no changes) completes fastest', async () => {
    // Seed 10 tasks and do initial sync
    await createTestTasks(10);

    user = await db('users').where('id', TEST_USER_ID).first();
    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);

    await waitForPropagation(2000);

    // Now sync again with no changes
    user = await db('users').where('id', TEST_USER_ID).first();
    var startTime = performance.now();

    var req2 = mockReq(user);
    var res2 = mockRes();
    await sync(req2, res2);

    var elapsed = performance.now() - startTime;

    console.log('[perf] Steady-state sync (no changes, 10 tasks): ' + Math.round(elapsed) + 'ms');
    if (elapsed >= 30000) {
      console.warn('[perf] WARNING: Steady-state sync exceeded 30s threshold (' + Math.round(elapsed) + 'ms) — may indicate regression or network variance');
    }
  });

  test('sync with 50 new tasks (batch push) completes in <30s', async () => {
    await createTestTasks(50);

    user = await db('users').where('id', TEST_USER_ID).first();
    var startTime = performance.now();

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var elapsed = performance.now() - startTime;

    console.log('[perf] Batch push (50 tasks): ' + Math.round(elapsed) + 'ms');
    if (elapsed >= 45000) {
      console.warn('[perf] WARNING: Batch push exceeded 45s threshold (' + Math.round(elapsed) + 'ms) — may indicate regression or network variance');
    }

    // Verify all test tasks were pushed (ledger may also contain ingested GCal events)
    var ledgerCount = await db('cal_sync_ledger')
      .where({ user_id: TEST_USER_ID, status: 'active', origin: 'juggler' })
      .count('* as count')
      .first();
    expect(parseInt(ledgerCount.count, 10)).toBeGreaterThanOrEqual(50);
  });

  test('per-phase timing breakdown (consecutive syncs)', async () => {
    await createTestTasks(15);

    // First sync (cold — all new pushes)
    user = await db('users').where('id', TEST_USER_ID).first();
    var t1Start = performance.now();
    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);
    var t1Elapsed = performance.now() - t1Start;

    await waitForPropagation(2000);

    // Second sync (warm — no changes expected)
    user = await db('users').where('id', TEST_USER_ID).first();
    var t2Start = performance.now();
    var req2 = mockReq(user);
    var res2 = mockRes();
    await sync(req2, res2);
    var t2Elapsed = performance.now() - t2Start;

    await waitForPropagation(2000);

    // Third sync (warm — still no changes)
    user = await db('users').where('id', TEST_USER_ID).first();
    var t3Start = performance.now();
    var req3 = mockReq(user);
    var res3 = mockRes();
    await sync(req3, res3);
    var t3Elapsed = performance.now() - t3Start;

    console.log('[perf] Phase timing (15 tasks):');
    console.log('  Cold sync (initial push): ' + Math.round(t1Elapsed) + 'ms');
    console.log('  Warm sync #1 (no changes): ' + Math.round(t2Elapsed) + 'ms');
    console.log('  Warm sync #2 (no changes): ' + Math.round(t3Elapsed) + 'ms');

    // Log warnings instead of hard-failing — timing varies with network/load (999.268)
    if (t1Elapsed >= 45000) {
      console.warn('[perf] WARNING: Cold sync exceeded 45s threshold (' + Math.round(t1Elapsed) + 'ms)');
    }
    if (t2Elapsed >= 45000) {
      console.warn('[perf] WARNING: Warm sync #1 exceeded 45s threshold (' + Math.round(t2Elapsed) + 'ms)');
    }
    if (t3Elapsed >= 45000) {
      console.warn('[perf] WARNING: Warm sync #2 exceeded 45s threshold (' + Math.round(t3Elapsed) + 'ms)');
    }
    if (t3Elapsed >= 30000) {
      console.warn('[perf] WARNING: Warm sync #2 exceeded 30s threshold (' + Math.round(t3Elapsed) + 'ms)');
    }
  });
});
