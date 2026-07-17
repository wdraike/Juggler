/**
 * Characterization tests — mcp/tools/config.js facade routing (999.1404).
 *
 * The 5 MCP config tools (get_config, list_projects, create_project,
 * update_project, delete_project) must route through the user-config slice
 * facade instead of calling db() directly. This test pins the post-refactor
 * contract: the handler delegates to the facade, NOT to raw db().
 *
 * Equivalence:
 *   [Handler leg]  E-1..E-5: handler delegates correctly to the facade.
 *   [Facade leg]   the facade's own tests (configUseCases.test.js) prove the
 *                  use-cases perform the persistence.
 *
 * E-1  get_config: handler calls facade.getAllConfig once, returns body.
 * E-2  list_projects: handler calls facade.listProjects once with {userId, name?}.
 * E-3  create_project: handler calls facade.createProject once with {userId, body}.
 * E-4  update_project: handler calls facade.updateProject once with {userId, id, body}.
 * E-5  delete_project: handler calls facade.deleteProject once with {userId, id}.
 * E-6  NO handler calls db() directly (duplication removed — the 11 db() sites gone).
 */

'use strict';

var path = require('path');

var CONFIG_TOOLS_PATH = path.join(__dirname, '..', 'src', 'mcp', 'tools', 'config');
var DB_PATH           = path.join(__dirname, '..', 'src', 'db');
var FACADE_PATH       = path.join(__dirname, '..', 'src', 'slices', 'user-config', 'facade');
var TASKS_WRITE_PATH  = path.join(__dirname, '..', 'src', 'lib', 'tasks-write');
var SCHED_QUEUE_PATH  = path.join(__dirname, '..', 'src', 'scheduler', 'scheduleQueue');

var TEST_USER = 'facade-routing-test-user-42';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Run a named MCP config tool handler in an isolated module registry.
 * The facade is mocked so we control return values and capture call args.
 * The db is spied to assert E-6 (no direct db calls).
 *
 * Variables prefixed with `mock` are visible inside jest.mock() factories
 * (Jest's allowlist for out-of-scope references).
 */
async function runToolInIsolation(toolName, opts) {
  var mockFacadeResult = opts.facadeResult || {};
  var mockHandlerArgs  = opts.handlerArgs || {};
  var mockState = {
    facadeCalls: [],
    dbCalls: [],
    mcpResult: null,
  };

  await jest.isolateModulesAsync(async function () {
    // ── facade mock ──
    jest.mock(FACADE_PATH, function () {
      var realUpdateConfig = require('../src/slices/user-config/application/commands/UpdateConfig');
      var mockFacade = {
        SCHED_KEYS: realUpdateConfig.SCHED_KEYS,
        updateConfig: jest.fn(function (i) { return Promise.resolve({ status: 200, body: { key: i.key, value: i.value } }); }),
        getAllConfig: jest.fn(function (i) { mockState.facadeCalls.push({ method: 'getAllConfig', input: i }); return Promise.resolve(mockFacadeResult.getAllConfig || { status: 200, body: {} }); }),
        listProjects: jest.fn(function (i) { mockState.facadeCalls.push({ method: 'listProjects', input: i }); return Promise.resolve(mockFacadeResult.listProjects || { status: 200, body: [] }); }),
        createProject: jest.fn(function (i) { mockState.facadeCalls.push({ method: 'createProject', input: i }); return Promise.resolve(mockFacadeResult.createProject || { status: 201, body: { project: { id: 1 } } }); }),
        updateProject: jest.fn(function (i) { mockState.facadeCalls.push({ method: 'updateProject', input: i }); return Promise.resolve(mockFacadeResult.updateProject || { status: 200, body: {} }); }),
        deleteProject: jest.fn(function (i) { mockState.facadeCalls.push({ method: 'deleteProject', input: i }); return Promise.resolve(mockFacadeResult.deleteProject || { status: 200, body: {} }); }),
      };
      return mockFacade;
    });

    // ── db spy (E-6: must NOT be called) ──
    jest.mock(DB_PATH, function () {
      function makeTableProxy(tbl) {
        mockState.dbCalls.push({ table: tbl });
        var proxy = {
          where: function () { return this; },
          whereIn: function () { return this; },
          whereNot: function () { return this; },
          orderBy: function () { return this; },
          groupBy: function () { return this; },
          select: function () { return Promise.resolve([]); },
          first: function () { return Promise.resolve(null); },
          max: function () { return { first: function () { return Promise.resolve({ max: 0 }); } }; },
          insert: function () { return Promise.resolve([1]); },
          update: function () { return Promise.resolve(1); },
          del: function () { return Promise.resolve(1); },
        };
        return proxy;
      }
      var mockDb = function (tbl) { return makeTableProxy(tbl); };
      mockDb.fn = { now: function () { return 'MOCK_NOW'; } };
      mockDb.raw = function () { return 'RAW'; };
      mockDb.transaction = function (cb) { return cb(mockDb); };
      return mockDb;
    });

    jest.mock(TASKS_WRITE_PATH, function () {
      return { updateTasksWhere: function () { return Promise.resolve(); } };
    });
    jest.mock(SCHED_QUEUE_PATH, function () {
      return { enqueueScheduleRun: jest.fn(function () { return Promise.resolve(); }) };
    });

    var mockTools = {};
    var mockServer = {
      tool: function (name, _desc, _schema, handler) {
        mockTools[name] = handler;
      }
    };
    require(CONFIG_TOOLS_PATH).registerConfigTools(mockServer, TEST_USER);

    if (mockTools[toolName]) {
      mockState.mcpResult = await mockTools[toolName](mockHandlerArgs);
    }
  });

  return mockState;
}

// ── E-1: get_config delegates to facade.getAllConfig ─────────────────────────

describe('E-1: get_config delegates to facade.getAllConfig', function () {
  test('E-1a: facade.getAllConfig called exactly once with {userId}', async function () {
    var s = await runToolInIsolation('get_config', {
      facadeResult: { getAllConfig: { status: 200, body: { projects: [], locations: [], tools: [] } } }
    });
    var getAllConfigCalls = s.facadeCalls.filter(function (c) { return c.method === 'getAllConfig'; });
    expect(getAllConfigCalls.length).toBe(1);
    expect(getAllConfigCalls[0].input).toEqual({ userId: TEST_USER });
  });

  test('E-1b: returns the facade body as MCP text content', async function () {
    var body = { projects: [{ id: 1, name: 'P1' }], locations: [], tools: [], tempUnitPref: 'F' };
    var s = await runToolInIsolation('get_config', {
      facadeResult: { getAllConfig: { status: 200, body: body } }
    });
    expect(s.mcpResult.content[0].type).toBe('text');
    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.projects).toEqual([{ id: 1, name: 'P1' }]);
  });
});

// ── E-2: list_projects delegates to facade.listProjects ───────────────────────

describe('E-2: list_projects delegates to facade.listProjects', function () {
  test('E-2a: facade.listProjects called exactly once with {userId}', async function () {
    var s = await runToolInIsolation('list_projects', {
      facadeResult: { listProjects: { status: 200, body: [{ id: 1, name: 'P1', taskCount: 3, doneCount: 1 }] } }
    });
    var listProjectsCalls = s.facadeCalls.filter(function (c) { return c.method === 'listProjects'; });
    expect(listProjectsCalls.length).toBe(1);
    expect(listProjectsCalls[0].input.userId).toBe(TEST_USER);
    expect(listProjectsCalls[0].input.name).toBeUndefined();
  });

  test('E-2b: name filter forwarded to facade', async function () {
    var s = await runToolInIsolation('list_projects', {
      handlerArgs: { name: 'MyProject' },
      facadeResult: { listProjects: { status: 200, body: [] } }
    });
    var listProjectsCalls = s.facadeCalls.filter(function (c) { return c.method === 'listProjects'; });
    expect(listProjectsCalls.length).toBe(1);
    expect(listProjectsCalls[0].input.name).toBe('MyProject');
  });

  test('E-2c: returns the facade body as MCP text content', async function () {
    var projects = [{ id: 1, name: 'P1', color: '#fff', icon: 'star', taskCount: 5, doneCount: 2 }];
    var s = await runToolInIsolation('list_projects', {
      facadeResult: { listProjects: { status: 200, body: projects } }
    });
    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed).toEqual(projects);
  });
});

// ── E-3: create_project delegates to facade.createProject ────────────────────

describe('E-3: create_project delegates to facade.createProject', function () {
  test('E-3a: facade.createProject called once with {userId, body}', async function () {
    var s = await runToolInIsolation('create_project', {
      handlerArgs: { name: 'NewProj', color: '#4A90D9', icon: 'briefcase' },
      facadeResult: { createProject: { status: 201, body: { project: { id: 42, name: 'NewProj', color: '#4A90D9', icon: 'briefcase' } } } }
    });
    var createCalls = s.facadeCalls.filter(function (c) { return c.method === 'createProject'; });
    expect(createCalls.length).toBe(1);
    expect(createCalls[0].input.userId).toBe(TEST_USER);
    expect(createCalls[0].input.body.name).toBe('NewProj');
  });

  test('E-3b: returns the facade body project as MCP text', async function () {
    var s = await runToolInIsolation('create_project', {
      handlerArgs: { name: 'Test' },
      facadeResult: { createProject: { status: 201, body: { project: { id: 7, name: 'Test', color: null, icon: null } } } }
    });
    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.id).toBe(7);
    expect(parsed.name).toBe('Test');
  });
});

// ── E-4: update_project delegates to facade.updateProject ─────────────────────

describe('E-4: update_project delegates to facade.updateProject', function () {
  test('E-4a: facade.updateProject called once with {userId, id, body}', async function () {
    var s = await runToolInIsolation('update_project', {
      handlerArgs: { id: 5, name: 'Renamed', color: '#fff' },
      facadeResult: { updateProject: { status: 200, body: { project: { id: 5, name: 'Renamed', color: '#fff', icon: null }, renamed: { from: 'Old', to: 'Renamed' } } } }
    });
    var updateCalls = s.facadeCalls.filter(function (c) { return c.method === 'updateProject'; });
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.userId).toBe(TEST_USER);
    expect(updateCalls[0].input.id).toBe(5);
    expect(updateCalls[0].input.body.name).toBe('Renamed');
  });

  test('E-4b: returns the facade body as MCP text', async function () {
    var s = await runToolInIsolation('update_project', {
      handlerArgs: { id: 3, name: 'New' },
      facadeResult: { updateProject: { status: 200, body: { project: { id: 3, name: 'New', color: null, icon: null }, renamed: { from: 'Old', to: 'New' } } } }
    });
    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.project.name).toBe('New');
    expect(parsed.renamed).toEqual({ from: 'Old', to: 'New' });
  });
});

// ── E-5: delete_project delegates to facade.deleteProject ────────────────────

describe('E-5: delete_project delegates to facade.deleteProject', function () {
  test('E-5a: facade.deleteProject called once with {userId, id}', async function () {
    var s = await runToolInIsolation('delete_project', {
      handlerArgs: { id: 9 },
      facadeResult: { deleteProject: { status: 200, body: { message: 'Project deleted', id: 9 } } }
    });
    var deleteCalls = s.facadeCalls.filter(function (c) { return c.method === 'deleteProject'; });
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0].input.userId).toBe(TEST_USER);
    expect(deleteCalls[0].input.id).toBe(9);
  });

  test('E-5b: returns the facade body as MCP text', async function () {
    var s = await runToolInIsolation('delete_project', {
      handlerArgs: { id: 9 },
      facadeResult: { deleteProject: { status: 200, body: { message: 'Project deleted', id: 9, name: 'Gone' } } }
    });
    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.message).toBe('Project deleted');
  });
});

// ── E-6: no direct db() calls from ANY handler ────────────────────────────────

describe('E-6: raw db() NOT called by any handler (duplication removed)', function () {
  test('E-6a: get_config does not call db()', async function () {
    var s = await runToolInIsolation('get_config', {
      facadeResult: { getAllConfig: { status: 200, body: {} } }
    });
    expect(s.dbCalls.length).toBe(0);
  });

  test('E-6b: list_projects does not call db()', async function () {
    var s = await runToolInIsolation('list_projects', {
      facadeResult: { listProjects: { status: 200, body: [] } }
    });
    expect(s.dbCalls.length).toBe(0);
  });

  test('E-6c: create_project does not call db()', async function () {
    var s = await runToolInIsolation('create_project', {
      handlerArgs: { name: 'X' },
      facadeResult: { createProject: { status: 201, body: { project: { id: 1 } } } }
    });
    expect(s.dbCalls.length).toBe(0);
  });

  test('E-6d: update_project does not call db()', async function () {
    var s = await runToolInIsolation('update_project', {
      handlerArgs: { id: 1, name: 'Y' },
      facadeResult: { updateProject: { status: 200, body: {} } }
    });
    expect(s.dbCalls.length).toBe(0);
  });

  test('E-6e: delete_project does not call db()', async function () {
    var s = await runToolInIsolation('delete_project', {
      handlerArgs: { id: 1 },
      facadeResult: { deleteProject: { status: 200, body: {} } }
    });
    expect(s.dbCalls.length).toBe(0);
  });
});