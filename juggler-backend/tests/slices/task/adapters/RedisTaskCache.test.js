/**
 * H3 W4 — RedisTaskCache adapter suite (TaskCachePort over lib/cache).
 *
 * WBS W4 acceptance (a): cache get/set/del/ttl semantics IDENTICAL to the legacy
 * `task.controller.js` redis-cache path (characterization), proven against BOTH
 * a real Redis (test-bed :6479) and the InMemory cache double — same contract
 * suite, mirroring the H2 libCache.contract.test.js double-vs-real pattern.
 *
 * LEGACY PATH CHARACTERIZED (task.controller.js):
 *   - getAllTasks ~662-675 : key `user:<id>:tasks`,   TTL 300s, `{ tasks, version }`
 *   - getVersion  ~710-718 : key `user:<id>:version`, TTL 30s,  `{ version }`
 *   - mutations   (19×)    : `cache.invalidateTasks(userId)` → del tasks+version+placements
 *
 * NOTE on the version key: the SHIPPING controller uses `user:<id>:version`
 * (NOT `:tasks:version` as the TaskCachePort JSDoc prose said). lib/redis's
 * invalidateTasks busts `:version`. This suite pins the SHIPPING `:version` key
 * — characterization is the binding gate.
 *
 * REDIS BINDING: REDIS_URL pinned to test-bed :6479 BEFORE any require that reads
 * it (mirrors libCache.contract.test.js). The Redis leg runs whenever REDIS_URL
 * is set (always, here).
 *
 * Traceability: WBS W4 (a), (e), (f); TaskCachePort C-1..C-5; P1 (no new fallbacks).
 */

'use strict';

process.env.NODE_ENV = 'test';
// Pin test-bed Redis BEFORE any require that calls ensureClient() / reads REDIS_URL.
process.env.REDIS_URL = 'redis://localhost:6479';

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'task');
var RedisTaskCache = require(path.join(SLICE, 'adapters', 'RedisTaskCache'));
var TaskCachePort = require(path.join(SLICE, 'domain', 'ports', 'TaskCachePort'));
var TASK_CACHE_PORT_METHODS = TaskCachePort.TASK_CACHE_PORT_METHODS;

var libCache = require('../../../../src/lib/cache');
var libRedis = require('../../../../src/lib/redis');

var HAS_REDIS = !!process.env.REDIS_URL;
// W4-1 FIX: assert against hardcoded legacy literals — NOT the adapter's own
// exported constants.  If the adapter's TTL drifts (e.g. 300→600), this test
// MUST catch it.  The expected values are the legacy controller literals:
//   getAllTasks ≈675: cache.set(key, result, 300)
//   getVersion  ≈718: cache.set(key, result, 30)
var TASKS_TTL_LEGACY = 300;
var VERSION_TTL_LEGACY = 30;

// Unique user-id namespace per run so parallel/leftover keys never collide.
var NS = 'w4cache-' + Date.now() + '-' + Math.random().toString(36).slice(2);
var uid = function (suffix) { return NS + '-' + suffix; };

// ── conformance ──────────────────────────────────────────────────────────────
describe('RedisTaskCache — TaskCachePort conformance', function () {
  test('abstract TaskCachePort base throws on every method', function () {
    var base = new TaskCachePort();
    TASK_CACHE_PORT_METHODS.forEach(function (m) {
      expect(function () { base[m](); }).toThrow(/not implemented/);
    });
  });

  test('RedisTaskCache exposes exactly the TASK_CACHE_PORT_METHODS surface', function () {
    var adapter = new RedisTaskCache(new libCache.InMemoryCacheAdapter());
    TASK_CACHE_PORT_METHODS.forEach(function (m) {
      expect(typeof adapter[m]).toBe('function');
    });
  });

  test('RedisTaskCache is a TaskCachePort (prototype chain)', function () {
    var adapter = new RedisTaskCache(new libCache.InMemoryCacheAdapter());
    expect(adapter instanceof TaskCachePort).toBe(true);
  });
});

// ── shared behavioral suite, parameterized by the backing CachePort ───────────
function sharedContract(label, makeBackingCache, opts) {
  var o = opts || {};
  describe('RedisTaskCache behavior — ' + label, function () {
    var backing;
    var cache;
    beforeAll(async function () {
      backing = makeBackingCache();
      cache = new RedisTaskCache(backing);
      if (typeof o.setup === 'function') await o.setup(backing);
    });
    afterAll(async function () {
      await backing.del(
        'user:' + uid('t') + ':tasks',
        'user:' + uid('t') + ':version',
        'user:' + uid('t') + ':placements',
        'user:' + uid('v') + ':version',
        'user:' + uid('inv') + ':tasks',
        'user:' + uid('inv') + ':version',
        'user:' + uid('inv') + ':placements',
        'user:' + uid('miss') + ':tasks',
        'user:' + uid('miss') + ':version'
      );
      if (typeof o.teardown === 'function') await o.teardown(backing);
    });

    test('getTasks() miss resolves null (NOT throw, NOT default) — liveness-proved', async function () {
      // Liveness probe first so a null on the miss-key is meaningful (a dead /
      // fail-open backing returns null for BOTH a real miss AND a live get).
      await cache.setTasks(uid('t'), { tasks: [{ id: 'a' }], version: 'v1' });
      expect(await cache.getTasks(uid('t'))).toEqual({ tasks: [{ id: 'a' }], version: 'v1' });
      // miss key never written
      expect(await cache.getTasks(uid('miss'))).toBeNull();
    });

    test('setTasks()+getTasks() round-trips the `{ tasks, version }` payload', async function () {
      var payload = { tasks: [{ id: 't1', text: 'x' }, { id: 't2' }], version: 'abc' };
      await cache.setTasks(uid('t'), payload);
      expect(await cache.getTasks(uid('t'))).toEqual(payload);
    });

    test('setTasks() writes under the legacy `user:<id>:tasks` key', async function () {
      await cache.setTasks(uid('t'), { tasks: [], version: 'k' });
      // Read via the backing cache at the EXACT legacy key — proves the key scheme.
      expect(await backing.get('user:' + uid('t') + ':tasks')).toEqual({ tasks: [], version: 'k' });
    });

    test('getVersion() miss resolves null', async function () {
      expect(await cache.getVersion(uid('miss'))).toBeNull();
    });

    test('setVersion()+getVersion() round-trips the `{ version }` payload under `:version`', async function () {
      await cache.setVersion(uid('v'), { version: 'V9' });
      expect(await cache.getVersion(uid('v'))).toEqual({ version: 'V9' });
      // Legacy SHIPPING key is `:version`, NOT `:tasks:version`.
      expect(await backing.get('user:' + uid('v') + ':version')).toEqual({ version: 'V9' });
      expect(await backing.get('user:' + uid('v') + ':tasks:version')).toBeNull();
    });

    test('setTasks() applies the legacy 300s TTL by default (C-2)', async function () {
      // W4-1 FIX: bounds are the LEGACY LITERALS (300/30), not the adapter's
      // exported constants — so an adapter constant drift (300→600) FAILS this test.
      await cache.setTasks(uid('t'), { tasks: [], version: 'ttl' });
      if (o.ttlOf) {
        var ttl = await o.ttlOf(backing, 'user:' + uid('t') + ':tasks');
        expect(ttl).toBeGreaterThan(TASKS_TTL_LEGACY - 5);   // > 295
        expect(ttl).toBeLessThanOrEqual(TASKS_TTL_LEGACY);   // ≤ 300
      }
    });

    test('setVersion() applies the legacy 30s TTL by default (C-2)', async function () {
      // W4-1 FIX: same — VERSION_TTL_LEGACY is the hardcoded literal 30, not
      // the adapter's VERSION_TTL_SECONDS constant.
      await cache.setVersion(uid('v'), { version: 'ttl' });
      if (o.ttlOf) {
        var ttl = await o.ttlOf(backing, 'user:' + uid('v') + ':version');
        expect(ttl).toBeGreaterThan(VERSION_TTL_LEGACY - 5); // > 25
        expect(ttl).toBeLessThanOrEqual(VERSION_TTL_LEGACY); // ≤ 30
      }
    });

    test('explicit ttl override is honored (port allows caller TTL)', async function () {
      await cache.setTasks(uid('t'), { tasks: [], version: 'o' }, 1000);
      if (o.ttlOf) {
        var ttl = await o.ttlOf(backing, 'user:' + uid('t') + ':tasks');
        expect(ttl).toBeGreaterThan(900);
        expect(ttl).toBeLessThanOrEqual(1000);
      }
    });

    test('invalidateTasks() busts tasks + version + placements (legacy semantics)', async function () {
      await cache.setTasks(uid('inv'), { tasks: [{ id: 'z' }], version: 'p' });
      await cache.setVersion(uid('inv'), { version: 'p' });
      await backing.set('user:' + uid('inv') + ':placements', { p: 1 }, 60);

      await cache.invalidateTasks(uid('inv'));

      expect(await cache.getTasks(uid('inv'))).toBeNull();
      expect(await cache.getVersion(uid('inv'))).toBeNull();
      expect(await backing.get('user:' + uid('inv') + ':placements')).toBeNull();
    });

    test('invalidateTasks() does NOT throw (fail-open into the write path)', async function () {
      // W4-3 FIX: was `.resolves.not.toThrow` (property access, never invoked —
      // dead assertion).  Must be an actual assertion on the resolved value so
      // the matcher RUNS.  CachePort.invalidateTasks resolves a boolean (true on
      // success); assert that directly instead of the useless .not.toThrow property.
      await expect(cache.invalidateTasks(uid('inv'))).resolves.toBeDefined();
    });
  });
}

// ── InMemory cache double (the contract-parity leg) ──────────────────────────
sharedContract('InMemoryCacheAdapter double', function () {
  return new libCache.InMemoryCacheAdapter();
}, {
  // Deterministic clock not needed here; TTL inspection is exercised on the
  // Redis leg. InMemory TTL semantics are already proven in libCache.contract.
});

// ── Real Redis (test-bed :6479) — the production binding (RedisCacheAdapter) ──
var dRedis = HAS_REDIS ? describe : describe.skip;
dRedis('RedisTaskCache over real Redis (test-bed :6479)', function () {
  sharedContract('RedisCacheAdapter (real Redis)', function () {
    return new libCache.RedisCacheAdapter();
  }, {
    setup: async function () {
      var client = libRedis.getClient();
      var start = Date.now();
      while (Date.now() - start < 3000 && (!client || client.status !== 'ready')) {
        await new Promise(function (r) { setTimeout(r, 50); });
      }
    },
    // ioredis auto-applies its 'strivers:' keyPrefix to ttl(); pass the logical key.
    ttlOf: async function (_backing, key) {
      return libRedis.getClient().ttl(key);
    },
    teardown: async function () {
      await libRedis.quit();
    }
  });
});

// ── default-binding smoke (no injected cache → lib/cache module-singleton) ────
describe('RedisTaskCache default binding', function () {
  test('constructed with no arg wires the lib/cache module-singleton', function () {
    var adapter = new RedisTaskCache();
    // It is wired to a CachePort (has the method surface); we do not exercise it
    // against Redis here (the injected-backing legs cover behavior).
    TASK_CACHE_PORT_METHODS.forEach(function (m) {
      expect(typeof adapter[m]).toBe('function');
    });
  });
});

// ── top-level teardown: close ioredis connection after entire suite ───────────
// Belt-and-suspenders: the Real Redis describe's sharedContract afterAll calls
// libRedis.quit() as its teardown, but a top-level afterAll ensures the ioredis
// handle is always closed even if the Real Redis block is skipped or runs in an
// unexpected order.  Mirrors the H2 libCache.contract.test.js teardown pattern.
afterAll(async function () {
  await libRedis.quit();
});
