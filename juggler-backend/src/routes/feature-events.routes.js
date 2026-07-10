/**
 * Feature Events Internal API
 *
 * Exposes feature event data for analytics.
 * Protected by service key (same as feature catalog).
 *
 * 999.1196: the query/aggregation logic moved to the user-config slice's
 * GetFeatureEventsReport use-case (application/queries). The service-key auth
 * guard is a route-edge concern and stays here, mirroring the billing-webhooks
 * HMAC-signature guard convention (facade.js "ROUTE-EDGE GUARDS PRESERVED").
 */

const crypto = require('crypto');
const router = require('express').Router();
const userConfigFacade = require('../slices/user-config/facade');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('feature-events.routes');

function authenticateServiceKey(req, res, next) {
  const expectedKey = process.env.FEATURE_CATALOG_KEY;
  if (!expectedKey) {
    return res.status(503).json({ error: 'Feature catalog not configured' });
  }
  const providedKey = req.headers['x-service-key'];
  if (typeof providedKey !== 'string' || providedKey.length !== expectedKey.length) {
    return res.status(401).json({ error: 'Invalid service key' });
  }
  const a = Buffer.from(providedKey);
  const b = Buffer.from(expectedKey);
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid service key' });
  }
  next();
}

router.get('/', authenticateServiceKey, async (req, res) => {
  try {
    const result = await userConfigFacade.getFeatureEventsReport(req.query);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('[feature-events] query failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
