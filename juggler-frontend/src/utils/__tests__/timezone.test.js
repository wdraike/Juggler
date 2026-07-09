/**
 * Regression — A1 (juggler-tz-display-a1): task-time display must use the user's
 * CONFIGURED timezone, not the browser's. Bug: a 12:00-UTC FIXED task rendered
 * 9:00 PM for a NY-configured user whose browser/Intl resolved to a +9 zone,
 * because hydration fell back to getBrowserTimezone() and never consulted the
 * configured users.timezone. Contract: TZ-DISPLAY-1 / R31.3.
 */
import { resolveDisplayTimezone, hydrateTaskTimezones, convertTimeForDisplay } from '../timezone';

describe('resolveDisplayTimezone — configured tz beats browser (A1)', () => {
  test('explicit override wins over everything', () => {
    expect(resolveDisplayTimezone({ override: 'Europe/Paris', userTimezone: 'America/New_York', browser: 'Asia/Tokyo' }))
      .toBe('Europe/Paris');
  });

  test('configured userTimezone is used over any browser tz (the bug)', () => {
    // No explicit override; the configured NY tz must be used. The browser tz
    // (a +9 zone in the repro) is never authoritative for display (TZ-DISPLAY-3).
    expect(resolveDisplayTimezone({ override: null, userTimezone: 'America/New_York' }))
      .toBe('America/New_York');
  });

  test('falls back to America/New_York default (TZ-DISPLAY-3), never the browser', () => {
    expect(resolveDisplayTimezone({ override: null, userTimezone: null }))
      .toBe('America/New_York');
  });
});

describe('display end-to-end (A1)', () => {
  test('12:00 UTC FIXED task renders 8:00 AM for a NY-configured user (browser tz irrelevant)', () => {
    const tz = resolveDisplayTimezone({ override: null, userTimezone: 'America/New_York' });
    const tasks = [{ scheduledAt: '2026-06-22T12:00:00Z' }];
    hydrateTaskTimezones(tasks, tz);
    expect(tasks[0].time).toBe('8:00 AM');
  });

  test('sanity: same UTC fed the +9 browser tz would have shown 9:00 PM (the bug)', () => {
    expect(convertTimeForDisplay('2026-06-22T12:00:00Z', 'Asia/Tokyo').time).toBe('9:00 PM');
  });
});

// ── 999.1426 (999.1186 frontend half): dateStrings misparse trap ────────────
// mysql2 with dateStrings:true emits 'YYYY-MM-DD HH:MM:SS' with NO zone marker;
// a bare `new Date()` parses that as LOCAL time. convertTimeForDisplay now
// routes through the shared parseDbUtc, which pins that shape to UTC.
describe('convertTimeForDisplay — parseDbUtc normalization (999.1426)', () => {
  test('MySQL dateStrings input is interpreted as UTC, identical to the explicit-Z ISO form', () => {
    const viaDbShape = convertTimeForDisplay('2026-06-22 12:00:00', 'America/New_York');
    const viaIso = convertTimeForDisplay('2026-06-22T12:00:00Z', 'America/New_York');
    expect(viaDbShape).toEqual(viaIso);
    expect(viaDbShape.time).toBe('8:00 AM'); // 12:00 UTC = 8:00 AM EDT
  });

  test('explicit-zone ISO input behavior is unchanged', () => {
    expect(convertTimeForDisplay('2026-06-22T12:00:00+02:00', 'America/New_York').time).toBe('6:00 AM');
  });

  test('invalid input returns the null shape instead of an Invalid Date render', () => {
    expect(convertTimeForDisplay('not-a-date', 'America/New_York')).toEqual({ date: null, time: null, day: null });
  });

  test('parseDbUtc is re-exported and pins the DB shape to UTC', () => {
    const { parseDbUtc } = require('../timezone');
    expect(parseDbUtc('2026-06-22 12:00:00').toISOString()).toBe('2026-06-22T12:00:00.000Z');
    expect(parseDbUtc('')).toBe(null);
  });
});
