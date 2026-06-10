/**
 * ReEnableTask — application command use-case (Phase H3 / W5).
 *
 * Reproduces the legacy `reEnableTask` HTTP handler (task.controller.js ~2288)
 * step-for-step:
 *
 *   1. read (repo.fetchTaskWithEventIds) → 404; not-disabled → 400.
 *   2. entity-limit checks (planFeatures from input; injected counters
 *      `countActiveTasks` / `countRecurringTemplates` + injected
 *      `countDisabledInstances`) → 403 ENTITY_LIMIT_REACHED (two distinct shapes:
 *      template/instance-over-limit and instances-exceed-active-limit).
 *   3. transaction: re-enable the task/template (repo.updateTaskById with
 *      disabled_at/disabled_reason cleared) + (template) re-enable disabled
 *      instances (repo.updateInstancesWhere).
 *   4. srcMap re-read, invalidate, enqueueScheduleRun (SOLE trigger), 200.
 *
 * ── T-TX ── the re-enable runs inside repo.runInTransaction.
 * ── P1 ── updated_at omitted on the repo writes (repo stamps new Date()); the
 *   disabled_at = null is a real null (not fn.now()).
 * ── S4/S6 ── enqueueScheduleRun is the SOLE trigger (no event publish here).
 * ── NO NEW FALLBACKS ── the planFeatures `||` defaults preserved verbatim.
 *
 * @typedef {Object} ReEnableTaskDeps  (see constructor required list)
 */

'use strict';

/** @param {ReEnableTaskDeps} deps */
function ReEnableTask(deps) {
  var required = ['repo', 'cache', 'enqueueScheduleRun', 'mappers',
    'countActiveTasks', 'countRecurringTemplates', 'countDisabledInstances'];
  for (var i = 0; i < required.length; i++) {
    if (!deps || deps[required[i]] === undefined || deps[required[i]] === null) {
      throw new Error('ReEnableTask: missing dependency "' + required[i] + '"');
    }
  }
  this.repo = deps.repo;
  this.cache = deps.cache;
  this.enqueueScheduleRun = deps.enqueueScheduleRun;
  this.mappers = deps.mappers;
  this.countActiveTasks = deps.countActiveTasks;
  this.countRecurringTemplates = deps.countRecurringTemplates;
  this.countDisabledInstances = deps.countDisabledInstances;
}

/**
 * @param {Object} input
 * @param {string} input.id
 * @param {string} input.userId
 * @param {Object} [input.planFeatures]  req.planFeatures (may be undefined).
 * @param {string} [input.planId]  req.planId.
 * @returns {Promise<{ status: number, body: Object }>}
 */
ReEnableTask.prototype.execute = async function execute(input) {
  var id = input.id;
  var userId = input.userId;

  var existing = await this.repo.fetchTaskWithEventIds(id, userId);
  if (!existing) return { status: 404, body: { error: 'Task not found' } };
  if (existing.status !== 'disabled') {
    return { status: 400, body: { error: 'Task is not disabled' } };
  }

  var isRecurringTemplate = existing.task_type === 'recurring_template';
  var limitKey = isRecurringTemplate ? 'limits.recurring_templates' : 'limits.active_tasks';

  // entity-limit checks (handler L2304-2353)
  if (input.planFeatures) {
    var limit = limitKey.split('.').reduce(function (o, k) { return o && o[k]; }, input.planFeatures);
    if (limit !== -1 && limit !== undefined && limit !== null) {
      var currentCount = isRecurringTemplate
        ? await this.countRecurringTemplates(userId)
        : await this.countActiveTasks(userId);

      var instanceCount = 0;
      if (isRecurringTemplate) {
        instanceCount = await this.countDisabledInstances(userId, id);
      }

      if (currentCount + 1 > limit) {
        return {
          status: 403,
          body: {
            error: "You've reached the limit for your plan",
            code: 'ENTITY_LIMIT_REACHED',
            limit_key: limitKey,
            current_count: currentCount,
            limit: limit,
            current_plan: input.planId || 'free',
            upgrade_required: true
          }
        };
      }

      if (isRecurringTemplate && instanceCount > 0) {
        var taskLimit = 'limits.active_tasks'.split('.').reduce(function (o, k) { return o && o[k]; }, input.planFeatures);
        if (taskLimit !== -1 && taskLimit !== undefined && taskLimit !== null) {
          var currentTasks = await this.countActiveTasks(userId);
          if (currentTasks + instanceCount > taskLimit) {
            return {
              status: 403,
              body: {
                error: 'Re-enabling this recurring task would exceed your active task limit',
                code: 'ENTITY_LIMIT_REACHED',
                limit_key: 'limits.active_tasks',
                current_count: currentTasks,
                limit: taskLimit,
                attempting_to_add: instanceCount,
                current_plan: input.planId || 'free',
                upgrade_required: true
              }
            };
          }
        }
      }
    }
  }

  // re-enable transaction (handler L2355-2372)
  await this.repo.runInTransaction(async function (trxRepo) {
    await trxRepo.updateTaskById(id, {
      status: '',
      disabled_at: null,
      disabled_reason: null
    }, userId);
    if (isRecurringTemplate) {
      await trxRepo.updateInstancesWhere(userId, function (q) {
        return q.where({ master_id: id, status: 'disabled' });
      }, { status: '' });
    }
  });

  var templateRows = await this.repo.getRecurringTemplateRows(userId);
  var srcMap = this.mappers.buildSourceMap(templateRows);
  var updated = await this.repo.fetchTaskWithEventIds(id, userId);
  await this.cache.invalidateTasks(userId);
  this.enqueueScheduleRun(userId, 'api:reEnableTask', [id]);
  return { status: 200, body: { task: this.mappers.rowToTask(updated, null, srcMap) } };
};

module.exports = ReEnableTask;
