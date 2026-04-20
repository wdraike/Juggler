/**
 * MCP Transport — Stateless Streamable HTTP handler for Express
 *
 * Each POST /mcp creates a fresh McpServer + transport, authenticated by Bearer JWT.
 * No session tracking needed — works across Cloud Run instances.
 *
 * Authentication delegated to shared mcp-auth module (JWT via JWKS + auto-provisioning).
 */

var StreamableHTTPServerTransport = require('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport;
var { createMcpServerForUser } = require('./server');
var { authenticateMcpRequest, sendMcpUnauthorized } = require('auth-client/mcp-auth');
var db = require('../db');

var MCP_TIMEOUT = 120000; // 2 minutes max per MCP request
var PUBLIC_URL = process.env.PUBLIC_URL || process.env.MCP_ISSUER_URL || '';
var { APP_ID } = require('../service-identity');

/**
 * Check if user has an active plan for this app.
 * Uses JWT claims first (fast), falls back gracefully if no plan info.
 */
async function planCheck(authResult) {
  var plans = authResult.plans || {};
  if (plans[APP_ID]) return { hasActivePlan: true, planId: plans[APP_ID] };
  return { hasActivePlan: false };
}

/**
 * Extract Bearer token from request.
 */
function extractBearerToken(req) {
  var authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * POST /mcp — handle MCP request (stateless mode)
 */
async function handlePost(req, res) {
  var server;
  var transport;
  var timeout;

  function cleanup() {
    clearTimeout(timeout);
    if (transport) transport.close().catch(function() {});
    if (server) server.close().catch(function() {});
  }

  try {
    var token = extractBearerToken(req);
    if (!token) {
      return sendMcpUnauthorized(res, PUBLIC_URL || req.protocol + '://' + req.get('host'));
    }

    var authResult = await authenticateMcpRequest(token, db, { planCheck: planCheck });
    if (!authResult) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or expired token' },
        id: null
      });
    }

    server = createMcpServerForUser(authResult.userId);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined // stateless — no session tracking
    });

    // Timeout: kill the request if it takes too long
    timeout = setTimeout(function() {
      console.warn('[mcp] Request timeout after ' + MCP_TIMEOUT + 'ms');
      cleanup();
      if (!res.headersSent) {
        res.status(504).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Request timed out' },
          id: null
        });
      }
    }, MCP_TIMEOUT);

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Clean up after response is sent
    res.on('finish', cleanup);
  } catch (error) {
    cleanup();
    if (!res.headersSent) {
      var status = error.status || 500;
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
