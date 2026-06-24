/**
 * 999.860 — reconcile Apple sync source-of-truth.
 *
 * Reproduces the diverged state (apple_cal_calendar_url set, every user_calendars
 * apple row enabled=0 → Apple syncs via the legacy fallback while the Calendar
 * Sync modal shows all checkboxes unchecked) and proves the backfill migration
 * flips the matching row to enabled, making user_calendars.enabled agree with the
 * actually-synced calendar.
 */
process.env.NODE_ENV = 'test';

var setup = require('./cal-sync/helpers/test-setup');
var { assertDbAvailable } = require('./helpers/requireDB');
var migration = require('../src/db/migrations/20260624140000_backfill_apple_enabled_calendar');
var neutralize = require('../src/db/migrations/20260624150000_neutralize_apple_full_backfill');

var db = setup.db;
var USER = setup.TEST_USER_ID;
var URL_A = 'https://caldav.icloud.com/family-shared/';
var URL_B = 'https://caldav.icloud.com/calendar/';
var URL_C = 'https://caldav.icloud.com/test-calendar/';

async function seedCalendars(rows) {
  await db('user_calendars').where({ user_id: USER, provider: 'apple' }).del();
  for (var i = 0; i < rows.length; i++) {
    await db('user_calendars').insert(Object.assign({
      user_id: USER, provider: 'apple', sync_direction: 'full'
    }, rows[i]));
  }
}

beforeAll(async function() {
  await assertDbAvailable(setup.isDbAvailable);
});

afterEach(async function() {
  await db('user_calendars').where({ user_id: USER, provider: 'apple' }).del();
  await setup.destroyTestUser();
});

afterAll(async function() {
  await db.destroy();
});

test('enables the row matching apple_cal_calendar_url when no apple row is enabled', async function() {
  await setup.seedTestUser({ apple_cal_calendar_url: URL_A });
  await seedCalendars([
    { calendar_id: URL_A, display_name: 'Family Shared', enabled: 0 },
    { calendar_id: URL_B, display_name: 'Calendar', enabled: 0 },
    { calendar_id: URL_C, display_name: 'Test Calendar', enabled: 0 }
  ]);

  await migration.up(db);

  var rows = await db('user_calendars').where({ user_id: USER, provider: 'apple' });
  var byUrl = {};
  rows.forEach(function(r) { byUrl[r.calendar_id] = !!r.enabled; });
  expect(byUrl[URL_A]).toBe(true);    // the synced calendar now shows checked
  expect(byUrl[URL_B]).toBe(false);   // others untouched
  expect(byUrl[URL_C]).toBe(false);
});

// --- 999.860 footgun neutralizer (20260624150000): backfill must never push ---

test('neutralizer downgrades the backfill-enabled full-sync legacy calendar to ingest (no push, stays enabled)', async function() {
  await setup.seedTestUser({ apple_cal_calendar_url: URL_A });
  // The state 20260624140000 leaves: legacy calendar enabled + full-sync.
  await seedCalendars([
    { calendar_id: URL_A, display_name: 'Family Shared', enabled: 1, sync_direction: 'full' },
    { calendar_id: URL_B, display_name: 'Calendar', enabled: 0, sync_direction: 'full' }
  ]);

  await neutralize.up(db);

  var rows = await db('user_calendars').where({ user_id: USER, provider: 'apple' });
  var byUrl = {};
  rows.forEach(function(r) { byUrl[r.calendar_id] = r; });
  expect(byUrl[URL_A].sync_direction).toBe('ingest');   // push disarmed
  expect(!!byUrl[URL_A].enabled).toBe(true);            // still enabled → modal shows it checked
  // PUSH path is (enabled=true AND sync_direction='full') — must now be empty for this user
  var pushable = await db('user_calendars')
    .where({ user_id: USER, provider: 'apple', enabled: true, sync_direction: 'full' });
  expect(pushable).toHaveLength(0);
});

test('neutralizer leaves an explicitly-full calendar that is NOT the legacy synced one alone', async function() {
  await setup.seedTestUser({ apple_cal_calendar_url: URL_A });
  await seedCalendars([
    { calendar_id: URL_A, display_name: 'Family Shared', enabled: 0, sync_direction: 'full' },
    { calendar_id: URL_B, display_name: 'Calendar', enabled: 1, sync_direction: 'full' } // user's own full choice
  ]);

  await neutralize.up(db);

  var rows = await db('user_calendars').where({ user_id: USER, provider: 'apple' });
  var byUrl = {};
  rows.forEach(function(r) { byUrl[r.calendar_id] = r; });
  expect(byUrl[URL_B].sync_direction).toBe('full');     // untouched — only the legacy-matching row is downgraded
});

test('leaves data alone when an apple row is already enabled', async function() {
  await setup.seedTestUser({ apple_cal_calendar_url: URL_A });
  await seedCalendars([
    { calendar_id: URL_A, display_name: 'Family Shared', enabled: 0 },
    { calendar_id: URL_B, display_name: 'Calendar', enabled: 1 }   // already enabled
  ]);

  await migration.up(db);

  var rows = await db('user_calendars').where({ user_id: USER, provider: 'apple' });
  var byUrl = {};
  rows.forEach(function(r) { byUrl[r.calendar_id] = !!r.enabled; });
  expect(byUrl[URL_A]).toBe(false);   // not forced on — user's choice respected
  expect(byUrl[URL_B]).toBe(true);
});
