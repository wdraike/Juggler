/**
 * scheduleQueuePollIdle.test.js — 999.955
 *
 * Guards the idle-path short-circuit in scheduleQueue.pollOnce(): when the
 * schedule_queue has no pending work, the poll tick MUST NOT issue the three
 * diagnostic queries (schedPending COUNT, task_write_queue COUNT, and the
 * expensive `tasks_v` DISTINCT user_id scan). Those queries only feed a
 * logger.info() that is gated on `pending.length > 0 || schedPending > 0`, and
 * because schedPending shares the identical WHERE clause as the primary pending
 * SELECT, an empty `pending` necessarily means schedPending === 0 — so the log
 * never fires on the idle path and the three queries are pure waste on every
 * POLL_MS tick of every Cloud Run instance.
 *
 * Pure unit test: the `db` module is fully mocked with a chainable knex-like
 * builder that records table access; no real DB is touched. We assert on which
 * tables pollOnce() reads.
 */

// Mock collaborators so processUser() resolves the test doubles instead of
// loading the real scheduler require-closure / acquiring real locks.
jest.mock('../src/slices/scheduler/facade', () => ({
  runScheduleAndPersist: jest.fn().mockResolvedValue({ updated: 0, cleared: 0 })
}));
jest.mock('../src/lib/sync-lock', () => ({
  withLock: jest.fn(async function (userId, fn) { return fn(); })
}));
jest.mock('../src/lib/task-write-queue', () => ({
  flushQueueInLock: jest.fn().mockResolvedValue()
}));
jest.mock('../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));

// Shared logger spy — every createLogger() call returns the same stub so the
// test can assert the diagnostic logger.info() fired (non-idle) or not (idle).
jest.mock('@raike/lib-logger', () => {
  var logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: function () { return logger; }, __logger: logger };
});

// Mock the DB module: a chainable builder that records every table touched and
// resolves terminal methods deterministically. `state.pendingRows` controls the
// primary pending SELECT (and, by extension, whether the queue is "idle").
jest.mock('../src/db', () => {
  var state = { pendingRows: [] };
  var tableCalls = [];
  function makeBuilder() {
    var builder = {
      whereNull: function () { return builder; },
      where: function () { return builder; },
      andWhere: function () { return builder; },
      orWhere: function () { return builder; },
      orderBy: function () { return builder; },
      limit: function () { return builder; },
      // Terminal methods:
      select: function () { return Promise.resolve(state.pendingRows.slice()); },
      count: function () { return Promise.resolve([{ c: 0 }]); },
      distinct: function () { return Promise.resolve([]); },
      update: function () { return Promise.resolve(state.pendingRows.length ? 1 : 0); },
      del: function () { return Promise.resolve(1); },
      first: function () {
        return Promise.resolve(state.pendingRows.length ? { user_id: 'u1', source: 'test' } : undefined);
      }
    };
    return builder;
  }
  var db = jest.fn(function (table) { tableCalls.push(table); return makeBuilder(); });
  db.raw = jest.fn(function () { return '__RAW__'; });
  db.fn = { now: function () { return 'NOW()'; } };
  db.__state = state;
  db.__tableCalls = tableCalls;
  db.__reset = function () { tableCalls.length = 0; state.pendingRows = []; };
  return db;
});

var db = require('../src/db');
var logger = require('@raike/lib-logger').__logger;
var scheduleQueue = require('../src/scheduler/scheduleQueue');
var { pollOnce, stopPollLoop } = scheduleQueue;

function pollLogCalls() {
  return logger.info.mock.calls.filter(function (c) {
    return typeof c[0] === 'string' && c[0].indexOf('[SCHED-QUEUE] poll:') === 0;
  });
}

beforeAll(function () {
  // Ensure the real poll interval is not running during the unit test.
  stopPollLoop();
});

beforeEach(function () {
  db.__reset();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
});

describe('scheduleQueue.pollOnce — idle-path query short-circuit (999.955)', function () {
  test('idle tick (empty queue) issues ZERO diagnostic queries', async function () {
    db.__state.pendingRows = []; // queue empty → idle path

    await pollOnce();

    // The primary pending SELECT against schedule_queue is expected exactly once.
    var schedQueueCalls = db.__tableCalls.filter(function (t) { return t === 'schedule_queue'; });
    expect(schedQueueCalls.length).toBe(1);

    // The diagnostic queries MUST NOT run on the idle path. On the unfixed code
    // these fire unconditionally, so these assertions are RED pre-fix.
    expect(db.__tableCalls).not.toContain('task_write_queue');
    expect(db.__tableCalls).not.toContain('tasks_v');

    // And the gated diagnostic log never fires when there is no pending work.
    expect(pollLogCalls().length).toBe(0);
  });

  test('non-idle tick (pending work) still gathers diagnostics and logs', async function () {
    db.__state.pendingRows = [{ user_id: 'u1' }]; // one pending user → work exists

    await pollOnce();

    // Behavior preserved: when work exists, the diagnostic queries run and the
    // poll summary log fires with the same shape as before.
    expect(db.__tableCalls).toContain('task_write_queue');
    expect(db.__tableCalls).toContain('tasks_v');

    var logs = pollLogCalls();
    expect(logs.length).toBe(1);
    expect(logs[0][0]).toContain('schedule=');
    expect(logs[0][0]).toContain('writes=');
  });
});
