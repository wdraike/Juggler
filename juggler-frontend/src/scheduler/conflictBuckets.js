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

// juggler-issues-split-overdue-collapse (W1) — group raw per-chunk rows into
// one entry per split occurrence, mirroring DailyView.jsx's Unscheduled-lane
// grouping (DailyView.jsx ~289-303: same key convention, same
// count>1-augments-a-copy shape). `countField`/`durField` let each bucket use
// its own self-describing field names (`_overdueChunkCount`/`_overdueTotalDur`
// for Overdue vs `_unplacedChunkCount`/`_unplacedTotalDur` for Unplaced) rather
// than sharing one ambiguous name across two different concepts.
// zoe-block-mixedstate-doublesurface fix — the occurrence-identity key, factored
// out so the dual-shape dedupe below (l97ish) and the grouping it feeds both key
// on the SAME occurrence identity. Previously the dedupe matched on individual
// row `id`, which only excludes the specific chunks that are themselves overdue;
// a generated split occurrence whose sibling chunks carry `overdue:false` (see
// l59 comment — a generated chunk not itself flagged overdue never enters the
// `overdue` list) survived the id-match and formed its own second collapsed
// group under Unplaced. Keying on occurrence identity instead means ANY chunk of
// an occurrence being overdue removes the WHOLE occurrence (all sibling ids)
// from `unplacedForDisplay` in one pass.
function occurrenceKey(t) {
  return t.splitGroup || (t.sourceId ? t.sourceId + '|' + (t.date || '') : t.id);
}

function groupBySplitOccurrence(rows, countField, durField) {
  var groups = {};
  var order = [];
  rows.forEach(function(t) {
    var key = occurrenceKey(t);
    if (!groups[key]) { groups[key] = { task: t, count: 0, totalDur: 0 }; order.push(key); }
    groups[key].count += 1;
    groups[key].totalDur += (t.dur || 0);
  });
  return order.map(function(k) {
    var g = groups[k];
    if (g.count <= 1) return g.task;
    var augmented = {};
    augmented[countField] = g.count;
    augmented[durField] = g.totalDur;
    return Object.assign({}, g.task, augmented);
  });
}

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
      // Movable overdue tasks (unscheduled=1) are routed to the Unscheduled
      // bucket, not Overdue. Only fixed/ingested events (immovable) stay in
      // the Overdue bucket — they remain pinned on the grid at their slot.
      if (t.unscheduled) {
        // Will be picked up by unplacedList merge below — don't add to overdue.
      } else {
        overdue.push(t);
      }
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

  var infoCount = stale.length + blocked.length + backlogList.length;

  // sched-audit L3 ernie BLOCK (l3-ernie-1) — the id-dedupe above only fixed the
  // badge's COUNT (actionCount). The Issues PAGE renders `overdue` and `unplaced`
  // as two separate sections, so a dual-shape row (both overdue and unplaced)
  // still rendered TWICE even after actionCount was deduped, re-breaking the
  // 999.862 badge==page invariant this module exists to guarantee. `unplaced`
  // above is left unchanged (raw scheduler-reported list — some callers may
  // still want the undeduped shape / it's covered by the F10 unit test contract).
  // `unplacedForDisplay` is the same list with any row belonging to an OVERDUE
  // occurrence removed, so a page that renders `overdue` + `unplacedForDisplay`
  // shows the row exactly once. Canonical bucket for a dual-shape row = OVERDUE
  // (the stronger state — a thing that's overdue AND unplaced is still, first
  // and foremost, overdue), so the row surfaces under "Overdue", not "Unplaced".
  //
  // zoe-block-mixedstate-doublesurface fix — this used to dedupe by raw per-chunk
  // `id` (`overdueIds`), which only strips the specific chunks that are themselves
  // overdue. A GENERATED split occurrence whose chunks have divergent per-row
  // `overdue` flags (some chunks overdue, sibling chunks — distinct ids — not)
  // left its non-overdue siblings in `unplacedForDisplay`, where they formed their
  // OWN collapsed group under Unplaced: one occurrence, surfaced twice. Dedupe
  // now keys on OCCURRENCE identity (`occurrenceKey` — same key the grouping
  // below uses), computed from the raw, ungrouped `overdue` list, so if ANY chunk
  // of an occurrence is overdue the entire occurrence (every sibling id) is
  // excluded from `unplacedForDisplay` in one pass, before grouping runs.
  var overdueOccurrenceKeys = {};
  overdue.forEach(function(t) { if (t) { overdueOccurrenceKeys[occurrenceKey(t)] = true; } });
  var unplacedForDisplay = unplacedList.filter(function(t) {
    return !(t && overdueOccurrenceKeys[occurrenceKey(t)]);
  });

  // juggler-issues-split-overdue-collapse (W1) — collapse each bucket to one
  // entry per split occurrence BEFORE returning, so the Issues page (which
  // renders `overdue` + `unplacedForDisplay` directly) never shows N rows for
  // one occurrence. This runs AFTER the occurrence-keyed dual-shape dedupe above
  // (not before it), so a split occurrence that is both overdue and unplaced
  // (fully or in part — any overdue chunk counts) is first fully removed from
  // `unplacedForDisplay` (occurrence-key match against raw, ungrouped `overdue`)
  // and only THEN grouped — otherwise its non-overdue sibling chunks would form
  // a second, spurious collapsed group under Unplaced, re-breaking the
  // 999.862/REG-49 "surfaces once, under Overdue" invariant.
  var groupedOverdue = groupBySplitOccurrence(overdue, '_overdueChunkCount', '_overdueTotalDur');
  var groupedUnplacedForDisplay = groupBySplitOccurrence(unplacedForDisplay, '_unplacedChunkCount', '_unplacedTotalDur');

  // sched-audit REG-49/F10 (extended, W1) — actionCount now reflects the
  // COLLAPSED/deduped set (one per occurrence), not the raw per-chunk/per-id
  // count, so the badge matches the number of rows actually rendered on the
  // Issues page. `warnings` are structural scheduler-warning objects
  // (taskId/depId refs, not task rows), so they aren't part of this
  // occurrence-space and are summed as before.
  var actionCount = groupedOverdue.length + groupedUnplacedForDisplay.length + warnings.length;

  return {
    overdue: groupedOverdue,
    stale: stale,
    blocked: blocked,
    unplaced: unplacedList,
    unplacedForDisplay: groupedUnplacedForDisplay,
    backlog: backlogList,
    warnings: warnings,
    actionCount: actionCount,
    infoCount: infoCount
  };
}
