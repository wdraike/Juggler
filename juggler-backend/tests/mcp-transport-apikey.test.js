/**
 * WI-4 (devmcp leg) — POST /mcp API-key auth end-to-end wiring tests.
 *
 * Exercises the REAL `authenticateMcpRequest` (auth-client/mcp-auth.js,
 * WI-1's fixed module — NOT mocked here) and the REAL
 * `src/mcp/api-key-auth.js` (NOT mocked) through transport.js's actual
 * `handlePost`. Only the network boundary — `vendor/service-auth`'s
 * initServiceAuth/serviceRequest — is mocked, so this proves the full chain
 * (transport → mcp-auth → api-key-auth → service-auth) is wired correctly,
 * not just that each piece works in isolation.
 *
 * A bearer token with no `.` segments (e.g. 'mcp_live_...') never satisfies
 * mcp-auth.js's `token.split('.').length === 3` JWT gate, so these requests
 * fall straight through to the apiKeyValidator branch — no JWKS/network call
 * is made for JWT verification.
 *
 * Scenarios (SPEC devmcp R3):
 *   (a) valid API key + entitled user   → request proceeds (no 401/403)
 *   (b) valid API key + NOT entitled    → 401 (see api-key-auth.js's docblock
 *                                          for why this collapses to 401 and
 *                                          not a distinct 403)
 *   (c) invalid API key                 → 401
 */

'use strict';

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', function () {
  return {
    StreamableHTTPServerTransport: jest.fn().mockImplementation(function () {
      return {
        handleRequest: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined)
      };
    })
  };
});

var mockCreateMcpServerForUser = jest.fn().mockReturnValue({
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined)
});
jest.mock('../src/mcp/server', function () {
  return { createMcpServerForUser: mockCreateMcpServerForUser };
});

jest.mock('../src/db', function () {
  var fn = { now: function () { return 'MOCK_NOW'; } };
  var mock = function () { return mock; };
  mock.fn = fn;
  return mock;
});

// NOTE: auth-client/mcp-auth is intentionally NOT mocked — we want the real
// WI-1-fixed authenticateMcpRequest branching (JWT vs apiKeyValidator vs
// planCheck) exercised. Only the outbound service-to-service HTTP call is
// mocked, at the vendor/service-auth boundary that api-key-auth.js (also
// real, also not mocked) depends on.
var mockInitServiceAuth = jest.fn().mockResolvedValue(undefined);
var mockServiceRequest = jest.fn();
jest.mock('../vendor/service-auth', function () {
  return {
    initServiceAuth: mockInitServiceAuth,
    serviceRequest: mockServiceRequest
  };
});

var transport;

beforeAll(function () {
  transport = require('../src/mcp/transport');
});

beforeEach(function () {
  mockCreateMcpServerForUser.mockClear();
  mockServiceRequest.mockReset();
});

function makeReqRes(token) {
  var capturedStatus = null;
  var capturedBody = null;
  var req = {
    headers: { authorization: 'Bearer ' + token },
    protocol: 'http',
    get: function () { return 'localhost'; },
    body: {}
  };
  var res = {
    status: jest.fn().mockImplementation(function (code) { capturedStatus = code; return res; }),
    json: jest.fn().mockImplementation(function (body) { capturedBody = body; return res; }),
    headersSent: false,
    on: jest.fn()
  };
  return {
    req: req,
    res: res,
    getStatus: function () { return capturedStatus; },
    getBody: function () { return capturedBody; }
  };
}

describe('POST /mcp — apiKeyValidator wiring (WI-4)', function () {
  test('(a) valid API key + entitled user → request proceeds (no 401/403, server created for the resolved user)', async function () {
    mockServiceRequest.mockImplementation(function (target, path) {
      if (target === 'auth-service') {
        expect(path).toBe('/internal/api-keys/introspect');
        return Promise.resolve({ valid: true, user_id: 'user-entitled-1', key_type: 'mcp' });
      }
      if (target === 'payment-service') {
        expect(path).toBe('/internal/users/user-entitled-1/entitlement?product=juggler');
        return Promise.resolve({ success: true, entitlement: { entitled: true, productSlug: 'juggler', statuses: ['active'] } });
      }
      throw new Error('unexpected target: ' + target);
    });

    var h = makeReqRes('mcp_live_validAndEntitled');
    await transport.handlePost(h.req, h.res);

    expect(h.getStatus()).not.toBe(401);
    expect(h.getStatus()).not.toBe(403);
    expect(mockCreateMcpServerForUser).toHaveBeenCalledWith('user-entitled-1');
  });

  test('(b) valid API key + NOT entitled → 401', async function () {
    mockServiceRequest.mockImplementation(function (target) {
      if (target === 'auth-service') {
        return Promise.resolve({ valid: true, user_id: 'user-not-entitled', key_type: 'mcp' });
      }
      if (target === 'payment-service') {
        return Promise.resolve({ success: true, entitlement: { entitled: false, productSlug: 'juggler', statuses: [] } });
      }
      throw new Error('unexpected target');
    });

    var h = makeReqRes('mcp_live_validNotEntitled');
    await transport.handlePost(h.req, h.res);

    expect(h.getStatus()).toBe(401);
    expect(mockCreateMcpServerForUser).not.toHaveBeenCalled();
  });

  test('(c) invalid API key → 401', async function () {
    mockServiceRequest.mockImplementation(function (target) {
      if (target === 'auth-service') {
        return Promise.resolve({ valid: false });
      }
      throw new Error('payment-service must not be called for an invalid key');
    });

    var h = makeReqRes('totally-bogus-key');
    await transport.handlePost(h.req, h.res);

    expect(h.getStatus()).toBe(401);
    expect(mockCreateMcpServerForUser).not.toHaveBeenCalled();
  });
});
