/**
 * Task Controller — THIN HTTP adapter over the task slice facade (Phase H3 / W6).
 *
 * The 2,461-line CRUD controller was extracted into a `slices/task` vertical slice
 * (W2 domain → W3 ports+repo → W4 cache+events → W5 application). This controller
 * is now THIN: each of the 12 handlers maps `req` → a plain use-case input, calls
 * the single public entry (`slices/task/facade`), and maps the use-case's
 * `{ status, body }` envelope back onto express. It performs ZERO direct DB access
 * (zero getDb / zero trx call sites — W6 acceptance b) and no longer requires
 * `src/db.js` (ADR-0002 delta — the facade→repo reaches the DB via `lib/db`).
 *
 * The per-handler try/catch → 500 wrapper is KEPT here (the use-cases throw like
 * the inline code did; expected-error branches return their own status via the
 * envelope). The scheduler trigger (`enqueueScheduleRun`) and the lib-events
 * publish happen at the facade/use-case seam — preserved verbatim, S4/S6 honored,
 * including the fast-path-no-event nuance (only the complex update path publishes).
 *
 * ── BEHAVIOR-IDENTICAL EXCEPT the human-approved P1 correction ────────────────
 * Writes now go through KnexTaskRepository which stamps `new Date()` (never
 * `db.fn.now()`) — the P1/ADR-0003 timestamp-source correction taking live effect
 * (Scooter INBOX process-decision 2026-06-10).
 *
 * ── PURE-HELPER RE-EXPORTS ───────────────────────────────────────────────────
 * Other modules (scheduler, mcp tools, schedule.routes, task-write-queue) import
 * pure transform helpers (rowToTask/taskToRow/buildSourceMap/…) FROM this
 * controller's exports. Those are re-exported from the facade (sourced from the W2
 * domain — byte-identical) so the import surface is unchanged.
 */

'use strict';

const facade = require('../slices/task/facade');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('task.controller');

/** Map a use-case `{ status, body }` envelope onto the express response. */
function sendEnvelope(res, result) {
  return res.status(result.status).json(result.body);
}

/** Common timezone header passthrough. */
function tzHeader(req) {
  return req.headers['x-timezone'];
}

/**
 * GET /api/tasks — all tasks for user
 */
async function getAllTasks(req, res) {
  try {
    var result = await facade.getAllTasks({ userId: req.user.id, query: req.query });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
}

/**
 * GET /api/tasks/:id — single task detail
 */
async function getTask(req, res) {
  try {
    var result = await facade.getTask({ id: req.params.id, userId: req.user.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Get task error:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
}

/**
 * GET /api/tasks/version — lightweight change-detection endpoint
 */
async function getVersion(req, res) {
  try {
    var result = await facade.getVersion({ userId: req.user.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Get version error:', error);
    res.status(500).json({ error: 'Failed to get version' });
  }
}

/**
 * POST /api/tasks — create single task
 */
async function createTask(req, res) {
  try {
    var result = await facade.createTask({
      userId: req.user.id,
      body: req.body,
      timezoneHeader: tzHeader(req)
    });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
}

/**
 * PUT /api/tasks/:id — update task fields
 */
async function updateTask(req, res) {
  try {
    var result = await facade.updateTask({
      id: req.params.id,
      userId: req.user.id,
      body: req.body,
      timezoneHeader: tzHeader(req)
    });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
}

/**
 * DELETE /api/tasks/:id — delete task
 * Query params:
 *   ?scope=instance      — delete just this one row
 *   ?scope=series        — delete template + all instances
 *   ?scope=this_and_future — delete current + future instances + template
 */
async function deleteTask(req, res) {
  try {
    var result = await facade.deleteTask({
      id: req.params.id,
      userId: req.user.id,
      cascade: req.query.cascade,
      scope: req.query.scope
    });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
}

/**
 * PUT /api/tasks/:id/status — update status + direction
 */
async function updateTaskStatus(req, res) {
  try {
    var result = await facade.updateTaskStatus({
      id: req.params.id,
      userId: req.user.id,
      body: req.body,
      timezoneHeader: tzHeader(req)
    });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Update task status error:', error);
    res.status(500).json({ error: 'Failed to update task status' });
  }
}

/**
 * POST /api/tasks/batch — batch create tasks
 */
async function batchCreateTasks(req, res) {
  try {
    var result = await facade.batchCreateTasks({
      userId: req.user.id,
      body: req.body,
      timezoneHeader: tzHeader(req)
    });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Batch create error:', error);
    res.status(500).json({ error: 'Failed to batch create tasks' });
  }
}

/**
 * PUT /api/tasks/batch — batch update tasks
 */
async function batchUpdateTasks(req, res) {
  try {
    var result = await facade.batchUpdateTasks({
      userId: req.user.id,
      body: req.body,
      timezoneHeader: tzHeader(req)
    });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Batch update error:', error);
    res.status(500).json({ error: 'Failed to batch update tasks' });
  }
}

/**
 * GET /api/tasks/disabled — list all disabled items for the user
 */
async function getDisabledTasks(req, res) {
  try {
    var result = await facade.getDisabledTasks({ userId: req.user.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Get disabled tasks error:', error);
    res.status(500).json({ error: 'Failed to get disabled tasks' });
  }
}

/**
 * GET /api/tasks/search?q=... — FULLTEXT search across task descriptions and notes (999.253)
 */
async function searchTasks(req, res) {
  try {
    var q = (req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Search query parameter "q" is required' });
    }
    if (q.length > 200) {
      q = q.substring(0, 200);
    }
    var result = await facade.searchTasks({ userId: req.user.id, q: q });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Search tasks error:', error);
    res.status(500).json({ error: 'Failed to search tasks' });
  }
}

/**
 * PUT /api/tasks/:id/re-enable — re-enable a disabled task
 */
async function reEnableTask(req, res) {
  try {
    var result = await facade.reEnableTask({
      id: req.params.id,
      userId: req.user.id,
      planFeatures: req.planFeatures,
      planId: req.planId
    });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Re-enable task error:', error);
    res.status(500).json({ error: 'Failed to re-enable task' });
  }
}

/**
 * POST /api/tasks/:id/take-ownership — detach a provider-origin task from its
 * calendar link so Juggler owns the schedule.
 */
async function takeOwnership(req, res) {
  try {
    var result = await facade.takeOwnership({ id: req.params.id, userId: req.user.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Take ownership error:', error);
    res.status(500).json({ error: 'Failed to take ownership' });
  }
}

module.exports = {
  // HTTP handlers (thin — delegate to the facade)
  getAllTasks,
  getTask,
  getVersion,
  createTask,
  updateTask,
  deleteTask,
  updateTaskStatus,
  batchCreateTasks,
  batchUpdateTasks,
  getDisabledTasks,
  searchTasks,
  reEnableTask,
  takeOwnership,

  // pure-helper re-exports the external consumers import from this controller
  // (sourced from the slice facade → W2 domain — byte-identical). DB-touching
  // helpers are bound over the slice repo inside the facade, so this controller
  // stays free of any direct database access.
  rowToTask: facade.rowToTask,
  taskToRow: facade.taskToRow,
  checkCalSyncEditGuard: facade.checkCalSyncEditGuard,
  guardFixedCalendarWhen: facade.guardFixedCalendarWhen,
  buildSourceMap: facade.buildSourceMap,
  fetchTasksWithEventIds: facade.fetchTasksWithEventIds,
  ensureProject: facade.ensureProject,
  applySplitDefault: facade.applySplitDefault,
  TEMPLATE_FIELDS: facade.TEMPLATE_FIELDS,
  validateTaskInput: facade.validateTaskInput,
  expandToAllInstanceIds: facade.expandToAllInstanceIds,
  safeParseJSON: facade.safeParseJSON
};
