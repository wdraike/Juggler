/**
 * Tests for status-enum constants.
 *
 * Validates:
 *   - All status values are frozen
 *   - Helper functions work correctly
 *   - Edge cases (null/undefined/invalid values)
 *
 * BUG 999.308b: SKIPPED was exported by status-enum.js but dropped from the
 * DB cal_history.status CHECK constraint by migration 20260605010000
 * (SKIPPED→CANCELLED). These tests pin the CORRECT, DB-aligned state:
 * no SKIPPED anywhere in the enum. They are RED on the current buggy code
 * and GREEN after bert's W2 fix removes SKIPPED from the 4 export sites.
 */

describe('constants/status-enum', function() {
  var statusEnum;

  beforeAll(function() {
    statusEnum = require('../../../src/constants/status-enum');
  });

  describe('CalHistoryStatus enum', function() {
    test('CalHistoryStatus has expected values', function() {
      expect(statusEnum.CalHistoryStatus.SCHEDULED).toBe('SCHEDULED');
      expect(statusEnum.CalHistoryStatus.COMPLETED).toBe('COMPLETED');
      expect(statusEnum.CalHistoryStatus.MISSED).toBe('MISSED');
      expect(statusEnum.CalHistoryStatus.CANCELLED).toBe('CANCELLED');
    });

    // AC2: enum must NOT expose SKIPPED (dropped from DB CHECK by migration 20260605010000)
    test('AC2: CalHistoryStatus does NOT have a SKIPPED key', function() {
      expect(statusEnum.CalHistoryStatus.SKIPPED).toBeUndefined();
    });

    test('CalHistoryStatus is frozen', function() {
      expect(Object.isFrozen(statusEnum.CalHistoryStatus)).toBe(true);
    });
  });

  describe('CAL_HISTORY_STATUSES array', function() {
    // AC2: exactly 4 statuses — SCHEDULED/COMPLETED/MISSED/CANCELLED — no SKIPPED
    test('AC2: contains exactly 4 valid statuses (SKIPPED removed, DB-aligned)', function() {
      expect(statusEnum.CAL_HISTORY_STATUSES).toHaveLength(4);
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('SCHEDULED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('COMPLETED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('MISSED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('CANCELLED');
    });

    // AC1+AC2: SKIPPED must not appear in the valid-status list
    test('AC1/AC2: does NOT contain SKIPPED', function() {
      expect(statusEnum.CAL_HISTORY_STATUSES).not.toContain('SKIPPED');
    });

    test('is frozen', function() {
      expect(Object.isFrozen(statusEnum.CAL_HISTORY_STATUSES)).toBe(true);
    });
  });

  describe('CAL_HISTORY_TERMINAL_STATUSES array', function() {
    // Terminal = COMPLETED/MISSED/CANCELLED (3 entries); SKIPPED removed
    test('contains exactly 3 terminal statuses (COMPLETED/MISSED/CANCELLED)', function() {
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toHaveLength(3);
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('COMPLETED');
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('MISSED');
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('CANCELLED');
    });

    test('does NOT contain SKIPPED', function() {
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).not.toContain('SKIPPED');
    });

    test('does NOT contain SCHEDULED', function() {
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).not.toContain('SCHEDULED');
    });

    test('is frozen', function() {
      expect(Object.isFrozen(statusEnum.CAL_HISTORY_TERMINAL_STATUSES)).toBe(true);
    });
  });

  describe('isValidCalHistoryStatus helper', function() {
    test('returns true for all valid statuses', function() {
      ['SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'].forEach(function(s) {
        expect(statusEnum.isValidCalHistoryStatus(s)).toBe(true);
      });
    });

    // AC1: SKIPPED is no longer a valid DB status
    test('AC1: returns false for SKIPPED (removed from DB CHECK)', function() {
      expect(statusEnum.isValidCalHistoryStatus('SKIPPED')).toBe(false);
    });

    test('returns false for invalid or missing values', function() {
      ['', 'INVALID', 'scheduled', null, undefined].forEach(function(s) {
        expect(statusEnum.isValidCalHistoryStatus(s)).toBe(false);
      });
    });

    test('returns true for CANCELLED', function() {
      expect(statusEnum.isValidCalHistoryStatus('CANCELLED')).toBe(true);
    });
  });

  describe('isTerminalCalHistoryStatus helper', function() {
    test('returns true for terminal statuses', function() {
      ['COMPLETED', 'MISSED', 'CANCELLED'].forEach(function(s) {
        expect(statusEnum.isTerminalCalHistoryStatus(s)).toBe(true);
      });
    });

    test('returns false for SCHEDULED and invalid values', function() {
      ['SCHEDULED', '', 'INVALID', null, undefined].forEach(function(s) {
        expect(statusEnum.isTerminalCalHistoryStatus(s)).toBe(false);
      });
    });

    test('returns false for SKIPPED (no longer terminal)', function() {
      expect(statusEnum.isTerminalCalHistoryStatus('SKIPPED')).toBe(false);
    });
  });

  describe('getCalHistoryStatusDisplayName helper', function() {
    test('returns correct display names', function() {
      expect(statusEnum.getCalHistoryStatusDisplayName('SCHEDULED')).toBe('Scheduled');
      expect(statusEnum.getCalHistoryStatusDisplayName('COMPLETED')).toBe('Completed');
      expect(statusEnum.getCalHistoryStatusDisplayName('MISSED')).toBe('Missed');
      expect(statusEnum.getCalHistoryStatusDisplayName('CANCELLED')).toBe('Cancelled');
    });

    // AC2: SKIPPED case removed from switch → falls to default → 'Unknown'
    test('AC2: returns Unknown for SKIPPED (case removed from switch)', function() {
      expect(statusEnum.getCalHistoryStatusDisplayName('SKIPPED')).toBe('Unknown');
    });

    test('returns Unknown for invalid status', function() {
      expect(statusEnum.getCalHistoryStatusDisplayName('INVALID')).toBe('Unknown');
      expect(statusEnum.getCalHistoryStatusDisplayName('')).toBe('Unknown');
    });
  });
});
