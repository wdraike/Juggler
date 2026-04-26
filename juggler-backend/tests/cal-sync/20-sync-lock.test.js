/**
 * 20-sync-lock.test.js — Concurrency / Sync Lock Tests
 *
 * Tests that the sync engine acquires and releases the write lock correctly,
 * detects mid-sync mutations via the watermark, and releases locks on error.
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
  getGCalToken, mockReq, mockRes
} = require('./helpers/test-setup');
var tasksWrite = require('../../src/lib/tasks-write');
var { makeTask, deleteAllGCalTestEvents } = require('./helpers/test-fixtures');
var { waitForPropagation } = require('./helpers/api-helpers');
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
  // Make sure locks are cleaned up even if test fails
  await db('sync_locks').where('user_id', TEST_USER_ID).del();
  await cleanupTestData();
  await deleteAllGCalTestEvents(token);
  user = await seedTestUser(GCAL_ONLY);
});

afterAll(async () => {
  if (!user) return;
  await db('sync_locks').where('user_id', TEST_USER_ID).del();
  if (token) await deleteAllGCalTestEvents(token);
  await destroyTestUser();
  await db.destroy();
});

describe('Sync Lock / Concurrency', () => {
  var shouldSkip = () => !user || !token;

  test('write phase acquires and releases lock', async () => {
    if (shouldSkip()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    await makeTask({
      text: 'Test Task Lock Check',
      dur: 30,
      scheduled_at: tomorrow
    });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    // After sync completes, lock should be released
    var locks = await db('sync_locks')
      .where('user_id', TEST_USER_ID)
      .select();
    expect(locks.length).toBe(0);
  });

  test('mid-sync task edit detected by watermark', async () => {
    if (shouldSkip()) return;

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    var task = await makeTask({
      text: 'Test Task Watermark Original',
      dur: 30,
      scheduled_at: tomorrow
    });

    // First sync: push the task to establish ledger
    var req1 = mockReq(user);
    var res1 = mockRes();
    await sync(req1, res1);

    await waitForPropagation(2000);

    // Now simulate a mid-sync edit: update the task text directly in DB
    // with a future timestamp (simulating MCP edit that happened after
    // the watermark was captured)
    var futureTime = new Date();
    futureTime.setMinutes(futureTime.getMinutes() + 5);
    await tasksWrite.updateTaskById(db, task.id, {
      text: 'Test Task Watermark Edited',
      updated_at: futureTime
    }, TEST_USER_ID);

    // Re-read user (tokens may have been refreshed during first sync)
    user = await db('users').where('id', TEST_USER_ID).first();

    // Second sync: the task was modified after sync started gathering data,
    // so the sync should detect the watermark mismatch. The key behavior is
    // that the edited text should NOT be overwritten by provider data.
    var req2 = mockReq(user);
    var res2 = mockRes();
    await sync(req2, res2);

    // Verify the edited text is preserved (not reverted to provider's version)
    var taskAfterSync = await db('tasks_v').where('id', task.id).first();
    expect(taskAfterSync).toBeTruthy();
    expect(taskAfterSync.text).toBe('Test Task Watermark Edited');

    // Lock should be released
    var locks = await db('sync_locks')
      .where('user_id', TEST_USER_ID)
      .select();
    expect(locks.length).toBe(0);
  });

  test('lock released on error', async () => {
    if (shouldSkip()) return;

    // Corrupt the user's gcal_refresh_token to force a token refresh error
    // during the fetch phase, which should still result in lock cleanup
    var originalUser = await db('users').where('id', TEST_USER_ID).first();

    await db('users').where('id', TEST_USER_ID).update({
      gcal_refresh_token: 'deliberately-invalid-token-for-test'
    });

    var corruptedUser = await db('users').where('id', TEST_USER_ID).first();

    var req = mockReq(corruptedUser);
    var res = mockRes();

    // Sync may error or return an error status — either is fine
    try {
      await sync(req, res);
    } catch (e) {
      // Expected — error during token refresh
    }

    // Lock MUST be released even after error
    var locks = await db('sync_locks')
      .where('user_id', TEST_USER_ID)
      .select();
    expect(locks.length).toBe(0);

    // Restore valid token for cleanup
    await db('users').where('id', TEST_USER_ID).update({
      gcal_refresh_token: originalUser.gcal_refresh_token
    });
  });
});
