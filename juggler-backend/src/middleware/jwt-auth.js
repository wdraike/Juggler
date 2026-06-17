/**
 * JWT Authentication Middleware for Juggler
 *
 * Delegates to shared auth-client which verifies RS256 JWTs via JWKS
 * from the centralized auth-service. No local secret needed.
 *
 * Maintains the same export interface so all route files work unchanged.
 */

const { authenticateJWT: createAuthMiddleware } = require('auth-client');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { createLogger } = require('@raike/lib-logger');
const db = require('../db');
const { APP_ID } = require('../service-identity');

const logger = createLogger('jwt-auth');

// Verify JWT via auth-client, then resolve local user by email
// (auth-service user IDs may differ from local user IDs)
const jwtMiddleware = createAuthMiddleware(APP_ID);
const authenticateJWT = async (req, res, next) => {
  jwtMiddleware(req, res, async (err) => {
    if (err) return next(err);
    if (!req.user?.email) return; // jwtMiddleware already sent 401
    // Explicit 403 for tokens without the 'juggler' app claim (999.588)
    // Defense-in-depth: even if auth-client's behavior changes, tokens missing
    // the required app claim are rejected here with a clear 403.
    if (!req.auth?.apps?.includes(APP_ID)) {
      return res.status(403).json({ error: 'No access to this application' });
    }
    try {
      const localUser = await db('users').where('email', req.user.email).first();
      if (localUser) {
        req.user = { ...localUser, authServiceId: req.user.id };
      } else {
        // First login — provision user in local DB using auth-service claims
        const newId = req.user.id; // use auth-service ID as local ID
        try {
          await db('users').insert({
            id: newId,
            email: req.user.email,
            name: req.user.name,
            picture_url: req.user.picture || null,
          });
        } catch (insertErr) {
          // Concurrent request raced us — duplicate email insert; ignore and fetch below
          if (!insertErr.message?.includes('Duplicate')) throw insertErr;
          logger.warn('jwt-auth: concurrent first-login insert race, fetching existing row', { email: req.user.email });
        }
        const provisioned = await db('users').where('id', newId).first();
        if (!provisioned) return next(new Error('User provision failed'));
        req.user = { ...provisioned, authServiceId: newId };
      }
    } catch (dbErr) {
      logger.error('jwt-auth: DB error during user lookup/provision', { err: dbErr.message });
      return next(dbErr);
    }
    next();
  });
};

// JWKS fetcher for MCP transport verification
let _jwks = null;
function getJWKS() {
  if (!_jwks) {
    const jwksUrl = process.env.AUTH_JWKS_URL || 'http://localhost:5010/.well-known/jwks.json';
    _jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return _jwks;
}

/**
 * Verify a token using auth-service JWKS (used by MCP transport)
 */
async function verifyToken(token) {
  const { payload } = await jwtVerify(token, getJWKS(), { issuer: 'raike-auth', algorithms: ['RS256'] });
  return payload;
}

/**
 * No-op — secrets loaded via JWKS from auth-service, not local
 */
async function loadJWTSecrets() {
  logger.info('JWT verification via auth-service JWKS (no local secret needed)');
}

/**
 * Validate refresh token — now delegates to auth-service API
 * Kept for backwards compatibility but refresh should go through auth-service
 */
const validateRefreshToken = async (req, res, next) => {
  // Refresh tokens are now handled by auth-service directly
  // This middleware should not be called in the new flow
  return res.status(410).json({
    error: 'Refresh via auth-service',
    message: 'Token refresh is handled by auth-service. POST to AUTH_SERVICE_URL/api/auth/refresh'
  });
};

module.exports = {
  loadJWTSecrets,
  authenticateJWT,
  validateRefreshToken,
  verifyToken
};
