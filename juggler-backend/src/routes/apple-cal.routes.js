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
  appleCalSelectSchema,
  appleCalSelectCalendarsSchema,
  appleCalAutoSyncSchema,
} = require('../schemas/route-schemas');

router.get('/status', authenticateJWT, appleCalController.getStatus);
router.post('/connect', authenticateJWT, validate(appleCalConnectSchema), appleCalController.connect);
router.post('/select-calendar', authenticateJWT, validate(appleCalSelectSchema), appleCalController.selectCalendar);
router.post('/select-calendars', authenticateJWT, validate(appleCalSelectCalendarsSchema), appleCalController.selectCalendars);
router.get('/calendars', authenticateJWT, appleCalController.getCalendars);
router.get('/refresh-calendars', authenticateJWT, appleCalController.refreshCalendars);
router.put('/calendars/:id', authenticateJWT, appleCalController.updateCalendar);
router.post('/disconnect', authenticateJWT, appleCalController.disconnect);
router.post('/auto-sync', authenticateJWT, validate(appleCalAutoSyncSchema), appleCalController.setAutoSync);

module.exports = router;
