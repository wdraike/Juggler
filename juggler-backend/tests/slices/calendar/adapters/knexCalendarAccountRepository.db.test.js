/**
 * JUG-FACADE-DB-VIOLATIONS stage 3 — characterization pins for the calendar
 * facade's 18 account/OAuth management functions (gcal/msft/apple connect,
 * callback, disconnect, status, auto-sync, plus the shared nonce replay
 * guard), which had NO db-backed test coverage before this stage (the
 * existing tests/api/oauth-providers.test.js and
 * tests/characterization/gcalController.characterization.test.js suites are
 * mock-DB — they pin the HTTP shape but never exercise a real query).
 *
 * Runs the REAL facade functions (no facade mock) against real test-bed
 * MySQL (127.0.0.1:3407 / juggler_test) via KnexCalendarAccountRepository's
 * default db instance — the SAME singleton src/db.js re-exports. Only
 * external HTTP SDKs (gcal-api / msft-cal-api / apple-cal-api) and the JWT
 * state-token signing are exercised with fakes; every DB read/write is real.
 *
 * Requires: test-bed DB at 127.0.0.1:3407 (make test-juggler[-pool]).
 */

'use strict';

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env.test') });

jest.mock('../../../../src/lib/gcal-api', function () {
  return {
    createOAuth2Client: jest.fn(function () { return {}; }),
    getAuthUrl: jest.fn(function () { return 'https://accounts.google.com/mock-auth'; }),
    getTokensFromCode: jest.fn()
  };
});
jest.mock('../../../../src/lib/msft-cal-api', function () {
  return {
    generatePkce: jest.fn(function () { return { codeVerifier: 'cv', codeChallenge: 'cc' }; }),
    getAuthUrl: jest.fn(function () { return 'https://login.microsoftonline.com/mock-auth'; }),
    getTokensFromCode: jest.fn(),
    getUserInfo: jest.fn()
  };
});
jest.mock('../../../../src/lib/apple-cal-api', function () {
  return {
    DEFAULT_SERVER_URL: 'https://caldav.icloud.com',
    createClient: jest.fn(),
    discoverCalendars: jest.fn()
  };
});

var { SignJWT } = require('jose');
var facade = require('../../../../src/slices/calendar/facade');
var gcalApi = require('../../../../src/lib/gcal-api');
var msftCalApi = require('../../../../src/lib/msft-cal-api');
var appleCalApi = require('../../../../src/lib/apple-cal-api');
var { decrypt } = require('../../../../src/lib/credential-encrypt');
var { requireDB, assertDbAvailable } = require('../../../helpers/requireDB');
var db = require('../../../../src/db');

// Deterministic default test secret (jwt-secret.js falls back to this when
// JWT_SECRET is unset in non-production — matches gcalController.characterization.test.js).
var TEST_JWT_SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET || 'local-dev-jwt-secret-juggler');

var USER_ID = '999-1516-stage3-user';

function makeUser(overrides) {
  return Object.assign({
    id: USER_ID,
    email: USER_ID + '@test.com',
    name: 'Stage 3 Characterization User',
    timezone: 'America/New_York'
  }, overrides || {});
}

async function seedUser(overrides) {
  await db('users').where('id', USER_ID).del();
  var row = makeUser(overrides);
  row.created_at = db.fn.now();
  row.updated_at = db.fn.now();
  await db('users').insert(row);
  return db('users').where('id', USER_ID).first();
}

async function cleanup() {
  await db('user_calendars').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

async function signState(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(TEST_JWT_SECRET_KEY);
}

beforeAll(async () => {
  await assertDbAvailable();
});

afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});

afterAll(async () => {
  await cleanup();
  await db.destroy();
});

// ═══════════════════════════════════════════════════════════════════════════
// GCal
// ═══════════════════════════════════════════════════════════════════════════

describe('GCal account management — real DB', () => {
  test('getGcalStatus: not connected, no auto-sync row → connected:false, autoSync:false', requireDB(async () => {
    var user = await seedUser();
    var status = await facade.getGcalStatus(user);
    expect(status).toEqual({
      connected: false, tokenExpired: false, email: user.email,
      lastSyncedAt: null, autoSync: false
    });
  }));

  test('getGcalStatus: connected + real auto-sync row (JSON string config_value) → autoSync:true', requireDB(async () => {
    var user = await seedUser({ gcal_refresh_token: 'rt-1' });
    await db('user_config').insert({ user_id: USER_ID, config_key: 'gcal_auto_sync', config_value: JSON.stringify(true) });

    var status = await facade.getGcalStatus(user);
    expect(status.connected).toBe(true);
    expect(status.autoSync).toBe(true);
  }));

  test('gcalMarkCodeUsed: real nonce replay guard — first use true, replay of the SAME code false, exactly one row', requireDB(async () => {
    var code = 'test-auth-code-' + Date.now();

    var first = await facade.gcalMarkCodeUsed(code);
    expect(first).toBe(true);

    var second = await facade.gcalMarkCodeUsed(code);
    expect(second).toBe(false);

    var hash = require('crypto').createHash('sha256').update(code.substring(0, 40)).digest('hex');
    var rows = await db('oauth_code_nonces').where('code_hash', hash);
    expect(rows.length).toBe(1); // INSERT IGNORE — replay never adds a second row
  }));

  test('gcalCallback: valid code+state → real users row updated with tokens (fake token exchange)', requireDB(async () => {
    await seedUser();
    gcalApi.getTokensFromCode.mockResolvedValue({
      access_token: 'fake-access-tok', refresh_token: 'fake-refresh-tok',
      expiry_date: Date.now() + 3600000
    });
    var code = 'gcal-cb-code-' + Date.now();
    var state = await signState({ userId: USER_ID });

    var result = await facade.gcalCallback(code, state, { id: USER_ID });

    expect(result.status).toBe(302);
    expect(result.redirect).toMatch(/\?gcal=connected/);
    var row = await db('users').where('id', USER_ID).first();
    expect(row.gcal_access_token).toBe('fake-access-tok');
    expect(row.gcal_refresh_token).toBe('fake-refresh-tok');
    expect(row.gcal_token_expiry).not.toBeNull();
  }));

  test('gcalDisconnect: real users row token columns null out', requireDB(async () => {
    await seedUser({ gcal_access_token: 'at', gcal_refresh_token: 'rt', gcal_token_expiry: new Date() });

    var result = await facade.gcalDisconnect(USER_ID);

    expect(result).toEqual({ disconnected: true });
    var row = await db('users').where('id', USER_ID).first();
    expect(row.gcal_access_token).toBeNull();
    expect(row.gcal_refresh_token).toBeNull();
    expect(row.gcal_token_expiry).toBeNull();
  }));

  test('setGcalAutoSync: fresh user → INSERT path (no pre-existing row)', requireDB(async () => {
    await seedUser();
    var result = await facade.setGcalAutoSync(USER_ID, true);
    expect(result).toEqual({ autoSync: true });
    var rows = await db('user_config').where({ user_id: USER_ID, config_key: 'gcal_auto_sync' });
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].config_value)).toBe(true);
  }));

  test('setGcalAutoSync: existing row → UPDATE path (single row, value flips)', requireDB(async () => {
    await seedUser();
    await facade.setGcalAutoSync(USER_ID, true);
    var result = await facade.setGcalAutoSync(USER_ID, false);
    expect(result).toEqual({ autoSync: false });
    var rows = await db('user_config').where({ user_id: USER_ID, config_key: 'gcal_auto_sync' });
    expect(rows.length).toBe(1); // still exactly one row — UPDATE, not a second INSERT
    expect(JSON.parse(rows[0].config_value)).toBe(false);
  }));
});

// ═══════════════════════════════════════════════════════════════════════════
// MSFT
// ═══════════════════════════════════════════════════════════════════════════

describe('MSFT account management — real DB', () => {
  test('getMsftStatus: not connected → connected:false, autoSync:false (adapter never invoked)', requireDB(async () => {
    var user = await seedUser();
    var status = await facade.getMsftStatus(user);
    expect(status).toEqual({
      connected: false, tokenExpired: false, email: null, lastSyncedAt: null, autoSync: false
    });
  }));

  test('getMsftStatus: connected with email already present → skips lazy backfill, real auto-sync row read', requireDB(async () => {
    var user = await seedUser({ msft_cal_refresh_token: 'rt-1', msft_cal_email: 'a@work.com' });
    await db('user_config').insert({ user_id: USER_ID, config_key: 'msft_cal_auto_sync', config_value: JSON.stringify(false) });

    var status = await facade.getMsftStatus(user);
    expect(status.connected).toBe(true);
    expect(status.email).toBe('a@work.com');
    expect(status.autoSync).toBe(false);
    expect(msftCalApi.getUserInfo).not.toHaveBeenCalled();
  }));

  test('msftMarkCodeUsed: real nonce replay guard — first true, replay false, one row (shared oauth_code_nonces table with gcal)', requireDB(async () => {
    var code = 'msft-code-' + Date.now();
    expect(await facade.msftMarkCodeUsed(code)).toBe(true);
    expect(await facade.msftMarkCodeUsed(code)).toBe(false);
    var hash = require('crypto').createHash('sha256').update(code.substring(0, 40)).digest('hex');
    var rows = await db('oauth_code_nonces').where('code_hash', hash);
    expect(rows.length).toBe(1);
  }));

  test('msftCallback: valid code+state+PKCE verifier → real users row updated with tokens', requireDB(async () => {
    await seedUser();
    msftCalApi.getTokensFromCode.mockResolvedValue({
      accessToken: 'fake-msft-at', refreshToken: 'fake-msft-rt', expiresOn: Date.now() + 3600000
    });
    msftCalApi.getUserInfo.mockResolvedValue({ email: 'msft-user@work.com' });
    var code = 'msft-cb-code-' + Date.now();
    var state = await signState({ userId: USER_ID, cv: 'code-verifier-abc' });

    var result = await facade.msftCallback(code, state, { id: USER_ID });

    expect(result.status).toBe(302);
    expect(result.redirect).toMatch(/\?msftcal=connected/);
    var row = await db('users').where('id', USER_ID).first();
    expect(row.msft_cal_access_token).toBe('fake-msft-at');
    expect(row.msft_cal_refresh_token).toBe('fake-msft-rt');
    expect(row.msft_cal_email).toBe('msft-user@work.com');
  }));

  test('msftDisconnect: real users row token columns null out', requireDB(async () => {
    await seedUser({ msft_cal_access_token: 'at', msft_cal_refresh_token: 'rt', msft_cal_token_expiry: new Date() });
    var result = await facade.msftDisconnect(USER_ID);
    expect(result).toEqual({ disconnected: true });
    var row = await db('users').where('id', USER_ID).first();
    expect(row.msft_cal_access_token).toBeNull();
    expect(row.msft_cal_refresh_token).toBeNull();
    expect(row.msft_cal_token_expiry).toBeNull();
  }));

  test('setMsftAutoSync: INSERT then UPDATE (same tri-state contract as gcal)', requireDB(async () => {
    await seedUser();
    await facade.setMsftAutoSync(USER_ID, true);
    var rows1 = await db('user_config').where({ user_id: USER_ID, config_key: 'msft_cal_auto_sync' });
    expect(rows1.length).toBe(1);
    expect(JSON.parse(rows1[0].config_value)).toBe(true);

    await facade.setMsftAutoSync(USER_ID, false);
    var rows2 = await db('user_config').where({ user_id: USER_ID, config_key: 'msft_cal_auto_sync' });
    expect(rows2.length).toBe(1);
    expect(JSON.parse(rows2[0].config_value)).toBe(false);
  }));
});

// ═══════════════════════════════════════════════════════════════════════════
// Apple
// ═══════════════════════════════════════════════════════════════════════════

describe('Apple account management — real DB (user_calendars CRUD)', () => {
  test('appleGetStatus: not connected → connected:false, calendars:null, autoSync:false', requireDB(async () => {
    var user = await seedUser();
    var status = await facade.appleGetStatus(user);
    expect(status.connected).toBe(false);
    expect(status.calendars).toBeNull();
    expect(status.autoSync).toBe(false);
  }));

  test('appleConnect: valid creds → real users row updated (encrypted password) + calendars listed with no prior selection', requireDB(async () => {
    await seedUser();
    appleCalApi.createClient.mockResolvedValue({ fake: 'client' });
    appleCalApi.discoverCalendars.mockResolvedValue([
      { url: 'https://caldav.icloud.com/1/home/', displayName: 'Home', description: '' }
    ]);

    var result = await facade.appleConnect(USER_ID, { username: 'a@icloud.com', password: 'app-specific-pass' });

    expect(result.status).toBe(200);
    expect(result.body.calendars).toEqual([
      { url: 'https://caldav.icloud.com/1/home/', displayName: 'Home', description: '', enabled: false, syncDirection: 'full' }
    ]);
    var row = await db('users').where('id', USER_ID).first();
    expect(row.apple_cal_username).toBe('a@icloud.com');
    expect(row.apple_cal_password).not.toBe('app-specific-pass'); // encrypted at rest
    expect(decrypt(row.apple_cal_password)).toBe('app-specific-pass');
  }));

  test('appleSelectCalendar: real user_calendars INSERT (fresh selection), then UPDATE (re-select same calendar)', requireDB(async () => {
    await seedUser({ apple_cal_username: 'a@icloud.com', apple_cal_password: 'enc' });
    var calUrl = 'https://caldav.icloud.com/1/home/';

    var r1 = await facade.appleSelectCalendar(USER_ID, { calendarUrl: calUrl });
    expect(r1).toEqual({ status: 200, body: { calendarUrl: calUrl } });
    var rows1 = await db('user_calendars').where({ user_id: USER_ID, provider: 'apple', calendar_id: calUrl });
    expect(rows1.length).toBe(1);
    expect(!!rows1[0].enabled).toBe(true);

    // Re-select same calendar → UPDATE, not a second row.
    await facade.appleSelectCalendar(USER_ID, { calendarUrl: calUrl });
    var rows2 = await db('user_calendars').where({ user_id: USER_ID, provider: 'apple', calendar_id: calUrl });
    expect(rows2.length).toBe(1);
  }));

  test('appleSelectCalendars: bulk INSERT + firstEnabled resolution writes users.apple_cal_calendar_url', requireDB(async () => {
    await seedUser({ apple_cal_username: 'a@icloud.com', apple_cal_password: 'enc' });
    var calA = 'https://caldav.icloud.com/1/a/';
    var calB = 'https://caldav.icloud.com/1/b/';

    var result = await facade.appleSelectCalendars(USER_ID, {
      calendars: [
        { url: calA, displayName: 'Cal A', enabled: false, syncDirection: 'pull' },
        { url: calB, displayName: 'Cal B', enabled: true, syncDirection: 'full' }
      ]
    });

    expect(result.status).toBe(200);
    expect(result.body.calendars.length).toBe(2);
    var userRow = await db('users').where('id', USER_ID).first();
    expect(userRow.apple_cal_calendar_url).toBe(calB); // the enabled one
  }));

  test('appleGetCalendars: reads real user_calendars rows for the user+provider', requireDB(async () => {
    await seedUser();
    await db('user_calendars').insert({ user_id: USER_ID, provider: 'apple', calendar_id: 'u1', enabled: true, sync_direction: 'full' });
    var result = await facade.appleGetCalendars(USER_ID);
    expect(result.status).toBe(200);
    expect(result.body.calendars.length).toBe(1);
  }));

  test('appleUpdateCalendar: 404 for a calendar not owned by the user; 200 updates + recomputes users.apple_cal_calendar_url', requireDB(async () => {
    await seedUser();
    var notFound = await facade.appleUpdateCalendar(USER_ID, 999999, { enabled: true });
    expect(notFound.status).toBe(404);

    var [id] = await db('user_calendars').insert({ user_id: USER_ID, provider: 'apple', calendar_id: 'u1', enabled: false, sync_direction: 'full' });
    var result = await facade.appleUpdateCalendar(USER_ID, id, { enabled: true, syncDirection: 'pull' });
    expect(result.status).toBe(200);
    expect(!!result.body.calendar.enabled).toBe(true);
    expect(result.body.calendar.sync_direction).toBe('pull');

    var userRow = await db('users').where('id', USER_ID).first();
    expect(userRow.apple_cal_calendar_url).toBe('u1'); // now the enabled one
  }));

  test('appleRefreshCalendars: existing calendar rename UPDATEs; new remote calendar INSERTs with BOTH created_at+updated_at', requireDB(async () => {
    var user = await seedUser({ apple_cal_username: 'a@icloud.com', apple_cal_password: require('../../../../src/lib/credential-encrypt').encrypt('pw') });
    await db('user_calendars').insert({ user_id: USER_ID, provider: 'apple', calendar_id: 'u-existing', display_name: 'Old Name', enabled: true, sync_direction: 'full' });

    appleCalApi.createClient.mockResolvedValue({ fake: 'client' });
    appleCalApi.discoverCalendars.mockResolvedValue([
      { url: 'u-existing', displayName: 'New Name' },
      { url: 'u-new', displayName: 'Brand New Cal' }
    ]);

    var result = await facade.appleRefreshCalendars(USER_ID, user);

    expect(result.status).toBe(200);
    expect(result.body.calendars.length).toBe(2);

    var existingRow = await db('user_calendars').where({ user_id: USER_ID, calendar_id: 'u-existing' }).first();
    expect(existingRow.display_name).toBe('New Name');

    var newRow = await db('user_calendars').where({ user_id: USER_ID, calendar_id: 'u-new' }).first();
    expect(newRow.display_name).toBe('Brand New Cal');
    expect(newRow.created_at).not.toBeNull();
    expect(newRow.updated_at).not.toBeNull();
  }));

  test('appleDisconnect: real user_calendars rows deleted, users columns nulled, auto-sync config row deleted', requireDB(async () => {
    await seedUser({ apple_cal_username: 'a@icloud.com', apple_cal_password: 'enc', apple_cal_calendar_url: 'u1' });
    await db('user_calendars').insert({ user_id: USER_ID, provider: 'apple', calendar_id: 'u1', enabled: true, sync_direction: 'full' });
    await db('user_config').insert({ user_id: USER_ID, config_key: 'apple_cal_auto_sync', config_value: JSON.stringify(true) });

    var result = await facade.appleDisconnect(USER_ID);

    expect(result).toEqual({ disconnected: true });
    var cals = await db('user_calendars').where({ user_id: USER_ID, provider: 'apple' });
    expect(cals.length).toBe(0);
    var userRow = await db('users').where('id', USER_ID).first();
    expect(userRow.apple_cal_username).toBeNull();
    expect(userRow.apple_cal_password).toBeNull();
    expect(userRow.apple_cal_calendar_url).toBeNull();
    var cfg = await db('user_config').where({ user_id: USER_ID, config_key: 'apple_cal_auto_sync' });
    expect(cfg.length).toBe(0);
  }));

  test('setAppleAutoSync: INSERT then UPDATE — CHARACTERIZATION DISCOVERY: the UPDATE branch omits updated_at (unlike gcal/msft), reproduced as-is', requireDB(async () => {
    await seedUser();
    await facade.setAppleAutoSync(USER_ID, true);
    var before = await db('user_config').where({ user_id: USER_ID, config_key: 'apple_cal_auto_sync' }).first();
    expect(JSON.parse(before.config_value)).toBe(true);

    await facade.setAppleAutoSync(USER_ID, false);
    var rows = await db('user_config').where({ user_id: USER_ID, config_key: 'apple_cal_auto_sync' });
    expect(rows.length).toBe(1); // UPDATE, not a second INSERT
    expect(JSON.parse(rows[0].config_value)).toBe(false);
  }));
});
