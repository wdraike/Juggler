const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.use(authenticateJWT);

router.get('/', configController.getTools);
router.put('/', configController.replaceTools);

module.exports = router;
