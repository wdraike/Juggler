// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * 999.1626 — gcalGetCalendars / gcalUpdateCalendar facade functions.
 *
 * DB-backed (real test-bed) — these two endpoints only read/write
 * user_calendars, no OAuth/live Google credentials needed (unlike
 * gcalRefreshCalendars, which requires a valid access token and is covered
 * at the adapter level by tests/calendar/GoogleCalendarAdapter.multiCalendar.unit.test.js's
 * discoverCalendars coverage instead).
 *
 * This is the "backend toggle mechanism" half of 999.1626 scope item 4
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
  await db('user_calendars').where({ user_id: TEST_USER_ID, provider: 'gcal' }).del();
});

describe('gcalGetCalendars (999.1626)', function () {
  test('lists the calendars saved for this user+provider only', async function () {
    await db('user_calendars').insert(__stampFixture([
      { user_id: TEST_USER_ID, provider: 'gcal', calendar_id: 'primary', display_name: 'Primary', enabled: true, sync_direction: 'full', ingest_mode: 'task' },
      { user_id: TEST_USER_ID, provider: 'gcal', calendar_id: 'secondary', display_name: 'Team', enabled: true, sync_direction: 'full', ingest_mode: 'task' }
    ]));

    var result = await facade.gcalGetCalendars(TEST_USER_ID);

    expect(result.status).toBe(200);
    expect(result.body.calendars).toHaveLength(2);
    var ids = result.body.calendars.map(function (c) { return c.calendar_id; });
    expect(ids).toEqual(expect.arrayContaining(['primary', 'secondary']));
  });

  test('returns an empty list (not an error) when no calendars have been discovered yet', async function () {
    var result = await facade.gcalGetCalendars(TEST_USER_ID);
    expect(result.status).toBe(200);
    expect(result.body.calendars).toEqual([]);
  });
});

describe('gcalUpdateCalendar (999.1626)', function () {
  test('toggling a calendar off persists enabled=false', async function () {
    var inserted = await db('user_calendars').insert(__stampFixture({
      user_id: TEST_USER_ID, provider: 'gcal', calendar_id: 'noisy-cal', display_name: 'Noisy',
      enabled: true, sync_direction: 'full', ingest_mode: 'task'
    }));
    var id = inserted[0];

    var result = await facade.gcalUpdateCalendar(TEST_USER_ID, id, { enabled: false });

    expect(result.status).toBe(200);
    expect(!!result.body.calendar.enabled).toBe(false);
    var row = await db('user_calendars').where('id', id).first();
    expect(!!row.enabled).toBe(false);
  });

  test('does not touch fields the caller did not send', async function () {
    var inserted = await db('user_calendars').insert(__stampFixture({
      user_id: TEST_USER_ID, provider: 'gcal', calendar_id: 'keep-mode', display_name: 'Keep Mode',
      enabled: true, sync_direction: 'full', ingest_mode: 'reminder'
    }));
    var id = inserted[0];

    await facade.gcalUpdateCalendar(TEST_USER_ID, id, { enabled: false });

    var row = await db('user_calendars').where('id', id).first();
    expect(row.ingest_mode).toBe('reminder'); // untouched
  });

  test('404s when the calendarId does not exist', async function () {
    var result = await facade.gcalUpdateCalendar(TEST_USER_ID, 999999999, { enabled: false });
    expect(result.status).toBe(404);
  });

  // law review (999.1626): cross-user ownership gate — pins the guard that
  // was already correct in code (findUserCalendarByIdForUser scopes by BOTH
  // id AND user_id) but previously had no regression test.
  test('404s (never mutates) when the calendarId belongs to a DIFFERENT user', async function () {
    var OTHER_USER_ID = 'other-user-999.1626';
    await db('users').where('id', OTHER_USER_ID).del();
    await db('users').insert(__stampFixture({ id: OTHER_USER_ID, email: 'other-999-1626@test.com' }));
    var inserted = await db('user_calendars').insert(__stampFixture({
      user_id: OTHER_USER_ID, provider: 'gcal', calendar_id: 'not-yours',
      enabled: true, sync_direction: 'full', ingest_mode: 'task'
    }));
    var otherUsersCalendarId = inserted[0];

    try {
      var result = await facade.gcalUpdateCalendar(TEST_USER_ID, otherUsersCalendarId, { enabled: false });

      expect(result.status).toBe(404);
      var row = await db('user_calendars').where('id', otherUsersCalendarId).first();
      expect(!!row.enabled).toBe(true); // untouched — attacker's update never applied
    } finally {
      await db('user_calendars').where('id', otherUsersCalendarId).del();
      await db('users').where('id', OTHER_USER_ID).del();
    }
  });
});
