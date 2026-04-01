/**
 * Google Calendar routes — OAuth, status, and auto-sync settings.
 * Sync is handled by the unified /api/cal/sync endpoint (cal-sync.controller).
 */

const express = require('express');
const router = express.Router();
const gcalController = require('../controllers/gcal.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { checkCalendarLimit } = require('../middleware/calendar-limit');

router.get('/status', authenticateJWT, gcalController.getStatus);
router.get('/connect', authenticateJWT, resolvePlanFeatures, checkCalendarLimit('google'), gcalController.connect);
router.get('/callback', gcalController.callback); // No auth — browser redirect from Google
router.post('/disconnect', authenticateJWT, gcalController.disconnect);
router.post('/auto-sync', authenticateJWT, gcalController.setAutoSync);

module.exports = router;
