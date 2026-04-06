/**
 * Shared JWT secret for OAuth state tokens.
 * Used by calendar controllers (gcal, msft).
 */
function getJwtSecret() {
  var secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET required in production');
    secret = 'local-dev-jwt-secret-juggler';
  }
  return new TextEncoder().encode(secret);
}

module.exports = { getJwtSecret };
