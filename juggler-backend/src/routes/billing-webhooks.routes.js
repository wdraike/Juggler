const express = require('express');
const router = express.Router();
const { authenticateService } = require('../../vendor/service-auth');
const { handleWebhook } = require('../controllers/billing-webhooks.controller');

router.post('/', authenticateService(), handleWebhook);

module.exports = router;
