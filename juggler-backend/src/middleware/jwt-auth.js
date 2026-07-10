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
const { getString } = require('../lib/config');
// Via the slice facade (JUG-HEX boundary — no direct application/adapters imports)
const { ProvisionUserOnFirstLogin, KnexUserRepository } = require('../slices/user-config');

const logger = createLogger('jwt-auth');

// Composition root for the provisioning use-case (999.1197): wired to the same
// shared pool the middleware always used. Provisioning rules (999.1222 tz seed,
// duplicate race, auth-id == local-id invariant) live in the use-case.
const provisionUser = new ProvisionUserOnFirstLogin({
  userRepository: new KnexUserRepository({ db }),
  logger,
});

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
      // Resolve-or-provision is delegated to ProvisionUserOnFirstLogin (999.1197).
      // 999.1222 RULING (2026-07-06): users.timezone is owned by Settings only —
      // provisioning seeds it ONCE from X-Browser-Timezone; existing rows are
      // never written here. See the use-case for the full rules.
      const localUser = await provisionUser.execute({
        authUser: req.user,
        browserTimezone: req.headers['x-browser-timezone'],
      });
      req.user = { ...localUser, authServiceId: req.user.id };
    } catch (dbErr) {
      logger.error('jwt-auth: DB error during user lookup/provision', { err: dbErr.message });
      return next(dbErr);
    }
    next();
  });
};

// JWKS fetcher for MCP transport verification.
// URL comes from lib/config (AUTH_JWKS_URL): the localhost:5010 value is the
// DOCUMENTED dev default declared in the schema; in NODE_ENV=production the
// env var is required and getString throws if unset (no localhost leak).
let _jwks = null;
function getJWKS() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(getString('AUTH_JWKS_URL')));
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
const validateRefreshToken = async (req, res, _next) => {
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
