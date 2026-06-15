const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { handleWebhook } = require('../controllers/billing-webhooks.controller');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('billing-webhooks.routes');

// Verify HMAC-SHA256 signature from payment service + reject stale replays.
// Signs req.rawBody (the original wire bytes captured by express.raw() in app.js).
// If rawBody is absent, the middleware in app.js failed — reject immediately.
// This matches what payment-service signs on the sending side.
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
function verifySignature(req, res, next) {
  const sig = req.headers['x-billing-signature'];
  const secret = process.env.BILLING_WEBHOOK_SECRET || process.env.INTERNAL_SERVICE_KEY;

  if (!secret) {
    logger.error('[billing-webhook] No BILLING_WEBHOOK_SECRET or INTERNAL_SERVICE_KEY configured — cannot verify webhooks');
    return res.status(500).json({ error: 'Webhook signature verification not configured' });
  }

  if (!sig) {
    return res.status(401).json({ error: 'Missing X-Billing-Signature header' });
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    return res.status(500).json({ error: 'Internal: rawBody unavailable' });
  }
  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Hash both sides to equal length so timingSafeEqual gets no length side-channel.
  try {
    const sigHash = crypto.createHash('sha256').update(Buffer.from(sig)).digest();
    const expectedHash = crypto.createHash('sha256').update(Buffer.from(expectedSig)).digest();
    if (!crypto.timingSafeEqual(sigHash, expectedHash)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch {
    return res.status(401).json({ error: 'Invalid signature format' });
  }

  // Replay protection (jug-webhook-replay-window-hardfail / 999.552):
  // payment-service ALWAYS signs a `timestamp` into the body (notification.service.js:59),
  // so a missing/unparseable timestamp on a validly-signed body means either a replay of a
  // pre-timestamp message or a tampered payload — there is no legitimate timestamp-less
  // webhook. The window check is therefore MANDATORY and hard-fails: previously a webhook
  // with no (or a non-string/unparseable) timestamp silently bypassed replay protection and
  // was accepted.
  const tsRaw = req.body && req.body.timestamp;
  const ts = typeof tsRaw === 'string' ? Date.parse(tsRaw) : NaN;
  if (Number.isNaN(ts)) {
    return res.status(401).json({ error: 'Webhook timestamp missing or invalid' });
  }
  if (Math.abs(Date.now() - ts) > FRESHNESS_WINDOW_MS) {
    return res.status(401).json({ error: 'Webhook timestamp outside freshness window' });
  }

  next();
}

router.post('/', verifySignature, handleWebhook);

module.exports = router;
