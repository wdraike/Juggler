/**
 * isAllDayTask — canonical predicate for all-day task detection.
 *
 * Matches the scheduler's output (unifiedScheduleV2.js PLACEMENT_MODES.ALL_DAY)
 * and DailyView's existing usage. The over-broad DayView rule
 * (!t.time && (t.dur === 0 || t.dur === null)) is intentionally dropped —
 * any task with no time and zero/null duration is NOT necessarily all-day.
 *
 * Migration note (999.011): placement_mode (snake_case, from backend ENUM) and
 * placementMode (camelCase, from frontend state) are the canonical sources.
 * The legacy `when === 'allday'` check has been removed — all task rows
 * should now have placement_mode set.
 */
export function isAllDayTask(task) {
  if (!task) return false;
  return task.placementMode === 'all_day'
    || task.placement_mode === 'all_day'
    || task.isAllDay === true;
}
