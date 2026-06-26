/**
 * 999.869 — scheduleQueue cross-suite test-isolation reset (unit, no DB).
 *
 * Defect: scheduleQueue carries module-level state across runInBand suites — a
 * live poll loop, leaked claim-heartbeat intervals, the cached _queueBackend
 * (which a neighbouring suite's jest.resetModules() can leave pointing at a torn-
 * down module whose isCloudTasks is no longer a function), and the in-memory
 * dirty / running / rate-limit maps. The prior per-file teardown called only
 * stopPollLoop(), which stops the poll interval but leaves ALL the other state
 * behind, so it bleeds into later files.
 *
 * This suite pins the contract of the real fix — `_resetForTests()` — as a FULL
 * shutdown: after it runs the module is indistinguishable from a fresh require.
 * The assertions are behavioural (state is dirty BEFORE, clean AFTER), so a no-op
 * stub would fail; they are not satisfied by the old stopPollLoop-only teardown.
 *
 * DB-free: the knex handle is mocked so no live connection is needed.
 */

'use strict';

// Mock the knex handle so any enqueue upsert on the post-reset path is a no-op.
jest.mock('../../../src/db', function () {
  var chain = {
    insert: function () { return chain; },
    onConflict: function () { return chain; },
    merge: function () { return Promise.resolve(); },
    where: function () { return chain; },
    del: function () { return Promise.resolve(0); }
  };
  return function () { return chain; };
});

var scheduleQueue = require('../../../src/scheduler/scheduleQueue');
var I = scheduleQueue._internal;

describe('999.869 scheduleQueue._resetForTests — full cross-suite shutdown', function () {
  afterEach(function () {
    // Always leave the module clean for the next test, even if an assertion threw.
    if (typeof scheduleQueue._resetForTests === 'function') scheduleQueue._resetForTests();
  });

  test('exposes a _resetForTests shutdown seam', function () {
    // RED on the unfixed build: the seam does not exist, so the per-file teardown
    // could only stopPollLoop() and never clear the leaked state below.
    expect(typeof scheduleQueue._resetForTests).toBe('function');
  });

  test('clears the poll loop AND the in-memory state that stopPollLoop leaves behind', function () {
    // Arrange: drive the module into the exact "dirty" shape a real suite leaves —
    // a running poll loop, pending dirty/running entries, AND a saturated per-user
    // rate-limit window. Every precondition is OBSERVABLY perturbed before reset so
    // the AFTER assertions are non-vacuous (a no-op stub fails them).
    scheduleQueue.startPollLoop();
    scheduleQueue._dirty.add('leaked-user-a');
    scheduleQueue._dirty.add('leaked-user-b');
    scheduleQueue._running.set('leaked-user-a', Promise.resolve());
    // Saturate the rate-limit window for a user (RATE_LIMIT_MAX hits) so the NEXT
    // checkRateLimit returns false — a real, observable piece of _rateWindows state.
    for (var i = 0; i < I.RATE_LIMIT_MAX; i++) I.checkRateLimit('leaked-user-a');
    expect(I.checkRateLimit('leaked-user-a')).toBe(false); // window is saturated (perturbed)

    var before = scheduleQueue.getPollLoopState();
    expect(before.active).toBe(true);          // poll loop is live
    expect(before.dirtyCount).toBe(2);         // dirty set populated
    expect(before.runningCount).toBe(1);       // running map populated

    // Act
    scheduleQueue._resetForTests();

    // Assert: a no-op stub or a stopPollLoop-only teardown would leave dirtyCount /
    // runningCount > 0 and the rate window saturated — the fix must zero ALL of it.
    var after = scheduleQueue.getPollLoopState();
    expect(after.active).toBe(false);          // poll loop stopped
    expect(after.dirtyCount).toBe(0);          // dirty set cleared
    expect(after.runningCount).toBe(0);        // running map cleared
    // The rate-limit window was cleared: the same user is allowed again. This FAILS
    // if _resetForTests does not clear _rateWindows (the assertion is non-vacuous —
    // it was provably false immediately before the reset).
    expect(I.checkRateLimit('leaked-user-a')).toBe(true);
  });

  test('is idempotent — calling it on an already-clean module is a harmless no-op', function () {
    scheduleQueue._resetForTests();
    expect(function () { scheduleQueue._resetForTests(); }).not.toThrow();
    var state = scheduleQueue.getPollLoopState();
    expect(state.active).toBe(false);
    expect(state.dirtyCount).toBe(0);
  });

  test('after reset, the next enqueue still works — the dropped backend cache re-resolves (no isCloudTasks crash)', async function () {
    // Simulate the cross-suite race aftermath: reset drops the cached _queueBackend,
    // so the next getQueueBackend() must re-resolve a VALID backend rather than a
    // stale binding from a torn-down module. A synchronous enqueue must not throw
    // "backend.isCloudTasks is not a function" and must return the legacy shape.
    scheduleQueue._resetForTests();
    var ret = await scheduleQueue.enqueueScheduleRun('post-reset-user', 'test', { immediate: false });
    expect(ret).toEqual(expect.objectContaining({ enqueued: true, rateLimited: false }));
  });

  test('a stale half-loaded cached backend is re-resolved on the next enqueue (defensive guard, isCloudTasks-race)', async function () {
    // Reproduce the cross-suite race DIRECTLY (not just the undefined-cache branch):
    // a neighbour's jest.resetModules() left `_queueBackend` pointing at a half-loaded
    // module whose isCloudTasks is NOT a function. The defensive re-resolve in
    // getQueueBackend() must replace it with a valid backend, and the enqueue call-site
    // guard must not throw "backend.isCloudTasks is not a function".
    I.setQueueBackendForTests({}); // truthy but missing isCloudTasks (the stale binding)
    expect(typeof I.getQueueBackendForTests().isCloudTasks).not.toBe('function'); // precondition

    var ret = await scheduleQueue.enqueueScheduleRun('stale-backend-user', 'test', { immediate: false });

    // No throw, legacy shape preserved...
    expect(ret).toEqual(expect.objectContaining({ enqueued: true, rateLimited: false }));
    // ...AND the cache was actually re-resolved to a valid backend. This FAILS if the
    // `typeof _queueBackend.isCloudTasks !== 'function'` half of the guard is removed
    // (the stale `{}` would survive) — so the assertion pins the defensive re-resolve,
    // not merely the undefined-cache path.
    expect(typeof I.getQueueBackendForTests().isCloudTasks).toBe('function');
  });
});
