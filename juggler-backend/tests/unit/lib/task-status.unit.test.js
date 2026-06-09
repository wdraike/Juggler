/**
 * Tests for shared TERMINAL_STATUSES + isTerminalStatus helper.
 * See: src/lib/task-status.js (juggler-cal-history Plan A)
 *
 * De-rot 2026-06-09:
 *   1. WRONG PATH: test was at tests/unit/lib/ and required '../../src/lib/task-status'
 *      which resolves to tests/unit/src/lib/task-status (doesn't exist).
 *      Corrected to '../../../src/lib/task-status' (3 levels up).
 *   2. CAL_HISTORY_* assertions moved to require src/constants/status-enum.js
 *      because task-status.js only exports TERMINAL_STATUSES + isTerminalStatus.
 *      The CAL_HISTORY constants live in src/constants/status-enum.js.
 */

describe('lib/task-status', function() {
  var taskStatus;

  beforeAll(function() {
    taskStatus = require('../../../src/lib/task-status');
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
});

// CAL_HISTORY_* constants live in src/constants/status-enum.js, not task-status.js.
describe('src/constants/status-enum — CAL_HISTORY constants', function() {
  var statusEnum;

  beforeAll(function() {
    statusEnum = require('../../../src/constants/status-enum');
  });

  test('CAL_HISTORY_STATUSES is frozen with correct enum values', function() {
    expect(Object.isFrozen(statusEnum.CAL_HISTORY_STATUSES)).toBe(true);
    // Core values that must be present regardless of SKIPPED stale entry.
    expect(statusEnum.CalHistoryStatus.SCHEDULED).toBe('SCHEDULED');
    expect(statusEnum.CalHistoryStatus.COMPLETED).toBe('COMPLETED');
    expect(statusEnum.CalHistoryStatus.MISSED).toBe('MISSED');
    expect(statusEnum.CalHistoryStatus.CANCELLED).toBe('CANCELLED');
  });

  test('CAL_HISTORY_TERMINAL_STATUSES contains COMPLETED, MISSED, CANCELLED', function() {
    expect(Object.isFrozen(statusEnum.CAL_HISTORY_TERMINAL_STATUSES)).toBe(true);
    expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('COMPLETED');
    expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('MISSED');
    expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).toContain('CANCELLED');
    // SCHEDULED is not terminal
    expect(statusEnum.CAL_HISTORY_TERMINAL_STATUSES).not.toContain('SCHEDULED');
  });

  test('isTerminalCalHistoryStatus returns true for terminal statuses', function() {
    ['COMPLETED', 'MISSED', 'CANCELLED'].forEach(function(s) {
      expect(statusEnum.isTerminalCalHistoryStatus(s)).toBe(true);
    });
  });

  test('isTerminalCalHistoryStatus returns false for non-terminal statuses', function() {
    // SCHEDULED is not terminal
    expect(statusEnum.isTerminalCalHistoryStatus('SCHEDULED')).toBe(false);
    // Invalid/null/undefined values
    expect(statusEnum.isTerminalCalHistoryStatus(null)).toBe(false);
    expect(statusEnum.isTerminalCalHistoryStatus(undefined)).toBe(false);
    expect(statusEnum.isTerminalCalHistoryStatus('')).toBe(false);
    expect(statusEnum.isTerminalCalHistoryStatus('bogus')).toBe(false);
  });
});
