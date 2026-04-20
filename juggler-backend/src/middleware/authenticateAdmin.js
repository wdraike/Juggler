/**
 * authenticateAdmin — gate a route to admin users only.
 *
 * No schema change: admin membership is declared via the ADMIN_EMAILS env
 * var (comma-separated). If the env var is unset, access is denied for
 * everyone — safe default in production.
 *
 * Assumes authenticateJWT has already populated req.user with an `email`.
 * Stack: authenticateJWT → authenticateAdmin → handler.
 */

function getAdminEmails() {
  var raw = process.env.ADMIN_EMAILS || '';
  return raw.split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

function authenticateAdmin(req, res, next) {
  if (!req.user || !req.user.email) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  var admins = getAdminEmails();
  if (admins.length === 0) {
    return res.status(403).json({ error: 'Admin access not configured' });
  }
  if (admins.indexOf(String(req.user.email).toLowerCase()) === -1) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = authenticateAdmin;
module.exports.authenticateAdmin = authenticateAdmin;
