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
const db = require('../db');
const { APP_ID } = require('../service-identity');

// Verify JWT via auth-client, then resolve local user by email
// (auth-service user IDs may differ from local user IDs)
const jwtMiddleware = createAuthMiddleware(APP_ID);
const authenticateJWT = async (req, res, next) => {
  jwtMiddleware(req, res, async (err) => {
    if (err) return next(err);
    if (!req.user?.email) return; // jwtMiddleware already sent 401
    try {
      const localUser = await db('users').where('email', req.user.email).first();
      if (localUser) {
        req.user = { ...localUser, authServiceId: req.user.id };
      }
    } catch (dbErr) {
      // DB lookup failed — continue with JWT-only user data
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
  const { payload } = await jwtVerify(token, getJWKS(), { issuer: 'raike-auth' });
  return payload;
}

/**
 * No-op — secrets loaded via JWKS from auth-service, not local
 */
async function loadJWTSecrets() {
  console.log('JWT verification via auth-service JWKS (no local secret needed)');
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
