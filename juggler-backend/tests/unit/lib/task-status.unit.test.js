/**
 * Tests for shared TERMINAL_STATUSES + isTerminalStatus helper.
 * See: src/lib/task-status.js (juggler-cal-history Plan A)
 */

describe('lib/task-status', function() {
  var taskStatus;

  beforeAll(function() {
    taskStatus = require('../../src/lib/task-status');
  });

  describe('TERMINAL_STATUSES (task_instances)', function() {
    test('TERMINAL_STATUSES is frozen and contains expected values', function() {
      expect(Array.isArray(taskStatus.TERMINAL_STATUSES)).toBe(true);
      expect(Object.isFrozen(taskStatus.TERMINAL_STATUSES)).toBe(true);
      expect(taskStatus.TERMINAL_STATUSES).toEqual(
        expect.arrayContaining(['done', 'cancel', 'skip', 'pause', 'missed'])
      );
    });

    test('TERMINAL_STATUSES has exactly 5 entries (no accidental additions)', function() {
      expect(taskStatus.TERMINAL_STATUSES.length).toBe(5);
    });

    test('isTerminalStatus returns true for all terminal values', function() {
      ['done', 'cancel', 'skip', 'pause', 'missed'].forEach(function(s) {
        expect(taskStatus.isTerminalStatus(s)).toBe(true);
      });
    });

    test('isTerminalStatus returns false for non-terminal values', function() {
      ['', 'wip', 'disabled', null, undefined, 'bogus'].forEach(function(s) {
        expect(taskStatus.isTerminalStatus(s)).toBe(false);
      });
    });
  });

  describe('CAL_HISTORY_STATUSES (cal_history table)', function() {
    test('CAL_HISTORY_STATUSES is frozen with correct enum values', function() {
      expect(Object.isFrozen(taskStatus.CAL_HISTORY_STATUSES)).toBe(true);
      expect(taskStatus.CAL_HISTORY_STATUSES.SCHEDULED).toBe('SCHEDULED');
      expect(taskStatus.CAL_HISTORY_STATUSES.COMPLETED).toBe('COMPLETED');
      expect(taskStatus.CAL_HISTORY_STATUSES.MISSED).toBe('MISSED');
      expect(taskStatus.CAL_HISTORY_STATUSES.CANCELLED).toBe('CANCELLED');
    });

    test('CAL_HISTORY_TERMINAL_STATUSES contains COMPLETED, MISSED, CANCELLED', function() {
      expect(Object.isFrozen(taskStatus.CAL_HISTORY_TERMINAL_STATUSES)).toBe(true);
      expect(taskStatus.CAL_HISTORY_TERMINAL_STATUSES).toContain('COMPLETED');
      expect(taskStatus.CAL_HISTORY_TERMINAL_STATUSES).toContain('MISSED');
      expect(taskStatus.CAL_HISTORY_TERMINAL_STATUSES).toContain('CANCELLED');
      // SCHEDULED is not terminal
      expect(taskStatus.CAL_HISTORY_TERMINAL_STATUSES).not.toContain('SCHEDULED');
    });

    test('isCalHistoryTerminalStatus returns true for terminal statuses', function() {
      ['COMPLETED', 'MISSED', 'CANCELLED'].forEach(function(s) {
        expect(taskStatus.isCalHistoryTerminalStatus(s)).toBe(true);
      });
    });

    test('isCalHistoryTerminalStatus returns false for non-terminal statuses', function() {
      // SCHEDULED is not terminal
      expect(taskStatus.isCalHistoryTerminalStatus('SCHEDULED')).toBe(false);
      // Invalid/null/undefined values
      expect(taskStatus.isCalHistoryTerminalStatus(null)).toBe(false);
      expect(taskStatus.isCalHistoryTerminalStatus(undefined)).toBe(false);
      expect(taskStatus.isCalHistoryTerminalStatus('')).toBe(false);
      expect(taskStatus.isCalHistoryTerminalStatus('bogus')).toBe(false);
    });
  });
});
