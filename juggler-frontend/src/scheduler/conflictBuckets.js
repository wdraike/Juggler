/**
 * conflictBuckets — single source of truth for the Issues page buckets (999.862).
 *
 * The Issues tab badge (AppLayout) and the Issues page itself (ConflictsView)
 * used to compute "what counts as an issue" independently, with different
 * predicates, so the badge number drifted from the items actually shown
 * (badge read "2" while one item displayed). This module centralizes the
 * bucketing so both consume the exact same computation — the badge can never
 * again disagree with the page.
 *
 * Action Required = overdue + unplaced + scheduler/data warnings.
 * Informational   = past-scheduled-date (stale) + blocked-by-deps + backlog.
 * The badge reflects Action Required (the actionable count), matching the
 * red "Action Required" group on the Issues page.
 */
import { parseDate } from './dateHelpers';
import { getDepsStatus } from './dependencyHelpers';
import { isTerminalStatus } from '../shared/task-status';

export function computeConflictBuckets({ allTasks, statuses, unplaced, backlog, schedulerWarnings, today }) {
  var tasks = allTasks || [];
  var st = statuses || {};
  var overdue = [];
  var stale = [];
  var blocked = [];

  tasks.forEach(function(t) {
    var status = st[t.id] || '';
    if (isTerminalStatus(status)) return;
    // Recurring templates are blueprints, not actionable.
    if (t.taskType === 'recurring_template') return;
    // Generated recurring instances are scheduler-managed unless flagged overdue.
    if (t.generated && !t.overdue) return;

    var isOverdue = false;
    if (t.deadline) {
      var dd = parseDate(t.deadline);
      if (dd && dd < today) isOverdue = true;
    }
    if (t.overdue) isOverdue = true;

    if (isOverdue) {
      overdue.push(t);
    } else if (!t.deadline && t.date && t.date !== 'TBD') {
      var td = parseDate(t.date);
      if (td && td < today) stale.push(t);
    }

    var deps = getDepsStatus(t, tasks, st);
    if (!deps.satisfied) blocked.push(t);
  });

  var unplacedList = unplaced || [];
  var backlogList = backlog || [];
  var warnings = schedulerWarnings || [];

  // sched-audit REG-49/F10 — a row that is BOTH overdue AND unplaced (the common
  // shape for a missed-recurring-instance row: scheduler reports it unplaced while
  // rowToTask also flags it overdue) must count ONCE toward actionCount, not twice.
  // Dedupe overdue/unplaced by task id before summing; `warnings` are structural
  // scheduler-warning objects (taskId/depId refs, not task rows), so they aren't
  // part of this id-space and are summed as before.
  var actionIds = {};
  overdue.forEach(function(t) { if (t && t.id != null) actionIds[t.id] = true; });
  unplacedList.forEach(function(t) { if (t && t.id != null) actionIds[t.id] = true; });
  var actionCount = Object.keys(actionIds).length + warnings.length;
  var infoCount = stale.length + blocked.length + backlogList.length;

  // sched-audit L3 ernie BLOCK (l3-ernie-1) — the id-dedupe above only fixed the
  // badge's COUNT (actionCount). The Issues PAGE renders `overdue` and `unplaced`
  // as two separate sections, so a dual-shape row (both overdue and unplaced)
  // still rendered TWICE even after actionCount was deduped, re-breaking the
  // 999.862 badge==page invariant this module exists to guarantee. `unplaced`
  // above is left unchanged (raw scheduler-reported list — some callers may
  // still want the undeduped shape / it's covered by the F10 unit test contract).
  // `unplacedForDisplay` is the same list with any id already present in
  // `overdue` removed, so a page that renders `overdue` + `unplacedForDisplay`
  // shows the row exactly once. Canonical bucket for a dual-shape row = OVERDUE
  // (the stronger state — a thing that's overdue AND unplaced is still, first
  // and foremost, overdue), so the row surfaces under "Overdue", not "Unplaced".
  var overdueIds = {};
  overdue.forEach(function(t) { if (t && t.id != null) overdueIds[t.id] = true; });
  var unplacedForDisplay = unplacedList.filter(function(t) {
    return !(t && t.id != null && overdueIds[t.id]);
  });

  return {
    overdue: overdue,
    stale: stale,
    blocked: blocked,
    unplaced: unplacedList,
    unplacedForDisplay: unplacedForDisplay,
    backlog: backlogList,
    warnings: warnings,
    actionCount: actionCount,
    infoCount: infoCount
  };
}
