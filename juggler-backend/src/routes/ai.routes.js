const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { requireFeature } = require('../middleware/feature-gate');

router.use(authenticateJWT, resolvePlanFeatures);

router.post('/command', requireFeature('ai.natural_language_commands'), aiController.handleCommand);

module.exports = router;
