const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/billing-webhooks.controller');

// Billing webhooks use signature-based auth from payment service, not ServiceJWT.
// TODO: Verify X-Billing-Signature in production.
router.post('/', handleWebhook);

module.exports = router;
