/**
 * Tests for shared TERMINAL_STATUSES + isTerminalStatus helper.
 * See: src/lib/task-status.js (juggler-cal-history Plan A)
 */
process.env.NODE_ENV = 'test';

var taskStatus = require('../../src/lib/task-status');

describe('lib/task-status', function() {
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
