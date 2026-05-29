/**
 * isAllDayTask — canonical predicate for all-day task detection.
 *
 * Phase 15: Migrated to placement_mode='all_day' exclusively.
 * Removed legacy when='allday' fallback.
 */
export function isAllDayTask(task) {
  if (!task) return false;
  return task.placementMode === 'all_day' || task.placement_mode === 'all_day' ||
         task.isAllDay === true;
}
