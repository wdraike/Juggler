/**
 * My Plan Routes
 *
 * Returns the authenticated user's plan info for the frontend.
 */

const router = require('express').Router();
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures, PRODUCT_SLUG } = require('../middleware/plan-features.middleware');
const db = require('../db');

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
    const planSlug = req.planSlug || 'free';
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

    for (const [key, limit] of Object.entries(allLimits)) {
      if (limit === -1) {
        usage[key] = { used: 0, limit: null, unlimited: true, resets_at: null };
        continue;
      }

      const isCountBased = !key.includes('per_');
      const { start: periodStart, end: periodEnd } = isCountBased
        ? { start: new Date(0), end: null }
        : getCurrentPeriodBounds(key);

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

    let planName = planSlug;
    try {
      const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
      const plansRes = await fetch(`${paymentUrl}/api/plans?product=${PRODUCT_SLUG}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (plansRes.ok) {
        const plansData = await plansRes.json();
        const plan = plansData.plans?.find(p => p.slug === planSlug);
        if (plan) planName = plan.name;
      }
    } catch { /* use slug as fallback */ }

    res.json({
      plan_name: planName,
      plan_id: planSlug,
      features,
      usage
    });
  } catch (error) {
    console.error('[my-plan] Error:', error.message);
    res.status(500).json({ error: 'Failed to load plan info' });
  }
});

module.exports = router;
