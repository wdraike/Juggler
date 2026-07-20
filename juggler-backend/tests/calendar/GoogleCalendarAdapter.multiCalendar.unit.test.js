/**
 * 999.1626 — GCal pull sync fetches the PRIMARY calendar only.
 *
 * lib/gcal-api.js:listEvents hit /calendars/primary/events unconditionally
 * and no calendarList enumeration existed anywhere in the GCal path — an
 * appointment on any secondary/shared Google calendar was NEVER pulled into
 * juggler (silent, permanent miss). Apple's adapter already iterates
 * user_calendars (AppleCalendarAdapter.js — getEnabledCalendars/listEvents).
 *
 * Ruling (David, 2026-07-15): GCal pull sync enumerates ALL calendars via
 * calendarList, per-calendar on/off toggle in Settings, everything ON by
 * default (opt-out, not opt-in — mirrors AppleCalendarAdapter's
 * user_calendars iteration for parity, but defaults NEW discovered
 * calendars to enabled=true, not Apple's enabled=false).
 *
 * Pure unit — no DB, no live credentials. gcal-api is mocked; the DB is a
 * hand-rolled in-memory stub injected via GoogleCalendarAdapter.setDb(),
 * matching the module's own documented injection convention (999.1534).
 */

'use strict';

jest.mock('../../src/lib/gcal-api');
var gcalApi = require('../../src/lib/gcal-api');
var GoogleCalendarAdapter = require('../../src/slices/calendar/adapters/GoogleCalendarAdapter');

// ── Minimal in-memory knex-shaped stub — only the calls this adapter makes ──
function makeMockDb(seedCalendars) {
  var calendars = (seedCalendars || []).slice();
  var inserted = [];
  var userUpdates = [];

  function db(table) {
    if (table === 'user_calendars') {
      return {
        where: function (cond) {
          var filtered = calendars.filter(function (r) {
            return Object.keys(cond).every(function (k) { return r[k] === cond[k]; });
          });
          // knex .where(...).orderBy(col, dir) — chainable + awaitable, matching
          // the real query builder shape used by getEnabledCalendars.
          filtered.orderBy = function (col, dir) {
            var sorted = filtered.slice().sort(function (a, b) {
              if (a[col] < b[col]) return dir === 'desc' ? 1 : -1;
              if (a[col] > b[col]) return dir === 'desc' ? -1 : 1;
              return 0;
            });
            return Promise.resolve(sorted);
          };
          return filtered;
        },
        insert: function (rows) {
          var arr = Array.isArray(rows) ? rows : [rows];
          arr.forEach(function (r) {
            calendars.push(r);
            inserted.push(r);
          });
          return Promise.resolve([1]);
        }
      };
    }
    if (table === 'users') {
      return {
        where: function (_col, val) {
          return {
            update: function (fields) {
              userUpdates.push({ userId: val, fields: fields });
              return Promise.resolve(1);
            }
          };
        }
      };
    }
    throw new Error('makeMockDb: unexpected table ' + table);
  }
  db.fn = { now: function () { return 'NOW()'; } };

  return { db: db, calendars: calendars, inserted: inserted, userUpdates: userUpdates };
}

var USER_ID = 'user-1626';

beforeEach(function () {
  jest.clearAllMocks();
});

describe('GoogleCalendarAdapter.listEvents — multi-calendar pull (999.1626)', function () {
  test('pulls events from EVERY enabled calendar, not just primary', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'secondary@group.calendar.google.com', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);

    gcalApi.listCalendarList.mockResolvedValue([
      { id: 'primary', summary: 'Primary' },
      { id: 'secondary@group.calendar.google.com', summary: 'Secondary' }
    ]);
    gcalApi.listEvents.mockImplementation(function (token, timeMin, timeMax, calendarId) {
      if (calendarId === 'primary') {
        return Promise.resolve({ items: [{ id: 'evt-primary', summary: 'Primary Event', start: { dateTime: '2026-08-01T10:00:00Z' }, end: { dateTime: '2026-08-01T10:30:00Z' } }], nextSyncToken: 'tok-primary' });
      }
      if (calendarId === 'secondary@group.calendar.google.com') {
        return Promise.resolve({ items: [{ id: 'evt-secondary', summary: 'Secondary Event', start: { dateTime: '2026-08-01T14:00:00Z' }, end: { dateTime: '2026-08-01T14:30:00Z' } }], nextSyncToken: 'tok-secondary' });
      }
      return Promise.resolve({ items: [] });
    });

    var events = await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);
    var titles = events.map(function (e) { return e.title; });

    // THE BUG: pre-fix, gcalApi.listEvents is called exactly once (hardcoded
    // primary), so 'Secondary Event' is silently never pulled.
    expect(titles).toContain('Primary Event');
    expect(titles).toContain('Secondary Event');
    expect(gcalApi.listEvents).toHaveBeenCalledTimes(2);
    expect(gcalApi.listEvents).toHaveBeenCalledWith('tok', '2026-08-01', '2026-08-02', 'primary');
    expect(gcalApi.listEvents).toHaveBeenCalledWith('tok', '2026-08-01', '2026-08-02', 'secondary@group.calendar.google.com');
  });

  test('threads the calendar id onto every normalized event (_calendarId), mirroring Apple', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'secondary-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockResolvedValue([{ id: 'primary' }, { id: 'secondary-cal' }]);
    gcalApi.listEvents.mockImplementation(function (token, timeMin, timeMax, calendarId) {
      return Promise.resolve({ items: [{ id: 'evt-' + calendarId, summary: 'Event on ' + calendarId, start: { dateTime: '2026-08-01T10:00:00Z' }, end: { dateTime: '2026-08-01T10:30:00Z' } }] });
    });

    var events = await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);
    var byCal = {};
    events.forEach(function (e) { byCal[e._calendarId] = e; });

    expect(byCal['primary']).toBeDefined();
    expect(byCal['secondary-cal']).toBeDefined();
  });

  test('a disabled calendar is skipped entirely (never fetched, never in results)', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'muted-cal', enabled: false, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockResolvedValue([{ id: 'primary' }, { id: 'muted-cal' }]);
    gcalApi.listEvents.mockImplementation(function (token, timeMin, timeMax, calendarId) {
      return Promise.resolve({ items: [{ id: 'evt-' + calendarId, summary: 'Event on ' + calendarId, start: { dateTime: '2026-08-01T10:00:00Z' }, end: { dateTime: '2026-08-01T10:30:00Z' } }] });
    });

    var events = await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);

    expect(events.map(function (e) { return e._calendarId; })).not.toContain('muted-cal');
    expect(gcalApi.listEvents).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'muted-cal');
  });

  test('auto-discovers calendars from the live calendarList and defaults NEW ones to enabled=true (opt-out, David ruling 2026-07-15)', async function () {
    var mock = makeMockDb([]); // brand new connection — no user_calendars rows yet
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockResolvedValue([
      { id: 'primary', summary: 'Primary' },
      { id: 'shared-team-cal', summary: 'Team Calendar' }
    ]);
    gcalApi.listEvents.mockResolvedValue({ items: [] });

    await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);

    expect(mock.inserted.length).toBe(2);
    mock.inserted.forEach(function (row) {
      expect(row.enabled).toBe(true);
      expect(row.provider).toBe('gcal');
    });
    var ids = mock.inserted.map(function (r) { return r.calendar_id; });
    expect(ids).toEqual(expect.arrayContaining(['primary', 'shared-team-cal']));
  });

  test('discovery never overwrites an existing calendar row\'s enabled flag (user toggle wins)', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'muted-cal', enabled: false, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockResolvedValue([{ id: 'muted-cal', summary: 'Muted' }]);
    gcalApi.listEvents.mockResolvedValue({ items: [] });

    await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);

    expect(mock.inserted.length).toBe(0); // already exists — no re-insert, no flip to enabled
    var row = mock.calendars.find(function (r) { return r.calendar_id === 'muted-cal'; });
    expect(row.enabled).toBe(false);
  });

  test('without a userId, falls back to primary only (legacy/no-DB call shape unaffected)', async function () {
    gcalApi.listEvents.mockResolvedValue({ items: [{ id: 'evt-1', summary: 'Solo Event', start: { dateTime: '2026-08-01T10:00:00Z' }, end: { dateTime: '2026-08-01T10:30:00Z' } }] });

    var events = await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02');

    expect(gcalApi.listCalendarList).not.toHaveBeenCalled();
    expect(gcalApi.listEvents).toHaveBeenCalledTimes(1);
    expect(gcalApi.listEvents).toHaveBeenCalledWith('tok', '2026-08-01', '2026-08-02', 'primary');
    expect(events).toHaveLength(1);
  });

  test('iterates enabled calendars in a DETERMINISTIC order (calendar_id ascending), regardless of DB row insertion order', async function () {
    // Rows deliberately seeded OUT of calendar_id order.
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'zzz-secondary', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'aaa-primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockResolvedValue([{ id: 'zzz-secondary' }, { id: 'aaa-primary' }]);
    gcalApi.listEvents.mockResolvedValue({ items: [] });

    await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);

    var calledCalendarIds = gcalApi.listEvents.mock.calls.map(function (args) { return args[3]; });
    expect(calledCalendarIds).toEqual(['aaa-primary', 'zzz-secondary']);
  });

  test('discoverCalendars errors are swallowed — pull continues on already-enabled calendars, primary still fetched', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockRejectedValue(new Error('calendarList 500'));
    gcalApi.listEvents.mockResolvedValue({ items: [{ id: 'evt-1', summary: 'Still Pulled', start: { dateTime: '2026-08-01T10:00:00Z' }, end: { dateTime: '2026-08-01T10:30:00Z' } }] });

    var events = await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);

    expect(mock.inserted).toHaveLength(0); // discovery failed — nothing provisioned
    expect(events.map(function (e) { return e.title; })).toContain('Still Pulled');
    expect(gcalApi.listEvents).toHaveBeenCalledWith('tok', '2026-08-01', '2026-08-02', 'primary');
  });

  test('a per-calendar fetch throw sets _hasPartialFailure but the OTHER calendar still pulls', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'good-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'broken-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockResolvedValue([{ id: 'good-cal' }, { id: 'broken-cal' }]);
    gcalApi.listEvents.mockImplementation(function (token, timeMin, timeMax, calendarId) {
      if (calendarId === 'broken-cal') return Promise.reject(new Error('events.list 503'));
      return Promise.resolve({ items: [{ id: 'evt-good', summary: 'Good Event', start: { dateTime: '2026-08-01T10:00:00Z' }, end: { dateTime: '2026-08-01T10:30:00Z' } }] });
    });

    var events = await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);

    expect(events._hasPartialFailure).toBe(true);
    expect(events.map(function (e) { return e.title; })).toEqual(['Good Event']);
  });
});

describe('GoogleCalendarAdapter.hasChanges — multi-calendar lightweight check (999.1626 BLOCK)', function () {
  test('with 2+ enabled calendars, ALWAYS reports hasChanges:true and never consults the single-calendar sync token', async function () {
    // THE BLOCK: a lone gcal_sync_token can only ever represent ONE
    // calendar's cursor. If this check trusted it while 2 calendars are
    // enabled, a new event landing ONLY on the non-token calendar would
    // report hasChanges:false — the frontend poll (AppLayout.jsx checkAndSync)
    // never calls the full multi-calendar pull, silently deferring the event
    // until the next full-page-load sync. That is the exact bug 999.1626
    // exists to kill, just narrowed to "until reload" instead of "forever".
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'shared-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    var user = { id: USER_ID, gcal_sync_token: 'stale-primary-token' };

    var result = await GoogleCalendarAdapter.hasChanges('tok', user);

    expect(result).toEqual({ hasChanges: true });
    expect(gcalApi.checkForChanges).not.toHaveBeenCalled();
  });

  test('with exactly 1 enabled calendar, falls through to the existing token-based check (unchanged behavior)', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    var user = { id: USER_ID, gcal_sync_token: 'tok-abc' };
    gcalApi.checkForChanges.mockResolvedValue({ hasChanges: false, nextSyncToken: 'tok-abc' });

    var result = await GoogleCalendarAdapter.hasChanges('tok', user);

    expect(gcalApi.checkForChanges).toHaveBeenCalledWith('tok', 'tok-abc');
    expect(result).toEqual({ hasChanges: false, nextSyncToken: 'tok-abc' });
  });

  test('with exactly 1 enabled calendar and no stored token yet, still returns hasChanges:true without calling the API', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    var user = { id: USER_ID, gcal_sync_token: null };

    var result = await GoogleCalendarAdapter.hasChanges('tok', user);

    expect(result).toEqual({ hasChanges: true });
    expect(gcalApi.checkForChanges).not.toHaveBeenCalled();
  });

  test('with NO user_calendars rows yet (primary-only fallback, length 1), still uses the token check path', async function () {
    var mock = makeMockDb([]); // never discovered/synced
    GoogleCalendarAdapter.setDb(mock.db);
    var user = { id: USER_ID, gcal_sync_token: 'tok-xyz' };
    gcalApi.checkForChanges.mockResolvedValue({ hasChanges: true });

    var result = await GoogleCalendarAdapter.hasChanges('tok', user);

    expect(gcalApi.checkForChanges).toHaveBeenCalledWith('tok', 'tok-xyz');
    expect(result).toEqual({ hasChanges: true });
  });
});

describe('GoogleCalendarAdapter.listEvents — sync token storage (999.1626 WARN: nondeterministic first-calendar token)', function () {
  test('with 2+ enabled calendars, gcal_sync_token is NEVER written (no single calendar unambiguously owns it)', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'secondary', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockResolvedValue([{ id: 'primary' }, { id: 'secondary' }]);
    gcalApi.listEvents.mockResolvedValue({ items: [], nextSyncToken: 'some-token' });

    await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);

    expect(mock.userUpdates).toHaveLength(0);
  });

  test('with exactly 1 enabled calendar, gcal_sync_token IS written (regression-pin single-calendar behavior)', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.listCalendarList.mockResolvedValue([{ id: 'primary' }]);
    gcalApi.listEvents.mockResolvedValue({ items: [], nextSyncToken: 'solo-token' });

    await GoogleCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID);

    expect(mock.userUpdates).toHaveLength(1);
    // inc.4 (999.1576): stampUpdate adds updated_by ('jest' = sandbox-armed default).
    expect(mock.userUpdates[0]).toEqual({ userId: USER_ID, fields: { gcal_sync_token: 'solo-token', updated_by: 'jest' } });
  });
});
