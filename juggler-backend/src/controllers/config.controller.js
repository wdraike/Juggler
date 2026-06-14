/**
 * Config Controller — THIN HTTP adapter over the user-config slice facade
 * (Phase H4 / W6).
 *
 * The locations/tools/projects/config CRUD (11 handlers) was extracted into the
 * `slices/user-config` vertical slice (W2 domain → W3 KnexConfigRepository → W4
 * entitlement adapter → W5 application). This controller is now THIN: each handler
 * maps `req` → a plain use-case input, calls the single public entry
 * (`slices/user-config/facade`), and maps the use-case's `{ status, body }`
 * envelope back onto express. It performs ZERO direct DB access (no getDb / no trx
 * call sites — W6 acceptance b) and no longer requires `src/db.js` (ADR-0002 delta).
 *
 * The per-handler try/catch → 500 wrapper is KEPT here (an express concern); the
 * use-cases return their own status via the envelope. The UpdateConfig
 * fire-after-response ordering (the background reschedule) is preserved at the
 * controller edge via the `scheduleAfter` directive (enqueueScheduleRun fired AFTER
 * res.json, exactly as the legacy handler ordered it).
 *
 * ── BEHAVIOR-IDENTICAL EXCEPT the human-approved P1 correction ────────────────
 * Config writes now go through KnexConfigRepository which stamps `new Date()`
 * (never `db.fn.now()`) — the P1/ADR-0003 timestamp-source correction taking live
 * effect (Scooter INBOX process-decision 2026-06-10).
 */

'use strict';

const facade = require('../slices/user-config/facade');
const { enqueueScheduleRun } = require('../scheduler/scheduleQueue');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('config.controller');

/** Map a use-case `{ status, body }` envelope onto the express response. */
function sendEnvelope(res, result) {
  return res.status(result.status).json(result.body);
}

/**
 * GET /api/config — all config for user
 */
async function getAllConfig(req, res) {
  try {
    const result = await facade.getAllConfig({ userId: req.user.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Get config error:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
}

/**
 * PUT /api/config/:key — update specific config key
 */
async function updateConfig(req, res) {
  try {
    const result = await facade.updateConfig({
      userId: req.user.id,
      key: req.params.key,
      value: req.body.value
    });
    sendEnvelope(res, result);

    // Schedule-affecting keys: reschedule in the background AFTER responding
    // (preserves the legacy fire-after-res.json ordering — config.controller.js:179-187).
    if (result.scheduleAfter) {
      enqueueScheduleRun(result.scheduleAfter.userId, result.scheduleAfter.source);
    }
  } catch (error) {
    logger.error('Update config error:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
}

// ── Projects ──

async function getProjects(req, res) {
  try {
    const result = await facade.getProjects({ userId: req.user.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Get projects error:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
}

/**
 * PUT /api/projects/reorder — persist user-chosen project order.
 */
async function reorderProjects(req, res) {
  try {
    const result = await facade.reorderProjects({ userId: req.user.id, ids: req.body.ids });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Reorder projects error:', error);
    res.status(500).json({ error: 'Failed to reorder projects' });
  }
}

async function createProject(req, res) {
  try {
    const result = await facade.createProject({ userId: req.user.id, body: req.body });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
}

async function updateProject(req, res) {
  try {
    const result = await facade.updateProject({ userId: req.user.id, id: req.params.id, body: req.body });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Update project error:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
}

async function deleteProject(req, res) {
  try {
    const result = await facade.deleteProject({ userId: req.user.id, id: req.params.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
}

// ── Locations ──

async function getLocations(req, res) {
  try {
    const result = await facade.getLocations({ userId: req.user.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Get locations error:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
}

async function replaceLocations(req, res) {
  try {
    const result = await facade.replaceLocations({ userId: req.user.id, body: req.body });
    sendEnvelope(res, result);

    // Replacing locations changes scheduling inputs — reschedule in background AFTER
    // responding, mirroring updateConfig's scheduleAfter pattern (BUG-2 / 999.464).
    if (result.scheduleAfter) {
      enqueueScheduleRun(result.scheduleAfter.userId, result.scheduleAfter.source);
    }
  } catch (error) {
    logger.error('Replace locations error:', error);
    res.status(500).json({ error: 'Failed to update locations' });
  }
}

// ── Tools ──

async function getTools(req, res) {
  try {
    const result = await facade.getTools({ userId: req.user.id });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Get tools error:', error);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
}

async function replaceTools(req, res) {
  try {
    const result = await facade.replaceTools({ userId: req.user.id, body: req.body });
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Replace tools error:', error);
    res.status(500).json({ error: 'Failed to update tools' });
  }
}

module.exports = {
  getAllConfig,
  updateConfig,
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  reorderProjects,
  getLocations,
  replaceLocations,
  getTools,
  replaceTools
};
