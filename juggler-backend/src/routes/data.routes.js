const express = require('express');
const router = express.Router();
const dataController = require('../controllers/data.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.use(authenticateJWT);

router.post('/import', dataController.importData);
router.get('/export', dataController.exportData);

module.exports = router;
