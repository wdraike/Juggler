/**
 * Unit tests for src/lib/isAllDayTaskBackend.js
 *
 * Covers: B1 (jug-placement-mode-finalize TRACEABILITY)
 * Layer: unit — pure function, no DB or mocks required.
 *
 * Phase 15: the predicate was migrated to placement_mode='all_day' exclusively.
 * The legacy when==='allday' fallback was removed after the Phase 9 backfill
 * populated placement_mode on every row. The REGRESSION test below pins that
 * behavior change so it cannot silently revert.
 */

'use strict';

const { isAllDayTaskBackend } = require('../../../src/lib/isAllDayTaskBackend');

describe('isAllDayTaskBackend', function () {

  // ── Positive: snake_case DB column shape ─────────────────────────────────

  test('returns true when task.placement_mode === "all_day" (snake_case DB form)', function () {
    expect(isAllDayTaskBackend({ placement_mode: 'all_day' })).toBe(true);
  });

  // ── Positive: camelCase in-memory shape ──────────────────────────────────

  test('returns true when task.placementMode === "all_day" (camelCase API form)', function () {
    expect(isAllDayTaskBackend({ placementMode: 'all_day' })).toBe(true);
  });

  // ── Positive: both fields present (no conflict) ──────────────────────────

  test('returns true when both placement_mode and placementMode are "all_day"', function () {
    expect(isAllDayTaskBackend({ placement_mode: 'all_day', placementMode: 'all_day' })).toBe(true);
  });

  // ── Negative: other placement_mode values ────────────────────────────────

  test('returns false when placement_mode is "flexible"', function () {
    expect(isAllDayTaskBackend({ placement_mode: 'flexible' })).toBe(false);
  });

  test('returns false when placement_mode is "reminder"', function () {
    expect(isAllDayTaskBackend({ placement_mode: 'reminder' })).toBe(false);
  });

  test('returns false when placement_mode is "fixed"', function () {
    expect(isAllDayTaskBackend({ placement_mode: 'fixed' })).toBe(false);
  });

  test('returns false when placement_mode is "time_window"', function () {
    expect(isAllDayTaskBackend({ placement_mode: 'time_window' })).toBe(false);
  });

  test('returns false when placement_mode is "time_blocks"', function () {
    expect(isAllDayTaskBackend({ placement_mode: 'time_blocks' })).toBe(false);
  });

  test('returns false when placement_mode is "anytime"', function () {
    expect(isAllDayTaskBackend({ placement_mode: 'anytime' })).toBe(false);
  });

  // ── Negative: null/undefined task ────────────────────────────────────────

  test('returns false when task is null', function () {
    expect(isAllDayTaskBackend(null)).toBe(false);
  });

  test('returns false when task is undefined', function () {
    expect(isAllDayTaskBackend(undefined)).toBe(false);
  });

  test('returns false when task has no placement fields at all', function () {
    expect(isAllDayTaskBackend({ text: 'some task', id: 'abc' })).toBe(false);
  });

  // ── REGRESSION: legacy when==='allday' fallback removed (Phase 15) ───────
  //
  // Prior to Phase 15, a task with when==='allday' was treated as all-day even
  // without a placement_mode. That fallback was removed after the Phase 9 DB
  // backfill populated placement_mode on every row. A task with only
  // when==='allday' must now return FALSE. This pin documents the exact
  // behavior change so it cannot silently revert.

  test('REGRESSION: task with when==="allday" but no placement_mode → false (legacy fallback removed)', function () {
    expect(isAllDayTaskBackend({ when: 'allday', text: 'legacy all-day task' })).toBe(false);
  });

  test('REGRESSION: task with when==="allday" AND wrong placement_mode → false', function () {
    expect(isAllDayTaskBackend({ when: 'allday', placement_mode: 'flexible' })).toBe(false);
  });

  // ── Edge: empty-string placement_mode ────────────────────────────────────

  test('returns false when placement_mode is empty string', function () {
    expect(isAllDayTaskBackend({ placement_mode: '' })).toBe(false);
  });

  test('returns false when placementMode is empty string', function () {
    expect(isAllDayTaskBackend({ placementMode: '' })).toBe(false);
  });

  // ── Edge: null placement fields (data integrity issue — must not throw) ──

  test('returns false when placement_mode is null (should not throw)', function () {
    expect(isAllDayTaskBackend({ placement_mode: null })).toBe(false);
  });

  test('returns false when placementMode is null (should not throw)', function () {
    expect(isAllDayTaskBackend({ placementMode: null })).toBe(false);
  });
});
