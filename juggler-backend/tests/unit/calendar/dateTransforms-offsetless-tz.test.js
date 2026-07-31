/**
 * dateTransforms — offset-less ISO strings are provider WALL-CLOCK, not server-local.
 *
 * BUG: isoToJugglerDate() hands anything T-separated to native `new Date()`
 * parsing. Per ECMA-262, a date-time form with NO offset and NO 'Z' is parsed
 * as SERVER-LOCAL time. The value is then re-formatted into the caller's `tz`,
 * so the wall-clock silently shifts by (server offset − tz offset).
 *
 * CONFIRMED SOURCE: Apple CalDAV *floating* times. RFC 5545 defines a floating
 * time as the observer's local time, so `tz` is the correct zone to read it in.
 * src/lib/apple-cal-api.js emits formatICALDateTime() with no 'Z' when
 * dtstart.zone.tzid === 'floating'; tests/apple-cal-parse.test.js pins that
 * shape ('2026-05-15T10:00:00').
 *
 * NOT the MSFT pull path: Graph defaults to start.timeZone === 'UTC' and
 * MicrosoftCalendarAdapter appends the 'Z' itself before calling here, so those
 * strings never reach this branch (harrison, 2026-07-31 — an earlier version of
 * this docstring blamed MSFT; that attribution was wrong).
 *
 * Impact is NOT test-only: Cloud Run runs UTC while users' calendars are not,
 * so every floating Apple event landed at the wrong time in production, and
 * applyEventToTaskFields() then saw a phantom time change and promoted
 * flexible tasks to placement_mode=fixed.
 *
 * Contract: an offset-less datetime is already wall-clock in `tz`, so its
 * date/time must survive the round-trip UNCHANGED for every `tz`. Strings that
 * DO carry an offset (or 'Z') keep converting normally.
 *
 * These assertions are driven by the `tz` ARGUMENT, so they are deterministic
 * regardless of the TZ the test process happens to run under.
 */
var { isoToJugglerDate } = require('../../../src/slices/calendar/domain/dateTransforms');

describe('isoToJugglerDate — offset-less input is wall-clock in the target tz', function () {
  var OFFSETLESS = '2026-06-15T10:00:00';

  // Same instant-less wall clock, read in wildly different zones: the answer
  // must not move. Under the bug these differ by the server↔tz offset.
  [
    'America/New_York',
    'America/Los_Angeles',
    'UTC',
    'Asia/Tokyo',
    'Australia/Sydney',
  ].forEach(function (tz) {
    it('preserves wall-clock 10:00 AM on 2026-06-15 for tz=' + tz, function () {
      expect(isoToJugglerDate(OFFSETLESS, tz)).toEqual({
        date: '2026-06-15',
        time: '10:00 AM',
      });
    });
  });

  it('preserves a wall clock that would cross a date boundary if mis-parsed', function () {
    // 11:30 PM read in Tokyo: a server-local misparse rolls this into the 16th.
    expect(isoToJugglerDate('2026-06-15T23:30:00', 'Asia/Tokyo')).toEqual({
      date: '2026-06-15',
      time: '11:30 PM',
    });
  });

  it('preserves midnight (00:00 must render as 12:00 AM, not 12:00 PM)', function () {
    expect(isoToJugglerDate('2026-06-15T00:00:00', 'America/New_York')).toEqual({
      date: '2026-06-15',
      time: '12:00 AM',
    });
  });

  it('preserves noon (12:00 must render as 12:00 PM)', function () {
    expect(isoToJugglerDate('2026-06-15T12:00:00', 'America/New_York')).toEqual({
      date: '2026-06-15',
      time: '12:00 PM',
    });
  });

  it('accepts fractional seconds (Graph sends .0000000)', function () {
    expect(isoToJugglerDate('2026-06-15T10:00:00.0000000', 'America/New_York')).toEqual({
      date: '2026-06-15',
      time: '10:00 AM',
    });
  });
});

describe('isoToJugglerDate — offset-bearing input still CONVERTS (must stay green)', function () {
  it('Z-suffixed UTC converts into the target tz', function () {
    // 14:00Z on 2026-06-15 is 10:00 AM EDT (UTC-4).
    expect(isoToJugglerDate('2026-06-15T14:00:00Z', 'America/New_York')).toEqual({
      date: '2026-06-15',
      time: '10:00 AM',
    });
  });

  it('explicit numeric offset converts into the target tz', function () {
    expect(isoToJugglerDate('2026-06-15T10:00:00-04:00', 'America/New_York')).toEqual({
      date: '2026-06-15',
      time: '10:00 AM',
    });
  });

  it('offset-bearing input crossing a date boundary converts correctly', function () {
    // 02:00Z on the 16th is 10:00 PM EDT on the 15th.
    expect(isoToJugglerDate('2026-06-16T02:00:00Z', 'America/New_York')).toEqual({
      date: '2026-06-15',
      time: '10:00 PM',
    });
  });

  it('date-only input is returned as-is with no time', function () {
    expect(isoToJugglerDate('2026-06-15', 'America/New_York')).toEqual({
      date: '2026-06-15',
      time: null,
    });
  });

  it('empty input yields nulls', function () {
    expect(isoToJugglerDate('', 'America/New_York')).toEqual({ date: null, time: null });
  });
});

describe('isoToJugglerDate — impossible calendar dates keep their historical rollover', function () {
  // The offset-less regex is looser than Date parsing on day-in-month, so the
  // fast path explicitly validates and falls through when the date is not real.
  //
  // It falls through rather than returning nulls because V8 does NOT reject
  // these — `new Date('2026-02-30T10:00:00')` is not NaN, it rolls over to
  // Mar 2 — so rollover is what this function has always returned. Reading the
  // components straight through would newly surface '2026-02-30' verbatim.
  // Pinning the rollover keeps the tz fix from changing unrelated behaviour.
  // The exact rolled-over date is NOT asserted: the fall-through path still
  // parses server-local (that is the very bug this fix routes around), so the
  // rollover lands on a different day depending on the process TZ. What must
  // hold in every TZ is that the impossible date never comes back verbatim and
  // that whatever does come back is a real calendar date.
  [
    ['2026-02-30T10:00:00', '2026-02-30', 'Feb 30 does not exist'],
    ['2026-06-31T10:00:00', '2026-06-31', 'June has 30 days'],
    ['2026-02-29T10:00:00', '2026-02-29', '2026 is not a leap year'],
  ].forEach(function (t) {
    it('never returns ' + t[1] + ' verbatim (' + t[2] + ')', function () {
      var got = isoToJugglerDate(t[0], 'America/New_York');
      expect(got.date).not.toBe(t[1]);
      // and what it does return is a date that actually exists
      var parts = got.date.split('-').map(Number);
      var probe = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      expect([probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate()]).toEqual(parts);
    });
  });

  it('still accepts a REAL leap day', function () {
    expect(isoToJugglerDate('2028-02-29T10:00:00', 'America/New_York')).toEqual({
      date: '2028-02-29',
      time: '10:00 AM',
    });
  });
});
