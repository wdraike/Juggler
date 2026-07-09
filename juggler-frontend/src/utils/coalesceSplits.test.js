/**
 * R56 render-only split coalescing. Pure-function tests (no DOM).
 *
 * Fixed 2026-07-09: grouping key changed from time-contiguity to
 * task.splitGroup (see coalesceSplits.js header for the full rationale —
 * a terminal chunk's placement end/start drifts to its own actual
 * completion/skip wall-clock time independently of its siblings, so
 * time-contiguity silently stopped merging any occurrence with mixed
 * chunk history). Tests below reflect splitGroup as the sole grouping key.
 */
var { coalesceAdjacentSplitChunks } = require('./coalesceSplits');

function chunk(id, src, start, dur, splitTotal, splitGroup) {
  return {
    task: { id: id, sourceId: src, splitGroup: splitGroup },
    start: start, dur: dur, splitTotal: splitTotal, splitOrdinal: 1
  };
}

describe('coalesceAdjacentSplitChunks (R56)', () => {
  test('merges same-splitGroup chunks into one block carrying all ids', () => {
    var input = [
      chunk('m-occ1-1', 'M', 540, 30, 3, 'occ1'),
      chunk('m-occ1-2', 'M', 570, 30, 3, 'occ1'),
      chunk('m-occ1-3', 'M', 600, 30, 3, 'occ1')
    ];
    var out = coalesceAdjacentSplitChunks(input);
    expect(out.length).toBe(1);
    expect(out[0]._isMergedSplit).toBe(true);
    expect(out[0].dur).toBe(90);                       // summed
    expect(out[0].start).toBe(540);                    // earliest
    expect(out[0]._coalescedIds).toEqual(['m-occ1-1', 'm-occ1-2', 'm-occ1-3']);
  });

  test('STILL merges same-splitGroup chunks across a time GAP (terminal-drift case)', () => {
    // Simulates the real bug: each chunk snapped scheduled_at to its own
    // independent skip/completion wall-clock time, so they're no longer
    // time-contiguous — but they are still the SAME occurrence and must
    // display as one card.
    var out = coalesceAdjacentSplitChunks([
      chunk('a1', 'M', 540, 30, 2, 'occA'),
      chunk('a2', 'M', 1200, 30, 2, 'occA')   // big gap, same splitGroup
    ]);
    expect(out.length).toBe(1);
    expect(out[0]._isMergedSplit).toBe(true);
    expect(out[0]._coalescedIds).toEqual(['a1', 'a2']);
  });

  test('does NOT merge chunks with different splitGroup even if contiguous', () => {
    var out = coalesceAdjacentSplitChunks([
      chunk('a1', 'M', 540, 30, 2, 'occA'),
      chunk('b1', 'M', 570, 30, 2, 'occB')   // contiguous but a DIFFERENT occurrence
    ]);
    expect(out.length).toBe(2);
    expect(out[0]._isMergedSplit).toBeUndefined();
    expect(out[1]._isMergedSplit).toBeUndefined();
  });

  test('does NOT merge chunks of DIFFERENT masters even if contiguous', () => {
    var out = coalesceAdjacentSplitChunks([
      chunk('a1', 'A', 540, 30, 2, 'occA'),
      chunk('b1', 'B', 570, 30, 2, 'occB')
    ]);
    expect(out.length).toBe(2);
  });

  test('non-split + splitGroup-less placements pass through unchanged', () => {
    var plain = { task: { id: 'solo', sourceId: null, splitGroup: null }, start: 540, dur: 30, splitTotal: 1 };
    var noGroup = { task: { id: 'x', sourceId: 'M', splitGroup: null }, start: 600, dur: 30, splitTotal: 3 };
    var out = coalesceAdjacentSplitChunks([plain, noGroup]);
    expect(out.length).toBe(2);
    expect(out[0]).toBe(plain);
    expect(out[1]).toBe(noGroup);                      // splitTotal>1 but no splitGroup → not coalesced
  });

  test('all chunks sharing one splitGroup merge into ONE block, regardless of a later detached-looking chunk', () => {
    var out = coalesceAdjacentSplitChunks([
      chunk('c1', 'M', 540, 30, 3, 'occC'),
      chunk('c2', 'M', 570, 30, 3, 'occC'),
      chunk('c3', 'M', 660, 30, 3, 'occC')   // time gap, but SAME splitGroup — still merges
    ]);
    expect(out.length).toBe(1);
    expect(out[0]._coalescedIds).toEqual(['c1', 'c2', 'c3']);
    expect(out[0]._isMergedSplit).toBe(true);
  });
});
