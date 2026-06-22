/**
 * R56 render-only split coalescing. Pure-function tests (no DOM).
 */
var { coalesceAdjacentSplitChunks } = require('./coalesceSplits');

function chunk(id, src, start, dur, splitTotal) {
  return { task: { id: id, sourceId: src }, start: start, dur: dur, splitTotal: splitTotal, splitOrdinal: 1 };
}

describe('coalesceAdjacentSplitChunks (R56)', () => {
  test('merges contiguous same-master split chunks into one block carrying all ids', () => {
    var input = [
      chunk('m-occ1-1', 'M', 540, 30, 3),
      chunk('m-occ1-2', 'M', 570, 30, 3),
      chunk('m-occ1-3', 'M', 600, 30, 3)
    ];
    var out = coalesceAdjacentSplitChunks(input);
    expect(out.length).toBe(1);
    expect(out[0]._isMergedSplit).toBe(true);
    expect(out[0].dur).toBe(90);                       // summed
    expect(out[0].start).toBe(540);                    // earliest
    expect(out[0]._coalescedIds).toEqual(['m-occ1-1', 'm-occ1-2', 'm-occ1-3']);
  });

  test('does NOT merge a time GAP between same-master chunks', () => {
    var out = coalesceAdjacentSplitChunks([
      chunk('a1', 'M', 540, 30, 2),
      chunk('a2', 'M', 600, 30, 2)   // 570 != 600 → gap, not contiguous
    ]);
    expect(out.length).toBe(2);
    expect(out[0]._isMergedSplit).toBeUndefined();     // single chunk emitted verbatim
  });

  test('does NOT merge chunks of DIFFERENT masters even if contiguous', () => {
    var out = coalesceAdjacentSplitChunks([
      chunk('a1', 'A', 540, 30, 2),
      chunk('b1', 'B', 570, 30, 2)   // contiguous but different master
    ]);
    expect(out.length).toBe(2);
  });

  test('non-split + masterless placements pass through unchanged', () => {
    var plain = { task: { id: 'solo', sourceId: null }, start: 540, dur: 30, splitTotal: 1 };
    var noSrc = { task: { id: 'x', sourceId: null }, start: 600, dur: 30, splitTotal: 3 };
    var out = coalesceAdjacentSplitChunks([plain, noSrc]);
    expect(out.length).toBe(2);
    expect(out[0]).toBe(plain);
    expect(out[1]).toBe(noSrc);                        // splitTotal>1 but no sourceId → not coalesced
  });

  test('merges only the contiguous run, leaving a later detached chunk separate', () => {
    var out = coalesceAdjacentSplitChunks([
      chunk('c1', 'M', 540, 30, 3),
      chunk('c2', 'M', 570, 30, 3),   // contiguous → merge with c1
      chunk('c3', 'M', 660, 30, 3)    // gap → separate
    ]);
    expect(out.length).toBe(2);
    expect(out[0]._coalescedIds).toEqual(['c1', 'c2']);
    expect(out[1]._isMergedSplit).toBeUndefined();
  });
});
