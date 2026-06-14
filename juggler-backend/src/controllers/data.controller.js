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

const logger = dataControllerLogger;

/** Map a use-case `{ status, body }` envelope onto the express response. */
function sendEnvelope(res, result) {
  return res.status(result.status).json(result.body);
}

/**
 * POST /api/data/import
 * Import from window.storage JSON format (v7 persistAll shape)
 */
async function importData(req, res) {
  try {
    const result = await facade.importData({
      userId: req.user.id,
      data: req.body,
      mode: req.query.mode,
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
