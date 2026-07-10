/**
 * Usage Reporter — batches usage events and sends to payment service
 *
 * Uses ServiceJWT authentication for service-to-service calls.
 * Falls back to X-Internal-Key if service-auth not initialized.
 */

// ponytail: PRODUCT_LABEL from service-identity (not plan-features.middleware)
// breaks the layering inversion (lib -> middleware). resolveProductId is injected
// by the facade (999.1194) so usage-reporter no longer reaches up into the middleware.
const { PRODUCT_LABEL } = require('../service-identity');
const { paymentFetch } = require('./payment-service-client');
const { libUsageReporterLogger } = require('./logger');
const config = require('./config');
const FLUSH_INTERVAL = 30000;
const FLUSH_SIZE = 50;

const buffer = [];
let flushTimer = null;
let _serviceAuthReady = false;

// Injected by the facade (src/slices/user-config/facade.js) — delegates to the
// singleton PaymentServiceEntitlementAdapter.resolveProductId. Falls back to
// requiring plan-features.middleware.getProductId for backward compat if no
// injector has run (so existing callers that don't wire the facade still work).
let _resolveProductId = null;
function getProductId() {
  if (_resolveProductId) return _resolveProductId();
  // ponytail: lazy require preserves backward compat — the facade injects the
  // adapter-based resolver, but a standalone require (no facade wiring) still works.
  try { return require('../middleware/plan-features.middleware').getProductId(); }
  catch { return Promise.resolve(null); }
}
function setProductIdResolver(fn) { _resolveProductId = fn; }

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
      const INTERNAL_KEY = config.getString('INTERNAL_SERVICE_KEY'); // 999.1473
      if (!INTERNAL_KEY) return;
      await paymentFetch('/api/usage/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': INTERNAL_KEY
        },
        body: JSON.stringify({ productId: await getProductId() || PRODUCT_LABEL, events })
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

module.exports = { reportUsage, flush, _stopForTests, setProductIdResolver };
