const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { requireFeature, checkUsageLimit } = require('../middleware/feature-gate');

router.use(authenticateJWT, resolvePlanFeatures);

router.post('/command',
  requireFeature('ai.natural_language_commands'),
  checkUsageLimit('ai_commands_per_month'),
  aiController.handleCommand
);

module.exports = router;
