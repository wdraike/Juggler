/**
 * Usage Reporter — batches usage events and sends to payment service
 *
 * Uses ServiceJWT authentication for service-to-service calls.
 * Falls back to X-Internal-Key if service-auth not initialized.
 */

const { getProductId, PRODUCT_LABEL } = require('../middleware/plan-features.middleware');
const { libUsageReporterLogger } = require('./logger');
const FLUSH_INTERVAL = 30000;
const FLUSH_SIZE = 50;

const buffer = [];
let flushTimer = null;
let _serviceAuthReady = false;

try {
const { initServiceAuth } = require('../../vendor/service-auth');
initServiceAuth({ serviceName: PRODUCT_LABEL }).then(() => {
  _serviceAuthReady = true;
}).catch(err => {
  if (libUsageReporterLogger) libUsageReporterLogger.warn('Service auth init failed, using legacy key', { error: err });
});
} catch { /* service-auth not available */ }

function reportUsage({ userId, planId, featureKey, eventType, quantity, inputTokens, outputTokens, endpoint }) {
  buffer.push({
    user_id: userId,
    planId: planId || 'free',
    feature_key: featureKey,
    event_type: eventType || 'used',
    quantity: quantity || 1,
    input_tokens: inputTokens || null,
    output_tokens: outputTokens || null,
    endpoint: endpoint || null,
    timestamp: new Date().toISOString()
  });

  if (buffer.length >= FLUSH_SIZE) {
    flush();
  }
}

async function flush() {
  if (buffer.length === 0) return;

  const events = buffer.splice(0);

  try {
    if (_serviceAuthReady) {
      const { serviceRequest } = require('../../vendor/service-auth');
      await serviceRequest('payment-service', '/api/usage/report', {
        method: 'POST',
        body: { productId: await getProductId() || PRODUCT_LABEL, events }
      });
    } else {
      const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
      const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY;
      if (!INTERNAL_KEY) return;
      await fetch(`${PAYMENT_URL}/api/usage/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': INTERNAL_KEY
        },
        body: JSON.stringify({ productId: await getProductId() || PRODUCT_LABEL, events }),
        signal: AbortSignal.timeout(30000)
      });
    }
  } catch (err) {
    if (libUsageReporterLogger) libUsageReporterLogger.warn('Failed to flush events', { eventCount: events.length, error: err });
  }
}

if (!flushTimer) {
  flushTimer = setInterval(flush, FLUSH_INTERVAL);
  if (flushTimer.unref) flushTimer.unref();
}

process.on('beforeExit', flush);

// Test-isolation seam: stop the background flush interval + detach the
// beforeExit listener so a stray flush() can't fire after a jest suite tears
// down (the logger binding would be gone → "Cannot read 'warn' of undefined"
// crashing the run). No-op-safe; production never calls this.
function _stopForTests() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  try { process.removeListener('beforeExit', flush); } catch (e) { /* no-op */ }
}

module.exports = { reportUsage, flush, _stopForTests };
