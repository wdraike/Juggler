/**
 * isAllDayTaskBackend — canonical predicate for all-day task detection in backend.
 *
 * Phase 15: Migrated to placement_mode='all_day' exclusively.
 *
 * Analogous to frontend isAllDayTask.js
 */

var { PLACEMENT_MODES } = require('./placementModes');

function isAllDayTaskBackend(task) {
  if (!task) return false;
  return task.placementMode === PLACEMENT_MODES.ALL_DAY ||
         task.placement_mode === PLACEMENT_MODES.ALL_DAY;
}

module.exports = { isAllDayTaskBackend };

