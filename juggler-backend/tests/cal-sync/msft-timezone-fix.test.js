/**
 * 999.5028 — MSFT event timezone: wall clock converted with WRONG zone.
 *
 * When an MSFT event has startTimezone='Eastern Standard Time' but the
 * user's tz is 'America/Chicago' (Central), the wall clock components
 * from isoToJugglerDate are in Eastern time, but localToUtc converts
 * them as if they were Central time — off by 1 hour.
 */

var msftAdapter = require('../../src/slices/calendar/adapters/MicrosoftCalendarAdapter');

describe('999.5028 — MSFT adapter applyEventToTaskFields timezone', function () {
  it('converts wall clock using the EVENT timezone, not the user timezone', function () {
    // Event in Eastern time at 10:00 AM EST
    // User is in Central time (America/Chicago, UTC-6 in winter)
    // 10:00 AM EST = 9:00 AM CST = 15:00 UTC (winter, no DST)
    //
    // BUG: localToUtc('2026-01-15', '10:00 AM', 'America/Chicago')
    //      treats 10:00 AM as Central → 16:00 UTC (wrong, 1 hour late)
    // FIX: localToUtc('2026-01-15', '10:00 AM', 'America/New_York')
    //      treats 10:00 AM as Eastern → 15:00 UTC (correct)

    var event = {
      title: 'EST Meeting',
      startDateTime: '2026-01-15T10:00:00', // offset-less, floating in EST
      endDateTime: '2026-01-15T11:00:00',
      startTimezone: 'Eastern Standard Time', // Windows timezone name
      isAllDay: false,
      durationMinutes: 60,
      isTransparent: false,
      description: ''
    };

    var currentTask = { date: '2026-01-15', time: '10:00 AM', placement_mode: 'fixed' };

    // User is in Central time
    var fields = msftAdapter.applyEventToTaskFields(event, 'America/Chicago', currentTask);

    expect(fields.scheduled_at).toBeDefined();

    // 10:00 AM EST on Jan 15 2026 = 15:00 UTC
    // The scheduled_at should be 2026-01-15T15:00:00Z (or equivalent)
    var expectedUtc = new Date(Date.UTC(2026, 0, 15, 15, 0, 0));
    var actualUtc = new Date(fields.scheduled_at);
    expect(actualUtc.getTime()).toBe(expectedUtc.getTime());
  });

  it('falls back to user tz when startTimezone is null/absent', function () {
    var event = {
      title: 'No TZ Event',
      startDateTime: '2026-01-15T10:00:00',
      endDateTime: '2026-01-15T11:00:00',
      startTimezone: null,
      isAllDay: false,
      durationMinutes: 60,
      isTransparent: false,
      description: ''
    };

    var currentTask = { date: '2026-01-15', time: '10:00 AM', placement_mode: 'fixed' };

    // User is in Central time, no event timezone → use Central
    var fields = msftAdapter.applyEventToTaskFields(event, 'America/Chicago', currentTask);

    expect(fields.scheduled_at).toBeDefined();

    // 10:00 AM CST on Jan 15 2026 = 16:00 UTC
    var expectedUtc = new Date(Date.UTC(2026, 0, 15, 16, 0, 0));
    var actualUtc = new Date(fields.scheduled_at);
    expect(actualUtc.getTime()).toBe(expectedUtc.getTime());
  });
});