/**
 * EnforceEntityLimit — application command use-case (Phase H4 / W5).
 *
 * Reproduces the legacy entity-limits middleware (entity-limits.js) orchestration
 * over the W3 ConfigRepositoryPort counts + the W2 pure entityLimit decision logic.
 *
 * Maps to the legacy middleware factory + the pre-built gates:
 *   check(ctx, limitKey, countKind, options)  ⇔ checkEntityLimit(limitKey, countFn, options)
 *       (checkTaskLimit / checkRecurringLimit / checkProjectLimit / checkScheduleTemplateLimit)
 *   checkLocation(ctx, incomingCount)          ⇔ checkLocationLimit (incoming-count form)
 *   checkTaskOrRecurring(ctx, taskType, ...)   ⇔ checkTaskOrRecurringLimit (dispatch)
 *   checkBatch(ctx, items)                     ⇔ checkBatchTaskLimits (both limits)
 *
 * Each returns `{ status, body }` (deny/error) OR `{ status: null }` (allow →
 * next()). The full HTTP body (with current_plan/upgrade_required/attempting_to_add)
 * is built here, byte-identical to the legacy res.status(403).json(...)
 * (golden-master Surface 8 / H9).
 *
 * ── PRESERVED LEGACY BEHAVIOR ────────────────────────────────────────────────
 *   - planFeatures-missing → 500; no-userId → 401 (the guards that fire BEFORE the
 *     count; not modeled in W2 which only decides post-count).
 *   - DB-error handling: the `check` factory's count error is now FAIL-CLOSED
 *     (999.370, user-approved) — a thrown count → log + return 503
 *     ('Entitlement check temporarily unavailable') so creation is BLOCKED during a
 *     DB outage, NOT silently allowed. (The legacy entity-limits.js:57-60 fail-open
 *     next() is intentionally overridden here. checkBatch ALSO fail-closes — see its
 *     catch — for symmetry, so the batch endpoint can't be used to bypass the limit
 *     during a DB outage; 999.370.)
 *   - countScheduleTemplates: read the time_blocks config row, parse, count unique
 *     day keys with blocks (W2 countScheduleTemplatesFromBlocks); a parse failure →
 *     0 (the legacy inner try/catch, entity-limits.js:117-119).
 *
 * ── NO NEW FALLBACKS ── `req.planId || 'free'`, the unlimited short-circuit, and
 * the `current + add > limit` / `incoming > limit` predicates preserved verbatim.
 *
 * @typedef {Object} EnforceEntityLimitDeps
 * @property {import('../../domain/ports/ConfigRepositoryPort')} repo
 * @property {Object} [logger]  { error } — for the fail-open log. Defaults to a no-op.
 */

'use strict';

var entityLimit = require('../../domain/logic/entityLimit');
var EntityLimit = require('../../domain/value-objects/EntityLimit');

// countKind → repo method (the legacy per-entity countFn).
var COUNT_METHODS = {
  active_tasks: 'countActiveTasks',
  recurring_templates: 'countRecurringTemplates',
  projects: 'countProjects',
  locations: 'countLocations'
};

/** @param {EnforceEntityLimitDeps} deps */
function EnforceEntityLimit(deps) {
  if (!deps || !deps.repo) throw new Error('EnforceEntityLimit: { repo } is required');
  this.repo = deps.repo;
  this.logger = deps.logger || { error: function () {} };
}

EnforceEntityLimit.prototype._denyBody = function _denyBody(decision, ctx, extra) {
  return Object.assign({
    error: "You've reached the limit for your plan",
    code: 'ENTITY_LIMIT_REACHED',
    limit_key: decision.limit_key,
    current_count: decision.current_count,
    limit: decision.limit,
    current_plan: ctx.planId || 'free',
    upgrade_required: true
  }, extra || {});
};

/**
 * Generic count-based entity limit — checkEntityLimit factory body
 * (entity-limits.js:23-62).
 *
 * @param {Object} ctx  { planFeatures, planId, userId }
 * @param {string} limitKey  full path e.g. 'limits.active_tasks'.
 * @param {string} countKind  one of active_tasks|recurring_templates|projects|
 *   locations|schedule_templates — selects the repo count.
 * @param {Object} [options]  { batchSize?: number } — how many are being created.
 * @returns {Promise<{status: ?number, body?: Object}>}
 */
EnforceEntityLimit.prototype.check = async function check(ctx, limitKey, countKind, options) {
  var opts = options || {};
  if (!ctx.planFeatures) {
    return { status: 500, body: { error: 'Plan features not resolved' } };
  }

  var limit = entityLimit.resolveLimit(ctx.planFeatures, limitKey);
  // unlimited short-circuit (entity-limits.js:30) — BEFORE the userId guard, exactly
  // as the legacy middleware ordered it (-1 | undefined | null → unlimited).
  if (isEntityUnlimited(limit)) {
    return { status: null };
  }

  var userId = ctx.userId;
  if (!userId) {
    return { status: 401, body: { error: 'Authentication required' } };
  }

  try {
    var currentCount = await this._count(countKind, userId);
    var batchSize = opts.batchSize === undefined ? 1 : opts.batchSize;
    var decision = entityLimit.decideEntityLimit(limit, currentCount, batchSize, limitKey);
    if (decision.outcome === 'deny') {
      return {
        status: 403,
        body: this._denyBody(decision, ctx, { attempting_to_add: decision.attempting_to_add })
      };
    }
    return { status: null };
  } catch (err) {
    // fail-CLOSED (999.370, user-approved): a DB/count error during an entitlement
    // check must BLOCK entity creation (503), not silently allow it. The legacy
    // fail-open (entity-limits.js:57-60 → next()) let users exceed plan limits
    // during a DB outage — corrected here to return 503 so the request is denied.
    this.logger.error('[entity-limits] Check failed:', err.message);
    return { status: 503, body: { error: 'Entitlement check temporarily unavailable' } };
  }
};

/**
 * Location limit — checkLocationLimit body (entity-limits.js:139-157). Uses the
 * INCOMING array length (PUT replace-all), not a DB count.
 *
 * @param {Object} ctx  { planFeatures, planId }
 * @param {number} incomingCount  the replacement array length.
 * @returns {{status: ?number, body?: Object}}
 */
EnforceEntityLimit.prototype.checkLocation = function checkLocation(ctx, incomingCount) {
  var limit = entityLimit.resolveLimit(ctx.planFeatures, 'limits.locations');
  if (isEntityUnlimited(limit)) return { status: null };

  var decision = entityLimit.decideIncomingCountLimit(limit, incomingCount, 'limits.locations');
  if (decision.outcome === 'deny') {
    return { status: 403, body: this._denyBody(decision, ctx) };
  }
  return { status: null };
};

/**
 * checkTaskOrRecurringLimit dispatch (entity-limits.js:168-174): recurring_template
 * → the recurring limit, else the active_tasks limit.
 *
 * @param {Object} ctx
 * @param {string} taskType  req.body.task_type || req.body.taskType.
 * @returns {Promise<{status: ?number, body?: Object}>}
 */
EnforceEntityLimit.prototype.checkTaskOrRecurring = function checkTaskOrRecurring(ctx, taskType) {
  if (taskType === 'recurring_template') {
    return this.check(ctx, 'limits.recurring_templates', 'recurring_templates');
  }
  return this.check(ctx, 'limits.active_tasks', 'active_tasks');
};

/**
 * checkBatchTaskLimits (entity-limits.js:179-233): split items into recurringTasks
 * vs tasks, check BOTH limits. Reproduces the exact two-check sequence + the
 * distinct error messages. The DB-error catch fails CLOSED (503), symmetric with
 * check() (999.370) — see the catch.
 *
 * @param {Object} ctx  { planFeatures, planId, userId }
 * @param {Object[]} items  the batch items (each with task_type|taskType).
 * @returns {Promise<{status: ?number, body?: Object}>}
 */
EnforceEntityLimit.prototype.checkBatch = async function checkBatch(ctx, items) {
  if (!ctx.planFeatures) {
    return { status: 500, body: { error: 'Plan features not resolved' } };
  }
  var userId = ctx.userId;
  if (!userId) return { status: 401, body: { error: 'Authentication required' } };

  var list = items || [];
  var recurringTasks = list.filter(function (t) { return (t.task_type || t.taskType) === 'recurring_template'; });
  var tasks = list.filter(function (t) { return (t.task_type || t.taskType) !== 'recurring_template'; });

  try {
    // task limit (entity-limits.js:193-208). NOTE the legacy `!== -1 && !== undefined`
    // guard does NOT special-case null (it is the active_tasks numeric path).
    var taskLimit = entityLimit.resolveLimit(ctx.planFeatures, 'limits.active_tasks');
    if (taskLimit !== -1 && taskLimit !== undefined && tasks.length > 0) {
      var currentTasks = await this.repo.countActiveTasks(userId);
      if (currentTasks + tasks.length > taskLimit) {
        return {
          status: 403,
          body: {
            error: "You've reached the task limit for your plan",
            code: 'ENTITY_LIMIT_REACHED',
            limit_key: 'limits.active_tasks',
            current_count: currentTasks,
            limit: taskLimit,
            attempting_to_add: tasks.length,
            current_plan: ctx.planId || 'free',
            upgrade_required: true
          }
        };
      }
    }

    // recurring limit (entity-limits.js:211-226).
    var recurringLimit = entityLimit.resolveLimit(ctx.planFeatures, 'limits.recurring_templates');
    if (recurringLimit !== -1 && recurringLimit !== undefined && recurringTasks.length > 0) {
      var currentRecurrings = await this.repo.countRecurringTemplates(userId);
      if (currentRecurrings + recurringTasks.length > recurringLimit) {
        return {
          status: 403,
          body: {
            error: "You've reached the recurring task template limit for your plan",
            code: 'ENTITY_LIMIT_REACHED',
            limit_key: 'limits.recurring_templates',
            current_count: currentRecurrings,
            limit: recurringLimit,
            attempting_to_add: recurringTasks.length,
            current_plan: ctx.planId || 'free',
            upgrade_required: true
          }
        };
      }
    }

    return { status: null };
  } catch (err) {
    // fail-CLOSED (999.370, user-approved): symmetric with check()'s catch. A
    // DB/count error during the batch entitlement check must BLOCK creation (503),
    // not silently allow it. Were this still fail-open (legacy entity-limits.js:229-232
    // → next()), a user could bypass the per-entity limit during a DB outage by
    // routing creation through the batch endpoint (POST /tasks/batch) while the
    // single-create path (check()) correctly blocked — the asymmetry elmo flagged.
    // applyGate maps this { status: 503, body } to res.status(503).json(body),
    // identical to check()'s 503.
    this.logger.error('[entity-limits] Batch check failed:', err.message);
    return { status: 503, body: { error: 'Entitlement check temporarily unavailable' } };
  }
};

/**
 * Resolve a count by kind. schedule_templates reads + parses the time_blocks config
 * row (W2 countScheduleTemplatesFromBlocks), reproducing countScheduleTemplates'
 * inner try/catch (parse failure → 0).
 * @param {string} countKind
 * @param {string} userId
 * @returns {Promise<number>}
 */
EnforceEntityLimit.prototype._count = async function _count(countKind, userId) {
  if (countKind === 'schedule_templates') {
    var row = await this.repo.getConfigRow(userId, 'time_blocks');
    if (!row || !row.config_value) return 0;
    try {
      var blocks = typeof row.config_value === 'string'
        ? JSON.parse(row.config_value) : row.config_value;
      return entityLimit.countScheduleTemplatesFromBlocks(blocks);
    } catch {
      return 0; // legacy inner-catch (entity-limits.js:117-119)
    }
  }
  var method = COUNT_METHODS[countKind];
  if (!method) throw new Error('EnforceEntityLimit: unknown countKind "' + countKind + '"');
  return this.repo[method](userId);
};

// The entity-unlimited predicate is the W2 VO (`-1 | undefined | null` → unlimited).
// Used to short-circuit BEFORE the userId guard, matching the legacy ordering.
var isEntityUnlimited = EntityLimit.isEntityUnlimited;

EnforceEntityLimit.COUNT_METHODS = COUNT_METHODS;

module.exports = EnforceEntityLimit;
