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
 * 999.5116: In addition to the DB overdue flag, this helper now derives past-due
 * from the task's own scheduled date+time when the task has a hard commitment
 * (deadline, placementMode=fixed, or overdue=1). This mirrors the backend's
 * computeIsPastDue (runSchedule.js:100) and ensures the badge survives a scheduler
 * cycle that has cleared the DB overdue flag. Floating tasks (no hard commitment)
 * are still excluded per 999.671.
 *
 * @param {{overdue?: boolean|number, date?: string, time?: string, deadline?: string, placementMode?: string}} task  the hydrated task object
 * @param {boolean} isDone  whether the task is in a terminal status
 * @param {Date} [now]  optional override for "now" (testing); defaults to new Date()
 * @returns {boolean}
 */
export function isTaskOverdue(task, isDone, now) {
  if (!task || isDone) return false;

  // DB flag is still the primary source — if it says overdue, we trust it.
  if (task.overdue) return true;

  // 999.5116: Also derive past-due from the task's own scheduled date+time
  // when the task has a hard commitment. Mirrors backend computeIsPastDue.
  var hasHardCommitment = task.deadline || task.overdue ||
    task.placementMode === 'fixed' || task.placement_mode === 'fixed';
  if (!hasHardCommitment) return false;

  if (!task.date || task.date === 'TBD' || !task.time) return false;

  var nowDate = now || new Date();
  var todayKey = nowDate.toISOString().slice(0, 10); // YYYY-MM-DD

  // Parse time "HH:MM" to minutes
  var timeParts = String(task.time).split(':');
  var scheduledMins = parseInt(timeParts[0], 10) * 60 + parseInt(timeParts[1], 10);
  if (isNaN(scheduledMins)) return false;

  var nowMins = nowDate.getHours() * 60 + nowDate.getMinutes();

  return task.date < todayKey ||
    (task.date === todayKey && scheduledMins < nowMins);
}