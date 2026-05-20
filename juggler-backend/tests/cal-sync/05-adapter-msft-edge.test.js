/**
 * 05-adapter-msft-edge.test.js — MSFT adapter edge cases
 *
 * DB-dependent tests (BF-2) require the test DB; they self-skip when unavailable.
 * Pure unit tests (BF-8, normalizeEvent, buildMsftEventBody) run without DB.
 */
jest.setTimeout(30000);

var db = require('../../src/db');
var msftAdapter = require('../../src/lib/cal-adapters/msft.adapter');
var msftCalApi = require('../../src/lib/msft-cal-api');

var TEST_USER_ID = 'msft-edge-test-001';
var dbAvailable = false;

beforeAll(async () => {
  try {
    await db.raw('SELECT 1');
    dbAvailable = true;
  } catch (e) {
    console.warn('[05-adapter-msft-edge] Test DB not available — BF-2 tests skipped:', e.message);
  }
});

async function seedUser(overrides) {
  await db('users').where('id', TEST_USER_ID).del();
  var base = {
    id: TEST_USER_ID,
    email: 'msft-edge@test.com',
    name: 'MSFT Edge Test',
    timezone: 'America/New_York',
    msft_cal_refresh_token: 'valid-refresh',
    msft_cal_access_token: 'valid-access',
    msft_cal_token_expiry: new Date(Date.now() + 60 * 60 * 1000),
    msft_cal_delta_link: overrides.msft_cal_delta_link !== undefined
      ? overrides.msft_cal_delta_link : 'stale-delta-link',
    created_at: new Date(),
    updated_at: new Date()
  };
  await db('users').insert({ ...base, ...overrides });
  return db('users').where('id', TEST_USER_ID).first();
}

afterEach(async () => {
  jest.restoreAllMocks();
  if (dbAvailable) {
    await db('users').where('id', TEST_USER_ID).del();
  }
});
afterAll(async () => {
  if (dbAvailable) {
    await db('users').where('id', TEST_USER_ID).del();
  }
  await db.destroy();
});

describe('BF-2: delta link cleared on 410 (tokenInvalid)', () => {
  it('clears msft_cal_delta_link in DB when checkForChanges throws 410', async () => {
    if (!dbAvailable) return;
    var user = await seedUser({ msft_cal_delta_link: 'stale-link-that-causes-410' });

    jest.spyOn(msftCalApi, 'checkForChanges').mockRejectedValue(
      Object.assign(new Error('Graph API error 410: syncStateNotFound'), { statusCode: 410 })
    );

    var result = await msftAdapter.hasChanges('any-token', user);

    expect(result.hasChanges).toBe(true);
    var updated = await db('users').where('id', TEST_USER_ID).first();
    expect(updated.msft_cal_delta_link).toBeNull();
  });

  it('null delta link returns hasChanges:true immediately (full sync)', async () => {
    if (!dbAvailable) return;
    var user = await seedUser({ msft_cal_delta_link: null });

    var spy = jest.spyOn(msftCalApi, 'checkForChanges');
    var result = await msftAdapter.hasChanges('any-token', user);
    expect(result.hasChanges).toBe(true);
    expect(result.tokenInvalid).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('BF-8: $select includes critical fields', () => {
  it('listEvents $select contains isCancelled, type, seriesMasterId, sensitivity, responseStatus', () => {
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.join(__dirname, '../../src/lib/msft-cal-api.js'), 'utf8'
    );
    // Find the $select string in the source
    var selectMatch = src.match(/'\$select'\s*:\s*'([^']+)'/);
    var selectFields = selectMatch ? selectMatch[1] : '';
    expect(selectFields).toContain('isCancelled');
    expect(selectFields).toContain('type');
    expect(selectFields).toContain('seriesMasterId');
    expect(selectFields).toContain('sensitivity');
    expect(selectFields).toContain('responseStatus');
  });
});

describe('normalizeEvent: isCancelled field exposed', () => {
  it('isCancelled:true event has isCancelled:true in normalized output', () => {
    var event = {
      id: 'cancelled-event-1',
      subject: 'Cancelled meeting',
      start: { dateTime: '2026-06-01T10:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-06-01T11:00:00.0000000', timeZone: 'UTC' },
      isAllDay: false, showAs: 'busy',
      lastModifiedDateTime: '2026-05-15T10:00:00Z',
      body: { content: 'Notes', contentType: 'text' },
      isCancelled: true, type: 'singleInstance', seriesMasterId: null,
      sensitivity: 'normal', responseStatus: { response: 'none' }
    };
    var norm = msftAdapter.normalizeEvent(event);
    expect(norm.isCancelled).toBe(true);
  });
});

describe('normalizeEvent: occurrence type and seriesMasterId', () => {
  it('occurrence type and seriesMasterId exposed', () => {
    var event = {
      id: 'occ-1', subject: 'Weekly meeting',
      start: { dateTime: '2026-06-01T10:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-06-01T11:00:00.0000000', timeZone: 'UTC' },
      isAllDay: false, showAs: 'busy',
      lastModifiedDateTime: '2026-05-15T10:00:00Z',
      body: { content: '', contentType: 'text' },
      isCancelled: false, type: 'occurrence', seriesMasterId: 'master-event-id',
      sensitivity: 'normal', responseStatus: { response: 'accepted' }
    };
    var norm = msftAdapter.normalizeEvent(event);
    expect(norm.eventType).toBe('occurrence');
    expect(norm.seriesMasterId).toBe('master-event-id');
  });
});

describe('normalizeEvent: allday event', () => {
  it('allday event has isAllDay:true and truncated startDateTime', () => {
    var event = {
      id: 'allday-1', subject: 'All day',
      start: { dateTime: '2026-06-15T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-06-16T00:00:00.0000000', timeZone: 'UTC' },
      isAllDay: true, showAs: 'free',
      lastModifiedDateTime: '2026-05-15T10:00:00Z',
      body: { content: '', contentType: 'text' },
      isCancelled: false, type: 'singleInstance', seriesMasterId: null,
      sensitivity: 'normal', responseStatus: { response: 'none' }
    };
    var norm = msftAdapter.normalizeEvent(event);
    expect(norm.isAllDay).toBe(true);
    // normalizeEvent preserves the datetime string (truncated to 6 fractional digits)
    // for allday events; date-only extraction is done by applyEventToTaskFields
    expect(norm.startDateTime).toBe('2026-06-15T00:00:00.000000Z');
  });
});

describe('buildMsftEventBody: absent fields (PATCH-safe)', () => {
  it('categories absent from output', () => {
    var task = {
      id: 't1', text: 'Meeting', date: '2026-06-01', time: '10:00 AM',
      dur: 30, when: 'morning', status: 'todo', url: null
    };
    var body = msftAdapter.buildMsftEventBody(task, 2026, 'America/New_York');
    expect(body).not.toHaveProperty('categories');
  });
});
