/**
 * GetMyPlan — application query use-case (999.1196).
 *
 * Extracted VERBATIM from my-plan.routes.js GET / handler: walks the
 * resolved plan-feature tree for numeric limits, resolves per-limit usage
 * (entity-count limits via injected counters; rate limits via the plan_usage
 * table + this handler's OWN period-bounds math), resolves the plan display
 * name + subscription/trial status via injected I/O collaborators, and counts
 * disabled items.
 *
 * ── getCurrentPeriodBounds is intentionally its OWN copy ─────────────────────
 * my-plan.routes.js has always had its own getCurrentPeriodBounds, DISTINCT
 * from the one feature-gate.js / the user-config facade's GateFeature wiring
 * use (that copy also has a `per_year` branch this one never had). This is a
 * pre-existing duplication, not something this extraction introduces — merging
 * them would be a behavior change (an untested per_year branch would newly
 * apply to my-plan limits), which is out of scope for a route->slice move.
 *
 * ── my-plan.routes.js stays the composition root ─────────────────────────────
 * Like ProvisionUserOnFirstLogin (jwt-auth middleware), this use-case is wired
 * with my-plan.routes.js's OWN db/entity-limits/payment-service collaborators
 * (not the facade's default singleton wiring) so existing unit tests that mock
 * `middleware/entity-limits` and `lib/db` at the route's require site keep
 * intercepting the exact same calls.
 *
 * @typedef {Object} GetMyPlanDeps
 * @property {Function} db  knex instance (queries plan_usage, tasks_v)
 * @property {Object<string, (userId: string) => Promise<number>>} entityCounters
 *   limit-key -> counter function (e.g. 'limits.active_tasks' -> countActiveTasks)
 * @property {(planId: string) => Promise<string>} getPlanName
 * @property {(userId: string) => Promise<{status: string, trial_end: *}|null>} getSubscriptionStatus
 */

'use strict';

// legacy my-plan.routes.js getCurrentPeriodBounds — preserved VERBATIM,
// including the missing per_year branch (see file header).
function getCurrentPeriodBounds(featureKey) {
  var now = new Date();
  if (featureKey.includes('per_hour')) {
    var start = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
    return { start: start, end: new Date(start.getTime() + 3600000) };
  }
  if (featureKey.includes('per_month')) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    };
  }
  return { start: new Date(0), end: null };
}

// legacy my-plan.routes.js findLimits — preserved VERBATIM (recursive walk of
// the plan-features tree collecting every numeric leaf as a dotted-path key).
function findLimits(obj, allLimits, prefix) {
  Object.entries(obj || {}).forEach(function (entry) {
    var key = entry[0];
    var value = entry[1];
    var fullKey = prefix ? prefix + '.' + key : key;
    if (typeof value === 'number') {
      allLimits[fullKey] = value;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      findLimits(value, allLimits, fullKey);
    }
  });
}

/** @param {GetMyPlanDeps} deps */
function GetMyPlan(deps) {
  this._db = deps.db;
  this._entityCounters = deps.entityCounters;
  this._getPlanName = deps.getPlanName;
  this._getSubscriptionStatus = deps.getSubscriptionStatus;
}

/**
 * @param {Object} input
 * @param {string} input.userId
 * @param {string} input.planId
 * @param {Object} input.features  req.planFeatures (resolvePlanFeatures middleware)
 * @returns {Promise<Object>} the my-plan response body
 */
GetMyPlan.prototype.execute = async function execute(input) {
  var userId = input.userId;
  var planId = input.planId || 'free';
  var features = input.features;
  var db = this._db;
  var entityCounters = this._entityCounters;

  var usage = {};
  var allLimits = {};
  findLimits(features, allLimits, '');

  var keys = Object.keys(allLimits);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var limit = allLimits[key];

    if (limit === -1) {
      // Still fetch actual count for unlimited users (for display)
      var usedUnlimited = 0;
      if (entityCounters[key]) {
        try { usedUnlimited = await entityCounters[key](userId); } catch (_e) { /* fall through to used=0 */ }
      }
      usage[key] = { used: usedUnlimited, limit: null, unlimited: true, resets_at: null };
      continue;
    }

    // Entity-based limits: count from actual tables
    if (entityCounters[key]) {
      try {
        var count = await entityCounters[key](userId);
        usage[key] = { used: count, limit: limit, unlimited: false, resets_at: null };
      } catch (_e2) {
        usage[key] = { used: 0, limit: limit, unlimited: false, resets_at: null };
      }
      continue;
    }

    // Rate-based limits (per_month, per_hour): count from plan_usage table
    var bounds = getCurrentPeriodBounds(key);
    var periodStart = bounds.start;
    var periodEnd = bounds.end;

    var row = await db('plan_usage')
      .where('user_id', userId)
      .where('usage_key', key)
      .where('period_start', periodStart)
      .first();

    usage[key] = {
      used: (row && row.count) || 0,
      limit: limit,
      unlimited: false,
      resets_at: periodEnd ? periodEnd.toISOString() : null
    };
  }

  var planName = await this._getPlanName(planId);

  // Fetch subscription status (trial info) from payment service
  var sub = await this._getSubscriptionStatus(userId);
  var subscriptionStatus = sub ? sub.status : null;
  var trialEnd = sub ? sub.trial_end : null;

  // Count disabled items so the frontend can show a badge/notification
  var disabledCount = 0;
  try {
    var disabledRow = await db('tasks_v')
      .where({ user_id: userId, status: 'disabled' })
      .count('* as count').first();
    disabledCount = parseInt(disabledRow.count, 10);
  } catch (_e3) { /* empty */ }

  return {
    plan_name: planName,
    plan_id: planId,
    features: features,
    usage: usage,
    subscription_status: subscriptionStatus,
    trial_end: trialEnd,
    disabled_items: disabledCount,
  };
};

module.exports = GetMyPlan;
