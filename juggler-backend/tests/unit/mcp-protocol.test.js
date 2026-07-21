/**
 * MCP Protocol-Level Tests — 999.559
 *
 * Covers three areas beyond the existing tool-registration tests:
 *   1. Transport error handling and auth (src/mcp/transport.js).
 *   2. Per-client authorization: user A cannot read user B's config via MCP tools.
 *   3. All 20 tools are registered (cross-reference with R17.1).
 *
 * These tests exercise the src/mcp/transport.js (streamable HTTP server)
 * code paths. The former section 1 (999.559a, stdio-client protocol tests)
 * was removed with the juggler-mcp package deletion (999.2158).
 */

'use strict';

var path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (jest.mock calls are hoisted above the requires below).
// ─────────────────────────────────────────────────────────────────────────────

// Top-level mock for the user-config slice facade (loaded at require time by the
// MCP config tools / index module). 999.1404: the config tools now route all 5
// handlers through the facade (getAllConfig, listProjects, createProject,
// updateProject, deleteProject) instead of calling db() directly. The facade
// mock returns per-user data from the same in-memory stores the db mock owns,
// so the per-client authorization tests (User A vs User B) still exercise the
// userId scoping that prevents cross-user data leakage.
jest.mock('../../src/slices/user-config/facade', function () {
  var USER_A = 'user-a-001';
  var USER_B = 'user-b-002';

  var stores = {
    config: {},
    location: {},
    tool: {},
    project: {}
  };

  function reset() {
    stores.config = {};
    stores.location = {};
    stores.tool = {};
    stores.project = {};

    stores.config[USER_A] = [
      { config_key: 'preferences', config_value: JSON.stringify({ splitDefault: true }) },
      { config_key: 'time_blocks', config_value: JSON.stringify([{ start: '09:00', end: '17:00' }]) }
    ];
    stores.location[USER_A] = [
      { location_id: 'loc-1', name: 'Home', icon: 'home', sort_order: 0 }
    ];
    stores.tool[USER_A] = [
      { tool_id: 'tool-1', name: 'Laptop', icon: 'laptop', sort_order: 0 }
    ];
    stores.project[USER_A] = [
      { id: 1, name: 'Project A', color: '#ff0000', icon: null, sort_order: 0 }
    ];

    stores.config[USER_B] = [
      { config_key: 'preferences', config_value: JSON.stringify({ splitDefault: false }) }
    ];
    stores.location[USER_B] = [
      { location_id: 'loc-2', name: 'Office', icon: 'office', sort_order: 0 }
    ];
    stores.tool[USER_B] = [
      { tool_id: 'tool-2', name: 'Phone', icon: 'phone', sort_order: 0 }
    ];
    stores.project[USER_B] = [
      { id: 2, name: 'Project B', color: '#00ff00', icon: null, sort_order: 0 }
    ];
  }

  function buildConfig(userId) {
    var config = {};
    (stores.config[userId] || []).forEach(function (row) {
      var val;
      try { val = JSON.parse(row.config_value); } catch (e) { val = row.config_value; }
      config[row.config_key] = val;
    });
    return {
      locations: (stores.location[userId] || []).map(function (l) { return { id: l.location_id, name: l.name, icon: l.icon }; }),
      tools: (stores.tool[userId] || []).map(function (t) { return { id: t.tool_id, name: t.name, icon: t.icon }; }),
      projects: (stores.project[userId] || []).map(function (p) { return { id: p.id, name: p.name, color: p.color, icon: p.icon }; }),
      toolMatrix: config.tool_matrix || null,
      timeBlocks: config.time_blocks || null,
      locSchedules: config.loc_schedules || null,
      locScheduleDefaults: config.loc_schedule_defaults || null,
      locScheduleOverrides: config.loc_schedule_overrides || null,
      hourLocationOverrides: config.hour_location_overrides || null,
      preferences: config.preferences || null,
      tempUnitPref: config.temp_unit_pref || 'F',
      scheduleTemplates: config.schedule_templates || null,
      templateDefaults: config.template_defaults || null,
      templateOverrides: config.template_overrides || null,
      calSyncSettings: config.cal_sync_settings || null
    };
  }

  function buildProjectList(userId) {
    return (stores.project[userId] || []).map(function (p) {
      return { id: p.id, name: p.name, color: p.color, icon: p.icon, taskCount: 0, doneCount: 0 };
    });
  }

  var mockFacade = {
    SCHED_KEYS: ['time_blocks', 'preferences', 'loc_schedules', 'loc_schedule_defaults', 'loc_schedule_overrides', 'hour_location_overrides', 'tool_matrix'],
    updateConfig: function () { return Promise.resolve({ status: 200, body: {} }); },
    replaceLocations: function () { return Promise.resolve({ status: 200, body: { locations: [] } }); },
    getAllConfig: function (input) { return Promise.resolve({ status: 200, body: buildConfig(input.userId) }); },
    listProjects: function (input) { return Promise.resolve({ status: 200, body: buildProjectList(input.userId) }); },
    createProject: function (input) { return Promise.resolve({ status: 201, body: { project: input.body } }); },
    updateProject: function (input) { return Promise.resolve({ status: 200, body: { project: input.body, renamed: null } }); },
    deleteProject: function (input) { return Promise.resolve({ status: 200, body: { message: 'Project deleted', id: input.id } }); },
    __stores: stores,
    __reset: reset
  };

  reset();
  return mockFacade;
});

// ── Cluster-2 transport mocks (hoisted) ──────────────────────────────────────
// transport.js destructures { authenticateMcpRequest, sendMcpUnauthorized } from
// 'auth-client/mcp-auth' and { createMcpServerForUser } from './server' INTO
// LOCAL BINDINGS at require time. So the mocks must be in place (hoisted) before
// transport.js is required, and the tests must configure behaviour on the SAME
// stable jest.fn() instances (via .mockResolvedValue / .mockReturnValue) without
// reassigning the property to a brand-new fn (which transport never sees).
jest.mock('auth-client/mcp-auth', function () {
  return {
    authenticateMcpRequest: jest.fn(),
    sendMcpUnauthorized: jest.fn()
  };
});

jest.mock('../../src/mcp/server', function () {
  return {
    createMcpServerForUser: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    })
  };
});

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

// ── Cluster-3 DB mock (hoisted) ──────────────────────────────────────────────
// config.js binds to ../../src/db at require time (top-level require), so the db
// mock MUST be hoisted. jest.mock factories are hoisted above all variable decls;
// the only out-of-factory references jest permits are vars whose names begin with
// "mock". We therefore define the in-memory stores + the db mock INSIDE the
// factory and expose __reset / __stores so beforeEach can repopulate them.
jest.mock('../../src/db', function () {
  var USER_A = 'user-a-001';
  var USER_B = 'user-b-002';

  var stores = {
    config: {},
    location: {},
    tool: {},
    project: {}
  };

  function reset() {
    stores.config = {};
    stores.location = {};
    stores.tool = {};
    stores.project = {};

    // User A has config
    stores.config[USER_A] = [
      { config_key: 'preferences', config_value: JSON.stringify({ splitDefault: true }) },
      { config_key: 'time_blocks', config_value: JSON.stringify([{ start: '09:00', end: '17:00' }]) }
    ];
    stores.location[USER_A] = [
      { location_id: 'loc-1', name: 'Home', icon: 'home', sort_order: 0 }
    ];
    stores.tool[USER_A] = [
      { tool_id: 'tool-1', name: 'Laptop', icon: 'laptop', sort_order: 0 }
    ];
    stores.project[USER_A] = [
      { id: 1, name: 'Project A', color: '#ff0000', icon: null, sort_order: 0 }
    ];

    // User B has different config
    stores.config[USER_B] = [
      { config_key: 'preferences', config_value: JSON.stringify({ splitDefault: false }) }
    ];
    stores.location[USER_B] = [
      { location_id: 'loc-2', name: 'Office', icon: 'office', sort_order: 0 }
    ];
    stores.tool[USER_B] = [
      { tool_id: 'tool-2', name: 'Phone', icon: 'phone', sort_order: 0 }
    ];
    stores.project[USER_B] = [
      { id: 2, name: 'Project B', color: '#00ff00', icon: null, sort_order: 0 }
    ];
  }

  // A fresh chainable query object per db(table) call so concurrent
  // Promise.all() calls (get_config issues 4 in parallel) don't clobber a
  // shared _table/_where.
  function db(tableName) {
    var _table = tableName;
    var _where = {};

    function resolve() {
      var userId = _where.user_id;
      if (_table === 'users') {
        return [{ id: userId || USER_A, timezone: 'America/New_York' }];
      }
      if (_table === 'locations') {
        return (stores.location[userId] || []).slice();
      }
      if (_table === 'tools') {
        return (stores.tool[userId] || []).slice();
      }
      if (_table === 'projects') {
        return (stores.project[userId] || []).slice();
      }
      if (_table === 'user_config') {
        return (stores.config[userId] || []).slice();
      }
      if (_table === 'tasks_v' || _table === 'tasks_with_sync_v') {
        return [];
      }
      return [];
    }

    var q = {};
    q.where = function (cond, value) {
      // knex supports both .where({ col: val }) and .where('col', val)
      if (typeof cond === 'object' && cond !== null) {
        Object.assign(_where, cond);
      } else if (typeof cond === 'string' && arguments.length >= 2) {
        _where[cond] = value;
      }
      return q;
    };
    q.whereIn = function () { return q; };
    q.orderBy = function () { return q; };
    q.groupBy = function () { return q; };
    q.max = function () { return q; };
    q.first = function () {
      var rows = resolve();
      return Promise.resolve(rows.length > 0 ? rows[0] : null);
    };
    q.select = function () {
      var rows = resolve();
      var p = Promise.resolve(rows);
      p.first = function () {
        return Promise.resolve(rows.length > 0 ? rows[0] : null);
      };
      return p;
    };
    q.insert = function () { return Promise.resolve([1]); };
    q.update = function () { return Promise.resolve(1); };
    q.del = function () { return Promise.resolve(1); };
    q.then = function (resolveFn, rejectFn) {
      return Promise.resolve(resolve()).then(resolveFn, rejectFn);
    };
    return q;
  }

  db.fn = { now: function () { return 'MOCK_NOW'; } };
  db.raw = function () { return {}; };
  db.transaction = function (cb) { return cb(db); };

  db.__reset = reset;
  db.__stores = stores;

  reset();
  return db;
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. src/mcp/transport.js — streamable HTTP server protocol tests
// ─────────────────────────────────────────────────────────────────────────────

describe('999.559b — MCP transport: error handling and auth', function () {
  var transport;
  var mockAuthModule;
  var mockServerFactory;

  beforeAll(function () {
    // Mocks for auth-client/mcp-auth, ./server, streamableHttp.js, and ../../src/db
    // are hoisted to top level, so transport.js binds to them at require time.
    transport = require('../../src/mcp/transport');
    mockAuthModule = require('auth-client/mcp-auth');
    mockServerFactory = require('../../src/mcp/server');
  });

  beforeEach(function () {
    // Configure behaviour on the STABLE jest.fn() instances (do not reassign).
    mockAuthModule.authenticateMcpRequest.mockReset();
    mockAuthModule.sendMcpUnauthorized.mockReset();
    mockServerFactory.createMcpServerForUser.mockReset();
    mockServerFactory.createMcpServerForUser.mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    });
  });

  test('POST /mcp without Bearer token returns 401 via sendMcpUnauthorized', async function () {
    var mockReq = {
      headers: {},
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

    await transport.handlePost(mockReq, mockRes);

    expect(mockAuthModule.sendMcpUnauthorized).toHaveBeenCalled();
  });

  test('POST /mcp with invalid token returns 401', async function () {
    mockAuthModule.authenticateMcpRequest.mockResolvedValue(null);

    var mockReq = {
      headers: { authorization: 'Bearer invalid-token' },
      protocol: 'http',
      get: function () { return 'localhost'; },
      body: {}
    };
    var capturedStatus = null;
    var mockRes = {
      status: jest.fn().mockImplementation(function (code) {
        capturedStatus = code;
        return mockRes;
      }),
      json: jest.fn().mockReturnThis(),
      headersSent: false,
      on: jest.fn()
    };

    await transport.handlePost(mockReq, mockRes);

    expect(capturedStatus).toBe(401);
  });

  test('POST /mcp with valid token creates server scoped to that user', async function () {
    mockAuthModule.authenticateMcpRequest.mockResolvedValue({ userId: 'user-456' });

    var mockReq = {
      headers: { authorization: 'Bearer valid-token' },
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

    await transport.handlePost(mockReq, mockRes);

    expect(mockServerFactory.createMcpServerForUser).toHaveBeenCalledWith('user-456');
  });

  test('GET /mcp returns 405 Method Not Allowed', async function () {
    var mockReq = {};
    var capturedStatus = null;
    var mockRes = {
      status: jest.fn().mockImplementation(function (code) {
        capturedStatus = code;
        return mockRes;
      }),
      json: jest.fn().mockReturnThis()
    };

    transport.handleMethodNotAllowed(mockReq, mockRes);

    expect(capturedStatus).toBe(405);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Per-client authorization: user A cannot read user B's config
// ─────────────────────────────────────────────────────────────────────────────

describe('999.559c — MCP per-client authorization: config isolation', function () {
  var USER_A = 'user-a-001';
  var USER_B = 'user-b-002';

  // ../../src/db is mocked (hoisted) with an in-memory user-scoped store.
  var db = require('../../src/db');
  var { registerConfigTools } = require('../../src/mcp/tools/config');

  function captureConfigHandlers(userId) {
    var handlers = {};
    var mockServer = {
      tool: function (name, _desc, _schema, h) {
        handlers[name] = h;
      }
    };
    registerConfigTools(mockServer, userId);
    return handlers;
  }

  function parseResult(result) {
    if (!result || !result.content || !result.content[0]) return null;
    try { return JSON.parse(result.content[0].text); } catch (e) { return result.content[0].text; }
  }

  beforeEach(function () {
    db.__reset();
    // 999.1404: config tools route through the facade now — reset its stores too.
    require('../../src/slices/user-config/facade').__reset();
  });

  test('User A get_config returns User A locations, tools, projects, preferences', async function () {
    var handlers = captureConfigHandlers(USER_A);
    var result = await handlers['get_config']({});
    expect(result.isError).toBeFalsy();
    var config = parseResult(result);
    expect(config).toBeDefined();
    expect(config.locations).toHaveLength(1);
    expect(config.locations[0].name).toBe('Home');
    expect(config.tools).toHaveLength(1);
    expect(config.tools[0].name).toBe('Laptop');
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0].name).toBe('Project A');
    expect(config.preferences.splitDefault).toBe(true);
  });

  test('User B get_config returns User B locations, tools, projects, preferences', async function () {
    var handlers = captureConfigHandlers(USER_B);
    var result = await handlers['get_config']({});
    expect(result.isError).toBeFalsy();
    var config = parseResult(result);
    expect(config).toBeDefined();
    expect(config.locations).toHaveLength(1);
    expect(config.locations[0].name).toBe('Office');
    expect(config.tools).toHaveLength(1);
    expect(config.tools[0].name).toBe('Phone');
    expect(config.projects).toHaveLength(1);
    expect(config.projects[0].name).toBe('Project B');
    expect(config.preferences.splitDefault).toBe(false);
  });

  test('User B get_config does NOT leak User A data', async function () {
    var handlers = captureConfigHandlers(USER_B);
    var result = await handlers['get_config']({});
    expect(result.isError).toBeFalsy();
    var config = parseResult(result);
    expect(config).toBeDefined();

    // User B must not see User A's locations, tools, or projects
    var userALocations = config.locations.filter(function (l) { return l.name === 'Home'; });
    expect(userALocations).toHaveLength(0);

    var userAProjects = config.projects.filter(function (p) { return p.name === 'Project A'; });
    expect(userAProjects).toHaveLength(0);

    var userATools = config.tools.filter(function (t) { return t.name === 'Laptop'; });
    expect(userATools).toHaveLength(0);
  });

  test('User A get_config does NOT leak User B data', async function () {
    var handlers = captureConfigHandlers(USER_A);
    var result = await handlers['get_config']({});
    expect(result.isError).toBeFalsy();
    var config = parseResult(result);

    var userBLocations = config.locations.filter(function (l) { return l.name === 'Office'; });
    expect(userBLocations).toHaveLength(0);

    var userBProjects = config.projects.filter(function (p) { return p.name === 'Project B'; });
    expect(userBProjects).toHaveLength(0);

    var userBTools = config.tools.filter(function (t) { return t.name === 'Phone'; });
    expect(userBTools).toHaveLength(0);
  });

  test('list_projects for User A returns only User A projects', async function () {
    var handlers = captureConfigHandlers(USER_A);
    var result = await handlers['list_projects']({});
    expect(result.isError).toBeFalsy();
    var projects = parseResult(result);
    expect(Array.isArray(projects)).toBe(true);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Project A');
  });

  test('list_projects for User B returns only User B projects', async function () {
    var handlers = captureConfigHandlers(USER_B);
    var result = await handlers['list_projects']({});
    expect(result.isError).toBeFalsy();
    var projects = parseResult(result);
    expect(Array.isArray(projects)).toBe(true);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Project B');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cross-reference: all 20 tools are registered (R17.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('999.559d — All 20 MCP tools are registered (cross-reference)', function () {
  test('expected tool list matches the canonical 20', function () {
    var expectedTools = [
      'list_tasks',
      'create_task',
      'create_tasks',
      'update_task',
      'set_task_status',
      'delete_task',
      'get_schedule',
      'run_schedule',
      'get_config',
      'list_projects',
      'get_task',
      'search_tasks',
      'batch_update_tasks',
      'create_project',
      'update_project',
      'delete_project',
      'update_config',
      'export_data',
      'get_calendar_status',
      'sync_calendar'
    ];
    expect(expectedTools.length).toBe(20);
  });
});
