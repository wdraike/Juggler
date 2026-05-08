/**
 * juggler-cal-history Plan C — past-window recurring auto-mark behavior.
 *
 * The legacy code in runSchedule.js wrote status:'skip' for past-window recurring instances.
 * Plan C changes this to status:'missed' (with completed_at = window-close UTC).
 *
 * This test asserts the helper extracted from that block returns the right window-close timestamp,
 * and that the runSchedule module exports it.
 */

process.env.NODE_ENV = 'test';

describe('runSchedule past-window helper — juggler-cal-history Plan C', () => {
  test('computeWindowCloseUtc returns scheduled_at + timeFlex minutes', () => {
    var rs = require('../../src/scheduler/runSchedule');
    expect(typeof rs.computeWindowCloseUtc).toBe('function');

    var task = { scheduledAt: '2026-05-08T12:00:00.000Z', timeFlex: 60 };
    var result = rs.computeWindowCloseUtc(task, new Date(), 'America/New_York');
    expect(result instanceof Date).toBe(true);
    expect(result.toISOString()).toBe('2026-05-08T13:00:00.000Z');
  });

  test('computeWindowCloseUtc defaults timeFlex to 60 when null', () => {
    var rs = require('../../src/scheduler/runSchedule');
    var task = { scheduledAt: '2026-05-08T12:00:00.000Z', timeFlex: null };
    var result = rs.computeWindowCloseUtc(task, new Date(), 'America/New_York');
    expect(result.toISOString()).toBe('2026-05-08T13:00:00.000Z');
  });

  test('computeWindowCloseUtc returns null when scheduledAt is missing', () => {
    var rs = require('../../src/scheduler/runSchedule');
    var task = { scheduledAt: null, timeFlex: 60 };
    var result = rs.computeWindowCloseUtc(task, new Date(), 'America/New_York');
    expect(result).toBeNull();
  });

  test('computeWindowCloseUtc handles snake_case scheduled_at', () => {
    var rs = require('../../src/scheduler/runSchedule');
    var task = { scheduled_at: '2026-05-08T12:00:00.000Z', timeFlex: 30 };
    var result = rs.computeWindowCloseUtc(task, new Date(), 'America/New_York');
    expect(result.toISOString()).toBe('2026-05-08T12:30:00.000Z');
  });
});
