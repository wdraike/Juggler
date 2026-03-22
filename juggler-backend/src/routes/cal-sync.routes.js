/**
 * Unified calendar sync routes
 */

var express = require('express');
var router = express.Router();
var calSyncController = require('../controllers/cal-sync.controller');
var { authenticateJWT } = require('../middleware/jwt-auth');
var { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
var { requireFeature } = require('../middleware/feature-gate');
var { withSyncLock } = require('../lib/sync-lock');

// Manual sync available to all users (auto_sync gates periodic background sync, not manual triggers)
router.post('/sync', authenticateJWT, withSyncLock(calSyncController.sync));

module.exports = router;
