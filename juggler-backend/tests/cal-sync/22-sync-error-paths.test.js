/**
 * 22-sync-error-paths.test.js — Error path coverage
 */
jest.setTimeout(60000);
jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

var {
  db, TEST_USER_ID, isDbAvailable, seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes
} = require('./helpers/test-setup');
var { makeTask, makeLedgerRow } = require('./helpers/test-fixtures');
var { sync } = require('../../src/controllers/cal-sync.controller');
var gcalAdapter = require('../../src/lib/cal-adapters/gcal.adapter');

var GCAL_ONLY = {
  msft_cal_refresh_token: null, apple_cal_username: null,
  apple_cal_password: null, apple_cal_server_url: null, apple_cal_calendar_url: null
};

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

describe('BF-3: 410 on PATCH transitions ledger to deleted_remote', () => {
  it('ledger row becomes deleted_remote when updateEvent returns 410', async () => {
    if (!await isDbAvailable()) return;
    var user = await seedTestUser(GCAL_ONLY);

    var task = await makeTask({
      user_id: user.id,
      text: 'Meeting',
      scheduled_at: new Date('2026-06-01T14:00:00Z'),
      dur: 30,
      when: 'morning'
    });

    var ledgerRow = await makeLedgerRow({
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
