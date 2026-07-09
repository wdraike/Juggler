/**
 * 999.1397 — MCP server-level error sanitizer (src/mcp/server.js).
 *
 * Tool bodies have no try/catch around facade calls; before this fix an
 * unexpected THROW (deadlock exhaustion, ER_DUP_ENTRY, ...) propagated into the
 * MCP SDK, which serializes the raw error.message to the external ClimbRS
 * client — a potential SQL/schema string leak (elmo security review,
 * 2026-07-07). createMcpServerForUser now wraps every registered tool handler:
 * unexpected throws are logged server-side and the client sees only the
 * generic 'Error: Internal server error'.
 *
 * Pure unit test — the SDK, tool modules, and logger are all mocked; no DB.
 */

'use strict';

var mockLoggedErrors = [];

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', function () {
  return {
    McpServer: class {
      constructor() { this.registeredTools = {}; }
      tool(name, _desc, _schema, handler) { this.registeredTools[name] = handler; }
    }
  };
});

jest.mock('@raike/lib-logger', function () {
  return {
    createLogger: function () {
      return {
        error: function () { mockLoggedErrors.push(Array.prototype.slice.call(arguments)); },
        warn: function () {},
        info: function () {},
        debug: function () {}
      };
    }
  };
});

jest.mock('../src/mcp/tools/tasks', function () {
  return {
    registerTaskTools: function (server) {
      server.tool('boom_tool', 'throws unexpectedly', {}, async function () {
        var err = new Error("ER_DUP_ENTRY: Duplicate entry 'abc-123' for key 'task_masters.PRIMARY'");
        err.code = 'ER_DUP_ENTRY';
        throw err;
      });
      server.tool('ok_tool', 'succeeds', {}, async function () {
        return { content: [{ type: 'text', text: '{"id":"t1"}' }] };
      });
      server.tool('expected_error_tool', 'returns a mapped isError result', {}, async function () {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      });
    }
  };
});
jest.mock('../src/mcp/tools/schedule', function () {
  return { registerScheduleTools: function () {} };
});
jest.mock('../src/mcp/tools/config', function () {
  return { registerConfigTools: function () {} };
});
jest.mock('../src/mcp/tools/data', function () {
  return { registerDataTools: function () {} };
});

var { createMcpServerForUser } = require('../src/mcp/server');

describe('MCP server-level error sanitizer (999.1397)', function () {
  var server;

  beforeEach(function () {
    mockLoggedErrors = [];
    server = createMcpServerForUser('user-001');
  });

  test('unexpected throw inside a tool handler -> generic isError result, raw message NOT leaked', async function () {
    var result = await server.registeredTools['boom_tool']({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: Internal server error');
    expect(result.content[0].text).not.toMatch(/ER_DUP_ENTRY|Duplicate entry|task_masters/);
  });

  test('unexpected throw is logged server-side with the original error', async function () {
    await server.registeredTools['boom_tool']({});
    expect(mockLoggedErrors.length).toBe(1);
    var loggedErr = mockLoggedErrors[0][1];
    expect(loggedErr).toBeInstanceOf(Error);
    expect(loggedErr.message).toMatch(/ER_DUP_ENTRY/);
  });

  test('successful tool result passes through unchanged', async function () {
    var result = await server.registeredTools['ok_tool']({});
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('{"id":"t1"}');
    expect(mockLoggedErrors.length).toBe(0);
  });

  test('expected (mapped) isError result passes through byte-identical, not re-wrapped', async function () {
    var result = await server.registeredTools['expected_error_tool']({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error: Task not found');
    expect(mockLoggedErrors.length).toBe(0);
  });
});
