/**
 * AC2 (999.809) — getNowInTimezone clock injection
 *
 * Requirements covered: AC2
 * Layer: unit (pure function, no DOM, no network)
 *
 * Verifies:
 *   - When clock is provided, clock.now() is used instead of new Date()
 *   - Fixed clock 2026-06-22T18:30:00Z + 'America/New_York' → 2:30 PM EDT
 *       todayKey  = '2026-06-22'
 *       nowMins   = 870  (14 * 60 + 30)
 *   - Single-arg call (no clock) still returns a valid shape (todayKey/nowMins/todayDate)
 *   - No-clock path uses real new Date() (not a hardcoded value)
 *   - clock=null falls back to new Date() (same as no-clock)
 *   - clock=undefined falls back to new Date()
 */

import { getNowInTimezone } from '../timezone';

// Fixed instant: 2026-06-22T18:30:00Z = 14:30 EDT (UTC-4 in summer)
// 14 * 60 + 30 = 870 minutes from midnight
const FIXED_INSTANT = new Date('2026-06-22T18:30:00.000Z');
const FIXED_CLOCK = { now: () => FIXED_INSTANT };
const TZ = 'America/New_York';
const EXPECTED_TODAY_KEY = '2026-06-22';
const EXPECTED_NOW_MINS = 870; // 2:30 PM EDT

// ---------------------------------------------------------------------------
// AC2: clock injection — uses clock.now() when provided
// ---------------------------------------------------------------------------
describe('AC2 (999.809): getNowInTimezone — clock injection', () => {

  test('AC2-clock-todayKey: fixed clock + America/New_York → todayKey = 2026-06-22', () => {
    const result = getNowInTimezone(TZ, FIXED_CLOCK);
    expect(result.todayKey).toBe(EXPECTED_TODAY_KEY);
  });

  test('AC2-clock-nowMins: fixed clock + America/New_York → nowMins = 870 (2:30 PM EDT)', () => {
    const result = getNowInTimezone(TZ, FIXED_CLOCK);
    expect(result.nowMins).toBe(EXPECTED_NOW_MINS);
  });

  test('AC2-clock-todayDate: fixed clock → todayDate is 2026-06-22 local', () => {
    const result = getNowInTimezone(TZ, FIXED_CLOCK);
    expect(result.todayDate.getFullYear()).toBe(2026);
    expect(result.todayDate.getMonth()).toBe(5); // 0-indexed June
    expect(result.todayDate.getDate()).toBe(22);
  });

  test('AC2-clock-shape: returns todayKey, nowMins, todayDate', () => {
    const result = getNowInTimezone(TZ, FIXED_CLOCK);
    expect(result).toHaveProperty('todayKey');
    expect(result).toHaveProperty('nowMins');
    expect(result).toHaveProperty('todayDate');
  });

  test('AC2-clock-different-tz: same fixed instant in America/Los_Angeles → nowMins = 690 (11:30 AM PDT, UTC-7)', () => {
    // 18:30 UTC - 7h = 11:30 → 11*60+30 = 690
    const result = getNowInTimezone('America/Los_Angeles', FIXED_CLOCK);
    expect(result.nowMins).toBe(690);
    expect(result.todayKey).toBe('2026-06-22');
  });

  test('AC2-clock-ignored-wall: injected clock overrides real wall clock (result matches fixed instant, not now)', () => {
    // The result from the fixed clock must NOT vary across runs — it is deterministic
    const r1 = getNowInTimezone(TZ, FIXED_CLOCK);
    const r2 = getNowInTimezone(TZ, FIXED_CLOCK);
    expect(r1.todayKey).toBe(r2.todayKey);
    expect(r1.nowMins).toBe(r2.nowMins);
    // And the value is our exact expected, not a wall-clock value
    expect(r1.todayKey).toBe(EXPECTED_TODAY_KEY);
    expect(r1.nowMins).toBe(EXPECTED_NOW_MINS);
  });

});

// ---------------------------------------------------------------------------
// AC2: no-clock path — single-arg caller unchanged
// ---------------------------------------------------------------------------
describe('AC2 (999.809): getNowInTimezone — single-arg (no clock) path', () => {

  test('AC2-no-clock-shape: single-arg returns todayKey, nowMins, todayDate', () => {
    const result = getNowInTimezone(TZ);
    expect(result).toHaveProperty('todayKey');
    expect(result).toHaveProperty('nowMins');
    expect(result).toHaveProperty('todayDate');
  });

  test('AC2-no-clock-todayKey-format: todayKey is YYYY-MM-DD', () => {
    const result = getNowInTimezone(TZ);
    expect(result.todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('AC2-no-clock-nowMins-range: nowMins is in [0, 1439]', () => {
    const result = getNowInTimezone(TZ);
    expect(result.nowMins).toBeGreaterThanOrEqual(0);
    expect(result.nowMins).toBeLessThanOrEqual(1439);
  });

  test('AC2-no-clock-uses-real-date: result differs from a fixed-past-date clock', () => {
    // Single-arg result uses real Date — its nowMins is NOT pinned to the fixed instant
    // (unless the test happens to run at exactly 18:30 UTC on 2026-06-22, astronomically unlikely)
    const pastClock = { now: () => new Date('2020-01-01T00:00:00.000Z') };
    const noClockResult = getNowInTimezone(TZ);
    const pastClockResult = getNowInTimezone(TZ, pastClock);
    // The no-clock path should NOT produce 2020-01-01
    expect(noClockResult.todayKey).not.toBe('2020-01-01');
    // The past-clock path should produce 2019-12-31 (UTC-5 EST in January)
    expect(pastClockResult.todayKey).toBe('2019-12-31');
  });

  test('AC2-null-clock: null clock falls back to new Date() (same shape as no-clock)', () => {
    const withNull = getNowInTimezone(TZ, null);
    expect(withNull).toHaveProperty('todayKey');
    expect(withNull).toHaveProperty('nowMins');
    expect(withNull.todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('AC2-undefined-clock: undefined clock falls back to new Date()', () => {
    const withUndefined = getNowInTimezone(TZ, undefined);
    expect(withUndefined).toHaveProperty('todayKey');
    expect(withUndefined.todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

});

// ---------------------------------------------------------------------------
// AC2: midnight edge case — h23 mod 24 yields 0, not 24
// ---------------------------------------------------------------------------
describe('AC2 (999.809): getNowInTimezone — midnight edge case', () => {

  test('AC2-midnight: h23 % 24 = 0 → nowMins = 0 (not 1440)', () => {
    // 2026-06-23T04:00:00Z = midnight EDT (00:00)
    const midnightClock = { now: () => new Date('2026-06-23T04:00:00.000Z') };
    const result = getNowInTimezone(TZ, midnightClock);
    expect(result.nowMins).toBe(0);
    expect(result.todayKey).toBe('2026-06-23');
  });

});
