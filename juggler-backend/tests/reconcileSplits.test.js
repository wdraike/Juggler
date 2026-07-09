/**
 * Tests for src/lib/reconcile-splits.js — computeChunks, the split-chunk plan
 * function (pure, no DB).
 *
 * 999.1179: the reconcileSplitsForMaster/reconcileSplitsForUser DB reconcile
 * suites were deleted along with those dead exports.
 */
var { computeChunks } = require('../src/lib/reconcile-splits');

describe('computeChunks', () => {
  test('returns [] for zero duration', () => {
    expect(computeChunks(0, 30)).toEqual([]);
    expect(computeChunks(null, 30)).toEqual([]);
  });
  test('90 / 30 → three 30-min chunks', () => {
    expect(computeChunks(90, 30)).toEqual([
      { splitOrdinal: 1, dur: 30, splitTotal: 3 },
      { splitOrdinal: 2, dur: 30, splitTotal: 3 },
      { splitOrdinal: 3, dur: 30, splitTotal: 3 },
    ]);
  });
  test('75 / 30 → two chunks: 30, 45 (tiny last merged into previous)', () => {
    expect(computeChunks(75, 30)).toEqual([
      { splitOrdinal: 1, dur: 30, splitTotal: 2 },
      { splitOrdinal: 2, dur: 45, splitTotal: 2 },
    ]);
  });
  test('30 / 30 → single chunk', () => {
    expect(computeChunks(30, 30)).toEqual([{ splitOrdinal: 1, dur: 30, splitTotal: 1 }]);
  });
  test('45 / 30 → one chunk of 45 (whole dur < 2× min)', () => {
    expect(computeChunks(45, 30)).toEqual([{ splitOrdinal: 1, dur: 45, splitTotal: 1 }]);
  });
  test('100 / 30 → three chunks: 30, 30, 40', () => {
    expect(computeChunks(100, 30)).toEqual([
      { splitOrdinal: 1, dur: 30, splitTotal: 3 },
      { splitOrdinal: 2, dur: 30, splitTotal: 3 },
      { splitOrdinal: 3, dur: 40, splitTotal: 3 },
    ]);
  });
  test('uses default MIN_CHUNK=15 when splitMin null', () => {
    expect(computeChunks(60, null)).toEqual([
      { splitOrdinal: 1, dur: 15, splitTotal: 4 },
      { splitOrdinal: 2, dur: 15, splitTotal: 4 },
      { splitOrdinal: 3, dur: 15, splitTotal: 4 },
      { splitOrdinal: 4, dur: 15, splitTotal: 4 },
    ]);
  });
});
