import { formatDateKey, parseDate } from '../scheduler/dateHelpers';

/**
 * Future-day completion guard for recurring instances.
 * Extracted here so both AppLayout (handleStatusChange) and its FR-3/AC4 tests
 * import the real function — keeping them in sync and eliminating mirror-drift
 * (analogous to the buildServerClock extraction in src/utils/timezone.js, AC3).
 *
 * SPEC (juggler-recur-lifecycle-redesign) FR-3 / AC4: marking a future-dated
 * recurring instance `done` is blocked for pattern recur types (unchanged,
 * docs/architecture/TASK-STATE-MATRIX.md:295-303), but is ALLOWED for
 * `recur.type === 'rolling'` masters (real use case: complete early, e.g. wash
 * the car ahead of schedule). Same-day and past-day completion are unaffected
 * for every recur type.
 *
 * 999.4865: the guard was too coarse — it blocked ALL future-dated pattern
 * instances. Now it allows marking the FIRST incomplete future instance in a
 * series as done (the next actionable one), only blocking instances BEYOND that
 * one. This is determined by checking if any earlier incomplete sibling instance
 * exists. The caller passes the full task list so the guard can find siblings
 * via source_id.
 *
 * @param {object} task - candidate task (recurring instance)
 * @param {Date} today - "today" per the caller's clock (server-corrected)
 * @param {Array} [allTasks] - all tasks (used to find sibling instances by source_id)
 * @returns {{ blocked: boolean, warning: string|null }}
 */
export function evaluateFutureCompletionGuard(task, today, allTasks) {
  if (task && task.recurring && task.taskType === 'recurring_instance') {
    var taskDateKey = task.date ? formatDateKey(parseDate(task.date)) : null;
    var nowDayKey = formatDateKey(today);
    var isFuture = taskDateKey && taskDateKey > nowDayKey;
    var isRolling = task.recur && task.recur.type === 'rolling';
    if (isFuture && !isRolling) {
      // 999.4865: allow the first/next incomplete future instance in the series.
      // Block only if an earlier incomplete sibling exists (this instance is
      // beyond the next-actionable one).
      if (allTasks && task.sourceId) {
        var hasEarlierIncomplete = allTasks.some(function(t) {
          return t && t.id !== task.id
            && t.sourceId === task.sourceId
            && t.taskType === 'recurring_instance'
            && t.recurring
            && (!t.status || t.status === '' || t.status === 'wip')
            && t.date && formatDateKey(parseDate(t.date)) < taskDateKey
            && formatDateKey(parseDate(t.date)) >= nowDayKey;
        });
        if (!hasEarlierIncomplete) {
          return { blocked: false, warning: null };
        }
      }
      return {
        blocked: true,
        warning: 'Can\'t mark a future recurring task as done — an earlier instance in this series is still incomplete. Complete or skip that one first.'
      };
    }
  }
  return { blocked: false, warning: null };
}
