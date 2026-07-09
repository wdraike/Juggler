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
 * @param {object} task - candidate task (recurring instance)
 * @param {Date} today - "today" per the caller's clock (server-corrected)
 * @returns {{ blocked: boolean, warning: string|null }}
 */
export function evaluateFutureCompletionGuard(task, today) {
  if (task && task.recurring && task.taskType === 'recurring_instance') {
    var taskDateKey = task.date ? formatDateKey(parseDate(task.date)) : null;
    var nowDayKey = formatDateKey(today);
    var isFuture = taskDateKey && taskDateKey > nowDayKey;
    var isRolling = task.recur && task.recur.type === 'rolling';
    if (isFuture && !isRolling) {
      return {
        blocked: true,
        warning: 'Can\'t mark a future recurring task as done — skip or cancel it instead'
      };
    }
  }
  return { blocked: false, warning: null };
}
