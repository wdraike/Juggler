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

  var actionCount = overdue.length + unplacedList.length + warnings.length;
  var infoCount = stale.length + blocked.length + backlogList.length;

  return {
    overdue: overdue,
    stale: stale,
    blocked: blocked,
    unplaced: unplacedList,
    backlog: backlogList,
    warnings: warnings,
    actionCount: actionCount,
    infoCount: infoCount
  };
}
