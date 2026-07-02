/**
 * computeColumns — direct characterization of the overlap-clustering /
 * column-assignment layout math (DailyView.jsx:243, `export function
 * computeColumns(placements, hourHeight)`), pinning CURRENT behavior ahead
 * of the 999.965 DailyView.jsx split (the function moves verbatim to
 * dailyViewHelpers.js — see TRACEABILITY.md B1).
 *
 * The adjacent-same-task split-chunk MERGE behavior (target c) already has
 * thorough direct coverage in DailyView.test.jsx's
 * "computeColumns — adjacent same-task chunk collapse (M-SCH-2 / 999.579)"
 * describe block — not duplicated here. This file adds the two behaviors
 * that block was NOT exercising directly: (a) non-overlapping placements'
 * top-offset math, and (b) overlapping placements' column assignment.
 *
 * No jest.mock scaffolding needed: computeColumns has no module-scope side
 * effects at import time and only touches the plain-value GRID_START/
 * MIN_BLOCK_H/BLOCK_GAP constants (see DailyView.test.jsx header comments —
 * those mocks exist for RENDERING the component tree, which this file never
 * does).
 */
import { computeColumns } from '../DailyView';

// hourHeight = 60 -> 1 minute == 1px, so layout math is trivial to reason
// about (matches the convention in DailyView.test.jsx's computeColumns
// suite). GRID_START (state/constants.js) is 6 (6 AM = minute 360); the
// component's `top` is minutes-since-grid-start at 1px/min.
const HOUR_H = 60;
const GRID_START_MIN = 6 * 60; // 360

function oneOff(id, start, end) {
  // No sourceId/splitGroup -> never eligible for the adjacent-chunk merge
  // (confirmed by DailyView.test.jsx's "chunks with no source identity
  // never merge" case), so these are pure one-off tasks for clustering.
  return { start, end, task: { id } };
}

function findBlock(result, id) {
  const b = result.find((r) => r.p.task.id === id);
  if (!b) throw new Error(`no block found for task ${id}`);
  return b;
}

describe('computeColumns — non-overlapping placements get distinct top offsets', () => {
  test('two placements with a time gap each land in their own column at the correct top', () => {
    const placements = [
      oneOff('A', 480, 510), // 8:00-8:30
      oneOff('B', 600, 630), // 10:00-10:30 (a 90-min gap after A ends)
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(2);
    const a = findBlock(result, 'A');
    const b = findBlock(result, 'B');

    // top = (start - GRID_START_MIN) / 60 * hourHeight, 1px/min here.
    expect(a.top).toBe(480 - GRID_START_MIN); // 120
    expect(b.top).toBe(600 - GRID_START_MIN); // 240
    expect(a.top).not.toBe(b.top);

    // Neither overlaps the other in time -> each is alone in its own
    // cluster: single column, not stacked side-by-side.
    expect(a.col).toBe(0);
    expect(b.col).toBe(0);
    expect(a.totalCols).toBe(1);
    expect(b.totalCols).toBe(1);

    expect(a.height).toBe(30); // 510-480
    expect(b.height).toBe(30); // 630-600
  });

  test('three sequential non-overlapping placements each get a strictly increasing top', () => {
    const placements = [
      oneOff('A', 360, 390), // 6:00-6:30 (grid start)
      oneOff('B', 420, 450), // 7:00-7:30
      oneOff('C', 480, 510), // 8:00-8:30
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(3);
    const tops = ['A', 'B', 'C'].map((id) => findBlock(result, id).top);
    expect(tops).toEqual([0, 60, 120]);
    // Strictly increasing, and every block is alone in a 1-wide column.
    expect(tops[1]).toBeGreaterThan(tops[0]);
    expect(tops[2]).toBeGreaterThan(tops[1]);
    result.forEach((r) => {
      expect(r.col).toBe(0);
      expect(r.totalCols).toBe(1);
    });
  });

  // Self-mutation proof (BASE-TESTING golden-master discipline): confirm
  // these assertions actually pin the naturalTop formula rather than
  // trivially passing regardless of it. Swapping the expected top for A/B
  // (a stand-in for a broken `top` computation) must fail.
  test('[mutation guard] a wrong top value is rejected (proves the pin is not vacuous)', () => {
    const placements = [oneOff('A', 480, 510), oneOff('B', 600, 630)];
    const result = computeColumns(placements, HOUR_H);
    const a = findBlock(result, 'A');
    expect(() => expect(a.top).toBe(999)).toThrow();
  });
});

describe('computeColumns — overlapping placements get separate columns', () => {
  test('two time-overlapping placements are split into two columns, not stacked/merged', () => {
    const placements = [
      oneOff('Long', 480, 540),  // 8:00-9:00
      oneOff('Short', 480, 510), // 8:00-8:30, fully inside Long's span
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(2); // not merged into one block
    const long = findBlock(result, 'Long');
    const short = findBlock(result, 'Short');

    // Same cluster (they overlap) -> both must report the cluster-wide
    // column count and be assigned to DIFFERENT columns.
    expect(long.totalCols).toBe(2);
    expect(short.totalCols).toBe(2);
    expect(long.col).not.toBe(short.col);
    expect([long.col, short.col].sort()).toEqual([0, 1]);

    // Both start at the same clock time, at the same grid offset.
    expect(long.top).toBe(short.top);
    expect(long.height).toBe(60); // 540-480
    expect(short.height).toBe(30); // 510-480
  });

  test('three-way overlap (all sharing the same start) uses three columns', () => {
    const placements = [
      oneOff('X', 480, 540),
      oneOff('Y', 480, 540),
      oneOff('Z', 480, 540),
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(3);
    result.forEach((r) => expect(r.totalCols).toBe(3));
    const cols = result.map((r) => r.col).sort();
    expect(cols).toEqual([0, 1, 2]);
  });

  test('a later placement that no longer overlaps reuses a freed column (does not force a 3rd)', () => {
    // A and B overlap (0..60 / 0..30 relative) -> 2 columns. C starts only
    // after A's column is free again (A's visualEnd) but while B's is not
    // -> C should reuse A's column (col 0), keeping totalCols at 2 for the
    // whole cluster, not 3.
    const placements = [
      oneOff('A', 480, 510), // 8:00-8:30 -> col 0, frees at 510
      oneOff('B', 480, 570), // 8:00-9:30 -> col 1, frees at 570
      oneOff('C', 510, 540), // 8:30-9:00 -> starts exactly when A frees
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(3);
    const a = findBlock(result, 'A');
    const b = findBlock(result, 'B');
    const c = findBlock(result, 'C');

    expect(a.totalCols).toBe(2);
    expect(b.totalCols).toBe(2);
    expect(c.totalCols).toBe(2);
    expect(b.col).not.toBe(a.col); // B never shares A's column
    expect(c.col).toBe(a.col);     // C reuses the column A freed
  });

  // Self-mutation proof: a wrong column-count expectation must fail, else
  // the totalCols assertions above would be vacuous.
  test('[mutation guard] a wrong totalCols value is rejected (proves the pin is not vacuous)', () => {
    const placements = [oneOff('Long', 480, 540), oneOff('Short', 480, 510)];
    const result = computeColumns(placements, HOUR_H);
    const long = findBlock(result, 'Long');
    expect(() => expect(long.totalCols).toBe(1)).toThrow();
  });
});
