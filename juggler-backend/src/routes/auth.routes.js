const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateJWT, validateRefreshToken } = require('../middleware/jwt-auth');

router.post('/google', authController.googleLogin);
router.post('/refresh', validateRefreshToken, authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticateJWT, authController.getMe);

module.exports = router;
