/**
 * cal-sync-helpers-tz.test.js — Timezone edge cases for isoToJugglerDate
 * Pure unit — no DB, no network.
 */
var helpers = require('../src/controllers/cal-sync-helpers');
var isoToJugglerDate = helpers.isoToJugglerDate;
var computeDurationMinutes = helpers.computeDurationMinutes;

// Skip gracefully if functions not exported
var describeIso = isoToJugglerDate ? describe : describe.skip;
var describeDur = computeDurationMinutes ? describe : describe.skip;

describeIso('isoToJugglerDate — UTC string', () => {
  it('converts UTC ISO to America/New_York time correctly', () => {
    // 14:00 UTC = 10:00 AM EDT (UTC-4 in May)
    var result = isoToJugglerDate('2026-05-15T14:00:00Z', 'America/New_York');
    expect(result.date).toBe('2026-05-15');
    expect(result.time).toBe('10:00 AM');
  });

  it('converts UTC ISO to America/Los_Angeles time correctly', () => {
    // 14:00 UTC = 7:00 AM PDT (UTC-7 in May)
    var result = isoToJugglerDate('2026-05-15T14:00:00Z', 'America/Los_Angeles');
    expect(result.date).toBe('2026-05-15');
    expect(result.time).toBe('7:00 AM');
  });

  it('handles midnight UTC — date must not shift in negative-offset tz', () => {
    // 2026-05-15T00:00:00Z = 2026-05-14 in America/New_York (UTC-4)
    var result = isoToJugglerDate('2026-05-15T00:00:00Z', 'America/New_York');
    expect(result.date).toBe('2026-05-14');
    expect(result.time).toBe('8:00 PM');
  });
});

describeIso('isoToJugglerDate — allday date-only string', () => {
  it('returns date-only for YYYY-MM-DD string (no timezone conversion)', () => {
    var result = isoToJugglerDate('2026-05-15', 'America/New_York');
    expect(result.date).toBe('2026-05-15');
    expect(result.time).toBeNull();
  });

  it('allday date unchanged regardless of timezone', () => {
    expect(isoToJugglerDate('2026-05-15', 'Pacific/Auckland').date).toBe('2026-05-15');
    expect(isoToJugglerDate('2026-05-15', 'Pacific/Midway').date).toBe('2026-05-15');
  });
});

describeDur('computeDurationMinutes', () => {
  it('computes duration across DST spring-forward correctly', () => {
    // Clocks spring forward at 2:00 AM on 2026-03-08 in America/New_York.
    // UTC duration is authoritative — 2 hours = 120 minutes
    var start = '2026-03-08T06:00:00Z'; // 1:00 AM EST
    var end = '2026-03-08T08:00:00Z';   // 3:00 AM EDT (2 hours later UTC)
    expect(computeDurationMinutes(start, end)).toBe(120);
  });
});

// ── 999.1186: mysql2 dateStrings ('YYYY-MM-DD HH:MM:SS', tz-less) must be
// interpreted as UTC, never as server-local time (the documented +4h misparse
// trap). These pin the shared parseDbUtc normalizer and its consumers.
describeIso('isoToJugglerDate — MySQL dateStrings format is UTC (999.1186)', () => {
  it("parses 'YYYY-MM-DD HH:MM:SS' as UTC, identical to the same instant with Z", () => {
    // 14:00 UTC = 10:00 AM EDT — must match the '...T14:00:00Z' case above
    // regardless of the server's own timezone.
    var result = isoToJugglerDate('2026-05-15 14:00:00', 'America/New_York');
    expect(result.date).toBe('2026-05-15');
    expect(result.time).toBe('10:00 AM');
  });

  it('midnight-adjacent DB timestamp shifts date in negative-offset tz', () => {
    var result = isoToJugglerDate('2026-05-15 00:30:00', 'America/New_York');
    expect(result.date).toBe('2026-05-14');
    expect(result.time).toBe('8:30 PM');
  });

  it('provider ISO strings with explicit zone are untouched by the normalizer', () => {
    var result = isoToJugglerDate('2026-05-15T10:00:00-04:00', 'America/New_York');
    expect(result.date).toBe('2026-05-15');
    expect(result.time).toBe('10:00 AM');
  });
});

describe('parseDbUtc — shared DB-timestamp normalizer (999.1186)', () => {
  var shared = require('juggler-shared/scheduler/dateHelpers');
  var parseDbUtc = shared.parseDbUtc;
  var utcToLocal = shared.utcToLocal;

  it('pins bare MySQL timestamps to UTC', () => {
    expect(parseDbUtc('2026-05-15 14:00:00').toISOString()).toBe('2026-05-15T14:00:00.000Z');
  });

  it('handles fractional seconds', () => {
    expect(parseDbUtc('2026-05-15 14:00:00.123').toISOString()).toBe('2026-05-15T14:00:00.123Z');
  });

  it('passes Date instances through unchanged', () => {
    var d = new Date('2026-05-15T14:00:00Z');
    expect(parseDbUtc(d)).toBe(d);
  });

  it('parses explicit-zone ISO strings natively', () => {
    expect(parseDbUtc('2026-05-15T14:00:00Z').toISOString()).toBe('2026-05-15T14:00:00.000Z');
    expect(parseDbUtc('2026-05-15T10:00:00-04:00').toISOString()).toBe('2026-05-15T14:00:00.000Z');
  });

  it('returns null for null/empty/invalid input', () => {
    expect(parseDbUtc(null)).toBeNull();
    expect(parseDbUtc(undefined)).toBeNull();
    expect(parseDbUtc('')).toBeNull();
    expect(parseDbUtc('not-a-date')).toBeNull();
  });

  it('utcToLocal delegates: dateStrings input and Z input agree', () => {
    var a = utcToLocal('2026-05-15 14:00:00', 'America/New_York');
    var b = utcToLocal('2026-05-15T14:00:00Z', 'America/New_York');
    expect(a).toEqual(b);
    expect(a.date).toBe('2026-05-15');
    expect(a.time).toBe('10:00 AM');
  });
});
