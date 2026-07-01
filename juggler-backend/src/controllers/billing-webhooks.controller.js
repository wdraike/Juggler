/**
 * Billing Webhooks Controller for StriveRS
 *
 * Receives subscription lifecycle events from the payment service.
 * Invalidates the plan features cache so the app picks up changes immediately.
 * Enforces entity limits on downgrade by disabling excess items.
 */

const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('billing-webhooks.controller');

/**
 * enforceDowngradeLimits (999.994) — relocated to the task slice
 * (slices/task/adapters/DowngradeLimitsEnforcer.js). tasks_v + cal_sync_ledger
 * mutation is task-domain logic and doesn't belong in this controller; this is
 * a thin re-export (lazy-required, matching the slice facades' cycle-avoidance
 * idiom) so existing callers/tests requiring it from here keep working.
 */
function enforceDowngradeLimits(userId, planFeatures) {
  return require('../slices/task/facade').enforceDowngradeLimits(userId, planFeatures);
}

/**
 * POST /api/billing-webhooks — THIN HTTP adapter (Phase H4 / W6).
 *
 * The per-event dispatch was extracted into the user-config slice
 * (HandleBillingWebhook command). This handler maps `req.body` → use-case input,
 * delegates to `slices/user-config/facade`, and maps the `{ status, body }`
 * envelope onto express. The per-handler try/catch → 500 stays here (an express
 * concern).
 *
 * ── SECURITY (elmo gate, FLAG-1) ──
 * The HMAC-SHA256 signature verification lives in the ROUTE layer
 * (billing-webhooks.routes.js verifySignature) and is NOT in this handler — it
 * trusts the route guard exactly as the legacy did (golden-master H3-9). This
 * handler contains no signature/crypto logic.
 */
async function handleWebhook(req, res) {
  try {
    const facade = require('../slices/user-config/facade');
    const result = await facade.handleBillingWebhook({ body: req.body });
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('[billing-webhook] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { handleWebhook, enforceDowngradeLimits };
