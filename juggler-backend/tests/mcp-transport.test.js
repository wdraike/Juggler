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

// ── BLOCK 2: dev-token bypass behaviors ───────────────────────────────────

describe('transport dev-token bypass', function () {
  var savedNodeEnv;
  var savedMcpDevNoAuth;

  beforeEach(function () {
    savedNodeEnv = process.env.NODE_ENV;
    savedMcpDevNoAuth = process.env.MCP_DEV_NO_AUTH;
    jest.resetModules();
  });

  afterEach(function () {
    process.env.NODE_ENV = savedNodeEnv;
    if (savedMcpDevNoAuth === undefined) {
      delete process.env.MCP_DEV_NO_AUTH;
    } else {
      process.env.MCP_DEV_NO_AUTH = savedMcpDevNoAuth;
    }
    jest.resetModules();
  });

  // ── ZOE-JUG-014 (c): dev-token blocked when NODE_ENV=production ───────────

  test('dev-token bypass is blocked in production — returns 401', async function () {
    process.env.NODE_ENV = 'production';
    delete process.env.MCP_DEV_NO_AUTH;

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

    // In production dev-token must never be accepted — it is forwarded to
    // authenticateMcpRequest (returns null) → 401.
    expect(capturedStatus).toBe(401);
  });

  // ── ZOE-JUG-014 (c): MCP_DEV_NO_AUTH=true is still blocked in production ─

  test('MCP_DEV_NO_AUTH=true + NODE_ENV=production + dev-token → returns 401', async function () {
    process.env.NODE_ENV = 'production';
    process.env.MCP_DEV_NO_AUTH = 'true';

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

    // The production guard (process.env.NODE_ENV !== 'production') must win
    // even when MCP_DEV_NO_AUTH is true — dev-token must be rejected.
    expect(capturedStatus).toBe(401);
  });

  // ── ZOE-JUG-014 (b): MCP_DEV_NO_AUTH=true + NODE_ENV=development → bypass ─

  test('MCP_DEV_NO_AUTH=true + NODE_ENV=development + dev-token → auth bypassed', async function () {
    process.env.NODE_ENV = 'development';
    process.env.MCP_DEV_NO_AUTH = 'true';

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
    // Capture server factory to assert dev-user identity after the call.
    // Variable must be prefixed "mock" so Jest's hoisting allows it in mock factory.
    var mockDevServerFactory = jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    });
    jest.mock('../src/mcp/server', function () {
      return { createMcpServerForUser: mockDevServerFactory };
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

    var devTransport = require('../src/mcp/transport');

    var mockReq = {
      headers: { authorization: 'Bearer dev-token' },
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

    await devTransport.handlePost(mockReq, mockRes);

    // The dev bypass must have been taken:
    //   - createMcpServerForUser is called with 'dev-user' (bypass identity)
    //   - authenticateMcpRequest is NOT called (token validation skipped)
    var mockAuthModule = require('auth-client/mcp-auth');
    expect(mockAuthModule.authenticateMcpRequest).not.toHaveBeenCalled();
    expect(mockDevServerFactory).toHaveBeenCalledWith('dev-user');
  });
});
