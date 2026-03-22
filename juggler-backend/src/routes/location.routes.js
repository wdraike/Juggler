const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { checkLocationLimit } = require('../middleware/entity-limits');

router.use(authenticateJWT, resolvePlanFeatures);

router.get('/', configController.getLocations);
router.put('/', checkLocationLimit, configController.replaceLocations);

module.exports = router;
