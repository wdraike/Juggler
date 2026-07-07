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
 * The per-entity count functions STAY EXPORTED from this module: they are
 * consumed directly by my-plan.routes.js, billing-webhooks.controller.js, and the
 * task slice facade (and called directly by the golden-master). Their bodies now
 * DELEGATE to the user-config facade's count* passthroughs (999.1188 delta-closure),
 * which run over the SAME wired repo instance the EnforceEntityLimit use-case counts
 * through — one query source for plan-limit enforcement and my-plan display, instead
 * of the two verbatim copies this module used to carry independently.
 */

'use strict';

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

// --- Count functions for each entity type (kept here for external consumers; ---
// --- bodies delegate to the user-config facade — single query source) ---

function countActiveTasks(userId) { return facade.countActiveTasks(userId); }

function countRecurringTemplates(userId) { return facade.countRecurringTemplates(userId); }

function countProjects(userId) { return facade.countProjects(userId); }

function countLocations(userId) { return facade.countLocations(userId); }

function countScheduleTemplates(userId) { return facade.countScheduleTemplates(userId); }

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
