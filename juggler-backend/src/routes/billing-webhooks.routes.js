const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { handleWebhook } = require('../controllers/billing-webhooks.controller');

// Verify HMAC-SHA256 signature from payment service
function verifySignature(req, res, next) {
  var sig = req.headers['x-billing-signature'];
  var secret = process.env.BILLING_WEBHOOK_SECRET || process.env.INTERNAL_SERVICE_KEY;

  // In development without a secret configured, allow unsigned webhooks
  if (!secret) {
    console.warn('[billing-webhook] No BILLING_WEBHOOK_SECRET configured — skipping signature verification');
    return next();
  }

  if (!sig) {
    return res.status(401).json({ error: 'Missing X-Billing-Signature header' });
  }

  var expectedSig = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    var sigBuf = Buffer.from(sig);
    var expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch {
    return res.status(401).json({ error: 'Invalid signature format' });
  }

  next();
}

router.post('/', verifySignature, handleWebhook);

module.exports = router;
