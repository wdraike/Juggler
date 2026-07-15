/**
 * gcal.controller.js — thin HTTP-adapter contract for the new 999.1626
 * per-calendar endpoints (getCalendars / updateCalendar / refreshCalendars).
 * Mirrors tests/apple-cal-controller.test.js Part 1's pattern: facade is
 * mocked, so this pins ONLY the req->facade argument mapping and the
 * response envelope (res.status(result.status).json(result.body) vs the
 * catch-all 500).
 */

'use strict';

jest.mock('../src/slices/calendar/facade', function () {
  return {
    getGcalStatus: jest.fn(),
    gcalConnect: jest.fn(),
    gcalCallback: jest.fn(),
    gcalDisconnect: jest.fn(),
    setGcalAutoSync: jest.fn(),
    gcalGetCalendars: jest.fn(),
    gcalUpdateCalendar: jest.fn(),
    gcalRefreshCalendars: jest.fn(),
    gcalMarkCodeUsed: jest.fn()
  };
});

var facade = require('../src/slices/calendar/facade');
var controller = require('../src/controllers/gcal.controller');

var USER = { id: 'user-gcal-1', gcal_refresh_token: 'rt' };

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

describe('getCalendars', function () {
  test('calls facade.gcalGetCalendars(userId) and forwards status+body', async function () {
    facade.gcalGetCalendars.mockResolvedValue({ status: 200, body: { calendars: [{ id: 1 }] } });
    var res = makeRes();

    await controller.getCalendars(makeReq(), res);

    expect(facade.gcalGetCalendars).toHaveBeenCalledWith('user-gcal-1');
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ calendars: [{ id: 1 }] });
  });

  test('500s on facade throw', async function () {
    facade.gcalGetCalendars.mockRejectedValue(new Error('boom'));
    var res = makeRes();

    await controller.getCalendars(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Failed to get calendars' });
  });
});

describe('updateCalendar', function () {
  test('passes userId, req.params.id, and req.body to facade.gcalUpdateCalendar', async function () {
    facade.gcalUpdateCalendar.mockResolvedValue({ status: 200, body: { calendar: { id: 7, enabled: false } } });
    var res = makeRes();
    var req = makeReq({ params: { id: '7' }, body: { enabled: false } });

    await controller.updateCalendar(req, res);

    expect(facade.gcalUpdateCalendar).toHaveBeenCalledWith('user-gcal-1', '7', { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ calendar: { id: 7, enabled: false } });
  });

  test('forwards a facade 404 verbatim', async function () {
    facade.gcalUpdateCalendar.mockResolvedValue({ status: 404, body: { error: 'Calendar not found' } });
    var res = makeRes();

    await controller.updateCalendar(makeReq({ params: { id: '999' } }), res);

    expect(res.statusCode).toBe(404);
    expect(res.jsonBody).toEqual({ error: 'Calendar not found' });
  });
});

describe('refreshCalendars', function () {
  test('passes userId AND the full req.user (facade needs gcal_refresh_token off it)', async function () {
    facade.gcalRefreshCalendars.mockResolvedValue({ status: 200, body: { calendars: [] } });
    var res = makeRes();

    await controller.refreshCalendars(makeReq(), res);

    expect(facade.gcalRefreshCalendars).toHaveBeenCalledWith('user-gcal-1', USER);
    expect(res.statusCode).toBe(200);
  });

  test('500s on facade throw', async function () {
    facade.gcalRefreshCalendars.mockRejectedValue(new Error('boom'));
    var res = makeRes();

    await controller.refreshCalendars(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.jsonBody).toEqual({ error: 'Failed to refresh calendars' });
  });
});
