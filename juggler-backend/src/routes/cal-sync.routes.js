/**
 * Unified calendar sync routes
 */

var express = require('express');
var router = express.Router();
var calSyncController = require('../controllers/cal-sync.controller');
var { authenticateJWT } = require('../middleware/jwt-auth');
var { withSyncLock } = require('../lib/sync-lock');

router.post('/sync', authenticateJWT, withSyncLock(calSyncController.sync));

module.exports = router;
