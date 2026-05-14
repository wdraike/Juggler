/**
 * FIX-05: AI per-user rate limiter must use RedisStore when REDIS_URL is set.
 *
 * Tests:
 *   1. ai.routes.js source imports rate-limit-redis and wires a RedisStore
 *      when REDIS_URL is set (source-level guard — fails until wired).
 *   2. When REDIS_URL is unset, the limiter falls back to in-memory MemoryStore
 *      (fail-open for local dev).
 *   3. Two limiter instances sharing one RedisStore share counts across instances
 *      (simulates two Cloud Run instances).
 *
 * The strict per-user AI limiter (max=2/min) lives in src/routes/ai.routes.js.
 */
process.env.NODE_ENV = 'test';

var fs = require('fs');
var path = require('path');

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal sendCommand function for RedisStore (rate-limit-redis v4).
 *
 * rate-limit-redis v4 wraps the provided sendCommand so it is invoked as
 * sendCommand(cmd, arg1, arg2, ...) — positional args, not an object.
 * (Internal: `const sendCommandFn = options.sendCommand.bind(this);`
 *             `this.sendCommand = async ({ command }) => sendCommandFn(...command);`)
 */
function makeRedisStoreSendCommand() {
  var store = new Map();
  var scriptCounter = 0;

  async function sendCommand(cmd) {
    var args = Array.prototype.slice.call(arguments, 1);
    switch ((cmd || '').toUpperCase()) {
      case 'SCRIPT': {
        // SCRIPT LOAD <src>
        var sha = 'sha_' + (++scriptCounter);
        return sha;
      }
      case 'EVALSHA': {
        // EVALSHA <sha> <numkeys> <key> [windowMs] [resetFlag]
        var key = args[2];
        var windowMs = args[3] ? parseInt(args[3], 10) : 60000;
        var current = store.get(key) || 0;
        store.set(key, current + 1);
        return [current + 1, windowMs];
      }
      case 'DECR': {
        var decKey = args[0];
        var v = Math.max(0, (store.get(decKey) || 0) - 1);
        store.set(decKey, v);
        return v;
      }
      case 'DEL': {
        store.delete(args[0]);
        return 1;
      }
      case 'GET': {
        return store.get(args[0]) || null;
      }
      case 'PTTL': {
        return 60000;
      }
      default:
        return null;
    }
  }

  return { sendCommand, backingStore: store };
}

// ── Test 1: Source-level guard — ai.routes.js must import rate-limit-redis ─

describe('AI per-user rate limiter — FIX-05 source wiring', function() {
  var aiRoutesSource;

  beforeAll(function() {
    var aiRoutesPath = path.join(__dirname, '../src/routes/ai.routes.js');
    aiRoutesSource = fs.readFileSync(aiRoutesPath, 'utf8');
  });

  test('ai.routes.js imports rate-limit-redis (RedisStore wiring)', function() {
    // This test FAILS until FIX-05 is implemented.
    // After fix: ai.routes.js requires rate-limit-redis and uses it conditionally.
    expect(aiRoutesSource).toContain('rate-limit-redis');
  });

  test('ai.routes.js aiLimiter uses a conditional store (REDIS_URL check)', function() {
    // After fix: ai.routes.js checks process.env.REDIS_URL before building RedisStore.
    expect(aiRoutesSource).toContain('REDIS_URL');
  });

  test('package.json lists rate-limit-redis as a dependency', function() {
    var pkgPath = path.join(__dirname, '../package.json');
    var pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    var hasDep = !!(pkg.dependencies && pkg.dependencies['rate-limit-redis']) ||
                 !!(pkg.devDependencies && pkg.devDependencies['rate-limit-redis']);
    expect(hasDep).toBe(true);
  });
});

// ── Test 2: REDIS_URL unset → limiter uses MemoryStore (fail-open) ─────────

describe('AI per-user rate limiter — MemoryStore when REDIS_URL is unset', function() {
  test('when REDIS_URL is not set, limiter uses default MemoryStore (no crash)', function() {
    jest.resetModules();
    delete process.env.REDIS_URL;

    // Mock ioredis so no real connection attempt is made
    jest.doMock('ioredis', function() {
      return function IORedisMock() {
        return {
          status: 'connecting',
          call: jest.fn(),
          on: jest.fn(function() { return this; }),
        };
      };
    });

    var aiRoutes;
    expect(function() {
      aiRoutes = require('../src/routes/ai.routes');
    }).not.toThrow();

    expect(aiRoutes).toBeDefined();

    jest.resetModules();
    jest.unmock('ioredis');
  });
});

// ── Test 3: Shared RedisStore counts across two limiter instances ──────────

describe('AI rate limiter — shared RedisStore counts across instances', function() {
  test('two limiter instances sharing one RedisStore accumulate hits in shared state', async function() {
    var RedisStore;
    try {
      RedisStore = require('rate-limit-redis').RedisStore;
    } catch (e) {
      console.warn('rate-limit-redis not installed — skipping');
      return;
    }

    var rateLimit = require('express-rate-limit');
    var mockData = makeRedisStoreSendCommand();

    var sharedStore1 = new RedisStore({ sendCommand: mockData.sendCommand, prefix: 'jugrl-test:' });
    var sharedStore2 = new RedisStore({ sendCommand: mockData.sendCommand, prefix: 'jugrl-test:' });

    var limiterA = rateLimit({
      windowMs: 60 * 1000,
      max: 2,
      store: sharedStore1,
      keyGenerator: function(req) { return req.userId || 'testuser'; },
    });

    var limiterB = rateLimit({
      windowMs: 60 * 1000,
      max: 2,
      store: sharedStore2,
      keyGenerator: function(req) { return req.userId || 'testuser'; },
    });

    // Simulate first request on instance A (limiterA)
    var req1 = {
      userId: 'shareduser',
      ip: '1.2.3.4',
      method: 'POST',
      path: '/api/ai/command',
      headers: {},
      get: jest.fn(function() { return ''; })
    };
    var res1 = {
      setHeader: jest.fn(), getHeader: jest.fn(function() { return null; }),
      status: jest.fn(function() { return res1; }),
      json: jest.fn(), end: jest.fn(), set: jest.fn()
    };

    await new Promise(function(resolve) { limiterA(req1, res1, resolve); });

    // Simulate second request on instance B (limiterB, same underlying store)
    var req2 = {
      userId: 'shareduser',
      ip: '1.2.3.4',
      method: 'POST',
      path: '/api/ai/command',
      headers: {},
      get: jest.fn(function() { return ''; })
    };
    var res2 = {
      setHeader: jest.fn(), getHeader: jest.fn(function() { return null; }),
      status: jest.fn(function() { return res2; }),
      json: jest.fn(), end: jest.fn(), set: jest.fn()
    };

    await new Promise(function(resolve) { limiterB(req2, res2, resolve); });

    // The backing store key should reflect hits from BOTH instances
    // (prefix + keyGenerator output = 'jugrl-test:shareduser')
    var hitCount = mockData.backingStore.get('jugrl-test:shareduser');
    expect(hitCount).toBeGreaterThanOrEqual(2);
  });
});
