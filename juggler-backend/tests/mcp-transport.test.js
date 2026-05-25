/**
 * Unit tests for juggler-backend/src/mcp/transport.js
 *
 * Block 1 — planCheck behavior + dev-token bypass production guard.
 *
 * We extract planCheck by loading the module under controlled mocks so that
 * none of the heavy SDK or server dependencies are resolved during the test.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

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

jest.mock('../src/mcp/server', function () {
  return {
    createMcpServerForUser: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    })
  };
});

var mockAuthenticateMcpRequest = jest.fn();
var mockSendMcpUnauthorized = jest.fn();

jest.mock('auth-client/mcp-auth', function () {
  return {
    authenticateMcpRequest: mockAuthenticateMcpRequest,
    sendMcpUnauthorized: mockSendMcpUnauthorized
  };
});

jest.mock('../src/db', function () {
  var fn = { now: function () { return 'MOCK_NOW'; } };
  var mock = function () { return mock; };
  mock.fn = fn;
  return mock;
});

// service-identity returns APP_ID = 'juggler' by default (or from env)
// We do NOT override APP_ID here so the test matches the real constant.

// ── planCheck extraction ────────────────────────────────────────────────────
//
// transport.js does not export planCheck directly; it is a private function
// captured as the `planCheck` option passed to authenticateMcpRequest.
// We recover it by calling authenticateMcpRequest and inspecting the opts arg.

var transport; // loaded after mocks

beforeAll(function () {
  transport = require('../src/mcp/transport');
});

afterAll(function () {
  jest.resetModules();
});

// ── Helper: recover the planCheck function ──────────────────────────────────

function getPlanCheck() {
  // We need to trigger a real call path through handlePost so that
  // authenticateMcpRequest is called with the planCheck option.
  // Easier: require the private function directly by re-requiring the module
  // with jest.isolateModules and inspecting what is passed.
  //
  // Because transport.js is already loaded above we use the mock to capture it.
  var capturedOpts = null;
  mockAuthenticateMcpRequest.mockImplementationOnce(function (_token, _db, opts) {
    capturedOpts = opts;
    return Promise.resolve(null); // force 401 — we only care about opts capture
  });

  var mockReq = {
    headers: { authorization: 'Bearer real-token' },
    protocol: 'http',
    get: function () { return 'localhost'; },
    body: {}
  };
  var mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false,
    on: jest.fn()
  };

  return transport.handlePost(mockReq, mockRes).then(function () {
    if (!capturedOpts || typeof capturedOpts.planCheck !== 'function') {
      throw new Error('planCheck was not passed to authenticateMcpRequest');
    }
    return capturedOpts.planCheck;
  });
}

// ── BLOCK 1: planCheck ──────────────────────────────────────────────────────

describe('transport planCheck', function () {
  var planCheck;

  beforeAll(async function () {
    planCheck = await getPlanCheck();
  });

  test('no plan in JWT → hasActivePlan: false', async function () {
    var result = await planCheck({ plans: {} });
    expect(result).toEqual({ hasActivePlan: false });
  });

  test('correct APP_ID plan present → hasActivePlan: true with planId', async function () {
    var APP_ID = require('../src/service-identity').APP_ID;
    var plans = {};
    plans[APP_ID] = 'basic';
    var result = await planCheck({ plans: plans });
    expect(result).toEqual({ hasActivePlan: true, planId: 'basic' });
  });

  test('plans undefined → hasActivePlan: false', async function () {
    var result = await planCheck({});
    expect(result).toEqual({ hasActivePlan: false });
  });
});

// ── BLOCK 1: dev-token bypass blocked in production ────────────────────────

describe('transport dev-token bypass', function () {
  var savedNodeEnv;

  beforeEach(function () {
    savedNodeEnv = process.env.NODE_ENV;
    jest.resetModules();
  });

  afterEach(function () {
    process.env.NODE_ENV = savedNodeEnv;
    jest.resetModules();
  });

  test('dev-token bypass is blocked in production — returns 401', async function () {
    process.env.NODE_ENV = 'production';

    // Re-mock after resetModules
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
    jest.mock('../src/mcp/server', function () {
      return {
        createMcpServerForUser: jest.fn().mockReturnValue({
          connect: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined)
        })
      };
    });
    jest.mock('auth-client/mcp-auth', function () {
      return {
        authenticateMcpRequest: jest.fn().mockResolvedValue(null),
        sendMcpUnauthorized: jest.fn()
      };
    });
    jest.mock('../src/db', function () {
      var fn = { now: function () { return 'MOCK_NOW'; } };
      var mock = function () { return mock; };
      mock.fn = fn;
      return mock;
    });

    var prodTransport = require('../src/mcp/transport');

    var capturedStatus = null;
    var mockReq = {
      headers: { authorization: 'Bearer dev-token' },
      protocol: 'http',
      get: function () { return 'localhost'; },
      body: {}
    };
    var mockRes = {
      status: jest.fn().mockImplementation(function (code) {
        capturedStatus = code;
        return mockRes;
      }),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
      on: jest.fn()
    };

    await prodTransport.handlePost(mockReq, mockRes);

    // In production, dev-token must not be accepted — either the token is sent
    // to authenticateMcpRequest (which returns null → 401) or the bypass guard
    // short-circuits and the sendMcpUnauthorized / 401 path runs.
    // Either way the response must not be 200.
    expect(capturedStatus).not.toBeNull();
    expect(capturedStatus).not.toBe(200);
    // Specifically expect 401 — the guard sends 401 when auth fails
    expect(capturedStatus).toBe(401);
  });
});
