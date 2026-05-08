/**
 * Tests for shared/scheduler/missedHelpers.js — juggler-cal-history Plan D.
 */
process.env.NODE_ENV = 'test';

var helpers = require('../../../shared/scheduler/missedHelpers');

describe('missedHelpers', function() {
  test('windowCloseUtc returns scheduled_at + timeFlex minutes', function() {
    var task = { scheduledAt: '2026-05-08T12:00:00.000Z', timeFlex: 60 };
    expect(helpers.windowCloseUtc(task).toISOString()).toBe('2026-05-08T13:00:00.000Z');
  });

  test('windowCloseUtc defaults timeFlex=60 when null', function() {
    var task = { scheduledAt: '2026-05-08T12:00:00.000Z', timeFlex: null };
    expect(helpers.windowCloseUtc(task).toISOString()).toBe('2026-05-08T13:00:00.000Z');
  });

  test('windowCloseUtc returns null when scheduledAt missing', function() {
    expect(helpers.windowCloseUtc({ timeFlex: 60 })).toBeNull();
  });

  test('windowCloseUtc accepts snake_case scheduled_at', function() {
    var task = { scheduled_at: '2026-05-08T12:00:00.000Z', timeFlex: 30 };
    expect(helpers.windowCloseUtc(task).toISOString()).toBe('2026-05-08T12:30:00.000Z');
  });

  test('isPastWindow true when now > windowClose', function() {
    var task = { scheduledAt: '2026-05-08T12:00:00.000Z', timeFlex: 60 };
    var now = new Date('2026-05-08T14:00:00.000Z');
    expect(helpers.isPastWindow(task, now)).toBe(true);
  });

  test('isPastWindow false when now < windowClose', function() {
    var task = { scheduledAt: '2026-05-08T12:00:00.000Z', timeFlex: 60 };
    var now = new Date('2026-05-08T12:30:00.000Z');
    expect(helpers.isPastWindow(task, now)).toBe(false);
  });

  test('isPastWindow false when scheduledAt missing', function() {
    expect(helpers.isPastWindow({ timeFlex: 60 }, new Date())).toBe(false);
  });
});
