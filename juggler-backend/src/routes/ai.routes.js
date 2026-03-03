const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.use(authenticateJWT);

router.post('/command', aiController.handleCommand);

module.exports = router;
