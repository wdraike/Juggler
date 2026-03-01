/**
 * Google Calendar sync routes
 */

const express = require('express');
const router = express.Router();
const gcalController = require('../controllers/gcal.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.get('/status', authenticateJWT, gcalController.getStatus);
router.get('/connect', authenticateJWT, gcalController.connect);
router.get('/callback', gcalController.callback); // No auth — browser redirect from Google
router.post('/disconnect', authenticateJWT, gcalController.disconnect);
router.post('/push', authenticateJWT, gcalController.push);
router.post('/pull', authenticateJWT, gcalController.pull);
router.post('/sync', authenticateJWT, gcalController.sync);
router.post('/auto-sync', authenticateJWT, gcalController.setAutoSync);

module.exports = router;
