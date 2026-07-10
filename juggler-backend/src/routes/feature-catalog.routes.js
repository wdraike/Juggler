/**
 * Feature Catalog Routes
 *
 * Exposes Juggler's configurable features to the payment service.
 * Protected by a shared service key (FEATURE_CATALOG_KEY env var).
 */

const crypto = require('crypto');
const router = require('express').Router();
const controller = require('../controllers/feature-catalog.controller');
const config = require('../lib/config');

function authenticateServiceKey(req, res, next) {
  const expectedKey = config.getString('FEATURE_CATALOG_KEY'); // 999.1473 ('' when unset, same falsy check below)
  if (!expectedKey) {
    return res.status(503).json({ error: 'Feature catalog not configured (FEATURE_CATALOG_KEY not set)' });
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

router.get('/', authenticateServiceKey, controller.getFeatureCatalog);

module.exports = router;
