/**
 * Plan Features Middleware for Juggler
 *
 * Resolves the user's subscription plan into a features object.
 * Reads plan slug from JWT, fetches features from payment-service,
 * attaches to req.planFeatures.
 */

const PRODUCT_SLUG = 'juggler';
const CACHE_TTL_MS = 5 * 60 * 1000;

// Updated 2026-03-22: Scheduling fully free, one calendar free, AI Pro+.
const FREE_PLAN_FEATURES = {
  ai: {
    natural_language_commands: false,
    bulk_project_creation: false
  },
  calendar: {
    max_providers: 1,
    unified_sync: false,
    auto_sync: false
  },
  scheduling: {
    priority_optimization: true,
    dependencies: true,
    travel_time: true,
    time_blocks: -1
  },
  tasks: {
    habits: true,
    rigid: true
  },
  data: {
    export: true,
    import: false,
    mcp_access: false
  }
};

let _planFeaturesCache = null;
let _cacheTimestamp = 0;

async function fetchPlanFeatures() {
  const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
  const response = await fetch(`${paymentUrl}/api/plans?product=${PRODUCT_SLUG}`, {
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
  try {
    _planFeaturesCache = await fetchPlanFeatures();
    _cacheTimestamp = now;
  } catch (err) {
    console.warn('[plan-features] Failed to fetch:', err.message);
    if (!_planFeaturesCache) _planFeaturesCache = {};
  }
  return _planFeaturesCache;
}

const resolvePlanFeatures = async (req, res, next) => {
  try {
    const planSlug = req.auth?.plans?.[PRODUCT_SLUG] || 'free';
    req.planSlug = planSlug;

    if (planSlug === 'free') {
      req.planFeatures = FREE_PLAN_FEATURES;
      return next();
    }

    const allFeatures = await getCachedPlanFeatures();
    req.planFeatures = allFeatures[planSlug] || FREE_PLAN_FEATURES;
    next();
  } catch (err) {
    console.error('[plan-features] Error:', err.message);
    req.planSlug = 'free';
    req.planFeatures = FREE_PLAN_FEATURES;
    next();
  }
};

module.exports = { resolvePlanFeatures, FREE_PLAN_FEATURES, PRODUCT_SLUG };
