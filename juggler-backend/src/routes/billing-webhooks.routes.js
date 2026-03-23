const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/billing-webhooks.controller');

router.post('/', handleWebhook);

module.exports = router;
