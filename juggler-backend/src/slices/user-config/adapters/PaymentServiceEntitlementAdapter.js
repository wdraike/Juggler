/**
 * PaymentServiceEntitlementAdapter — EntitlementPort implementation over the
 * payment-service, absorbing the cross-service I/O currently inline in
 * `src/middleware/plan-features.middleware.js` (Phase H4 / W4 — the SECURITY seam).
 *
 * ABSORBS (byte-identical to legacy):
 *   resolveProductId    ⇔ getProductId           (plan-features.middleware.js:26-51)
 *                          slug→UUID startup discovery via /internal/products/juggler,
 *                          cached for the process lifetime; in-flight dedup promise;
 *                          null on failure (fail-soft); discovery-promise reset on error.
 *   resolvePlanCatalog  ⇔ getCachedPlanFeatures   (plan-features.middleware.js:79-100)
 *                          5min TTL; _fetchPromise in-flight dedup; on refetch error
 *                          return last cache if present else throw.
 *   _fetchPlanCatalog   ⇔ fetchPlanFeatures       (plan-features.middleware.js:58-77)
 *                          /api/plans?product=<UUID|slug>&include_all=true; build the
 *                          { planId → features } map (delegates to the W2 pure
 *                          extractCatalogFeatures).
 *   resolveUserPlanId   ⇔ getUserPlanId           (plan-features.middleware.js:105-134)
 *                          2min TTL; SLUG-keyed lookup data.plans?.['juggler'] (the W2
 *                          pure resolvePlanIdBySlug); only cache a truthy planId
 *                          (no-cache-on-null); null on any error (fail-soft).
 *   invalidateUserPlan  ⇔ invalidateUserPlanCache (plan-features.middleware.js:142-144)
 *
 * ── SLUG-KEYING (BINDING — INVARIANT EP-1) ───────────────────────────────────
 * The user plan is resolved by the product SLUG key (`'juggler'`, PRODUCT_LABEL),
 * NEVER a product UUID. The slug is coerced through `PlanSlug` (rejects UUID), and
 * `resolveUserPlanId` delegates the lookup to the pure `resolvePlanIdBySlug` which
 * coerces the key through PlanSlug again — a UUID can never become a plan key. The
 * product UUID from `resolveProductId` is used ONLY as the `?product=` catalog
 * FILTER. The constructor ASSERTS the configured slug is not UUID-shaped.
 *
 * ── PAYMENT_SERVICE_URL (pre-existing approved fallback — PRESERVED VERBATIM) ─
 * `process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020'` is reproduced
 * byte-identically (golden-master H13: appears for getProductId, fetchPlanFeatures,
 * getUserPlanId). This is the pre-existing, characterized fallback — NOT a new
 * one. `INTERNAL_SERVICE_KEY || ''` is likewise preserved verbatim. PRODUCT_LABEL
 * (the slug) is read via lib-config (through service-identity, H2). No NEW `||`/`??`
 * fallback is introduced.
 *
 * ── CACHE STATE (instance-scoped) ────────────────────────────────────────────
 * The legacy module-global caches become per-instance fields. One adapter instance
 * == one process's cache — behavior-identical to the legacy singleton, and
 * testable (a fresh adapter == a fresh process). The facade (W6) constructs ONE
 * instance, preserving the singleton semantics end-to-end.
 *
 * @implements {import('../domain/ports/EntitlementPort')}
 */

'use strict';

var EntitlementPort = require('../domain/ports/EntitlementPort');
var PlanSlug = require('../domain/value-objects/PlanSlug');
var Entitlement = require('../domain/entities/Entitlement');
var entitlementLogic = require('../domain/logic/entitlement');

var CATALOG_CACHE_TTL_MS = EntitlementPort.CATALOG_CACHE_TTL_MS;     // 5 * 60 * 1000
var USER_PLAN_CACHE_TTL_MS = EntitlementPort.USER_PLAN_CACHE_TTL_MS; // 2 * 60 * 1000

/**
 * @constructor
 * @param {object} [deps]
 * @param {string} [deps.productSlug]  the product slug (PRODUCT_LABEL). Defaults to
 *   the lib-config-resolved `service-identity.PRODUCT_LABEL` (slug 'juggler', H2) —
 *   an explicit default through the typed config front door, NOT a `||` data
 *   fallback. Coerced through PlanSlug (rejects UUID — slug-keying assertion).
 * @param {object} [deps.logger]  a logger exposing info/warn/error. Defaults to the
 *   shared lib-logger 'plan-features' channel — explicit default, not a `||`
 *   substitution. Injectable for tests.
 * @param {Function} [deps.fetchImpl]  the fetch implementation. Defaults to the
 *   global `fetch` AT CALL TIME (read lazily so a test mocking `global.fetch`
 *   after construction is honored) — explicit, not a silent fallback.
 */
function PaymentServiceEntitlementAdapter(deps) {
  var d = deps || {};

  // Slug identity — via lib-config (service-identity → config.getString), H2.
  // PlanSlug.from REJECTS a UUID — the slug-keying assertion (INVARIANT EP-1).
  var slugInput = d.productSlug === undefined
    ? require('../../../service-identity').PRODUCT_LABEL
    : d.productSlug;
  this._productSlug = PlanSlug.from(slugInput); // throws if UUID-shaped
  // Belt-and-braces assertion: never a UUID key (slug-keying invariant).
  if (PlanSlug.isUuidShaped(this._productSlug.value)) {
    throw new Error(
      'PaymentServiceEntitlementAdapter: product slug must NOT be a UUID ' +
      '(slug-keying invariant), got: ' + JSON.stringify(this._productSlug.value)
    );
  }

  this._logger = d.logger === undefined
    ? require('@raike/lib-logger').createLogger('plan-features')
    : d.logger;

  // Lazy fetch resolution: read global.fetch at call time (so tests that set
  // global.fetch after constructing the adapter are honored). Explicit injection
  // overrides. NOT a `||` data fallback.
  this._fetchImpl = d.fetchImpl;

  // ── Product UUID discovery state (legacy module-globals → instance fields) ──
  this._productId = null;
  this._productDiscoveryPromise = null;

  // ── Plan catalog cache state ──
  this._planFeaturesCache = null;
  this._cacheTimestamp = 0;
  this._fetchPromise = null;

  // ── User plan cache state ──
  this._userPlanCache = new Map();
}

PaymentServiceEntitlementAdapter.prototype = Object.create(EntitlementPort.prototype);
PaymentServiceEntitlementAdapter.prototype.constructor = PaymentServiceEntitlementAdapter;

/** @returns {string} the slug string ('juggler'). */
PaymentServiceEntitlementAdapter.prototype._slug = function _slug() {
  return this._productSlug.value;
};

/**
 * Resolve the fetch impl at CALL time. Injected impl wins; else global fetch.
 * Throws loudly if neither exists (fail-loud, not a silent no-op).
 * @returns {Function}
 */
PaymentServiceEntitlementAdapter.prototype._fetch = function _fetch() {
  var f = this._fetchImpl !== undefined ? this._fetchImpl : global.fetch;
  if (typeof f !== 'function') {
    throw new Error('PaymentServiceEntitlementAdapter: no fetch implementation available');
  }
  return f;
};

/**
 * Slug→UUID product discovery — verbatim from getProductId
 * (plan-features.middleware.js:26-51). Cached for the process (instance) lifetime;
 * in-flight dedup; null on failure; discovery-promise reset so a later call retries.
 * The UUID is the catalog `?product=` FILTER only — never a plan key.
 * @returns {Promise<?string>}
 */
PaymentServiceEntitlementAdapter.prototype.resolveProductId = function resolveProductId() {
  var self = this;
  if (self._productId) return Promise.resolve(self._productId);
  if (self._productDiscoveryPromise) return self._productDiscoveryPromise;

  var PRODUCT_LABEL = self._slug();

  self._productDiscoveryPromise = (async function () {
    var paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
    var internalKey = process.env.INTERNAL_SERVICE_KEY || '';
    try {
      var res = await self._fetch()(paymentUrl + '/internal/products/' + PRODUCT_LABEL, {
        headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error('Product discovery failed (' + res.status + ')');
      var data = await res.json();
      self._productId = data.product.id;
      self._logger.info('[plan-features] Product "' + PRODUCT_LABEL + '" -> ' + self._productId);
      return self._productId;
    } catch (err) {
      self._productDiscoveryPromise = null;
      self._logger.error('[plan-features] Product discovery failed:', { error: err });
      return null;
    }
  })();

  return self._productDiscoveryPromise;
};

/**
 * Plan catalog fetch — verbatim from fetchPlanFeatures
 * (plan-features.middleware.js:58-77). Filters by the resolved UUID, falling back
 * to the SLUG label as the `?product=` filter when discovery returned null. The
 * { planId → features } map is built by the W2 pure extractCatalogFeatures.
 * @returns {Promise<Object<string, Object>>}
 */
PaymentServiceEntitlementAdapter.prototype._fetchPlanCatalog = async function _fetchPlanCatalog() {
  var paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
  var productId = await this.resolveProductId();
  var PRODUCT_LABEL = this._slug();
  var filter = productId ? '?product=' + productId : '?product=' + PRODUCT_LABEL;
  var response = await this._fetch()(paymentUrl + '/api/plans' + filter + '&include_all=true', {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) throw new Error('Payment service returned ' + response.status);

  var data = await response.json();
  // Pure map build (W2) — byte-identical to the legacy inline loop.
  return entitlementLogic.extractCatalogFeatures(data.plans || []);
};

/**
 * Cached plan catalog — verbatim from getCachedPlanFeatures
 * (plan-features.middleware.js:79-100). 5min TTL; in-flight _fetchPromise dedup;
 * on refetch error return last cache if present, else throw.
 * @returns {Promise<Object<string, Object>>}
 */
PaymentServiceEntitlementAdapter.prototype.resolvePlanCatalog = function resolvePlanCatalog() {
  var self = this;
  var now = Date.now();
  if (self._planFeaturesCache && (now - self._cacheTimestamp) < CATALOG_CACHE_TTL_MS) {
    return Promise.resolve(self._planFeaturesCache);
  }

  if (self._fetchPromise) return self._fetchPromise;

  self._fetchPromise = self._fetchPlanCatalog().then(function (cache) {
    self._planFeaturesCache = cache;
    self._cacheTimestamp = Date.now();
    self._fetchPromise = null;
    return cache;
  }).catch(function (err) {
    self._fetchPromise = null;
    self._logger.error('[plan-features] Failed to fetch from payment service:', { error: err });
    if (self._planFeaturesCache) return self._planFeaturesCache;
    throw err;
  });

  return self._fetchPromise;
};

/**
 * Slug-keyed user-plan resolution — verbatim from getUserPlanId
 * (plan-features.middleware.js:105-134). 2min TTL; the lookup
 * data.plans?.['juggler'] is the W2 pure resolvePlanIdBySlug (coerced through
 * PlanSlug — UUID rejected); only a TRUTHY planId is cached (no-cache-on-null);
 * null on any error (fail-soft).
 * @param {string} userId
 * @returns {Promise<?string>}
 */
PaymentServiceEntitlementAdapter.prototype.resolveUserPlanId = async function resolveUserPlanId(userId) {
  var cached = this._userPlanCache.get(userId);
  if (cached && (Date.now() - cached.timestamp) < USER_PLAN_CACHE_TTL_MS) {
    return cached.planId;
  }

  try {
    var paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
    var internalKey = process.env.INTERNAL_SERVICE_KEY || '';
    var res = await this._fetch()(paymentUrl + '/internal/users/' + userId + '/active-plans', {
      headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error('Payment service returned ' + res.status);
    var data = await res.json();
    // active-plans returns a map keyed by products.productId (app SLUG) — look up
    // by the slug 'juggler', same key as the JWT `plans` claims. The pure
    // resolvePlanIdBySlug coerces the key through PlanSlug (rejects UUID).
    var planId = entitlementLogic.resolvePlanIdBySlug(data.plans, this._productSlug);
    // Only cache a TRUTHY planId — don't cache null so a just-subscribed user
    // isn't blocked by a stale null (the W2 pure shouldCacheUserPlan predicate).
    if (entitlementLogic.shouldCacheUserPlan(planId)) {
      this._userPlanCache.set(userId, { planId: planId, timestamp: Date.now() });
    } else {
      this._userPlanCache.delete(userId);
    }
    return planId;
  } catch {
    // Legacy fail-soft (plan-features.middleware.js:131) — bare catch, null on error.
    return null;
  }
};

/**
 * Compose user-plan + catalog into an Entitlement entity (slug-keyed), through
 * the W2 pure decideResolvePlan. Returns null when there is no active plan
 * (subscription_required) or the catalog is unavailable — the caller (W5) maps
 * those to the legacy 402/503. The returned Entitlement carries productSlug =
 * 'juggler' (coerced through PlanSlug).
 * @param {string} userId
 * @param {(string|PlanSlug)} [productSlug]  defaults to this adapter's slug.
 * @returns {Promise<?Entitlement>}
 */
PaymentServiceEntitlementAdapter.prototype.resolveEntitlement = async function resolveEntitlement(userId, productSlug) {
  var slug = productSlug === undefined ? this._productSlug : PlanSlug.from(productSlug);
  var realPlanId = await this.resolveUserPlanId(userId);
  var catalog = await this.resolvePlanCatalog();
  var decision = entitlementLogic.decideResolvePlan(realPlanId, catalog);
  if (decision.outcome !== 'resolve') return null;
  return new Entitlement({
    planId: decision.planId,
    planFeatures: decision.planFeatures,
    productSlug: slug
  });
};

/**
 * Drop the cached user-plan — verbatim from invalidateUserPlanCache
 * (plan-features.middleware.js:142-144).
 * @param {string} userId
 */
PaymentServiceEntitlementAdapter.prototype.invalidateUserPlan = function invalidateUserPlan(userId) {
  this._userPlanCache.delete(userId);
};

module.exports = PaymentServiceEntitlementAdapter;
module.exports.PaymentServiceEntitlementAdapter = PaymentServiceEntitlementAdapter;
