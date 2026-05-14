const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { requireFeature, checkUsageLimit } = require('../middleware/feature-gate');
const { maybeRedisStore } = require('../lib/rate-limit-store');

// Per-user AI rate limiter — max 2 req/min per authenticated user.
// Uses RedisStore when REDIS_URL is set so counters are shared across Cloud Run
// instances (prevents N-instance bypass where each instance allows 2/min).
// Falls back to MemoryStore when Redis is unavailable (local dev / single instance).
// See Phase 07 FIX-05. Broader API limits stay per-instance (acceptable — Category 4f).
var aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  store: maybeRedisStore('jugrl-ai:'),
  keyGenerator: function(req) { return req.user ? req.user.id : 'anon'; },
  message: { error: 'Too many AI requests. Max 2 per minute — try again shortly.' },
  validate: false
});

// Exported for testability (allows tests to assert store type without HTTP)
module.exports = router;
module.exports._aiLimiter = aiLimiter;

router.use(authenticateJWT, resolvePlanFeatures);

router.post('/command',
  aiLimiter,
  requireFeature('ai.natural_language_commands'),
  checkUsageLimit('ai_commands_per_month'),
  aiController.handleCommand
);
