/**
 * Entity Limit Middleware — THIN express adapter over the user-config slice facade
 * (Phase H4 / W6).
 *
 * Enforces count-based limits on entities (tasks, recurringTasks, projects,
 * locations, schedule templates) — total active count vs plan limit (unlike the
 * per_month rate limits in feature-gate). The enforcement DECISION was extracted
 * into the slice (EnforceEntityLimit use-case over the W3 ConfigRepositoryPort
 * counts + the W2 pure entityLimit logic). Each pre-built middleware here is THIN:
 * it builds a request-shaped `ctx`, calls `slices/user-config/facade`, and maps the
 * use-case envelope onto express — `{ status: null }` → next(); `{ status, body }` →
 * res.status(status).json(body). The fail-open-on-DB-error and unlimited-short-circuit
 * are reproduced inside the use-case (golden-master H9-*).
 *
 * ── count* functions (kept HERE) ──
 * The per-entity count functions are STILL exported from this module: they are
 * consumed directly by my-plan.routes.js, billing-webhooks.controller.js, and the
 * task slice facade (and called directly by the golden-master). They are the same
 * queries the EnforceEntityLimit use-case runs through the repo (one source of the
 * query shape), and retain `../db` for those external/maintenance call sites.
 */

'use strict';

const db = require('../db');
const facade = require('../slices/user-config/facade');

/** Build the request-shaped ctx the EnforceEntityLimit use-case reads. */
function ctxFromReq(req) {
  return { planFeatures: req.planFeatures, planId: req.planId, userId: req.user?.id };
}

/** Map a gate use-case envelope onto express (null status → next). */
function applyGate(result, res, next) {
  if (result.status === null) return next();
  return res.status(result.status).json(result.body);
}

// --- Count functions for each entity type (kept here for external consumers) ---

async function countActiveTasks(userId) {
  const result = await db('tasks_v')
    .where('user_id', userId)
    .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled', 'cancelled'])
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
    .whereNotIn('status', ['done', 'cancel', 'skip', 'disabled', 'cancelled'])
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

// --- Pre-built middleware for each entity (THIN — delegate to the facade) ---

const checkProjectLimit = async (req, res, next) => {
  const result = await facade.enforceEntityLimit(ctxFromReq(req), 'limits.projects', 'projects');
  return applyGate(result, res, next);
};

const checkLocationLimit = (req, res, next) => {
  // Locations use PUT (replace all), so check the incoming count vs limit
  // (legacy checkLocationLimit, entity-limits.js:139-157 — incoming-count form).
  // The use-case's checkLocation is SYNCHRONOUS (no DB count) — apply synchronously
  // so the legacy synchronous-middleware contract is preserved (golden-master H9-6/7/8).
  const locations = Array.isArray(req.body) ? req.body : (req.body?.locations || []);
  const result = facade.enforceLocationLimit(ctxFromReq(req), locations.length);
  return applyGate(result, res, next);
};

const checkScheduleTemplateLimit = async (req, res, next) => {
  const result = await facade.enforceEntityLimit(ctxFromReq(req), 'limits.schedule_templates', 'schedule_templates');
  return applyGate(result, res, next);
};

/**
 * For task creation: checks if the task is a recurring_template and enforces that
 * limit, otherwise enforces the active_tasks limit.
 */
async function checkTaskOrRecurringLimit(req, res, next) {
  const taskType = req.body?.task_type || req.body?.taskType;
  const result = await facade.enforceTaskOrRecurringLimit(ctxFromReq(req), taskType);
  return applyGate(result, res, next);
}

/**
 * For batch task creation: separates recurringTasks vs regular tasks and checks
 * both limits.
 */
async function checkBatchTaskLimits(req, res, next) {
  const items = Array.isArray(req.body) ? req.body : (req.body?.tasks || []);
  const result = await facade.enforceBatchTaskLimits(ctxFromReq(req), items);
  return applyGate(result, res, next);
}

module.exports = {
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
