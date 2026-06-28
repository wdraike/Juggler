// Tests for task status library
const { TERMINAL_STATUSES, isTerminalStatus } = require('../../src/lib/task-status');

describe('Task Status Library', () => {
  test('TERMINAL_STATUSES does not contain missed (removed)', () => {
    expect(TERMINAL_STATUSES).not.toContain('missed');
  });

  test('isTerminalStatus returns false for missed (removed status)', () => {
    expect(isTerminalStatus('missed')).toBe(false);
  });

  test('isTerminalStatus returns false for empty status', () => {
    expect(isTerminalStatus('')).toBe(false);
  });

  test('TERMINAL_STATUSES is frozen', () => {
    expect(Object.isFrozen(TERMINAL_STATUSES)).toBe(true);
  });
});