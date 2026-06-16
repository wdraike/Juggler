/**
 * BUG-143 — parseDayReq unit tests: AC1 (RED) + AC1b (golden-master GREEN)
 *
 * Traceability: .planning/kermit/jug-recur-days-placement/TRACEABILITY.md BUG-143-A
 *
 * RC-A (BUG-143-A): parseDayReq receives a CONCATENATED day-string like 'UMTWRF'
 * (no commas). The current implementation splits by comma only, producing one
 * unrecognised token → count===0 → returns null (UNCONSTRAINED). This makes
 * a weekday-only recurring task appear to allow all days.
 *
 * DECIDED BEHAVIOR (brain #72165):
 *   AC1  — concat strings are decomposed: 'UMTWRF' → {0,1,2,3,4,5}
 *           'MTWRF' → {1,2,3,4,5}
 *           Tests for AC1 are RED on current code (the fix lands in bert's pass).
 *
 *   AC1b — PRESERVE existing formats:
 *           'M,W,F' → {1,3,5}
 *           'weekday' → {1,2,3,4,5}
 *           'weekend' → {0,6}
 *           'any'/null/empty/all-7 → null
 *           unrecognised junk → null
 *           Tests for AC1b are GREEN (golden-master; must stay green post-fix).
 *
 * Pure unit — no DB, no network.
 */

'use strict';

const { parseDayReq } = require('../../../../src/slices/scheduler/domain/logic/ConstraintSolver');

// ── Helper ─────────────────────────────────────────────────────────────────────

/**
 * Build the expected result map for a list of DOW indices (0=Sun..6=Sat).
 * e.g. dows(1,2,3,4,5) → { '1': true, '2': true, '3': true, '4': true, '5': true }
 */
function dows(...indices) {
  const set = {};
  indices.forEach((i) => { set[i] = true; });
  return set;
}

// ── AC1: concat decomposition (RED on current code) ───────────────────────────
// These tests FAIL until bert implements the fix. They pin the DECIDED behavior
// so the suite immediately turns green when the fix lands — not before.

describe('BUG-143 AC1 — parseDayReq: concatenated DOW string decomposition [RED]', () => {
  /**
   * Regression: parseDayReq('MTWRF') must parse each character as a DOW code
   * and return {1,2,3,4,5}. Current code splits by comma only → one token
   * 'MTWRF' not in DOW_CODE_TO_IDX → count=0 → returns null (WRONG).
   */
  test('AC1a: MTWRF (weekday concat, no commas) → {1,2,3,4,5}', () => {
    // BUG-143-A: returns null today (unconstrained). Must return weekday set.
    const result = parseDayReq('MTWRF');
    expect(result).not.toBeNull(); // null means unconstrained — the bug
    expect(result).toEqual(dows(1, 2, 3, 4, 5));
  });

  test('AC1b-concat: UMTWRF (U=Sun + weekdays, no commas) → {0,1,2,3,4,5}', () => {
    // BUG-143-A: returns null today. Must parse U=0, M=1, T=2, W=3, R=4, F=5.
    const result = parseDayReq('UMTWRF');
    expect(result).not.toBeNull();
    expect(result).toEqual(dows(0, 1, 2, 3, 4, 5));
  });

  test('AC1c: MTWRFSU (all 7 days concat) → null (all-7 → unconstrained)', () => {
    // When all 7 are present the existing code returns null — same result as
    // comma format with all 7. The fix must preserve this: count>=7 → null.
    // This is a GREEN case even today if the fix turns all-7 to null.
    // Marked here as AC1 family because it exercises the concat path.
    const result = parseDayReq('MTWRFSU');
    expect(result).toBeNull(); // all 7 → unconstrained → null
  });

  test('AC1d: MWF (3-char concat, no commas) → {1,3,5}', () => {
    // BUG-143-A: returns null today. Must parse M=1, W=3, F=5.
    const result = parseDayReq('MWF');
    expect(result).not.toBeNull();
    expect(result).toEqual(dows(1, 3, 5));
  });

  test('AC1e: SaSu (Sa+Su weekend, 4-char concat) → {0,6}', () => {
    // Multi-char codes: Sa=6, Su=0. Concat decomposition must handle these.
    // BUG-143-A: currently fails (no comma split for multi-char codes).
    const result = parseDayReq('SaSu');
    expect(result).not.toBeNull();
    expect(result).toEqual(dows(0, 6));
  });

  test('AC1f: U (single char Sun) → {0}', () => {
    // Single-char U is a valid DOW code (U=0=Sun) — even one char must work.
    const result = parseDayReq('U');
    expect(result).not.toBeNull();
    expect(result).toEqual(dows(0));
  });

  test('AC1g: object map {M:true,W:true,F:true} is not consumed by parseDayReq (passthrough — recur.days format)', () => {
    // parseDayReq receives t.dayReq (a string field). The object format is
    // t.recur.days. This test confirms parseDayReq does NOT accept an object
    // (that's RC-B territory — the fix feeds recur.days through a separate
    // helper). An object passed here should → null (unrecognised → unconstrained).
    // This is a GREEN golden-master asserting no scope creep into parseDayReq.
    const result = parseDayReq({ M: true, W: true, F: true });
    // [String] on an object → '[object Object]' → no DOW match → null
    expect(result).toBeNull();
  });
});

// ── AC1b: PRESERVE existing formats (GREEN — golden-master) ───────────────────
// These tests must remain green both before and after the fix.
// They characterize the CURRENT correct behavior.

describe('BUG-143 AC1b — parseDayReq: existing formats preserved [GREEN golden-master]', () => {
  test('null → null (unconstrained)', () => {
    expect(parseDayReq(null)).toBeNull();
  });

  test('undefined → null (unconstrained)', () => {
    expect(parseDayReq(undefined)).toBeNull();
  });

  test('"any" → null (unconstrained)', () => {
    expect(parseDayReq('any')).toBeNull();
  });

  test('"" (empty string) → null (unconstrained)', () => {
    expect(parseDayReq('')).toBeNull();
  });

  test('"weekday" → {1,2,3,4,5}', () => {
    expect(parseDayReq('weekday')).toEqual(dows(1, 2, 3, 4, 5));
  });

  test('"weekend" → {0,6}', () => {
    expect(parseDayReq('weekend')).toEqual(dows(0, 6));
  });

  test('"M,W,F" (comma-separated) → {1,3,5}', () => {
    expect(parseDayReq('M,W,F')).toEqual(dows(1, 3, 5));
  });

  test('"M,T,W,R,F,Sa,Su" (all-7 comma) → null (all-7 → unconstrained)', () => {
    expect(parseDayReq('M,T,W,R,F,Sa,Su')).toBeNull();
  });

  test('"M,T,W,R,F" (comma weekdays) → {1,2,3,4,5}', () => {
    expect(parseDayReq('M,T,W,R,F')).toEqual(dows(1, 2, 3, 4, 5));
  });

  test('"Sa,Su" (comma weekend) → {0,6}', () => {
    expect(parseDayReq('Sa,Su')).toEqual(dows(0, 6));
  });

  test('"R" (Thursday single comma-token) → {4}', () => {
    // Single comma-token recognized by DOW_CODE_TO_IDX: R=4
    expect(parseDayReq('R')).toEqual(dows(4));
  });

  test('"junk" → null (unrecognised token)', () => {
    expect(parseDayReq('junk')).toBeNull();
  });

  test('"ZZZZ" → null (no recognised DOW codes)', () => {
    expect(parseDayReq('ZZZZ')).toBeNull();
  });

  test('DOW_CODE_TO_IDX covers all canonical codes', () => {
    // Golden-master: the full code table must remain stable (byte-identical constraint).
    const { DOW_CODE_TO_IDX } = require('../../../../src/slices/scheduler/domain/logic/ConstraintSolver');
    expect(DOW_CODE_TO_IDX).toMatchObject({
      U: 0, Su: 0,
      M: 1,
      T: 2,
      W: 3,
      R: 4,
      F: 5,
      Sa: 6, S: 6
    });
  });
});

// ── WARN-1 pin: whole-token rejection (no partial-parse) ─────────────────────
//
// zoe (2026-06-16) identified a SURVIVING MUTANT: parseConcatToken with a
// partial-parse variant (skip unmatched char instead of returning null) passes
// ALL 33 existing tests because every junk token in AC1b ('junk', 'ZZZZ') has
// ZERO valid chars (partial→empty→null, same result). A MIXED token containing
// at least one valid DOW char followed by an invalid char EXPOSES the mutant:
//   Mx   → valid M(=1) then invalid x → partial-mutant gives {1}, correct gives null
//   MWFq → valid MWF then invalid q → partial-mutant gives {1,3,5}, correct gives null
//   M5W  → valid M then invalid 5 then valid W → partial-mutant gives {1,3}, correct null
//
// These tests KILL the surviving mutant. They must:
//   - PASS on current production code (whole-token rejection in parseConcatToken:104-107)
//   - FAIL if parseConcatToken is mutated to skip-instead-of-reject on unrecognised char
//
// MUTANT-KILL VERIFICATION (manual, Stryker not wired):
//   cp src/slices/scheduler/domain/logic/ConstraintSolver.js /tmp/ConstraintSolver.js.bak
//   Then hand-edit parseConcatToken line ~106: change `return null;` to `i++; continue;`
//   Run: npx jest --testPathPattern='parseDayReq.bug143' --no-coverage --forceExit
//   Expected: the 4 tests below flip RED; all others stay green.
//   Then restore: cp /tmp/ConstraintSolver.js.bak src/slices/scheduler/domain/logic/ConstraintSolver.js

describe('BUG-143 WARN-1 — parseDayReq: whole-token rejection (mixed valid+invalid char kills surviving mutant)', () => {
  /**
   * Covers: BUG-143-A (RC-A parseConcatToken)
   * Layer: unit
   *
   * 'Mx': M is a valid DOW code (=1), 'x' is not.
   * parseConcatToken must return null for the WHOLE token (not {1}).
   * A partial-parse mutant would return {1} — this test catches it.
   */
  test('"Mx" → null (valid M followed by invalid x — whole token rejected)', () => {
    const result = parseDayReq('Mx');
    // A partial-parse mutant returns {1} (parses M, skips x). Correct code returns null.
    expect(result).toBeNull();
  });

  /**
   * 'MWFq': M, W, F are valid (1,3,5), 'q' is not.
   * parseConcatToken must reject the whole token → null (NOT {1,3,5}).
   * Under a skip-invalid mutant: {1:true, 3:true, 5:true} — this catches it.
   */
  test('"MWFq" → null (valid MWF prefix then invalid q — whole token rejected, NOT {1,3,5})', () => {
    const result = parseDayReq('MWFq');
    // Mutant returns {1,3,5} (parses M/W/F, skips q). Correct code returns null.
    expect(result).toBeNull();
  });

  /**
   * 'ZZZZ': All chars invalid — already in AC1b golden-master above.
   * Included here explicitly to document this does NOT kill the mutant
   * (partial→empty→null, same as whole-token reject). The MIXED cases above
   * are what kill the mutant.
   */
  test('"ZZZZ" → null (all invalid — passes even under skip-mutant, but documents the case)', () => {
    // Note: ZZZZ does NOT kill the surviving mutant (skip-mutant also → empty → null).
    // It is included as documentation; the cases above (Mx, MWFq, M5W) are the killers.
    expect(parseDayReq('ZZZZ')).toBeNull();
  });

  /**
   * 'M5W': M(=1) valid, '5' invalid, W(=3) valid.
   * Partial-parse mutant skips '5' and collects M + W → {1,3}. Correct: null.
   * This covers the case where the invalid char is BETWEEN two valid chars.
   */
  test('"M5W" → null (valid M, invalid 5, valid W — whole token rejected, NOT {1,3})', () => {
    const result = parseDayReq('M5W');
    // Mutant returns {1,3} (parses M, skips 5, parses W). Correct code returns null.
    expect(result).toBeNull();
  });
});
