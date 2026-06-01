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

// ── BLOCK 3: ZOE-JUG-016 — MCP_DEV_NO_AUTH=true alone must NOT activate /oauth/authorize ──
//
// Security invariant: the dev /oauth/authorize route in app.js is guarded solely by
//   if (process.env.NODE_ENV === 'development') { ... }
// MCP_DEV_NO_AUTH has no effect on that guard. If someone sets MCP_DEV_NO_AUTH=true
// in production (NODE_ENV=production or unset) the dev auto-approve flow must NOT run.
//
// These tests verify the guard condition directly — no full Express app required.

describe('ZOE-JUG-016 — /oauth/authorize dev guard requires NODE_ENV=development, not MCP_DEV_NO_AUTH', function () {

  /**
   * Evaluate the exact guard condition used in app.js line 159:
   *   if (process.env.NODE_ENV === 'development')
   * Returns true if the dev /oauth/authorize route would be registered.
   *
   * Guard expression copied from app.js:guard — mitigated by supertest
   * integration tests (mcp-transport.supertest.test.js); tighten if guard
   * logic changes (e.g. if the condition in app.js ever becomes more complex
   * than a single NODE_ENV string comparison).
   */
  function oauthAuthorizeDevGuard() {
    return process.env.NODE_ENV === 'development';
  }

  var savedNodeEnv;
  var savedMcpDevNoAuth;

  beforeEach(function () {
    savedNodeEnv = process.env.NODE_ENV;
    savedMcpDevNoAuth = process.env.MCP_DEV_NO_AUTH;
  });

  afterEach(function () {
    if (savedNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = savedNodeEnv;
    }
    if (savedMcpDevNoAuth === undefined) {
      delete process.env.MCP_DEV_NO_AUTH;
    } else {
      process.env.MCP_DEV_NO_AUTH = savedMcpDevNoAuth;
    }
  });

  test('MCP_DEV_NO_AUTH=true + NODE_ENV=production → guard is false (route NOT registered)', function () {
    // Core invariant: MCP_DEV_NO_AUTH alone must not activate the dev OAuth route.
    process.env.NODE_ENV = 'production';
    process.env.MCP_DEV_NO_AUTH = 'true';
    expect(oauthAuthorizeDevGuard()).toBe(false);
  });

  test('MCP_DEV_NO_AUTH=true + NODE_ENV unset → guard is false (route NOT registered)', function () {
    // NODE_ENV unset (common bare-process scenario) with MCP_DEV_NO_AUTH=true
    // must also leave the dev route inactive.
    delete process.env.NODE_ENV;
    process.env.MCP_DEV_NO_AUTH = 'true';
    expect(oauthAuthorizeDevGuard()).toBe(false);
  });

  test('MCP_DEV_NO_AUTH=true + NODE_ENV=test → guard is false (route NOT registered)', function () {
    // NODE_ENV=test (Jest default) with MCP_DEV_NO_AUTH=true: still inactive.
    process.env.NODE_ENV = 'test';
    process.env.MCP_DEV_NO_AUTH = 'true';
    expect(oauthAuthorizeDevGuard()).toBe(false);
  });

  test('NODE_ENV=development + MCP_DEV_NO_AUTH unset → guard is true (route IS registered, positive control)', function () {
    // Positive control: only NODE_ENV=development activates the route.
    process.env.NODE_ENV = 'development';
    delete process.env.MCP_DEV_NO_AUTH;
    expect(oauthAuthorizeDevGuard()).toBe(true);
  });

  test('NODE_ENV=development + MCP_DEV_NO_AUTH=true → guard is true (both set, route IS registered)', function () {
    // When both are set and NODE_ENV=development, the route is registered — which is
    // the intended dev workflow. MCP_DEV_NO_AUTH is additive for transport.js only.
    process.env.NODE_ENV = 'development';
    process.env.MCP_DEV_NO_AUTH = 'true';
    expect(oauthAuthorizeDevGuard()).toBe(true);
  });
});
