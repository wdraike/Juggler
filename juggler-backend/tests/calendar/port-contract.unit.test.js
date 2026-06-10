/**
 * Port-contract unit test for the calendar hexagonal slice (Wave 2 / W1).
 *
 * Pure unit — no DB, no live credentials. Asserts:
 *   1. CALENDAR_PORT_METHODS is exactly the README's required-method set.
 *   2. SYNC_STATE_REPOSITORY_PORT_METHODS is the minimal sync-state contract.
 *   3. The EventId / ProviderType value objects construct + reject correctly.
 *   4. The CalendarEvent / SyncState entities accept the README shapes and the
 *      real provider-adapter shapes without throwing.
 */

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', 'src', 'slices', 'calendar', 'domain');

var CalendarPort = require(path.join(SLICE, 'ports', 'CalendarPort'));
var SyncStateRepositoryPort = require(path.join(SLICE, 'ports', 'SyncStateRepositoryPort'));
var CalendarEvent = require(path.join(SLICE, 'entities', 'CalendarEvent'));
var SyncState = require(path.join(SLICE, 'entities', 'SyncState'));
var EventId = require(path.join(SLICE, 'value-objects', 'EventId'));
var ProviderType = require(path.join(SLICE, 'value-objects', 'ProviderType'));

describe('calendar slice — CalendarPort contract', function () {
  // The required-method set documented in src/slices/calendar/README.md.
  var README_REQUIRED = [
    'providerId',
    'isConnected',
    'getValidAccessToken',
    'getEvents',
    'createEvent',
    'updateEvent',
    'deleteEvent',
    'sync',
    'getEventIdColumn',
    'getLastSyncedColumn'
  ];

  test('CALENDAR_PORT_METHODS exists and is frozen', function () {
    expect(Array.isArray(CalendarPort.CALENDAR_PORT_METHODS)).toBe(true);
    expect(Object.isFrozen(CalendarPort.CALENDAR_PORT_METHODS)).toBe(true);
  });

  test('CALENDAR_PORT_METHODS is EXACTLY the README required-method set', function () {
    // Same membership (order-independent) and same length (no extras, none missing).
    expect(CalendarPort.CALENDAR_PORT_METHODS.slice().sort())
      .toEqual(README_REQUIRED.slice().sort());
    expect(CalendarPort.CALENDAR_PORT_METHODS.length).toBe(README_REQUIRED.length);
  });

  test('optional methods are documented and disjoint from required', function () {
    var optional = CalendarPort.CALENDAR_PORT_OPTIONAL_METHODS;
    expect(Array.isArray(optional)).toBe(true);
    optional.forEach(function (m) {
      expect(README_REQUIRED.indexOf(m)).toBe(-1);
    });
    expect(optional).toEqual(
      expect.arrayContaining([
        'batchCreateEvents', 'batchDeleteEvents', 'applyEventToTaskFields',
        'eventHash', 'normalizeEvent', 'getEnabledCalendars', 'getWriteCalendar'
      ])
    );
  });
});

describe('calendar slice — SyncStateRepositoryPort contract', function () {
  test('SYNC_STATE_REPOSITORY_PORT_METHODS is frozen and complete', function () {
    var m = SyncStateRepositoryPort.SYNC_STATE_REPOSITORY_PORT_METHODS;
    expect(Array.isArray(m)).toBe(true);
    expect(Object.isFrozen(m)).toBe(true);
    expect(m.slice().sort()).toEqual([
      'clearSyncToken',
      'getLastSyncedAt',
      'getSyncState',
      'getSyncToken',
      'setLastSyncedAt',
      'setSyncToken'
    ]);
  });
});

describe('calendar slice — EventId value object', function () {
  test('constructs from a non-empty string and stringifies', function () {
    var id = new EventId('evt-abc-123');
    expect(id.value).toBe('evt-abc-123');
    expect(id.toString()).toBe('evt-abc-123');
    expect(String(id)).toBe('evt-abc-123');
  });

  test('value equality', function () {
    expect(new EventId('x').equals(new EventId('x'))).toBe(true);
    expect(new EventId('x').equals(new EventId('y'))).toBe(false);
    expect(new EventId('x').equals('x')).toBe(false);
  });

  test('EventId.from is idempotent', function () {
    var id = new EventId('z');
    expect(EventId.from(id)).toBe(id);
    expect(EventId.from('z').equals(id)).toBe(true);
  });

  test('rejects empty / non-string values', function () {
    expect(function () { return new EventId(''); }).toThrow(TypeError);
    expect(function () { return new EventId(null); }).toThrow(TypeError);
    expect(function () { return new EventId(undefined); }).toThrow(TypeError);
    expect(function () { return new EventId(42); }).toThrow(TypeError);
  });

  test('is immutable', function () {
    var id = new EventId('frozen');
    expect(Object.isFrozen(id)).toBe(true);
  });
});

describe('calendar slice — ProviderType value object', function () {
  test('accepts every valid provider', function () {
    ['gcal', 'msft', 'apple', 'memory'].forEach(function (p) {
      expect(new ProviderType(p).value).toBe(p);
      expect(ProviderType.isValid(p)).toBe(true);
    });
  });

  test('rejects unknown providers', function () {
    expect(function () { return new ProviderType('yahoo'); }).toThrow(TypeError);
    expect(function () { return new ProviderType(''); }).toThrow(TypeError);
    expect(function () { return new ProviderType(null); }).toThrow(TypeError);
    expect(ProviderType.isValid('yahoo')).toBe(false);
  });

  test('equality + from idempotence', function () {
    expect(new ProviderType('gcal').equals(new ProviderType('gcal'))).toBe(true);
    expect(new ProviderType('gcal').equals(new ProviderType('msft'))).toBe(false);
    var t = new ProviderType('apple');
    expect(ProviderType.from(t)).toBe(t);
  });
});

describe('calendar slice — CalendarEvent entity', function () {
  test('accepts the README "Event Object Shape" verbatim', function () {
    var shape = {
      id: 'event-id-123',
      title: 'Event Title',
      description: 'Event description',
      startDateTime: '2026-05-28T14:00:00Z',
      endDateTime: '2026-05-28T15:00:00Z',
      startTimezone: 'America/New_York',
      isAllDay: false,
      durationMinutes: 60,
      lastModified: '2026-05-28T10:00:00Z',
      isTransparent: false,
      eventUrl: 'https://calendar.google.com/...',
      calendarId: null,
      _raw: { foo: 'bar' }
    };
    var ev = new CalendarEvent(shape);
    expect(ev.id).toBe('event-id-123');
    expect(ev.title).toBe('Event Title');
    expect(ev.startDateTime).toBe('2026-05-28T14:00:00Z');
    expect(ev.durationMinutes).toBe(60);
    expect(ev.isAllDay).toBe(false);
    expect(ev.eventUrl).toBe('https://calendar.google.com/...');
    expect(ev._raw).toEqual({ foo: 'bar' });
  });

  test('accepts the Apple adapter normalized shape (_url/_etag, no eventUrl)', function () {
    var appleShape = {
      id: 'https://caldav.icloud.com/.../abc.ics',
      title: '(No title)',
      description: '',
      startDateTime: '2026-05-28T14:00:00Z',
      endDateTime: '2026-05-28T15:00:00Z',
      startTimezone: null,
      isAllDay: false,
      durationMinutes: 30,
      lastModified: null,
      isTransparent: false,
      _url: 'https://caldav.icloud.com/.../abc.ics',
      _etag: '"etag-123"',
      _raw: null
    };
    var ev = new CalendarEvent(appleShape);
    expect(ev.eventUrl).toBe('https://caldav.icloud.com/.../abc.ics');
    expect(ev._url).toBe('https://caldav.icloud.com/.../abc.ics');
    expect(ev._etag).toBe('"etag-123"');
  });

  test('accepts the MSFT adapter normalized shape (extra cancel/series fields)', function () {
    var msftShape = {
      id: 'AAMk...',
      title: 'Standup',
      description: 'notes',
      startDateTime: '2026-05-28T14:00:00Z',
      endDateTime: '2026-05-28T14:30:00Z',
      startTimezone: 'UTC',
      isAllDay: false,
      durationMinutes: 30,
      lastModified: '2026-05-28T10:00:00Z',
      isTransparent: true,
      isCancelled: false,
      eventType: 'singleInstance',
      seriesMasterId: null,
      eventUrl: 'https://outlook.office365.com/...',
      _raw: {}
    };
    var ev = new CalendarEvent(msftShape);
    expect(ev.isTransparent).toBe(true);
    expect(ev.isCancelled).toBe(false);
    expect(ev.eventType).toBe('singleInstance');
  });

  test('does not throw on an empty/partial object and applies defaults', function () {
    expect(function () { return new CalendarEvent(); }).not.toThrow();
    expect(function () { return new CalendarEvent({}); }).not.toThrow();
    var ev = new CalendarEvent({});
    expect(ev.title).toBe('(No title)');
    expect(ev.durationMinutes).toBe(30);
    expect(ev.isAllDay).toBe(false);
    expect(ev.id).toBe('');
  });

  test('CalendarEvent.from is idempotent', function () {
    var ev = new CalendarEvent({ id: 'a' });
    expect(CalendarEvent.from(ev)).toBe(ev);
  });
});

describe('calendar slice — SyncState entity', function () {
  test('constructs and reports needsFullSync correctly', function () {
    var fresh = new SyncState({ userId: 7, providerId: 'gcal' });
    expect(fresh.userId).toBe(7);
    expect(fresh.providerId).toBe('gcal');
    expect(fresh.lastSyncedAt).toBe(null);
    expect(fresh.needsFullSync()).toBe(true);

    var synced = new SyncState({
      userId: 7,
      providerId: 'msft',
      lastSyncedAt: new Date('2026-05-28T10:00:00Z'),
      syncToken: 'delta-link-xyz',
      eventIdColumn: 'msft_event_id'
    });
    expect(synced.needsFullSync()).toBe(false);
    expect(synced.syncToken).toBe('delta-link-xyz');
    expect(synced.eventIdColumn).toBe('msft_event_id');
  });
});
