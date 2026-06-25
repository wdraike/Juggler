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

  test('ai.routes.js imports the rate-limit-redis store helper (RedisStore wiring)', function() {
    // This test FAILS until FIX-05 is implemented.
    // After fix: ai.routes.js requires rate-limit-store (which wraps rate-limit-redis)
    // and passes it to the aiLimiter. Both the route and the helper are checked.
    var hasDirectImport = aiRoutesSource.includes('rate-limit-redis');
    var hasHelperImport = aiRoutesSource.includes('rate-limit-store');
    expect(hasDirectImport || hasHelperImport).toBe(true);

    // Also verify the rate-limit-store.js helper itself imports rate-limit-redis
    var storePath = path.join(__dirname, '../src/lib/rate-limit-store.js');
    var storeSource = fs.readFileSync(storePath, 'utf8');
    expect(storeSource).toContain('rate-limit-redis');
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

// ── Test 4: keyGenerator uses req.user.id (source-level assertion) ──────────

describe('AI rate limiter — keyGenerator uses req.user.id', function() {
  test('ai.routes.js keyGenerator reads req.user.id (not req.ip)', function() {
    var aiRoutesPath = path.join(__dirname, '../src/routes/ai.routes.js');
    var src = fs.readFileSync(aiRoutesPath, 'utf8');

    // Must reference req.user.id (or req.user?.id) as the key
    expect(src).toMatch(/req\.user(\?\.|\.)id/);

    // Must NOT use req.ip as the primary key — per-user isolation requires user id
    // (anon fallback is acceptable but should never be the primary key expression)
    var keyGenMatch = src.match(/keyGenerator\s*:\s*function[^}]+}/s) ||
                      src.match(/keyGenerator\s*[:(][^}]+}/s);
    if (keyGenMatch) {
      // The key generator must reference user id before any ip fallback
      var keyGenBody = keyGenMatch[0];
      var userIdPos = keyGenBody.search(/req\.user(\?\.|\.)id/);
      var ipPos = keyGenBody.indexOf('req.ip');
      expect(userIdPos).toBeGreaterThanOrEqual(0);
      // ip may appear as fallback but only after the user id check
      if (ipPos >= 0) {
        expect(userIdPos).toBeLessThan(ipPos);
      }
    }
  });
});

// ── Test 5: 3rd request within window → 429 with exact error message ─────────

describe('AI rate limiter — HTTP 429 on 3rd request in window', function() {
  var _app;

  beforeAll(function() {
    jest.resetModules();

    // Set up all required mocks before requiring the app
    jest.doMock('ioredis', function() {
      return function IORedisMock() {
        return { status: 'connecting', call: jest.fn(), on: jest.fn(function() { return this; }) };
      };
    });

    delete process.env.REDIS_URL;

    // Mock db
    var mockDb = (function() {
      var chain = jest.fn(function() { return chain; });
      ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereNotIn',
       'whereIn', 'orWhere', 'orderBy', 'orderByRaw', 'limit', 'offset',
       'join', 'leftJoin', 'count', 'max', 'clearSelect', 'clearOrder',
       'groupBy', 'having'].forEach(function(m) { chain[m] = jest.fn(function() { return chain; }); });
      chain.select = jest.fn(function() { return Promise.resolve([]); });
      chain.first = jest.fn(function() { return Promise.resolve({ cnt: 0 }); });
      chain.insert = jest.fn(function() { return Promise.resolve(); });
      chain.update = jest.fn(function() { return Promise.resolve(1); });
      chain.del = jest.fn(function() { return Promise.resolve(1); });
      chain.then = jest.fn(function(resolve) { return Promise.resolve([]).then(resolve); });
      chain.catch = jest.fn(function(fn) { return Promise.resolve([]).catch(fn); });
      chain.raw = jest.fn(function(s) { return s; });
      chain.transaction = jest.fn(function(cb) { return cb(chain); });
      chain.fn = { now: function() { return 'NOW'; } };
      return chain;
    }());
    jest.doMock('../src/db', function() { return mockDb; });

    jest.doMock('../src/middleware/jwt-auth', function() { return {
      loadJWTSecrets: jest.fn(),
      authenticateJWT: function(req, res, next) {
        var auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth required' });
        req.user = { id: req.headers['x-test-user-id'] || 'rl-user-1', email: 'test@test.com' };
        req.auth = { plans: {} };
        next();
      },
      verifyToken: jest.fn()
    }; });

    jest.doMock('../src/middleware/plan-features.middleware', function() { return {
      resolvePlanFeatures: function(req, res, next) {
        req.planId = 'enterprise';
        req.planFeatures = { limits: { active_tasks: -1 }, calendar: { max_providers: -1 }, scheduling: {}, tasks: {}, ai: { natural_language_commands: true } };
        next();
      },
      PRODUCT_ID: 'juggler', refreshPlanFeatures: jest.fn(), invalidateUserPlanCache: jest.fn(), getCachedPlanFeatures: jest.fn()
    }; });

    jest.doMock('../src/lib/redis', function() { return { getClient: jest.fn().mockReturnValue(null), invalidateTasks: jest.fn().mockResolvedValue(), invalidateConfig: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(), del: jest.fn().mockResolvedValue() }; });

    jest.doMock('../src/scheduler/scheduleQueue', function() { return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() }; });
    jest.doMock('../src/lib/sse-emitter', function() { return { emit: jest.fn(), addClient: jest.fn() }; });
    jest.doMock('../src/lib/tasks-write', function() { return { insertTask: jest.fn().mockResolvedValue(), insertTasksBatch: jest.fn().mockResolvedValue(), archiveInstances: jest.fn().mockResolvedValue(), archiveCompletedInstances: jest.fn().mockResolvedValue(), resetRecurringInstances: jest.fn().mockResolvedValue(), updateTaskById: jest.fn().mockResolvedValue(1), deleteTaskById: jest.fn().mockResolvedValue(1), updateTasksWhere: jest.fn().mockResolvedValue(), deleteTasksWhere: jest.fn().mockResolvedValue(), deleteInstancesWhere: jest.fn().mockResolvedValue(), updateInstancesWhere: jest.fn().mockResolvedValue(), splitUpdateFields: jest.fn(function(f) { return f; }), isTemplate: jest.fn().mockReturnValue(false) }; });
    jest.doMock('../src/lib/task-write-queue', function() { return { isLocked: jest.fn().mockResolvedValue(false), enqueueWrite: jest.fn().mockResolvedValue(), flushQueue: jest.fn().mockResolvedValue(), flushQueueInLock: jest.fn().mockResolvedValue(), splitFields: jest.fn(function(f) { return { schedulingFields: {}, nonSchedulingFields: f }; }), NON_SCHEDULING_FIELDS: [] }; });
    jest.doMock('../src/middleware/entity-limits', function() { return { checkProjectLimit: function(q,r,n){n();}, checkLocationLimit: function(q,r,n){n();}, checkScheduleTemplateLimit: function(q,r,n){n();}, checkTaskOrRecurringLimit: function(q,r,n){n();}, checkBatchTaskLimits: function(q,r,n){n();}, checkToolLimit: function(q,r,n){n();}, countActiveTasks: jest.fn().mockResolvedValue(0), countRecurringTemplates: jest.fn().mockResolvedValue(0), countProjects: jest.fn().mockResolvedValue(0), countLocations: jest.fn().mockResolvedValue(0), countScheduleTemplates: jest.fn().mockResolvedValue(0) }; });
    jest.doMock('../src/middleware/validate', function() { return { validate: function() { return function(q,r,n){n();}; } }; });
    jest.doMock('../src/services/gemini-tracked-call', function() { return { trackedGeminiCall: jest.fn().mockResolvedValue({ text: JSON.stringify({ ops: [], msg: 'Done.' }) }) }; });
    jest.doMock('../src/services/ai-usage-queue.service', function() { return { enqueue: jest.fn() }; });

    // Mock the logger module so that logger.info / logger.error calls in
    // ai.controller.js (which does require('../lib/logger') and calls it as a
    // plain logger) don't throw. The logger module exports an object of named
    // loggers — not a top-level Logger instance — so calling logger.info()
    // directly crashes unless we provide stub methods.
    var noopLogger = {
      info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), trace: jest.fn()
    };
    jest.doMock('../src/lib/logger', function() {
      return Object.assign({}, noopLogger, {
        aiUsageQueueLogger: noopLogger,
        aiControllerLogger: noopLogger,
        loggers: new Proxy({}, { get: function() { return noopLogger; } }),
        createLogger: jest.fn(function() { return noopLogger; }),
        clearLoggerCache: jest.fn(),
        LOG_LEVELS: ['error', 'warn', 'info', 'debug', 'trace'],
        DEFAULT_LOG_LEVEL: 'debug',
        Logger: jest.fn(),
      });
    });

    // Do NOT mock rate-limit-store here — let the real MemoryStore accumulate hits
    // so we can verify the 429 fires on the 3rd request.

    _app = require('../src/app');
  });

  afterAll(function() {
    jest.resetModules();
    jest.unmock('ioredis');
  });

  test('returns 429 with exact rate-limit error message on 3rd request within 60s', async function() {
    var supertest = require('supertest');
    var userId = 'rl-user-3rd-test-' + Date.now(); // unique user to avoid bleed from other tests

    function fireRequest() {
      return supertest(_app)
        .post('/api/ai/command')
        .set('Authorization', 'Bearer valid-test-token')
        .set('x-test-user-id', userId)
        .send({ command: 'add a task', tasks: [] });
    }

    // gemini-tracked-call is mocked to resolve { ops:[], msg:'Done.' }, so the first
    // two in-window requests succeed (ai.controller success path → 200). The 3rd
    // trips the rate limiter → 429. (Prior `toBe(500)` was a mechanical test-rot
    // collapse — commit 1a132cc — contradicting the mocked-success setup.)
    var res1 = await fireRequest();
    expect(res1.status).toBe(200);

    var res2 = await fireRequest();
    expect(res2.status).toBe(200);

    var res3 = await fireRequest();
    expect(res3.status).toBe(429);
    expect(res3.body.error).toBe('Too many AI requests. Max 2 per minute — try again shortly.');
  });

  test('per-user isolation — user A hitting limit does not block user B', async function() {
    var supertest = require('supertest');
    var userA = 'rl-user-A-' + Date.now();
    var userB = 'rl-user-B-' + Date.now();

    function fireAs(uid) {
      return supertest(_app)
        .post('/api/ai/command')
        .set('Authorization', 'Bearer valid-test-token')
        .set('x-test-user-id', uid)
        .send({ command: 'add a task', tasks: [] });
    }

    // Exhaust user A's limit
    await fireAs(userA);
    await fireAs(userA);
    var resA3 = await fireAs(userA);
    expect(resA3.status).toBe(429);

    // User B should still succeed on first request (200 — mocked Gemini success;
    // prior `toBe(500)` was the same test-rot collapse).
    var resB1 = await fireAs(userB);
    expect(resB1.status).toBe(200);
  });

  test('unauthenticated request is rejected by JWT middleware before reaching rate limiter', async function() {
    var supertest = require('supertest');

    var res = await supertest(_app)
      .post('/api/ai/command')
      .send({ command: 'add a task' });
    // JWT middleware fires before the rate limiter — must be 401, not 429
    expect(res.status).toBe(401);
  });
});
