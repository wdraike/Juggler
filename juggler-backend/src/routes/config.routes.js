const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { checkScheduleTemplateLimit } = require('../middleware/entity-limits');
const { validate } = require('../middleware/validate');
const { preferencesSchema } = require('../schemas/config.schema');

router.use(authenticateJWT, resolvePlanFeatures);

// Config
router.get('/', configController.getAllConfig);
// users.timezone correction (999.1447) — distinct table from user_config,
// so this is NOT routed through PUT /:key / UserConfig.VALID_KEYS.
router.patch('/timezone', configController.updateTimezone);
// Restore the schedule-template trio to the server-side defaults (999.2144).
// Static path + POST verb — no collision with PUT /:key below.
router.post('/templates/reset', configController.resetScheduleTemplates);
// Enforce schedule template limit when saving time_blocks
router.put('/:key', function(req, res, next) {
  if (req.params.key === 'time_blocks') {
    return checkScheduleTemplateLimit(req, res, next);
  }
  next();
}, function(req, res, next) {
  if (req.params.key === 'preferences') {
    return validate(preferencesSchema)(req, res, next);
  }
  next();
}, configController.updateConfig);

module.exports = router;
