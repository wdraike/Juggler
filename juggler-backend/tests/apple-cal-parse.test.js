/**
 * apple-cal-parse.test.js — Unit tests for parseVEvents
 * Pure unit tests — no DB, no network.
 */
var ICAL = require('ical.js');
var { parseVEvents } = require('../src/lib/apple-cal-api');

function buildIcs(dtstart, dtend, extra) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19671029T020000',
    'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=11',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19870405T020000',
    'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:test-uid-001',
    'SUMMARY:Test Event',
    dtstart,
    dtend,
    extra || '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
}

describe('BF-5: floating-time DTSTART converted to UTC', () => {
  it('DTSTART with TZID=America/New_York produces UTC startDateTime (Z suffix)', () => {
    // 10:00 AM New York in May = EDT = UTC-4 → 14:00 UTC
    var ics = buildIcs(
      'DTSTART;TZID=America/New_York:20260515T100000',
      'DTEND;TZID=America/New_York:20260515T103000'
    );
    var events = parseVEvents(ics, 'https://cal/test.ics', '"etag1"');
    expect(events).toHaveLength(1);
    expect(events[0].startDateTime).toMatch(/Z$/);
    expect(events[0].startDateTime).toBe('2026-05-15T14:00:00Z');
  });

  it('DTSTART in UTC (Z suffix) is preserved correctly', () => {
    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test-uid-002',
      'SUMMARY:UTC Event',
      'DTSTART:20260515T140000Z',
      'DTEND:20260515T143000Z',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    var events = parseVEvents(ics, 'https://cal/test.ics', '"etag2"');
    expect(events[0].startDateTime).toMatch(/Z$/);
    expect(events[0].startDateTime).toBe('2026-05-15T14:00:00Z');
  });

  it('all-day DTSTART (date-only) is not affected by UTC conversion', () => {
    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test-uid-003',
      'SUMMARY:All Day',
      'DTSTART;VALUE=DATE:20260515',
      'DTEND;VALUE=DATE:20260516',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    var events = parseVEvents(ics, 'https://cal/test.ics', '"etag3"');
    expect(events[0].isAllDay).toBe(true);
    expect(events[0].startDateTime).toBe('2026-05-15');
    expect(events[0].startDateTime).not.toMatch(/Z$/);
  });

  it('DTSTART with no TZID and no Z (floating) is stored without Z suffix', () => {
    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test-uid-float',
      'SUMMARY:Floating Event',
      'DTSTART:20260515T100000',
      'DTEND:20260515T103000',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    var events = parseVEvents(ics, 'https://cal/test.ics', '"etag-float"');
    expect(events).toHaveLength(1);
    // Floating times should not have a Z suffix (they have no timezone info)
    expect(events[0].startDateTime).toBe('2026-05-15T10:00:00');
    expect(events[0].startDateTime).not.toMatch(/Z$/);
  });
});

describe('BF-6: multi-VEVENT ICS — master not overwritten by override', () => {
  it('returns both VEVENTs from a single ICS with different ids', () => {
    var ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:recurring-abc',
      'SUMMARY:Weekly standup',
      'DTSTART:20260515T130000Z',
      'DTEND:20260515T133000Z',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:recurring-abc',
      'SUMMARY:Weekly standup (moved)',
      'DTSTART:20260515T180000Z',
      'DTEND:20260515T183000Z',
      'RECURRENCE-ID:20260515T130000Z',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    var events = parseVEvents(ics, 'https://cal/recurring.ics', '"etag"');
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Weekly standup');
    expect(events[1].title).toBe('Weekly standup (moved)');
    // master has plain uid
    expect(events[0].id).toBe('recurring-abc');
    // override has uid_recurrenceId
    expect(events[1].id).toMatch(/^recurring-abc_/);
    expect(events[0].id).not.toBe(events[1].id);
  });
});

var { buildVEvent } = require('../src/lib/apple-cal-api');

// --- VALARM handling ---
describe('VALARM: stripped on buildVEvent, preserved in _raw on parse', () => {
  it('buildVEvent output does not contain BEGIN:VALARM', () => {
    var task = {
      id: 'task-001', text: 'Test task', date: '2026-05-15',
      time: '10:00 AM', dur: 30, when: 'morning', status: 'todo', url: null
    };
    var ics = buildVEvent(task, 2026, 'America/New_York');
    expect(ics).not.toContain('BEGIN:VALARM');
  });

  it('parseVEvents: VALARM in _raw but no named alarms field', () => {
    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:alarm-test',
      'SUMMARY:Alarm Event',
      'DTSTART:20260515T140000Z',
      'DTEND:20260515T143000Z',
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    var events = parseVEvents(ics, 'https://cal/alarm.ics', '"etag"');
    expect(events[0]._raw).toContain('VALARM');
    expect(events[0].alarms).toBeUndefined();
  });
});

// --- RRULE passthrough ---
describe('RRULE: present in _raw, not extracted to named field', () => {
  it('parseVEvents returns the VEVENT; rrule not a named field', () => {
    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:rrule-test',
      'SUMMARY:Weekly meeting',
      'DTSTART:20260515T140000Z',
      'DTEND:20260515T150000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=TH',
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    var events = parseVEvents(ics, 'https://cal/rrule.ics', '"etag"');
    expect(events).toHaveLength(1);
    expect(events[0].rrule).toBeUndefined();
    expect(events[0]._raw).toContain('RRULE');
  });
});

// --- Malformed ICS ---
describe('Malformed ICS behavior', () => {
  it('parseVEvents throws ParserError on garbage input (ICAL.parse does not silently swallow invalid data)', () => {
    expect(() => {
      parseVEvents('GARBAGE NOT ICS', 'https://cal/bad.ics', '"etag"');
    }).toThrow();
  });
});

// --- X-APPLE-* extensions ---
describe('X-APPLE-* extensions: parser robustness', () => {
  it('handles X-APPLE-STRUCTURED-LOCATION without error', () => {
    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:apple-ext-test',
      'SUMMARY:Office meeting',
      'DTSTART:20260515T140000Z',
      'DTEND:20260515T150000Z',
      'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=49;X-TITLE=Apple Park:geo:37.33182,-122.03118',
      'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    var events = parseVEvents(ics, 'https://cal/apple-ext.ics', '"etag"');
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Office meeting');
  });
});

// --- Non-ASCII / emoji ---
describe('Non-ASCII characters in SUMMARY', () => {
  it('round-trips emoji title through parseVEvents', () => {
    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:emoji-test',
      'SUMMARY:Café Meeting 🎉',
      'DTSTART:20260515T140000Z',
      'DTEND:20260515T150000Z',
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    var events = parseVEvents(ics, 'https://cal/emoji.ics', '"etag"');
    expect(events[0].title).toBe('Café Meeting 🎉');
  });
});
