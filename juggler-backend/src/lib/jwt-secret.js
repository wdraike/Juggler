/**
 * Shared JWT secret for OAuth state tokens.
 * Used by calendar controllers (gcal, msft).
 *
 * Implements JwtSecretPort (contract doc removed as dead code, 999.1179).
 */
var { jwtVerify } = require('jose');

// NOTE (999.1473): JWT_SECRET itself is intentionally NOT routed through
// lib/config — it has no safe declared default (a dev value would need to be
// baked into the schema and could be mistaken for a real fallback), and this
// function already implements the exact requiredInProduction contract by hand
// (throw in production when unset, dev-only fallback otherwise). Migrating it
// would just relocate the same two lines into the schema for no behavior
// change. NODE_ENV read here goes through lib/config for consistency.
var config = require('./config');

function getJwtSecret() {
  var secret = process.env.JWT_SECRET;
  if (!secret) {
    if (config.getString('NODE_ENV') === 'production') throw new Error('JWT_SECRET required in production');
    secret = 'local-dev-jwt-secret-juggler';
  }
  return new TextEncoder().encode(secret);
}

/**
 * Verify an OAuth-state JWT, pinned to HS256 (the alg the state is signed with).
 * Centralizes the algorithms allowlist (999.318) so all callers + tests use one path.
 * @returns {Promise<{payload, protectedHeader}>}  the jose jwtVerify result
 */
async function verifyStateToken(state) {
  return jwtVerify(state, getJwtSecret(), { algorithms: ['HS256'] });
}

module.exports = { getJwtSecret: getJwtSecret, verifyStateToken: verifyStateToken };
