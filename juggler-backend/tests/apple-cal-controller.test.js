/**
 * apple-cal.controller.js unit suite (999.1214).
 *
 * The controller is a THIN HTTP adapter over slices/calendar/facade (999.943):
 * its whole contract is (a) which facade function each route handler calls,
 * (b) the exact req -> argument mapping (getStatus passes the FULL req.user,
 * connect passes req.user.id + req.body, updateCalendar adds req.params.id,
 * setAutoSync extracts req.body.enabled, ...), (c) envelope forwarding
 * (res.status(result.status).json(result.body) vs bare res.json(result)), and
 * (d) the catch-all 500 mapping with a per-route error message. That contract
 * is what this suite pins — before it, no test referenced the controller at
 * all (Apple was the provider always nulled out in cal-sync fixtures).
 *
 * Part 2 exercises the CREDENTIAL-VALIDATION flow through the REAL facade
 * (jest.requireActual) with only the CalDAV API (lib/apple-cal-api) mocked —
 * the 400/401/401/404 branches never touch the DB, so no test-bed is needed.
 */

'use strict';

jest.mock('../src/slices/calendar/facade', function () {
  return {
    appleGetStatus: jest.fn(),
    appleConnect: jest.fn(),
    appleSelectCalendar: jest.fn(),
    appleSelectCalendars: jest.fn(),
    appleGetCalendars: jest.fn(),
    appleUpdateCalendar: jest.fn(),
    appleRefreshCalendars: jest.fn(),
    appleDisconnect: jest.fn(),
    setAppleAutoSync: jest.fn()
  };
});

jest.mock('../src/lib/apple-cal-api', function () {
  return {
    DEFAULT_SERVER_URL: 'https://caldav.icloud.com',
    createClient: jest.fn(),
    discoverCalendars: jest.fn()
  };
});

var facade = require('../src/slices/calendar/facade');
var appleCalApi = require('../src/lib/apple-cal-api');
var controller = require('../src/controllers/apple-cal.controller');

var USER = { id: 'user-apple-1', apple_cal_username: 'a@icloud.com', apple_cal_password: 'enc' };

function makeRes() {
  var res = {
    statusCode: null,
    jsonBody: undefined,
    status: function (code) { res.statusCode = code; return res; },
    json: function (body) { res.jsonBody = body; return res; }
  };
  return res;
}

function makeReq(overrides) {
  return Object.assign({ user: USER, body: {}, params: {} }, overrides || {});
}

afterEach(function () { jest.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — controller req->facade->res mapping (facade mocked)
// ─────────────────────────────────────────────────────────────────────────────

describe('getStatus', function () {
  test('passes the FULL req.user (facade reads credential columns off it) and returns the result via bare res.json', async function () {
    var statusResult = { connected: true, username: 'a@icloud.com', autoSync: false };
    facade.appleGetStatus.mockResolvedValue(statusResult);
    var res = makeRes();

    await controller.getStatus(makeReq(), res);

    expect(facade.appleGetStatus).toHaveBeenCalledWith(USER);
    expect(res.statusCode).toBeNull(); // bare res.json — no res.status() call
    expect(res.jsonBody).toBe(statusResult);
  });

  test('maps a facade throw to 500 with the status-specific message', async function () {
    facade.appleGetStatus.mockRejectedValue(new Error('boom'));
    var res = makeRes();

    await controller.getStatus(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Failed to get Apple Calendar status' });
  });
});

describe('connect', function () {
  test('passes req.user.id + req.body and forwards the facade envelope (status AND body)', async function () {
    var body = { username: 'a@icloud.com', password: 'app-pass' };
    var envelope = { status: 200, body: { calendars: [{ url: 'u1', displayName: 'Home', enabled: false, syncDirection: 'full' }] } };
    facade.appleConnect.mockResolvedValue(envelope);
    var res = makeRes();

    await controller.connect(makeReq({ body: body }), res);

    expect(facade.appleConnect).toHaveBeenCalledWith(USER.id, body);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toBe(envelope.body);
  });

  test('forwards a 401 bad-credentials envelope verbatim (does not swallow it into 500)', async function () {
    facade.appleConnect.mockResolvedValue({
      status: 401,
      body: { error: 'Failed to connect. Check your Apple ID and app-specific password.', detail: 'auth failed' }
    });
    var res = makeRes();

    await controller.connect(makeReq({ body: { username: 'a', password: 'bad' } }), res);

    expect(res.statusCode).toBe(401);
    expect(res.jsonBody.error).toBe('Failed to connect. Check your Apple ID and app-specific password.');
    expect(res.jsonBody.detail).toBe('auth failed');
  });

  test('maps a facade throw to 500 with the connect-specific message', async function () {
    facade.appleConnect.mockRejectedValue(new Error('network down'));
    var res = makeRes();

    await controller.connect(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Failed to connect Apple Calendar' });
  });
});

describe('selectCalendar / selectCalendars', function () {
  test('selectCalendar passes (userId, body) and forwards the envelope', async function () {
    var body = { calendarUrl: 'https://caldav.icloud.com/1/calendars/home/' };
    facade.appleSelectCalendar.mockResolvedValue({ status: 200, body: { calendarUrl: body.calendarUrl } });
    var res = makeRes();

    await controller.selectCalendar(makeReq({ body: body }), res);

    expect(facade.appleSelectCalendar).toHaveBeenCalledWith(USER.id, body);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ calendarUrl: body.calendarUrl });
  });

  test('selectCalendars forwards a 400 validation envelope', async function () {
    facade.appleSelectCalendars.mockResolvedValue({ status: 400, body: { error: 'calendars array is required' } });
    var res = makeRes();

    await controller.selectCalendars(makeReq({ body: {} }), res);

    expect(facade.appleSelectCalendars).toHaveBeenCalledWith(USER.id, {});
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({ error: 'calendars array is required' });
  });

  test('selectCalendar maps a throw to its route-specific 500 message', async function () {
    facade.appleSelectCalendar.mockRejectedValue(new Error('x'));
    var res = makeRes();
    await controller.selectCalendar(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Failed to select calendar' });
  });

  test('selectCalendars maps a throw to its route-specific 500 message', async function () {
    facade.appleSelectCalendars.mockRejectedValue(new Error('x'));
    var res = makeRes();
    await controller.selectCalendars(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Failed to save calendar selections' });
  });
});

describe('getCalendars / updateCalendar / refreshCalendars', function () {
  test('getCalendars passes ONLY the user id', async function () {
    facade.appleGetCalendars.mockResolvedValue({ status: 200, body: { calendars: [] } });
    var res = makeRes();

    await controller.getCalendars(makeReq(), res);

    expect(facade.appleGetCalendars).toHaveBeenCalledWith(USER.id);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ calendars: [] });
  });

  test('updateCalendar passes (userId, req.params.id, req.body)', async function () {
    var updated = { id: 7, enabled: 1, sync_direction: 'pull' };
    facade.appleUpdateCalendar.mockResolvedValue({ status: 200, body: { calendar: updated } });
    var res = makeRes();

    await controller.updateCalendar(
      makeReq({ params: { id: '7' }, body: { enabled: true, syncDirection: 'pull' } }), res);

    expect(facade.appleUpdateCalendar).toHaveBeenCalledWith(USER.id, '7', { enabled: true, syncDirection: 'pull' });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ calendar: updated });
  });

  test('updateCalendar forwards a 404 not-found envelope', async function () {
    facade.appleUpdateCalendar.mockResolvedValue({ status: 404, body: { error: 'Calendar not found' } });
    var res = makeRes();

    await controller.updateCalendar(makeReq({ params: { id: 'nope' } }), res);

    expect(res.statusCode).toBe(404);
    expect(res.jsonBody).toEqual({ error: 'Calendar not found' });
  });

  test('refreshCalendars passes BOTH userId and the full user row (facade decrypts creds off it)', async function () {
    facade.appleRefreshCalendars.mockResolvedValue({ status: 200, body: { calendars: [] } });
    var res = makeRes();

    await controller.refreshCalendars(makeReq(), res);

    expect(facade.appleRefreshCalendars).toHaveBeenCalledWith(USER.id, USER);
    expect(res.statusCode).toBe(200);
  });

  test('each maps a throw to its route-specific 500 message', async function () {
    facade.appleGetCalendars.mockRejectedValue(new Error('x'));
    facade.appleUpdateCalendar.mockRejectedValue(new Error('x'));
    facade.appleRefreshCalendars.mockRejectedValue(new Error('x'));

    var r1 = makeRes(); await controller.getCalendars(makeReq(), r1);
    var r2 = makeRes(); await controller.updateCalendar(makeReq({ params: { id: '1' } }), r2);
    var r3 = makeRes(); await controller.refreshCalendars(makeReq(), r3);

    expect([r1.statusCode, r2.statusCode, r3.statusCode]).toEqual([500, 500, 500]);
    expect(r1.jsonBody).toEqual({ error: 'Failed to get calendars' });
    expect(r2.jsonBody).toEqual({ error: 'Failed to update calendar' });
    expect(r3.jsonBody).toEqual({ error: 'Failed to refresh calendars' });
  });
});

describe('disconnect / setAutoSync', function () {
  test('disconnect passes userId and returns the raw result via bare res.json', async function () {
    facade.appleDisconnect.mockResolvedValue({ disconnected: true });
    var res = makeRes();

    await controller.disconnect(makeReq(), res);

    expect(facade.appleDisconnect).toHaveBeenCalledWith(USER.id);
    expect(res.statusCode).toBeNull(); // bare res.json
    expect(res.jsonBody).toEqual({ disconnected: true });
  });

  test('disconnect maps a throw to 500 with its message', async function () {
    facade.appleDisconnect.mockRejectedValue(new Error('x'));
    var res = makeRes();
    await controller.disconnect(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Failed to disconnect Apple Calendar' });
  });

  test('setAutoSync extracts req.body.enabled (not the whole body) and returns the raw result', async function () {
    facade.setAppleAutoSync.mockResolvedValue({ autoSync: true });
    var res = makeRes();

    await controller.setAutoSync(makeReq({ body: { enabled: true, extraneous: 'ignored' } }), res);

    expect(facade.setAppleAutoSync).toHaveBeenCalledWith(USER.id, true);
    expect(res.statusCode).toBeNull();
    expect(res.jsonBody).toEqual({ autoSync: true });
  });

  test('setAutoSync maps a throw to 500 with its message', async function () {
    facade.setAppleAutoSync.mockRejectedValue(new Error('x'));
    var res = makeRes();
    await controller.setAutoSync(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Failed to update auto-sync setting' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — credential-validation flow through the REAL facade
// (jest.requireActual bypasses the facade mock; its internal require of
// lib/apple-cal-api still resolves to the mock above. The 400/401/401/404
// branches all return BEFORE any DB access, so no test-bed is required.)
// ─────────────────────────────────────────────────────────────────────────────

describe('appleConnect credential validation (real facade, CalDAV API mocked)', function () {
  var realFacade = jest.requireActual('../src/slices/calendar/facade');

  test('400 when username or password is missing — no CalDAV round trip attempted', async function () {
    var r1 = await realFacade.appleConnect('u1', { password: 'p' });
    var r2 = await realFacade.appleConnect('u1', { username: 'a@icloud.com' });

    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
    expect(r1.body.error).toBe('Apple ID email and app-specific password are required');
    expect(appleCalApi.createClient).not.toHaveBeenCalled();
  });

  test('401 with connect-specific message when CalDAV auth (createClient) fails', async function () {
    appleCalApi.createClient.mockRejectedValue(new Error('401 Unauthorized'));

    var r = await realFacade.appleConnect('u1', { username: 'a@icloud.com', password: 'bad-pass' });

    expect(appleCalApi.createClient).toHaveBeenCalledWith(
      'https://caldav.icloud.com', 'a@icloud.com', 'bad-pass');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Failed to connect. Check your Apple ID and app-specific password.');
    expect(r.body.detail).toBe('401 Unauthorized');
    expect(appleCalApi.discoverCalendars).not.toHaveBeenCalled();
  });

  test('401 with discovery-specific message when auth succeeds but discovery fails', async function () {
    appleCalApi.createClient.mockResolvedValue({ fake: 'client' });
    appleCalApi.discoverCalendars.mockRejectedValue(new Error('propfind failed'));

    var r = await realFacade.appleConnect('u1', { username: 'a@icloud.com', password: 'ok' });

    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Connected but failed to discover calendars. Check your credentials.');
    expect(r.body.detail).toBe('propfind failed');
  });

  test('404 when the account has zero calendars', async function () {
    appleCalApi.createClient.mockResolvedValue({ fake: 'client' });
    appleCalApi.discoverCalendars.mockResolvedValue([]);

    var r = await realFacade.appleConnect('u1', { username: 'a@icloud.com', password: 'ok' });

    expect(r.status).toBe(404);
    expect(r.body.error).toBe('No calendars found on this account');
  });

  test('honors an explicit serverUrl over the default', async function () {
    appleCalApi.createClient.mockRejectedValue(new Error('nope'));

    await realFacade.appleConnect('u1', {
      username: 'a@icloud.com', password: 'p', serverUrl: 'https://dav.example.com'
    });

    expect(appleCalApi.createClient).toHaveBeenCalledWith(
      'https://dav.example.com', 'a@icloud.com', 'p');
  });
});
