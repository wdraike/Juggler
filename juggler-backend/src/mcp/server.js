/**
 * MCP Server Factory — creates a configured McpServer for a given user
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { registerTaskTools } = require('./tools/tasks');
const { registerScheduleTools } = require('./tools/schedule');
const { registerConfigTools } = require('./tools/config');
const { registerDataTools } = require('./tools/data');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('mcp-server');

// ── 999.1397: server-level error sanitizer ────────────────────────────────────
// Tool bodies have no try/catch around facade/db calls — an unexpected THROW
// (deadlock exhaustion, ER_DUP_ENTRY, etc.) would otherwise propagate into the
// MCP SDK, which serializes the raw error.message to the external ClimbRS
// client (potential SQL/schema string leak). Wrap every registered tool handler
// so unexpected throws are logged server-side and the client sees only a
// generic error. Expected error paths (isError:true results) are untouched.
function sanitizeToolErrors(server) {
  const rawTool = server.tool.bind(server);
  server.tool = function (...args) {
    const handler = args[args.length - 1];
    if (typeof handler === 'function') {
      args[args.length - 1] = async function (...handlerArgs) {
        try {
          return await handler.apply(this, handlerArgs);
        } catch (err) {
          logger.error('[mcp] unexpected tool error', err);
          return { content: [{ type: 'text', text: 'Error: Internal server error' }], isError: true };
        }
      };
    }
    return rawTool(...args);
  };
}

/**
 * Create an McpServer with all tools registered, scoped to a specific user.
 */
function createMcpServerForUser(userId) {
  // MCP-protocol display name — the product brand (StriveRS), not
  // SERVICE_NAME (the internal engineering codename, 'juggler', used
  // elsewhere for DB/service-auth/logging identity).
  const server = new McpServer({
    name: 'strivers',
    version: '1.0.0'
  });

  sanitizeToolErrors(server);
  registerTaskTools(server, userId);
  registerScheduleTools(server, userId);
  registerConfigTools(server, userId);
  registerDataTools(server, userId);

  return server;
}

module.exports = { createMcpServerForUser };
