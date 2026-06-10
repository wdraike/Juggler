/**
 * 06-adapter-apple-edge.test.js — Apple CalDAV adapter edge cases (mock-based)
 *
 * Covers:
 *   BF-1  — Apple 401 clears apple_cal_password in DB
 *   null-data skip — listEvents silently skips objects with data: null
 *   507   — deleteEvent throws on quota-exceeded (non-404)
 *   404   — deleteEvent tolerates not-found gracefully
 *   BF-9  — checkForChanges trailing-slash normalization
 */

jest.setTimeout(30000);
jest.mock('../../src/scheduler/scheduleQueue', () => ({ enqueueScheduleRun: jest.fn() }));
jest.mock('../../src/lib/sse-emitter', () => ({ emit: jest.fn() }));

var appleCalApi = require('../../src/lib/apple-cal-api');
var appleAdapter = require('../../src/lib/cal-adapters/apple.adapter');
var { encrypt } = require('../../src/lib/credential-encrypt');
var { sync } = require('../../src/controllers/cal-sync.controller');
var {
  db, TEST_USER_ID, isDbAvailable, seedTestUser, cleanupTestData, destroyTestUser, mockReq, mockRes
} = require('./helpers/test-setup');
var { assertDbAvailable } = require('../helpers/requireDB');

afterEach(async () => {
  jest.restoreAllMocks();
  if (await isDbAvailable()) {
    await destroyTestUser();
  }
});

afterAll(async () => {
  if (await isDbAvailable()) {
    await destroyTestUser();
  }
  await db.destroy();
});

// ─── BF-1: Apple 401 clears apple_cal_password via sync() ────────────────────

describe('BF-1: Apple 401 clears apple_cal_password in DB', () => {
  it('clears apple_cal_password when createClient throws Unauthorized', async () => {
    await assertDbAvailable();

    var user = await seedTestUser({
      gcal_refresh_token: null,
      msft_cal_refresh_token: null,
      apple_cal_username: 'test@icloud.com',
      apple_cal_password: encrypt('test-app-specific-password'),
      apple_cal_server_url: 'https://caldav.icloud.com',
      apple_cal_calendar_url: 'https://p01-caldav.icloud.com/123456789/calendars/test-cal/'
    });

    jest.spyOn(appleCalApi, 'createClient').mockRejectedValue(new Error('Unauthorized'));

    var req = mockReq(user);
    var res = mockRes();
    await sync(req, res);

    var updated = await db('users').where('id', TEST_USER_ID).first();
    expect(updated.apple_cal_password).toBeNull();
  });
});

// ─── null-data skip ───────────────────────────────────────────────────────────

describe('listEvents: skips objects with data: null', () => {
  var GOOD_ICS = [
    'BEGIN:VCALENDAR\r\n',
    'VERSION:2.0\r\n',
    'BEGIN:VEVENT\r\n',
    'UID:event-good-{N}@test.com\r\n',
    'SUMMARY:Good Event {N}\r\n',
    'DTSTART:20260615T100000Z\r\n',
    'DTEND:20260615T110000Z\r\n',
    'DTSTAMP:20260615T000000Z\r\n',
    'END:VEVENT\r\n',
    'END:VCALENDAR\r\n'
  ].join('');

  function makeGoodIcs(n) {
    return GOOD_ICS.replace(/\{N\}/g, String(n));
  }

  it('returns only events from objects that have data, skips null-data objects', async () => {
    var mockClient = {
      fetchCalendarObjects: jest.fn().mockResolvedValue([
        { data: makeGoodIcs(1), url: 'https://cal.example.com/1.ics', etag: '"etag1"' },
        { data: null, url: 'https://cal.example.com/null.ics', etag: '"etagnull"' },
        { data: makeGoodIcs(2), url: 'https://cal.example.com/2.ics', etag: '"etag2"' }
      ])
    };

    var events = await appleCalApi.listEvents(
      mockClient,
      'https://p01-caldav.icloud.com/123456789/calendars/test-cal/',
      '2026-06-01T00:00:00Z',
      '2026-06-30T00:00:00Z'
    );

    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Good Event 1');
    expect(events[1].title).toBe('Good Event 2');
  });

  it('returns empty array when all objects have data: null', async () => {
    var mockClient = {
      fetchCalendarObjects: jest.fn().mockResolvedValue([
        { data: null, url: 'https://cal.example.com/a.ics', etag: '"a"' },
        { data: null, url: 'https://cal.example.com/b.ics', etag: '"b"' }
      ])
    };

    var events = await appleCalApi.listEvents(
      mockClient,
      'https://p01-caldav.icloud.com/123456789/calendars/test-cal/',
      '2026-06-01T00:00:00Z',
      '2026-06-30T00:00:00Z'
    );

    expect(events).toHaveLength(0);
  });

  it('returns all events when no null-data objects', async () => {
    var mockClient = {
      fetchCalendarObjects: jest.fn().mockResolvedValue([
        { data: makeGoodIcs(1), url: 'https://cal.example.com/1.ics', etag: '"etag1"' },
        { data: makeGoodIcs(2), url: 'https://cal.example.com/2.ics', etag: '"etag2"' }
      ])
    };

    var events = await appleCalApi.listEvents(
      mockClient,
      'https://p01-caldav.icloud.com/123456789/calendars/test-cal/',
      '2026-06-01T00:00:00Z',
      '2026-06-30T00:00:00Z'
    );

    expect(events).toHaveLength(2);
  });
});

// ─── deleteEvent 507 ─────────────────────────────────────────────────────────

describe('deleteEvent: 507 quota-exceeded throws', () => {
  it('throws on 507 Insufficient Storage', async () => {
    var mockClient = {
      deleteCalendarObject: jest.fn().mockResolvedValue({ status: 507 })
    };

    await expect(
      appleCalApi.deleteEvent(mockClient, 'https://cal.example.com/ev.ics', '"etag1"')
    ).rejects.toThrow(/507/);
  });

  it('throws on any non-404/410 error status >= 300', async () => {
    var mockClient = {
      deleteCalendarObject: jest.fn().mockResolvedValue({ status: 500 })
    };

    await expect(
      appleCalApi.deleteEvent(mockClient, 'https://cal.example.com/ev.ics', '"etag1"')
    ).rejects.toThrow(/500/);
  });
});

// ─── deleteEvent 404 tolerance ───────────────────────────────────────────────

describe('deleteEvent: 404/410 tolerance', () => {
  it('does not throw on 404 (event already gone)', async () => {
    var mockClient = {
      deleteCalendarObject: jest.fn().mockResolvedValue({ status: 404 })
    };

    await expect(
      appleCalApi.deleteEvent(mockClient, 'https://cal.example.com/ev.ics', '"etag1"')
    ).resolves.toBeUndefined();
  });

  it('does not throw on 410 Gone', async () => {
    var mockClient = {
      deleteCalendarObject: jest.fn().mockResolvedValue({ status: 410 })
    };

    await expect(
      appleCalApi.deleteEvent(mockClient, 'https://cal.example.com/ev.ics', '"etag1"')
    ).resolves.toBeUndefined();
  });

  it('does not throw when response is null (some CalDAV servers return nothing)', async () => {
    var mockClient = {
      deleteCalendarObject: jest.fn().mockResolvedValue(null)
    };

    await expect(
      appleCalApi.deleteEvent(mockClient, 'https://cal.example.com/ev.ics')
    ).resolves.toBeUndefined();
  });
});

// ─── BF-9: trailing-slash normalization ──────────────────────────────────────

describe('BF-9: checkForChanges trailing-slash URL normalization', () => {
  var CTAG_OLD = 'ctag-v1';
  var CTAG_NEW = 'ctag-v2';

  it('matches calendar when stored URL has trailing slash, server URL does not', async () => {
    var mockClient = {
      fetchCalendars: jest.fn().mockResolvedValue([
        {
          url: 'https://p01-caldav.icloud.com/123456789/calendars/test-cal',  // no trailing slash
          ctag: CTAG_NEW,
          syncToken: null
        }
      ])
    };

    // Stored URL has trailing slash
    var result = await appleCalApi.checkForChanges(
      mockClient,
      'https://p01-caldav.icloud.com/123456789/calendars/test-cal/',  // trailing slash
      CTAG_OLD
    );

    // Should detect change (ctag differs), not return hasChanges:true due to "calendar not found"
    expect(result.hasChanges).toBe(true);
    expect(result.syncToken).toBe(CTAG_NEW);
  });

  it('matches calendar when server URL has trailing slash, stored URL does not', async () => {
    var mockClient = {
      fetchCalendars: jest.fn().mockResolvedValue([
        {
          url: 'https://p01-caldav.icloud.com/123456789/calendars/test-cal/',  // trailing slash
          ctag: CTAG_NEW,
          syncToken: null
        }
      ])
    };

    var result = await appleCalApi.checkForChanges(
      mockClient,
      'https://p01-caldav.icloud.com/123456789/calendars/test-cal',  // no trailing slash
      CTAG_OLD
    );

    expect(result.hasChanges).toBe(true);
    expect(result.syncToken).toBe(CTAG_NEW);
  });

  it('returns hasChanges:false when ctag unchanged (trailing slashes match after normalization)', async () => {
    var mockClient = {
      fetchCalendars: jest.fn().mockResolvedValue([
        {
          url: 'https://p01-caldav.icloud.com/123456789/calendars/test-cal',
          ctag: CTAG_OLD,
          syncToken: null
        }
      ])
    };

    var result = await appleCalApi.checkForChanges(
      mockClient,
      'https://p01-caldav.icloud.com/123456789/calendars/test-cal/',
      CTAG_OLD
    );

    expect(result.hasChanges).toBe(false);
  });

  it('returns hasChanges:true when no storedSyncToken (initial sync)', async () => {
    var mockClient = { fetchCalendars: jest.fn() };

    var result = await appleCalApi.checkForChanges(mockClient, 'https://some-url/cal/', null);

    expect(result.hasChanges).toBe(true);
    expect(mockClient.fetchCalendars).not.toHaveBeenCalled();
  });

  it('returns hasChanges:true when calendar URL not found in fetchCalendars result', async () => {
    var mockClient = {
      fetchCalendars: jest.fn().mockResolvedValue([
        {
          url: 'https://p01-caldav.icloud.com/123456789/calendars/OTHER-cal/',
          ctag: 'different-ctag',
          syncToken: null
        }
      ])
    };

    var result = await appleCalApi.checkForChanges(
      mockClient,
      'https://p01-caldav.icloud.com/123456789/calendars/test-cal/',
      CTAG_OLD
    );

    // Calendar not found → assume changes
    expect(result.hasChanges).toBe(true);
  });
});
