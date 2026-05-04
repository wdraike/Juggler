/**
 * Unit tests for apple-cal-api.js 412 ETag conflict handling.
 * Mocks the tsdav DAV client — no real iCloud credentials required.
 */

// Stub ical.js so buildVEvent doesn't need real imports
jest.mock('ical.js', function () {
  function makeTimeObj() {
    var t = {
      zone: null,
      clone: function () { return makeTimeObj(); },
      addDuration: jest.fn()
    };
    return t;
  }

  function MockTime(opts) {
    return makeTimeObj();
  }
  MockTime.now = jest.fn().mockReturnValue({});

  function MockDuration(opts) { return {}; }

  function MockComponent(name) {
    // Called as new ICAL.Component(['vcalendar', [], []]) for the calendar root
    var isCalendar = name === 'vcalendar' || (Array.isArray(name) && name[0] === 'vcalendar');
    if (isCalendar) {
      return {
        addSubcomponent: jest.fn(),
        addPropertyWithValue: jest.fn(),
        toString: jest.fn().mockReturnValue('BEGIN:VCALENDAR\nEND:VCALENDAR')
      };
    }
    return { addPropertyWithValue: jest.fn(), setComponent: jest.fn(), addSubcomponent: jest.fn() };
  }

  return {
    Component: MockComponent,
    Time: MockTime,
    Duration: MockDuration,
    TimezoneService: { get: jest.fn().mockReturnValue(null) },
    parse: jest.fn().mockReturnValue([]),
    Event: jest.fn().mockReturnValue({})
  };
});

// Stub tsdav — the module is only used for createClient/DAVNamespace, not directly in the functions we test
jest.mock('tsdav', function () {
  return {
    createDAVClient: jest.fn(),
    DAVNamespace: {}
  };
});

// We test the internal functions by requiring the module after mocking its dependencies.
// Since buildVEvent is complex and calls ical.js internally, we need to patch it.
// The easiest approach: require the module and monkey-patch buildVEvent for these tests.
var appleCalApi = require('../src/lib/apple-cal-api');

// Patch the module-internal buildVEvent used by createEvent/updateEvent.
// We expose it via a test-only hook by stubbing the ICS string in the mock above.

var CALENDAR_URL = 'https://caldav.icloud.com/123/calendars/home/';
var TASK = { id: 'task-42', text: 'Test Task', date: '5/5', time: '10:00 AM', dur: 30, when: 'morning' };
var YEAR = 2026;
var TZ = 'America/New_York';

// ─── createEvent 412 handling ───

describe('createEvent — 412 ETag conflict', function () {
  it('fetches current ETag and retries as update when createCalendarObject returns 412', async function () {
    var client = {
      createCalendarObject: jest.fn().mockResolvedValue({ status: 412 }),
      fetchCalendarObjects: jest.fn().mockResolvedValue([
        { url: CALENDAR_URL + 'juggler-task-42.ics', etag: '"etag-current-1"', data: 'BEGIN:VCALENDAR\nEND:VCALENDAR' }
      ]),
      updateCalendarObject: jest.fn().mockResolvedValue({ status: 204 })
    };

    var result = await appleCalApi.createEvent(client, CALENDAR_URL, TASK, YEAR, TZ);

    expect(client.fetchCalendarObjects).toHaveBeenCalledWith({
      calendar: { url: CALENDAR_URL },
      objectUrls: [CALENDAR_URL + 'juggler-task-42.ics']
    });
    expect(client.updateCalendarObject).toHaveBeenCalledWith({
      calendarObject: expect.objectContaining({
        url: CALENDAR_URL + 'juggler-task-42.ics',
        etag: '"etag-current-1"'
      })
    });
    expect(result.providerEventId).toBe(CALENDAR_URL + 'juggler-task-42.ics');
    expect(result.etag).toBe('"etag-current-1"');
  });

  it('proceeds with undefined ETag when fetchCalendarObjects returns empty on 412', async function () {
    var client = {
      createCalendarObject: jest.fn().mockResolvedValue({ status: 412 }),
      fetchCalendarObjects: jest.fn().mockResolvedValue([]),
      updateCalendarObject: jest.fn().mockResolvedValue({ status: 204 })
    };

    var result = await appleCalApi.createEvent(client, CALENDAR_URL, TASK, YEAR, TZ);

    expect(client.updateCalendarObject).toHaveBeenCalledWith({
      calendarObject: expect.objectContaining({
        url: CALENDAR_URL + 'juggler-task-42.ics',
        etag: undefined
      })
    });
    expect(result.providerEventId).toBe(CALENDAR_URL + 'juggler-task-42.ics');
  });

  it('proceeds with undefined ETag when fetchCalendarObjects throws on 412', async function () {
    var client = {
      createCalendarObject: jest.fn().mockResolvedValue({ status: 412 }),
      fetchCalendarObjects: jest.fn().mockRejectedValue(new Error('network error')),
      updateCalendarObject: jest.fn().mockResolvedValue({ status: 204 })
    };

    var result = await appleCalApi.createEvent(client, CALENDAR_URL, TASK, YEAR, TZ);

    expect(client.updateCalendarObject).toHaveBeenCalled();
    expect(result.providerEventId).toBe(CALENDAR_URL + 'juggler-task-42.ics');
  });

  it('throws when 412 fallback update also fails', async function () {
    var client = {
      createCalendarObject: jest.fn().mockResolvedValue({ status: 412 }),
      fetchCalendarObjects: jest.fn().mockResolvedValue([]),
      updateCalendarObject: jest.fn().mockResolvedValue({ status: 500 })
    };

    await expect(appleCalApi.createEvent(client, CALENDAR_URL, TASK, YEAR, TZ))
      .rejects.toThrow('CalDAV PUT failed: HTTP 500');
  });

  it('throws on non-412 error without attempting fallback', async function () {
    var client = {
      createCalendarObject: jest.fn().mockResolvedValue({ status: 403 }),
      fetchCalendarObjects: jest.fn(),
      updateCalendarObject: jest.fn()
    };

    await expect(appleCalApi.createEvent(client, CALENDAR_URL, TASK, YEAR, TZ))
      .rejects.toThrow('CalDAV PUT failed: HTTP 403');

    expect(client.fetchCalendarObjects).not.toHaveBeenCalled();
    expect(client.updateCalendarObject).not.toHaveBeenCalled();
  });

  it('handles calendarUrl without trailing slash', async function () {
    var noSlashUrl = 'https://caldav.icloud.com/123/calendars/home';
    var client = {
      createCalendarObject: jest.fn().mockResolvedValue({ status: 412 }),
      fetchCalendarObjects: jest.fn().mockResolvedValue([]),
      updateCalendarObject: jest.fn().mockResolvedValue({ status: 204 })
    };

    var result = await appleCalApi.createEvent(client, noSlashUrl, TASK, YEAR, TZ);

    // URL should be base/ + filename
    expect(result.providerEventId).toBe(noSlashUrl + '/juggler-task-42.ics');
  });
});

// ─── updateEvent 412 handling ───

describe('updateEvent — 412 ETag conflict', function () {
  var EVENT_URL = CALENDAR_URL + 'juggler-task-42.ics';

  it('fetches fresh ETag and retries when updateCalendarObject returns 412', async function () {
    var client = {
      updateCalendarObject: jest.fn()
        .mockResolvedValueOnce({ status: 412 })
        .mockResolvedValueOnce({ status: 204 }),
      fetchCalendarObjects: jest.fn().mockResolvedValue([
        { url: EVENT_URL, etag: '"etag-fresh-99"', data: 'BEGIN:VCALENDAR\nEND:VCALENDAR' }
      ])
    };

    await appleCalApi.updateEvent(client, EVENT_URL, TASK, YEAR, TZ);

    expect(client.fetchCalendarObjects).toHaveBeenCalledWith({
      calendar: { url: CALENDAR_URL },
      objectUrls: [EVENT_URL]
    });
    expect(client.updateCalendarObject).toHaveBeenCalledTimes(2);
    expect(client.updateCalendarObject).toHaveBeenLastCalledWith({
      calendarObject: expect.objectContaining({
        url: EVENT_URL,
        etag: '"etag-fresh-99"'
      })
    });
  });

  it('retries with undefined ETag when ETag fetch fails on 412', async function () {
    var client = {
      updateCalendarObject: jest.fn()
        .mockResolvedValueOnce({ status: 412 })
        .mockResolvedValueOnce({ status: 204 }),
      fetchCalendarObjects: jest.fn().mockRejectedValue(new Error('timeout'))
    };

    await appleCalApi.updateEvent(client, EVENT_URL, TASK, YEAR, TZ);

    expect(client.updateCalendarObject).toHaveBeenCalledTimes(2);
    expect(client.updateCalendarObject).toHaveBeenLastCalledWith({
      calendarObject: expect.objectContaining({ url: EVENT_URL, etag: undefined })
    });
  });

  it('throws when 412 retry also fails', async function () {
    var client = {
      updateCalendarObject: jest.fn()
        .mockResolvedValueOnce({ status: 412 })
        .mockResolvedValueOnce({ status: 412 }),
      fetchCalendarObjects: jest.fn().mockResolvedValue([])
    };

    await expect(appleCalApi.updateEvent(client, EVENT_URL, TASK, YEAR, TZ))
      .rejects.toThrow('CalDAV PUT failed: HTTP 412');
  });

  it('throws on non-412 error without attempting retry', async function () {
    var client = {
      updateCalendarObject: jest.fn().mockResolvedValue({ status: 401 }),
      fetchCalendarObjects: jest.fn()
    };

    await expect(appleCalApi.updateEvent(client, EVENT_URL, TASK, YEAR, TZ))
      .rejects.toThrow('CalDAV PUT failed: HTTP 401');

    expect(client.fetchCalendarObjects).not.toHaveBeenCalled();
    expect(client.updateCalendarObject).toHaveBeenCalledTimes(1);
  });

  it('does not throw on 404 (event already deleted on server)', async function () {
    var client = {
      updateCalendarObject: jest.fn().mockResolvedValue({ status: 404 }),
      fetchCalendarObjects: jest.fn()
    };

    await expect(appleCalApi.updateEvent(client, EVENT_URL, TASK, YEAR, TZ)).resolves.toBeUndefined();
    expect(client.fetchCalendarObjects).not.toHaveBeenCalled();
  });
});
