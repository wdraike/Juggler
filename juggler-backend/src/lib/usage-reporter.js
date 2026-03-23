/**
 * Usage Reporter — batches usage events and sends to payment service
 *
 * Events are buffered in memory and flushed every 30 seconds or when
 * the buffer hits 50 events. Fire-and-forget — failures are logged
 * but never block the request.
 */

const PRODUCT_SLUG = 'juggler';
const FLUSH_INTERVAL = 30000;
const FLUSH_SIZE = 50;

const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY;

const buffer = [];
let flushTimer = null;

function reportUsage({ userId, planSlug, featureKey, eventType, quantity, inputTokens, outputTokens, endpoint }) {
  if (!INTERNAL_KEY) return;

  buffer.push({
    user_id: userId,
    plan_slug: planSlug || 'free',
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
    await fetch(`${PAYMENT_URL}/api/usage/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': INTERNAL_KEY
      },
      body: JSON.stringify({ product_slug: PRODUCT_SLUG, events }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (err) {
    console.warn(`[usage-reporter] Failed to flush ${events.length} events: ${err.message}`);
  }
}

if (!flushTimer) {
  flushTimer = setInterval(flush, FLUSH_INTERVAL);
  if (flushTimer.unref) flushTimer.unref();
}

process.on('beforeExit', flush);

module.exports = { reportUsage, flush };
