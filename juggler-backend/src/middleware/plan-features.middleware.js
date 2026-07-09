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

const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('plan-features');

const { PRODUCT_LABEL } = require('../service-identity');
const { paymentFetch, paymentUrl } = require('../lib/payment-service-client');
const _proxyConfig = require('../proxy-config');
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const USER_PLAN_CACHE_TTL_MS = 2 * 60 * 1000;

// ─── Product UUID discovery ─────────────────────────────────────────────
let _productId = null; // Resolved UUID
let _productDiscoveryPromise = null;

async function getProductId() {
  if (_productId) return _productId;
  if (_productDiscoveryPromise) return _productDiscoveryPromise;

  const internalKey = process.env.INTERNAL_SERVICE_KEY || '';
  _productDiscoveryPromise = (async () => {
    try {
      const res = await paymentFetch(`/internal/products/${PRODUCT_LABEL}`, {
        headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(`Product discovery failed (${res.status})`);
      const data = await res.json();
      _productId = data.product.id;
      logger.info(`[plan-features] Product "${PRODUCT_LABEL}" -> ${_productId}`);
      return _productId;
    } catch (err) {
      _productDiscoveryPromise = null;
      logger.error(`[plan-features] Product discovery failed:`, { error: err });
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
  const productId = await getProductId();
  const filter = productId ? `?product=${productId}` : `?product=${PRODUCT_LABEL}`;
  const internalKey = process.env.INTERNAL_SERVICE_KEY || '';
  const response = await paymentFetch(`/api/plans${filter}&include_all=true`, {
    headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' }
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
    logger.error('[plan-features] Failed to fetch from payment service:', { error: err });
    if (_planFeaturesCache) return _planFeaturesCache;
    throw err;
  });

  return _fetchPromise;
}

// Force refresh — called externally when plan changes
async function refreshPlanFeatures() {
  _cacheTimestamp = 0;
  return getCachedPlanFeatures();
}

// ─── Login reconciliation: enforce limits on stale plan changes ───────
// Runs at most once per user plan cache refresh (2 min) to catch missed webhooks.
//
// _reconciliationPending is the SINGLE-INSTANCE dedupe guard (a per-user "last ran
// at" map). Under Cloud Run scale-out (>1 instance) this map is per-instance, so two
// instances could each run enforceDowngradeLimits for the same user in the same
// window — wasteful and racy. When REDIS_URL is set we add a cross-instance SETNX
// lock (acquireLock) so only ONE instance reconciles per debounce window; the local
// map is still consulted first (fast path) and remains the sole guard when Redis is
// absent or down (fail-soft — a Redis outage falls back to the local guard, never
// crashes the request). (999.385)
const _reconciliationPending = new Map();
const _redis = require('../lib/redis');
const RECONCILE_LOCK_TTL_SECONDS = Math.ceil(USER_PLAN_CACHE_TTL_MS / 1000); // matches the debounce window

async function reconcileLimitsIfNeeded(userId, planFeatures) {
  const now = Date.now();
  const last = _reconciliationPending.get(userId);
  if (last && (now - last) < USER_PLAN_CACHE_TTL_MS) return; // local debounce
  _reconciliationPending.set(userId, now);

  // Cross-instance dedupe: when Redis is connected, only the instance that wins the
  // SETNX lock proceeds. acquireLock returns false (→ skip) if another instance holds
  // it. When Redis is absent/down it ALSO returns false — so we must NOT treat false as
  // "another instance won" unconditionally; instead, only gate on the lock when Redis is
  // actually connected. If Redis is unavailable we rely solely on the local map above.
  if (_redis.isConnected && _redis.isConnected()) {
    let lockErrored = false;
    let gotLock = false;
    try {
      gotLock = await _redis.acquireLock('entitlement:reconcile:' + userId, RECONCILE_LOCK_TTL_SECONDS);
    } catch {
      lockErrored = true; // fail-soft: a lock error degrades to local-only dedupe
    }
    // Redis was connected and the lock call succeeded but DIDN'T grant the lock →
    // another instance is reconciling this user → skip. If the lock call errored we
    // fall through and rely on the local map (this instance passed the local debounce).
    if (!lockErrored && !gotLock) return;
  }

  // Run async — don't block the request
  setImmediate(async () => {
    try {
      // Task-domain logic (999.994) — task slice facade, not the legacy controller.
      const { enforceDowngradeLimits } = require('../slices/task/facade');
      await enforceDowngradeLimits(userId, planFeatures);
    } catch (err) {
      logger.error('[plan-features] Reconciliation failed for user', { userId, error: err });
    }
  });
}

// ─── Middleware ─────────────────────────────────────────────────────────
const resolvePlanFeatures = async (req, res, next) => {
  try {
    const { checkEntitlement } = require('../slices/user-config/facade');  // LAZY require inside the fn (avoids the facade→plan-features↔plan-features→facade module-load cycle)
    const result = await checkEntitlement({ user: req.user });
    if (result.status === 200) {
      req.planId = result.entitlement.planId;
      req.planFeatures = result.entitlement.planFeatures;
      return next();
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('[plan-features] Error:', { error: err });
    return res.status(503).json({ error: 'Payment service unavailable. Please try again.' });
  }
};

module.exports = { resolvePlanFeatures, PRODUCT_LABEL, getProductId, refreshPlanFeatures, getCachedPlanFeatures, reconcileLimitsIfNeeded };
