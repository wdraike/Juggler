/**
 * featureGate — PURE allow/deny decision logic relocated from
 * `src/middleware/feature-gate.js` (Phase H4 / W2).
 *
 * PURE: zero infra imports — no db, no fetch, no process.env, no express. The
 * legacy middleware's I/O (the `feature_events` insert via logFeatureEvent, the
 * `reportUsage` call, the `plan_usage` upsert in checkAndIncrement) STAYS in the
 * legacy file for now (W3/W4/W5 relocate the I/O). What is relocated here is the
 * pure input→decision computation the middleware wraps around that I/O.
 *
 * BEHAVIOR-PRESERVING (byte-identical to the W1 golden-master, Surface 6 / H6):
 *   - decideRequireFeature      ⇔ requireFeature(featurePath)       (feature-gate.js:62-88)
 *   - decideRequireFeatureIncludes ⇔ requireFeatureIncludes(...)    (feature-gate.js:90-130)
 *   - decideUsage               ⇔ checkUsageLimit(...) post-count   (feature-gate.js:155-210)
 *
 * Each returns a DECISION descriptor (a plain object) — the I/O-bearing middleware
 * maps the descriptor to res.status(...).json(...)/next(). No response shape is
 * computed here beyond the codes/fields the golden-master pins, so the middleware
 * (W5/W6) can reproduce the exact HTTP body.
 *
 * FLAG-2 (pinned, NOT fixed): the legacy `requireFeatureIncludes` success path
 * calls logFeatureEvent with a BUGGY arg shape (feature-gate.js:127 passes
 * req.user?.id as the first arg). That bug lives entirely in the I/O (logging)
 * call, NOT in the allow/deny decision — the decision (allow on membership) is
 * correct and is what this pure module reproduces. The buggy log call is left in
 * the legacy file; this module does not log. (golden-master H6-FLAG2.)
 */

'use strict';

var FeatureKey = require('../value-objects/FeatureKey');
var EntityLimit = require('../value-objects/EntityLimit');

/**
 * @typedef {Object} GateDecision
 * @property {('allow'|'deny'|'error')} outcome
 * @property {?string} code       — the response `code` (e.g. 'FEATURE_NOT_AVAILABLE'), null on allow.
 * @property {?number} status     — the HTTP status the middleware should write (null on allow → next()).
 */

/**
 * requireFeature decision — verbatim logic of feature-gate.js:62-88.
 *
 * - planFeatures missing  → error 500 ('Plan features not resolved').
 * - feature value falsy   → deny 403 FEATURE_NOT_AVAILABLE (legacy uses `if (!value)`).
 * - otherwise             → allow (next()).
 *
 * @param {Object} planFeatures  req.planFeatures
 * @param {string} featurePath   the dotted feature path
 * @returns {GateDecision & {feature?: string}}
 */
function decideRequireFeature(planFeatures, featurePath) {
  if (!planFeatures) {
    return { outcome: 'error', status: 500, code: null, error: 'Plan features not resolved' };
  }
  var value = FeatureKey.resolvePath(planFeatures, featurePath);
  if (!value) {
    return {
      outcome: 'deny',
      status: 403,
      code: 'FEATURE_NOT_AVAILABLE',
      feature: featurePath
    };
  }
  return { outcome: 'allow', status: null, code: null };
}

/**
 * requireFeatureIncludes decision — verbatim logic of feature-gate.js:90-130.
 *
 * Order of checks is preserved EXACTLY (the golden-master H6-4..H6-7 pins it):
 *   1. planFeatures missing                       → error 500.
 *   2. allowedValues is an array including 'all'   → allow (regardless of requested).
 *   3. requestedValue is undefined OR null         → allow (no value to check).
 *   4. allowedValues not an array OR does not
 *      include requestedValue                      → deny 403 OPTION_NOT_AVAILABLE.
 *   5. otherwise                                   → allow.
 *
 * @param {Object} planFeatures  req.planFeatures
 * @param {string} featurePath   the dotted feature path
 * @param {*} requestedValue     the already-extracted requested value (legacy
 *   computes this from valueOrExtractor BEFORE this decision — that extraction is
 *   the middleware's job; the pure decision takes the resolved value).
 * @returns {GateDecision & {feature?: string, requested?: *, available?: Array}}
 */
function decideRequireFeatureIncludes(planFeatures, featurePath, requestedValue) {
  if (!planFeatures) {
    return { outcome: 'error', status: 500, code: null, error: 'Plan features not resolved' };
  }
  var allowedValues = FeatureKey.resolvePath(planFeatures, featurePath);

  if (Array.isArray(allowedValues) && allowedValues.includes('all')) {
    return { outcome: 'allow', status: null, code: null };
  }

  if (requestedValue === undefined || requestedValue === null) {
    return { outcome: 'allow', status: null, code: null };
  }

  if (!Array.isArray(allowedValues) || !allowedValues.includes(requestedValue)) {
    return {
      outcome: 'deny',
      status: 403,
      code: 'OPTION_NOT_AVAILABLE',
      feature: featurePath,
      requested: requestedValue,
      available: allowedValues || []
    };
  }

  return { outcome: 'allow', status: null, code: null };
}

/**
 * Resolve a usage limit from planFeatures — verbatim from feature-gate.js:164-166:
 *   limit = limits.<key> ?? <key>;  isUnlimited = (limit === -1 || limit === undefined)
 *
 * @param {Object} planFeatures
 * @param {string} limitKey
 * @returns {{limit: *, isUnlimited: boolean}}
 */
function resolveUsageLimit(planFeatures, limitKey) {
  var limit = FeatureKey.resolvePath(planFeatures, 'limits.' + limitKey);
  if (limit === undefined || limit === null) {
    // ?? semantics: fall through to the bare key only when the `limits.<key>`
    // path is null/undefined (matches `?? getNestedValue(planFeatures, limitKey)`).
    var bare = FeatureKey.resolvePath(planFeatures, limitKey);
    // We are already inside the `limit === undefined || limit === null` guard and
    // nothing mutates `limit` in between, so the bare key always applies here.
    limit = bare;
  }
  return { limit: limit, isUnlimited: EntityLimit.isUsageUnlimited(limit) };
}

/**
 * Usage allow/deny decision GIVEN the post-increment count — verbatim from
 * feature-gate.js:182 (`if (!isUnlimited && !result.allowed)` → 429) where
 * `result.allowed = row.count <= limit` (feature-gate.js:149).
 *
 * The I/O (the plan_usage upsert in checkAndIncrement, the logFeatureEvent /
 * reportUsage calls) STAYS in the middleware; this pure function decides allow vs
 * USAGE_LIMIT_REACHED from the count the I/O returned.
 *
 * NOTE the legacy authentication / planFeatures-missing guards (500/401) fire
 * BEFORE the count is fetched; they are middleware concerns and are NOT modeled
 * here (no count to decide on yet). This decides only the post-count branch.
 *
 * @param {number} countAfterIncrement  result.currentCount from checkAndIncrement
 * @param {*} limit                      the resolved usage limit
 * @param {boolean} isUnlimited          from resolveUsageLimit
 * @param {string} limitKey              for the response body
 * @returns {GateDecision & {limit_key?: string, current_usage?: number, limit?: *}}
 */
function decideUsage(countAfterIncrement, limit, isUnlimited, limitKey) {
  var allowed = EntityLimit.usageAllows(countAfterIncrement, limit);
  if (!isUnlimited && !allowed) {
    return {
      outcome: 'deny',
      status: 429,
      code: 'USAGE_LIMIT_REACHED',
      limit_key: limitKey,
      current_usage: countAfterIncrement,
      limit: limit
    };
  }
  return { outcome: 'allow', status: null, code: null };
}

module.exports = {
  decideRequireFeature: decideRequireFeature,
  decideRequireFeatureIncludes: decideRequireFeatureIncludes,
  resolveUsageLimit: resolveUsageLimit,
  decideUsage: decideUsage
};
