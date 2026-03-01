const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.use(authenticateJWT);

router.get('/', configController.getLocations);
router.put('/', configController.replaceLocations);

module.exports = router;
