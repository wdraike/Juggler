/**
 * EntitlementPort — driven-port contract for resolving a user's subscription
 * entitlement from the payment-service (Phase H4 — defined in W4, IMPLEMENTED by
 * `PaymentServiceEntitlementAdapter`; test-doubled by `MockEntitlementAdapter`).
 *
 * Formalizes the cross-service entitlement seam currently inline in
 * `src/middleware/plan-features.middleware.js`: the slug→UUID product discovery,
 * the slug-keyed plan-catalog fetch (cached 5min), and the slug-keyed user-plan
 * fetch (cached 2min). The adapter ABSORBS that I/O; this port is the contract the
 * W5 application layer programs against.
 *
 * ── BINDING INVARIANTS (WBS H4 / CLAUDE.md §JWT Plans Claim) ──────────────────
 *
 * INVARIANT EP-1 (SLUG-KEYING — the headline H4 invariant):
 *   The user plan is resolved by the product SLUG key (`'juggler'`), NEVER by a
 *   product UUID. `resolveUserPlanId` resolves `data.plans?.['juggler']`; the
 *   returned `productSlug` is always the slug `'juggler'`, coerced through PlanSlug
 *   (which REJECTS a UUID-shaped value). A UUID can never be threaded through as a
 *   plan key. (Golden-master Surface-7 H7-2/H7-5: a slug-keyed map resolves; a
 *   UUID-keyed map resolves to null.) The product UUID resolved by
 *   `resolveProductId` is used ONLY as the `?product=` catalog FILTER — never as a
 *   plan key.
 *
 * INVARIANT EP-2 (cache TTLs reproduced verbatim):
 *   plan catalog cached `CATALOG_CACHE_TTL_MS` = 5min; user-plan cached
 *   `USER_PLAN_CACHE_TTL_MS` = 2min. Within-TTL reads do NOT refetch; after-TTL
 *   reads refetch. The catalog fetch is deduplicated by an in-flight `_fetchPromise`
 *   (concurrent misses share one fetch). A null user-plan is NEVER cached (a
 *   just-subscribed user is not blocked by a stale null). (Golden-master H8-1..4.)
 *
 * INVARIANT EP-3 (response shapes byte-identical):
 *   `resolvePlanCatalog` returns the `{ planId → features }` map built exactly as
 *   `fetchPlanFeatures` (each plan with `features`, JSON-parsed when a string).
 *   `resolveUserPlanId` returns the opaque planId string (or null) exactly as
 *   `getUserPlanId`. No defaulting, no coercion of the features object.
 *
 * Contract only (W4) — JSDoc `@typedef` + throw-not-implemented base.
 *
 * @typedef {Object} EntitlementPort
 *
 * @property {() => Promise<?string>} resolveProductId
 *   Resolve THIS product's UUID via the payment-service product-discovery
 *   endpoint (`/internal/products/juggler`), cached for the process lifetime.
 *   Returns null when discovery fails (legacy fail-soft — preserved). The UUID is
 *   used ONLY as the catalog `?product=` filter, NEVER as a plan key.
 *   (Legacy: `plan-features.middleware.getProductId`.)
 *
 * @property {() => Promise<Object<string, Object>>} resolvePlanCatalog
 *   Resolve the `{ planId → features }` catalog map from the payment-service
 *   plans endpoint, cached 5min with in-flight dedup. On a refetch error, returns
 *   the last cached catalog if present, else rejects.
 *   (Legacy: `plan-features.middleware.getCachedPlanFeatures`.)
 *
 * @property {(userId: string) => Promise<?string>} resolveUserPlanId
 *   Resolve the user's active planId for THIS product by SLUG key
 *   (`data.plans?.['juggler']`), cached 2min; a null result is never cached.
 *   Returns null on any error (legacy fail-soft — preserved).
 *   (Legacy: `plan-features.middleware.getUserPlanId`.)
 *
 * @property {(userId: string, productSlug?: (string|PlanSlug)) => Promise<?Entitlement>} resolveEntitlement
 *   Resolve the user → `{ planId, planFeatures }` Entitlement entity (slug-keyed),
 *   composing `resolveUserPlanId` + `resolvePlanCatalog` through the pure
 *   `decideResolvePlan`. Returns null when the user has no active plan
 *   (subscription_required) or the catalog is unavailable. The returned
 *   Entitlement carries `productSlug = 'juggler'` (coerced through PlanSlug).
 *
 * @property {(userId: string) => void} invalidateUserPlan
 *   Drop the cached user-plan for `userId`. (Legacy:
 *   `plan-features.middleware.invalidateUserPlanCache`.)
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses (W4 `PaymentServiceEntitlementAdapter`,
 * `MockEntitlementAdapter`) MUST override every method.
 * @constructor
 */
function EntitlementPort() {}

EntitlementPort.prototype.resolveProductId = function resolveProductId() {
  throw new Error('EntitlementPort.resolveProductId not implemented');
};

EntitlementPort.prototype.resolvePlanCatalog = function resolvePlanCatalog() {
  throw new Error('EntitlementPort.resolvePlanCatalog not implemented');
};

EntitlementPort.prototype.resolveUserPlanId = function resolveUserPlanId(_userId) {
  throw new Error('EntitlementPort.resolveUserPlanId not implemented');
};

EntitlementPort.prototype.resolveEntitlement = function resolveEntitlement(_userId, _productSlug) {
  throw new Error('EntitlementPort.resolveEntitlement not implemented');
};

EntitlementPort.prototype.invalidateUserPlan = function invalidateUserPlan(_userId) {
  throw new Error('EntitlementPort.invalidateUserPlan not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy EntitlementPort.
 * @type {ReadonlyArray<string>}
 */
var ENTITLEMENT_PORT_METHODS = Object.freeze([
  'resolveProductId',
  'resolvePlanCatalog',
  'resolveUserPlanId',
  'resolveEntitlement',
  'invalidateUserPlan'
]);

/** Catalog cache TTL — 5 minutes (verbatim from plan-features.middleware.js:19). */
var CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

/** User-plan cache TTL — 2 minutes (verbatim from plan-features.middleware.js:20). */
var USER_PLAN_CACHE_TTL_MS = 2 * 60 * 1000;

module.exports = EntitlementPort;
module.exports.EntitlementPort = EntitlementPort;
module.exports.ENTITLEMENT_PORT_METHODS = ENTITLEMENT_PORT_METHODS;
module.exports.CATALOG_CACHE_TTL_MS = CATALOG_CACHE_TTL_MS;
module.exports.USER_PLAN_CACHE_TTL_MS = USER_PLAN_CACHE_TTL_MS;
