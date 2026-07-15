/**
 * TASK B — reasonCodes module unit tests
 *
 * Layer: unit — pure module, no DB, no network, no wall-clock.
 *
 * Covers:
 *   - REASON_CODES enum: all 10 values are exactly the pinned strings (output contract).
 *   - REASON_LABELS map: every code maps to a non-snake_case, non-empty friendly label.
 *   - labelFor(code): returns friendly label for known code; returns a humanized
 *     non-crashing fallback for unknown/null/undefined inputs.
 *
 * SELF-MUTATION CONTRACT (Step 6b):
 *   Each pinned string value was verified by temporarily renaming the REASON_CODES key
 *   value in shared/scheduler/reasonCodes.js (e.g. 'tool_conflict' → 'tool_conflict_X')
 *   and confirming the test flips RED, then reverting via /tmp backup.
 *   labelFor() fallback verified by removing the REASON_LABELS entry and confirming the
 *   fallback path fires.
 *
 * DETERMINISM: no Date.now(), no Math.random(), no I/O. Pure module.
 *
 * Traceability: SPEC § Reason-code taxonomy (output contract).
 *   The string values are a public API — callers in unifiedScheduleV2.js, ConflictsView.jsx,
 *   and any future consumer depend on these exact values. Pinning them here catches any
 *   accidental rename before it silently breaks callers.
 */

'use strict';

process.env.NODE_ENV = 'test';

const { REASON_CODES, REASON_LABELS, labelFor } = require('../../../../shared/scheduler/reasonCodes');

// ─── Section 1: REASON_CODES enum values (output contract) ───────────────────
//
// SPEC taxonomy (juggler-recur-nextcycle-unplaced, Reason-code taxonomy section):
//   tool_conflict, location_mismatch, no_slot, impossible_window,
//   weather_unavailable, weather, partial_split, recurring_split_overflow,
//   missed, tpc_budget
//
// These are pinned as a CONTRACT: any rename here is a breaking change that must
// be coordinated with all callers.

describe('REASON_CODES — enum string values (output contract)', () => {

  test('TOOL_CONFLICT value is exactly "tool_conflict"', () => {
    // SELF-MUTATION: change to 'tool_conflict_X' in source → this test FAILS.
    expect(REASON_CODES.TOOL_CONFLICT).toBe('tool_conflict');
  });

  test('LOCATION_MISMATCH value is exactly "location_mismatch"', () => {
    expect(REASON_CODES.LOCATION_MISMATCH).toBe('location_mismatch');
  });

  test('NO_SLOT value is exactly "no_slot"', () => {
    expect(REASON_CODES.NO_SLOT).toBe('no_slot');
  });

  test('IMPOSSIBLE_WINDOW value is exactly "impossible_window"', () => {
    expect(REASON_CODES.IMPOSSIBLE_WINDOW).toBe('impossible_window');
  });

  test('WEATHER_UNAVAILABLE value is exactly "weather_unavailable"', () => {
    expect(REASON_CODES.WEATHER_UNAVAILABLE).toBe('weather_unavailable');
  });

  test('WEATHER value is exactly "weather" (AC2.6 deferred alias — emitted while rename pending)', () => {
    // AC2.6 SPEC open-decision #1: the scheduler currently emits 'weather' (not 'weather_unavailable').
    // This code is kept until the rename decision is resolved and recorded.
    // SELF-MUTATION: change to 'weather_X' → FAILS — callers would silently get wrong code.
    expect(REASON_CODES.WEATHER).toBe('weather');
  });

  test('PARTIAL_SPLIT value is exactly "partial_split"', () => {
    expect(REASON_CODES.PARTIAL_SPLIT).toBe('partial_split');
  });

  test('RECURRING_SPLIT_OVERFLOW value is exactly "recurring_split_overflow"', () => {
    expect(REASON_CODES.RECURRING_SPLIT_OVERFLOW).toBe('recurring_split_overflow');
  });

  test('MISSED value is exactly "missed"', () => {
    expect(REASON_CODES.MISSED).toBe('missed');
  });

  test('TPC_BUDGET value is exactly "tpc_budget"', () => {
    expect(REASON_CODES.TPC_BUDGET).toBe('tpc_budget');
  });

  test('SCHED_COLLISION value is exactly "sched_collision"', () => {
    // Persist-boundary collision guard demotion (999.1568, R11.23).
    // Documented WITHOUT a dedicated REASON_LABELS entry — labelFor falls back
    // to the humanized code ('Sched collision') per the R11.23 taxonomy table.
    expect(REASON_CODES.SCHED_COLLISION).toBe('sched_collision');
  });

  test('REASON_CODES contains exactly 13 entries (no undocumented codes)', () => {
    // Guards against silent addition of undocumented codes without updating REQUIREMENTS.md.
    // If a new code is legitimately added: update REQUIREMENTS.md, SPEC, and increment this count.
    // 10 → 12: DEP_BLOCKED (999.1084) + SPACING_BLOCKED (999.874) added.
    // 12 → 13: SCHED_COLLISION (999.1568, R11.23) — added in 18dc6a74 which
    // documented R11.23 but missed this count; caught by the pool run 2026-07-14.
    expect(Object.keys(REASON_CODES).length).toBe(13);
  });

  test('REASON_CODES is frozen (immutable — cannot be monkey-patched at runtime)', () => {
    // Object.freeze() prevents callers accidentally mutating the enum.
    expect(Object.isFrozen(REASON_CODES)).toBe(true);
  });
});

// ─── Section 2: REASON_LABELS map (no raw snake_case leaks) ──────────────────
//
// Every known code must map to a friendly, human-readable string.
// Invariant: no label contains underscores (they are friendly labels, not codes).
// labelFor() is the primary API; REASON_LABELS is the backing map.

describe('REASON_LABELS — every code maps to a friendly label', () => {

  // Helper: confirm a label is human-readable (no raw snake_case).
  function assertFriendlyLabel(code, label) {
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    // A friendly label must NOT be the raw snake_case code itself.
    expect(label).not.toBe(code);
    // A friendly label must NOT contain underscores (would mean it leaked a code string).
    expect(label).not.toMatch(/_/);
  }

  test('tool_conflict maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.TOOL_CONFLICT];
    assertFriendlyLabel(REASON_CODES.TOOL_CONFLICT, label);
  });

  test('location_mismatch maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.LOCATION_MISMATCH];
    assertFriendlyLabel(REASON_CODES.LOCATION_MISMATCH, label);
  });

  test('no_slot maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.NO_SLOT];
    assertFriendlyLabel(REASON_CODES.NO_SLOT, label);
  });

  test('impossible_window maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.IMPOSSIBLE_WINDOW];
    assertFriendlyLabel(REASON_CODES.IMPOSSIBLE_WINDOW, label);
  });

  test('weather_unavailable maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.WEATHER_UNAVAILABLE];
    assertFriendlyLabel(REASON_CODES.WEATHER_UNAVAILABLE, label);
  });

  test('weather maps to a friendly label (deferred alias)', () => {
    const label = REASON_LABELS[REASON_CODES.WEATHER];
    assertFriendlyLabel(REASON_CODES.WEATHER, label);
  });

  test('partial_split maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.PARTIAL_SPLIT];
    assertFriendlyLabel(REASON_CODES.PARTIAL_SPLIT, label);
  });

  test('recurring_split_overflow maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.RECURRING_SPLIT_OVERFLOW];
    assertFriendlyLabel(REASON_CODES.RECURRING_SPLIT_OVERFLOW, label);
  });

  test('missed maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.MISSED];
    assertFriendlyLabel(REASON_CODES.MISSED, label);
  });

  test('tpc_budget maps to a friendly label', () => {
    const label = REASON_LABELS[REASON_CODES.TPC_BUDGET];
    assertFriendlyLabel(REASON_CODES.TPC_BUDGET, label);
  });

  test('REASON_LABELS is frozen (immutable)', () => {
    expect(Object.isFrozen(REASON_LABELS)).toBe(true);
  });
});

// ─── Section 3: labelFor() helper ────────────────────────────────────────────
//
// labelFor(code) is the primary consumer-facing API.
// It must:
//   (a) return the friendly label for every known code,
//   (b) return a humanized non-crashing fallback for unknown inputs,
//   (c) never return the raw snake_case code itself for known codes,
//   (d) never throw for any input (null, undefined, '', unknown string).

describe('labelFor() — returns friendly label for known codes', () => {

  test('labelFor(TOOL_CONFLICT) returns friendly label matching REASON_LABELS entry', () => {
    const result = labelFor(REASON_CODES.TOOL_CONFLICT);
    expect(result).toBe(REASON_LABELS[REASON_CODES.TOOL_CONFLICT]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(LOCATION_MISMATCH) returns friendly label', () => {
    const result = labelFor(REASON_CODES.LOCATION_MISMATCH);
    expect(result).toBe(REASON_LABELS[REASON_CODES.LOCATION_MISMATCH]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(NO_SLOT) returns friendly label', () => {
    const result = labelFor(REASON_CODES.NO_SLOT);
    expect(result).toBe(REASON_LABELS[REASON_CODES.NO_SLOT]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(IMPOSSIBLE_WINDOW) returns friendly label', () => {
    const result = labelFor(REASON_CODES.IMPOSSIBLE_WINDOW);
    expect(result).toBe(REASON_LABELS[REASON_CODES.IMPOSSIBLE_WINDOW]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(WEATHER_UNAVAILABLE) returns friendly label', () => {
    const result = labelFor(REASON_CODES.WEATHER_UNAVAILABLE);
    expect(result).toBe(REASON_LABELS[REASON_CODES.WEATHER_UNAVAILABLE]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(WEATHER) returns friendly label (deferred alias)', () => {
    const result = labelFor(REASON_CODES.WEATHER);
    expect(result).toBe(REASON_LABELS[REASON_CODES.WEATHER]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(PARTIAL_SPLIT) returns friendly label', () => {
    const result = labelFor(REASON_CODES.PARTIAL_SPLIT);
    expect(result).toBe(REASON_LABELS[REASON_CODES.PARTIAL_SPLIT]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(RECURRING_SPLIT_OVERFLOW) returns friendly label', () => {
    const result = labelFor(REASON_CODES.RECURRING_SPLIT_OVERFLOW);
    expect(result).toBe(REASON_LABELS[REASON_CODES.RECURRING_SPLIT_OVERFLOW]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(MISSED) returns friendly label', () => {
    const result = labelFor(REASON_CODES.MISSED);
    expect(result).toBe(REASON_LABELS[REASON_CODES.MISSED]);
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(TPC_BUDGET) returns friendly label', () => {
    const result = labelFor(REASON_CODES.TPC_BUDGET);
    expect(result).toBe(REASON_LABELS[REASON_CODES.TPC_BUDGET]);
    expect(result).not.toMatch(/_/);
  });
});

describe('labelFor() — non-crashing fallback for unknown/null/undefined inputs', () => {

  // AC spec: "labelFor() on an unknown/null/undefined code returns a humanized
  // non-crashing fallback (NOT throw)."

  test('labelFor(null) returns a string fallback without throwing', () => {
    expect(() => labelFor(null)).not.toThrow();
    const result = labelFor(null);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('labelFor(undefined) returns a string fallback without throwing', () => {
    expect(() => labelFor(undefined)).not.toThrow();
    const result = labelFor(undefined);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('labelFor("") returns a string fallback without throwing', () => {
    expect(() => labelFor('')).not.toThrow();
    const result = labelFor('');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('labelFor("unknown_code") returns a humanized string (not the raw snake_case code)', () => {
    // The fallback must humanize the code: replace underscores, title-case.
    // "unknown_code" → "Unknown code" (or similar). Must NOT be "unknown_code".
    expect(() => labelFor('unknown_code')).not.toThrow();
    const result = labelFor('unknown_code');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // The fallback must not just pass the raw snake_case through.
    expect(result).not.toBe('unknown_code');
    // The fallback replaces underscores (no raw underscores in the output).
    expect(result).not.toMatch(/_/);
  });

  test('labelFor("future_code_not_yet_in_enum") returns humanized fallback without underscores', () => {
    // Proves the fallback handles arbitrary future codes gracefully.
    const result = labelFor('future_code_not_yet_in_enum');
    expect(typeof result).toBe('string');
    expect(result).not.toMatch(/_/);
  });

  test('labelFor(0) returns a string fallback without throwing (non-string input)', () => {
    // Defensive: handles any truthy/falsy non-string input gracefully.
    expect(() => labelFor(0)).not.toThrow();
    expect(typeof labelFor(0)).toBe('string');
  });
});
