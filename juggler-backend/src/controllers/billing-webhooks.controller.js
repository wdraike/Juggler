/**
 * Billing Webhooks Controller for StriveRS
 *
 * Receives subscription lifecycle events from the payment service.
 * Invalidates the plan features cache so the app picks up changes immediately.
 * Enforces entity limits on downgrade by disabling excess items.
 */

const getDb = () => require('../db');
const tasksWrite = require('../lib/tasks-write');
const { _countRecurringTemplates } = require('../middleware/entity-limits');
const cache = require('../lib/redis');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('billing-webhooks.controller');

/**
 * Enforce plan limits by disabling excess recurringTasks and tasks.
 * Disables in reverse chronological order (newest first) to preserve the user's
 * oldest/most established items.
 *
 * Order: recurring templates first (with their instances), then regular tasks.
 */
async function enforceDowngradeLimits(userId, planFeatures) {
  if (!planFeatures) return { disabledRecurrings: 0, disabledTasks: 0 };

  var recurringLimit = planFeatures.limits && planFeatures.limits.recurring_templates;
  var taskLimit = planFeatures.limits && planFeatures.limits.active_tasks;
  var disabledRecurrings = 0;
  var disabledTasks = 0;
  var now = new Date();

  await getDb().transaction(async function(trx) {
    // --- Phase 1: Disable excess recurring templates (newest first) ---
    if (recurringLimit !== -1 && recurringLimit !== undefined && recurringLimit !== null) {
      var currentRecurrings = await trx('tasks_v')
        .where('user_id', userId)
        .where('task_type', 'recurring_template')
        .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled', 'cancelled'])
        .count('* as count').first();
      var recurringCount = parseInt(currentRecurrings.count, 10);

      if (recurringCount > recurringLimit) {
        var excess = recurringCount - recurringLimit;
        // Get the newest recurring templates to disable
        var recurringToDisable = await trx('tasks_v')
          .where('user_id', userId)
          .where('task_type', 'recurring_template')
          .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled', 'cancelled'])
          .orderBy('created_at', 'desc')
          .limit(excess)
          .select('id');

        var recurringIds = recurringToDisable.map(function(h) { return h.id; });

        if (recurringIds.length > 0) {
          // Disable the templates (master-level fields)
          await tasksWrite.updateTasksWhere(trx, userId, function(q) {
            return q.whereIn('id', recurringIds);
          }, { status: 'disabled', disabled_at: now, disabled_reason: 'downgrade', updated_at: now });

          // Disable all open instances of these templates (instance-level status)
          var _disabledInstances = await tasksWrite.updateInstancesWhere(trx, userId, function(q) {
            return q.whereIn('master_id', recurringIds).where('status', '');
          }, { status: 'disabled', updated_at: now });

          // Clean up calendar sync for disabled instances
          var instanceIds = await trx('tasks_v')
            .where('user_id', userId)
            .whereIn('source_id', recurringIds)
            .where('status', 'disabled')
            .select('id');
          var allDisabledIds = recurringIds.concat(instanceIds.map(function(i) { return i.id; }));

          if (allDisabledIds.length > 0) {
            await trx('cal_sync_ledger')
              .where('user_id', userId)
              .whereIn('task_id', allDisabledIds)
              .where('status', 'active')
              .update({ status: 'deleted_local', task_id: null, synced_at: now })
              .catch(function(err) { logger.error("[silent-catch]", err.message); });
          }

          disabledRecurrings = recurringIds.length;
        }
      }
    }

    // --- Phase 2: Disable excess active tasks (newest first) ---
    if (taskLimit !== -1 && taskLimit !== undefined && taskLimit !== null) {
      // Re-count after disabling recurring instances (they count toward active tasks)
      var currentTasks = await trx('tasks_v')
        .where('user_id', userId)
        .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled', 'cancelled'])
        .where(function() {
          this.whereNull('task_type').orWhereNot('task_type', 'recurring_template');
        })
        .count('* as count').first();
      var taskCount = parseInt(currentTasks.count, 10);

      if (taskCount > taskLimit) {
        var taskExcess = taskCount - taskLimit;
        // Get newest regular tasks to disable (exclude recurring instances — those are handled with templates)
        var tasksToDisable = await trx('tasks_v')
          .where('user_id', userId)
          .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled', 'cancelled'])
          .where(function() {
            this.whereNull('task_type').orWhere('task_type', 'task');
          })
          .orderBy('created_at', 'desc')
          .limit(taskExcess)
          .select('id', 'depends_on');

        var taskIds = tasksToDisable.map(function(t) { return t.id; });

        if (taskIds.length > 0) {
          // Re-link dependencies: remove disabled tasks from other tasks' depends_on
          for (var i = 0; i < taskIds.length; i++) {
            var taskId = taskIds[i];
            var affected = await trx('tasks_v')
              .where('user_id', userId)
              .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(taskId)])
              .select('id', 'depends_on');
            for (var j = 0; j < affected.length; j++) {
              var other = affected[j];
              var deps = typeof other.depends_on === 'string'
                ? JSON.parse(other.depends_on || '[]') : (other.depends_on || []);
              var newDeps = deps.filter(function(d) { return d !== taskId; });
              await tasksWrite.updateTaskById(trx, other.id, {
                depends_on: JSON.stringify(newDeps), updated_at: now
              }, userId);
            }
          }

          // Disable the tasks (master + instance via helper)
          await tasksWrite.updateTasksWhere(trx, userId, function(q) {
            return q.whereIn('id', taskIds);
          }, { status: 'disabled', disabled_at: now, disabled_reason: 'downgrade', updated_at: now });

          // Clean up calendar sync
          await trx('cal_sync_ledger')
            .where('user_id', userId)
            .whereIn('task_id', taskIds)
            .where('status', 'active')
            .update({ status: 'deleted_local', task_id: null, synced_at: now })
            .catch(function(err) { logger.error("[silent-catch]", err.message); });

          disabledTasks = taskIds.length;
        }
      }
    }
  });

  if (disabledRecurrings > 0 || disabledTasks > 0) {
    await cache.invalidateTasks(userId);
    logger.info(`[billing-webhook] Disabled ${disabledRecurrings} recurringTasks, ${disabledTasks} tasks for user ${userId}`);
  }

  return { disabledRecurrings, disabledTasks };
}

/**
 * POST /api/billing-webhooks — THIN HTTP adapter (Phase H4 / W6).
 *
 * The per-event dispatch was extracted into the user-config slice
 * (HandleBillingWebhook command). This handler maps `req.body` → use-case input,
 * delegates to `slices/user-config/facade`, and maps the `{ status, body }`
 * envelope onto express. The per-handler try/catch → 500 stays here (an express
 * concern).
 *
 * ── SECURITY (elmo gate, FLAG-1) ──
 * The HMAC-SHA256 signature verification lives in the ROUTE layer
 * (billing-webhooks.routes.js verifySignature) and is NOT in this handler — it
 * trusts the route guard exactly as the legacy did (golden-master H3-9). This
 * handler contains no signature/crypto logic.
 */
async function handleWebhook(req, res) {
  try {
    const facade = require('../slices/user-config/facade');
    const result = await facade.handleBillingWebhook({ body: req.body });
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('[billing-webhook] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { handleWebhook, enforceDowngradeLimits };
