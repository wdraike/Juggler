/**
 * Shared helpers for the GENERALIZED recurrence anchor (999.1091 C1).
 *
 * Sibling to rolling-anchor.js — but for every recur.type EXCEPT 'rolling'
 * (daily/weekly/biweekly/monthly/interval). Rolling keeps its own dedicated
 * `rolling_anchor` column + rolling-anchor.js logic UNCHANGED (anchors to
 * ACTUAL completion date — an arithmetic-projection type with no calendar
 * pattern of its own). This module owns a SEPARATE column,
 * `task_masters.next_occurrence_anchor`, whose semantics are genuinely
 * different: "the next occurrence in the master's OWN configured recurrence
 * pattern, after the just-terminated one" (David's ruling, 2026-07-03):
 *   - daily            -> next day
 *   - weekly (1 day)   -> same weekday, next week
 *   - weekly (N days)  -> next day in that master's own day list, wrapping to
 *                          next week's first configured day after the last
 *   - monthly          -> next day in the monthDays list, wrapping to next month
 *                          (e.g. {11,22}: 11 done -> anchor=22; 22 done -> anchor=11 next month)
 *   - yearly (interval unit=years) -> the exact same calendar date, one year forward
 *
 * The actual pattern-walk is `nextMatchingDate` in shared/scheduler/expandRecurring.js
 * — the SAME predicate (`matchesRecurrenceDay`) the recurrence expansion loop uses to
 * decide which calendar days a source fires on. This module does not reimplement any
 * per-type date math; it only owns the terminal-event branching (done/skip advance,
 * cancel/non-terminal no-op, stale-event guard) — mirroring rolling-anchor.js's shape.
 */
'use strict';

var { isTerminalStatus } = require('./task-status');
var { nextMatchingDate } = require('../../../shared/scheduler/expandRecurring');

/**
 * Returns true if the given task_masters row is a recurring master whose recur.type
 * is anything OTHER than 'rolling' (i.e. the type this module's anchor applies to).
 * @param {Object} masterRow - row from task_masters (recur is JSON string or object)
 */
function isPatternRecurMaster(masterRow) {
  if (!masterRow || !masterRow.recur) return false;
  try {
    var recur = typeof masterRow.recur === 'string'
      ? JSON.parse(masterRow.recur)
      : masterRow.recur;
    return !!recur && recur.type !== 'rolling';
  } catch (_e) {
    return false;
  }
}

/**
 * Compute the new next_occurrence_anchor for a terminal status event on a non-rolling
 * recurring master.
 *
 * Rules:
 *   done/skip -> the next date this master's OWN recurrence pattern would fire on,
 *                after instanceDate (nextMatchingDate, phase-referenced against the
 *                CURRENT anchor when present — each successive anchor is itself a
 *                valid pattern date by construction, so the reference chain never
 *                drifts out of phase, e.g. biweekly parity / interval counting stay
 *                exact indefinitely).
 *   cancel    -> null (no anchor change — this occurrence didn't count)
 *
 * Guard: never move the anchor backwards — if the computed date < currentAnchor,
 * return null (stale/duplicate event), mirroring rolling-anchor.js's R33.4 guard.
 *
 * @param {string} status - 'done' | 'skip' | 'cancel'
 * @param {string} instanceDate - ISO date 'YYYY-MM-DD' of the instance that terminated
 * @param {string|null} currentAnchor - current next_occurrence_anchor from task_masters
 * @param {Object|string} recur - the master's recur config (JSON string or object)
 * @returns {string|null} new anchor ISO date, or null if no update needed
 */
function computeNextOccurrenceAnchor(status, instanceDate, currentAnchor, recur) {
  if (!instanceDate) return null;
  if (status === 'cancel') return null;
  if (!isTerminalStatus(status)) return null;

  var r = recur;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_e) { return null; } }
  if (!r || r.type === 'rolling') return null;

  var phaseAnchor = currentAnchor || instanceDate;
  var candidate = nextMatchingDate(r, instanceDate, phaseAnchor);
  if (!candidate) return null;

  // Guard: never move the anchor backwards (stale/duplicate event).
  if (currentAnchor && candidate < currentAnchor) return null;
  return candidate;
}

module.exports = { isPatternRecurMaster, computeNextOccurrenceAnchor };
