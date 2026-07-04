/**
 * W1 — DB-single-source: placementMatchesDbRow predicate — unplaced_reason/detail.
 *
 * Regression tests for the partition-leak fix added to runSchedule.js:
 *   if ((dbUpdate.unplaced_reason || null) !== (rawRow.unplaced_reason || null)) return false;
 *   if ((dbUpdate.unplaced_detail  || null) !== (rawRow.unplaced_detail  || null)) return false;
 *
 * Pre-fix behaviour: a placed row whose placement fields already matched the DB
 * would be SKIPPED — so the batched persist's reason-clearing never ran → a stale
 * unplaced_reason from a prior (unplaceable) run persisted on a now-placed row
 * (one-row-one-state violation / partition-leak).
 *
 * Post-fix invariant: the predicate returns FALSE (must write) whenever the DB row
 * carries a non-null unplaced_reason/detail that the placement dbUpdate does not set.
 *
 * PURE unit — no DB, no I/O. placementMatchesDbRow is exported via the
 * process.env.NODE_ENV==='test' guard on module.exports._placementMatchesDbRow.
 *
 * Requirement: W1 DB-single-source — idempotent-on-stable; forces write on first
 * run when stale reason exists, then skips on subsequent runs (reason already null).
 *
 * Three cases mandated by Oscar / telly dispatch:
 *   1. Stale reason on placed row   → FALSE (forces clearing write)
 *   2. Clean placed row, no reason  → TRUE  (idempotent skip)
 *   3. Post-clear second run        → TRUE  (idempotent skip)
 */

'use strict';

process.env.NODE_ENV = 'test';

// runSchedule.js has deep side-effectful requires (db, scheduleQueue, etc.).
// Mock the minimum needed so the module loads without I/O in a unit context.
jest.mock('../../src/db', () => ({
  transaction: jest.fn(),
  raw: jest.fn(),
}));
jest.mock('../../src/lib/db', () => ({
  getDefaultDb: () => ({
    transaction: jest.fn(),
    raw: jest.fn(),
  }),
}));
jest.mock('../../src/scheduler/scheduleQueue', () => ({
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
}));

const { _placementMatchesDbRow } = require('../../src/scheduler/runSchedule');

// ── Minimal synthetic placement dbUpdate (a placed row carries no reason fields) ──
// Mirrors the shape produced by the scheduler's pendingUpdates placement path:
// scheduled_at, date, day, time, unscheduled=null — no reason/detail.
// sched-drop-overdue-column (M-5): `overdue` field removed — a real placement
// dbUpdate never carries it anymore (W3 deleted the write-side entirely), and
// _placementMatchesDbRow no longer compares it (see runSchedule.js:563-569).
function basePlacedDbUpdate(overrides) {
  return Object.assign({
    scheduled_at: '2026-06-22 09:00:00',
    date: '2026-06-22',
    day: 'Monday',
    time: '09:00:00',
    unscheduled: null,
    // unplaced_reason and unplaced_detail intentionally absent (placement updates
    // do not set them; the batched persist clears them via the repository layer).
  }, overrides);
}

// ── Minimal rawRow that already matches the placement fields ─────────────────────
// This is the "would otherwise be skipped" state — all placement cols match.
function matchingRawRow(overrides) {
  return Object.assign({
    scheduled_at: '2026-06-22 09:00:00',
    date: '2026-06-22',
    day: 'Monday',
    time: '09:00:00',
    unscheduled: null,
    unplaced_reason: null,
    unplaced_detail: null,
  }, overrides);
}

// ─────────────────────────────────────────────────────────────────────────────────

describe('W1 — placementMatchesDbRow — unplaced_reason/detail partition-leak fix', () => {

  // Guard: the export is available in test env (proves the seam is reachable).
  test('_placementMatchesDbRow is exported in NODE_ENV=test', () => {
    expect(typeof _placementMatchesDbRow).toBe('function');
  });

  // ── Case 1: stale unplaced_reason on DB row; placement dbUpdate has none ──────
  // The row was previously unplaceable and had its reason written. This run the
  // scheduler placed it. All placement fields now match — but the DB still holds
  // a stale reason. WITHOUT the fix this would return TRUE (skip). WITH the fix
  // the reason mismatch forces FALSE → the clearing write runs.
  describe('Case 1 — stale unplaced_reason on rawRow; dbUpdate has none → FALSE', () => {
    test('1a: rawRow.unplaced_reason="no_slot" forces mismatch (return false)', () => {
      const dbUpdate = basePlacedDbUpdate();
      const rawRow   = matchingRawRow({ unplaced_reason: 'no_slot' });
      expect(_placementMatchesDbRow(dbUpdate, rawRow)).toBe(false);
    });

    test('1b: rawRow.unplaced_reason="tool_conflict" also forces mismatch', () => {
      const dbUpdate = basePlacedDbUpdate();
      const rawRow   = matchingRawRow({ unplaced_reason: 'tool_conflict' });
      expect(_placementMatchesDbRow(dbUpdate, rawRow)).toBe(false);
    });

    test('1c: rawRow.unplaced_detail stale while reason already null → mismatch on detail', () => {
      const dbUpdate = basePlacedDbUpdate();
      const rawRow   = matchingRawRow({ unplaced_reason: null, unplaced_detail: 'requires personal_pc' });
      expect(_placementMatchesDbRow(dbUpdate, rawRow)).toBe(false);
    });

    test('1d: both stale reason and detail on rawRow → mismatch', () => {
      const dbUpdate = basePlacedDbUpdate();
      const rawRow   = matchingRawRow({ unplaced_reason: 'no_slot', unplaced_detail: 'no window' });
      expect(_placementMatchesDbRow(dbUpdate, rawRow)).toBe(false);
    });
  });

  // ── Case 2: clean placed row — no stale reason anywhere → TRUE (idempotent) ──
  // The clearing write already ran (or the task was always placed). Both the DB
  // row and the placement dbUpdate carry null reason/detail. All fields match →
  // TRUE (skip is correct — no redundant write needed).
  describe('Case 2 — clean placed row; no reason on either side → TRUE (skip)', () => {
    test('2a: both unplaced_reason null → returns true', () => {
      const dbUpdate = basePlacedDbUpdate();
      const rawRow   = matchingRawRow(); // unplaced_reason/detail both null
      expect(_placementMatchesDbRow(dbUpdate, rawRow)).toBe(true);
    });

    test('2b: rawRow.unplaced_reason undefined (col absent) treated as null → true', () => {
      const dbUpdate = basePlacedDbUpdate();
      const rawRow   = matchingRawRow();
      delete rawRow.unplaced_reason;
      delete rawRow.unplaced_detail;
      expect(_placementMatchesDbRow(dbUpdate, rawRow)).toBe(true);
    });

    test('2c: rawRow.unplaced_reason empty string (falsy → null) treated as null → true', () => {
      // DB should never write '' but if it does, || null coerces it same as null.
      const dbUpdate = basePlacedDbUpdate();
      const rawRow   = matchingRawRow({ unplaced_reason: '', unplaced_detail: '' });
      expect(_placementMatchesDbRow(dbUpdate, rawRow)).toBe(true);
    });
  });

  // ── Case 3: idempotency — after clearing write, second run → TRUE ────────────
  // Simulates what happens on the run AFTER the clearing write completed:
  // DB row now has unplaced_reason=null. Scheduler places it again (same slot).
  // Predicate must return TRUE — no redundant write on an already-clean row.
  describe('Case 3 — post-clear second run; rawRow.unplaced_reason now null → TRUE', () => {
    test('3a: rawRow after clearing write (reason=null) → skip (true)', () => {
      const dbUpdate = basePlacedDbUpdate();
      // Row as it looks in DB after the first run cleared the stale reason:
      const rawRow   = matchingRawRow({ unplaced_reason: null, unplaced_detail: null });
      expect(_placementMatchesDbRow(dbUpdate, rawRow)).toBe(true);
    });
  });

});
