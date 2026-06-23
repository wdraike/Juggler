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

// Terminal/resolved statuses (mirrors the DB terminal_scheduled_at CHECK set).
// Kept local — the shared task-status module is a symlinked pkg jest won't
// transform, and this is the only status check this pure util needs.
var TERMINAL_STATUSES = { done: 1, skip: 1, cancel: 1, missed: 1 };
function isTerminalStatus(s) { return !!TERMINAL_STATUSES[s]; }

/**
 * @param {Array} tasks — array of task objects from GET /tasks (may be null/undefined)
 * @returns {{ dayPlacements: Object, unplaced: Array, warnings: Array }}
 */
export function derivePlacements(tasks) {
  var dayPlacements = {};
  var unplaced = [];
  (tasks || []).forEach(function(t) {
    if (!t) return;
    // A terminal task (done/skip/cancel/missed) is never "unplaced" — it's
    // resolved, not pending-unplaceable. Such a row may still carry unscheduled=1
    // (e.g. an orphaned split chunk completed via sibling propagation); it must
    // NOT appear in the Unplaced list. With a slot it falls through to the grid;
    // without one it drops out of both. (999.x — done tasks shown as unplaced.)
    if (isTerminalStatus(t.status)) {
      if (t.date && t.time) {
        var ts = parseTimeToMinutes(t.time);
        if (ts != null) {
          if (!dayPlacements[t.date]) dayPlacements[t.date] = [];
          dayPlacements[t.date].push({ task: t, start: ts, end: ts + (t.dur || 0) });
        }
      }
      return;
    }
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
