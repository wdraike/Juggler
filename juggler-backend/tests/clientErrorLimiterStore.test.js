/**
 * 999.451 — clientErrorLimiter (POST /api/client-errors) must share its rate cap
 * across Cloud Run instances via Redis when configured, exactly like aiLimiter.
 *
 * The limiter is constructed inside app.js, so this is a source-level wiring guard
 * (mirrors aiRateLimiter.test.js's FIX-05 source guard) plus a behavioral check on
 * the shared maybeRedisStore helper:
 *   - clientErrorLimiter passes store: maybeRedisStore(...) (NOT a bare in-memory limiter).
 *   - maybeRedisStore returns undefined (→ in-memory MemoryStore) when REDIS_URL is unset
 *     (single-instance fallback preserved).
 *
 * No live Redis required.
 */

'use strict';

process.env.NODE_ENV = 'test';

var fs = require('fs');
var path = require('path');

var APP_PATH = path.join(__dirname, '..', 'src', 'app.js');

describe('clientErrorLimiter shared store — 999.451 source wiring', function () {
  var appSource;

  beforeAll(function () {
    appSource = fs.readFileSync(APP_PATH, 'utf8');
  });

  test('clientErrorLimiter is wired with store: maybeRedisStore(...)', function () {
    // Isolate the clientErrorLimiter declaration block and assert it carries a
    // maybeRedisStore store (the same helper aiLimiter uses).
    var idx = appSource.indexOf('clientErrorLimiter');
    expect(idx).toBeGreaterThan(-1);
    var block = appSource.slice(idx, idx + 800);
    expect(block).toContain('store:');
    expect(block).toContain('maybeRedisStore(');
  });

  test('the maybeRedisStore key prefix is distinct from aiLimiter (no counter collision)', function () {
    var idx = appSource.indexOf('clientErrorLimiter');
    var block = appSource.slice(idx, idx + 800);
    // aiLimiter uses 'jugrl-ai:' — clientErrorLimiter must use its own prefix.
    expect(block).toMatch(/maybeRedisStore\(\s*'jugrl-cerr:'\s*\)/);
  });
});

describe('maybeRedisStore fallback — single-instance when REDIS_URL unset', function () {
  var saved;

  beforeEach(function () { saved = process.env.REDIS_URL; delete process.env.REDIS_URL; });
  afterEach(function () {
    if (saved === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = saved;
  });

  test('returns undefined (→ express-rate-limit default MemoryStore) when REDIS_URL is unset', function () {
    jest.resetModules();
    var maybeRedisStore = require('../src/lib/rate-limit-store').maybeRedisStore;
    expect(maybeRedisStore('jugrl-cerr:')).toBeUndefined();
  });
});
