/**
 * Microsoft Calendar sync routes
 */

var express = require('express');
var router = express.Router();
var msftCalController = require('../controllers/msft-cal.controller');
var { authenticateJWT } = require('../middleware/jwt-auth');

router.get('/status', authenticateJWT, msftCalController.getStatus);
router.get('/connect', authenticateJWT, msftCalController.connect);
router.get('/callback', msftCalController.callback); // No auth — browser redirect from Microsoft
router.post('/disconnect', authenticateJWT, msftCalController.disconnect);
router.post('/push', authenticateJWT, msftCalController.push);
router.post('/pull', authenticateJWT, msftCalController.pull);
router.post('/sync', authenticateJWT, msftCalController.sync);
router.post('/auto-sync', authenticateJWT, msftCalController.setAutoSync);

module.exports = router;
