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
var { coalesceAdjacentSplitChunks, statusChangeTargets, splitProgress, mergedCardStatus } = require('./coalesceSplits');

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

// 999.1220 (David ruling 2026-07-06): done is CHUNK-ONLY. A done tap on the
// merged card targets the NEXT INCOMPLETE chunk; other statuses keep the R56
// fan-out to every underlying chunk.
var TERMINAL = { done: true, skip: true, cancel: true, missed: true };
function isTerminal(s) { return !!TERMINAL[s]; }

describe('statusChangeTargets (999.1220 chunk-only done)', () => {
  var ids = ['c1', 'c2', 'c3'];

  test('done targets the FIRST incomplete chunk when none are done', () => {
    expect(statusChangeTargets('done', ids, {}, isTerminal)).toEqual(['c1']);
  });

  test('done targets the NEXT incomplete chunk, skipping already-terminal ones', () => {
    expect(statusChangeTargets('done', ids, { c1: 'done' }, isTerminal)).toEqual(['c2']);
    expect(statusChangeTargets('done', ids, { c1: 'done', c2: 'skip' }, isTerminal)).toEqual(['c3']);
  });

  test('done on a fully-terminal group targets NOTHING (no accidental re-write)', () => {
    expect(statusChangeTargets('done', ids, { c1: 'done', c2: 'done', c3: 'done' }, isTerminal)).toEqual([]);
  });

  test('non-done statuses still fan out to EVERY chunk (skip/cancel apply to the occurrence)', () => {
    expect(statusChangeTargets('skip', ids, { c1: 'done' }, isTerminal)).toEqual(['c1', 'c2', 'c3']);
    expect(statusChangeTargets('cancel', ids, {}, isTerminal)).toEqual(['c1', 'c2', 'c3']);
    expect(statusChangeTargets('', ids, { c1: 'done' }, isTerminal)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('splitProgress (999.1220 merged-card "1/3 done" label)', () => {
  test('counts done chunks only', () => {
    expect(splitProgress(['c1', 'c2', 'c3'], { c1: 'done' })).toEqual({ done: 1, total: 3 });
    expect(splitProgress(['c1', 'c2', 'c3'], { c1: 'done', c2: 'skip' })).toEqual({ done: 1, total: 3 });
    expect(splitProgress(['c1', 'c2', 'c3'], {})).toEqual({ done: 0, total: 3 });
    expect(splitProgress(['c1', 'c2'], { c1: 'done', c2: 'done' })).toEqual({ done: 2, total: 2 });
  });
});

describe('mergedCardStatus (999.1220)', () => {
  test('shows the next incomplete chunk\'s status while any chunk is open — card must not strike through on a partial done', () => {
    expect(mergedCardStatus(['c1', 'c2', 'c3'], { c1: 'done' }, isTerminal)).toBe('');
    expect(mergedCardStatus(['c1', 'c2', 'c3'], { c1: 'done', c2: 'wip' }, isTerminal)).toBe('wip');
  });

  test('shows the last chunk\'s terminal status once ALL chunks are settled', () => {
    expect(mergedCardStatus(['c1', 'c2'], { c1: 'done', c2: 'done' }, isTerminal)).toBe('done');
    expect(mergedCardStatus(['c1', 'c2'], { c1: 'done', c2: 'skip' }, isTerminal)).toBe('skip');
  });
});
