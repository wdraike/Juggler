/**
 * FeatureKey — value object over a dotted feature path the gate logic resolves
 * against a plan's `features` object (e.g. `'data.export'`, `'tasks.placementMode'`,
 * `'limits.active_tasks'`).
 *
 * CHARACTERIZED, NOT assumed: the legacy `feature-gate.js` and `entity-limits.js`
 * resolve a feature by splitting on `'.'` and reducing into the features object:
 *
 *     getNestedValue(obj, path) =>
 *       path.split('.').reduce((o, key) => o?.[key], obj)
 *
 * (feature-gate.js:17-19, entity-limits.js:12-14 — byte-identical). The golden-
 * master exercises `'data.export'` (H6-1/H6-2), `'tasks.placementMode'`
 * (H6-4..H6-7), `'limits.projects'` (H9-3), `'limits.active_tasks'`, etc.
 *
 * This VO wraps that path and exposes the EXACT same resolution as a PURE function
 * ({@link FeatureKey#resolve}) so the application layer can resolve a feature
 * without re-implementing the reduce inline. The byte-for-byte behavior — including
 * the optional-chaining short-circuit on a missing intermediate (`o?.[key]`) — is
 * preserved.
 *
 * PURE: zero infra imports. No env, no DB.
 */

'use strict';

/**
 * @param {string} value A non-empty dotted feature path.
 * @throws {Error} if `value` is not a non-empty string.
 */
function FeatureKey(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('FeatureKey must be a non-empty string, got: ' + JSON.stringify(value));
  }
  this.value = value;
  this.segments = Object.freeze(value.split('.'));
  Object.freeze(this);
}

/**
 * Resolve this feature path against a features object, byte-identical to the
 * legacy `getNestedValue` (path.split('.').reduce((o, key) => o?.[key], obj)).
 * Returns `undefined` if any intermediate is null/undefined.
 *
 * @param {Object} features The plan's resolved features object (`req.planFeatures`).
 * @returns {*} the value at this path, or `undefined`.
 */
FeatureKey.prototype.resolve = function resolve(features) {
  return this.segments.reduce(function(o, key) {
    return o == null ? undefined : o[key];
  }, features);
};

/**
 * Static convenience: resolve a raw dotted path against a features object — the
 * verbatim port of `getNestedValue(obj, path)` from feature-gate.js / entity-limits.js.
 * @param {Object} features
 * @param {string} path
 * @returns {*}
 */
FeatureKey.resolvePath = function resolvePath(features, path) {
  return path.split('.').reduce(function(o, key) {
    return o == null ? undefined : o[key];
  }, features);
};

/** @returns {string} the raw dotted path. */
FeatureKey.prototype.toString = function toString() {
  return this.value;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
FeatureKey.prototype.equals = function equals(other) {
  return other instanceof FeatureKey && other.value === this.value;
};

/**
 * Factory. Returns the input unchanged if it is already a FeatureKey.
 * @param {(FeatureKey|string)} value
 * @returns {FeatureKey}
 */
FeatureKey.from = function from(value) {
  if (value instanceof FeatureKey) return value;
  return new FeatureKey(value);
};

module.exports = FeatureKey;
