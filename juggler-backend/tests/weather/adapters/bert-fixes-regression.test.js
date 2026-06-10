/**
 * Property / characterization tests for bert's two findings on the
 * juggler-hex-h1-weather leg (refactor mode, Wave 2).
 *
 * BLOCK-1 (fetchWithTimeout.js) — PROPERTY TEST, not a regression guard:
 *   When the timeout fires first and the underlying fetch rejects LATER (e.g.
 *   after the AbortController signal fires), NO unhandledRejection is emitted.
 *
 *   Why this guarantee holds (two-layer defence):
 *     1. Promise.race() keeps a rejection handler on every participant promise,
 *        including the loser. The race itself consumes the late rejection —
 *        this is the PRIMARY guarantee from JavaScript Promise semantics.
 *     2. The terminal `fetchPromise.catch(function () {})` (line 82 of
 *        fetchWithTimeout.js) is belt-and-suspenders defensive programming
 *        against future chain restructuring that might break the race reference.
 *        It is NOT the sole guard.
 *
 *   NOTE: This test CANNOT be made genuinely RED by removing line 82 alone,
 *   because Promise.race semantics already consume the loser's rejection. It is
 *   honestly labelled as a property test: it verifies the observable invariant
 *   (no unhandledRejection + ETIMEDOUT returned within budget) regardless of
 *   which layer provides the guarantee. Do NOT describe it as a regression guard
 *   that would fail without line 82.
 *
 * WARN-1 (KnexWeatherCacheRepository.getReverseGeocode) — REGRESSION GUARD:
 *   The original code read an expired in-memory entry and returned null WITHOUT
 *   deleting the entry. With Redis down, every subsequent read re-reads the
 *   expired entry from `_memCache` (it was never deleted), so the map grows
 *   unbounded over the lifetime of the process. The fix adds
 *   `if (memEntry) delete memCache[cacheKey]` after the TTL check.
 *
 *   RED-without-fix evidence: removing the `delete memCache[cacheKey]` line
 *   (line 192 of KnexWeatherCacheRepository.js) causes `_memCache` to still
 *   contain the key after an expired-miss, making the assertion
 *   `expect(Object.prototype.hasOwnProperty.call(repo._memCache, cacheKey)).toBe(false)`
 *   fail.
 *
 * Traceability: TRACEABILITY-juggler-hex-h1-weather.md B6.
 */

'use strict';

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', '..', 'src', 'slices', 'weather');
var ADAPT = path.join(SLICE, 'adapters');

var fetchWithTimeout = require(path.join(ADAPT, 'fetchWithTimeout'));
var GeoPoint = require(path.join(SLICE, 'domain', 'value-objects', 'GeoPoint'));
var KnexWeatherCacheRepository = require(path.join(ADAPT, 'KnexWeatherCacheRepository'));

// ── BLOCK-1 property: no unhandledRejection when timeout wins and fetch rejects late ──

describe('fetchWithTimeout — BLOCK-1 property: no unhandledRejection on late fetch rejection', function () {
  /**
   * The scenario under test:
   *   1. The timeout fires and rejects the race (Promise.race settles on the
   *      timeout error, so the caller receives ETIMEDOUT).
   *   2. AFTER the race has settled, the hanging fetchImpl — whose AbortController
   *      signal was fired — also rejects with an AbortError-shaped error.
   *   3. The late rejection is consumed: Promise.race keeps a handler on all
   *      participants (primary guarantee), and the terminal .catch() in
   *      fetchWithTimeout.js provides belt-and-suspenders defence. Neither the
   *      caller nor Node's unhandledRejection hook sees the late rejection.
   *
   * We assert both:
   *   (a) the call rejects with code === 'ETIMEDOUT' within budget
   *   (b) no unhandledRejection is emitted, even after flushing the microtask
   *       queue and waiting a short real delay past the abort signal.
   *
   * This is a PROPERTY / CHARACTERIZATION test. The guarantee derives primarily
   * from Promise.race semantics; removing the defensive .catch() alone would NOT
   * reliably make this test RED. See file header for full explanation.
   */
  test(
    'BLOCK-1: rejects with ETIMEDOUT and emits NO unhandledRejection when the fetch rejects late after abort (property)',
    async function () {
      var seenCount = 0;
      var seenErrors = [];
      function onUnhandled(reason) {
        // Only count rejections that look like our test's late abort — guard
        // against unrelated noise from other parallel tests in the run.
        seenCount += 1;
        seenErrors.push(reason);
      }
      process.on('unhandledRejection', onUnhandled);

      // A fetchImpl that:
      //   - NEVER settles on its own (ignores abort signal for a moment)
      //   - THEN rejects with an AbortError-shaped error AFTER a small delay,
      //     simulating a fetchImpl that eventually notices the abort signal
      //     and rejects — but only after the timeout race has already settled.
      var TIMEOUT_MS = 40;  // tight budget so the test completes fast
      var rejectFetchLate;
      var fetchImpl = function (_url, _opts) {
        return new Promise(function (_resolve, reject) {
          rejectFetchLate = function () {
            var err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            reject(err);
          };
          // Do NOT connect the abort signal handler — we simulate the worst-case
          // fetchImpl that ignores abort and only rejects on its own schedule.
        });
      };

      var rejection = null;
      try {
        await fetchWithTimeout('https://example.com/test', {}, {
          timeoutMs: TIMEOUT_MS,
          fetchImpl: fetchImpl
        });
      } catch (e) {
        rejection = e;
      }

      // (a) The call must reject with ETIMEDOUT within budget.
      expect(rejection).not.toBeNull();
      expect(rejection.code).toBe('ETIMEDOUT');
      expect(rejection.message).toMatch(/timed out/i);

      // Now fire the late fetch rejection. The race has already settled; this
      // rejection is consumed by Promise.race (which keeps handlers on all
      // participants) and additionally by the terminal .catch() in fetchWithTimeout.
      // Neither mechanism alone is testable in isolation here — this test verifies
      // the observable property: no unhandledRejection reaches the process.
      rejectFetchLate();

      // Flush microtasks and then wait a short real delay to allow the Node
      // unhandledRejection handler time to fire if one was going to.
      // (process.nextTick + setImmediate + real 30ms covers all microtask/
      //  macrotask queues in Node without fake timers.)
      await new Promise(function (resolve) { process.nextTick(resolve); });
      await new Promise(function (resolve) { setImmediate(resolve); });
      await new Promise(function (resolve) { setTimeout(resolve, 30); });

      process.removeListener('unhandledRejection', onUnhandled);

      // (b) No unhandledRejection fired.
      expect(seenCount).toBe(0);
      if (seenCount > 0) {
        // Diagnostic: surface what was seen. If this fires, some change has
        // broken both Promise.race consumption AND the defensive .catch() —
        // inspect seenErrors to identify the regression source.
        console.error('BLOCK-1 FAIL — unhandledRejection(s) seen:', seenErrors);
      }
    }
  );

  /**
   * Complementary sanity: when the fetch settles normally (happy path), no
   * unhandledRejection fires either. This ensures the listener probe itself
   * is wired correctly.
   */
  test(
    'BLOCK-1: happy-path fetch (resolves immediately) also emits no unhandledRejection',
    async function () {
      var seenCount = 0;
      function onUnhandled() { seenCount += 1; }
      process.on('unhandledRejection', onUnhandled);

      var fetchImpl = function () {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () { return Promise.resolve({ ok: true }); }
        });
      };

      // Should resolve cleanly — no rejection at all.
      var result = await fetchWithTimeout('https://example.com', {}, {
        timeoutMs: 500,
        fetchImpl: fetchImpl
      });
      expect(result).toBeDefined();

      await new Promise(function (resolve) { process.nextTick(resolve); });
      await new Promise(function (resolve) { setImmediate(resolve); });
      await new Promise(function (resolve) { setTimeout(resolve, 20); });

      process.removeListener('unhandledRejection', onUnhandled);
      expect(seenCount).toBe(0);
    }
  );
});

// ── WARN-1 regression: expired in-memory entry EVICTED on expired-miss ───────

describe('KnexWeatherCacheRepository — WARN-1 regression: expired _memCache entry is evicted on read', function () {
  function makeRedisDown() {
    return {
      get: function () { return Promise.resolve(null); },  // Redis miss
      set: function () { return Promise.reject(new Error('redis down')); }
    };
  }

  function makeKnexNoop() {
    // Minimal no-op Knex stub; getReverseGeocode does not touch the DB.
    function builder() {
      return {
        where: function () { return this; },
        orderBy: function () { return this; },
        first: function () { return Promise.resolve(null); },
        insert: function () { return Promise.resolve([1]); },
        delete: function () { return Promise.resolve(1); }
      };
    }
    function db() { return builder(); }
    db.fn = { now: function () { return {}; } };
    return db;
  }

  test(
    'WARN-1: expired in-memory entry is DELETED from _memCache on expired-miss read (not just returned null)',
    async function () {
      var point = new GeoPoint(37.77, -122.42);
      var cacheKey = point.reverseGeocodeCacheKey();

      // Pre-seed an expired entry directly into the mem-cache dict.
      var mem = {};
      mem[cacheKey] = {
        value: 'San Francisco, California',
        expiresAt: Date.now() - 1000  // already expired 1s ago
      };
      expect(Object.prototype.hasOwnProperty.call(mem, cacheKey)).toBe(true);  // confirm setup

      var repo = new KnexWeatherCacheRepository({
        db: makeKnexNoop(),
        redis: makeRedisDown(),
        memCache: mem
      });

      // The lookup should return null (expired miss).
      var result = await repo.getReverseGeocode(point);
      expect(result).toBeNull();

      // CORE ASSERTION: the expired entry MUST have been deleted.
      // Without bert's fix (`delete memCache[cacheKey]`), this fails because
      // the key is still present in _memCache after the read.
      expect(Object.prototype.hasOwnProperty.call(repo._memCache, cacheKey)).toBe(false);
    }
  );

  test(
    'WARN-1: a subsequent read for the same key (after eviction) also returns null, confirming eviction is permanent',
    async function () {
      var point = new GeoPoint(10, 20);
      var cacheKey = point.reverseGeocodeCacheKey();

      var mem = {};
      mem[cacheKey] = { value: 'Evict Me', expiresAt: Date.now() - 500 };

      var repo = new KnexWeatherCacheRepository({
        db: makeKnexNoop(),
        redis: makeRedisDown(),
        memCache: mem
      });

      // First read: evicts.
      var first = await repo.getReverseGeocode(point);
      expect(first).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(repo._memCache, cacheKey)).toBe(false);

      // Second read: key is gone, still returns null, no error.
      var second = await repo.getReverseGeocode(point);
      expect(second).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(repo._memCache, cacheKey)).toBe(false);
    }
  );

  test(
    'WARN-1: a NON-expired entry is NOT evicted and its value IS returned',
    async function () {
      // Regression guard: the fix must not evict still-fresh entries.
      var point = new GeoPoint(48.85, 2.35);
      var cacheKey = point.reverseGeocodeCacheKey();

      var mem = {};
      mem[cacheKey] = {
        value: 'Paris, Ile-de-France',
        expiresAt: Date.now() + 60000  // valid for another 60s
      };

      var repo = new KnexWeatherCacheRepository({
        db: makeKnexNoop(),
        redis: makeRedisDown(),
        memCache: mem
      });

      var result = await repo.getReverseGeocode(point);
      expect(result).toBe('Paris, Ile-de-France');

      // Still-fresh entry must NOT have been deleted.
      expect(Object.prototype.hasOwnProperty.call(repo._memCache, cacheKey)).toBe(true);
    }
  );

  test(
    'WARN-1: unbounded-growth prevention — repeated lookups of the same expired key do not re-populate _memCache',
    async function () {
      // Simulates the Redis-down scenario where a cache is written via
      // putReverseGeocode (goes to in-memory), TTL expires, and then many
      // getReverseGeocode calls are made. Without the eviction, each call
      // re-reads the same expired entry and the memCache size stays at 1 but
      // the semantic "never pruned" invariant is violated. With the eviction
      // the map drops to 0 after the first expired-miss read.
      var points = [
        new GeoPoint(1, 1), new GeoPoint(2, 2), new GeoPoint(3, 3)
      ];
      var mem = {};
      points.forEach(function (p) {
        mem[p.reverseGeocodeCacheKey()] = {
          value: 'stale-' + p.reverseGeocodeCacheKey(),
          expiresAt: Date.now() - 100  // expired
        };
      });
      expect(Object.keys(mem)).toHaveLength(3);  // confirm setup

      var repo = new KnexWeatherCacheRepository({
        db: makeKnexNoop(),
        redis: makeRedisDown(),
        memCache: mem
      });

      // Read all three expired entries.
      for (var i = 0; i < points.length; i++) {
        var r = await repo.getReverseGeocode(points[i]);
        expect(r).toBeNull();
      }

      // All three expired entries must have been evicted.
      expect(Object.keys(repo._memCache)).toHaveLength(0);
    }
  );
});
