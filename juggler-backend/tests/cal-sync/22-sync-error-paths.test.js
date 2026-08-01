/**
 * 22-sync-error-paths.test.js — Error path coverage
 */
jest.setTimeout(60000);
jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

var {
  db, isDbAvailable, seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes
} = require('./helpers/test-setup');
var { assertDbAvailable } = require('../helpers/requireDB');
var { makeTask, makeLedgerRow } = require('./helpers/test-fixtures');
var { sync } = require('../../src/controllers/cal-sync.controller');
var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');
var msftAdapter = require('../../src/lib/cal-adapters/msft.adapter');

// 999.5070: gcal_refresh_token must be set EXPLICITLY. buildTestUser defaults it
// to process.env.TEST_GCAL_REFRESH_TOKEN, which only exists in the gitignored
// tests/.env.test — so on a dev box the seeded user was GCal-connected, and in
// CI it was not: getConnectedAdapters returned [], gatherProviderSyncData
// early-returned, updateEvent was never called, the 410 path never ran, and
// BF-3 saw the ledger still 'active'. A fake value is enough — every network
// entry point below is spied.
var GCAL_ONLY = {
  gcal_refresh_token: 'mock-gcal-token',
  msft_cal_refresh_token: null, apple_cal_username: null,
  apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null
};

beforeAll(async () => {
  await assertDbAvailable();
  await destroyTestUser();
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (await isDbAvailable()) await cleanupTestData();
});
afterAll(async () => {
  if (await isDbAvailable()) await destroyTestUser();
  await db.destroy();
});

describe('BF-3: 410 on PATCH transitions ledger to deleted_remote', () => {
  it('ledger row becomes deleted_remote when updateEvent returns 410', async () => {
    await assertDbAvailable();
    var user = await seedTestUser(GCAL_ONLY);

    // Future date — past tasks are not pushed/updated, so a hardcoded past date
    // meant updateEvent was never called and the 410 path never exercised.
    var task = await makeTask({
      user_id: user.id,
      text: 'Meeting',
      scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      dur: 30,
      when: 'morning'
    });

    await makeLedgerRow({
      user_id: user.id,
      task_id: task.id,
      provider: 'gcal',
      provider_event_id: 'gcal-event-abc',
      status: 'active',
      origin: 'juggler',
      last_pushed_hash: 'old-hash'
    });

    jest.spyOn(gcalAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
    jest.spyOn(gcalAdapter, 'listEvents').mockResolvedValue([{
      id: 'gcal-event-abc',
      title: 'Meeting',
      startDateTime: '2026-06-01T14:00:00Z',
      endDateTime: '2026-06-01T14:30:00Z',
      isAllDay: false,
      durationMinutes: 30,
      isTransparent: false,
      lastModified: new Date().toISOString(),
      _url: null,
      _etag: null,
      _raw: null
    }]);
    jest.spyOn(gcalAdapter, 'updateEvent').mockRejectedValue(
      new Error('Calendar API error 410: Resource has been deleted')
    );
    jest.spyOn(gcalAdapter, 'batchUpdateEvents').mockRejectedValue(
      new Error('Calendar API error 410: Resource has been deleted')
    );

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger').where({ task_id: task.id, provider: 'gcal' }).first();
    expect(ledger.status).toBe('deleted_remote');
    expect(ledger.provider_event_id).toBeNull();
  });
});

describe('MSFT 503 on listEvents: existing ledger rows unchanged', () => {
  it('503 on listEvents does not corrupt existing active ledger rows', async () => {
    await assertDbAvailable();
    var user = await seedTestUser({
      gcal_refresh_token: null,
      msft_cal_refresh_token: 'valid-refresh',
      msft_cal_access_token: 'valid-access',
      msft_cal_token_expiry: new Date(Date.now() + 3600000),
      apple_cal_username: null
    });

    var task = await makeTask({
      user_id: user.id,
      text: 'Existing task',
      scheduled_at: new Date('2026-06-01T14:00:00Z'),
      dur: 30,
      when: 'morning'
    });

    await makeLedgerRow({
      user_id: user.id,
      task_id: task.id,
      provider: 'msft',
      provider_event_id: 'msft-evt-1',
      status: 'active',
      last_pushed_hash: 'current-hash'
    });

    jest.spyOn(msftAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
    jest.spyOn(msftAdapter, 'hasChanges').mockResolvedValue({ hasChanges: true });
    jest.spyOn(msftAdapter, 'listEvents').mockRejectedValue(
      new Error('Graph API error 503: Service unavailable')
    );

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var ledger = await db('cal_sync_ledger').where({ task_id: task.id }).first();
    expect(ledger.status).toBe('active');
  });
});

describe('Sync response: HTTP 200 even on partial errors', () => {
  it('sync with a mock error still returns 200', async () => {
    await assertDbAvailable();
    var user = await seedTestUser({
      gcal_refresh_token: 'mock-gcal-token',
      msft_cal_refresh_token: null,
      apple_cal_username: null
    });

    jest.spyOn(gcalAdapter, 'getValidAccessToken').mockResolvedValue('mock-token');
    jest.spyOn(gcalAdapter, 'hasChanges').mockResolvedValue({ hasChanges: false });

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    expect(res.statusCode).toBe(200);
  });
});
