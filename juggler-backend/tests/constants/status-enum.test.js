const {
  CalHistoryStatus,
  CAL_HISTORY_STATUSES,
  CAL_HISTORY_TERMINAL_STATUSES,
  isValidCalHistoryStatus,
  isTerminalCalHistoryStatus,
  getCalHistoryStatusDisplayName
} = require('../../src/constants/status-enum');

describe('Status Enum Tests', () => {
  test('CalHistoryStatus has SCHEDULED property', () => {
    expect(CalHistoryStatus).toHaveProperty('SCHEDULED');
    expect(CalHistoryStatus.SCHEDULED).toBe('SCHEDULED');
  });

  test('isValidCalHistoryStatus returns true for valid statuses', () => {
    expect(isValidCalHistoryStatus('SCHEDULED')).toBe(true);
    expect(isValidCalHistoryStatus('COMPLETED')).toBe(true);
    expect(isValidCalHistoryStatus('MISSED')).toBe(true);
    expect(isValidCalHistoryStatus('CANCELLED')).toBe(true);
  });

  test('isValidCalHistoryStatus returns false for invalid status', () => {
    expect(isValidCalHistoryStatus('INVALID')).toBe(false);
    expect(isValidCalHistoryStatus(null)).toBe(false);
    expect(isValidCalHistoryStatus(undefined)).toBe(false);
  });

  test('isTerminalCalHistoryStatus returns true for terminal statuses', () => {
    expect(isTerminalCalHistoryStatus('COMPLETED')).toBe(true);
    expect(isTerminalCalHistoryStatus('MISSED')).toBe(true);
    expect(isTerminalCalHistoryStatus('CANCELLED')).toBe(true);
  });

  test('isTerminalCalHistoryStatus returns false for non-terminal statuses', () => {
    expect(isTerminalCalHistoryStatus('SCHEDULED')).toBe(false);
    expect(isTerminalCalHistoryStatus('PENDING')).toBe(false);
  });

  test('getCalHistoryStatusDisplayName returns correct display names', () => {
    expect(getCalHistoryStatusDisplayName('SCHEDULED')).toBe('Scheduled');
    expect(getCalHistoryStatusDisplayName('COMPLETED')).toBe('Completed');
    expect(getCalHistoryStatusDisplayName('MISSED')).toBe('Missed');
    expect(getCalHistoryStatusDisplayName('CANCELLED')).toBe('Cancelled');
    expect(getCalHistoryStatusDisplayName('INVALID')).toBe('Unknown');
  });

  test('CAL_HISTORY_STATUSES contains all expected statuses', () => {
    expect(CAL_HISTORY_STATUSES).toEqual([
      'SCHEDULED',
      'COMPLETED', 
      'MISSED',
      'CANCELLED'
    ]);
  });

  test('CAL_HISTORY_TERMINAL_STATUSES contains terminal statuses', () => {
    expect(CAL_HISTORY_TERMINAL_STATUSES).toEqual([
      'COMPLETED',
      'MISSED',
      'CANCELLED'
    ]);
  });
});