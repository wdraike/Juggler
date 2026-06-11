/**
 * entityLimit — PURE count→limit→allow/block computation relocated from
 * `src/middleware/entity-limits.js` (Phase H4 / W2).
 *
 * PURE: zero infra imports — no db, no fetch, no env, no express. The DB COUNT
 * queries (countActiveTasks/countProjects/countLocations/countScheduleTemplates,
 * etc.) STAY in the legacy file (they are the I/O the W3 KnexConfigRepository will
 * absorb). What is relocated here is the pure decision the middleware computes
 * AFTER it has the current count: unlimited short-circuit + the
 * `currentCount + adding > limit` block.
 *
 * BEHAVIOR-PRESERVING (byte-identical to W1 golden-master, Surface 8 / H9):
 *   - decideEntityLimit       ⇔ checkEntityLimit factory body  (entity-limits.js:23-62)
 *   - decideIncomingCountLimit⇔ checkLocationLimit body        (entity-limits.js:139-157)
 *   - countScheduleTemplatesFromBlocks ⇔ the pure block-count
 *                               inside countScheduleTemplates  (entity-limits.js:108-119)
 *
 * The unlimited / block predicates delegate to the EntityLimit VO (which pins the
 * `-1 | undefined | null` entity-unlimited rule and the `count + add > limit`
 * block rule verbatim).
 */

'use strict';

var FeatureKey = require('../value-objects/FeatureKey');
var EntityLimit = require('../value-objects/EntityLimit');

/**
 * @typedef {Object} LimitDecision
 * @property {('allow'|'deny')} outcome
 * @property {?number} status      — 403 on deny, null on allow.
 * @property {?string} code        — 'ENTITY_LIMIT_REACHED' on deny, null on allow.
 */

/**
 * checkEntityLimit decision — verbatim logic of entity-limits.js:29-56.
 *
 * - limit unlimited (-1 | undefined | null) → allow (the legacy `return next()`).
 * - currentCount + batchSize > limit        → deny 403 ENTITY_LIMIT_REACHED.
 * - otherwise                               → allow.
 *
 * The legacy `planFeatures missing → 500` and `userId missing → 401` guards fire
 * BEFORE the count is fetched; those are middleware concerns and are NOT modeled
 * here (no count to decide on). The DB error fail-open (entity-limits.js:57-60,
 * golden-master H9-4 / H9-elmoB1) is likewise a middleware try/catch around the
 * COUNT I/O — preserved in the legacy file, out of scope for this pure decision.
 *
 * @param {*} limit         the resolved plan limit (limits.<entity>)
 * @param {number} currentCount  the count the DB returned (entity-limits parses via parseInt)
 * @param {number} [batchSize=1] how many are being created
 * @param {string} limitKey  the feature path, e.g. 'limits.projects' (for the body)
 * @returns {LimitDecision & {limit_key?: string, current_count?: number, limit?: *, attempting_to_add?: number}}
 */
function decideEntityLimit(limit, currentCount, batchSize, limitKey) {
  var adding = (batchSize === undefined || batchSize === null) ? 1 : batchSize;

  if (EntityLimit.isEntityUnlimited(limit)) {
    return { outcome: 'allow', status: null, code: null };
  }

  if (EntityLimit.blocksEntity(currentCount, adding, limit)) {
    return {
      outcome: 'deny',
      status: 403,
      code: 'ENTITY_LIMIT_REACHED',
      limit_key: limitKey,
      current_count: currentCount,
      limit: limit,
      attempting_to_add: adding
    };
  }

  return { outcome: 'allow', status: null, code: null };
}

/**
 * checkLocationLimit decision — verbatim logic of entity-limits.js:139-157.
 *
 * Locations use PUT (replace-all), so the legacy code checks the INCOMING count
 * (the array length) vs limit — NOT a DB count. The block predicate here is
 * `incomingCount > limit` (strictly greater), which differs from the
 * `current + add > limit` form because the incoming array fully replaces the set.
 * Pinned as-is (golden-master H9-6/H9-7/H9-8).
 *
 * @param {*} limit          limits.locations
 * @param {number} incomingCount  the replacement array length
 * @param {string} [limitKey='limits.locations']
 * @returns {LimitDecision & {limit_key?: string, current_count?: number, limit?: *}}
 */
function decideIncomingCountLimit(limit, incomingCount, limitKey) {
  var key = limitKey || 'limits.locations';
  if (EntityLimit.isEntityUnlimited(limit)) {
    return { outcome: 'allow', status: null, code: null };
  }
  if (incomingCount > limit) {
    return {
      outcome: 'deny',
      status: 403,
      code: 'ENTITY_LIMIT_REACHED',
      limit_key: key,
      current_count: incomingCount,
      limit: limit
    };
  }
  return { outcome: 'allow', status: null, code: null };
}

/**
 * Resolve a `limits.<entity>` value from planFeatures (the legacy
 * `getNestedValue(req.planFeatures, limitKey)` call). Pure path resolution.
 * @param {Object} planFeatures
 * @param {string} limitKey  full path, e.g. 'limits.projects'
 * @returns {*}
 */
function resolveLimit(planFeatures, limitKey) {
  return FeatureKey.resolvePath(planFeatures, limitKey);
}

/**
 * Pure block-count from a parsed `time_blocks` object — verbatim from
 * countScheduleTemplates' inner logic (entity-limits.js:113-118):
 *   count unique day keys whose value is a non-empty array, or a truthy non-array.
 *
 * The DB read (db('user_config')...first()) STAYS in the legacy file; this
 * function takes the already-parsed blocks object and returns the count
 * (golden-master H9-11 / H9-12 pin: {Mon:[2 blocks], Tue:[], Wed:[1]} → 2).
 *
 * @param {?Object} blocks  the parsed config_value (time_blocks), or null/undefined.
 * @returns {number} the count of day keys with defined blocks (0 if no blocks).
 */
function countScheduleTemplatesFromBlocks(blocks) {
  if (!blocks || typeof blocks !== 'object') return 0;
  return Object.keys(blocks).filter(function(k) {
    var v = blocks[k];
    return Array.isArray(v) ? v.length > 0 : !!v;
  }).length;
}

module.exports = {
  decideEntityLimit: decideEntityLimit,
  decideIncomingCountLimit: decideIncomingCountLimit,
  resolveLimit: resolveLimit,
  countScheduleTemplatesFromBlocks: countScheduleTemplatesFromBlocks
};
