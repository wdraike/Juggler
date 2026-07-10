/**
 * My Plan Routes
 *
 * Returns the authenticated user's plan info for the frontend.
 *
 * 999.1196: the usage-computation loop + getCurrentPeriodBounds business math
 * moved to the user-config slice's GetMyPlan use-case (application/queries).
 * This route is the USE-CASE'S COMPOSITION ROOT (mirrors the jwt-auth
 * middleware / ProvisionUserOnFirstLogin idiom): it wires GetMyPlan with its
 * OWN db / entity-limits / payment-service collaborators (not the facade's
 * default singleton wiring) so the existing unit tests that mock
 * `middleware/entity-limits` and `lib/db` at this file's require site keep
 * intercepting the exact same calls.
 */

const router = require('express').Router();
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures, getProductId, PRODUCT_LABEL } = require('../middleware/plan-features.middleware');
const { paymentFetch } = require('../lib/payment-service-client');
// W5 (juggler-hex-h2): route through lib/db's shared singleton (single pool).
const db = require('../lib/db').getDefaultDb();
const { countActiveTasks, countRecurringTemplates, countProjects, countLocations, countScheduleTemplates } = require('../middleware/entity-limits');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('my-plan.routes');
const { GetMyPlan } = require('../slices/user-config/facade');

// Fetch plan name from payment service
async function getPlanName(planId) {
  try {
    const productId = await getProductId() || PRODUCT_LABEL;
    const res = await paymentFetch(`/api/plans?product=${productId}&include_all=true`, {
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) {
      const data = await res.json();
      const plan = data.plans?.find(p => p.planId === planId);
      return plan?.name || planId;
    }
  } catch (err) {
    logger.warn(`[getPlanName] payment-service plan-name lookup failed for planId=${planId}, falling back to raw planId:`, err.message);
  }
  return planId;
}

// Fetch subscription status (trial info) from payment service
async function getSubscriptionStatus(userId) {
  try {
    const internalKey = process.env.INTERNAL_SERVICE_KEY || '';
    const productId = await getProductId() || PRODUCT_LABEL;
    const subRes = await paymentFetch(`/internal/users/${userId}/subscriptions?product=${productId}`, {
      headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' }
    });
    if (subRes.ok) {
      const subData = await subRes.json();
      const sub = subData.subscriptions?.[0];
      if (sub) {
        return { status: sub.status, trial_end: sub.trial_end };
      }
    }
  } catch (err) {
    // 999.1194: surface the failure — previously a silent empty catch masked
    // payment-service outages (user saw null subscription status, no log).
    logger.warn('[my-plan] subscription-status lookup failed:', err.message);
  }
  return null;
}

const _getMyPlan = new GetMyPlan({
  db,
  entityCounters: {
    'limits.active_tasks': countActiveTasks,
    'limits.recurring_templates': countRecurringTemplates,
    'limits.projects': countProjects,
    'limits.locations': countLocations,
    'limits.schedule_templates': countScheduleTemplates
  },
  getPlanName,
  getSubscriptionStatus
});

router.get('/', authenticateJWT, resolvePlanFeatures, async (req, res) => {
  try {
    const result = await _getMyPlan.execute({
      userId: req.user?.id,
      planId: req.planId || 'free',
      features: req.planFeatures
    });
    res.json(result);
  } catch (error) {
    logger.error('[my-plan] Error:', error.message);
    res.status(500).json({ error: 'Failed to load plan info' });
  }
});

module.exports = router;
module.exports.getPlanName = getPlanName; // exported for unit testing (999.1194)
