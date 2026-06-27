/**
 * Covers: AC-840-3 / AC-881-1 — fail-loud disjointness assertion at the persist boundary
 * Layer: unit — pure function, no DB, no network, no wall-clock.
 * Leg: juggler-sweep-overdue
 *
 * Contract: checkPlacementDisjointness(dayPlacements)
 *   → array of violation objects { date, a: <taskId>, b: <taskId>, aStart, aEnd, bStart }
 *   for any same-day pair where prev.start + prev.dur > next.start (sorted by start).
 *   Touching boundary (aEnd === bStart) is NOT a violation.
 *
 * dayPlacements shape:
 *   { 'YYYY-MM-DD': [ { task: { id: string }, start: <int min-since-midnight>, dur: <int min> } ] }
 *
 * STATUS: RED until bert adds checkPlacementDisjointness to runSchedule.js exports.
 * bert must:
 *   1. Implement checkPlacementDisjointness(dayPlacements) as a pure helper in runSchedule.js.
 *   2. Export it from module.exports (or under _testOnly for prod hygiene; the test imports
 *      directly from the top-level exports as a first-class named export per SPEC AC-840-3).
 *
 * SELF-MUTATION: when bert adds the implementation, verify by temporarily swapping the overlap
 * predicate from `>` to `>=` — the DISJOINT test (boundary touch) must flip RED, proving the
 * boundary condition is correctly pinned.
 *
 * Traceability: AC-840-3 / AC-881-1 row in TRACEABILITY.md
 */

'use strict';

process.env.NODE_ENV = 'test';

// checkPlacementDisjointness does NOT yet exist in runSchedule.js exports.
// This destructuring resolves to undefined → tests will throw TypeError → RED.
const { checkPlacementDisjointness } = require('../../../src/scheduler/runSchedule');

describe('checkPlacementDisjointness — AC-840-3 / AC-881-1', () => {

  // ── OVERLAP ─────────────────────────────────────────────────────────────────
  // A: 13:00-14:00 (start=780, dur=60, end=840)
  // B: 13:20-13:50 (start=800, dur=30)
  // 780 + 60 = 840 > 800 → overlap → 1 violation naming both ids
  test('OVERLAP: entries A[780,60] and B[800,30] on same day produce 1 violation with both task ids', () => {
    const dayPlacements = {
      '2026-06-26': [
        { task: { id: 'cut-grass' }, start: 780, dur: 60 },  // 13:00-14:00
        { task: { id: 'other'     }, start: 800, dur: 30 },  // 13:20-13:50
      ],
    };
    const violations = checkPlacementDisjointness(dayPlacements);
    expect(violations).toHaveLength(1);
    expect(violations[0].date).toBe('2026-06-26');
    // violation must name both task ids (either as .a/.b or somewhere in the object)
    const ids = [violations[0].a, violations[0].b];
    expect(ids).toContain('cut-grass');
    expect(ids).toContain('other');
  });

  // ── DISJOINT — touching boundary ────────────────────────────────────────────
  // A: 13:00-14:00 (start=780, dur=60, end=840)
  // B: 14:00-14:30 (start=840, dur=30)
  // 780 + 60 = 840 == 840 → NOT an overlap (touching is allowed) → 0 violations
  test('DISJOINT: entries A[780,60] and B[840,30] touching boundary produce 0 violations', () => {
    const dayPlacements = {
      '2026-06-26': [
        { task: { id: 'task-a' }, start: 780, dur: 60 },  // 13:00-14:00
        { task: { id: 'task-b' }, start: 840, dur: 30 },  // 14:00-14:30
      ],
    };
    const violations = checkPlacementDisjointness(dayPlacements);
    expect(violations).toHaveLength(0);
  });

  // ── MULTI-DAY isolation ──────────────────────────────────────────────────────
  // An overlapping pair on different dateKeys must NEVER produce a cross-day violation.
  // Even though B.start(800) < A.start+A.dur(840), they are on different dates.
  test('MULTI-DAY: overlapping entries on different dateKeys produce 0 violations (no cross-day check)', () => {
    const dayPlacements = {
      '2026-06-26': [
        { task: { id: 'task-a' }, start: 780, dur: 60 },  // 13:00-14:00
      ],
      '2026-06-27': [
        { task: { id: 'task-b' }, start: 800, dur: 30 },  // 13:20-13:50 (different day)
      ],
    };
    const violations = checkPlacementDisjointness(dayPlacements);
    expect(violations).toHaveLength(0);
  });

});
