/**
 * 999.1977 — MSFT pull sync fetches the DEFAULT calendar only.
 *
 * Direct sibling of 999.1626 (GoogleCalendarAdapter.multiCalendar.unit.test.js)
 * — same bug, same fix pattern, ported to Microsoft Graph. Before 999.1626,
 * gcal/msft/apple were all consistently primary-only (TRAPS.md 999.1012:
 * providers must stay behavior-identical). After 999.1626 fixed GCal,
 * MicrosoftCalendarAdapter was left calling /me/calendarView (Graph's
 * default-calendar-only endpoint) unconditionally, ignoring the userId param entirely and never
 * touching user_calendars — an appointment on any secondary/shared Microsoft
 * calendar was NEVER pulled into juggler (silent, permanent miss).
 *
 * Mirrors GoogleCalendarAdapter's fix: calendar-list discovery, per-calendar
 * on/off toggle, everything ON by default (opt-out, not opt-in), deterministic
 * ORDER BY calendar_id, hasChanges() unconditional hasChanges:true once 2+
 * calendars are enabled.
 *
 * GENUINE Graph-API difference from GCal (documented, not copy-pasted):
 * lib/msft-cal-api.js's listEvents hits /me/calendarView (or
 * /me/calendars/{id}/calendarView for a specific calendar) which returns NO
 * @odata.deltaLink — only the dedicated .../events/delta endpoint does, and
 * this adapter's pull path does not call it. There is therefore nothing for
 * listEvents to capture-and-gate the way GCal's nextSyncToken is (see the
 * "sync token storage" describe block below) — the "exactly 1 enabled
 * calendar" gate that matters for MSFT lives entirely in hasChanges()
 * (msft_cal_delta_link), which is what's exercised here.
 *
 * Pure unit — no DB, no live credentials. msft-cal-api is mocked; the DB is a
 * hand-rolled in-memory stub injected via MicrosoftCalendarAdapter.setDb(),
 * matching the module's own documented injection convention (999.1534).
 */

'use strict';

jest.mock('../../src/lib/msft-cal-api');
var msftCalApi = require('../../src/lib/msft-cal-api');
var MicrosoftCalendarAdapter = require('../../src/slices/calendar/adapters/MicrosoftCalendarAdapter');

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

var USER_ID = 'user-1977';

beforeEach(function () {
  jest.clearAllMocks();
});

describe('MicrosoftCalendarAdapter.listEvents — multi-calendar pull (999.1977)', function () {
  test('pulls events from EVERY enabled calendar, not just the default one', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'default-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'msft', calendar_id: 'secondary-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);

    msftCalApi.listCalendarList.mockResolvedValue([
      { id: 'default-cal-id', name: 'Calendar' },
      { id: 'secondary-cal-id', name: 'Secondary' }
    ]);
    msftCalApi.listEvents.mockImplementation(function (token, timeMin, timeMax, calendarId) {
      if (calendarId === 'default-cal-id') {
        return Promise.resolve({ items: [{ id: 'evt-default', subject: 'Default Event', start: { dateTime: '2026-08-01T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-08-01T10:30:00', timeZone: 'UTC' } }] });
      }
      if (calendarId === 'secondary-cal-id') {
        return Promise.resolve({ items: [{ id: 'evt-secondary', subject: 'Secondary Event', start: { dateTime: '2026-08-01T14:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-08-01T14:30:00', timeZone: 'UTC' } }] });
      }
      return Promise.resolve({ items: [] });
    });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function (events) {
      var titles = events.map(function (e) { return e.title; });

      // THE BUG: pre-fix, msftCalApi.listEvents is called exactly once
      // (hardcoded /me/calendarView), so 'Secondary Event' is silently never pulled.
      expect(titles).toContain('Default Event');
      expect(titles).toContain('Secondary Event');
      expect(msftCalApi.listEvents).toHaveBeenCalledTimes(2);
      expect(msftCalApi.listEvents).toHaveBeenCalledWith('tok', '2026-08-01', '2026-08-02', 'default-cal-id');
      expect(msftCalApi.listEvents).toHaveBeenCalledWith('tok', '2026-08-01', '2026-08-02', 'secondary-cal-id');
    });
  });

  test('threads the calendar id onto every normalized event (_calendarId), mirroring GCal/Apple', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'default-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'msft', calendar_id: 'secondary-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    msftCalApi.listCalendarList.mockResolvedValue([{ id: 'default-cal-id' }, { id: 'secondary-cal' }]);
    msftCalApi.listEvents.mockImplementation(function (token, timeMin, timeMax, calendarId) {
      return Promise.resolve({ items: [{ id: 'evt-' + calendarId, subject: 'Event on ' + calendarId, start: { dateTime: '2026-08-01T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-08-01T10:30:00', timeZone: 'UTC' } }] });
    });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function (events) {
      var byCal = {};
      events.forEach(function (e) { byCal[e._calendarId] = e; });

      expect(byCal['default-cal-id']).toBeDefined();
      expect(byCal['secondary-cal']).toBeDefined();
    });
  });

  test('a disabled calendar is skipped entirely (never fetched, never in results)', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'default-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'msft', calendar_id: 'muted-cal', enabled: false, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    msftCalApi.listCalendarList.mockResolvedValue([{ id: 'default-cal-id' }, { id: 'muted-cal' }]);
    msftCalApi.listEvents.mockImplementation(function (token, timeMin, timeMax, calendarId) {
      return Promise.resolve({ items: [{ id: 'evt-' + calendarId, subject: 'Event on ' + calendarId, start: { dateTime: '2026-08-01T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-08-01T10:30:00', timeZone: 'UTC' } }] });
    });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function (events) {
      expect(events.map(function (e) { return e._calendarId; })).not.toContain('muted-cal');
      expect(msftCalApi.listEvents).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'muted-cal');
    });
  });

  test('auto-discovers calendars from the live calendar list and defaults NEW ones to enabled=true (opt-out, David ruling 2026-07-15)', function () {
    var mock = makeMockDb([]); // brand new connection — no user_calendars rows yet
    MicrosoftCalendarAdapter.setDb(mock.db);
    msftCalApi.listCalendarList.mockResolvedValue([
      { id: 'default-cal-id', name: 'Calendar' },
      { id: 'shared-team-cal', name: 'Team Calendar' }
    ]);
    msftCalApi.listEvents.mockResolvedValue({ items: [] });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function () {
      expect(mock.inserted.length).toBe(2);
      mock.inserted.forEach(function (row) {
        expect(row.enabled).toBe(true);
        expect(row.provider).toBe('msft');
      });
      var ids = mock.inserted.map(function (r) { return r.calendar_id; });
      expect(ids).toEqual(expect.arrayContaining(['default-cal-id', 'shared-team-cal']));
    });
  });

  test('discovery never overwrites an existing calendar row\'s enabled flag (user toggle wins)', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'muted-cal', enabled: false, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    msftCalApi.listCalendarList.mockResolvedValue([{ id: 'muted-cal', name: 'Muted' }]);
    msftCalApi.listEvents.mockResolvedValue({ items: [] });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function () {
      expect(mock.inserted.length).toBe(0); // already exists — no re-insert, no flip to enabled
      var row = mock.calendars.find(function (r) { return r.calendar_id === 'muted-cal'; });
      expect(row.enabled).toBe(false);
    });
  });

  test('without a userId, falls back to the default calendar only (legacy/no-DB call shape unaffected)', function () {
    msftCalApi.listEvents.mockResolvedValue({ items: [{ id: 'evt-1', subject: 'Solo Event', start: { dateTime: '2026-08-01T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-08-01T10:30:00', timeZone: 'UTC' } }] });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02').then(function (events) {
      expect(msftCalApi.listCalendarList).not.toHaveBeenCalled();
      expect(msftCalApi.listEvents).toHaveBeenCalledTimes(1);
      expect(msftCalApi.listEvents).toHaveBeenCalledWith('tok', '2026-08-01', '2026-08-02', 'primary');
      expect(events).toHaveLength(1);
    });
  });

  test('iterates enabled calendars in a DETERMINISTIC order (calendar_id ascending), regardless of DB row insertion order', function () {
    // Rows deliberately seeded OUT of calendar_id order.
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'zzz-secondary', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'msft', calendar_id: 'aaa-default', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    msftCalApi.listCalendarList.mockResolvedValue([{ id: 'zzz-secondary' }, { id: 'aaa-default' }]);
    msftCalApi.listEvents.mockResolvedValue({ items: [] });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function () {
      var calledCalendarIds = msftCalApi.listEvents.mock.calls.map(function (args) { return args[3]; });
      expect(calledCalendarIds).toEqual(['aaa-default', 'zzz-secondary']);
    });
  });

  test('discoverCalendars errors are swallowed — pull continues on already-enabled calendars, default still fetched', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'default-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    msftCalApi.listCalendarList.mockRejectedValue(new Error('calendars 500'));
    msftCalApi.listEvents.mockResolvedValue({ items: [{ id: 'evt-1', subject: 'Still Pulled', start: { dateTime: '2026-08-01T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-08-01T10:30:00', timeZone: 'UTC' } }] });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function (events) {
      expect(mock.inserted).toHaveLength(0); // discovery failed — nothing provisioned
      expect(events.map(function (e) { return e.title; })).toContain('Still Pulled');
      expect(msftCalApi.listEvents).toHaveBeenCalledWith('tok', '2026-08-01', '2026-08-02', 'default-cal-id');
    });
  });

  test('a per-calendar fetch throw sets _hasPartialFailure but the OTHER calendar still pulls', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'good-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'msft', calendar_id: 'broken-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    msftCalApi.listCalendarList.mockResolvedValue([{ id: 'good-cal' }, { id: 'broken-cal' }]);
    msftCalApi.listEvents.mockImplementation(function (token, timeMin, timeMax, calendarId) {
      if (calendarId === 'broken-cal') return Promise.reject(new Error('Graph API error 503'));
      return Promise.resolve({ items: [{ id: 'evt-good', subject: 'Good Event', start: { dateTime: '2026-08-01T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-08-01T10:30:00', timeZone: 'UTC' } }] });
    });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function (events) {
      expect(events._hasPartialFailure).toBe(true);
      expect(events.map(function (e) { return e.title; })).toEqual(['Good Event']);
    });
  });
});

describe('MicrosoftCalendarAdapter.listEvents — no sync-token/delta-link write attempt (999.1977: genuine Graph difference from GCal)', function () {
  test('never touches the users table, regardless of how many calendars are enabled', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'default-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'msft', calendar_id: 'secondary-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    msftCalApi.listCalendarList.mockResolvedValue([{ id: 'default-cal-id' }, { id: 'secondary-cal' }]);
    msftCalApi.listEvents.mockResolvedValue({ items: [] });

    return MicrosoftCalendarAdapter.listEvents('tok', '2026-08-01', '2026-08-02', USER_ID).then(function () {
      expect(mock.userUpdates).toHaveLength(0);
    });
  });
});

describe('MicrosoftCalendarAdapter.hasChanges — multi-calendar lightweight check (999.1977, mirrors 999.1626 BLOCK)', function () {
  test('with 2+ enabled calendars, ALWAYS reports hasChanges:true and never consults the single-calendar delta link', function () {
    // THE BLOCK: a lone msft_cal_delta_link can only ever represent ONE
    // calendar's cursor. If this check trusted it while 2 calendars are
    // enabled, a new event landing ONLY on the non-token calendar would
    // report hasChanges:false — the frontend poll never calls the full
    // multi-calendar pull, silently deferring the event until the next
    // full-page-load sync. Same bug 999.1626/999.1977 exist to kill.
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'default-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { id: 2, user_id: USER_ID, provider: 'msft', calendar_id: 'shared-cal', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    var user = { id: USER_ID, msft_cal_delta_link: 'stale-default-link' };

    return MicrosoftCalendarAdapter.hasChanges('tok', user).then(function (result) {
      expect(result).toEqual({ hasChanges: true });
      expect(msftCalApi.checkForChanges).not.toHaveBeenCalled();
    });
  });

  test('with exactly 1 enabled calendar, falls through to the existing delta-link check (unchanged behavior)', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'default-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    var user = { id: USER_ID, msft_cal_delta_link: 'delta-abc' };
    msftCalApi.checkForChanges.mockResolvedValue({ hasChanges: false, deltaLink: 'delta-abc' });

    return MicrosoftCalendarAdapter.hasChanges('tok', user).then(function (result) {
      expect(msftCalApi.checkForChanges).toHaveBeenCalledWith('tok', 'delta-abc');
      expect(result).toEqual({ hasChanges: false, deltaLink: 'delta-abc' });
    });
  });

  test('with exactly 1 enabled calendar and no stored delta link yet, still returns hasChanges:true without calling the API', function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'msft', calendar_id: 'default-cal-id', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);
    MicrosoftCalendarAdapter.setDb(mock.db);
    var user = { id: USER_ID, msft_cal_delta_link: null };

    return MicrosoftCalendarAdapter.hasChanges('tok', user).then(function (result) {
      expect(result).toEqual({ hasChanges: true });
      expect(msftCalApi.checkForChanges).not.toHaveBeenCalled();
    });
  });

  test('with NO user_calendars rows yet (default-only fallback, length 1), still uses the delta-link check path', function () {
    var mock = makeMockDb([]); // never discovered/synced
    MicrosoftCalendarAdapter.setDb(mock.db);
    var user = { id: USER_ID, msft_cal_delta_link: 'delta-xyz' };
    msftCalApi.checkForChanges.mockResolvedValue({ hasChanges: true });

    return MicrosoftCalendarAdapter.hasChanges('tok', user).then(function (result) {
      expect(msftCalApi.checkForChanges).toHaveBeenCalledWith('tok', 'delta-xyz');
      expect(result).toEqual({ hasChanges: true });
    });
  });
});
