/**
 * 21-sync-auth-errors.test.js — Auth error edge cases
 */
jest.setTimeout(60000);
jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

var {
  db, TEST_USER_ID, isDbAvailable, seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes
} = require('./helpers/test-setup');
var { sync } = require('../../src/controllers/cal-sync.controller');

var appleCalApi = require('../../src/lib/apple-cal-api');
var { encrypt } = require('../../src/lib/credential-encrypt');

beforeAll(async () => {
  if (!await isDbAvailable()) return;
  await destroyTestUser();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await cleanupTestData();
});
afterAll(async () => {
  await destroyTestUser();
  await db.destroy();
});

describe('BF-1: Auth 401 clears correct provider credentials', () => {
  it('Apple 401: clears apple_cal_password, not MSFT columns', async () => {
    if (!await isDbAvailable()) return;
    var user = await seedTestUser({
      gcal_refresh_token: null,
      msft_cal_refresh_token: null,
      apple_cal_username: 'test@icloud.com',
      apple_cal_password: encrypt('app-specific-pw'),
      apple_cal_server_url: 'https://caldav.icloud.com',
      apple_cal_calendar_url: 'https://caldav.icloud.com/123/calendars/home/'
    });

    jest.spyOn(appleCalApi, 'createClient').mockRejectedValue(new Error('Unauthorized'));

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var updated = await db('users').where('id', TEST_USER_ID).first();
    // Apple credential cleared
    expect(updated.apple_cal_password).toBeNull();
    // MSFT columns untouched (were already null — just verify no corruption)
    expect(updated.msft_cal_refresh_token).toBeNull();
    expect(updated.msft_cal_access_token).toBeNull();
  });

  it('MSFT 401: clears msft_cal_ columns (not msft_ columns)', async () => {
    if (!await isDbAvailable()) return;
    var user = await seedTestUser({
      gcal_refresh_token: null,
      msft_cal_refresh_token: 'old-refresh',
      msft_cal_access_token: 'old-access',
      apple_cal_username: null
    });

    var msftCalApi = require('../../src/lib/msft-cal-api');
    jest.spyOn(msftCalApi, 'refreshAccessToken').mockRejectedValue(new Error('invalid_grant'));

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var updated = await db('users').where('id', TEST_USER_ID).first();
    expect(updated.msft_cal_refresh_token).toBeNull();
    expect(updated.msft_cal_access_token).toBeNull();
    expect(updated.msft_cal_token_expiry).toBeNull();
  });
});
