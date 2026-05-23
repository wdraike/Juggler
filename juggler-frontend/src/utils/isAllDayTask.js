/**
 * isAllDayTask — canonical predicate for all-day task detection.
 *
 * Post-Phase 9 enum redesign: placement_mode='all_day' is canonical.
 * Legacy when='allday' kept as fallback for backwards-compat reads.
 */
export function isAllDayTask(task) {
  if (!task) return false;
  return task.placementMode === 'all_day' || task.placement_mode === 'all_day' ||
         task.isAllDay === true || task.when === 'allday';
}
