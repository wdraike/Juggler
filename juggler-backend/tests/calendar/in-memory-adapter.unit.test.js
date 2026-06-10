/**
 * Unit tests for InMemoryCalendarAdapter (Wave 3 / W3).
 *
 * Pure unit — no DB, no network, no credentials. Asserts:
 *   1. The adapter exposes every method in CALENDAR_PORT_METHODS.
 *   2. providerId === 'memory' and the column helpers return stable strings.
 *   3. CRUD round-trips through the in-memory store (create → read → update →
 *      delete), and getEvents filters by date window.
 *   4. clearAll() wipes state.
 */

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', 'src', 'slices', 'calendar');
var CalendarPort = require(path.join(SLICE, 'domain', 'ports', 'CalendarPort'));
var InMemory = require(path.join(SLICE, 'adapters', 'InMemoryCalendarAdapter'));

var USER_ID = 42;

afterEach(function () {
  InMemory.clearAll();
});

describe('InMemoryCalendarAdapter — CalendarPort conformance', function () {
  test('implements every CALENDAR_PORT_METHODS member', function () {
    CalendarPort.CALENDAR_PORT_METHODS.forEach(function (name) {
      expect(InMemory[name]).toBeDefined();
    });
  });

  test('providerId is "memory"', function () {
    expect(InMemory.providerId).toBe('memory');
  });

  test('column helpers return stable, namespaced strings', function () {
    expect(InMemory.getEventIdColumn()).toBe('memory_event_id');
    expect(InMemory.getLastSyncedColumn()).toBe('memory_last_synced_at');
  });

  test('the methods (excluding providerId) are functions', function () {
    CalendarPort.CALENDAR_PORT_METHODS.forEach(function (name) {
      if (name === 'providerId') return;
      expect(typeof InMemory[name]).toBe('function');
    });
  });
});

describe('InMemoryCalendarAdapter — connection', function () {
  test('isConnected is false until connect(), true after', async function () {
    expect(InMemory.isConnected({ id: USER_ID })).toBe(false);
    await InMemory.connect(USER_ID, { username: 'test' });
    expect(InMemory.isConnected({ id: USER_ID })).toBe(true);
  });

  test('getValidAccessToken throws when not connected', async function () {
    await expect(InMemory.getValidAccessToken({ id: 999 })).rejects.toThrow();
  });

  test('getValidAccessToken resolves a token after connect', async function () {
    await InMemory.connect(USER_ID, {});
    var token = await InMemory.getValidAccessToken({ id: USER_ID });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });
});

describe('InMemoryCalendarAdapter — CRUD round-trip', function () {
  test('createEvent stores and returns a providerEventId', async function () {
    await InMemory.connect(USER_ID, {});
    var token = await InMemory.getValidAccessToken({ id: USER_ID });

    var result = await InMemory.createEvent(token, {
      title: 'Test Event',
      durationMinutes: 60,
      startDateTime: '2026-05-28T14:00:00Z'
    }, USER_ID, 2026, 'America/New_York');

    expect(result.providerEventId).toBeTruthy();
    expect(result.raw.title).toBe('Test Event');

    var events = await InMemory.getEvents(token, '2026-05-01', '2026-06-01', USER_ID);
    expect(events.length).toBe(1);
    expect(events[0].id).toBe(result.providerEventId);
    expect(events[0].title).toBe('Test Event');
    expect(events[0].durationMinutes).toBe(60);
  });

  test('supports the README usage flow (text/dur/date/time fields)', async function () {
    await InMemory.connect(USER_ID, { username: 'test' });
    var token = await InMemory.getValidAccessToken({ id: USER_ID });
    var result = await InMemory.createEvent(token, {
      text: 'Test Event',
      dur: 60,
      date: '2026-05-28'
    }, USER_ID, 2026, 'America/New_York');
    expect(result.providerEventId).toBeTruthy();
    expect(result.raw.title).toBe('Test Event');
    expect(result.raw.durationMinutes).toBe(60);
  });

  test('updateEvent mutates the stored event', async function () {
    await InMemory.connect(USER_ID, {});
    var token = await InMemory.getValidAccessToken({ id: USER_ID });
    var created = await InMemory.createEvent(token, {
      title: 'Original', startDateTime: '2026-05-28T14:00:00Z'
    }, USER_ID, 2026, 'UTC');

    await InMemory.updateEvent(token, created.providerEventId, {
      title: 'Updated'
    }, USER_ID, 2026, 'UTC');

    var events = await InMemory.getEvents(token, null, null, USER_ID);
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('Updated');
  });

  test('updateEvent throws NOT_FOUND for a missing event', async function () {
    await InMemory.connect(USER_ID, {});
    var token = await InMemory.getValidAccessToken({ id: USER_ID });
    await expect(
      InMemory.updateEvent(token, 'nope', { title: 'x' }, USER_ID, 2026, 'UTC')
    ).rejects.toThrow(/not found/i);
  });

  test('deleteEvent removes the event', async function () {
    await InMemory.connect(USER_ID, {});
    var token = await InMemory.getValidAccessToken({ id: USER_ID });
    var created = await InMemory.createEvent(token, {
      title: 'Doomed', startDateTime: '2026-05-28T14:00:00Z'
    }, USER_ID, 2026, 'UTC');

    var del = await InMemory.deleteEvent(token, created.providerEventId, USER_ID);
    expect(del.deleted).toBe(true);

    var events = await InMemory.getEvents(token, null, null, USER_ID);
    expect(events.length).toBe(0);
  });

  test('getEvents filters by date window', async function () {
    await InMemory.connect(USER_ID, {});
    var token = await InMemory.getValidAccessToken({ id: USER_ID });
    await InMemory.createEvent(token, { title: 'May', startDateTime: '2026-05-15T10:00:00Z' }, USER_ID, 2026, 'UTC');
    await InMemory.createEvent(token, { title: 'July', startDateTime: '2026-07-15T10:00:00Z' }, USER_ID, 2026, 'UTC');

    var mayOnly = await InMemory.getEvents(token, '2026-05-01', '2026-06-01', USER_ID);
    expect(mayOnly.length).toBe(1);
    expect(mayOnly[0].title).toBe('May');
  });

  test('sync reports no remote changes', async function () {
    await InMemory.connect(USER_ID, {});
    var res = await InMemory.sync('memory-token:' + USER_ID, { id: USER_ID });
    expect(res).toEqual({ hasChanges: false });
  });
});

describe('InMemoryCalendarAdapter — isolation', function () {
  test('clearAll wipes all state', async function () {
    await InMemory.connect(USER_ID, {});
    var token = await InMemory.getValidAccessToken({ id: USER_ID });
    await InMemory.createEvent(token, { title: 'X', startDateTime: '2026-05-28T14:00:00Z' }, USER_ID, 2026, 'UTC');

    InMemory.clearAll();

    expect(InMemory.isConnected({ id: USER_ID })).toBe(false);
  });

  test('events are scoped per user', async function () {
    await InMemory.connect(1, {});
    await InMemory.connect(2, {});
    var t1 = await InMemory.getValidAccessToken({ id: 1 });
    var t2 = await InMemory.getValidAccessToken({ id: 2 });
    await InMemory.createEvent(t1, { title: 'U1', startDateTime: '2026-05-28T14:00:00Z' }, 1, 2026, 'UTC');

    var u2events = await InMemory.getEvents(t2, null, null, 2);
    expect(u2events.length).toBe(0);
    var u1events = await InMemory.getEvents(t1, null, null, 1);
    expect(u1events.length).toBe(1);
  });
});
