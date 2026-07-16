/**
 * Shared MCP Authentication Module for Raike Applications
 *
 * Provides unified OAuth proxy routes and MCP request authentication
 * for all apps that expose MCP endpoints (Strivers, Climbrs, etc.).
 *
 * Auth-service handles all OAuth (Google SSO, email/password, etc.).
 * Apps proxy /oauth/* to auth-service and verify JWTs via JWKS.
 *
 * Usage:
 *   const { createOAuthProxyRoutes, authenticateMcpRequest } = require('auth-client/mcp-auth');
 *
 *   // Mount OAuth discovery + proxy routes
 *   createOAuthProxyRoutes(app, {
 *     publicUrl: process.env.PUBLIC_URL,
 *     authServiceUrl: process.env.AUTH_SERVICE_URL,
 *     authPublicUrl: process.env.AUTH_SERVICE_PUBLIC_URL,
 *   });
 *
 *   // In your MCP transport handler:
 *   const auth = await authenticateMcpRequest(token, db, { apiKeyValidator, planCheck });
 */

'use strict';

const { createRemoteJWKSet, jwtVerify } = require('jose');
const express = require('express');

// ─── JWKS verification (shared singleton) ────────────────────────
//
// 999.1551: The `process.env.AUTH_JWKS_URL || <dev default>` read below is
// intentional and must stay as a direct env read. This is a SHARED library
// (npm package "auth-client", subpath "./mcp-auth") consumed by multiple
// services. It cannot import any single service's config module without
// breaking other consumers. The dev-only localhost fallback is overridden
// in production by each consuming service setting AUTH_JWKS_URL.

let _jwks = null;

function getJWKS() {
  if (!_jwks) {
    const jwksUrl = process.env.AUTH_JWKS_URL || 'http://localhost:5010/.well-known/jwks.json';
    _jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return _jwks;
}

// ─── OAuth Proxy Routes ──────────────────────────────────────────

/**
 * Mount OAuth discovery and proxy routes on an Express app.
 *
 * Creates:
 *   GET  /.well-known/oauth-protected-resource
 *   GET  /.well-known/oauth-authorization-server
 *   GET  /oauth/authorize          (redirect to auth-service)
 *   POST /oauth/token              (proxy to auth-service)
 *   POST /oauth/register           (proxy to auth-service)
 *
 * Options:
 *   publicUrl      - Public URL of this app (e.g. https://strivers.raikegroup.com)
 *   authServiceUrl - Internal auth-service URL for proxying (e.g. https://auth-backend-xxx.run.app)
 *   authPublicUrl  - Public auth-service URL for redirects (e.g. https://auth.raikegroup.com)
 *   mcpEndpoint    - MCP endpoint path (default: '/mcp' for Strivers, '/api/mcp' for Climbrs)
 */
function createOAuthProxyRoutes(app, options) {
  // 999.1551: The env-var fallbacks below are intentional. This is a shared
  // library consumed by multiple services, so it cannot import any service's
  // config module. The options object IS the config-injection mechanism:
  // consuming services pass explicit values, and the `process.env.X || <dev
  // default>` chain only fires when the caller omits an option. The localhost
  // defaults are dev-only; production services pass options or set the env vars.
  var publicUrl = options.publicUrl || process.env.PUBLIC_URL || '';
  var authServiceUrl = options.authServiceUrl || process.env.AUTH_SERVICE_URL || 'http://localhost:5010';
  var authPublicUrl = options.authPublicUrl || process.env.AUTH_SERVICE_PUBLIC_URL || authServiceUrl;
  var mcpEndpoint = options.mcpEndpoint || '/mcp';

  // /.well-known/oauth-protected-resource (RFC 9728)
  app.get('/.well-known/oauth-protected-resource', function(req, res) {
    var base = publicUrl || getBaseUrl(req);
    res.json({
      resource: base + mcpEndpoint,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp']
    });
  });

  // /.well-known/oauth-authorization-server (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', function(req, res) {
    var base = publicUrl || getBaseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: base + '/oauth/authorize',
      token_endpoint: base + '/oauth/token',
      registration_endpoint: base + '/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256']
    });
  });

  // GET /oauth/authorize — redirect to auth-service (which handles Google SSO, etc.)
  app.get('/oauth/authorize', function(req, res) {
    var params = new URLSearchParams(req.query);
    res.redirect(authPublicUrl + '/oauth/authorize?' + params.toString());
  });

  // POST /oauth/token — proxy to auth-service
  app.post('/oauth/token', express.urlencoded({ extended: true }), function(req, res) {
    fetch(authServiceUrl + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    })
      .then(function(response) {
        return response.json().then(function(data) {
          if (response.status === 200) {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Pragma', 'no-cache');
          }
          res.status(response.status).json(data);
        });
      })
      .catch(function(err) {
        console.error('[mcp-auth] Token proxy error:', err.message);
        res.status(502).json({ error: 'server_error', error_description: 'Auth service unavailable' });
      });
  });

  // POST /oauth/register — proxy to auth-service
  app.post('/oauth/register', function(req, res) {
    fetch(authServiceUrl + '/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    })
      .then(function(response) {
        return response.json().then(function(data) {
          res.status(response.status).json(data);
        });
      })
      .catch(function(err) {
        console.error('[mcp-auth] Register proxy error:', err.message);
        res.status(502).json({ error: 'server_error', error_description: 'Auth service unavailable' });
      });
  });
}

// ─── MCP Request Authentication ──────────────────────────────────

/**
 * Authenticate an MCP request Bearer token.
 *
 * Flow:
 *   1. Verify JWT via auth-service JWKS (issuer: 'raike-auth')
 *   2. Resolve local user by email first, then by auth-service user ID
 *   3. Auto-provision local user if missing (for SSO users from other apps)
 *   4. Optionally fall back to API key validation
 *   5. Optionally check plan/subscription status
 *
 * Returns { userId, email, name, keyId, keyName, plans } or null.
 *
 * Options:
 *   apiKeyValidator  - async function(token) => { userId, email, name, keyId, keyName } or null
 *   planCheck        - async function(authResult) => { hasActivePlan, planId, features } or null
 *   autoProvision    - boolean, default true. Auto-create local user from JWT claims.
 */
async function authenticateMcpRequest(token, db, options) {
  if (!token) return null;
  options = options || {};

  // Try JWT first (JWTs have 3 dot-separated segments)
  if (token.split('.').length === 3) {
    try {
      var result = await _authenticateJwt(token, db, options);
      if (result) {
        // Plan check if configured
        if (options.planCheck) {
          var planResult = await options.planCheck(result);
          if (planResult && !planResult.hasActivePlan) {
            var err = new Error('Active subscription required');
            err.status = 402;
            throw err;
          }
          if (planResult) {
            result.planId = planResult.planId;
            result.planFeatures = planResult.features;
          }
        }
        return result;
      }
    } catch (e) {
      // Re-throw plan check errors (402)
      if (e.status === 402) throw e;
      // JWT verification failed — fall through to API key
    }
  }

  // Fall back to API key if validator provided
  if (options.apiKeyValidator) {
    try {
      var apiKeyResult = await options.apiKeyValidator(token);
      if (apiKeyResult) {
        // Plan check if configured — same enforcement as the JWT branch above.
        if (options.planCheck) {
          var apiKeyPlanResult = await options.planCheck(apiKeyResult);
          if (apiKeyPlanResult && !apiKeyPlanResult.hasActivePlan) {
            var planErr = new Error('Active subscription required');
            planErr.status = 402;
            throw planErr;
          }
          if (apiKeyPlanResult) {
            apiKeyResult.planId = apiKeyPlanResult.planId;
            apiKeyResult.planFeatures = apiKeyPlanResult.features;
          }
        }
      }
      return apiKeyResult;
    } catch (e) {
      // Re-throw plan check errors (402); swallow API key validation failures
      if (e.status === 402) throw e;
      // API key validation failed
    }
  }

  return null;
}

/**
 * Verify JWT and resolve local user.
 */
async function _authenticateJwt(token, db, options) {
  var payload = (await jwtVerify(token, getJWKS(), { issuer: 'raike-auth' })).payload;

  if (payload.type !== 'access') return null;

  var email = payload.email;
  var authServiceId = payload.sub || payload.userId;
  var user = null;

  // Resolve local user: email first (reliable across systems), then ID
  // Query without is_active filter (not all apps have this column)
  if (email) {
    user = await db('users').where('email', email).first();
  }
  if (!user && authServiceId) {
    user = await db('users').where('id', authServiceId).first();
  }

  // Auto-provision local user from auth-service JWT claims
  if (!user && email && options.autoProvision !== false) {
    try {
      var uuid = require('uuid');
      var newId = uuid.v7();
      // Minimal insert — only columns guaranteed across all apps
      var insertData = {
        id: newId,
        email: email.toLowerCase(),
        name: payload.name || email.split('@')[0],
        created_at: new Date(),
        updated_at: new Date()
      };
      await db('users').insert(insertData);
      user = await db('users').where('id', newId).first();
      console.log('[mcp-auth] Auto-provisioned local user ' + email + ' (' + newId + ')');
    } catch (provisionErr) {
      // May fail due to unique constraint if user was created concurrently, or missing columns
      if (email) {
        user = await db('users').where('email', email.toLowerCase()).first();
      }
      if (!user) {
        console.error('[mcp-auth] Failed to auto-provision user:', provisionErr.message);
      }
    }
  }

  if (!user) return null;

  return {
    userId: user.id,
    email: user.email || email,
    name: user.name || payload.name,
    keyId: 'oauth:' + user.id,
    keyName: 'OAuth',
    authServiceId: authServiceId,
    plans: payload.plans || {}
  };
}

// ─── WWW-Authenticate Helper ─────────────────────────────────────

/**
 * Send a 401 response with the MCP-spec WWW-Authenticate header.
 * Tells the MCP client where to find OAuth metadata.
 */
function sendMcpUnauthorized(res, publicUrl) {
  res
    .status(401)
    .set('WWW-Authenticate', 'Bearer resource_metadata="' + publicUrl + '/.well-known/oauth-protected-resource"')
    .json({ error: 'Bearer token required in Authorization header' });
}

// ─── Helpers ─────────────────────────────────────────────────────

function getBaseUrl(req) {
  var proto = req.get('x-forwarded-proto') || req.protocol;
  var host = req.get('x-forwarded-host') || req.get('host');
  return proto + '://' + host;
}

// ─── Exports ─────────────────────────────────────────────────────

module.exports = {
  createOAuthProxyRoutes: createOAuthProxyRoutes,
  authenticateMcpRequest: authenticateMcpRequest,
  sendMcpUnauthorized: sendMcpUnauthorized
};
