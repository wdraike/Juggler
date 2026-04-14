/**
 * Entity Limit Middleware
 *
 * Enforces count-based limits on entities (tasks, recurringTasks, projects, locations, schedule templates).
 * Unlike rate limits (per_month), these check total active count vs plan limit.
 */

const db = require('../db');

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, key) => o?.[key], obj);
}

/**
 * Check if user can create more of an entity type.
 * @param {string} limitKey - Feature path, e.g. 'limits.active_tasks'
 * @param {Function} countFn - async (userId, trx?) => number — returns current count
 * @param {Object} options
 * @param {number} options.batchCountFn - (req) => number of items being created (for batch ops)
 */
function checkEntityLimit(limitKey, countFn, options = {}) {
  return async (req, res, next) => {
    if (!req.planFeatures) {
      return res.status(500).json({ error: 'Plan features not resolved' });
    }

    const limit = getNestedValue(req.planFeatures, limitKey);
    if (limit === -1 || limit === undefined || limit === null) {
      return next(); // unlimited
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const currentCount = await countFn(userId);
      const batchSize = options.batchCountFn ? options.batchCountFn(req) : 1;

      if (currentCount + batchSize > limit) {
        return res.status(403).json({
          error: `You've reached the limit for your plan`,
          code: 'ENTITY_LIMIT_REACHED',
          limit_key: limitKey,
          current_count: currentCount,
          limit,
          attempting_to_add: batchSize,
          current_plan: req.planId || 'free',
          upgrade_required: true
        });
      }

      next();
    } catch (err) {
      console.error('[entity-limits] Check failed:', err.message);
      next(); // fail open
    }
  };
}

// --- Count functions for each entity type ---

async function countActiveTasks(userId) {
  const result = await db('tasks_v')
    .where('user_id', userId)
    .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled'])
    .where(function () {
      this.whereNull('task_type').orWhereNot('task_type', 'recurring_template');
    })
    .count('* as count')
    .first();
  return parseInt(result.count, 10);
}

async function countRecurringTemplates(userId) {
  const result = await db('tasks_v')
    .where('user_id', userId)
    .where('task_type', 'recurring_template')
    .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled'])
    .count('* as count')
    .first();
  return parseInt(result.count, 10);
}

async function countProjects(userId) {
  const result = await db('projects')
    .where('user_id', userId)
    .count('* as count')
    .first();
  return parseInt(result.count, 10);
}

async function countLocations(userId) {
  const result = await db('locations')
    .where('user_id', userId)
    .count('* as count')
    .first();
  return parseInt(result.count, 10);
}

async function countScheduleTemplates(userId) {
  const row = await db('user_config')
    .where({ user_id: userId, config_key: 'time_blocks' })
    .first();
  if (!row || !row.config_value) return 0;
  try {
    const blocks = typeof row.config_value === 'string'
      ? JSON.parse(row.config_value) : row.config_value;
    // Count unique day configurations that have blocks defined
    return Object.keys(blocks).filter(k => {
      const v = blocks[k];
      return Array.isArray(v) ? v.length > 0 : !!v;
    }).length;
  } catch {
    return 0;
  }
}

// --- Pre-built middleware for each entity ---

const checkTaskLimit = checkEntityLimit(
  'limits.active_tasks',
  countActiveTasks
);

const checkTaskBatchLimit = checkEntityLimit(
  'limits.active_tasks',
  countActiveTasks,
  { batchCountFn: (req) => Array.isArray(req.body) ? req.body.length : (req.body?.tasks?.length || 1) }
);

const checkRecurringLimit = checkEntityLimit(
  'limits.recurring_templates',
  countRecurringTemplates
);

const checkProjectLimit = checkEntityLimit(
  'limits.projects',
  countProjects
);

const checkLocationLimit = (req, res, next) => {
  // Locations use PUT (replace all), so check the incoming count vs limit
  const limit = getNestedValue(req.planFeatures, 'limits.locations');
  if (limit === -1 || limit === undefined || limit === null) return next();

  const locations = Array.isArray(req.body) ? req.body : (req.body?.locations || []);
  if (locations.length > limit) {
    return res.status(403).json({
      error: `You've reached the limit for your plan`,
      code: 'ENTITY_LIMIT_REACHED',
      limit_key: 'limits.locations',
      current_count: locations.length,
      limit,
      current_plan: req.planId || 'free',
      upgrade_required: true
    });
  }
  next();
};

const checkScheduleTemplateLimit = checkEntityLimit(
  'limits.schedule_templates',
  countScheduleTemplates
);

/**
 * For task creation: checks if the task is a recurring_template and enforces that limit,
 * otherwise enforces the active_tasks limit.
 */
function checkTaskOrRecurringLimit(req, res, next) {
  const taskType = req.body?.task_type || req.body?.taskType;
  if (taskType === 'recurring_template') {
    return checkRecurringLimit(req, res, next);
  }
  return checkTaskLimit(req, res, next);
}

/**
 * For batch task creation: separates recurringTasks vs regular tasks and checks both limits.
 */
async function checkBatchTaskLimits(req, res, next) {
  if (!req.planFeatures) {
    return res.status(500).json({ error: 'Plan features not resolved' });
  }

  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const items = Array.isArray(req.body) ? req.body : (req.body?.tasks || []);
  const recurringTasks = items.filter(t => (t.task_type || t.taskType) === 'recurring_template');
  const tasks = items.filter(t => (t.task_type || t.taskType) !== 'recurring_template');

  try {
    // Check task limit
    const taskLimit = getNestedValue(req.planFeatures, 'limits.active_tasks');
    if (taskLimit !== -1 && taskLimit !== undefined && tasks.length > 0) {
      const currentTasks = await countActiveTasks(userId);
      if (currentTasks + tasks.length > taskLimit) {
        return res.status(403).json({
          error: `You've reached the task limit for your plan`,
          code: 'ENTITY_LIMIT_REACHED',
          limit_key: 'limits.active_tasks',
          current_count: currentTasks,
          limit: taskLimit,
          attempting_to_add: tasks.length,
          current_plan: req.planId || 'free',
          upgrade_required: true
        });
      }
    }

    // Check recurring limit
    const recurringLimit = getNestedValue(req.planFeatures, 'limits.recurring_templates');
    if (recurringLimit !== -1 && recurringLimit !== undefined && recurringTasks.length > 0) {
      const currentRecurrings = await countRecurringTemplates(userId);
      if (currentRecurrings + recurringTasks.length > recurringLimit) {
        return res.status(403).json({
          error: `You've reached the recurring task template limit for your plan`,
          code: 'ENTITY_LIMIT_REACHED',
          limit_key: 'limits.recurring_templates',
          current_count: currentRecurrings,
          limit: recurringLimit,
          attempting_to_add: recurringTasks.length,
          current_plan: req.planId || 'free',
          upgrade_required: true
        });
      }
    }

    next();
  } catch (err) {
    console.error('[entity-limits] Batch check failed:', err.message);
    next();
  }
}

module.exports = {
  checkEntityLimit,
  checkTaskLimit,
  checkTaskBatchLimit,
  checkRecurringLimit,
  checkProjectLimit,
  checkLocationLimit,
  checkScheduleTemplateLimit,
  checkTaskOrRecurringLimit,
  checkBatchTaskLimits,
  countActiveTasks,
  countRecurringTemplates,
  countProjects,
  countLocations,
  countScheduleTemplates
};
