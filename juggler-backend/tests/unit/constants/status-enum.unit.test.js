/**
 * Tests for status-enum constants.
 *
 * Validates:
 *   - All status values are frozen
 *   - Helper functions work correctly
 *   - Edge cases (null/undefined/invalid values)
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

    test('CalHistoryStatus is frozen', function() {
      expect(Object.isFrozen(statusEnum.CalHistoryStatus)).toBe(true);
    });
  });

  describe('CAL_HISTORY_STATUSES array', function() {
    test('contains exactly 4 valid statuses', function() {
      expect(statusEnum.CAL_HISTORY_STATUSES).toHaveLength(4);
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('SCHEDULED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('COMPLETED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('MISSED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('CANCELLED');
    });

    test('is frozen', function() {
      expect(Object.isFrozen(statusEnum.CAL_HISTORY_STATUSES)).toBe(true);
    });
  });

  describe('CAL_HISTORY_TERMINAL_STATUSES array', function() {
    test('contains only terminal (non-SCHEDULED) statuses', function() {
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toHaveLength(3);
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('COMPLETED');
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('MISSED');
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('CANCELLED');
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

    test('returns false for invalid or missing values', function() {
      ['', 'INVALID', 'scheduled', null, undefined].forEach(function(s) {
        expect(statusEnum.isValidCalHistoryStatus(s)).toBe(false);
      });
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
  });

  describe('getCalHistoryStatusDisplayName helper', function() {
    test('returns correct display names', function() {
      expect(statusEnum.getCalHistoryStatusDisplayName('SCHEDULED')).toBe('Scheduled');
      expect(statusEnum.getCalHistoryStatusDisplayName('COMPLETED')).toBe('Completed');
      expect(statusEnum.getCalHistoryStatusDisplayName('MISSED')).toBe('Missed');
      expect(statusEnum.getCalHistoryStatusDisplayName('CANCELLED')).toBe('Cancelled');
    });

    test('returns Unknown for invalid status', function() {
      expect(statusEnum.getCalHistoryStatusDisplayName('INVALID')).toBe('Unknown');
      expect(statusEnum.getCalHistoryStatusDisplayName('')).toBe('Unknown');
    });
  });
});
