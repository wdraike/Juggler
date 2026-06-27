/**
 * entitlement — PURE entitlement-evaluation logic relocated from
 * `src/middleware/plan-features.middleware.js` (Phase H4 / W2).
 *
 * PURE: zero infra imports — no fetch, no env, no caches, no express. The
 * payment-service HTTP fetches (getProductId, fetchPlanFeatures, getUserPlanId's
 * network call), the 5min/2min caches, and the slug→UUID startup resolution STAY
 * in the legacy file — the W4 PaymentServiceEntitlementAdapter absorbs that I/O.
 *
 * What is relocated here is the pure decisions the middleware computes over the
 * data the I/O returned:
 *
 *   resolvePlanIdBySlug   ⇔ getUserPlanId's slug lookup       (plan-features.middleware.js:122)
 *                            `const planId = data.plans?.[PRODUCT_LABEL] || null;`
 *   shouldCacheUserPlan   ⇔ the "only cache when planId truthy" rule (lines 125-129)
 *   extractCatalogFeatures⇔ fetchPlanFeatures' plan→features map build (lines 70-76)
 *   decideResolvePlan     ⇔ resolvePlanFeatures' branch logic  (lines 177-199)
 *
 * HEADLINE SLUG-KEYING INVARIANT (BINDING — WBS H4 / CLAUDE.md §JWT Plans Claim):
 * the user plan is resolved by the product SLUG key (`'juggler'`), NEVER a UUID.
 * resolvePlanIdBySlug takes a PlanSlug VO (which itself rejects UUID-shaped values),
 * so a UUID can never be used as the lookup key. The golden-master H7-2/H7-5 pin
 * this: a slug-keyed `plans` map resolves; a UUID-keyed map resolves to null → 402.
 */

'use strict';

var PlanSlug = require('../value-objects/PlanSlug');

/**
 * Slug-keyed user-plan resolution — verbatim from plan-features.middleware.js:122
 * (`data.plans?.[PRODUCT_LABEL] || null`), with PRODUCT_LABEL being the slug.
 *
 * @param {?Object} plansMap  the `plans` map from payment-service active-plans
 *   (keyed by product slug). May be undefined/null.
 * @param {(PlanSlug|string)} slug  the product slug (e.g. 'juggler'). Coerced
 *   through PlanSlug, which REJECTS a UUID-shaped key — enforcing slug-keying.
 * @returns {?string} the resolved planId for that slug, or null.
 */
function resolvePlanIdBySlug(plansMap, slug) {
  var key = PlanSlug.from(slug).value; // throws if UUID-shaped — slug-keying guard
  if (plansMap == null) return null;
  return plansMap[key] || null;
}

/**
 * Whether to cache the resolved user plan — verbatim from
 * plan-features.middleware.js:125-129. Only cache a TRUTHY planId; a null planId
 * is NOT cached (so a user who just subscribed isn't blocked by a stale null).
 * The actual Map write/delete stays in the adapter; this is the pure predicate.
 *
 * @param {?string} planId
 * @returns {boolean} true => cache it; false => delete/skip caching.
 */
function shouldCacheUserPlan(planId) {
  return !!planId;
}

/**
 * Build the planId→features catalog map — verbatim from fetchPlanFeatures'
 * loop (plan-features.middleware.js:70-76):
 *   for each plan with `features`, store `cache[plan.planId]`, JSON-parsing the
 *   features when it's a string.
 *
 * Pure: takes the already-fetched `plans` array, returns the cache object. The
 * fetch + the caching/TTL stay in the adapter.
 *
 * @param {Array<{planId: string, features: (Object|string)}>} plans
 * @returns {Object<string, Object>} planId → parsed features
 */
function extractCatalogFeatures(plans) {
  var cache = {};
  var list = plans || [];
  for (var i = 0; i < list.length; i++) {
    var plan = list[i];
    if (plan.features) {
      cache[plan.planId] = typeof plan.features === 'string'
        ? JSON.parse(plan.features)
        : plan.features;
    }
  }
  return cache;
}

/**
 * resolvePlanFeatures branch decision — verbatim from
 * plan-features.middleware.js:177-199, given the data the I/O already fetched
 * (the user's realPlanId and the catalog map). The network fetches, the
 * authentication guard (401), the background reconciliation, and the outer
 * try/catch 503 stay in the middleware; this decides the inner branch:
 *
 *   - realPlanId falsy                         → 402 SUBSCRIPTION_REQUIRED.
 *   - catalog[realPlanId] present              → resolve with that planId + features.
 *   - else catalog['free'] present             → fall back to 'free' (planId='free').
 *   - else                                     → 503 'Plan configuration unavailable'.
 *
 * @param {?string} realPlanId  from getUserPlanId (slug-keyed)
 * @param {?Object} catalog     planId→features map (from getCachedPlanFeatures)
 * @returns {{outcome: ('resolve'|'subscription_required'|'unavailable'),
 *            status: ?number, code: ?string, planId: ?string, planFeatures: ?Object}}
 */
function decideResolvePlan(realPlanId, catalog) {
  if (!realPlanId) {
    return {
      outcome: 'subscription_required',
      status: 402,
      code: 'SUBSCRIPTION_REQUIRED',
      planId: null,
      planFeatures: null
    };
  }

  var all = catalog || {};
  var features = all[realPlanId];
  var planId = realPlanId;

  if (!features) {
    // BUG-891 (999.891): when the user's real plan slug is truthy but NOT found in the
    // catalog features map, return 'unavailable' instead of silently downgrading to 'free'.
    // A silent downgrade shows the "Upgrade" dialog to a paying user. The 503 forces the
    // next request to retry the catalog fetch fresh, rather than serving stale data.
    if (realPlanId !== 'free') {
      return {
        outcome: 'unavailable',
        status: 503,
        code: null,
        planId: null,
        planFeatures: null
      };
    }
    // Only for an explicitly 'free' planId that's missing from the catalog: retry the
    // free-fallback path (existing behavior for partial catalog configs).
    features = all['free'];
    planId = 'free';
  }

  if (!features) {
    return {
      outcome: 'unavailable',
      status: 503,
      code: null,
      planId: null,
      planFeatures: null
    };
  }

  return {
    outcome: 'resolve',
    status: null,
    code: null,
    planId: planId,
    planFeatures: features
  };
}

module.exports = {
  resolvePlanIdBySlug: resolvePlanIdBySlug,
  shouldCacheUserPlan: shouldCacheUserPlan,
  extractCatalogFeatures: extractCatalogFeatures,
  decideResolvePlan: decideResolvePlan
};
