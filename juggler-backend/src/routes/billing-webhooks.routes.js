const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { handleWebhook } = require('../controllers/billing-webhooks.controller');

// Verify HMAC-SHA256 signature from payment service + reject stale replays.
// NOTE: signs JSON.stringify(req.body) rather than the raw request body. This
// works because payment-service uses the same stringify on the sending side,
// but is fragile to any future divergence in key ordering or whitespace.
// TODO(security): move to raw-body verification when we next touch the mount
// point in app.js. See docs/security/AUDIT-FOLLOWUPS.md.
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
