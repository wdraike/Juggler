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

  test('STATUS_OPTIONS contains archived and restored entries', () => {
    const archived = STATUS_OPTIONS.find((s) => s.value === 'archived');
    const restored = STATUS_OPTIONS.find((s) => s.value === 'restored');
    expect(archived).toBeTruthy();
    expect(restored).toBeTruthy();
  });

  test('archived and restored entries have required properties', () => {
    const archived = STATUS_OPTIONS.find((s) => s.value === 'archived');
    const restored = STATUS_OPTIONS.find((s) => s.value === 'restored');
    
    expect(typeof archived.bg).toBe('string');
    expect(typeof archived.bgDark).toBe('string');
    expect(typeof archived.color).toBe('string');
    expect(typeof archived.colorDark).toBe('string');
    expect(typeof archived.label).toBe('string');
    expect(typeof archived.tip).toBe('string');
    
    expect(typeof restored.bg).toBe('string');
    expect(typeof restored.bgDark).toBe('string');
    expect(typeof restored.color).toBe('string');
    expect(typeof restored.colorDark).toBe('string');
    expect(typeof restored.label).toBe('string');
    expect(typeof restored.tip).toBe('string');
  });

  test('STATUS_MAP contains archived and restored entries', () => {
    expect(STATUS_MAP.archived).toBeTruthy();
    expect(STATUS_MAP.archived.value).toBe('archived');
    expect(STATUS_MAP.restored).toBeTruthy();
    expect(STATUS_MAP.restored.value).toBe('restored');
  });

  test('isTerminalStatus(missed) === true', () => {
    expect(isTerminalStatus('missed')).toBe(true);
  });

  test('isTerminalStatus(archived) === true', () => {
    expect(isTerminalStatus('archived')).toBe(true);
  });

  test('isTerminalStatus(restored) === true', () => {
    expect(isTerminalStatus('restored')).toBe(true);
  });

  test('isTerminalStatus preserves existing terminal classifications', () => {
    ['done', 'cancel', 'skip', 'pause', 'missed', 'archived', 'restored'].forEach((s) => {
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
