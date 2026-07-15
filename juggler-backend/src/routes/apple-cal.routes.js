/**
 * Apple Calendar routes — CalDAV connection and management.
 * No OAuth flow — uses app-specific password auth.
 */

var express = require('express');
var router = express.Router();
var appleCalController = require('../controllers/apple-cal.controller');
var { authenticateJWT } = require('../middleware/jwt-auth');
var { validate } = require('../middleware/validate');
var {
  appleCalConnectSchema,
  appleCalSelectCalendarsSchema,
  appleCalAutoSyncSchema,
} = require('../schemas/route-schemas');

router.get('/status', authenticateJWT, appleCalController.getStatus);
router.post('/connect', authenticateJWT, validate(appleCalConnectSchema), appleCalController.connect);
// 999.1241: deprecated singular /select-calendar removed — FE only calls
// plural /select-calendars (CalSyncPanel). The singular route's controller
// is retained for reference but no longer wired.
router.post('/select-calendars', authenticateJWT, validate(appleCalSelectCalendarsSchema), appleCalController.selectCalendars);
router.get('/calendars', authenticateJWT, appleCalController.getCalendars);
router.get('/refresh-calendars', authenticateJWT, appleCalController.refreshCalendars);
router.put('/calendars/:id', authenticateJWT, appleCalController.updateCalendar);
router.post('/disconnect', authenticateJWT, appleCalController.disconnect);
router.post('/auto-sync', authenticateJWT, validate(appleCalAutoSyncSchema), appleCalController.setAutoSync);

module.exports = router;
