/**
 * Shared JWT secret for OAuth state tokens.
 * Used by calendar controllers (gcal, msft).
 */
var { jwtVerify } = require('jose');

function getJwtSecret() {
  var secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET required in production');
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
