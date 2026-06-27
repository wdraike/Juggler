// Tests for task status library
const { TERMINAL_STATUSES, isTerminalStatus } = require('../../src/lib/task-status');

describe('Task Status Library', () => {
  test('TERMINAL_STATUSES contains missed', () => {
    expect(TERMINAL_STATUSES).toContain('missed');
  });

  test('isTerminalStatus returns true for missed', () => {
    expect(isTerminalStatus('missed')).toBe(true);
  });

  test('isTerminalStatus returns false for empty status', () => {
    expect(isTerminalStatus('')).toBe(false);
  });

  test('TERMINAL_STATUSES is frozen', () => {
    expect(Object.isFrozen(TERMINAL_STATUSES)).toBe(true);
  });
});
