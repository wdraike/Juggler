/**
 * CheckEntitlement — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `resolvePlanFeatures` middleware
 * (plan-features.middleware.js:168-209) over the W4 EntitlementPort + the W2 pure
 * `decideResolvePlan`. This is the SLUG-KEYED entitlement resolution — the headline
 * H4 invariant (golden-master Surface 7 / H7).
 *
 * ── STEP-FOR-STEP (matches the middleware) ──────────────────────────────────
 *   1. !userId → 401 'Authentication required'.
 *   2. paymentUserId = authServiceId || userId (the legacy
 *      `req.user.authServiceId || req.user.id` — preserved verbatim).
 *   3. realPlanId = entitlement.resolveUserPlanId(paymentUserId) (SLUG-keyed inside
 *      the adapter — data.plans?.['juggler'], UUID rejected by PlanSlug).
 *   4. !realPlanId → 402 SUBSCRIPTION_REQUIRED IMMEDIATELY (+ plans_url + message)
 *      WITHOUT fetching the catalog — matches middleware L177-184 exactly: the catalog
 *      is NEVER fetched on the 402 path.
 *   5. catalog = entitlement.resolvePlanCatalog() — ONLY when realPlanId is truthy
 *      (middleware L188: getCachedPlanFeatures called AFTER the 402 guard).
 *   6. decision = decideResolvePlan(realPlanId, catalog) (W2 pure, resolve/unavailable
 *      only — subscription_required is already handled in step 4):
 *        - resolve → attach { planId, planFeatures } (the 'free' fall-back is inside
 *          decideResolvePlan — byte-identical to the middleware's warn+fallback).
 *        - unavailable → 503 'Plan configuration unavailable. Please try again.'.
 *   7. on resolve: fire the background reconcileLimits (injected, fire-and-forget —
 *      legacy reconcileLimitsIfNeeded; does NOT block, errors swallowed by the
 *      collaborator). Return { status: 200, entitlement: { planId, planFeatures } }
 *      — the W6 middleware maps that onto req.planId/req.planFeatures + next().
 *   8. the OUTER try/catch → 503 'Payment service unavailable' stays in the W6
 *      middleware (an express concern); a thrown error here propagates to it.
 *
 * ── SLUG-KEYING (BINDING) ── the lookup is slug-keyed end-to-end via the W4
 * adapter / W2 resolvePlanIdBySlug. A UUID can never be a plan key (PlanSlug).
 *
 * ── NO NEW FALLBACKS ── `authServiceId || id` and the 'free' fallback are
 * preserved verbatim (the latter inside the W2 decideResolvePlan).
 *
 * @typedef {Object} CheckEntitlementDeps
 * @property {import('../../domain/ports/EntitlementPort')} entitlement
 * @property {(userId: string, planFeatures: Object) => void} reconcileLimits
 *   the background limit reconciliation (legacy reconcileLimitsIfNeeded) — injected,
 *   fire-and-forget. Defaults to a no-op when omitted (explicit default, not a `||`
 *   data substitution).
 * @property {string} plansUrl  the billing-frontend plans URL the 402 body carries
 *   (legacy `${_proxyConfig.services.billing.frontend}/plans`) — injected by W6.
 */

'use strict';

var entitlementLogic = require('../../domain/logic/entitlement');

/** @param {CheckEntitlementDeps} deps */
function CheckEntitlement(deps) {
  if (!deps || !deps.entitlement) {
    throw new Error('CheckEntitlement: { entitlement } is required');
  }
  this.entitlement = deps.entitlement;
  this.reconcileLimits = deps.reconcileLimits || function () {};
  // plansUrl is part of the 402 body; the legacy built it from proxy-config. W6
  // injects the resolved URL. When omitted the 402 still carries the key (undefined),
  // matching the legacy when proxy-config is unset — but W6 supplies it.
  this.plansUrl = deps.plansUrl;
}

/**
 * @param {Object} input
 * @param {Object} input.user  the req.user ({ id, authServiceId? }).
 * @returns {Promise<{ status: number, body?: Object, entitlement?: {planId: string, planFeatures: Object} }>}
 */
CheckEntitlement.prototype.execute = async function execute(input) {
  var user = input.user;

  // 1. auth guard (middleware L170-172)
  if (!user || !user.id) {
    return { status: 401, body: { error: 'Authentication required' } };
  }

  // 2. payment user id (middleware L174) — authServiceId || id, verbatim.
  var paymentUserId = user.authServiceId || user.id;

  // 3. slug-keyed user plan (middleware L175)
  var realPlanId = await this.entitlement.resolveUserPlanId(paymentUserId);

  // 4. 402 guard BEFORE catalog fetch (middleware L177-184: returns 402 if !realPlanId,
  //    never calls getCachedPlanFeatures on the 402 path — legacy ordering restored).
  if (!realPlanId) {
    return {
      status: 402,
      body: {
        error: 'Subscription required',
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'You need an active subscription to use this app. Choose a plan to get started.',
        plans_url: this.plansUrl
      }
    };
  }

  // 5. catalog + branch decision — only reached when realPlanId is truthy
  //    (middleware L188: getCachedPlanFeatures AFTER the 402 guard)
  var catalog = await this.entitlement.resolvePlanCatalog();
  var decision = entitlementLogic.decideResolvePlan(realPlanId, catalog);

  if (decision.outcome === 'unavailable') {
    return { status: 503, body: { error: 'Plan configuration unavailable. Please try again.' } };
  }

  // resolve — attach + background reconcile (middleware L201-204, step 7)
  this.reconcileLimits(user.id, decision.planFeatures);
  return {
    status: 200,
    entitlement: { planId: decision.planId, planFeatures: decision.planFeatures }
  };
};

module.exports = CheckEntitlement;
