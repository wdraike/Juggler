/**
 * MCP Server Factory — creates a configured McpServer for a given user
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { registerTaskTools } = require('./tools/tasks');
const { registerScheduleTools } = require('./tools/schedule');
const { registerConfigTools } = require('./tools/config');
const { registerDataTools } = require('./tools/data');

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

  registerTaskTools(server, userId);
  registerScheduleTools(server, userId);
  registerConfigTools(server, userId);
  registerDataTools(server, userId);

  return server;
}

module.exports = { createMcpServerForUser };
