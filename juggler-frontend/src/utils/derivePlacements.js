/**
 * derivePlacements — pure function that groups loaded tasks into the
 * { dayPlacements, unplaced, warnings } shape consumed by CalendarView /
 * DayView / ConflictsView (W3 — DB single source).
 *
 * Extracted from useTaskState.js so it can be unit-tested without React or
 * network mocks. useTaskState.js imports and delegates to this module; the
 * behaviour is identical.
 *
 * Each task from GET /tasks already carries server-converted LOCAL date/time,
 * so the browser does NOT re-convert UTC → local: it uses t.date (local
 * dateKey) and t.time (local "H:MM AM/PM") directly.
 *
 * Routing rules (W3 WARN-2 guard):
 *   • t.unscheduled OR (t._unplacedReason && !t.scheduledAt) → unplaced[]
 *   • t.date && t.time && parseable start (start != null)       → dayPlacements[t.date]
 *   • t.date && t.time but unparseable time (start === null)    → skipped (data anomaly)
 *   • otherwise (no date / no time / plain backlog)             → absent from both
 */
import { parseTimeToMinutes } from '../scheduler/dateHelpers';

/**
 * @param {Array} tasks — array of task objects from GET /tasks (may be null/undefined)
 * @returns {{ dayPlacements: Object, unplaced: Array, warnings: Array }}
 */
export function derivePlacements(tasks) {
  var dayPlacements = {};
  var unplaced = [];
  (tasks || []).forEach(function(t) {
    if (!t) return;
    if (t.unscheduled || (t._unplacedReason && !t.scheduledAt)) { unplaced.push(t); return; }
    if (t.date && t.time) {                       // placed: server gave local date+time
      var start = parseTimeToMinutes(t.time);
      // Only grid a placement with a parseable start. A null start coerces to 0 in
      // DayView's `p.start < GRID_START*60` bucket and misroutes the task to the
      // before-grid lane (ernie W3 WARN-2); a placed task always has a parseable
      // "H:MM AM/PM", so null is a data anomaly — skip the grid entry (the task still
      // renders via AppLayout's date map).
      if (start != null) {
        if (!dayPlacements[t.date]) dayPlacements[t.date] = [];
        dayPlacements[t.date].push({ task: t, start: start, end: start + (t.dur || 0) });
      }
    }
  });
  return { dayPlacements: dayPlacements, unplaced: unplaced, warnings: [] };
}
