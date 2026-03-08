/**
 * MCP Transport — Stateless Streamable HTTP handler for Express
 *
 * Each POST /mcp creates a fresh McpServer + transport, authenticated by Bearer JWT.
 * No session tracking needed — works across Cloud Run instances.
 */

const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpServerForUser } = require('./server');
const { verifyToken } = require('../middleware/jwt-auth');
const db = require('../db');

/**
 * Authenticate the request and return the user ID.
 * Throws if authentication fails.
 */
async function authenticateRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (decoded.type !== 'access') {
    const err = new Error('Invalid token type');
    err.status = 401;
    throw err;
  }

  const user = await db('users').where('id', decoded.userId).first();
  if (!user) {
    const err = new Error('User not found');
    err.status = 401;
    throw err;
  }

  return user.id;
}

/**
 * POST /mcp — handle MCP request (stateless mode)
 */
async function handlePost(req, res) {
  try {
    const userId = await authenticateRequest(req);

    const server = createMcpServerForUser(userId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined // stateless — no session tracking
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Clean up after response is sent
    res.on('finish', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  } catch (error) {
    if (!res.headersSent) {
      const status = error.status || 500;
      res.status(status).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: error.message },
        id: null
      });
    }
  }
}

/**
 * GET/DELETE /mcp — not supported in stateless mode
 */
function handleMethodNotAllowed(req, res) {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed (stateless mode — use POST)' },
    id: null
  });
}

module.exports = { handlePost, handleMethodNotAllowed };
