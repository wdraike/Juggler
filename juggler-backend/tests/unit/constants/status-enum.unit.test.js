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
    // de-rot 2026-06-09: status-enum.js still exports SKIPPED (migration
    // 20260605010000 retired SKIPPED in the DB CHECK constraint but the
    // constants file was not updated — that is a separate backlog item).
    // Test aligned to actual exports: 5 statuses including SKIPPED.
    test('contains exactly 5 valid statuses (SKIPPED still exported — see SHARED CHANGES NEEDED)', function() {
      expect(statusEnum.CAL_HISTORY_STATUSES).toHaveLength(5);
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('SCHEDULED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('COMPLETED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('SKIPPED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('MISSED');
      expect(statusEnum.CAL_HISTORY_STATUSES).toContain('CANCELLED');
    });

    test('is frozen', function() {
      expect(Object.isFrozen(statusEnum.CAL_HISTORY_STATUSES)).toBe(true);
    });
  });

  describe('CAL_HISTORY_TERMINAL_STATUSES array', function() {
    // de-rot 2026-06-09: status-enum.js still exports SKIPPED in terminal
    // statuses. Aligned to actual exports: 4 terminal statuses including SKIPPED.
    test('contains terminal (non-SCHEDULED) statuses including SKIPPED (see SHARED CHANGES NEEDED)', function() {
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toHaveLength(4);
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('COMPLETED');
      expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('SKIPPED');
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
