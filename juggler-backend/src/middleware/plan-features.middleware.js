/**
 * Plan Features Middleware for StriveRS
 *
 * Resolves the user's subscription plan into a features object.
 * Fetches plan catalog from payment service (cached 5 min).
 * Fetches user's actual plan from payment service internal API (cached 2 min)
 * so it stays accurate even when the JWT is stale.
 */

const PRODUCT_ID = 'juggler';
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const USER_PLAN_CACHE_TTL_MS = 2 * 60 * 1000;

// ─── Plan catalog cache (all plans + features) ─────────────────────────
let _planFeaturesCache = null;
let _cacheTimestamp = 0;
let _fetchPromise = null;

async function fetchPlanFeatures() {
  const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
  const response = await fetch(`${paymentUrl}/api/plans?product=${PRODUCT_ID}&include_all=true`, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) throw new Error(`Payment service returned ${response.status}`);

  const data = await response.json();
  const cache = {};
  for (const plan of data.plans || []) {
    if (plan.features) {
      cache[plan.planId] = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;
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

async function getUserPlanId(userId) {
  const cached = _userPlanCache.get(userId);
  if (cached && (Date.now() - cached.timestamp) < USER_PLAN_CACHE_TTL_MS) {
    return cached.planId;
  }

  try {
    const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
    const internalKey = process.env.INTERNAL_SERVICE_KEY || '';
    const res = await fetch(`${paymentUrl}/internal/users/${userId}/active-plans`, {
      headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) throw new Error(`Payment service returned ${res.status}`);
    const data = await res.json();
    const planId = data.plans?.[PRODUCT_ID] || null;
    if (planId) {
      _userPlanCache.set(userId, { planId, timestamp: Date.now() });
    } else {
      _userPlanCache.delete(userId);
    }
    return planId;
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
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const paymentUserId = req.user.authServiceId || req.user.id;
    const realPlanId = await getUserPlanId(paymentUserId);

    if (!realPlanId) {
      return res.status(402).json({
        error: 'Subscription required',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'You need an active subscription to use this app. Choose a plan to get started.',
        plans_url: `${process.env.BILLING_FRONTEND_URL || 'http://localhost:3003'}/plans`,
      });
    }

    req.planId = realPlanId;

    const allFeatures = await getCachedPlanFeatures();
    req.planFeatures = allFeatures[realPlanId];

    if (!req.planFeatures) {
      console.warn(`[plan-features] No features found for plan "${realPlanId}", falling back to "free"`);
      req.planFeatures = allFeatures['free'];
      req.planId = 'free';
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

module.exports = { resolvePlanFeatures, PRODUCT_ID, refreshPlanFeatures, invalidateUserPlanCache, getCachedPlanFeatures };
