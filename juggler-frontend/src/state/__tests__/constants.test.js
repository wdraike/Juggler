/**
 * Tests for state/constants.js — STATUS_OPTIONS + isTerminalStatus + PAST_OPACITY.
 * juggler-cal-history Plan B.
 */
import { STATUS_OPTIONS, STATUS_MAP, isTerminalStatus, PAST_OPACITY } from '../constants';

describe('state/constants — juggler-cal-history Plan B', () => {
  test('STATUS_OPTIONS contains a missed entry', () => {
    const m = STATUS_OPTIONS.find((s) => s.value === 'missed');
    expect(m).toBeTruthy();
  });

  test('missed entry has bg/bgDark/color/colorDark/label/tip', () => {
    const m = STATUS_OPTIONS.find((s) => s.value === 'missed');
    expect(typeof m.bg).toBe('string');
    expect(typeof m.bgDark).toBe('string');
    expect(typeof m.color).toBe('string');
    expect(typeof m.colorDark).toBe('string');
    expect(typeof m.label).toBe('string');
    expect(typeof m.tip).toBe('string');
  });

  test('STATUS_MAP.missed mirrors the STATUS_OPTIONS entry', () => {
    expect(STATUS_MAP.missed).toBeTruthy();
    expect(STATUS_MAP.missed.value).toBe('missed');
  });

  test('isTerminalStatus(missed) === true', () => {
    expect(isTerminalStatus('missed')).toBe(true);
  });

  test('isTerminalStatus preserves existing terminal classifications', () => {
    ['done', 'cancel', 'skip', 'pause'].forEach((s) => {
      expect(isTerminalStatus(s)).toBe(true);
    });
  });

  test('isTerminalStatus returns false for non-terminal values', () => {
    ['', 'wip', 'disabled'].forEach((s) => {
      expect(isTerminalStatus(s)).toBe(false);
    });
  });

  test('PAST_OPACITY exported as 0.60', () => {
    expect(PAST_OPACITY).toBe(0.60);
  });
});
