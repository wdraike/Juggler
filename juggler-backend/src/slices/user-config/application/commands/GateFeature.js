/**
 * GateFeature — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy feature-gate middleware (feature-gate.js) orchestration —
 * `requireFeature`, `requireFeatureIncludes`, `checkUsageLimit` — over the W2 pure
 * decision logic (featureGate.decideRequireFeature / decideRequireFeatureIncludes /
 * resolveUsageLimit + decideUsage) + the injected I/O collaborators (logFeatureEvent,
 * reportUsage, checkAndIncrement, getCurrentPeriodBounds).
 *
 * Each method returns a `{ status, body }` deny/error envelope OR `{ status: null }`
 * (allow → the W6 middleware calls next()). The full HTTP body (with `current_plan`,
 * `upgrade_required`, `resets_at`) is built HERE so the W6 middleware is a pure
 * map — byte-identical to the legacy res.status(...).json(...) (golden-master
 * Surface 6 / H6).
 *
 * ── FLAG-2 (999.371, FIXED) ──────────────────────────────────────────────────
 *   requireFeatureIncludes' SUCCESS path (membership allow, not 'all') previously
 *   called logFeatureEvent with the BUGGY 5-positional-arg shape
 *   `logFeatureEvent(userId, featurePath, 'used', planId, { selected })`
 *   (feature-gate.js:127) — the first arg was req.user?.id (a STRING, not a req),
 *   so logFeatureEvent's object-typeof checks fell to the string branch and plan_id /
 *   endpoint / ip_address / request_id were DROPPED from the persisted feature_events
 *   row (the trailing 5th arg was ignored — logFeatureEvent is a 4-arg function).
 *   NOW corrected to the canonical `logFeatureEvent(req, …)` shape (identical to the
 *   'all'-branch + deny-branch) so plan_id and endpoint are actually written.
 *
 * ── FAIL-OPEN (checkUsageLimit, preserved) ───────────────────────────────────
 *   The legacy checkUsageLimit wraps the count I/O in try/catch and `next()`s on
 *   error (feature-gate.js:205-208) — fail-open. Reproduced: a thrown
 *   checkAndIncrement → log the error + return allow ({ status: null }).
 *
 * ── NO NEW FALLBACKS ── `req.planId || 'free'`, `result.allowed`, the period bounds,
 * and `effectiveLimit = isUnlimited ? 999999999 : limit` are preserved verbatim.
 *
 * @typedef {Object} GateFeatureDeps
 * @property {Function} logFeatureEvent  (reqOrUserId, featureKey, eventType, value, ...rest)
 *   — the feature_events insert (legacy logFeatureEvent). Injected; the FLAG-2 call
 *   shape is reproduced by the caller, not by this collaborator.
 * @property {Function} reportUsage  (opts) — the usage reporter (legacy reportUsage).
 * @property {(userId: string, usageKey: string, limit: number, periodStart: *, periodEnd: *) => Promise<{allowed: boolean, currentCount: number, limit: number}>} checkAndIncrement
 *   the atomic plan_usage upsert+read (legacy checkAndIncrement). Injected.
 * @property {(featureKey: string) => {start: *, end: *}} getCurrentPeriodBounds
 *   the period-window computation (legacy getCurrentPeriodBounds). Injected.
 * @property {Object} [logger]  { error } — for the fail-open log. Defaults to a no-op.
 */

'use strict';

var featureGate = require('../../domain/logic/featureGate');

/** @param {GateFeatureDeps} deps */
function GateFeature(deps) {
  if (!deps || !deps.logFeatureEvent || !deps.reportUsage ||
      !deps.checkAndIncrement || !deps.getCurrentPeriodBounds) {
    throw new Error('GateFeature: { logFeatureEvent, reportUsage, checkAndIncrement, getCurrentPeriodBounds } are required');
  }
  this.logFeatureEvent = deps.logFeatureEvent;
  this.reportUsage = deps.reportUsage;
  this.checkAndIncrement = deps.checkAndIncrement;
  this.getCurrentPeriodBounds = deps.getCurrentPeriodBounds;
  this.logger = deps.logger || { error: function () {} };
}

/**
 * requireFeature(featurePath) orchestration — feature-gate.js:62-88.
 * `ctx` carries the request-shaped data the legacy middleware read off `req`
 * (planFeatures, planId, user, method, originalUrl) so the I/O calls reproduce the
 * legacy arg shapes. The W6 middleware builds `ctx` from `req`.
 *
 * @param {Object} ctx  { req, planFeatures, planId, userId, method, originalUrl }
 * @param {string} featurePath
 * @returns {{status: ?number, body?: Object}}  status null → allow (next()).
 */
GateFeature.prototype.requireFeature = function requireFeature(ctx, featurePath) {
  var decision = featureGate.decideRequireFeature(ctx.planFeatures, featurePath);

  if (decision.outcome === 'error') {
    return { status: 500, body: { error: decision.error } };
  }

  if (decision.outcome === 'deny') {
    this.logFeatureEvent(ctx.req, featurePath, 'blocked', { current_plan: ctx.planId || 'free' });
    this.reportUsage({ userId: ctx.userId, planId: ctx.planId, featureKey: featurePath, eventType: 'blocked', endpoint: ctx.method + ' ' + ctx.originalUrl });
    return {
      status: 403,
      body: {
        error: 'Feature not available on your plan',
        code: 'FEATURE_NOT_AVAILABLE',
        feature: featurePath,
        current_plan: ctx.planId || 'free',
        upgrade_required: true
      }
    };
  }

  // allow
  this.logFeatureEvent(ctx.req, featurePath, 'used', null);
  this.reportUsage({ userId: ctx.userId, planId: ctx.planId, featureKey: featurePath, eventType: 'used', endpoint: ctx.method + ' ' + ctx.originalUrl });
  return { status: null };
};

/**
 * requireFeatureIncludes(featurePath, requestedValue) orchestration —
 * feature-gate.js:90-130. `requestedValue` is the already-extracted value (the
 * legacy `valueOrExtractor` evaluation is the W6 middleware's job — it passes the
 * resolved value here).
 *
 * @param {Object} ctx  { req, planFeatures, planId, userId }
 * @param {string} featurePath
 * @param {*} requestedValue
 * @returns {{status: ?number, body?: Object}}
 */
GateFeature.prototype.requireFeatureIncludes = function requireFeatureIncludes(ctx, featurePath, requestedValue) {
  if (!ctx.planFeatures) {
    return { status: 500, body: { error: 'Plan features not resolved' } };
  }

  var FeatureKey = require('../../domain/value-objects/FeatureKey');
  var allowedValues = FeatureKey.resolvePath(ctx.planFeatures, featurePath);

  // 'all' branch (feature-gate.js:101-104) — correct logFeatureEvent(req, …) shape.
  if (Array.isArray(allowedValues) && allowedValues.includes('all')) {
    this.logFeatureEvent(ctx.req, featurePath, 'used', { selected: requestedValue });
    return { status: null };
  }

  // undefined/null requested → allow, no log (feature-gate.js:106-108).
  if (requestedValue === undefined || requestedValue === null) {
    return { status: null };
  }

  var decision = featureGate.decideRequireFeatureIncludes(ctx.planFeatures, featurePath, requestedValue);

  if (decision.outcome === 'deny') {
    this.logFeatureEvent(ctx.req, featurePath, 'blocked', {
      requested: requestedValue,
      available: allowedValues || [],
      current_plan: ctx.planId || 'free'
    });
    return {
      status: 403,
      body: {
        error: 'Option not available on your plan',
        code: 'OPTION_NOT_AVAILABLE',
        feature: featurePath,
        requested: requestedValue,
        available: allowedValues || [],
        current_plan: ctx.planId || 'free',
        upgrade_required: true
      }
    };
  }

  // allow (membership) — FLAG-2 (999.371, FIXED): the legacy success path passed
  // userId as the FIRST positional arg (feature-gate.js:127), which made
  // logFeatureEvent's `typeof reqOrUserId === 'object'` checks fall to the string
  // branch — dropping plan_id, endpoint, ip_address, request_id from the persisted
  // feature_events row (and ignoring the trailing 5th arg, since logFeatureEvent has
  // a 4-arg signature). Corrected to the canonical `logFeatureEvent(req, …)` shape
  // (identical to the 'all' branch above) so plan_id + endpoint are actually written.
  this.logFeatureEvent(ctx.req, featurePath, 'used', { selected: requestedValue });
  return { status: null };
};

/**
 * checkUsageLimit(limitKey, options) orchestration — feature-gate.js:155-209.
 * Reproduces: planFeatures-missing 500, no-userId 401, the period-bound selection,
 * the always-count (even unlimited) checkAndIncrement, the post-count decision
 * (W2 decideUsage), and the fail-open try/catch.
 *
 * @param {Object} ctx  { planFeatures, planId, userId, method, originalUrl }
 * @param {string} limitKey
 * @param {Object} [options]  { usageKey?, isCountBased? }
 * @returns {Promise<{status: ?number, body?: Object}>}
 */
GateFeature.prototype.checkUsageLimit = async function checkUsageLimit(ctx, limitKey, options) {
  var opts = options || {};
  var usageKey = opts.usageKey || limitKey;
  var isCountBased = opts.isCountBased || false;

  if (!ctx.planFeatures) {
    return { status: 500, body: { error: 'Plan features not resolved' } };
  }

  var resolved = featureGate.resolveUsageLimit(ctx.planFeatures, limitKey);
  var limit = resolved.limit;
  var isUnlimited = resolved.isUnlimited;

  var userId = ctx.userId;
  if (!userId) {
    return { status: 401, body: { error: 'Authentication required' } };
  }

  try {
    var bounds = isCountBased
      ? { start: new Date(0), end: null }
      : this.getCurrentPeriodBounds(usageKey);
    var periodStart = bounds.start;
    var periodEnd = bounds.end;

    // Always count — even for unlimited users — for analytics (feature-gate.js:179).
    var effectiveLimit = isUnlimited ? 999999999 : limit;
    var result = await this.checkAndIncrement(userId, usageKey, effectiveLimit, periodStart, periodEnd);

    var decision = featureGate.decideUsage(result.currentCount, limit, isUnlimited, limitKey);

    if (decision.outcome === 'deny') {
      this.logFeatureEvent(ctx.req, limitKey, 'limit_reached', { current_usage: result.currentCount, limit: limit });
      this.reportUsage({ userId: userId, planId: ctx.planId, featureKey: limitKey, eventType: 'limit_reached', endpoint: ctx.method + ' ' + ctx.originalUrl });
      return {
        status: 429,
        body: {
          error: 'Usage limit reached',
          code: 'USAGE_LIMIT_REACHED',
          limit_key: limitKey,
          current_usage: result.currentCount,
          limit: limit,
          current_plan: ctx.planId || 'free',
          upgrade_required: true,
          resets_at: periodEnd ? periodEnd.toISOString() : null
        }
      };
    }

    // allow
    this.logFeatureEvent(ctx.req, limitKey, 'used', { count_after: result.currentCount });
    this.reportUsage({ userId: userId, planId: ctx.planId, featureKey: limitKey, eventType: 'used', endpoint: ctx.method + ' ' + ctx.originalUrl });
    return { status: null };
  } catch (err) {
    // fail-open (feature-gate.js:205-208)
    this.logger.error('[feature-gate] Usage check failed:', { error: err });
    return { status: null };
  }
};

module.exports = GateFeature;
