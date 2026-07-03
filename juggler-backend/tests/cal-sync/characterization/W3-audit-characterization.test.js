/**
 * W3 Characterization test — audit() / auditCalendarSync()
 * cal-sync.controller.js:audit + slices/calendar/facade.js:auditCalendarSync
 *
 * POST-REFACTOR (999.1026). Verifies the extracted facade method produces the
 * same report shape and mismatch-detection behavior the controller had inline.
 * Uses jest.mock to isolate from DB/external services.
 *
 * Traceability: TRACEABILITY.md B1/B2/B3.
 */

'use strict';

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

// Mock external deps so the facade loads without DB/Redis
jest.mock('../../../src/lib/sse-emitter', function() { return { emit: jest.fn(), addClient: jest.fn() }; });
jest.mock('../../../src/scheduler/scheduleQueue', function() { return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() }; });
jest.mock('../../../src/lib/sync-lock', function() { return {
  acquireLock: jest.fn(function() { return Promise.resolve(true); }),
  releaseLock: jest.fn(function() { return Promise.resolve(); }),
  refreshLock: jest.fn(function() { return Promise.resolve(); }),
  withSyncLock: jest.fn(function(_, fn) { return fn(); }),
  withLock: jest.fn(function(_, fn) { return fn(); }),
  isLocked: jest.fn(function() { return false; }),
}; });
jest.mock('../../../src/lib/task-write-queue', function() { return { flushQueueInLock: jest.fn() }; });

// Mock the DB module so srcDb doesn't try to connect
jest.mock('../../../src/db', function() {
  var knex = jest.fn(function() { return knex; });
  knex.where = jest.fn(function() { return knex; });
  knex.whereIn = jest.fn(function() { return knex; });
  knex.whereNotNull = jest.fn(function() { return knex; });
  knex.whereNot = jest.fn(function() { return knex; });
  knex.select = jest.fn(function() { return Promise.resolve([]); });
  knex.first = jest.fn(function() { return Promise.resolve({ timezone: 'UTC' }); });
  knex.insert = jest.fn(function() { return knex; });
  knex.update = jest.fn(function() { return knex; });
  knex.delete = jest.fn(function() { return knex; });
  knex.count = jest.fn(function() { return Promise.resolve([{ cnt: 0 }]); });
  knex.orderBy = jest.fn(function() { return knex; });
  knex.limit = jest.fn(function() { return knex; });
  knex.max = jest.fn(function() { return knex; });
  knex.min = jest.fn(function() { return knex; });
  knex.groupBy = jest.fn(function() { return knex; });
  knex.from = jest.fn(function() { return knex; });
  knex.table = jest.fn(function() { return knex; });
  knex.as = jest.fn(function() { return knex; });
  knex.raw = jest.fn(function(sql) { return { toString: function() { return sql; } }; });
  knex.on = jest.fn(function() { return knex; });
  return knex;
});

// Mock task.controller.fetchTasksWithEventIds
var mockFetchTasks = jest.fn();
jest.mock('../../../src/controllers/task.controller', function() {
  return {
    fetchTasksWithEventIds: mockFetchTasks,
    rowToTask: jest.fn(),
    safeParseJSON: jest.fn(),
  };
});

// Mock adapters — the facade's `adapters` registry stores the adapter MODULES
// (not constructor instances). The original adapter modules export plain objects
// like `{ providerId, isConnected, getValidAccessToken, listEvents, ... }`.
// So jest.mock must return a plain object, not a constructor.
// We control connectedness via the mockAdaptersToReturn array.
var mockAdaptersToReturn = [];
var mockGcalAdapter = {
  providerId: 'gcal',
  getEventIdColumn: function() { return 'gcal_event_id'; },
  isConnected: function() { return mockAdaptersToReturn.indexOf(mockGcalAdapter) !== -1; },
  getValidAccessToken: null,
  listEvents: null,
};
var mockMsftAdapter = {
  providerId: 'msft',
  getEventIdColumn: function() { return 'msft_cal_event_id'; },
  isConnected: function() { return mockAdaptersToReturn.indexOf(mockMsftAdapter) !== -1; },
  getValidAccessToken: null,
  listEvents: null,
};
var mockAppleAdapter = {
  providerId: 'apple',
  getEventIdColumn: function() { return 'apple_cal_event_id'; },
  isConnected: function() { return mockAdaptersToReturn.indexOf(mockAppleAdapter) !== -1; },
  getValidAccessToken: null,
  listEvents: null,
};
jest.mock('../../../src/slices/calendar/adapters/GoogleCalendarAdapter', function() { return mockGcalAdapter; });
jest.mock('../../../src/slices/calendar/adapters/MicrosoftCalendarAdapter', function() { return mockMsftAdapter; });
jest.mock('../../../src/slices/calendar/adapters/AppleCalendarAdapter', function() { return mockAppleAdapter; });
jest.mock('../../../src/slices/calendar/adapters/InMemoryCalendarAdapter', function() { return {}; });
jest.mock('../../../src/slices/calendar/adapters/KnexSyncStateRepository', function() { return {}; });

var calendarFacade = require('../../../src/slices/calendar/facade');

// ── Test adapter factory ──────────────────────────────────────────
// Instead of fighting the facade's internal registry, we call
// auditCalendarSync with a userRow that makes getConnectedAdapters return
// what we want. Since the mock adapters' isConnected checks
// mockAdaptersToReturn, we push our adapter instances there.
function makeAdapter(pid, eventIdCol, events, opts) {
  opts = opts || {};
  var adapter = {
    providerId: pid,
    getEventIdColumn: function() { return eventIdCol; },
    isConnected: function() { return true; },
    getValidAccessToken: opts.getValidAccessToken || jest.fn(function() { return Promise.resolve('mock-token'); }),
    listEvents: opts.listEvents || jest.fn(function() { return Promise.resolve(events || []); }),
  };
  return adapter;
}

describe('W3 — auditCalendarSync characterization (999.1026)', function() {
  beforeEach(function() {
    mockFetchTasks.mockReset();
    mockFetchTasks.mockResolvedValue([]);
    mockAdaptersToReturn = [];
  });

  // W3-1: empty report shape with zero connected adapters
  test('W3-1: empty report shape with zero adapters', async function() {
    mockAdaptersToReturn = [];
    var report = await calendarFacade.auditCalendarSync('u1', { id: 'u1' }, 7);
    expect(report.window).toBeDefined();
    expect(report.window.startUTC).toBeDefined();
    expect(report.window.endUTC).toBeDefined();
    expect(report.window.days).toBe(7);
    expect(report.providers).toEqual({});
  });

  // W3-2: zero-task zero-event report shape
  test('W3-2: zero-task zero-event report shape', async function() {
    mockGcalAdapter.getValidAccessToken = jest.fn(function() { return Promise.resolve('tok'); });
    mockGcalAdapter.listEvents = jest.fn(function() { return Promise.resolve([]); });
    mockAdaptersToReturn = [mockGcalAdapter];
    mockFetchTasks.mockResolvedValue([]);

    var report = await calendarFacade.auditCalendarSync('u1', { id: 'u1' }, 7);
    expect(report.providers.gcal).toBeDefined();
    expect(report.providers.gcal.striveTasks).toBe(0);
    expect(report.providers.gcal.matched).toBe(0);
    expect(report.providers.gcal.mismatchCount).toBe(0);
    expect(report.providers.gcal.missingFromCalendar).toEqual([]);
    expect(report.providers.gcal.timeMismatches).toEqual([]);
    expect(report.providers.gcal.orphansOnCalendar).toEqual([]);
  });

  // W3-3: one task with event match → matched=1
  test('W3-3: task-event match detected', async function() {
    var task = { id: 1, text: 'Test', scheduled_at: '2026-07-02 10:00:00', dur: 30, gcal_event_id: 'evt-1' };
    var event = { id: 'evt-1', startDateTime: '2026-07-02T10:00:00.000Z', durationMinutes: 30 };
    mockGcalAdapter.getValidAccessToken = jest.fn(function() { return Promise.resolve('tok'); });
    mockGcalAdapter.listEvents = jest.fn(function() { return Promise.resolve([event]); });
    mockAdaptersToReturn = [mockGcalAdapter];
    mockFetchTasks.mockResolvedValue([task]);

    var report = await calendarFacade.auditCalendarSync('u1', { id: 'u1' }, 7);
    expect(report.providers.gcal.matched).toBe(1);
    expect(report.providers.gcal.missingFromCalendar.length).toBe(0);
    expect(report.providers.gcal.mismatchCount).toBe(0);
  });

  // W3-4: task with no event ID → missingFromCalendar
  test('W3-4: missing-from-calendar (no event ID)', async function() {
    var task = { id: 2, text: 'No event', scheduled_at: '2026-07-02 11:00:00', dur: 30, gcal_event_id: null };
    mockGcalAdapter.getValidAccessToken = jest.fn(function() { return Promise.resolve('tok'); });
    mockGcalAdapter.listEvents = jest.fn(function() { return Promise.resolve([]); });
    mockAdaptersToReturn = [mockGcalAdapter];
    mockFetchTasks.mockResolvedValue([task]);

    var report = await calendarFacade.auditCalendarSync('u1', { id: 'u1' }, 7);
    expect(report.providers.gcal.missingFromCalendar.length).toBe(1);
    expect(report.providers.gcal.missingFromCalendar[0].reason).toBe('no event ID');
    expect(report.providers.gcal.mismatchCount).toBe(1);
  });

  // W3-5: time mismatch detected
  test('W3-5: time mismatch detected', async function() {
    var task = { id: 3, text: 'Time off', scheduled_at: '2026-07-02 10:00:00', dur: 30, gcal_event_id: 'evt-3' };
    var event = { id: 'evt-3', startDateTime: '2026-07-02T10:30:00.000Z', durationMinutes: 30 };
    mockGcalAdapter.getValidAccessToken = jest.fn(function() { return Promise.resolve('tok'); });
    mockGcalAdapter.listEvents = jest.fn(function() { return Promise.resolve([event]); });
    mockAdaptersToReturn = [mockGcalAdapter];
    mockFetchTasks.mockResolvedValue([task]);

    var report = await calendarFacade.auditCalendarSync('u1', { id: 'u1' }, 7);
    expect(report.providers.gcal.timeMismatches.length).toBe(1);
    expect(report.providers.gcal.matched).toBe(0);
    expect(report.providers.gcal.mismatchCount).toBe(1);
  });

  // W3-6: orphan on calendar detected
  test('W3-6: orphan on calendar detected', async function() {
    var event = { id: 'orphan-evt', startDateTime: '2026-07-02T12:00:00.000Z', title: 'Orphan' };
    mockGcalAdapter.getValidAccessToken = jest.fn(function() { return Promise.resolve('tok'); });
    mockGcalAdapter.listEvents = jest.fn(function() { return Promise.resolve([event]); });
    mockAdaptersToReturn = [mockGcalAdapter];
    mockFetchTasks.mockResolvedValue([]);

    var report = await calendarFacade.auditCalendarSync('u1', { id: 'u1' }, 7);
    expect(report.providers.gcal.orphansOnCalendar.length).toBe(1);
    expect(report.providers.gcal.orphansOnCalendar[0].eventId).toBe('orphan-evt');
    expect(report.providers.gcal.mismatchCount).toBe(1);
  });

  // W3-7: adapter error captured in provider report
  test('W3-7: adapter error captured', async function() {
    mockGcalAdapter.getValidAccessToken = jest.fn(function() { return Promise.reject(new Error('Token expired')); });
    mockGcalAdapter.listEvents = jest.fn(function() { return Promise.resolve([]); });
    mockAdaptersToReturn = [mockGcalAdapter];
    mockFetchTasks.mockResolvedValue([]);

    var report = await calendarFacade.auditCalendarSync('u1', { id: 'u1' }, 7);
    expect(report.providers.gcal.error).toBe('Token expired');
  });

  // W3-8: duration mismatch detected
  test('W3-8: duration mismatch detected', async function() {
    var task = { id: 4, text: 'Dur off', scheduled_at: '2026-07-02 10:00:00', dur: 60, gcal_event_id: 'evt-4' };
    var event = { id: 'evt-4', startDateTime: '2026-07-02T10:00:00.000Z', durationMinutes: 30 };
    mockGcalAdapter.getValidAccessToken = jest.fn(function() { return Promise.resolve('tok'); });
    mockGcalAdapter.listEvents = jest.fn(function() { return Promise.resolve([event]); });
    mockAdaptersToReturn = [mockGcalAdapter];
    mockFetchTasks.mockResolvedValue([task]);

    var report = await calendarFacade.auditCalendarSync('u1', { id: 'u1' }, 7);
    expect(report.providers.gcal.durMismatches.length).toBe(1);
    expect(report.providers.gcal.matched).toBe(0);
    expect(report.providers.gcal.mismatchCount).toBe(1);
  });
});