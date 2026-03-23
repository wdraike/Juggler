/**
 * Plan Features Middleware for StriveRS
 *
 * Resolves the user's subscription plan into a features object.
 * Fetches plan catalog from payment service (cached 5 min).
 * Fetches user's actual plan from payment service internal API (cached 2 min)
 * so it stays accurate even when the JWT is stale.
 */

const PRODUCT_SLUG = 'juggler';
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const USER_PLAN_CACHE_TTL_MS = 2 * 60 * 1000;

// ─── Plan catalog cache (all plans + features) ─────────────────────────
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
  if (_planFeaturesCache && (now - _cacheTimestamp) < CATALOG_CACHE_TTL_MS) {
    return _planFeaturesCache;
  }

  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = fetchPlanFeatures().then(cache => {
    _planFeaturesCache = cache;
    _cacheTimestamp = Date.now();
    _fetchPromise = null;
    return cache;
  }).catch(err => {
    _fetchPromise = null;
    console.error('[plan-features] Failed to fetch from payment service:', err.message);
    if (_planFeaturesCache) return _planFeaturesCache;
    throw err;
  });

  return _fetchPromise;
}

// ─── User plan cache (real-time from payment service) ──────────────────
const _userPlanCache = new Map();

async function getUserPlanSlug(userId) {
  const cached = _userPlanCache.get(userId);
  if (cached && (Date.now() - cached.timestamp) < USER_PLAN_CACHE_TTL_MS) {
    return cached.slug;
  }

  try {
    const { serviceRequest } = require('../../vendor/service-auth');
    const data = await serviceRequest('payment-service', `/internal/users/${userId}/active-plans`, { timeout: 3000 });
    const slug = data.plans?.[PRODUCT_SLUG] || null;
    _userPlanCache.set(userId, { slug, timestamp: Date.now() });
    return slug;
  } catch {
    return null;
  }
}

async function refreshPlanFeatures() {
  _cacheTimestamp = 0;
  return getCachedPlanFeatures();
}

function invalidateUserPlanCache(userId) {
  _userPlanCache.delete(userId);
}

// ─── Middleware ─────────────────────────────────────────────────────────
const resolvePlanFeatures = async (req, res, next) => {
  try {
    // Get the user's real plan from payment service (not from JWT)
    let planSlug = 'free';

    if (req.user?.id) {
      const realSlug = await getUserPlanSlug(req.user.id);
      if (realSlug) {
        planSlug = realSlug;
      } else {
        // Fallback: JWT claim (may be stale but better than nothing)
        planSlug = req.auth?.plans?.[PRODUCT_SLUG] || 'free';
      }
    }

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

module.exports = { resolvePlanFeatures, PRODUCT_SLUG, refreshPlanFeatures, invalidateUserPlanCache, getCachedPlanFeatures };
