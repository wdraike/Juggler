/**
 * Single source of truth for the "is this task overdue?" display decision.
 *
 * Overdue is a property of the TASK (R50.6 computed-on-read `task.overdue`:
 * stored DB flag OR computed predicate, gated by a real hard commitment —
 * deadline / implied_deadline / placement_mode=fixed). It is NOT the scheduler's
 * per-placement `_overdue` flag, which is a slack-relaxation artifact (set only
 * when a task couldn't fit without ignoring its deadline) and wrongly marks
 * floating tasks overdue (violates 999.671).
 *
 * Every view (Issues/Conflicts, Calendar, Day) MUST decide overdue through this
 * helper so the three never disagree. By taking the task — not a placement entry —
 * the divergence is structurally impossible.
 *
 * @param {{overdue?: boolean}} task  the hydrated task object
 * @param {boolean} isDone  whether the task is in a terminal status
 * @returns {boolean}
 */
export function isTaskOverdue(task, isDone) {
  return !!(task && task.overdue) && !isDone;
}
