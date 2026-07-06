'use strict';

/**
 * Juggler MCP — stdio transport for Claude Code / Claude Desktop.
 *
 * Mirrors resume-optimizer-backend/src/mcp/server.js's stdio entry: validates
 * an MCP API key in-process (the same apiKeyValidator the production HTTP
 * transport uses — auth-service introspection + payment-service entitlement,
 * fail-closed), then registers the SAME tool implementations
 * (src/mcp/tools/*.js) the HTTP transport uses. No REST hop, no duplicate
 * tool logic — replaces juggler-mcp/index.js's REST-over-Bearer-JWT proxy,
 * which never accepted MCP API keys (999.1173 follow-up).
 *
 * Auth: MCP API key via MCP_API_KEY env var (Claude Code sets this when
 * launching the process, per .mcp.json).
 */

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { apiKeyValidator } = require('./api-key-auth');
const { createMcpServerForUser } = require('./server');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('mcp-stdio-server');

const LOG_PREFIX = '[MCP-STDIO]';

async function main() {
  const apiKey = process.env.MCP_API_KEY;

  if (!apiKey) {
    logger.error(`${LOG_PREFIX} MCP_API_KEY environment variable is required`);
    process.exit(1);
  }

  const authResult = await apiKeyValidator(apiKey);
  if (!authResult) {
    logger.error(`${LOG_PREFIX} Invalid, unentitled, or expired MCP API key`);
    process.exit(1);
  }

  logger.error(`${LOG_PREFIX} Authenticated (key: ${authResult.keyName})`);

  const server = createMcpServerForUser(authResult.userId);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.error(`${LOG_PREFIX} Server running on stdio`);
}

if (require.main === module) {
  main().catch((error) => {
    logger.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  });
}

module.exports = { main };
