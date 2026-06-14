// Tests for status enum constants
//
// Updated 2026-06-14 (leg jug-calhistory-skipped-enum, 999.308b): SKIPPED was
// removed from src/constants/status-enum.js to match the DB CHECK constraint
// (migration 20260605010000 dropped SKIPPED→CANCELLED). Assertions now reflect
// the correct 4-value DB-aligned state.

const { CalHistoryStatus, CAL_HISTORY_STATUSES, CAL_HISTORY_TERMINAL_STATUSES,
        isValidCalHistoryStatus, isTerminalCalHistoryStatus, getCalHistoryStatusDisplayName } = require('../../src/constants/status-enum');

describe('Status Enum Constants', () => {
  test('CalHistoryStatus has SCHEDULED', () => {
    expect(CalHistoryStatus).toHaveProperty('SCHEDULED');
    expect(CalHistoryStatus.SCHEDULED).toBe('SCHEDULED');
  });

  test('CalHistoryStatus has COMPLETED', () => {
    expect(CalHistoryStatus).toHaveProperty('COMPLETED');
    expect(CalHistoryStatus.COMPLETED).toBe('COMPLETED');
  });

  test('CalHistoryStatus has MISSED', () => {
    expect(CalHistoryStatus).toHaveProperty('MISSED');
    expect(CalHistoryStatus.MISSED).toBe('MISSED');
  });

  test('CalHistoryStatus has CANCELLED', () => {
    expect(CalHistoryStatus).toHaveProperty('CANCELLED');
    expect(CalHistoryStatus.CANCELLED).toBe('CANCELLED');
  });

  test('isValidCalHistoryStatus works correctly', () => {
    expect(isValidCalHistoryStatus('SCHEDULED')).toBe(true);
    expect(isValidCalHistoryStatus('COMPLETED')).toBe(true);
    expect(isValidCalHistoryStatus('MISSED')).toBe(true);
    expect(isValidCalHistoryStatus('CANCELLED')).toBe(true);
    expect(isValidCalHistoryStatus('INVALID')).toBe(false);
    expect(isValidCalHistoryStatus(null)).toBe(false);
  });

  test('isTerminalCalHistoryStatus works correctly', () => {
    expect(isTerminalCalHistoryStatus('COMPLETED')).toBe(true);
    expect(isTerminalCalHistoryStatus('MISSED')).toBe(true);
    expect(isTerminalCalHistoryStatus('CANCELLED')).toBe(true);
    expect(isTerminalCalHistoryStatus('SCHEDULED')).toBe(false);
    expect(isTerminalCalHistoryStatus('PENDING')).toBe(false);
    expect(isTerminalCalHistoryStatus(null)).toBe(false);
  });

  test('getCalHistoryStatusDisplayName works correctly', () => {
    expect(getCalHistoryStatusDisplayName(CalHistoryStatus.SCHEDULED)).toBe('Scheduled');
    expect(getCalHistoryStatusDisplayName(CalHistoryStatus.COMPLETED)).toBe('Completed');
    expect(getCalHistoryStatusDisplayName(CalHistoryStatus.MISSED)).toBe('Missed');
    expect(getCalHistoryStatusDisplayName(CalHistoryStatus.CANCELLED)).toBe('Cancelled');
    expect(getCalHistoryStatusDisplayName('INVALID')).toBe('Unknown');
  });

  test('CAL_HISTORY_STATUSES contains all statuses exported by the module', () => {
    expect(CAL_HISTORY_STATUSES).toEqual([
      CalHistoryStatus.SCHEDULED,
      CalHistoryStatus.COMPLETED,
      CalHistoryStatus.MISSED,
      CalHistoryStatus.CANCELLED
    ]);
  });

  test('CAL_HISTORY_TERMINAL_STATUSES contains terminal statuses exported by the module', () => {
    expect(CAL_HISTORY_TERMINAL_STATUSES).toEqual([
      CalHistoryStatus.COMPLETED,
      CalHistoryStatus.MISSED,
      CalHistoryStatus.CANCELLED
    ]);
  });
});
