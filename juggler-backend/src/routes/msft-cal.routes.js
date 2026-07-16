/**
 * Microsoft Calendar routes — OAuth, status, and auto-sync settings.
 * Sync is handled by the unified /api/cal/sync endpoint (cal-sync.controller).
 */

var express = require('express');
var router = express.Router();
var msftCalController = require('../controllers/msft-cal.controller');
var { authenticateJWT } = require('../middleware/jwt-auth');
var { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
var { checkCalendarLimit } = require('../middleware/calendar-limit');

router.get('/status', authenticateJWT, msftCalController.getStatus);
router.get('/connect', authenticateJWT, resolvePlanFeatures, checkCalendarLimit('microsoft'), msftCalController.connect);
router.get('/callback', msftCalController.callback); // No auth — browser redirect from Microsoft
router.post('/disconnect', authenticateJWT, msftCalController.disconnect);
router.post('/auto-sync', authenticateJWT, msftCalController.setAutoSync);

// 999.1977: per-calendar selection — mirrors gcal.routes.js's
// calendars/refresh-calendars/calendars/:id trio (999.1626).
router.get('/calendars', authenticateJWT, msftCalController.getCalendars);
router.get('/refresh-calendars', authenticateJWT, msftCalController.refreshCalendars);
router.put('/calendars/:id', authenticateJWT, msftCalController.updateCalendar);

module.exports = router;
