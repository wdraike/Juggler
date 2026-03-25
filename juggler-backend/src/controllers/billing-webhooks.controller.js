/**
 * Billing Webhooks Controller for StriveRS
 *
 * Receives subscription lifecycle events from the payment service.
 * Invalidates the plan features cache so the app picks up changes immediately.
 */

const { invalidateUserPlanCache } = require('../middleware/plan-features.middleware');

async function handleWebhook(req, res) {
  try {
    const { event, ...data } = req.body;
    const userId = data.user_id;

    switch (event) {
      case 'subscription.created':
      case 'subscription.activated':
        console.log(`[billing-webhook] ${event} for user ${userId}`);
        if (userId) invalidateUserPlanCache(userId);
        break;

      case 'subscription.plan_changed':
        console.log(`[billing-webhook] Plan changed for user ${userId}: ${data.from_planId} → ${data.to_planId}`);
        if (userId) invalidateUserPlanCache(userId);
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
      case 'subscription.downgrade_applied':
        console.log(`[billing-webhook] ${event} for user ${userId}`);
        if (userId) invalidateUserPlanCache(userId);
        break;

      case 'subscription.downgrade_scheduled':
        console.log(`[billing-webhook] Downgrade scheduled for user ${userId}`);
        break;

      default:
        console.log(`[billing-webhook] Unhandled event: ${event}`, data);
    }

    res.json({ success: true, event });
  } catch (error) {
    console.error('[billing-webhook] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { handleWebhook };
