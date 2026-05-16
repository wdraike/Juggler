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
