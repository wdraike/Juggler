/**
 * Unit tests for _ordinalSuffixOf — the recurring-instance ordinal-suffix parser
 * used by runSchedule.js to keep maxOrdByMaster ahead of existing instance IDs
 * (collision avoidance). Regression coverage for 999.878.
 *
 * BUG (999.878): instance IDs are "<sourceId>-<ordinal>" or, for split chunks,
 * "<sourceId>-<ordinal>-<splitOrdinal>", where sourceId is a uuid v7. The old
 * parser used the greedy, leftmost-anchored regex:
 *
 *     String(id).match(/-(\d+)(?:-\d+)?$/)
 *
 * When a uuid's FINAL node segment is all decimal digits (a "decimal tail",
 * e.g. "...-481234567890-3") that regex captures the 12-digit uuid node
 * (481234567890) as the "ordinal" and treats the REAL trailing "-3" ordinal as
 * the optional split tail. The bogus ~4.8e11 value is then promoted into
 * maxOrdByMaster and used as the next occurrence_ordinal — which overflows the
 * signed-INT occurrence_ordinal column on insert.
 *
 * RED proof: the `OLD-REGEX reproduction` block below asserts the exact wrong
 * value the legacy regex produced (481234567890). _ordinalSuffixOf must instead
 * return the genuine ordinal (3). A revert of the source helper to the old
 * regex turns the "decimal tail" cases below RED.
 */

process.env.NODE_ENV = 'test';

const { _ordinalSuffixOf: ordinalSuffixOf } = require('../../src/scheduler/runSchedule');

// The legacy parser, inlined verbatim, to PROVE the regression it produced.
function legacyOrdinalSuffix(id) {
  const m = String(id).match(/-(\d+)(?:-\d+)?$/);
  return m ? Number(m[1]) : null;
}

const INT_MAX = 2147483647; // signed MySQL INT ceiling for occurrence_ordinal

describe('999.878 — _ordinalSuffixOf parses occurrence ordinal without INT overflow', () => {
  test('is exported as a function under NODE_ENV=test', () => {
    expect(typeof ordinalSuffixOf).toBe('function');
  });

  describe('OLD-REGEX reproduction (documents the bug that must NOT recur)', () => {
    test('legacy regex mis-captures a numeric uuid-node tail as a huge ordinal', () => {
      const id = '0190a1b2-1234-7000-8000-481234567890-3';
      // Legacy behaviour: captures the 12-digit uuid node, not the real ordinal.
      expect(legacyOrdinalSuffix(id)).toBe(481234567890);
      // ...which would overflow the signed-INT occurrence_ordinal column.
      expect(legacyOrdinalSuffix(id)).toBeGreaterThan(INT_MAX);
    });
  });

  describe('decimal-tail uuid IDs — the 999.878 fix', () => {
    test('recovers the real trailing ordinal, not the numeric uuid node', () => {
      const id = '0190a1b2-1234-7000-8000-481234567890-3';
      expect(ordinalSuffixOf(id)).toBe(3);
    });

    test('never returns a value that would overflow the INT column', () => {
      const id = '0190a1b2-1234-7000-8000-481234567890-7';
      expect(ordinalSuffixOf(id)).toBeLessThanOrEqual(INT_MAX);
      expect(ordinalSuffixOf(id)).toBe(7);
    });

    test('id ending directly in the 12-digit numeric node (no ordinal) returns null, never the overflow value', () => {
      // The penultimate uuid segment is hex-lettered ("89ab") so the ONLY
      // capturable trailing run is the 12-digit numeric node — there is no
      // small fallback segment. Old greedy regex returned 481234567890 (the
      // overflow); the fix must reject it outright. DISCRIMINATING: this flips
      // RED on the pre-fix helper (returns 481234567890), green on the fix.
      const id = '0190a1b2-c3d4-7e5f-89ab-481234567890';
      expect(ordinalSuffixOf(id)).toBeNull();
    });
  });

  describe('MAX_PLAUSIBLE_ORDINAL threshold boundary (10,000,000)', () => {
    // The whole fix turns on this constant: it must accept a real (if absurdly
    // large) ordinal at the ceiling and reject one just past it (a date/uuid
    // node). An off-by-one in the constant would otherwise pass the suite.
    test('a suffix exactly at the ceiling is accepted as an ordinal', () => {
      expect(ordinalSuffixOf('0190a1b2-c3d4-7e5f-89ab-cdef01234567-10000000')).toBe(10000000);
    });

    test('a suffix one past the ceiling is rejected (treated as non-ordinal)', () => {
      expect(ordinalSuffixOf('0190a1b2-c3d4-7e5f-89ab-cdef01234567-10000001')).toBeNull();
    });
  });

  describe('ordinary uuid IDs (hex-lettered final node) parse normally', () => {
    test('plain ordinal suffix', () => {
      expect(ordinalSuffixOf('0190a1b2-c3d4-7e5f-89ab-cdef01234567-3')).toBe(3);
    });

    test('multi-digit ordinal suffix', () => {
      expect(ordinalSuffixOf('0190a1b2-c3d4-7e5f-89ab-cdef01234567-42')).toBe(42);
    });

    test('split-chunk suffix: ordinal is the segment before the split ordinal', () => {
      // "<sourceId>-<ordinal>-<splitOrdinal>" → ordinal 3 (split 2 ignored).
      expect(ordinalSuffixOf('0190a1b2-c3d4-7e5f-89ab-cdef01234567-3-2')).toBe(3);
    });
  });

  describe('legacy YYYYMMDD date-format IDs are not mistaken for ordinals', () => {
    test('8-digit date suffix is rejected (too large to be an ordinal)', () => {
      // Legacy date-format id "<sourceId>-YYYYMMDD" — the date path owns these;
      // the ordinal parser must not promote 20260626 into the ordinal space.
      expect(ordinalSuffixOf('0190a1b2-c3d4-7e5f-89ab-cdef01234567-20260626')).toBeNull();
    });

    test('date-format id with split tail also yields the (small) split, never the date', () => {
      // "<sourceId>-YYYYMMDD-2": first segment (date) implausible → falls back
      // to the trailing small segment.
      expect(ordinalSuffixOf('0190a1b2-c3d4-7e5f-89ab-cdef01234567-20260626-2')).toBe(2);
    });
  });

  describe('edge / malformed inputs', () => {
    test('id with no numeric suffix → null', () => {
      expect(ordinalSuffixOf('0190a1b2-c3d4-7e5f-89ab-cdef01234567')).toBeNull();
    });

    test('non-string / nullish input does not throw', () => {
      expect(ordinalSuffixOf(null)).toBeNull();
      expect(ordinalSuffixOf(undefined)).toBeNull();
    });
  });
});
