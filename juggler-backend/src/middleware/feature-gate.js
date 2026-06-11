/**
 * Feature Gate Middleware for Juggler — THIN express adapter over the user-config
 * slice facade (Phase H4 / W6).
 *
 *   requireFeature(path)         – Boolean flag (403 if false)
 *   requireFeatureIncludes(path) – Array membership (403 if not included)
 *   checkUsageLimit(limitKey)    – Atomic check-and-increment (429 if exceeded)
 *
 * The allow/deny DECISION + the I/O (feature_events log, plan_usage upsert, usage
 * reporting) was extracted into the slice (GateFeature use-case over the W2 pure
 * decision logic + the injected logFeatureEvent/checkAndIncrement/getCurrentPeriodBounds).
 * Each middleware here is THIN: it builds a request-shaped `ctx` from `req`, calls
 * `slices/user-config/facade`, and maps the use-case envelope onto express —
 * `{ status: null }` → next(); `{ status, body }` → res.status(status).json(body).
 *
 * ── PRESERVED LEGACY BUG (FLAG-2, pinned NOT fixed) ──
 * requireFeatureIncludes' membership-success path logs with the buggy 5-positional
 * arg shape — reproduced inside the GateFeature use-case (golden-master H6-7).
 *
 * ── decrementUsage / cleanupExpiredUsage ──
 * These maintenance utilities (NOT part of the gate request path / the W5 use-case
 * surface) are retained verbatim and still touch the shared pool via `../db`.
 */

'use strict';

const db = require('../db');
const facade = require('../slices/user-config/facade');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('feature-gate');

/** Build the request-shaped ctx the GateFeature use-case reads (the legacy `req` fields). */
function ctxFromReq(req) {
  return {
    req,
    planFeatures: req.planFeatures,
    planId: req.planId,
    userId: req.user?.id,
    method: req.method,
    originalUrl: req.originalUrl
  };
}

function requireFeature(featurePath) {
  return (req, res, next) => {
    const result = facade.requireFeature(ctxFromReq(req), featurePath);
    if (result.status === null) return next();
    return res.status(result.status).json(result.body);
  };
}

function requireFeatureIncludes(featurePath, valueOrExtractor) {
  return (req, res, next) => {
    // The valueOrExtractor evaluation is the express edge's job — resolve it here,
    // pass the concrete value to the use-case (legacy feature-gate.js:98-99).
    const requestedValue = typeof valueOrExtractor === 'function'
      ? valueOrExtractor(req) : valueOrExtractor;
    const result = facade.requireFeatureIncludes(ctxFromReq(req), featurePath, requestedValue);
    if (result.status === null) return next();
    return res.status(result.status).json(result.body);
  };
}

function checkUsageLimit(limitKey, options = {}) {
  return async (req, res, next) => {
    const result = await facade.checkUsageLimit(ctxFromReq(req), limitKey, options);
    if (result.status === null) return next();
    return res.status(result.status).json(result.body);
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
    logger.error('[feature-gate] Failed to decrement usage:', { error: err });
  }
}

async function cleanupExpiredUsage() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await db('plan_usage')
      .whereNotNull('period_end')
      .where('period_end', '<', cutoff)
      .del();
    if (deleted > 0) logger.info(`[plan-usage] Cleaned up ${deleted} expired rows`);
  } catch (err) {
    logger.error('[plan-usage] Cleanup failed:', { error: err });
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
