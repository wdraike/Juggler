/**
 * conflictBucketsSplitOverdueCollapse.test.js — RED-only step 0
 * (leg: juggler-issues-split-overdue-collapse, WBS W1).
 *
 * Bug: `computeConflictBuckets` (conflictBuckets.js) pushes every overdue task
 * ROW individually into `overdue`, with no grouping by split occurrence.
 * `DailyView.jsx` (~289-303) already solves this exact problem for its
 * Unscheduled lane: it groups raw rows by
 *   t.splitGroup || (t.sourceId ? t.sourceId + '|' + t.date : t.id)
 * and, when count > 1, returns the row augmented with `_unplacedChunkCount` /
 * `_unplacedTotalDur` instead of returning each chunk separately.
 *
 * Field-naming decision (telly, step 0 — documented per WBS W1 instruction):
 *   - The `unplacedForDisplay` bucket reuses the EXISTING `_unplacedChunkCount`
 *     / `_unplacedTotalDur` fields — it is literally the same "unplaced chunk
 *     group" concept DailyView already names that way, just surfaced on a
 *     different page.
 *   - The `overdue` bucket gets its OWN new fields, `_overdueChunkCount` /
 *     `_overdueTotalDur` — an overdue split occurrence is a distinct concept
 *     from an unplaced one (it IS placed on the calendar, just past its
 *     deadline), so borrowing the "unplaced" name for it would be misleading
 *     in ConflictsView's markup/DOM (W2 renders both sections from the same
 *     component tree). This keeps each bucket's badge field self-describing.
 *
 * These tests are RED against the CURRENT unmodified conflictBuckets.js
 * (no grouping exists at all yet) — this file proves the bug and pins the
 * fix's target shape. Production code is NOT touched by this file.
 *
 * Run: cd juggler/juggler-frontend && npx react-scripts test conflictBucketsSplitOverdueCollapse --watchAll=false
 *
 * Traceability: WBS-juggler-issues-split-overdue-collapse.md W1.
 */
import { computeConflictBuckets } from '../conflictBuckets';

var TODAY = new Date('2026-06-24T12:00:00');

function run(tasks, extra) {
  return computeConflictBuckets(Object.assign({
    allTasks: tasks, statuses: (extra && extra.statuses) || {},
    unplaced: (extra && extra.unplaced) || [],
    backlog: (extra && extra.backlog) || [],
    schedulerWarnings: (extra && extra.warnings) || [],
    today: TODAY
  }, {}));
}

// A single recurring split occurrence, fabricated into 4 chunk rows — the
// exact shape the scheduler produces for a split recurring instance whose
// deadline has passed (each chunk carries its own row + its own `overdue`
// flag, but all 4 share one `splitGroup`).
function splitChunk(id, ordinal) {
  return {
    id: id,
    splitGroup: 'occA',
    splitTotal: 4,
    split_total: 4,
    splitOrdinal: ordinal,
    sourceId: 'M-occA',
    date: '2026-06-20',
    overdue: true
  };
}

describe('conflictBuckets — split-occurrence collapse (RED, W1)', function() {

  test('RED: 4 chunks of one overdue split occurrence collapse to exactly 1 overdue entry, carrying a chunk-count field', function() {
    var chunks = [splitChunk('sp1', 1), splitChunk('sp2', 2), splitChunk('sp3', 3), splitChunk('sp4', 4)];
    var r = run(chunks, { statuses: { sp1: '', sp2: '', sp3: '', sp4: '' } });

    // Currently FAILS: unmodified code pushes all 4 rows individually.
    expect(r.overdue).toHaveLength(1);
    expect(r.overdue[0].splitGroup).toBe('occA');
    expect(r.overdue[0]._overdueChunkCount).toBe(4);

    // The badge (actionCount) must match the collapsed page count, not the
    // raw per-chunk count.
    expect(r.actionCount).toBe(1);
  });

  test('REGRESSION-GUARD (must stay GREEN before AND after the fix): 3 unrelated non-split overdue tasks still render as 3 separate entries', function() {
    var tasks = [
      { id: 'a', deadline: '2026-06-01' },              // no splitGroup, no splitTotal
      { id: 'b', overdue: true },                        // no splitGroup, splitTotal absent
      { id: 'c', deadline: '2026-06-10', splitTotal: 1 }  // splitTotal:1 -> not a split
    ];
    var r = run(tasks, { statuses: { a: '', b: '', c: '' } });

    expect(r.overdue).toHaveLength(3);
    expect(r.overdue.map(function(t) { return t.id; }).sort()).toEqual(['a', 'b', 'c']);
    // None of these should carry a chunk-count field — they are not grouped.
    r.overdue.forEach(function(t) { expect(t._overdueChunkCount).toBeUndefined(); });
    expect(r.actionCount).toBe(3);
  });

  test('RED: a split occurrence that is BOTH overdue AND unplaced surfaces exactly ONCE total (999.862/REG-49 invariant extended to grouping)', function() {
    var chunks = [splitChunk('du1', 1), splitChunk('du2', 2), splitChunk('du3', 3), splitChunk('du4', 4)];
    // The scheduler also reports these same 4 chunks as unplaced (same ids,
    // same splitGroup) — the common shape for a missed-recurring-instance
    // occurrence per the existing REG-49 comment in conflictBuckets.js.
    var unplacedRows = [splitChunk('du1', 1), splitChunk('du2', 2), splitChunk('du3', 3), splitChunk('du4', 4)];

    var r = run(chunks, {
      statuses: { du1: '', du2: '', du3: '', du4: '' },
      unplaced: unplacedRows
    });

    // Currently FAILS: unmodified code has no grouping, so `overdue` has 4
    // individual rows (each already de-duped OUT of unplacedForDisplay by
    // the existing per-id logic, but not collapsed across chunks).
    expect(r.overdue).toHaveLength(1);
    expect(r.overdue[0]._overdueChunkCount).toBe(4);

    // The per-id REG-49 invariant must still hold post-grouping: this
    // occurrence must NOT also appear as a (separately collapsed) group
    // under unplacedForDisplay -- i.e. not two collapsed groups for one
    // occurrence, one under each bucket.
    var unplacedOccA = r.unplacedForDisplay.filter(function(t) { return t.splitGroup === 'occA'; });
    expect(unplacedOccA).toHaveLength(0);

    // Combined surfaced count for this one occurrence, across BOTH buckets,
    // must be exactly 1 (the canonical bucket is Overdue, per the existing
    // "stronger state wins" rule documented in conflictBuckets.js).
    expect(r.overdue.length + unplacedOccA.length).toBe(1);

    // Badge must count the occurrence once, not 4 times and not twice
    // (once per bucket).
    expect(r.actionCount).toBe(1);
  });

  // ── PERMANENT REGRESSION TEST — zoe-block-mixedstate-doublesurface ──
  // (bert-REVIEW.json iter3, zoe-REVIEW.json finding zoe-block-mixedstate-doublesurface,
  // BLOCK, confidence:med). zoe proved: a GENERATED split occurrence whose sibling
  // chunks carry DIVERGENT per-row `overdue` flags (some chunks overdue:true, some
  // overdue:false) double-surfaces — once collapsed under Overdue, and AGAIN as a
  // second collapsed group under Unplaced for the non-overdue siblings — because
  // conflictBuckets.js l73 (`if (t.generated && !t.overdue) return;`) short-circuits
  // the non-overdue siblings OUT of the allTasks-derived `overdue`/`stale`/`blocked`
  // loop entirely (they never even reach the deadline check), while they still arrive
  // independently via the separately-supplied `unplaced` prop. The OLD dual-shape
  // dedupe (`overdueIds`, keyed on raw per-chunk `id`) only excluded unplaced rows
  // whose OWN id was also in `overdue` — it never excluded a sibling id. bert's fix
  // re-keys the dedupe on OCCURRENCE identity (`occurrenceKey()` — same key
  // `groupBySplitOccurrence` uses), computed from the raw `overdue` list, so ANY
  // overdue chunk of an occurrence excludes the WHOLE occurrence (every sibling id)
  // from `unplacedForDisplay`.
  //
  // This test pins that fix permanently: it must be RED against bert's PRE-fix
  // per-id dedupe and GREEN against the occurrence-keyed dedupe. Confirmed both ways
  // by stashing/restoring conflictBuckets.js (see telly-REVIEW.json this session for
  // the exact commands + captured RED failure output).
  test('REGRESSION (zoe-block-mixedstate-doublesurface): a split occurrence with SOME generated chunks overdue:true and SIBLING chunks overdue:false (present in `unplaced`) surfaces EXACTLY ONCE total, under Overdue only — never split across overdue + unplacedForDisplay', function() {
    function mixChunk(id, ordinal, isOverdue) {
      return {
        id: id,
        splitGroup: 'occMix',
        splitTotal: 4,
        split_total: 4,
        splitOrdinal: ordinal,
        sourceId: 'M-occMix',
        date: '2026-06-20',
        deadline: '2026-06-01',
        generated: true,
        overdue: isOverdue
      };
    }
    var mixA = mixChunk('mixA', 1, true);
    var mixB = mixChunk('mixB', 2, true);
    var mixC = mixChunk('mixC', 3, false);
    var mixD = mixChunk('mixD', 4, false);

    // allTasks carries all 4 sibling chunks of the SAME occurrence (occMix).
    // mixC/mixD are `generated:true && overdue:false` -> l73's short-circuit skips
    // them entirely from the allTasks-derived overdue/stale/blocked loop (zoe's
    // exact traced mechanism) -- they never become candidates for `overdue` at all.
    var allTasks = [mixA, mixB, mixC, mixD];
    // The scheduler ALSO independently reports mixC/mixD as unplaced (its own raw
    // list, not derived from allTasks) -- same ids, same splitGroup.
    var unplacedRows = [mixC, mixD];

    var r = run(allTasks, {
      statuses: { mixA: '', mixB: '', mixC: '', mixD: '' },
      unplaced: unplacedRows
    });

    // The occurrence surfaces under Overdue exactly once (one collapsed group),
    // carrying the 2 chunks that individually triggered overdue (mixA/mixB) --
    // mixC/mixD never entered the allTasks-derived `overdue` list at all (l73), so
    // they are not counted into _overdueChunkCount, but the WHOLE occurrence must
    // still be excluded from Unplaced (assertion below).
    expect(r.overdue).toHaveLength(1);
    expect(r.overdue[0].splitGroup).toBe('occMix');
    expect(r.overdue[0]._overdueChunkCount).toBe(2);

    // THE CORE ASSERTION: the non-overdue sibling chunks (mixC/mixD) must NOT form
    // a second, separately-collapsed group under Unplaced. On bert's PRE-fix per-id
    // dedupe, mixC/mixD (distinct ids, never in `overdue`) survive the id-match and
    // DO form a second occMix group here -- this is the exact double-surface bug.
    var unplacedOccMix = r.unplacedForDisplay.filter(function(t) { return t.splitGroup === 'occMix'; });
    expect(unplacedOccMix).toHaveLength(0);
    expect(r.unplacedForDisplay).toHaveLength(0);

    // Combined surfaced total for this ONE occurrence, across BOTH buckets, must
    // be exactly 1 -- never split across overdue + unplacedForDisplay.
    expect(r.overdue.length + unplacedOccMix.length).toBe(1);

    // Badge (actionCount) reflects the single collapsed occurrence -- not 2 (one
    // per bucket, the bug) and not 4 (one per raw chunk).
    expect(r.actionCount).toBe(1);
  });

});
