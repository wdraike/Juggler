/**
 * EntityLimit — value object over a plan's numeric limit for a countable entity
 * (active_tasks, recurring_templates, projects, locations, schedule_templates) or
 * a usage limit (ai_commands_per_month, …).
 *
 * CHARACTERIZED, NOT assumed — the "unlimited" sentinel and the block predicate
 * are the EXACT semantics of the two legacy middleware:
 *
 *   entity-limits.js:30  — `if (limit === -1 || limit === undefined || limit === null) return next();` (unlimited)
 *   entity-limits.js:43  — `if (currentCount + batchSize > limit) → 403` (block)
 *   feature-gate.js:166  — `const isUnlimited = (limit === -1 || limit === undefined);` (usage unlimited)
 *   feature-gate.js:149  — `allowed: row.count <= limit` (usage allow predicate)
 *
 * NOTE the SUBTLE difference, pinned as-is (NOT unified):
 *   - ENTITY limits treat `null` AND `undefined` AND `-1` as unlimited.
 *   - USAGE limits (feature-gate.checkUsageLimit) treat `-1` AND `undefined` as
 *     unlimited but do NOT special-case `null`. This VO exposes BOTH predicates
 *     ({@link EntityLimit.isEntityUnlimited} vs {@link EntityLimit.isUsageUnlimited})
 *     rather than collapsing them, so the application layer reproduces each
 *     middleware's behavior byte-identically. Do not "fix" the asymmetry here —
 *     it is the legacy behavior (telly W1 pins both paths).
 *
 * PURE: zero infra imports. No env, no DB. All methods are deterministic
 * input→output.
 */

'use strict';

var UNLIMITED = -1;

/**
 * @param {number} value The raw limit value (a non-negative integer, or -1 for
 *   unlimited). `undefined`/`null` represent "no limit declared" and are handled
 *   by the static predicates — they are NOT accepted as a constructed limit.
 * @throws {Error} if `value` is not a finite number.
 */
function EntityLimit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('EntityLimit must be a finite number (use the static predicates for undefined/null), got: ' + JSON.stringify(value));
  }
  this.value = value;
  Object.freeze(this);
}

/** The unlimited sentinel (-1). @type {number} */
EntityLimit.UNLIMITED = UNLIMITED;

/**
 * ENTITY-limit unlimited predicate — verbatim from entity-limits.js:30.
 * `-1`, `undefined`, and `null` all mean unlimited.
 * @param {*} limit
 * @returns {boolean}
 */
EntityLimit.isEntityUnlimited = function isEntityUnlimited(limit) {
  return limit === UNLIMITED || limit === undefined || limit === null;
};

/**
 * USAGE-limit unlimited predicate — verbatim from feature-gate.js:166.
 * `-1` and `undefined` mean unlimited; `null` is NOT treated as unlimited here
 * (preserves the legacy asymmetry — see file header).
 * @param {*} limit
 * @returns {boolean}
 */
EntityLimit.isUsageUnlimited = function isUsageUnlimited(limit) {
  return limit === UNLIMITED || limit === undefined;
};

/**
 * ENTITY-limit block predicate — verbatim from entity-limits.js:43.
 * Blocks when `currentCount + addingCount > limit`. Caller must already have
 * decided the limit is NOT unlimited (entity semantics).
 * @param {number} currentCount  the existing count (entity-limits parses via parseInt)
 * @param {number} addingCount   how many are being added (batchSize; default 1 in legacy)
 * @param {number} limit         the plan limit
 * @returns {boolean} true => BLOCK (403), false => allow.
 */
EntityLimit.blocksEntity = function blocksEntity(currentCount, addingCount, limit) {
  return currentCount + addingCount > limit;
};

/**
 * USAGE-limit allow predicate — verbatim from feature-gate.js:149
 * (`allowed: row.count <= limit`). Returns true when the post-increment count is
 * within the limit (allow); the legacy code blocks (429) when `!allowed`.
 * @param {number} countAfterIncrement
 * @param {number} limit
 * @returns {boolean} true => allowed, false => limit reached (429).
 */
EntityLimit.usageAllows = function usageAllows(countAfterIncrement, limit) {
  return countAfterIncrement <= limit;
};

/** @returns {boolean} whether this constructed limit is the unlimited sentinel. */
EntityLimit.prototype.isUnlimited = function isUnlimited() {
  return this.value === UNLIMITED;
};

/** @returns {number} the raw limit value. */
EntityLimit.prototype.valueOf = function valueOf() {
  return this.value;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
EntityLimit.prototype.equals = function equals(other) {
  return other instanceof EntityLimit && other.value === this.value;
};

module.exports = EntityLimit;
