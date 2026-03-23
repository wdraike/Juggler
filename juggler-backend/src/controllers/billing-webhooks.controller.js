/**
 * Billing Webhooks Controller for StriveRS
 *
 * Receives subscription lifecycle events from the payment service.
 * Handles: plan changes (upgrade/downgrade), cancellations.
 * Downgrades take effect immediately — no grace period.
 */

const planFeaturesInvalidation = new Set();

function invalidateUserPlanCache(userId) {
  planFeaturesInvalidation.add(String(userId));
  setTimeout(() => planFeaturesInvalidation.delete(String(userId)), 10 * 60 * 1000);
}

function isUserCacheInvalidated(userId) {
  return planFeaturesInvalidation.has(String(userId));
}

async function handleWebhook(req, res) {
  try {
    const { event, ...data } = req.body;

    switch (event) {
      case 'subscription.plan_changed':
        console.log(`[billing-webhook] Plan changed for user ${data.user_id}: ${data.from_plan_slug} → ${data.to_plan_slug} (${data.change_type})`);
        invalidateUserPlanCache(data.user_id);
        break;

      case 'subscription.downgrade_scheduled':
        console.log(`[billing-webhook] Downgrade scheduled for user ${data.user_id}: → ${data.scheduled_plan_slug} on ${data.effective_at}`);
        break;

      case 'subscription.downgrade_applied':
        console.log(`[billing-webhook] Downgrade applied for user ${data.user_id}: ${data.from_plan_slug} → ${data.to_plan_slug}`);
        invalidateUserPlanCache(data.user_id);
        break;

      case 'subscription.canceled':
        console.log(`[billing-webhook] Subscription canceled for user ${data.user_id}`);
        invalidateUserPlanCache(data.user_id);
        break;

      case 'subscription.activated':
        console.log(`[billing-webhook] Subscription activated for user ${data.user_id}: ${data.plan_slug}`);
        invalidateUserPlanCache(data.user_id);
        break;

      default:
        console.log(`[billing-webhook] Unknown event: ${event}`);
    }

    res.json({ success: true, event });
  } catch (error) {
    console.error('[billing-webhook] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  handleWebhook,
  isUserCacheInvalidated,
  invalidateUserPlanCache
};
