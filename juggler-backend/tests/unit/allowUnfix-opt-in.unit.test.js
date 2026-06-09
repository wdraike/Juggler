/**
 * Unit tests for _allowUnfix opt-in path (ZOE-JUG-023-W3)
 * Tests the guardFixedCalendarWhen function behavior with _allowUnfix flag.
 */

// Mock db at require-time so task.controller.js can load without a real DB.
jest.mock('../../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = jest.fn(() => mock);
  mock.fn = fn;
  mock.where = jest.fn(() => mock);
  mock.whereIn = jest.fn(() => mock);
  mock.select = jest.fn().mockResolvedValue([]);
  return mock;
});

var { guardFixedCalendarWhen } = require('../../src/controllers/task.controller');

describe('_allowUnfix opt-in unit tests', function() {
  describe('guardFixedCalendarWhen behavior', function() {
    test('blocks placement_mode change on calendar-synced task without _allowUnfix', () => {
      var row = { placement_mode: 'anytime' };
      var existing = { gcal_event_id: 'gcal_abc', msft_event_id: null, apple_event_id: null };
      
      // Call guard without allowUnfix option
      guardFixedCalendarWhen(row, existing, {});
      
      // Should have been blocked - placement_mode should not be changed
      expect(row.placement_mode).toBeUndefined();
    });

    test('allows placement_mode change on calendar-synced task with _allowUnfix=true', () => {
      var row = { placement_mode: 'anytime' };
      var existing = { gcal_event_id: 'gcal_abc', msft_event_id: null, apple_event_id: null };
      
      // Call guard with allowUnfix option
      guardFixedCalendarWhen(row, existing, { allowUnfix: true });
      
      // Should be allowed - placement_mode should remain unchanged
      expect(row.placement_mode).toBe('anytime');
    });

    test('allows placement_mode change on non-calendar-synced task regardless of _allowUnfix', () => {
      var row = { placement_mode: 'anytime' };
      var existing = { gcal_event_id: null, msft_event_id: null, apple_event_id: null };
      
      // Call guard without allowUnfix option on non-synced task
      guardFixedCalendarWhen(row, existing, {});
      
      // Should be allowed - no calendar sync, so guard doesn't apply
      expect(row.placement_mode).toBe('anytime');
    });

    test('blocks clearing placement_mode on calendar-synced task without _allowUnfix', () => {
      var row = { placement_mode: null };
      var existing = { gcal_event_id: 'gcal_def', msft_event_id: null, apple_event_id: null };
      
      // Call guard without allowUnfix option
      guardFixedCalendarWhen(row, existing, {});
      
      // Should have been blocked - placement_mode should not be cleared
      expect(row.placement_mode).toBeUndefined();
    });

    test('allows clearing placement_mode on calendar-synced task with _allowUnfix=true', () => {
      var row = { placement_mode: null };
      var existing = { gcal_event_id: 'gcal_def', msft_event_id: null, apple_event_id: null };
      
      // Call guard with allowUnfix option
      guardFixedCalendarWhen(row, existing, { allowUnfix: true });
      
      // Should be allowed - placement_mode should remain null
      expect(row.placement_mode).toBe(null);
    });
  });

  describe('multiple calendar provider support', function() {
    test('blocks placement_mode change on MSFT calendar-synced task without _allowUnfix', () => {
      var row = { placement_mode: 'time_blocks' };
      var existing = { gcal_event_id: null, msft_event_id: 'msft_xyz', apple_event_id: null };
      
      guardFixedCalendarWhen(row, existing, {});
      expect(row.placement_mode).toBeUndefined();
    });

    test('allows placement_mode change on MSFT calendar-synced task with _allowUnfix=true', () => {
      var row = { placement_mode: 'time_blocks' };
      var existing = { gcal_event_id: null, msft_event_id: 'msft_xyz', apple_event_id: null };
      
      guardFixedCalendarWhen(row, existing, { allowUnfix: true });
      expect(row.placement_mode).toBe('time_blocks');
    });

    test('blocks placement_mode change on Apple calendar-synced task without _allowUnfix', () => {
      // Use a non-'fixed' value: the guard deletes any value that isn't 'fixed'
      // (it protects 'fixed', and blocks everything else on a cal-linked task).
      var row = { placement_mode: 'anytime' };
      var existing = { gcal_event_id: null, msft_event_id: null, apple_event_id: 'apple_123' };

      guardFixedCalendarWhen(row, existing, {});
      expect(row.placement_mode).toBeUndefined();
    });

    test('allows placement_mode change on Apple calendar-synced task with _allowUnfix=true', () => {
      var row = { placement_mode: 'anytime' };
      var existing = { gcal_event_id: null, msft_event_id: null, apple_event_id: 'apple_123' };

      guardFixedCalendarWhen(row, existing, { allowUnfix: true });
      expect(row.placement_mode).toBe('anytime');
    });
  });

  describe('edge cases', function() {
    test('returns early when guardTarget is null', () => {
      var row = { placement_mode: 'anytime' };
      var existing = null;
      
      // Should not throw and should not modify row
      guardFixedCalendarWhen(row, existing, {});
      expect(row.placement_mode).toBe('anytime');
    });

    test('returns early when guardTarget is undefined', () => {
      var row = { placement_mode: 'anytime' };
      var existing = undefined;
      
      // Should not throw and should not modify row
      guardFixedCalendarWhen(row, existing, {});
      expect(row.placement_mode).toBe('anytime');
    });

    test('allows non-placement_mode changes on calendar-synced tasks without _allowUnfix', () => {
      var row = { status: 'done', notes: 'Updated notes' };
      var existing = { gcal_event_id: 'gcal_ghi', msft_event_id: null, apple_event_id: null };
      
      // Should not affect non-placement_mode fields
      guardFixedCalendarWhen(row, existing, {});
      expect(row.status).toBe('done');
      expect(row.notes).toBe('Updated notes');
    });
  });
});