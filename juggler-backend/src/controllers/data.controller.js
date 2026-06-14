/**
 * Data Controller — THIN HTTP adapter over the user-config slice facade
 * (Phase H4 / W6).
 *
 * Import/Export (migration from the window.storage v7 format) was extracted into
 * the `slices/user-config` slice (ExportData query + ImportData command over the
 * W3 ConfigRepositoryPort + the injected task-table collaborators). This controller
 * is now THIN: it maps `req` → use-case input, calls `slices/user-config/facade`,
 * and maps the `{ status, body }` envelope onto express. ZERO direct DB access (no
 * getDb / no trx — W6 acceptance b); no longer requires `src/db.js` (ADR-0002 delta).
 *
 * The per-handler try/catch → 500 wrapper is KEPT here (an express concern). The
 * destructive-import `?confirm=delete_all` guard is reproduced inside ImportData;
 * the wipe is still a single transaction (the legacy boundary, preserved by the
 * repo's runInTransaction).
 */

'use strict';

const facade = require('../slices/user-config/facade');
const { dataControllerLogger } = require('../lib/logger');
const { enqueueScheduleRun } = require('../scheduler/scheduleQueue');
const { tasksToCsv } = require('../lib/tasks-csv');
const { csvToTasks } = require('../lib/csv-to-tasks');

const logger = dataControllerLogger;

/** Map a use-case `{ status, body }` envelope onto the express response. */
function sendEnvelope(res, result) {
  return res.status(result.status).json(result.body);
}

/**
 * POST /api/data/import
 * Import from window.storage JSON format (v7 persistAll shape), OR
 * from a text/csv body (Content-Type: text/csv or ?format=csv).
 *
 * CSV path: parses the raw CSV string via csvToTasks, builds
 * { extraTasks, v7: true }, and FORCES mode='merge' (a task-only CSV
 * must never drive a destructive replace — it carries no config/projects
 * to restore). A parse error returns 400 with ZERO DB writes.
 *
 * JSON path: unchanged — data: req.body, mode: req.query.mode.
 */
async function importData(req, res) {
  try {
    let data;
    let mode;

    if (req.is('text/csv') || req.query.format === 'csv') {
      // CSV path — req.body is the raw CSV string (express.text parser upstream)
      let tasks;
      try {
        tasks = csvToTasks(req.body);
      } catch (parseErr) {
        return res.status(400).json({ error: 'Invalid CSV: ' + parseErr.message });
      }
      data = { extraTasks: tasks, v7: true };
      mode = 'merge'; // CSV is always additive — never destructive replace
    } else {
      // JSON path — unchanged
      data = req.body;
      mode = req.query.mode;
    }

    const result = await facade.importData({
      userId: req.user.id,
      data,
      mode,
      confirm: req.query.confirm,
      timezoneHeader: req.headers['x-timezone']
    });
    sendEnvelope(res, result);

    // Import rewrites all schedule-affecting config — fire one re-run AFTER responding,
    // mirroring updateConfig's scheduleAfter pattern (BUG-3 / 999.464).
    if (result.scheduleAfter) {
      enqueueScheduleRun(result.scheduleAfter.userId, result.scheduleAfter.source);
    }
  } catch (error) {
    logger.error('Import error', { error });
    res.status(500).json({ error: 'Import failed' });
  }
}

/**
 * GET /api/data/export
 * Export all data as JSON (compatible with window.storage format for round-trip)
 */
async function exportData(req, res) {
  try {
    const result = await facade.exportData({
      userId: req.user.id,
      timezoneHeader: req.headers['x-timezone']
    });
    if (req.query.format === 'csv') {
      const csvString = tasksToCsv(result.body.extraTasks);
      res.status(200);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="juggler-tasks.csv"');
      return res.send(csvString);
    }
    return sendEnvelope(res, result);
  } catch (error) {
    logger.error('Export error', { error });
    res.status(500).json({ error: 'Export failed' });
  }
}

module.exports = {
  importData,
  exportData
};
