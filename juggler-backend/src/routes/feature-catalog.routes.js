/**
 * Feature Catalog Routes
 *
 * Exposes Juggler's configurable features to the payment service.
 * Protected by a shared service key (FEATURE_CATALOG_KEY env var).
 */

const router = require('express').Router();
const controller = require('../controllers/feature-catalog.controller');

function authenticateServiceKey(req, res, next) {
  const expectedKey = process.env.FEATURE_CATALOG_KEY;
  if (!expectedKey) {
    return res.status(503).json({ error: 'Feature catalog not configured (FEATURE_CATALOG_KEY not set)' });
  }

  const providedKey = req.headers['x-service-key'];
  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ error: 'Invalid service key' });
  }

  next();
}

router.get('/', authenticateServiceKey, controller.getFeatureCatalog);

module.exports = router;
