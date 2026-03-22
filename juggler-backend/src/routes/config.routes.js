const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { checkScheduleTemplateLimit } = require('../middleware/entity-limits');

router.use(authenticateJWT, resolvePlanFeatures);

// Config
router.get('/', configController.getAllConfig);
// Enforce schedule template limit when saving time_blocks
router.put('/:key', function(req, res, next) {
  if (req.params.key === 'time_blocks') {
    return checkScheduleTemplateLimit(req, res, next);
  }
  next();
}, configController.updateConfig);

module.exports = router;
