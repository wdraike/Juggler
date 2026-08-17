/**
 * startupEnqueueActor.test.js — 999.13735
 *
 * server.js calls enqueueScheduleRun(userId, 'startup') from the app.listen
 * callback — OUTSIDE any HTTP request, so expressAuditContext never runs and
 * no AsyncLocalStorage actor context is established.  stampInsert() inside
 * upsertQueueRow calls getActor() which THROWS, the error is caught and
 * logged inside enqueueScheduleRun, and the function returns
 * { enqueued: true } — a LIE.  The queue row is never inserted, so the poll
 * loop never picks up these users for scheduling at startup.
 *
 * This test pins the fix: the startup enqueue path must wrap in runWithActor
 * so the queue row is actually inserted with proper audit attribution.
 *
 * Pure unit test — db fully mocked, same pattern as scheduleQueuePollActor.
 */

jest.mock('../../../src/slices/scheduler/facade', () => ({
  runScheduleAndPersist: jest.fn().mockResolvedValue({ updated: 0, cleared: 0 })
}));
jest.mock('../../../src/lib/sync-lock', () => ({
  withLock: jest.fn(async function (userId, fn) { return fn(); })
}));
jest.mock('../../../src/lib/task-write-queue', () => ({
  flushQueueInLock: jest.fn().mockResolvedValue()
}));
jest.mock('../../../src/lib/sse-emitter', () => ({
  emit: jest.fn()
}));
jest.mock('@raike/lib-logger', () => {
  var logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: function () { return logger; }, __logger: logger };
});

// Chainable knex-like db mock; insert() RECORDS its payload so the test can
// verify the stamped audit columns.
jest.mock('../../../src/db', () => {
  var inserts = [];
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
      select: function () { return builder; },
      whereIn: function () { return builder; },
      insert: function (payload) {
        inserts.push({ table: table, payload: payload });
        builder.__insertPayload = payload;
        return builder;
      },
      onConflict: function () { return builder; },
      merge: function () { return Promise.resolve(0); },
      count: function () { return Promise.resolve([{ c: 0 }]); },
      distinct: function () { return Promise.resolve([]); },
      update: function () { return Promise.resolve(0); },
      del: function () { return Promise.resolve(1); },
      first: function () { return Promise.resolve(undefined); },
      then: function (resolve) { return Promise.resolve(0).then(resolve); }
    };
    return builder;
  }
  var db = jest.fn(function (table) { return makeBuilder(table); });
  db.raw = jest.fn(function () { return '__RAW__'; });
  db.fn = { now: function () { return 'NOW()'; } };
  db.__inserts = inserts;
  db.__reset = function () { inserts.length = 0; };
  return db;
});

var db = require('../../../src/db');
var auditContext = require('../../../src/lib/audit-context');
var scheduleQueue = require('../../../src/scheduler/scheduleQueue');
var { enqueueScheduleRun, _resetForTests } = scheduleQueue;

beforeEach(function () {
  _resetForTests();
  db.__reset();
});

describe('startup enqueue audit actor (999.13735)', function () {

  test('RED: bare enqueueScheduleRun (no actor) swallows stampInsert throw, row NOT inserted, returns enqueued:true', async function () {
    // Simulate the PRODUCTION startup path: no expressAuditContext, no
    // runWithActor, and SUPPRESS the armed test-default actor so getActor()
    // throws exactly as it does in production.
    var result = await auditContext._runWithoutActor(function () {
      return enqueueScheduleRun('test-user-id', 'startup');
    });

    // The function LIES about success.
    expect(result.enqueued).toBe(true);

    // But no queue row was actually inserted — stampInsert threw, the error
    // was caught inside enqueueScheduleRun, and the insert never reached db.
    var queueInserts = db.__inserts.filter(function (i) {
      return i.table === 'schedule_queue';
    });
    expect(queueInserts.length).toBe(0);
  });

  test('GREEN: enqueueScheduleRun wrapped in runWithActor inserts the queue row with audit attribution', async function () {
    // The fix: wrap the startup enqueue in runWithActor('scheduler', ...).
    await auditContext.runWithActor('scheduler', function () {
      return enqueueScheduleRun('test-user-id', 'startup');
    });

    // The queue row must have been inserted.
    var queueInserts = db.__inserts.filter(function (i) {
      return i.table === 'schedule_queue';
    });
    expect(queueInserts.length).toBe(1);

    // The stamped audit columns must be present and non-null.
    var payload = queueInserts[0].payload;
    expect(payload.created_by).toBe('scheduler');
    expect(payload.updated_by).toBe('scheduler');
  });
});