/**
 * PORT-CONTRACT test for lib-cache (H2 / W2).
 *
 * Runs ONE shared assertion suite against BOTH adapters:
 *   - RedisCacheAdapter (real Redis, test-bed :6479)
 *   - InMemoryCacheAdapter (process-local)
 *
 * They MUST behave identically across get / set / del / ttl / expiry / miss /
 * invalidation — proving the in-memory adapter is a faithful stand-in and that
 * both honor CachePort invariants C-1..C-5.
 *
 * Plus a conformance check: every adapter exposes exactly CACHE_PORT_METHODS,
 * and the abstract base throws (mirrors the weather contract test).
 *
 * REDIS BINDING (TASK 2 fix):
 * REDIS_URL is pinned to test-bed :6479 explicitly here, BEFORE any require()
 * that reads it.  This prevents the .env file's REDIS_URL=redis://127.0.0.1:6379
 * from silently binding to the wrong instance if dotenv were ever loaded in the
 * test environment.  Tests are always run with the env prefix
 *   REDIS_URL=redis://localhost:6479
 * but this in-file assignment is a belt-and-suspenders guard.
 *
 * SKIP GUARD RATIONALE:
 * The Redis sub-suite skips when REDIS_URL is absent (not when it is wrong).
 * With the explicit pin below, REDIS_URL is ALWAYS set in this file, so the
 * Redis suite always runs when this file is executed.  That is the correct
 * behavior: the contract test MUST hit a real Redis to be meaningful.  Run the
 * full suite via:
 *   cd test-bed && make up   # starts Redis on :6479
 *   DB_HOST=127.0.0.1 DB_PORT=3407 … REDIS_URL=redis://localhost:6479 npx jest
 */

'use strict';

// Pin to test-bed Redis BEFORE any require that calls ensureClient() or reads REDIS_URL.
process.env.REDIS_URL = 'redis://localhost:6479';

const {
  CachePort,
  CACHE_PORT_METHODS,
  RedisCacheAdapter,
  InMemoryCacheAdapter
} = require('../src/lib/cache');

// HAS_REDIS is always true now (REDIS_URL is pinned above).
// The skip guard is kept for documentation; in normal CI the Redis suite runs.
const HAS_REDIS = !!process.env.REDIS_URL;

// Unique namespace per run so leftover/parallel keys never collide.
const NS = `contract:${Date.now()}:${Math.random().toString(36).slice(2)}`;
const k = (suffix) => `${NS}:${suffix}`;

// ── shared behavioral suite, parameterized by adapter factory ────────────────
function sharedContract(label, makeAdapter, opts) {
  const o = opts || {};
  describe(`CachePort contract — ${label}`, () => {
    let cache;
    beforeAll(async () => {
      cache = makeAdapter();
      if (typeof o.setup === 'function') await o.setup(cache);
    });
    afterAll(async () => {
      await cache.del(k('a'), k('ttl'), k('nottl'), k('exp'), k('liveness-probe'), k('drop-test'));
      if (typeof o.teardown === 'function') await o.teardown(cache);
    });

    test('miss: get() on an unknown key resolves null — liveness-proved (C-1/C-3)', async () => {
      // WARN-2 fix: prove the adapter is LIVE before asserting the miss.
      // A dead / fail-open adapter returns null for BOTH a real miss AND a live
      // set-then-get.  By asserting the round-trip succeeds first, a dead adapter
      // fails here (get on the live key returns null instead of the sentinel) —
      // so a null on the miss-key is meaningful, not indistinguishable from
      // fail-open silence.
      const liveKey = k('liveness-probe');
      const sentinel = { __live: true, ts: Date.now() };
      expect(await cache.set(liveKey, sentinel, 60)).toBe(true);
      expect(await cache.get(liveKey)).toEqual(sentinel); // adapter MUST be live here
      // Only NOW assert the miss — we know the adapter is responding
      expect(await cache.get(k('never-set'))).toBeNull();
    });

    test('set()+get() round-trips a JSON-serializable value (C-1)', async () => {
      const value = { a: 1, b: ['x', 'y'], nested: { z: true } };
      expect(await cache.set(k('a'), value, 60)).toBe(true);
      expect(await cache.get(k('a'))).toEqual(value);
    });

    test('set() drops non-JSON-safe fields exactly as JSON would (C-1)', async () => {
      // WARN-3 fix: use a DISTINCT key (`drop-test`) so this test does not
      // silently rely on state written by the round-trip test above.
      // The assertion is load-bearing: the stored value must CONTAIN `keep`
      // with its exact value AND must NOT contain `drop`.  A no-op adapter
      // (never storing anything) returns null → toEqual({ keep: 1 }) FAILS.
      // An adapter that stores but does not drop `undefined` returns
      // { keep: 1, drop: undefined } → toEqual({ keep: 1 }) FAILS (extra key
      // will mismatch with strict equality).
      const dropKey = k('drop-test');
      await cache.set(dropKey, { keep: 42, drop: undefined }, 60);
      const result = await cache.get(dropKey);
      expect(result).not.toBeNull();              // must have stored something
      expect(result).toEqual({ keep: 42 });       // `drop` field absent; keep survives
      expect(Object.prototype.hasOwnProperty.call(result, 'drop')).toBe(false);
    });

    test('set() returns true; del() returns true; get-after-del is a miss (C-3/C-4)', async () => {
      await cache.set(k('a'), { v: 1 }, 60);
      expect(await cache.del(k('a'))).toBe(true);
      expect(await cache.get(k('a'))).toBeNull();
    });

    test('del() of multiple keys removes them all', async () => {
      await cache.set(k('a'), 1, 60);
      await cache.set(k('ttl'), 2, 60);
      expect(await cache.del(k('a'), k('ttl'))).toBe(true);
      expect(await cache.get(k('a'))).toBeNull();
      expect(await cache.get(k('ttl'))).toBeNull();
    });

    test('invalidateConfig(userId) deletes user:<id>:config (C-5)', async () => {
      const uid = `${NS}-u1`;
      await cache.set(`user:${uid}:config`, { c: 1 }, 60);
      expect(await cache.invalidateConfig(uid)).toBe(true);
      expect(await cache.get(`user:${uid}:config`)).toBeNull();
    });

    test('invalidateTasks(userId) deletes tasks+version+placements (C-5)', async () => {
      const uid = `${NS}-u2`;
      await cache.set(`user:${uid}:tasks`, [1], 60);
      await cache.set(`user:${uid}:version`, { v: 1 }, 60);
      await cache.set(`user:${uid}:placements`, { p: 1 }, 60);
      expect(await cache.invalidateTasks(uid)).toBe(true);
      expect(await cache.get(`user:${uid}:tasks`)).toBeNull();
      expect(await cache.get(`user:${uid}:version`)).toBeNull();
      expect(await cache.get(`user:${uid}:placements`)).toBeNull();
    });

    test('set() with no TTL persists (no expiry); value survives (C-2)', async () => {
      await cache.set(k('nottl'), { persist: true });
      expect(await cache.get(k('nottl'))).toEqual({ persist: true });
      if (o.ttlOf) expect(await o.ttlOf(cache, k('nottl'))).toBe(-1);
    });

    test('set() with TTL applies the TTL in seconds (C-2)', async () => {
      await cache.set(k('ttl'), { x: 1 }, 3600);
      if (o.ttlOf) {
        const ttl = await o.ttlOf(cache, k('ttl'));
        expect(ttl).toBeGreaterThan(3500);
        expect(ttl).toBeLessThanOrEqual(3600);
      }
      expect(await cache.get(k('ttl'))).toEqual({ x: 1 });
    });
  });
}

// ── conformance (no backing store needed) ────────────────────────────────────
describe('CachePort conformance', () => {
  test('abstract base throws on every method', () => {
    const base = new CachePort();
    CACHE_PORT_METHODS.forEach((m) => {
      expect(() => base[m]()).toThrow(/not implemented/);
    });
  });

  test('both adapters expose exactly the CACHE_PORT_METHODS surface', () => {
    [new RedisCacheAdapter(), new InMemoryCacheAdapter()].forEach((adapter) => {
      CACHE_PORT_METHODS.forEach((m) => {
        expect(typeof adapter[m]).toBe('function');
      });
    });
  });
});

// ── InMemory: always runs; uses an injectable clock for deterministic expiry ──
sharedContract('InMemoryCacheAdapter', () => new InMemoryCacheAdapter(), {
  // No native TTL inspection for in-memory; expiry is asserted separately below.
});

describe('InMemoryCacheAdapter — deterministic TTL expiry (C-2)', () => {
  test('a value past its TTL reads as a miss and is evicted', async () => {
    let nowMs = 1_000_000;
    const clock = { now: () => nowMs };
    const cache = new InMemoryCacheAdapter(clock);
    await cache.set('exp:key', { v: 1 }, 10); // 10s TTL
    expect(await cache.get('exp:key')).toEqual({ v: 1 });
    nowMs += 9_000; // 9s later — still fresh
    expect(await cache.get('exp:key')).toEqual({ v: 1 });
    nowMs += 2_000; // 11s total — expired
    expect(await cache.get('exp:key')).toBeNull();
  });

  test('a value with no TTL never expires', async () => {
    let nowMs = 0;
    const cache = new InMemoryCacheAdapter({ now: () => nowMs });
    await cache.set('noexp', { v: 2 });
    nowMs += 10 ** 12; // far future
    expect(await cache.get('noexp')).toEqual({ v: 2 });
  });
});

// ── Redis: runs only when REDIS_URL is configured (real Redis 6479) ──────────
const dRedis = HAS_REDIS ? describe : describe.skip;
dRedis('RedisCacheAdapter — real Redis required', () => {
  sharedContract('RedisCacheAdapter', () => new RedisCacheAdapter(), {
    // Wait for the lazy ioredis connection to reach 'ready' before assertions —
    // enableOfflineQueue is false, so commands before-ready fail/no-op.
    setup: async () => {
      const client = require('../src/lib/redis').getClient();
      const start = Date.now();
      while (Date.now() - start < 3000 && (!client || client.status !== 'ready')) {
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    // ioredis auto-applies its 'strivers:' keyPrefix to ttl(), so pass the
    // logical key (NOT manually prefixed).
    ttlOf: async (cache, key) => {
      const client = require('../src/lib/redis').getClient();
      return client.ttl(key);
    },
    teardown: async () => {
      await require('../src/lib/redis').quit();
    }
  });
});
