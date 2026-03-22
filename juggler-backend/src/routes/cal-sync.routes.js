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

router.post('/sync', authenticateJWT, resolvePlanFeatures, requireFeature('calendar.unified_sync'), withSyncLock(calSyncController.sync));

module.exports = router;
