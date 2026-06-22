/**
 * BUG-812 regression — parseTimeToMinutes 24-hr / HH:MM:SS inputs return null
 *
 * Root cause: the regex only matches 12-hr "H:MM AM/PM" and an ambiguous range
 * format ("H:MM -"). A plain 24-hr string like "14:30" or a MySQL TIME column
 * value like "14:30:00" falls through to `return null`.
 *
 * Covers:
 *   - TRACEABILITY BUG-812 (dateHelpers.js:parseTimeToMinutes)
 * Layer: unit (pure function, no DB)
 */

'use strict';

const { parseTimeToMinutes } = require('../../src/scheduler/dateHelpers');

describe('BUG-812 — parseTimeToMinutes 24-hr / HH:MM:SS support', () => {
  // ── NEW CASES THAT MUST PASS AFTER THE FIX (currently return null → RED) ──

  describe('24-hr HH:MM format', () => {
    it('BUG-812a: "14:30" → 870 (currently null → RED)', () => {
      // Pre-fix: falls through both branches (no AM/PM, no " -"), returns null
      expect(parseTimeToMinutes('14:30')).toBe(870);
    });

    it('BUG-812b: "09:05" → 545 (currently null → RED)', () => {
      expect(parseTimeToMinutes('09:05')).toBe(545);
    });

    it('BUG-812c: "00:00" → 0 midnight (currently null → RED)', () => {
      expect(parseTimeToMinutes('00:00')).toBe(0);
    });

    it('BUG-812d: "12:00" → 720 noon (currently null → RED)', () => {
      expect(parseTimeToMinutes('12:00')).toBe(720);
    });

    it('BUG-812e: "23:59" → 1439 (currently null → RED)', () => {
      expect(parseTimeToMinutes('23:59')).toBe(1439);
    });
  });

  describe('24-hr HH:MM:SS format (MySQL TIME column value)', () => {
    it('BUG-812f: "14:30:00" → 870 (currently null → RED)', () => {
      // MySQL TIME columns surface as "HH:MM:SS" strings in test-bed
      expect(parseTimeToMinutes('14:30:00')).toBe(870);
    });

    it('BUG-812g: "09:05:00" → 545 (currently null → RED)', () => {
      expect(parseTimeToMinutes('09:05:00')).toBe(545);
    });

    it('BUG-812h: "00:00:00" → 0 (currently null → RED)', () => {
      expect(parseTimeToMinutes('00:00:00')).toBe(0);
    });
  });

  // ── EXISTING 12-HR BEHAVIOUR — must remain GREEN after the fix (regression guard) ──

  describe('12-hr format regression guard', () => {
    it('REG: "2:30 PM" → 870', () => {
      expect(parseTimeToMinutes('2:30 PM')).toBe(870);
    });

    it('REG: "12:00 AM" → 0', () => {
      expect(parseTimeToMinutes('12:00 AM')).toBe(0);
    });

    it('REG: "12:00 PM" → 720', () => {
      expect(parseTimeToMinutes('12:00 PM')).toBe(720);
    });

    it('REG: "9:00 AM" → 540', () => {
      expect(parseTimeToMinutes('9:00 AM')).toBe(540);
    });

    it('REG: "5:00 PM" → 1020', () => {
      expect(parseTimeToMinutes('5:00 PM')).toBe(1020);
    });

    it('REG: empty string → null', () => {
      expect(parseTimeToMinutes('')).toBeNull();
    });

    it('REG: null → null', () => {
      expect(parseTimeToMinutes(null)).toBeNull();
    });
  });
});
