/**
 * 999.591 — per-user scheduler rate limit (unit, no DB).
 *
 * The scheduler enqueue path debounces bursts (2000ms) but did NOT bound how
 * many scheduler RUNS a single user can trigger over time. This suite verifies
 * the sliding-window rate limit (RATE_LIMIT_MAX per RATE_LIMIT_WINDOW_MS per
 * user) via the module's injectable clock so the test never sleeps.
 *
 * DB-free: exercises `_internal.checkRateLimit` directly (the rate-limit
 * decision) and asserts the public `enqueueScheduleRun`, when over the limit,
 * still records the pending recompute (dirty + upsert — elmo WARN-3) and returns
 * { enqueued:true, rateLimited:true } while SUPPRESSING the immediate run — no throw.
 * The DB is mocked so the upsert is a no-op.
 */

'use strict';

// Mock the knex handle so the rate-limited path's upsert is a no-op (no live DB).
// `insert` is a spy (not just a stub) so tests can assert the pending recompute
// row was actually written — the DB row IS the "dirty" record post-999.952
// (the in-memory `_dirty` Set was removed; see scheduleQueue.js history). The
// spy is built and attached to the exported mock function ENTIRELY inside the
// factory (not via an outer closure) — jest.mock() factories run in a scope
// where referencing an out-of-scope variable is unreliable.
jest.mock('../../../src/db', function () {
  var insertSpy = jest.fn(function () { return chain; });
  var chain = {
    insert: insertSpy,
    onConflict: function () { return chain; },
    merge: function () { return Promise.resolve(); }
  };
  var mockDb = function () { return chain; };
  mockDb.__insertSpy = insertSpy;
  return mockDb;
});

var scheduleQueue = require('../../../src/scheduler/scheduleQueue');
var I = scheduleQueue._internal;
var insertSpy = require('../../../src/db').__insertSpy;

var MAX = I.RATE_LIMIT_MAX;          // 10
var WINDOW = I.RATE_LIMIT_WINDOW_MS; // 60000

describe('999.591 scheduler per-user rate limit', function () {
  var clock;

  beforeEach(function () {
    clock = 1000000; // arbitrary fixed epoch
    I.setClock(function () { return clock; });
    I.resetRateLimit();
  });

  afterEach(function () {
    I.setClock(null);    // restore Date.now
    I.resetRateLimit();
  });

  test('first RATE_LIMIT_MAX enqueues in a window pass; the next is rate-limited', function () {
    for (var i = 0; i < MAX; i++) {
      expect(I.checkRateLimit('u1')).toBe(true);
    }
    // (MAX+1)th within the same window → rejected.
    expect(I.checkRateLimit('u1')).toBe(false);
    // Still rejected on further attempts within the window.
    expect(I.checkRateLimit('u1')).toBe(false);
  });

  test('the limit is per-user (a second user is unaffected)', function () {
    for (var i = 0; i < MAX; i++) { I.checkRateLimit('u1'); }
    expect(I.checkRateLimit('u1')).toBe(false); // u1 exhausted
    expect(I.checkRateLimit('u2')).toBe(true);  // u2 fresh
  });

  test('after the window elapses, the user passes again', function () {
    for (var i = 0; i < MAX; i++) { expect(I.checkRateLimit('u1')).toBe(true); }
    expect(I.checkRateLimit('u1')).toBe(false); // exhausted

    // Advance past the window — all prior timestamps expire.
    clock += WINDOW + 1;
    expect(I.checkRateLimit('u1')).toBe(true);

    // And a fresh full allowance is available again.
    for (var j = 1; j < MAX; j++) { expect(I.checkRateLimit('u1')).toBe(true); }
    expect(I.checkRateLimit('u1')).toBe(false);
  });

  test('sliding window: a single old hit aging out frees exactly one slot', function () {
    // First hit at t0.
    expect(I.checkRateLimit('u1')).toBe(true);
    // Advance a little, fill the rest of the window.
    clock += 1000;
    for (var i = 1; i < MAX; i++) { expect(I.checkRateLimit('u1')).toBe(true); }
    expect(I.checkRateLimit('u1')).toBe(false); // full

    // Advance just past the FIRST hit's expiry (but not the others') → 1 slot frees.
    clock += (WINDOW - 1000) + 1;
    expect(I.checkRateLimit('u1')).toBe(true);  // one slot freed
    expect(I.checkRateLimit('u1')).toBe(false); // and immediately full again
  });

  test('over-limit enqueue still records the recompute and returns rateLimited:true (WARN-3) — no throw', async function () {
    insertSpy.mockClear();
    // Exhaust the window for this user via the public path's checker.
    for (var i = 0; i < MAX; i++) { I.checkRateLimit('rl-user'); }
    // The (MAX+1)th public enqueue is rate-limited: it must NOT drop the pending
    // recompute — it still upserts the schedule_queue row (mocked) and reports
    // rateLimited:true, never throwing.
    var result = await scheduleQueue.enqueueScheduleRun('rl-user', 'test:rate-limit');
    expect(result).toEqual({ enqueued: true, rateLimited: true });
    // The pending recompute IS recorded (poll loop will pick it up). Post-999.952
    // the DB row is the sole "dirty" record (the in-memory _dirty Set was removed).
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'rl-user' }));
  });

  test('a rate-limited enqueue with options.immediate does NOT throw (immediate suppressed)', async function () {
    insertSpy.mockClear();
    for (var i = 0; i < MAX; i++) { I.checkRateLimit('rl-imm'); }
    // immediate:true would normally trigger processUser; while rate-limited it is
    // suppressed (shouldRun = immediate && !rateLimited === false). Result is still
    // the rate-limited contract and no throw escapes.
    var result = await scheduleQueue.enqueueScheduleRun('rl-imm', 'test:rate-limit', { immediate: true });
    expect(result).toEqual({ enqueued: true, rateLimited: true });
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'rl-imm' }));
  });
});
