const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { handleWebhook } = require('../controllers/billing-webhooks.controller');

// Verify HMAC-SHA256 signature from payment service + reject stale replays.
// Signs req.rawBody (the original wire bytes captured by express.raw() in app.js),
// falling back to re-serialized JSON only if rawBody is unavailable. This matches
// what payment-service signs on the sending side.
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
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

  var rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
  var expectedSig = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
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

  // Replay protection: payment-service puts a `timestamp` in the signed body
  // (notification.service.js:59). Reject anything outside the freshness window.
  if (req.body && typeof req.body.timestamp === 'string') {
    var ts = Date.parse(req.body.timestamp);
    if (!Number.isNaN(ts) && Math.abs(Date.now() - ts) > FRESHNESS_WINDOW_MS) {
      return res.status(401).json({ error: 'Webhook timestamp outside freshness window' });
    }
  }

  next();
}

router.post('/', verifySignature, handleWebhook);

module.exports = router;
