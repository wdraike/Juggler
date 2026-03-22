const express = require('express');
const router = express.Router();
const dataController = require('../controllers/data.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { requireFeature } = require('../middleware/feature-gate');

router.use(authenticateJWT, resolvePlanFeatures);

router.post('/import', dataController.importData);  // Import available on all tiers
router.get('/export', requireFeature('data.export'), dataController.exportData);

module.exports = router;
