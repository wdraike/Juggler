/**
 * Unified calendar sync routes
 */

var express = require('express');
var router = express.Router();
var calSyncController = require('../controllers/cal-sync.controller');
var { authenticateJWT } = require('../middleware/jwt-auth');
var { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
var { requireFeature } = require('../middleware/feature-gate');
// Lightweight check: did anything change on the calendar since last sync?
router.get('/has-changes', authenticateJWT, calSyncController.hasChanges);

// Manual sync — lock is acquired inside the controller around the write phase only,
// not the entire API fetch phase. This allows user edits to flow during fetching.
router.post('/sync', authenticateJWT, calSyncController.sync);

// Sync history log
router.get('/sync-history', authenticateJWT, calSyncController.getSyncHistory);

module.exports = router;
