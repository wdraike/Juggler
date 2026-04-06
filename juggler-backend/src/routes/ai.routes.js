const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { requireFeature, checkUsageLimit } = require('../middleware/feature-gate');

var aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: function(req) { return req.user ? req.user.id : req.ip; },
  message: { error: 'Too many AI requests. Try again in a minute.' }
});

router.use(authenticateJWT, resolvePlanFeatures);

router.post('/command',
  aiLimiter,
  requireFeature('ai.natural_language_commands'),
  checkUsageLimit('ai_commands_per_month'),
  aiController.handleCommand
);

module.exports = router;
