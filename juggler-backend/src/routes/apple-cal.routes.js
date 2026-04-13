/**
 * Apple Calendar routes — CalDAV connection and management.
 * No OAuth flow — uses app-specific password auth.
 */

var express = require('express');
var router = express.Router();
var appleCalController = require('../controllers/apple-cal.controller');
var { authenticateJWT } = require('../middleware/jwt-auth');

router.get('/status', authenticateJWT, appleCalController.getStatus);
router.post('/connect', authenticateJWT, appleCalController.connect);
router.post('/select-calendar', authenticateJWT, appleCalController.selectCalendar);
router.post('/disconnect', authenticateJWT, appleCalController.disconnect);
router.post('/auto-sync', authenticateJWT, appleCalController.setAutoSync);

module.exports = router;
