/**
 * Calendar Provider Limit Middleware
 *
 * Checks how many calendar providers are connected and blocks
 * new connections if the user's plan limit is reached.
 * Free: 1 provider, Pro+: unlimited (-1).
 */

const db = require('../db');

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, key) => o?.[key], obj);
}

/**
 * Middleware factory for calendar connection routes.
 * @param {string} provider - 'google' or 'microsoft' — the provider being connected
 */
function checkCalendarLimit(provider) {
  return async (req, res, next) => {
    if (!req.planFeatures) {
      return next(); // No plan features resolved — allow (fail open)
    }

    const limit = getNestedValue(req.planFeatures, 'calendar.max_providers');

    // -1 or undefined = unlimited
    if (limit === -1 || limit === undefined) {
      return next();
    }

    const userId = req.user?.id;
    if (!userId) {
      return next();
    }

    try {
      const user = await db('users').where('id', userId).first();
      if (!user) return next();

      // Count connected providers
      let connectedCount = 0;
      if (user.gcal_access_token) connectedCount++;
      if (user.msft_cal_access_token) connectedCount++;

      // If this provider is already connected, allow reconnect
      if (provider === 'google' && user.gcal_access_token) return next();
      if (provider === 'microsoft' && user.msft_cal_access_token) return next();

      // Check if adding this provider would exceed the limit
      if (connectedCount >= limit) {
        return res.status(403).json({
          error: 'Calendar provider limit reached',
          code: 'CALENDAR_LIMIT_REACHED',
          connected: connectedCount,
          limit,
          current_plan: req.planId || 'free',
          upgrade_required: true,
          message: `Your plan allows ${limit} calendar provider${limit > 1 ? 's' : ''}. Upgrade to connect additional providers.`
        });
      }

      next();
    } catch (err) {
      console.error('[calendar-limit] Check failed:', err.message);
      next(); // Fail open
    }
  };
}

module.exports = { checkCalendarLimit };
