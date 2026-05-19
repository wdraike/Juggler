/**
 * isAllDayTask — canonical predicate for all-day task detection.
 *
 * Matches the scheduler's output (unifiedScheduleV2.js PLACEMENT_MODES.ALL_DAY)
 * and DailyView's existing usage. The over-broad DayView rule
 * (!t.time && (t.dur === 0 || t.dur === null)) is intentionally dropped —
 * any task with no time and zero/null duration is NOT necessarily all-day.
 */
export function isAllDayTask(task) {
  if (!task) return false;
  return task.when === 'allday' || task.isAllDay === true || task.placementMode === 'all_day';
}
