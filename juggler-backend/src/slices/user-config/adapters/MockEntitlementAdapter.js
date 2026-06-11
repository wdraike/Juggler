/**
 * MockEntitlementAdapter — EntitlementPort test double (Phase H4 / W4).
 *
 * Same contract as `PaymentServiceEntitlementAdapter`, with NO network: it serves
 * the plan catalog + per-user plan from injectable in-memory stores, while
 * reproducing the SAME observable behavior the contract suite pins:
 *
 *   - SLUG-KEYING (INVARIANT EP-1): the user-plan lookup is keyed by the product
 *     SLUG ('juggler'), through the W2 pure `resolvePlanIdBySlug` (coerces the key
 *     through PlanSlug — a UUID is REJECTED). The constructor coerces its configured
 *     slug through PlanSlug too (rejects UUID). A UUID can never be a plan key.
 *   - CACHE TTLs (INVARIANT EP-2): catalog 5min, user-plan 2min — same TTL math as
 *     the real adapter, so within-TTL reads do NOT re-read the backing store and
 *     after-TTL reads DO. The catalog read is deduplicated via an in-flight
 *     `_fetchPromise`. A null user-plan is NEVER cached.
 *   - RESPONSE SHAPES (INVARIANT EP-3): catalog is the `{ planId → features }` map
 *     (built by the W2 pure `extractCatalogFeatures` from a `plans` array, so the
 *     JSON-string-parsing branch is exercised identically); user-plan is the opaque
 *     planId string or null.
 *
 * The "backing store" is a function (default: a static `plans` array + a per-user
 * `plans` map) so a test can count reads, simulate latency, or flip values between
 * reads — the same seam the real adapter's `fetch` provides.
 *
 * @implements {import('../domain/ports/EntitlementPort')}
 */

'use strict';

var EntitlementPort = require('../domain/ports/EntitlementPort');
var PlanSlug = require('../domain/value-objects/PlanSlug');
var Entitlement = require('../domain/entities/Entitlement');
var entitlementLogic = require('../domain/logic/entitlement');

var CATALOG_CACHE_TTL_MS = EntitlementPort.CATALOG_CACHE_TTL_MS;
var USER_PLAN_CACHE_TTL_MS = EntitlementPort.USER_PLAN_CACHE_TTL_MS;

/**
 * @constructor
 * @param {object} [opts]
 * @param {string} [opts.productSlug]  product slug. Default 'juggler'. Coerced
 *   through PlanSlug (rejects UUID — slug-keying assertion).
 * @param {?string} [opts.productId]  the resolved product UUID (catalog filter
 *   only). Default null (discovery "failed" — fail-soft parity).
 * @param {(() => (Promise<Array>|Array))} [opts.catalogSource]  returns the `plans`
 *   array (the same shape payment-service `/api/plans` returns: each entry
 *   `{ planId, features }`, features an object OR a JSON string). Counted as one
 *   "fetch" per invocation. Default: a single static array.
 * @param {(userId: string) => (Promise<?Object>|?Object)} [opts.activePlansSource]
 *   returns the slug-keyed `plans` map for a user (the active-plans `data.plans`
 *   shape, e.g. `{ juggler: 'plan-starter' }`), or null. Counted as one "fetch"
 *   per invocation. Default: empty map for every user (→ null planId).
 */
function MockEntitlementAdapter(opts) {
  var o = opts || {};

  this._productSlug = PlanSlug.from(o.productSlug === undefined ? 'juggler' : o.productSlug);
  if (PlanSlug.isUuidShaped(this._productSlug.value)) {
    throw new Error(
      'MockEntitlementAdapter: product slug must NOT be a UUID (slug-keying), got: ' +
      JSON.stringify(this._productSlug.value)
    );
  }

  this._productId = o.productId === undefined ? null : o.productId;

  this._catalogSource = o.catalogSource === undefined
    ? function () { return []; }
    : o.catalogSource;

  this._activePlansSource = o.activePlansSource === undefined
    ? function () { return null; }
    : o.activePlansSource;

  // Cache state — mirrors the real adapter's instance fields.
  this._planFeaturesCache = null;
  this._cacheTimestamp = 0;
  this._fetchPromise = null;
  this._userPlanCache = new Map();
}

MockEntitlementAdapter.prototype = Object.create(EntitlementPort.prototype);
MockEntitlementAdapter.prototype.constructor = MockEntitlementAdapter;

MockEntitlementAdapter.prototype._slug = function _slug() {
  return this._productSlug.value;
};

/** Resolve the product UUID — static here (no discovery I/O). @returns {Promise<?string>} */
MockEntitlementAdapter.prototype.resolveProductId = function resolveProductId() {
  return Promise.resolve(this._productId);
};

/**
 * Cached plan catalog — same TTL + in-flight dedup as the real adapter, reading
 * from `catalogSource` instead of HTTP.
 * @returns {Promise<Object<string, Object>>}
 */
MockEntitlementAdapter.prototype.resolvePlanCatalog = function resolvePlanCatalog() {
  var self = this;
  var now = Date.now();
  if (self._planFeaturesCache && (now - self._cacheTimestamp) < CATALOG_CACHE_TTL_MS) {
    return Promise.resolve(self._planFeaturesCache);
  }

  if (self._fetchPromise) return self._fetchPromise;

  self._fetchPromise = Promise.resolve()
    .then(function () { return self._catalogSource(); })
    .then(function (plans) {
      // Same pure map build as the real adapter.
      var cache = entitlementLogic.extractCatalogFeatures(plans || []);
      self._planFeaturesCache = cache;
      self._cacheTimestamp = Date.now();
      self._fetchPromise = null;
      return cache;
    })
    .catch(function (err) {
      self._fetchPromise = null;
      if (self._planFeaturesCache) return self._planFeaturesCache;
      throw err;
    });

  return self._fetchPromise;
};

/**
 * Slug-keyed user-plan — same TTL + slug lookup + no-cache-on-null as the real
 * adapter, reading from `activePlansSource` instead of HTTP.
 * @param {string} userId
 * @returns {Promise<?string>}
 */
MockEntitlementAdapter.prototype.resolveUserPlanId = async function resolveUserPlanId(userId) {
  var cached = this._userPlanCache.get(userId);
  if (cached && (Date.now() - cached.timestamp) < USER_PLAN_CACHE_TTL_MS) {
    return cached.planId;
  }

  try {
    var plansMap = await this._activePlansSource(userId);
    // Slug-keyed (rejects UUID via PlanSlug inside resolvePlanIdBySlug).
    var planId = entitlementLogic.resolvePlanIdBySlug(plansMap, this._productSlug);
    if (entitlementLogic.shouldCacheUserPlan(planId)) {
      this._userPlanCache.set(userId, { planId: planId, timestamp: Date.now() });
    } else {
      this._userPlanCache.delete(userId);
    }
    return planId;
  } catch {
    // Fail-soft parity with the real adapter — null on a source error.
    return null;
  }
};

/**
 * Compose into an Entitlement entity — identical to the real adapter (W2 pure
 * decideResolvePlan).
 * @param {string} userId
 * @param {(string|PlanSlug)} [productSlug]
 * @returns {Promise<?Entitlement>}
 */
MockEntitlementAdapter.prototype.resolveEntitlement = async function resolveEntitlement(userId, productSlug) {
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

/** @param {string} userId */
MockEntitlementAdapter.prototype.invalidateUserPlan = function invalidateUserPlan(userId) {
  this._userPlanCache.delete(userId);
};

module.exports = MockEntitlementAdapter;
module.exports.MockEntitlementAdapter = MockEntitlementAdapter;
