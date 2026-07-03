/**
 * Covers: AC-840-4 — computeEffectiveDeadline combines period-boundary and window-close
 *   into a single explicit effective deadline (the earlier of the two non-null values).
 * Layer: unit — pure function, no DB, no network, no wall-clock.
 * Leg: juggler-sweep-overdue
 *
 * revised leg sched-audit 2026-07-02: max() superseded by locked min()
 * effective-deadline ruling (SCHEDULER-SPEC.md:700, David 2026-06-23,
 * re-affirmed WBS-sched-audit.md:30 as unblocking REG-26/F9). The old "strict
 * max" contract created a dead zone where the persist-sweep believed a
 * same-day-window-closed, still-mid-cycle instance was "still live" for up to
 * a full extra cycle while the scheduler had already marked it unplaced/MISSED
 * this same run (REG-26). min() closes that dead zone: the sweep now agrees
 * with the scheduler the moment EITHER boundary has passed.
 *
 * Contract: computeEffectiveDeadline({ periodBoundary, windowClose })
 *   → Date|null
 *   Rules:
 *   1. Both set → returns the EARLIER Date (min). Overdue as soon as EITHER
 *      deadline has passed — not only when past BOTH.
 *   2. periodBoundary null, windowClose set → returns windowClose.
 *   3. windowClose null, periodBoundary set → returns periodBoundary.
 *   4. Both null → returns null.
 *
 * The function is exported as a named export from runSchedule.js.
 * Traceability: AC-840-4 row in TRACEABILITY.md; REG-26 row in
 *   .planning/kermit/juggy4/TRACEABILITY.md
 */

'use strict';

process.env.NODE_ENV = 'test';

const { computeEffectiveDeadline } = require('../../../src/scheduler/runSchedule');

// ── helpers ──────────────────────────────────────────────────────────────────

function d(iso) { return new Date(iso); }

// ── 1. Both set — picks the EARLIER one (min) ───────────────────────────────
// revised leg sched-audit 2026-07-02: max() superseded by locked min()
// effective-deadline ruling — overdue as soon as EITHER deadline has passed,
// not only when past BOTH (SCHEDULER-SPEC.md:700, David 2026-06-23).

describe('computeEffectiveDeadline — both values set', () => {

  test('periodBoundary later than windowClose → returns windowClose (min)', () => {
    // periodBoundary = 2026-06-23T00:00 (tomorrow midnight, later)
    // windowClose    = 2026-06-22T15:00 (today 11am EDT, earlier)
    // min → windowClose (earlier)
    const periodBoundary = d('2026-06-23T00:00:00.000Z'); // midnight end of cycle
    const windowClose    = d('2026-06-22T15:00:00.000Z'); // today 11:00 EDT
    const result = computeEffectiveDeadline({ periodBoundary, windowClose });
    expect(result).toBe(windowClose);
  });

  test('periodBoundary later than windowClose → returns windowClose, not periodBoundary', () => {
    // windowClose = today 11:00 EDT (15:00 UTC, earlier)
    // periodBoundary = tomorrow midnight EDT (04:00 UTC next day, later)
    const windowClose    = d('2026-06-22T15:00:00.000Z'); // 11:00 EDT
    const periodBoundary = d('2026-06-23T04:00:00.000Z'); // tomorrow midnight EDT
    const result = computeEffectiveDeadline({ periodBoundary, windowClose });
    expect(result).toBe(windowClose);
    // Explicitly not the periodBoundary
    expect(result).not.toBe(periodBoundary);
  });

  test('windowClose later than periodBoundary → returns periodBoundary (distinct from windowClose)', () => {
    // period ends this afternoon (earlier), window closes late tonight (later)
    const periodBoundary = d('2026-06-22T15:00:00.000Z'); // 11:00 EDT (earlier)
    const windowClose    = d('2026-06-22T22:00:00.000Z'); // 18:00 EDT (later)
    const result = computeEffectiveDeadline({ periodBoundary, windowClose });
    expect(result).toBe(periodBoundary);
    // Explicitly not the windowClose
    expect(result).not.toBe(windowClose);
  });

  test('both set to same ms value → returns a Date equal to both (min of equal = either)', () => {
    const ts = '2026-06-22T15:00:00.000Z';
    const periodBoundary = d(ts);
    const windowClose    = d(ts);
    const result = computeEffectiveDeadline({ periodBoundary, windowClose });
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(d(ts).getTime());
  });

});

// ── 2. periodBoundary null — returns windowClose ────────────────────────────

describe('computeEffectiveDeadline — periodBoundary null', () => {

  test('periodBoundary=null, windowClose set → returns windowClose', () => {
    const windowClose = d('2026-06-22T15:00:00.000Z');
    const result = computeEffectiveDeadline({ periodBoundary: null, windowClose });
    expect(result).toBe(windowClose);
  });

  test('periodBoundary=undefined, windowClose set → returns windowClose', () => {
    const windowClose = d('2026-06-22T15:00:00.000Z');
    // opts.periodBoundary will be undefined (== null in the null-check)
    const result = computeEffectiveDeadline({ windowClose });
    expect(result).toBe(windowClose);
  });

});

// ── 3. windowClose null — returns periodBoundary ────────────────────────────

describe('computeEffectiveDeadline — windowClose null', () => {

  test('windowClose=null, periodBoundary set → returns periodBoundary', () => {
    const periodBoundary = d('2026-06-23T04:00:00.000Z');
    const result = computeEffectiveDeadline({ periodBoundary, windowClose: null });
    expect(result).toBe(periodBoundary);
  });

  test('windowClose=undefined, periodBoundary set → returns periodBoundary', () => {
    const periodBoundary = d('2026-06-23T04:00:00.000Z');
    const result = computeEffectiveDeadline({ periodBoundary });
    expect(result).toBe(periodBoundary);
  });

});

// ── 4. Both null — returns null ───────────────────────────────────────────────

describe('computeEffectiveDeadline — both null', () => {

  test('both null → returns null (documented behavior: no deadline)', () => {
    const result = computeEffectiveDeadline({ periodBoundary: null, windowClose: null });
    expect(result).toBeNull();
  });

  test('both undefined → returns null', () => {
    const result = computeEffectiveDeadline({});
    expect(result).toBeNull();
  });

});
