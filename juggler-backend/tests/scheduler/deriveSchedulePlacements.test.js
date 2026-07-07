/**
 * Unit tests for deriveSchedulePlacements — W3 DB single-source read helper.
 *
 * Covers: W3 (TRACEABILITY.md row W3) — placed/unplaced partition, start/end
 * derivation, start!=null guard (data-anomaly skip), unscheduled/unplaced
 * routing rules, and timezone resolution.
 *
 * Layer: unit (taskFacade + DB stubbed via jest.mock; no real DB required)
 *
 * Routing rules (documented in deriveSchedulePlacements.js header):
 *   1. t.unscheduled OR (t._unplacedReason && !t.scheduledAt) → unplaced[]
 *   2. t.scheduledAt → derive local date+time via utcToLocal → dayPlacements[date]
 *   3. t.scheduledAt but unparseable derivation → skipped (data anomaly)
 *   4. otherwise (no scheduledAt / plain backlog) → absent from both
 */

'use strict';

// ── Stub DB (resolveTimezone DB lookup) ────────────────────────────────────────
var mockDbWhere = jest.fn();
var mockDbFirst = jest.fn();
var mockDbSelect = jest.fn();
var mockDbChain = {
  where: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  first: jest.fn()
};
var mockDb = jest.fn(function() { return mockDbChain; });
mockDb.raw = jest.fn();
jest.mock('../../src/db', function() { return mockDb; });

// ── Stub taskFacade ─────────────────────────────────────────────────────────────
var mockGetAllTasks = jest.fn();
jest.mock('../../src/slices/task/facade', function() {
  return { getAllTasks: mockGetAllTasks };
});

var { deriveSchedulePlacements } = require('../../src/scheduler/deriveSchedulePlacements');

// ── Helpers ────────────────────────────────────────────────────────────────────

var TZ = 'America/New_York';

function seedTasks(tasks) {
  mockGetAllTasks.mockResolvedValueOnce({ body: { tasks: tasks } });
}

function seedNoUser() {
  // DB lookup returns no row → timezone falls back to default
  mockDbChain.first.mockResolvedValueOnce(null);
}

function seedUserTz(tz) {
  mockDbChain.first.mockResolvedValueOnce({ timezone: tz });
}

beforeEach(function() {
  jest.clearAllMocks();
  // Default: chain returns itself for chaining; first() returns ET user
  mockDbChain.where.mockReturnValue(mockDbChain);
  mockDbChain.select.mockReturnValue(mockDbChain);
  mockDbChain.first.mockResolvedValue({ timezone: TZ });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('deriveSchedulePlacements — output shape', function() {
  test('always returns { dayPlacements, unplaced, warnings }', async function() {
    seedTasks([]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result).toHaveProperty('dayPlacements');
    expect(result).toHaveProperty('unplaced');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.unplaced)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(typeof result.dayPlacements).toBe('object');
  });

  test('warnings is always an empty array (read helper emits none)', async function() {
    // 9:00 AM ET = 14:00 UTC on a standard day (EST+5h, but in June EDT+4h = 13:00 UTC)
    seedTasks([{ id: 't1', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.warnings).toEqual([]);
  });
});

describe('deriveSchedulePlacements — placed partition (Rule 2: scheduledAt → derive local date+time)', function() {
  test('task with scheduledAt → dayPlacements[date], absent from unplaced', async function() {
    // 2026-06-22T13:00:00Z in America/New_York (EDT, UTC-4) = 9:00 AM
    var task = { id: 't-placed', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 };
    seedTasks([task]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    expect(result.dayPlacements['2026-06-22'].length).toBe(1);
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.task.id).toBe('t-placed');
    expect(result.unplaced.map(function(t) { return t.id; })).not.toContain('t-placed');
  });

  test('start derived from UTC scheduledAt converted to local time — 13:00Z (EDT) → 9:00 AM → 540 min', async function() {
    seedTasks([{ id: 't-start', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.start).toBe(540); // 9 * 60
  });

  test('end = start + dur', async function() {
    seedTasks([{ id: 't-end', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 45 }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.end).toBe(entry.start + 45);
  });

  test('dur defaults to 0 when absent (end === start)', async function() {
    seedTasks([{ id: 't-nodur', scheduledAt: '2026-06-22T14:30:00.000Z' }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.end).toBe(entry.start);
  });

  test('multiple tasks on same date accumulate in the same array', async function() {
    seedTasks([
      { id: 't-a', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 },
      { id: 't-b', scheduledAt: '2026-06-22T14:00:00.000Z', dur: 30 }
    ]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.dayPlacements['2026-06-22'].length).toBe(2);
  });

  test('tasks on different dates go into separate dayPlacements keys', async function() {
    seedTasks([
      { id: 't-mon', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 },
      { id: 't-tue', scheduledAt: '2026-06-23T13:00:00.000Z', dur: 30 }
    ]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(Object.keys(result.dayPlacements).sort()).toEqual(['2026-06-22', '2026-06-23']);
  });
});

describe('deriveSchedulePlacements — unplaced partition (Rule 1)', function() {
  test('t.unscheduled=true → unplaced[], absent from dayPlacements', async function() {
    var task = { id: 't-unsched', unscheduled: true, scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 };
    seedTasks([task]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.unplaced.map(function(t) { return t.id; })).toContain('t-unsched');
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
  });

  test('t._unplacedReason && !t.scheduledAt → unplaced[]', async function() {
    var task = { id: 't-reason', _unplacedReason: 'NO_WINDOW', scheduledAt: null, dur: 30 };
    seedTasks([task]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.unplaced.map(function(t) { return t.id; })).toContain('t-reason');
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
  });

  test('t._unplacedReason with scheduledAt set → placed, NOT unplaced (Rule 2 wins)', async function() {
    // A task can have _unplacedReason but also scheduledAt if the scheduler later placed it.
    // Rule 1 only fires when scheduledAt is falsy.
    var task = { id: 't-reason-placed', _unplacedReason: 'PAST', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 };
    seedTasks([task]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    // Routed by Rule 2 (scheduledAt present, derivable date+time)
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    expect(result.unplaced.map(function(t) { return t.id; })).not.toContain('t-reason-placed');
  });
});

describe('deriveSchedulePlacements — data anomaly guard (unparseable derivation skipped)', function() {
  test('task with no scheduledAt → absent from both dayPlacements and unplaced (backlog)', async function() {
    var task = { id: 't-backlog', dur: 30 };
    seedTasks([task]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
    expect(result.unplaced.map(function(t) { return t.id; })).not.toContain('t-backlog');
  });

  test('task with scheduledAt=null → absent from both (no date derivable)', async function() {
    var task = { id: 't-null-sa', scheduledAt: null, dur: 30 };
    seedTasks([task]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
    expect(result.unplaced.map(function(t) { return t.id; })).not.toContain('t-null-sa');
  });
});

describe('deriveSchedulePlacements — null task guard', function() {
  test('null entries in task list are silently skipped (no throw)', async function() {
    mockGetAllTasks.mockResolvedValueOnce({ body: { tasks: [null, { id: 't-ok', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 }, null] } });
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    expect(result.dayPlacements['2026-06-22'].length).toBe(1);
  });
});

describe('deriveSchedulePlacements — taskFacade failure / empty result', function() {
  test('facade returns null body → returns empty shape without throwing', async function() {
    mockGetAllTasks.mockResolvedValueOnce(null);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.dayPlacements).toEqual({});
    expect(result.unplaced).toEqual([]);
  });

  test('facade returns no tasks key → returns empty shape without throwing', async function() {
    mockGetAllTasks.mockResolvedValueOnce({ body: {} });
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.dayPlacements).toEqual({});
    expect(result.unplaced).toEqual([]);
  });
});

describe('deriveSchedulePlacements — timezone resolution', function() {
  test('uses options.timezone when provided (no DB lookup)', async function() {
    seedTasks([{ id: 't-tz', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 }]);
    // When options.timezone is set, DB should NOT be queried for tz
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    // DB was not queried (no mockDbChain.first calls consumed for tz lookup)
    expect(mockDbChain.first).not.toHaveBeenCalled();
  });

  test('falls back to users table timezone when no options.timezone', async function() {
    // The DB lookup returns 'Europe/London' (UTC+1 in summer)
    // 2026-06-22T08:00Z → London (BST, UTC+1) → 9:00 AM
    mockDbChain.first.mockResolvedValueOnce({ timezone: 'Europe/London' });
    seedTasks([{ id: 't-london', scheduledAt: '2026-06-22T08:00:00.000Z', dur: 30 }]);
    var result = await deriveSchedulePlacements('u1');  // no options
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.start).toBe(540); // 9:00 AM = 540 min
  });

  test('falls back to America/New_York when DB returns no user row', async function() {
    mockDbChain.first.mockResolvedValueOnce(null);
    // 2026-06-22T13:00Z = 9:00 AM EDT (default TZ fallback)
    seedTasks([{ id: 't-default', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 }]);
    var result = await deriveSchedulePlacements('u2');
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.start).toBe(540); // 9:00 AM = 540 min
  });
});

// 999.1183 — this backend copy had NO terminal-status branch at all, so a
// done/cancelled/skipped/paused task carrying unscheduled=1 (e.g. an orphaned
// split chunk resolved via sibling propagation) was reported as unplaced by
// MCP get_schedule while the frontend grids or drops it — MCP clients (ClimbRS)
// saw different schedule truth than the UI. Mirrors derivePlacements.js.
describe('deriveSchedulePlacements — terminal statuses are never unplaced (999.1183)', function() {
  test('done + unscheduled=1 + a scheduledAt slot → grids, NOT unplaced', async function() {
    seedTasks([{ id: 't-done', status: 'done', unscheduled: true, scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.unplaced.map(function(t) { return t.id; })).not.toContain('t-done');
    expect(result.dayPlacements['2026-06-22']).toBeDefined();
    expect(result.dayPlacements['2026-06-22'][0].task.id).toBe('t-done');
  });

  test('cancelled + unscheduled=1 + NO scheduledAt → drops out of both (no slot to grid)', async function() {
    seedTasks([{ id: 't-cancelled', status: 'cancelled', unscheduled: true, scheduledAt: null }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.unplaced.map(function(t) { return t.id; })).not.toContain('t-cancelled');
    expect(Object.keys(result.dayPlacements)).toHaveLength(0);
  });

  test('missed + unscheduled=1 → NOT unplaced (999.844/999.1181: missed is terminal)', async function() {
    seedTasks([{ id: 't-missed', status: 'missed', unscheduled: true, scheduledAt: null }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.unplaced.map(function(t) { return t.id; })).not.toContain('t-missed');
  });

  test('a NON-terminal unscheduled task still goes to unplaced (guard not over-broad)', async function() {
    seedTasks([{ id: 't-pending', status: '', unscheduled: true, scheduledAt: null }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    expect(result.unplaced.map(function(t) { return t.id; })).toContain('t-pending');
  });

  test('done with completedAt → end = actual elapsed, not start+dur (JUG-CLOSE-NOW)', async function() {
    // start 9:00 AM (13:00Z), completed 9:20 AM (13:20Z), dur=30 (would estimate end=9:30)
    seedTasks([{
      id: 't-completed', status: 'done', scheduledAt: '2026-06-22T13:00:00.000Z',
      completedAt: '2026-06-22T13:20:00.000Z', dur: 30
    }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.start).toBe(540); // 9:00 AM
    expect(entry.end).toBe(560);   // 9:20 AM, not 570 (9:30 estimated)
  });

  test('done with completedAt BEFORE start (midnight rollover) → falls back to estimated end', async function() {
    // start 11:50 PM ET on 6/22 (03:50Z on 6/23), completed 12:10 AM ET on 6/23
    // (04:10Z) — completedAt's local time-of-day (10 min) is less than start's
    // (1430 min), so the guard must reject it and fall back to start+dur.
    seedTasks([{
      id: 't-rollover', status: 'done', scheduledAt: '2026-06-23T03:50:00.000Z',
      completedAt: '2026-06-23T04:10:00.000Z', dur: 30
    }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.start).toBe(1430); // 11:50 PM
    expect(entry.end).toBe(entry.start + 30); // estimated fallback, not the bogus earlier time
  });

  test('done without completedAt → end = start+dur (unchanged legacy behavior)', async function() {
    seedTasks([{ id: 't-done-nocompleted', status: 'done', scheduledAt: '2026-06-22T13:00:00.000Z', dur: 30 }]);
    var result = await deriveSchedulePlacements('u1', { timezone: TZ });
    var entry = result.dayPlacements['2026-06-22'][0];
    expect(entry.end).toBe(entry.start + 30);
  });
});
