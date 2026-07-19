/**
 * scheduleQueuePollActor.test.js — 999.1576 inc.4a (strict-flip precondition:
 * timer-spawned writers carry an audit actor).
 *
 * pollOnce() runs on a module-level setInterval (startPollLoop) — OUTSIDE any
 * AsyncLocalStorage context. Its stuck-claim sweep is a stamped UPDATE against
 * schedule_queue (SchedulerQueueRepository.sweepStuckClaims uses stampUpdate),
 * so an unwrapped poll tick writes updated_by = NULL today and would THROW
 * under the inc.4 strict getActor flip. This pin asserts the poll tick runs
 * under the 'scheduler' identity end-to-end: the sweep UPDATE payload must
 * carry updated_by 'scheduler' (captured through the real repo + stampUpdate,
 * not a mock of the stamper).
 *
 * Pure unit test — db fully mocked, same double set as scheduleQueuePollIdle.
 */

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
jest.mock('@raike/lib-logger', () => {
  var logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: function () { return logger; }, __logger: logger };
});

// Chainable knex-like db mock; update() RECORDS its payload per table so the
// test can inspect the stamped sweep write.
jest.mock('../src/db', () => {
  var state = { pendingRows: [] };
  var updates = [];
  function makeBuilder(table) {
    var builder = {
      whereNull: function () { return builder; },
      where: function () { return builder; },
      andWhere: function () { return builder; },
      orWhere: function () { return builder; },
      whereNotNull: function () { return builder; },
      whereRaw: function () { return builder; },
      orderBy: function () { return builder; },
      limit: function () { return builder; },
      select: function () { return Promise.resolve(state.pendingRows.slice()); },
      count: function () { return Promise.resolve([{ c: 0 }]); },
      distinct: function () { return Promise.resolve([]); },
      update: function (payload) {
        updates.push({ table: table, payload: payload });
        return Promise.resolve(0);
      },
      del: function () { return Promise.resolve(1); },
      first: function () { return Promise.resolve(undefined); }
    };
    return builder;
  }
  var db = jest.fn(function (table) { return makeBuilder(table); });
  db.raw = jest.fn(function () { return '__RAW__'; });
  db.fn = { now: function () { return 'NOW()'; } };
  db.__state = state;
  db.__updates = updates;
  db.__reset = function () { updates.length = 0; state.pendingRows = []; };
  return db;
});

var db = require('../src/db');
var scheduleQueue = require('../src/scheduler/scheduleQueue');
var { pollOnce, stopPollLoop } = scheduleQueue;

beforeAll(function () {
  stopPollLoop();
});

beforeEach(function () {
  db.__reset();
});

describe('scheduleQueue.pollOnce — audit actor on the poll tick (999.1576 inc.4a)', function () {
  test('stuck-claim sweep UPDATE is stamped with the scheduler identity', async function () {
    db.__state.pendingRows = []; // idle path → straight to the sweep

    await pollOnce();

    var sweepUpdates = db.__updates.filter(function (u) { return u.table === 'schedule_queue'; });
    expect(sweepUpdates.length).toBe(1);
    var payload = sweepUpdates[0].payload;
    // The sweep's own fields, untouched:
    expect(payload.claimed_by).toBe(null);
    expect(payload.claimed_at).toBe(null);
    // The inc.4a pin: the module-level poll timer must carry the 'scheduler'
    // actor so stampUpdate attributes the write (NULL here = strict-flip throw).
    expect(payload.updated_by).toBe('scheduler');
  });
});
