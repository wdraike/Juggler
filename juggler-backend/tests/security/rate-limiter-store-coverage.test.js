'use strict';

/**
 * BUG-953 (jug953) — every rate limiter in app.js must use the Redis-backed
 * shared store via maybeRedisStore(), never the express-rate-limit DEFAULT
 * in-memory store.
 *
 * On Cloud Run (N instances), a limiter constructed WITHOUT `store:` falls
 * back to express-rate-limit's per-process MemoryStore. Each instance then
 * enforces the cap independently, so the EFFECTIVE ceiling for a caller who
 * lands on different instances is N x the intended max — silently defeating
 * brute-force protection. Six of the eight limiters in app.js already pass
 * `store: maybeRedisStore('<prefix>:')`; `featureServiceLimiter` (guards
 * /api/feature-catalog + /api/feature-events) and `writeRateLimiter` (the
 * per-user write limiter on /api/tasks, /api/config, /api/projects,
 * /api/locations, /api/tools, /api/weather, /api/push) currently do not.
 *
 * Seam: spy on the REAL maybeRedisStore (jest.requireActual + jest.fn wrapper)
 * so we observe exactly which prefixes app.js wires it with when REDIS_URL is
 * set, without needing the DB or a real Redis connection (ioredis is mocked).
 * This is a pure unit test — no test-bed / DB required.
 *
 * RED (pre-fix): featureServiceLimiter and writeRateLimiter are constructed
 * with NO `store` option at all, so maybeRedisStore is never invoked with
 * 'jugrl-feature:' or 'jugrl-write:' — those two assertions fail.
 * GREEN (post-fix, bert): app.js passes
 *   store: maybeRedisStore('jugrl-feature:')   // featureServiceLimiter
 *   store: maybeRedisStore('jugrl-write:')     // writeRateLimiter
 *
 * Test 3 (zoe WARN, jug953 re-review): the original test 3 named itself
 * "all 8 known limiters ... none falls back to the per-instance default
 * store" but only checked that 8 HARDCODED prefixes were each present in the
 * maybeRedisStore call log — it never actually enforced "no limiter exists
 * without a store". A future limiter added in app.js with no `store:` option
 * at all would never call maybeRedisStore (so it wouldn't show up missing
 * from the prefix list either) and would slip through silently. The 9th
 * limiter that already lives outside the hardcoded list, `clientErrorLimiter`
 * ('jugrl-cerr:', added 999.451), is proof the list rots.
 *
 * Fix: spy on the `express-rate-limit` factory itself (the thing app.js's
 * `rateLimit` const AND its one inline `require('express-rate-limit')(...)`
 * call both resolve to — same cached module instance either way) and record,
 * for every invocation anywhere in the require graph, the options object AND
 * the immediate call-site file (via the call stack). Then assert that EVERY
 * invocation whose call site is app.js itself passed a defined `store`. This
 * is real enforcement — it does not name prefixes, so any future limiter
 * constructed directly in app.js without a store fails it, regardless of name.
 *
 * Scope note: app.js's require graph also pulls in schedule.routes.js
 * (schedulerLimiter/debugLimiter/stepperLimiter) and ai.routes.js
 * (aiLimiter), which also call the same `express-rate-limit` factory.
 * schedulerLimiter/debugLimiter/stepperLimiter are DOCUMENTED as
 * intentionally per-instance ("Category 4f", src/routes/schedule.routes.js)
 * — they are not part of BUG-953's "every app.js limiter" claim, so the
 * call-site filter below deliberately scopes to app.js's OWN construction
 * sites only, not the whole require graph.
 */

process.env.NODE_ENV = 'test';

describe('BUG-953 — all app.js rate limiters use a Redis-backed store (no per-instance limiter)', function() {
  var maybeRedisStoreSpy;
  var rateLimitCallSites; // [{ options, callerFile }] — every express-rate-limit factory invocation
  var path = require('path');
  var APP_JS_FILE = path.resolve(__dirname, '../../src/app.js');
  var THIS_TEST_FILE = __filename;

  // Returns the file path of the first stack frame that isn't inside this
  // test file (i.e. skips the spy wrapper's own frame and lands on the real
  // call site, whether that's app.js, schedule.routes.js, or ai.routes.js).
  function callerFileFromStack(stack) {
    var lines = (stack || '').split('\n').slice(1); // drop the "Error" header line
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/\((.*):\d+:\d+\)\s*$/) || lines[i].match(/at (.*):\d+:\d+\s*$/);
      if (!m) continue;
      var file = m[1];
      if (file.indexOf(THIS_TEST_FILE) !== -1) continue; // skip frames inside this spy
      return file;
    }
    return null;
  }

  beforeAll(function() {
    jest.resetModules();

    // Exercise the "Redis configured" branch of maybeRedisStore (the function
    // returns `undefined` — i.e. never even tries to wire a store — when
    // REDIS_URL is unset, which would make every limiter look identical
    // (no store) regardless of whether app.js passes one. Setting REDIS_URL
    // is what makes "was maybeRedisStore() called with this prefix" a
    // meaningful, fix-distinguishing signal.)
    process.env.REDIS_URL = 'redis://localhost:6379';

    // Mock ioredis so maybeRedisStore's internal redisLib.getClient() never
    // attempts a real TCP connection (mirrors tests/aiRateLimiter.test.js's
    // existing pattern for the same module).
    jest.doMock('ioredis', function() {
      return function IORedisMock() {
        return {
          status: 'connecting',
          call: jest.fn(),
          on: jest.fn(function() { return this; }),
        };
      };
    });

    // Spy on the REAL implementation (not a stub) so the lazy-store wrapper
    // it returns still behaves correctly for express-rate-limit's init() /
    // increment() calls during app.js's module-load-time `rateLimit({...})`
    // construction — we only want to observe the CALL ARGS (the prefix),
    // not replace the behavior.
    var realModule = jest.requireActual('../../src/lib/rate-limit-store');
    maybeRedisStoreSpy = jest.fn(realModule.maybeRedisStore);
    jest.doMock('../../src/lib/rate-limit-store', function() {
      return { maybeRedisStore: maybeRedisStoreSpy };
    });

    // Spy on the REAL express-rate-limit factory the same way: wrap it so it
    // still constructs working middleware (app.js/route files need real
    // limiter instances), but record every invocation's options object + the
    // call-site file (test 3 below uses this to find app.js's OWN limiter
    // constructions, independent of prefix names).
    rateLimitCallSites = [];
    var realRateLimit = jest.requireActual('express-rate-limit');
    function rateLimitFactorySpy(options) {
      var stack = (new Error()).stack;
      rateLimitCallSites.push({ options: options, callerFile: callerFileFromStack(stack) });
      return realRateLimit.apply(null, arguments);
    }
    Object.keys(realRateLimit).forEach(function(k) { rateLimitFactorySpy[k] = realRateLimit[k]; });
    jest.doMock('express-rate-limit', function() { return rateLimitFactorySpy; });

    // require app.js fresh under the mocks above. app.js builds ALL eight
    // module-level rateLimit(...) limiters synchronously at require time
    // (apiLimiter, aiLimiter, mcpLimiter, oauthCallbackLimiter,
    // billingWebhookLimiter, healthLimiter, featureServiceLimiter,
    // writeRateLimiter) — no DB/network call is needed to observe the
    // maybeRedisStore call sites (existing tests/security/rate-limits.test.js
    // and tests/unit/app.test.js already require app.js directly in this
    // suite without DB mocking; health-style routes tolerate an unreachable
    // DB at request time, not require time).
    require('../../src/app');
  });

  afterAll(function() {
    jest.resetModules();
    jest.unmock('ioredis');
    jest.unmock('express-rate-limit');
    delete process.env.REDIS_URL;
  });

  function calledPrefixes() {
    return maybeRedisStoreSpy.mock.calls.map(function(call) { return call[0]; });
  }

  // Every express-rate-limit factory invocation whose immediate call site is
  // app.js itself (not schedule.routes.js / ai.routes.js / anything else
  // app.js's require graph pulls in — see "Scope note" in the header comment).
  function appJsRateLimitCalls() {
    return rateLimitCallSites.filter(function(c) { return c.callerFile === APP_JS_FILE; });
  }

  test('featureServiceLimiter is wired through maybeRedisStore("jugrl-feature:")', function() {
    expect(calledPrefixes()).toContain('jugrl-feature:');
  });

  test('writeRateLimiter is wired through maybeRedisStore("jugrl-write:")', function() {
    expect(calledPrefixes()).toContain('jugrl-write:');
  });

  test('every rateLimit({...}) constructed directly in app.js passes a defined store option — none falls back to the per-instance default store', function() {
    var appCalls = appJsRateLimitCalls();

    // Sanity floor: app.js currently constructs 9 limiters directly at its own
    // call sites (the inline `require('express-rate-limit')(...)` for
    // clientErrorLimiter, plus the 8 built via the `rateLimit` const:
    // apiLimiter, aiLimiter, mcpLimiter, oauthCallbackLimiter,
    // billingWebhookLimiter, healthLimiter, featureServiceLimiter,
    // writeRateLimiter). If the call-site filter ever stops matching (e.g. a
    // jest/node stack-trace format change), appCalls silently becomes [] and
    // forEach below would vacuously pass on zero limiters — guard against
    // that false-green explicitly rather than only asserting inside forEach.
    expect(appCalls.length).toBeGreaterThanOrEqual(9);

    // The actual enforcement: NO limiter constructed in app.js may omit
    // `store` (or pass it as undefined/null) — that is exactly the
    // per-instance-MemoryStore-fallback bug BUG-953 fixed, and this assertion
    // catches it for ANY current or future app.js limiter, not just the 8
    // prefixes the original (zoe-WARNed) version of this test hardcoded.
    appCalls.forEach(function(call) {
      expect(call.options && call.options.store).toBeDefined();
    });
  });
});
