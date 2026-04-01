/**
 * Plan Features Middleware for StriveRS
 *
 * Resolves the user's subscription plan into a features object.
 * Fetches plan catalog from payment service (cached 5 min).
 * Fetches user's actual plan from payment service internal API (cached 2 min)
 * so it stays accurate even when the JWT is stale.
 *
 * Product identity: uses the product UUID as the canonical ID.
 * UUID is discovered at startup via payment service and cached for the
 * lifetime of the process.
 */

const { PRODUCT_LABEL } = require('../service-identity');
const _proxyConfig = require('../proxy-config');
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const USER_PLAN_CACHE_TTL_MS = 2 * 60 * 1000;

// ─── Product UUID discovery ─────────────────────────────────────────────
let _productId = null; // Resolved UUID
let _productDiscoveryPromise = null;

async function getProductId() {
  if (_productId) return _productId;
  if (_productDiscoveryPromise) return _productDiscoveryPromise;

  _productDiscoveryPromise = (async () => {
    const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
    const internalKey = process.env.INTERNAL_SERVICE_KEY || '';
    try {
      const res = await fetch(`${paymentUrl}/internal/products/${PRODUCT_LABEL}`, {
        headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) throw new Error(`Product discovery failed (${res.status})`);
      const data = await res.json();
      _productId = data.product.id;
      console.log(`[plan-features] Product "${PRODUCT_LABEL}" → ${_productId}`);
      return _productId;
    } catch (err) {
      _productDiscoveryPromise = null;
      console.error(`[plan-features] Product discovery failed:`, err.message);
      return null;
    }
  })();

  return _productDiscoveryPromise;
}

// ─── Plan catalog cache (all plans + features) ─────────────────────────
let _planFeaturesCache = null;
let _cacheTimestamp = 0;
let _fetchPromise = null;

async function fetchPlanFeatures() {
  const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
  const productId = await getProductId();
  const filter = productId ? `?product=${productId}` : `?product=${PRODUCT_LABEL}`;
  const response = await fetch(`${paymentUrl}/api/plans${filter}&include_all=true`, {
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
    const productId = await getProductId();
    const planId = data.plans?.[productId] || null;
    // Only cache when user has an active plan — don't cache null so that
    // a user who just subscribed isn't blocked by stale cache
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

// Force refresh — called externally when plan changes
async function refreshPlanFeatures() {
  _cacheTimestamp = 0;
  return getCachedPlanFeatures();
}

function invalidateUserPlanCache(userId) {
  _userPlanCache.delete(userId);
}

// ─── Login reconciliation: enforce limits on stale plan changes ───────
// Runs at most once per user plan cache refresh (2 min) to catch missed webhooks.
const _reconciliationPending = new Map();

async function reconcileLimitsIfNeeded(userId, planFeatures) {
  const now = Date.now();
  const last = _reconciliationPending.get(userId);
  if (last && (now - last) < USER_PLAN_CACHE_TTL_MS) return; // debounce
  _reconciliationPending.set(userId, now);

  // Run async — don't block the request
  setImmediate(async () => {
    try {
      const { enforceDowngradeLimits } = require('../controllers/billing-webhooks.controller');
      await enforceDowngradeLimits(userId, planFeatures);
    } catch (err) {
      console.error('[plan-features] Reconciliation failed for user', userId, ':', err.message);
    }
  });
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
        plans_url: `${_proxyConfig.services.billing.frontend}/plans`,
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

    // Background reconciliation: verify user isn't over limits (catches missed webhooks)
    reconcileLimitsIfNeeded(req.user.id, req.planFeatures);

    next();
  } catch (err) {
    console.error('[plan-features] Error:', err.message);
    return res.status(503).json({ error: 'Payment service unavailable. Please try again.' });
  }
};

module.exports = { resolvePlanFeatures, PRODUCT_LABEL, getProductId, refreshPlanFeatures, invalidateUserPlanCache, getCachedPlanFeatures };
