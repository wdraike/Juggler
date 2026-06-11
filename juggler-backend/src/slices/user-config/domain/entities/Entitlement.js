/**
 * Entitlement — the resolved plan/entitlement shape the legacy entitlement code
 * threads through the request (Phase H4 / W2).
 *
 * Models the `{ planId, planFeatures }` pair that plan-features.middleware's
 * resolvePlanFeatures attaches to the request (`req.planId` + `req.planFeatures`)
 * and that feature-gate.js / entity-limits.js read. Verified against:
 *   - plan-features.middleware.js:186-189 — `req.planId = realPlanId;
 *     req.planFeatures = allFeatures[realPlanId];`
 *   - feature-gate.js / entity-limits.js  — read `req.planFeatures` (limits, flags,
 *     arrays) + `req.planId` for response bodies.
 *   - the W1 golden-master UNLIMITED_PLAN_FEATURES shape (limits/ai/calendar/
 *     scheduling/tasks/data) and the slug-keyed planId.
 *
 * SLUG-KEYING (BINDING): the planId is a plan identifier resolved via the product
 * SLUG (`'juggler'`); it is NOT a product UUID. This entity does NOT validate the
 * planId format (legacy planIds are opaque strings like 'plan-starter'/'free'),
 * but it carries an OPTIONAL {@link Entitlement#productSlug} PlanSlug — when the
 * caller supplies the product slug, it is coerced through PlanSlug which REJECTS a
 * UUID. The plan lookup that produced this entitlement was slug-keyed by
 * construction (see domain/logic/entitlement.resolvePlanIdBySlug).
 *
 * PURE: zero infra imports — no fetch, no env, no caches. The fetch + caches that
 * PRODUCE an Entitlement live in the W4 adapter; this is the immutable result
 * shape the application/gate layers consume.
 *
 * BEHAVIOR-PRESERVING: carries planId + planFeatures verbatim — no defaulting, no
 * coercion of the features object (anything else would diverge from the gate
 * decisions the golden-master pins). The `free` fallback decision lives in
 * domain/logic/entitlement.decideResolvePlan, not here.
 */

'use strict';

var PlanSlug = require('../value-objects/PlanSlug');
var FeatureKey = require('../value-objects/FeatureKey');

/**
 * @param {Object} props
 * @param {string} props.planId        the resolved plan id (e.g. 'plan-starter',
 *   'free'). Slug-keyed lookup produced it; an opaque non-empty string.
 * @param {Object} props.planFeatures  the resolved features object.
 * @param {(PlanSlug|string)} [props.productSlug]  optional product slug — coerced
 *   through PlanSlug (rejects UUID). Defaults to undefined (not required by the
 *   legacy shape, which only carries planId + planFeatures).
 * @throws {Error} if planId is not a non-empty string, planFeatures is not an
 *   object, or productSlug (when supplied) is UUID-shaped / unknown.
 */
function Entitlement(props) {
  if (!props || typeof props !== 'object') {
    throw new Error('Entitlement requires a props object');
  }
  if (typeof props.planId !== 'string' || props.planId.length === 0) {
    throw new Error('Entitlement.planId must be a non-empty string, got: ' + JSON.stringify(props.planId));
  }
  if (!props.planFeatures || typeof props.planFeatures !== 'object') {
    throw new Error('Entitlement.planFeatures must be an object, got: ' + JSON.stringify(props.planFeatures));
  }
  this.planId = props.planId;
  this.planFeatures = props.planFeatures; // verbatim — not cloned/coerced
  // Optional product slug — enforces slug-keying when present (rejects UUID).
  this.productSlug = props.productSlug === undefined
    ? undefined
    : PlanSlug.from(props.productSlug);
  Object.freeze(this);
}

/**
 * Resolve a feature flag/value from this entitlement's features — byte-identical
 * to the gate's getNestedValue (delegates to FeatureKey).
 * @param {string} featurePath  dotted path, e.g. 'data.export' or 'limits.projects'.
 * @returns {*}
 */
Entitlement.prototype.feature = function feature(featurePath) {
  return FeatureKey.resolvePath(this.planFeatures, featurePath);
};

/**
 * Resolve a numeric entity/usage limit (`limits.<key>`) from this entitlement.
 * @param {string} limitName  e.g. 'active_tasks', 'projects'.
 * @returns {*}
 */
Entitlement.prototype.limit = function limit(limitName) {
  return FeatureKey.resolvePath(this.planFeatures, 'limits.' + limitName);
};

/**
 * @param {*} other
 * @returns {boolean}
 */
Entitlement.prototype.equals = function equals(other) {
  return other instanceof Entitlement && other.planId === this.planId;
};

/**
 * Build an Entitlement from the resolved `{ planId, planFeatures }` pair the
 * middleware attaches to the request.
 * @param {{planId: string, planFeatures: Object, productSlug?: (PlanSlug|string)}} props
 * @returns {Entitlement}
 */
Entitlement.of = function of(props) {
  if (props instanceof Entitlement) return props;
  return new Entitlement(props);
};

module.exports = Entitlement;
