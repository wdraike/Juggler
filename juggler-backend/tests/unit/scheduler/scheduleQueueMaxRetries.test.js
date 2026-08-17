/**
 * 999.15799 — claimAndRun error path must not infinite-loop (unit, no DB).
 *
 * Defect: the catch block in claimAndRunInner calls releaseClaim (unclaims the
 * row) but NOT dequeueScheduleRun (deletes the row). The released row matches
 * the poll loop's getPendingQueueUsers query on the next tick, so a persistently
 * failing scheduler re-claims and re-runs every ~3s indefinitely.
 *
 * Fix: after MAX_RUN_FAILURES consecutive failures for a user, call
 * dequeueScheduleRun (deletes the row) instead of releaseClaim (unclaims it),
 * breaking the cycle. On success the counter resets.
 *
 * DB-free: exercises the failure-counting internal seams directly.
 */

'use strict';

// Mock knex so any DB path is a no-op.
jest.mock('../../../src/db', function () {
  var chain = {
    insert: function () { return chain; },
    onConflict: function () { return chain; },
    merge: function () { return Promise.resolve(); },
    where: function () { return chain; },
    del: function () { return Promise.resolve(0); },
    update: function () { return Promise.resolve(1); },
    first: function () { return Promise.resolve(null); },
    select: function () { return Promise.resolve([]); },
    orderBy: function () { return chain; },
    limit: function () { return chain; },
    count: function () { return Promise.resolve([{ c: 0 }]); },
    distinct: function () { return Promise.resolve([]); },
    raw: function (sql) { return sql; }
  };
  var mockDb = function () { return chain; };
  mockDb.fn = { now: function () { return new Date(); } };
  return mockDb;
});

var scheduleQueue = require('../../../src/scheduler/scheduleQueue');
var I = scheduleQueue._internal;

describe('999.15799 claimAndRun max consecutive failures prevents infinite retry loop', function () {

  afterEach(function () {
    scheduleQueue._resetForTests();
  });

  test('exports MAX_RUN_FAILURES constant (positive integer)', function () {
    expect(typeof I.MAX_RUN_FAILURES).toBe('number');
    expect(Number.isInteger(I.MAX_RUN_FAILURES)).toBe(true);
    expect(I.MAX_RUN_FAILURES).toBeGreaterThan(0);
  });

  test('recordRunFailure increments the per-user failure counter', function () {
    var userId = '__fail_user_1__';
    expect(I.getFailureCount(userId)).toBe(0);
    I.recordRunFailure(userId);
    expect(I.getFailureCount(userId)).toBe(1);
    I.recordRunFailure(userId);
    expect(I.getFailureCount(userId)).toBe(2);
  });

  test('resetFailureCount clears the per-user counter', function () {
    var userId = '__fail_user_2__';
    I.recordRunFailure(userId);
    I.recordRunFailure(userId);
    expect(I.getFailureCount(userId)).toBe(2);
    I.resetFailureCount(userId);
    expect(I.getFailureCount(userId)).toBe(0);
  });

  test('recordRunFailure returns true when the limit is reached (caller should dequeue, not release)', function () {
    var userId = '__fail_user_3__';
    var max = I.MAX_RUN_FAILURES;
    for (var i = 0; i < max - 1; i++) {
      var reached = I.recordRunFailure(userId);
      expect(reached).toBe(false);
    }
    // The MAX_RUN_FAILURES-th failure returns true — signal to dequeue.
    var finalResult = I.recordRunFailure(userId);
    expect(finalResult).toBe(true);
  });

  test('successful run resets the failure counter (counter does not persist after success)', function () {
    var userId = '__fail_user_4__';
    I.recordRunFailure(userId);
    I.recordRunFailure(userId);
    expect(I.getFailureCount(userId)).toBe(2);
    // Simulate a successful run resetting the counter.
    I.resetFailureCount(userId);
    expect(I.getFailureCount(userId)).toBe(0);
    // Next failure starts from 1 again, not 3.
    I.recordRunFailure(userId);
    expect(I.getFailureCount(userId)).toBe(1);
  });

  test('_resetForTests clears all failure counts', function () {
    I.recordRunFailure('__persist_a__');
    I.recordRunFailure('__persist_b__');
    expect(I.getFailureCount('__persist_a__')).toBe(1);
    scheduleQueue._resetForTests();
    expect(I.getFailureCount('__persist_a__')).toBe(0);
    expect(I.getFailureCount('__persist_b__')).toBe(0);
  });

  test('failure counts are per-user (one user hitting the limit does not affect another)', function () {
    var max = I.MAX_RUN_FAILURES;
    for (var i = 0; i < max; i++) {
      I.recordRunFailure('__user_x__');
    }
    expect(I.getFailureCount('__user_x__')).toBe(max);
    expect(I.getFailureCount('__user_y__')).toBe(0);
    I.recordRunFailure('__user_y__');
    expect(I.getFailureCount('__user_y__')).toBe(1);
  });
});
