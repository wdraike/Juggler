/**
 * 999.2030 — Synced events must own their time slot exclusively.
 *
 * RED test: a formerly-REMINDER task whose event becomes busy (not transparent)
 * with NO date/time change must be promoted to FIXED (blocking), not ANYTIME
 * (non-blocking). The current REMINDER→ANYTIME reset lets a busy synced event
 * become non-blocking, allowing double-booking.
 *
 * The sole exception: reminder tasks (task_type=reminder) are non-blocking and
 * may coexist with any other task in the same window.
 */

'use strict';

var gcalAdapter  = require('../../../src/lib/cal-adapters/gcal.adapter');
var msftAdapter  = require('../../../src/lib/cal-adapters/msft.adapter');
var appleAdapter = require('../../../src/lib/cal-adapters/apple.adapter');
var { PLACEMENT_MODES } = require('../../../src/lib/placementModes');

var TZ = 'America/New_York';

function timedEvent(overrides) {
  return Object.assign({
    title: 'Team Standup',
    startDateTime: '2026-06-15T10:00:00',
    endDateTime:   '2026-06-15T10:30:00',
    isAllDay:      false,
    durationMinutes: 30,
    isTransparent: false,
    description:   ''
  }, overrides);
}

describe('999.2030: synced busy event must be FIXED (blocking), not ANYTIME', () => {
  describe('GCal adapter — formerly-reminder task, event becomes busy, no date/time change', () => {
    test('reminder task with matching date/time, event no longer transparent → FIXED', () => {
      var event = timedEvent({ isTransparent: false });
      var current = {
        placement_mode: PLACEMENT_MODES.REMINDER,
        date: '2026-06-15',
        time: '10:00 AM'
      };
      var fields = gcalAdapter.applyEventToTaskFields(event, TZ, current);
      // Must be FIXED (blocking) — the event is busy and has a scheduled_at.
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    });
  });

  describe('MSFT adapter — formerly-reminder task, event becomes busy, no date/time change', () => {
    test('reminder task with matching date/time, event no longer transparent → FIXED', () => {
      var event = timedEvent({ isTransparent: false, startTimezone: 'Eastern Standard Time' });
      var current = {
        placement_mode: PLACEMENT_MODES.REMINDER,
        date: '2026-06-15',
        time: '10:00 AM'
      };
      var fields = msftAdapter.applyEventToTaskFields(event, TZ, current);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    });
  });

  describe('Apple adapter — formerly-reminder task, event becomes busy, no date/time change', () => {
    test('reminder task with matching date/time, event no longer transparent → FIXED', () => {
      var event = timedEvent({ isTransparent: false });
      var current = {
        placement_mode: PLACEMENT_MODES.REMINDER,
        date: '2026-06-15',
        time: '10:00 AM'
      };
      var fields = appleAdapter.applyEventToTaskFields(event, TZ, current);
      expect(fields.placement_mode).toBe(PLACEMENT_MODES.FIXED);
    });
  });
});