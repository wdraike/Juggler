/**
 * Feature Gate Middleware for Juggler
 *
 * Same atomic patterns as Resume Optimizer:
 *   requireFeature(path)         – Boolean flag (403 if false)
 *   requireFeatureIncludes(path) – Array membership (403 if not included)
 *   checkUsageLimit(limitKey)    – Atomic check-and-increment (429 if exceeded)
 *
 * All gates log to feature_events table.
 */

const db = require('../db');

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, key) => o?.[key], obj);
}

function logFeatureEvent(req, featureKey, eventType, value) {
  const userId = typeof req === 'object' ? req.user?.id : req;
  const planSlug = typeof req === 'object' ? req.planSlug : 'free';

  db('feature_events').insert({
    user_id: userId,
    feature_key: featureKey,
    event_type: eventType,
    plan_slug: planSlug || 'free',
    plan_id: typeof req === 'object' ? (req.auth?.plans?.['juggler'] || null) : null,
    endpoint: typeof req === 'object' ? `${req.method} ${req.originalUrl || req.url}` : null,
    ip_address: typeof req === 'object' ? (req.ip || req.headers?.['x-forwarded-for'] || null) : null,
    request_id: typeof req === 'object' ? (req.headers?.['x-request-id'] || null) : null,
    value: value ? JSON.stringify(value) : null,
    created_at: new Date()
  }).catch(err => {
    console.error('[feature-gate] Failed to log event:', err.message);
  });
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
  if (featureKey.includes('per_year')) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
      end: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1))
    };
  }
  return { start: new Date(0), end: null };
}

function requireFeature(featurePath) {
  return (req, res, next) => {
    if (!req.planFeatures) {
      return res.status(500).json({ error: 'Plan features not resolved' });
    }

    const value = getNestedValue(req.planFeatures, featurePath);

    if (!value) {
      logFeatureEvent(req, featurePath, 'blocked', {
        current_plan: req.planSlug || 'free'
      });
      return res.status(403).json({
        error: 'Feature not available on your plan',
        code: 'FEATURE_NOT_AVAILABLE',
        feature: featurePath,
        current_plan: req.planSlug || 'free',
        upgrade_required: true
      });
    }

    logFeatureEvent(req, featurePath, 'used', null);
    next();
  };
}

function requireFeatureIncludes(featurePath, valueOrExtractor) {
  return (req, res, next) => {
    if (!req.planFeatures) {
      return res.status(500).json({ error: 'Plan features not resolved' });
    }

    const allowedValues = getNestedValue(req.planFeatures, featurePath);

    const requestedValue = typeof valueOrExtractor === 'function'
      ? valueOrExtractor(req) : valueOrExtractor;

    if (Array.isArray(allowedValues) && allowedValues.includes('all')) {
      logFeatureEvent(req, featurePath, 'used', { selected: requestedValue });
      return next();
    }

    if (requestedValue === undefined || requestedValue === null) {
      return next();
    }

    if (!Array.isArray(allowedValues) || !allowedValues.includes(requestedValue)) {
      logFeatureEvent(req, featurePath, 'blocked', {
        requested: requestedValue,
        available: allowedValues || [],
        current_plan: req.planSlug || 'free'
      });
      return res.status(403).json({
        error: 'Option not available on your plan',
        code: 'OPTION_NOT_AVAILABLE',
        feature: featurePath,
        requested: requestedValue,
        available: allowedValues || [],
        current_plan: req.planSlug || 'free',
        upgrade_required: true
      });
    }

    logFeatureEvent(req.user?.id, featurePath, 'used', req.planSlug, { selected: requestedValue });
    next();
  };
}

async function checkAndIncrement(userId, usageKey, limit, periodStart, periodEnd) {
  await db.raw(`
    INSERT INTO plan_usage (user_id, usage_key, period_start, period_end, \`count\`, limit_value, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, NOW())
    ON DUPLICATE KEY UPDATE
      \`count\` = \`count\` + 1,
      limit_value = ?,
      updated_at = NOW()
  `, [userId, usageKey, periodStart, periodEnd, limit, limit]);

  const row = await db('plan_usage')
    .where('user_id', userId)
    .where('usage_key', usageKey)
    .where('period_start', periodStart)
    .first();

  return {
    allowed: row.count <= limit,
    currentCount: row.count,
    limit
  };
}

function checkUsageLimit(limitKey, options = {}) {
  const usageKey = options.usageKey || limitKey;
  const isCountBased = options.isCountBased || false;

  return async (req, res, next) => {
    if (!req.planFeatures) {
      return res.status(500).json({ error: 'Plan features not resolved' });
    }

    const limit = getNestedValue(req.planFeatures, `limits.${limitKey}`) ??
                  getNestedValue(req.planFeatures, limitKey);
    const isUnlimited = (limit === -1 || limit === undefined);

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const { start: periodStart, end: periodEnd } = isCountBased
        ? { start: new Date(0), end: null }
        : getCurrentPeriodBounds(usageKey);

      // Always count — even for unlimited users — for analytics
      const effectiveLimit = isUnlimited ? 999999999 : limit;
      const result = await checkAndIncrement(userId, usageKey, effectiveLimit, periodStart, periodEnd);

      if (!isUnlimited && !result.allowed) {
        logFeatureEvent(req, limitKey, 'limit_reached', {
          current_usage: result.currentCount, limit
        });
        return res.status(429).json({
          error: 'Usage limit reached',
          code: 'USAGE_LIMIT_REACHED',
          limit_key: limitKey,
          current_usage: result.currentCount,
          limit,
          current_plan: req.planSlug || 'free',
          upgrade_required: true,
          resets_at: periodEnd ? periodEnd.toISOString() : null
        });
      }

      logFeatureEvent(req, limitKey, 'used', {
        count_after: result.currentCount
      });

      next();
    } catch (err) {
      console.error('[feature-gate] Usage check failed:', err.message);
      next();
    }
  };
}

async function decrementUsage(userId, usageKey) {
  try {
    await db('plan_usage')
      .where('user_id', userId)
      .where('usage_key', usageKey)
      .where('count', '>', 0)
      .update({ count: db.raw('`count` - 1'), updated_at: new Date() });
  } catch (err) {
    console.error('[feature-gate] Failed to decrement usage:', err.message);
  }
}

async function cleanupExpiredUsage() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await db('plan_usage')
      .whereNotNull('period_end')
      .where('period_end', '<', cutoff)
      .del();
    if (deleted > 0) console.log(`[plan-usage] Cleaned up ${deleted} expired rows`);
  } catch (err) {
    console.error('[plan-usage] Cleanup failed:', err.message);
  }
}

setInterval(cleanupExpiredUsage, 60 * 60 * 1000);

module.exports = {
  requireFeature,
  requireFeatureIncludes,
  checkUsageLimit,
  decrementUsage,
  cleanupExpiredUsage
};
