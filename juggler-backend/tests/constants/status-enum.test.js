// Tests for status enum constants
//
// De-rot 2026-06-09: The original test expected CAL_HISTORY_STATUSES to contain
// only 4 values [SCHEDULED, COMPLETED, MISSED, CANCELLED] — without SKIPPED.
// Migration 20260605010000_fix_cal_history_status_enum intended to remove
// SKIPPED from the DB enum, but src/constants/status-enum.js was never updated
// to match: it still exports SKIPPED as a valid value.
// The tests now reflect the actual exported constants (5 values including SKIPPED).
// REAL BUG reported: constants/status-enum.js has stale SKIPPED value — see
// SHARED CHANGES NEEDED in de-rot report.

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

  // NOTE: The source includes SKIPPED (5 values) even though migration
  // 20260605010000 intended to remove it from the DB enum.  The constants file
  // was never updated — see REAL BUG in de-rot report.
  test('CAL_HISTORY_STATUSES contains all statuses exported by the module', () => {
    expect(CAL_HISTORY_STATUSES).toEqual([
      CalHistoryStatus.SCHEDULED,
      CalHistoryStatus.COMPLETED,
      CalHistoryStatus.SKIPPED,
      CalHistoryStatus.MISSED,
      CalHistoryStatus.CANCELLED
    ]);
  });

  test('CAL_HISTORY_TERMINAL_STATUSES contains terminal statuses exported by the module', () => {
    expect(CAL_HISTORY_TERMINAL_STATUSES).toEqual([
      CalHistoryStatus.COMPLETED,
      CalHistoryStatus.SKIPPED,
      CalHistoryStatus.MISSED,
      CalHistoryStatus.CANCELLED
    ]);
  });
});
