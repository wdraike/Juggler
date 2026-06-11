/**
 * HandleBillingWebhook — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy `handleWebhook` controller (billing-webhooks.controller.js:162-220)
 * — the per-event-type dispatch — over the W4 EntitlementPort + the injected
 * downgrade-enforcement collaborator.
 *
 * ── SECURITY (BINDING — elmo gate) ───────────────────────────────────────────
 * The HMAC-SHA256 signature verification (verifySignature) lives in the ROUTE layer
 * (billing-webhooks.routes.js + the app.js express.raw rawBody capture) and is
 * preserved THERE in W6 (golden-master Surface 3 / H3-1..H3-5, H3-elmoB3a/b). The
 * controller itself has NO inline signature check (golden-master H3-9 / FLAG-1) — it
 * TRUSTS the route guard. This use-case faithfully reproduces that: it contains NO
 * 'hmac'/'signature'/'crypto' logic. The dispatch logic moves here IDENTICALLY; the
 * verification stays at the edge. Dropping a guard is a BLOCK — none is dropped.
 *
 * ── PER-EVENT DISPATCH (verbatim, billing-webhooks.controller.js:167-213) ─────
 *   subscription.created / .activated         → invalidateUserPlan(userId).
 *   subscription.plan_changed                  → invalidateUserPlan(userId) (+ log
 *                                                from→to, preserved via injected logger).
 *   subscription.downgrade_applied             → invalidateUserPlan(userId) THEN:
 *       try { catalog = resolvePlanCatalog(); planFeatures = to_planId ? catalog[to_planId] : null;
 *             if (planFeatures) enforceDowngradeLimits(userId, planFeatures); }
 *       catch (err) { log 'Downgrade enforcement failed' } — the inner try/catch
 *       (so a payment-service / enforcement error does NOT fail the webhook). Verbatim.
 *   subscription.canceled / .cancel_scheduled / .expired / .paused / .resumed /
 *   .reactivated / .updated / .rebundled / .discount_applied / .trial_extended /
 *   .downgrade_scheduled                       → invalidateUserPlan(userId).
 *   default (unhandled)                        → log only (no invalidate).
 *   ALL events guard the invalidate on `if (userId)` — preserved (a webhook without a
 *   user_id still returns 200, just no cache action).
 *
 *   Returns { status: 200, body: { success: true, event } } on success — byte-identical
 *   to res.json (golden-master H3-3/H3-8). The OUTER try/catch → 500 stays in the W6
 *   controller (express concern); a thrown error propagates to it.
 *
 * ── NO NEW FALLBACKS ── the `data.to_planId ? … : null` and the `if (userId)`
 * guards are preserved verbatim.
 *
 * @typedef {Object} HandleBillingWebhookDeps
 * @property {import('../../domain/ports/EntitlementPort')} entitlement
 *   resolvePlanCatalog ⇔ getCachedPlanFeatures; invalidateUserPlan ⇔ invalidateUserPlanCache.
 * @property {(userId: string, planFeatures: Object) => Promise<*>} enforceDowngradeLimits
 *   the task-table downgrade enforcement (legacy enforceDowngradeLimits — disables
 *   excess recurringTasks/tasks; touches tasks_v + cal_sync_ledger, outside this
 *   slice) — INJECTED.
 * @property {Object} [logger]  { info, error } — for the per-event log lines.
 *   Defaults to a no-op (explicit default, not a `||` data substitution).
 */

'use strict';

// The events that map to a plain user-plan-cache invalidation (no enforcement).
// Verbatim from billing-webhooks.controller.js:167-209 (the .created/.activated
// case + the catch-all canceled/… case). plan_changed is handled separately only
// to preserve its distinct from→to log line.
var INVALIDATE_EVENTS = [
  'subscription.created',
  'subscription.activated',
  'subscription.canceled',
  'subscription.cancel_scheduled',
  'subscription.expired',
  'subscription.paused',
  'subscription.resumed',
  'subscription.reactivated',
  'subscription.updated',
  'subscription.rebundled',
  'subscription.discount_applied',
  'subscription.trial_extended',
  'subscription.downgrade_scheduled'
];

/** @param {HandleBillingWebhookDeps} deps */
function HandleBillingWebhook(deps) {
  if (!deps || !deps.entitlement || !deps.enforceDowngradeLimits) {
    throw new Error('HandleBillingWebhook: { entitlement, enforceDowngradeLimits } are required');
  }
  this.entitlement = deps.entitlement;
  this.enforceDowngradeLimits = deps.enforceDowngradeLimits;
  this.logger = deps.logger || { info: function () {}, error: function () {} };
}

/**
 * @param {Object} input
 * @param {Object} input.body  the webhook payload ({ event, user_id, ... }).
 * @returns {Promise<{ status: number, body: Object }>}
 */
HandleBillingWebhook.prototype.execute = async function execute(input) {
  var body = input.body || {};
  var event = body.event;
  // The legacy `const { event, ...data } = req.body; const userId = data.user_id;`
  var data = Object.assign({}, body);
  delete data.event;
  var userId = data.user_id;

  switch (event) {
    case 'subscription.created':
    case 'subscription.activated':
      this.logger.info('[billing-webhook] ' + event + ' for user ' + userId);
      if (userId) this.entitlement.invalidateUserPlan(userId);
      break;

    case 'subscription.plan_changed':
      this.logger.info('[billing-webhook] Plan changed for user ' + userId + ': ' + data.from_planId + ' → ' + data.to_planId);
      if (userId) this.entitlement.invalidateUserPlan(userId);
      break;

    case 'subscription.downgrade_applied':
      this.logger.info('[billing-webhook] Downgrade applied for user ' + userId);
      if (userId) {
        this.entitlement.invalidateUserPlan(userId);
        // Fetch the new plan's features and enforce limits (inner try/catch so a
        // payment-service / enforcement error does NOT fail the webhook).
        try {
          var allFeatures = await this.entitlement.resolvePlanCatalog();
          var planFeatures = data.to_planId ? allFeatures[data.to_planId] : null;
          if (planFeatures) {
            await this.enforceDowngradeLimits(userId, planFeatures);
          }
        } catch (err) {
          this.logger.error('[billing-webhook] Downgrade enforcement failed:', err.message);
        }
      }
      break;

    case 'subscription.canceled':
    case 'subscription.cancel_scheduled':
    case 'subscription.expired':
    case 'subscription.paused':
    case 'subscription.resumed':
    case 'subscription.reactivated':
    case 'subscription.updated':
    case 'subscription.rebundled':
    case 'subscription.discount_applied':
    case 'subscription.trial_extended':
    case 'subscription.downgrade_scheduled':
      this.logger.info('[billing-webhook] ' + event + ' for user ' + userId);
      if (userId) this.entitlement.invalidateUserPlan(userId);
      break;

    default:
      this.logger.info('[billing-webhook] Unhandled event: ' + event, data);
  }

  return { status: 200, body: { success: true, event: event } };
};

HandleBillingWebhook.INVALIDATE_EVENTS = INVALIDATE_EVENTS;

module.exports = HandleBillingWebhook;
