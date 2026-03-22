/**
 * Plan Features Middleware for StriveRS
 *
 * Resolves the user's subscription plan into a features object.
 * Always fetches from the payment service — no hardcoded fallbacks.
 * Caches the full plan catalog for 5 minutes.
 */

const PRODUCT_SLUG = 'juggler';
const CACHE_TTL_MS = 5 * 60 * 1000;

let _planFeaturesCache = null;
let _cacheTimestamp = 0;
let _fetchPromise = null;

async function fetchPlanFeatures() {
  const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
  const response = await fetch(`${paymentUrl}/api/plans?product=${PRODUCT_SLUG}&include_all=true`, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) throw new Error(`Payment service returned ${response.status}`);

  const data = await response.json();
  const cache = {};
  for (const plan of data.plans || []) {
    if (plan.features) {
      cache[plan.slug] = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
    }
  }
  return cache;
}

async function getCachedPlanFeatures() {
  const now = Date.now();
  if (_planFeaturesCache && (now - _cacheTimestamp) < CACHE_TTL_MS) {
    return _planFeaturesCache;
  }

  // Deduplicate concurrent fetches
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = fetchPlanFeatures().then(cache => {
    _planFeaturesCache = cache;
    _cacheTimestamp = Date.now();
    _fetchPromise = null;
    return cache;
  }).catch(err => {
    _fetchPromise = null;
    console.error('[plan-features] Failed to fetch from payment service:', err.message);
    // Return stale cache if available, otherwise throw
    if (_planFeaturesCache) return _planFeaturesCache;
    throw err;
  });

  return _fetchPromise;
}

// Force refresh — called on app startup and can be called externally
async function refreshPlanFeatures() {
  _cacheTimestamp = 0;
  return getCachedPlanFeatures();
}

const resolvePlanFeatures = async (req, res, next) => {
  try {
    const planSlug = req.auth?.plans?.[PRODUCT_SLUG] || 'free';
    req.planSlug = planSlug;

    const allFeatures = await getCachedPlanFeatures();
    req.planFeatures = allFeatures[planSlug];

    if (!req.planFeatures) {
      console.warn(`[plan-features] No features found for plan "${planSlug}", falling back to "free"`);
      req.planFeatures = allFeatures['free'];
      req.planSlug = 'free';
    }

    if (!req.planFeatures) {
      return res.status(503).json({ error: 'Plan configuration unavailable. Please try again.' });
    }

    next();
  } catch (err) {
    console.error('[plan-features] Error:', err.message);
    return res.status(503).json({ error: 'Payment service unavailable. Please try again.' });
  }
};

module.exports = { resolvePlanFeatures, PRODUCT_SLUG, refreshPlanFeatures, getCachedPlanFeatures };
