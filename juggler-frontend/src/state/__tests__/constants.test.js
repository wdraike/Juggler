/**
 * Tests for state/constants.js — STATUS_OPTIONS + isTerminalStatus + PAST_OPACITY.
 * juggler-cal-history Plan B.
 */
import { STATUS_OPTIONS, STATUS_MAP, isTerminalStatus, PAST_OPACITY } from '../constants';

describe('state/constants — juggler-cal-history Plan B', () => {
  test('STATUS_OPTIONS does not contain a missed entry (removed)', () => {
    const m = STATUS_OPTIONS.find((s) => s.value === 'missed');
    expect(m).toBeUndefined();
  });

  test('STATUS_OPTIONS does not contain archived or restored entries', () => {
    const archived = STATUS_OPTIONS.find((s) => s.value === 'archived');
    const restored = STATUS_OPTIONS.find((s) => s.value === 'restored');
    expect(archived).toBeUndefined();
    expect(restored).toBeUndefined();
  });

  test('STATUS_MAP does not contain archived or restored entries', () => {
    expect(STATUS_MAP.archived).toBeUndefined();
    expect(STATUS_MAP.restored).toBeUndefined();
  });

  // 999.882 — 'cancelled' (backend series/instance cancel) is a display-only alias
  // of 'cancel' in STATUS_MAP so the calendar grid can render its status badge, but
  // it must NOT leak into the user-selectable STATUS_OPTIONS toggle set.
  test("STATUS_MAP.cancelled is a display alias mirroring cancel (badge styling present)", () => {
    expect(STATUS_MAP.cancelled).toBeDefined();
    expect(STATUS_MAP.cancelled.bg).toBe(STATUS_MAP.cancel.bg);
    expect(STATUS_MAP.cancelled.color).toBe(STATUS_MAP.cancel.color);
    expect(STATUS_MAP.cancelled.value).toBe('cancelled');
  });

  test("'cancelled' is NOT added to the user-selectable STATUS_OPTIONS toggle", () => {
    expect(STATUS_OPTIONS.find((s) => s.value === 'cancelled')).toBeUndefined();
  });

  test('isTerminalStatus(missed) === false (removed status)', () => {
    expect(isTerminalStatus('missed')).toBe(false);
  });

  test('isTerminalStatus preserves existing terminal classifications', () => {
    ['done', 'cancel', 'skip', 'pause'].forEach((s) => {
      expect(isTerminalStatus(s)).toBe(true);
    });
  });

  test('isTerminalStatus(archived) === false (archive removed)', () => {
    expect(isTerminalStatus('archived')).toBe(false);
  });

  test('isTerminalStatus(restored) === false (restore removed)', () => {
    expect(isTerminalStatus('restored')).toBe(false);
  });

  test('isTerminalStatus returns false for non-terminal values', () => {
    ['', 'disabled', 'missed'].forEach((s) => {
      expect(isTerminalStatus(s)).toBe(false);
    });
  });

  test('PAST_OPACITY exported as 0.60', () => {
    expect(PAST_OPACITY).toBe(0.60);
  });
});