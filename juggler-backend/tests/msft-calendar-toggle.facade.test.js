/**
 * 999.1977 — msftGetCalendars / msftUpdateCalendar facade functions.
 *
 * Direct sibling of tests/gcal-calendar-toggle.facade.test.js (999.1626).
 *
 * DB-backed (real test-bed) — these two endpoints only read/write
 * user_calendars, no OAuth/live Microsoft credentials needed (unlike
 * msftRefreshCalendars, which requires a valid access token and is covered
 * at the adapter level by
 * tests/calendar/MicrosoftCalendarAdapter.multiCalendar.unit.test.js's
 * discoverCalendars coverage instead).
 *
 * This is the "backend toggle mechanism" half of 999.1977 scope item 3
 * (per-calendar enabled state, schema + API) — no frontend Settings UI was
 * built for this leg; see the backlog close evidence.
 */
'use strict';

var { assertDbAvailable } = require('./helpers/requireDB');
var {
  db, TEST_USER_ID, seedTestUser, destroyTestUser
} = require('./cal-sync/helpers/test-setup');
var facade = require('../src/slices/calendar/facade');

beforeAll(async function () {
  await assertDbAvailable();
  await seedTestUser();
});

afterAll(async function () {
  await destroyTestUser();
});

afterEach(async function () {
  await db('user_calendars').where({ user_id: TEST_USER_ID, provider: 'msft' }).del();
});

describe('msftGetCalendars (999.1977)', function () {
  test('lists the calendars saved for this user+provider only', async function () {
    await db('user_calendars').insert([
      { user_id: TEST_USER_ID, provider: 'msft', calendar_id: 'default-cal-id', display_name: 'Calendar', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { user_id: TEST_USER_ID, provider: 'msft', calendar_id: 'secondary', display_name: 'Team', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]);

    var result = await facade.msftGetCalendars(TEST_USER_ID);

    expect(result.status).toBe(200);
    expect(result.body.calendars).toHaveLength(2);
    var ids = result.body.calendars.map(function (c) { return c.calendar_id; });
    expect(ids).toEqual(expect.arrayContaining(['default-cal-id', 'secondary']));
  });

  test('returns an empty list (not an error) when no calendars have been discovered yet', async function () {
    var result = await facade.msftGetCalendars(TEST_USER_ID);
    expect(result.status).toBe(200);
    expect(result.body.calendars).toEqual([]);
  });
});

describe('msftUpdateCalendar (999.1977)', function () {
  test('toggling a calendar off persists enabled=false', async function () {
    var inserted = await db('user_calendars').insert({
      user_id: TEST_USER_ID, provider: 'msft', calendar_id: 'noisy-cal', display_name: 'Noisy',
      enabled: true, sync_direction: 'full', ingest_mode: 'task'
    });
    var id = inserted[0];

    var result = await facade.msftUpdateCalendar(TEST_USER_ID, id, { enabled: false });

    expect(result.status).toBe(200);
    expect(!!result.body.calendar.enabled).toBe(false);
    var row = await db('user_calendars').where('id', id).first();
    expect(!!row.enabled).toBe(false);
  });

  test('does not touch fields the caller did not send', async function () {
    var inserted = await db('user_calendars').insert({
      user_id: TEST_USER_ID, provider: 'msft', calendar_id: 'keep-mode', display_name: 'Keep Mode',
      enabled: true, sync_direction: 'full', ingest_mode: 'reminder'
    });
    var id = inserted[0];

    await facade.msftUpdateCalendar(TEST_USER_ID, id, { enabled: false });

    var row = await db('user_calendars').where('id', id).first();
    expect(row.ingest_mode).toBe('reminder'); // untouched
  });

  test('404s when the calendarId does not exist', async function () {
    var result = await facade.msftUpdateCalendar(TEST_USER_ID, 999999999, { enabled: false });
    expect(result.status).toBe(404);
  });

  // law-equivalent regression: cross-user ownership gate — pins the guard
  // that was already correct in code (findUserCalendarByIdForUser scopes by
  // BOTH id AND user_id, same generic repo method GCal uses) but previously
  // had no MSFT-specific regression test.
  test('404s (never mutates) when the calendarId belongs to a DIFFERENT user', async function () {
    var OTHER_USER_ID = 'other-user-999.1977';
    await db('users').where('id', OTHER_USER_ID).del();
    await db('users').insert({ id: OTHER_USER_ID, email: 'other-999-1977@test.com' });
    var inserted = await db('user_calendars').insert({
      user_id: OTHER_USER_ID, provider: 'msft', calendar_id: 'not-yours',
      enabled: true, sync_direction: 'full', ingest_mode: 'task'
    });
    var otherUsersCalendarId = inserted[0];

    try {
      var result = await facade.msftUpdateCalendar(TEST_USER_ID, otherUsersCalendarId, { enabled: false });

      expect(result.status).toBe(404);
      var row = await db('user_calendars').where('id', otherUsersCalendarId).first();
      expect(!!row.enabled).toBe(true); // untouched — attacker's update never applied
    } finally {
      await db('user_calendars').where('id', otherUsersCalendarId).del();
      await db('users').where('id', OTHER_USER_ID).del();
    }
  });
});
