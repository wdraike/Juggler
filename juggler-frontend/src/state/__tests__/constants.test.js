/**
 * Tests for state/constants.js — STATUS_OPTIONS + isTerminalStatus + PAST_OPACITY.
 * juggler-cal-history Plan B.
 */
import { STATUS_OPTIONS, STATUS_MAP, STATUS_DESCRIPTORS, STATUS_VALID_TRANSITIONS, canTransitionTo, PAUSE_TOKENS, PRI_RANK, isTerminalStatus, PAST_OPACITY } from '../constants';

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

  test('isTerminalStatus(missed) === true (999.844: system-applied terminal status)', () => {
    expect(isTerminalStatus('missed')).toBe(true);
  });

  test('isTerminalStatus preserves existing terminal classifications', () => {
    ['done', 'cancel', 'cancelled', 'skip', 'pause', 'missed'].forEach((s) => {
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
    ['', 'disabled'].forEach((s) => {
      expect(isTerminalStatus(s)).toBe(false);
    });
  });

  test('PAST_OPACITY exported as 0.60', () => {
    expect(PAST_OPACITY).toBe(0.60);
  });
});

// ── 999.1231: canonical status descriptor table ─────────────────────────────
describe('state/constants — canonical status descriptors (999.1231)', () => {
  test('every descriptor carries the full display-token contract', () => {
    STATUS_DESCRIPTORS.forEach((s) => {
      expect(typeof s.value).toBe('string');
      ['icon', 'label', 'tip', 'bg', 'bgDark', 'color', 'colorDark'].forEach((k) => {
        expect(typeof s[k]).toBe('string');
        expect(s[k].length).toBeGreaterThan(0);
      });
      expect(typeof s.selectable).toBe('boolean');
    });
  });

  test('STATUS_OPTIONS = selectable subset (backend-set cancelled/missed excluded)', () => {
    expect(STATUS_OPTIONS.map((s) => s.value)).toEqual(['', 'done', 'wip', 'cancel', 'skip', 'pause']);
  });

  test('picker set includes wip (999.1231: detail-header picker could not set WIP)', () => {
    expect(STATUS_OPTIONS.find((s) => s.value === 'wip')).toBeDefined();
  });

  test('skip uses the U+23ED glyph with the StatusToggle slate palette (the ruled winners)', () => {
    expect(STATUS_MAP.skip.icon).toBe('⏭');
    expect(STATUS_MAP.skip.bg).toBe('#F1F5F9');
    expect(STATUS_MAP.skip.color).toBe('#475569');
  });

  test("STATUS_MAP.missed exists with badge tokens + its own glyph (finding 2: missed rendered nothing)", () => {
    expect(STATUS_MAP.missed).toBeDefined();
    expect(STATUS_MAP.missed.icon).toBe('⊘');
    expect(STATUS_MAP.missed.label).toBe('Missed');
    // Mirrors the cancel palette (999.882 alias pattern applied to missed).
    expect(STATUS_MAP.missed.bg).toBe(STATUS_MAP.cancel.bg);
    expect(STATUS_MAP.missed.colorDark).toBe(STATUS_MAP.cancel.colorDark);
  });

  test("'missed' is NOT in the user-selectable toggle set", () => {
    expect(STATUS_OPTIONS.find((s) => s.value === 'missed')).toBeUndefined();
  });

  test('pause tokens come from the shared PAUSE_TOKENS (999.1245 deferred token)', () => {
    expect(STATUS_MAP.pause.bg).toBe(PAUSE_TOKENS.bg);
    expect(STATUS_MAP.pause.bgDark).toBe(PAUSE_TOKENS.bgDark);
    expect(STATUS_MAP.pause.color).toBe(PAUSE_TOKENS.color);
    expect(STATUS_MAP.pause.colorDark).toBe(PAUSE_TOKENS.colorDark);
  });

  test('missed + cancelled are reopen-only in the transition map (David 2026-07-06: terminal, explicit reactivation)', () => {
    expect(canTransitionTo('missed', '')).toBe(true);
    expect(canTransitionTo('cancelled', '')).toBe(true);
    ['done', 'wip', 'skip', 'cancel', 'pause'].forEach((target) => {
      expect(canTransitionTo('missed', target)).toBe(false);
      expect(canTransitionTo('cancelled', target)).toBe(false);
    });
  });

  test('open → wip is a legal transition (picker parity with cards)', () => {
    expect(canTransitionTo('', 'wip')).toBe(true);
    expect(STATUS_VALID_TRANSITIONS['wip']['']).toBe(1);
  });
});

// ── 999.1426(e): PRI_RANK re-exported from juggler-shared ───────────────────
describe('state/constants — PRI_RANK shared source (999.1426)', () => {
  test('PRI_RANK is the juggler-shared object (single source), values unchanged', () => {
    const shared = require('juggler-shared/scheduler/constants').PRI_RANK;
    expect(PRI_RANK).toBe(shared); // identity, not a copy
    expect(PRI_RANK).toEqual({ P1: 100, P2: 80, P3: 50, P4: 20 });
    expect(Object.isFrozen(PRI_RANK)).toBe(true);
  });
});