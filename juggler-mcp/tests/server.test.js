/**
 * juggler-mcp — own-package harness (999.1210)
 *
 * Focused on the server's OWN logic: transport/routing/auth glue.
 *   - tool registration (the 20-tool external contract ClimbRS consumes)
 *   - auth glue: getToken (env var → ~/.juggler-mcp-token file → unauthenticated)
 *   - HTTP glue: apiCall method/URL/headers/body + non-OK error surface
 *   - representative endpoint routing per tool family
 *
 * No DB, no network: the MCP SDK subpaths and global.fetch are mocked.
 * (Deeper behavioral coverage lives in juggler-backend/tests/unit/
 * mcp-server.test.js + mcp-protocol.test.js, which exercise this same module
 * from the consuming side.)
 */

'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

// ── SDK mocks ─────────────────────────────────────────────────────────────────
// index.js requires the mcp.js and stdio.js subpaths explicitly; resolution is
// package-local here, so plain jest.mock intercepts both.

var mockToolRegistry = {};

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', function () {
  return {
    McpServer: jest.fn(function () {
      return {
        tool: function (name, description, schema, handler) {
          mockToolRegistry[name] = {
            name: name, description: description, schema: schema, handler: handler
          };
        },
        connect: function () { return Promise.resolve(); }
      };
    })
  };
});

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', function () {
  return { StdioServerTransport: jest.fn(function () { return {}; }) };
});

// ── Environment (must be set BEFORE the module is required) ──────────────────

var API_URL = 'http://backend.test:5002';
process.env.JUGGLER_API_URL = API_URL;      // read once at module load
process.env.JUGGLER_TOKEN = 'env-token-abc'; // silences the load-time warning

// index.js registers all tools and calls main() at module top level; with the
// SDK mocked, connect resolves against the fake transport.
require('../index');

// ── Helpers ───────────────────────────────────────────────────────────────────

var ORIGINAL_HOME = process.env.HOME;

function handler(name) {
  if (!mockToolRegistry[name]) throw new Error('tool not registered: ' + name);
  return mockToolRegistry[name].handler;
}

function fetchOk(payload, status) {
  return Promise.resolve({
    ok: status === undefined || (status >= 200 && status < 300),
    status: status || 200,
    text: function () { return Promise.resolve(JSON.stringify(payload)); }
  });
}

function fetchFail(status, bodyText) {
  return Promise.resolve({
    ok: false,
    status: status,
    text: function () { return Promise.resolve(bodyText); }
  });
}

function parsed(result) {
  return JSON.parse(result.content[0].text);
}

beforeEach(function () {
  global.fetch = jest.fn(function () { return fetchOk({}); });
  process.env.JUGGLER_TOKEN = 'env-token-abc';
  process.env.HOME = ORIGINAL_HOME;
});

afterAll(function () {
  process.env.HOME = ORIGINAL_HOME;
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Tool registration — the external MCP contract
// ═════════════════════════════════════════════════════════════════════════════

describe('tool registration', function () {

  var EXPECTED_TOOLS = [
    'list_tasks', 'create_task', 'create_tasks', 'update_task',
    'set_task_status', 'delete_task', 'get_schedule', 'run_schedule',
    'get_config', 'list_projects', 'get_task', 'search_tasks',
    'batch_update_tasks', 'create_project', 'update_project', 'delete_project',
    'update_config', 'export_data', 'get_calendar_status', 'sync_calendar'
  ];

  test('all 20 expected tools are registered, and nothing else', function () {
    var names = Object.keys(mockToolRegistry);
    expect(names.sort()).toEqual(EXPECTED_TOOLS.slice().sort());
    expect(names.length).toBe(20);
  });

  test('every tool has a non-empty description and a function handler', function () {
    EXPECTED_TOOLS.forEach(function (name) {
      var entry = mockToolRegistry[name];
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.handler).toBe('function');
    });
  });

  test('999.1417: create_task deadline description documents the create-time past-deadline rejection', function () {
    var desc = mockToolRegistry.create_task.schema.deadline.description;
    expect(desc).toMatch(/must not already be in the past/i);
    expect(desc).toMatch(/Deadline must not be in the past/);
    expect(desc).toMatch(/today is accepted/i);
  });

  test('999.1417: create_tasks batch item deadline description documents the rejection too', function () {
    var itemShape = mockToolRegistry.create_tasks.schema.tasks.element.shape;
    expect(itemShape.deadline.description).toMatch(/must not already be in the past/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Auth glue — getToken resolution order + unauthenticated surface
// ═════════════════════════════════════════════════════════════════════════════

describe('auth glue', function () {

  test('no env token and no token file → handler rejects with AUTH_INSTRUCTIONS, no HTTP call', async function () {
    delete process.env.JUGGLER_TOKEN;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jmcp-nohome-'));
    await expect(handler('get_config')({})).rejects.toThrow(/not authenticated/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('JUGGLER_TOKEN env var is sent as the Bearer token', async function () {
    process.env.JUGGLER_TOKEN = 'env-token-abc';
    await handler('get_config')({});
    var opts = global.fetch.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe('Bearer env-token-abc');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('~/.juggler-mcp-token file is the fallback when the env var is unset', async function () {
    delete process.env.JUGGLER_TOKEN;
    var home = fs.mkdtempSync(path.join(os.tmpdir(), 'jmcp-home-'));
    fs.writeFileSync(path.join(home, '.juggler-mcp-token'), 'file-token-xyz\n');
    process.env.HOME = home;
    await handler('get_config')({});
    var opts = global.fetch.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe('Bearer file-token-xyz'); // trimmed
  });

  test('env var takes precedence over the token file', async function () {
    var home = fs.mkdtempSync(path.join(os.tmpdir(), 'jmcp-home2-'));
    fs.writeFileSync(path.join(home, '.juggler-mcp-token'), 'file-token-xyz\n');
    process.env.HOME = home;
    process.env.JUGGLER_TOKEN = 'env-wins';
    await handler('get_config')({});
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer env-wins');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HTTP glue — apiCall URL/method/body + error surface
// ═════════════════════════════════════════════════════════════════════════════

describe('HTTP glue (apiCall)', function () {

  test('GET request goes to JUGGLER_API_URL + endpoint with no body', async function () {
    await handler('get_config')({});
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe(API_URL + '/api/config');
    expect(call[1].method).toBe('GET');
    expect(call[1].body).toBeUndefined();
  });

  test('POST request serializes the body as JSON', async function () {
    global.fetch.mockImplementation(function () { return fetchOk({ task: { id: 't1' } }); });
    await handler('create_task')({ id: 'explicit-1', text: 'hello' });
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe(API_URL + '/api/tasks');
    expect(call[1].method).toBe('POST');
    var body = JSON.parse(call[1].body);
    expect(body).toEqual({ id: 'explicit-1', text: 'hello' });
  });

  test('non-OK response → handler rejects with "API <status>: <text>"', async function () {
    global.fetch.mockImplementation(function () { return fetchFail(500, 'boom'); });
    await expect(handler('get_config')({})).rejects.toThrow('API 500: boom');
  });

  test('response text is JSON-parsed and returned to the tool', async function () {
    global.fetch.mockImplementation(function () { return fetchOk({ userTimezone: 'Asia/Tokyo' }); });
    var result = await handler('get_config')({});
    expect(parsed(result)).toEqual({ userTimezone: 'Asia/Tokyo' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Routing — representative endpoint per tool family
// ═════════════════════════════════════════════════════════════════════════════

describe('endpoint routing', function () {

  test('list_tasks GETs /api/tasks (with query string) and filters client-side', async function () {
    global.fetch.mockImplementation(function () {
      return fetchOk({ tasks: [
        { id: 'a', status: '', project: 'p1' },
        { id: 'b', status: 'done', project: 'p1' },
        { id: 'c', status: 'done', project: 'p2' }
      ] });
    });
    var result = await handler('list_tasks')({ status: 'done', limit: 1 });
    expect(global.fetch.mock.calls[0][0]).toBe(API_URL + '/api/tasks?status=done&limit=1');
    var tasks = parsed(result);
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe('b');
  });

  test('create_task auto-generates a uuid id when none is passed', async function () {
    global.fetch.mockImplementation(function () { return fetchOk({ task: { id: 'ignored' } }); });
    await handler('create_task')({ text: 'no id' });
    var body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(typeof body.id).toBe('string');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('create_tasks POSTs /api/tasks/batch with per-item generated ids', async function () {
    global.fetch.mockImplementation(function () { return fetchOk({ created: 2 }); });
    await handler('create_tasks')({ tasks: [{ text: 'one' }, { id: 'keep-me', text: 'two' }] });
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe(API_URL + '/api/tasks/batch');
    var body = JSON.parse(call[1].body);
    expect(body.tasks[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.tasks[1].id).toBe('keep-me');
  });

  test('update_task PUTs /api/tasks/:id with the id excluded from the body', async function () {
    global.fetch.mockImplementation(function () { return fetchOk({ task: { id: 't9' } }); });
    await handler('update_task')({ id: 't9', text: 'renamed' });
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe(API_URL + '/api/tasks/t9');
    expect(call[1].method).toBe('PUT');
    expect(JSON.parse(call[1].body)).toEqual({ text: 'renamed' });
  });

  test('set_task_status PUTs /api/tasks/:id/status', async function () {
    global.fetch.mockImplementation(function () { return fetchOk({ task: { id: 't9' } }); });
    await handler('set_task_status')({ id: 't9', status: 'done', direction: 'fwd' });
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe(API_URL + '/api/tasks/t9/status');
    expect(JSON.parse(call[1].body)).toEqual({ status: 'done', direction: 'fwd' });
  });

  test('delete_task DELETEs /api/tasks/:id', async function () {
    await handler('delete_task')({ id: 't9' });
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe(API_URL + '/api/tasks/t9');
    expect(call[1].method).toBe('DELETE');
  });

  test('update_config PUTs /api/config/:key with { value }', async function () {
    await handler('update_config')({ key: 'time_blocks', value: [{ from: 9 }] });
    var call = global.fetch.mock.calls[0];
    expect(call[0]).toBe(API_URL + '/api/config/time_blocks');
    expect(call[1].method).toBe('PUT');
    expect(JSON.parse(call[1].body)).toEqual({ value: [{ from: 9 }] });
  });

  test('get_task filters GET /api/tasks by id; missing id → isError', async function () {
    global.fetch.mockImplementation(function () {
      return fetchOk({ tasks: [{ id: 'present', text: 'here' }] });
    });
    var found = await handler('get_task')({ id: 'present' });
    expect(found.isError).toBeFalsy();
    expect(parsed(found).id).toBe('present');

    var missing = await handler('get_task')({ id: 'ghost' });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/not found/i);
  });

  test('get_calendar_status aggregates gcal + msft and degrades per-provider on failure', async function () {
    global.fetch.mockImplementation(function (url) {
      if (url.indexOf('/api/gcal/status') >= 0) return fetchOk({ connected: true });
      return fetchFail(502, 'msft down');
    });
    var result = await handler('get_calendar_status')({});
    var payload = parsed(result);
    expect(payload.googleCalendar).toEqual({ connected: true });
    expect(payload.microsoftCalendar.error).toMatch(/API 502: msft down/);
  });

  test('get_schedule derives placements from scheduledAt in the user timezone', async function () {
    global.fetch.mockImplementation(function (url) {
      if (url.indexOf('/api/config') >= 0) return fetchOk({ userTimezone: 'America/New_York' });
      return fetchOk({ tasks: [
        // 00:30Z on Mar 10 = 20:30 Mar 9 in New York (EDT, UTC-4 — US DST began Mar 8 2026)
        { id: 'sched', scheduledAt: '2026-03-10T00:30:00.000Z', dur: 30 },
        { id: 'loose', unscheduled: true }
      ] });
    });
    var payload = parsed(await handler('get_schedule')({}));
    expect(Object.keys(payload.dayPlacements)).toEqual(['2026-03-09']);
    var entry = payload.dayPlacements['2026-03-09'][0];
    expect(entry.start).toBe(20 * 60 + 30);
    expect(entry.end).toBe(20 * 60 + 60);
    expect(payload.unplaced.length).toBe(1);
    expect(payload.unplaced[0].id).toBe('loose');
  });
});
