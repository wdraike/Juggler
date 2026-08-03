/**
 * Regression test for 999.5027 — floating date parsers in cal-sync-helpers
 *
 * Three sibling date parsers still parse offset-less ISO strings as SERVER-LOCAL,
 * so Apple CalDAV floating events are mis-dated on UTC hosts (Cloud Run).
 *
 * 1. isEventPast() — new Date(floatingString) on UTC host gives wrong instant
 * 2. toMySQLDate() — new Date(floatingString) parses as server-local
 * 3. computeDurationMinutes() — new Date(floatingString) for both start/end
 */

const { isEventPast, toMySQLDate } = require('../../src/controllers/cal-sync-helpers');
const { computeDurationMinutes } = require('../../src/slices/calendar/domain/dateTransforms');

describe('999.5027 — floating date parsers', () => {

  describe('isEventPast', () => {
    // Simulate Cloud Run: server timezone is UTC
    // Apple floating DTSTART 2026-06-15T02:00:00 means 2:00 AM in user's tz
    // User tz = America/New_York (EDT, UTC-4 in June)
    // 2:00 AM EDT = 06:00 UTC
    // todayStart for 2026-06-15 = midnight EDT = 04:00 UTC
    // 06:00Z > 04:00Z → NOT past
    //
    // BUG: new Date('2026-06-15T02:00:00') on UTC host = 02:00Z < 04:00Z → past (WRONG)

    test('floating timed event in user tz is NOT past when it is today and in the future', () => {
      var tz = 'America/New_York';
      // todayStart: midnight America/New_York on 2026-06-15 = 04:00 UTC
      var todayStart = new Date('2026-06-15T04:00:00Z');
      var todayKey = '2026-06-15';

      // Event at 2:00 AM floating = 2:00 AM EDT = 06:00 UTC
      // This is TODAY and in the future — must NOT be past
      var result = isEventPast('2026-06-15T02:00:00', false, todayKey, todayStart, tz);
      expect(result).toBe(false);
    });

    test('floating timed event that is genuinely past (before midnight user tz) IS past', () => {
      var tz = 'America/New_York';
      var todayStart = new Date('2026-06-15T04:00:00Z'); // midnight EDT
      var todayKey = '2026-06-15';

      // Event at 11:00 PM the previous day floating = 11:00 PM EDT on 06-14 = 03:00 UTC on 06-15
      // 03:00Z < 04:00Z → past
      var result = isEventPast('2026-06-14T23:00:00', false, todayKey, todayStart, tz);
      expect(result).toBe(true);
    });
  });

  describe('toMySQLDate', () => {
    test('offset-less ISO string is treated as UTC (iCal LAST-MODIFIED is defined UTC)', () => {
      // Apple lastModified: 20260615T020000 (offset-less, but RFC 5545 defines as UTC)
      // On a UTC host, new Date('2026-06-15T02:00:00') gives 02:00Z — correct for UTC host.
      // On a local dev host (America/New_York), new Date() parses as 02:00 EDT = 06:00Z — WRONG.
      // The fix should always treat offset-less as UTC.
      var d = toMySQLDate('2026-06-15T02:00:00');
      expect(d).not.toBeNull();
      // Should be 02:00 UTC regardless of host timezone
      expect(d.toISOString()).toBe('2026-06-15T02:00:00.000Z');
    });
  });

  describe('computeDurationMinutes', () => {
    test('floating start/end times compute correct duration without server-local shift', () => {
      // 2-hour event: 10:00-12:00 floating
      var dur = computeDurationMinutes('2026-06-15T10:00:00', '2026-06-15T12:00:00');
      expect(dur).toBe(120);
    });

    test('floating times crossing a DST transition compute correct duration', () => {
      // 999.5027: across a server-TZ DST transition, new Date() shifts by 1h.
      // March 9 2026: US springs forward at 2:00 AM (America/New_York)
      // An event 01:00-03:00 floating has a real 2h wall-clock duration
      // (the 2-3 AM hour is skipped, so 01:00→03:00 = 2h wall but 1h UTC)
      // The correct answer for a FLOATING event is 120 (wall-clock duration),
      // not 60 (UTC instant difference).
      var dur = computeDurationMinutes('2026-03-09T01:00:00', '2026-03-09T03:00:00');
      expect(dur).toBe(120);
    });
  });
});