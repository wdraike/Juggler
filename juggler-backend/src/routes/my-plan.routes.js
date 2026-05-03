/**
 * My Plan Routes
 *
 * Returns the authenticated user's plan info for the frontend.
 */

const router = require('express').Router();
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures, getProductId, PRODUCT_LABEL } = require('../middleware/plan-features.middleware');
const db = require('../db');
const { countActiveTasks, countRecurringTemplates, countProjects, countLocations, countScheduleTemplates } = require('../middleware/entity-limits');

// Fetch plan name from payment service
async function getPlanName(planId) {
  try {
    const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
    const productId = await getProductId() || PRODUCT_LABEL;
    const res = await fetch(`${paymentUrl}/api/plans?product=${productId}&include_all=true`, {
      signal: AbortSignal.timeout(30000)
    });
    if (res.ok) {
      const data = await res.json();
      const plan = data.plans?.find(p => p.planId === planId);
      return plan?.name || planId;
    }
  } catch {}
  return planId;
}

function getCurrentPeriodBounds(featureKey) {
  const now = new Date();
  if (featureKey.includes('per_hour')) {
    const start = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
    return { start, end: new Date(start.getTime() + 3600000) };
  }
  if (featureKey.includes('per_month')) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    };
  }
  return { start: new Date(0), end: null };
}

router.get('/', authenticateJWT, resolvePlanFeatures, async (req, res) => {
  try {
    const userId = req.user?.id;
    const planId = req.planId || 'free';
    const features = req.planFeatures;

    const usage = {};
    // Juggler currently has no numeric limits in catalog, but this is ready for when they're added
    const allLimits = {};
    // Traverse features to find any numeric values that could be limits
    function findLimits(obj, prefix = '') {
      for (const [key, value] of Object.entries(obj || {})) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'number') {
          allLimits[fullKey] = value;
        } else if (typeof value === 'object' && !Array.isArray(value)) {
          findLimits(value, fullKey);
        }
      }
    }
    findLimits(features);

    // Entity count functions for count-based limits
    const entityCounters = {
      'limits.active_tasks': countActiveTasks,
      'limits.recurring_templates': countRecurringTemplates,
      'limits.projects': countProjects,
      'limits.locations': countLocations,
      'limits.schedule_templates': countScheduleTemplates
    };

    for (const [key, limit] of Object.entries(allLimits)) {
      if (limit === -1) {
        // Still fetch actual count for unlimited users (for display)
        let used = 0;
        if (entityCounters[key]) {
          try { used = await entityCounters[key](userId); } catch {}
        }
        usage[key] = { used, limit: null, unlimited: true, resets_at: null };
        continue;
      }

      // Entity-based limits: count from actual tables
      if (entityCounters[key]) {
        try {
          const count = await entityCounters[key](userId);
          usage[key] = { used: count, limit, unlimited: false, resets_at: null };
        } catch {
          usage[key] = { used: 0, limit, unlimited: false, resets_at: null };
        }
        continue;
      }

      // Rate-based limits (per_month, per_hour): count from plan_usage table
      const { start: periodStart, end: periodEnd } = getCurrentPeriodBounds(key);

      const row = await db('plan_usage')
        .where('user_id', userId)
        .where('usage_key', key)
        .where('period_start', periodStart)
        .first();

      usage[key] = {
        used: row?.count || 0,
        limit,
        unlimited: false,
        resets_at: periodEnd ? periodEnd.toISOString() : null
      };
    }

    const planName = await getPlanName(planId);

    // Fetch subscription status (trial info) from payment service
    let subscriptionStatus = null;
    let trialEnd = null;
    try {
      const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
      const internalKey = process.env.INTERNAL_SERVICE_KEY || '';
      const productId = await getProductId() || PRODUCT_LABEL;
      const subRes = await fetch(`${paymentUrl}/internal/users/${userId}/subscriptions?product=${productId}`, {
        headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000)
      });
      if (subRes.ok) {
        const subData = await subRes.json();
        const sub = subData.subscriptions?.[0];
        if (sub) {
          subscriptionStatus = sub.status;
          trialEnd = sub.trial_end;
        }
      }
    } catch {}

    // Count disabled items so the frontend can show a badge/notification
    let disabledCount = 0;
    try {
      const disabledRow = await db('tasks_v')
        .where({ user_id: userId, status: 'disabled' })
        .count('* as count').first();
      disabledCount = parseInt(disabledRow.count, 10);
    } catch {}

    res.json({
      plan_name: planName,
      plan_id: planId,
      features,
      usage,
      subscription_status: subscriptionStatus,
      trial_end: trialEnd,
      disabled_items: disabledCount,
    });
  } catch (error) {
    console.error('[my-plan] Error:', error.message);
    res.status(500).json({ error: 'Failed to load plan info' });
  }
});

module.exports = router;
