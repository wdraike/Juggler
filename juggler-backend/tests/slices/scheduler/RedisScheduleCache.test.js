/**
 * 999.1208 — Unit tests for RedisScheduleCache (ScheduleCachePort adapter).
 *
 * Source: src/slices/scheduler/adapters/RedisScheduleCache.js
 * Port contract: src/slices/scheduler/domain/ports/ScheduleCachePort.js
 *   (binding invariants SC-1..SC-5)
 *
 * No live Redis anywhere:
 *   - The CachePort dependency is injected — either the real
 *     InMemoryCacheAdapter (the contract-equal test double, per the
 *     scheduleAdapters.contract.test.js pattern) or a scripted spy/fake.
 *   - src/lib/redis is jest-mocked so invalidateUser's SCAN loop runs against
 *     a scripted fake client (multi-cursor batches, throwing client, no client).
 */

'use strict';

process.env.NODE_ENV = 'test';

// Mock the redis module BEFORE requiring the adapter (scanKeys calls
// libRedis.getClient()). mock-prefixed so jest allows the out-of-scope ref.
let mockRedisClient = null;
jest.mock('../../../src/lib/redis', () => ({
  getClient: () => mockRedisClient
}));

const RedisScheduleCache = require('../../../src/slices/scheduler/adapters/RedisScheduleCache');
const ScheduleCachePort = require('../../../src/slices/scheduler/domain/ports/ScheduleCachePort');
const InMemoryCacheAdapter = require('../../../src/lib/cache/InMemoryCacheAdapter');

/** Fake ioredis-style client whose scan() replays scripted [cursor, keys] batches. */
function makeScanClient(batches) {
  let call = 0;
  return {
    scan: jest.fn(async () => {
      const batch = batches[call];
      call += 1;
      return batch;
    })
  };
}

/** "Backing store down" CachePort double — fail-open semantics (SC-3). */
const downCache = {
  get: async () => null,
  set: async () => false,
  del: async () => false
};

describe('RedisScheduleCache — port conformance', () => {
  test('is a ScheduleCachePort and implements the full port method set', () => {
    const adapter = new RedisScheduleCache(new InMemoryCacheAdapter());
    expect(adapter instanceof ScheduleCachePort).toBe(true);
    ScheduleCachePort.SCHEDULE_CACHE_PORT_METHODS.forEach((m) => {
      expect(typeof adapter[m]).toBe('function');
    });
  });

  test('exports DEFAULT_TTL_SECONDS = 300 (matches the task-list cache TTL)', () => {
    expect(RedisScheduleCache.DEFAULT_TTL_SECONDS).toBe(300);
  });
});

describe('RedisScheduleCache — SC-5 key layout (schedule:<userId>:<date>)', () => {
  test('set/get/del all address the same namespaced key', async () => {
    const mem = new InMemoryCacheAdapter();
    const spyCache = {
      get: jest.fn((k) => mem.get(k)),
      set: jest.fn((k, v, ttl) => mem.set(k, v, ttl)),
      del: jest.fn((...keys) => mem.del(...keys))
    };
    const adapter = new RedisScheduleCache(spyCache);

    await adapter.set('u1', '2026-06-17', { placements: [1] });
    await adapter.get('u1', '2026-06-17');
    await adapter.del('u1', '2026-06-17');

    expect(spyCache.set).toHaveBeenCalledWith('schedule:u1:2026-06-17', { placements: [1] }, 300);
    expect(spyCache.get).toHaveBeenCalledWith('schedule:u1:2026-06-17');
    expect(spyCache.del).toHaveBeenCalledWith('schedule:u1:2026-06-17');
  });
});

describe('RedisScheduleCache — SC-1 JSON value semantics over InMemoryCacheAdapter', () => {
  test('round-trips a JSON-serializable schedule value-equal', async () => {
    const adapter = new RedisScheduleCache(new InMemoryCacheAdapter());
    const value = {
      dateKey: '2026-06-17',
      placements: [{ taskId: 't1', start: 540, dur: 60 }, { taskId: 't2', start: 600, dur: 30 }],
      score: { total: 2 }
    };
    await adapter.set('u1', '2026-06-17', value);
    await expect(adapter.get('u1', '2026-06-17')).resolves.toEqual(value);
  });

  test('miss resolves null', async () => {
    const adapter = new RedisScheduleCache(new InMemoryCacheAdapter());
    await expect(adapter.get('u1', '2026-06-17')).resolves.toBeNull();
  });

  test('entries are per-user + per-date — no cross-key bleed', async () => {
    const adapter = new RedisScheduleCache(new InMemoryCacheAdapter());
    await adapter.set('u1', '2026-06-17', 'a');
    await adapter.set('u1', '2026-06-18', 'b');
    await adapter.set('u2', '2026-06-17', 'c');
    await expect(adapter.get('u1', '2026-06-17')).resolves.toBe('a');
    await expect(adapter.get('u1', '2026-06-18')).resolves.toBe('b');
    await expect(adapter.get('u2', '2026-06-17')).resolves.toBe('c');
  });
});

describe('RedisScheduleCache — SC-2 TTL semantics (deterministic clock)', () => {
  let nowMs;
  let adapter;

  beforeEach(() => {
    nowMs = 1750000000000;
    adapter = new RedisScheduleCache(new InMemoryCacheAdapter({ now: () => nowMs }));
  });

  test('omitted ttlSeconds applies the 300s default: hit at +299s, miss at +300s', async () => {
    await adapter.set('u1', '2026-06-17', 'v');
    nowMs += 299 * 1000;
    await expect(adapter.get('u1', '2026-06-17')).resolves.toBe('v');
    nowMs += 1 * 1000; // exactly +300s — expiry boundary is inclusive
    await expect(adapter.get('u1', '2026-06-17')).resolves.toBeNull();
  });

  test('explicit ttlSeconds overrides the default', async () => {
    await adapter.set('u1', '2026-06-17', 'v', 60);
    nowMs += 59 * 1000;
    await expect(adapter.get('u1', '2026-06-17')).resolves.toBe('v');
    nowMs += 1 * 1000;
    await expect(adapter.get('u1', '2026-06-17')).resolves.toBeNull();
  });

  test('explicit ttlSeconds=0 persists with NO expiry (SC-2: falsy TTL = no expiry, not the 300s default)', async () => {
    // Characterization: the adapter defaults only on `undefined`; an explicit 0
    // is forwarded and the CachePort treats falsy TTL as "no expiry".
    await adapter.set('u1', '2026-06-17', 'v', 0);
    nowMs += 24 * 60 * 60 * 1000; // +1 day
    await expect(adapter.get('u1', '2026-06-17')).resolves.toBe('v');
  });
});

describe('RedisScheduleCache — del scoping', () => {
  test('del removes only the addressed user+date entry', async () => {
    const adapter = new RedisScheduleCache(new InMemoryCacheAdapter());
    await adapter.set('u1', '2026-06-17', 'a');
    await adapter.set('u1', '2026-06-18', 'b');
    await adapter.set('u2', '2026-06-17', 'c');

    await expect(adapter.del('u1', '2026-06-17')).resolves.toBe(true);

    await expect(adapter.get('u1', '2026-06-17')).resolves.toBeNull();
    await expect(adapter.get('u1', '2026-06-18')).resolves.toBe('b');
    await expect(adapter.get('u2', '2026-06-17')).resolves.toBe('c');
  });
});

describe('RedisScheduleCache — SC-3 fail-open (backing store unavailable)', () => {
  test('get resolves null, set/del resolve false — never throw', async () => {
    const adapter = new RedisScheduleCache(downCache);
    await expect(adapter.get('u1', '2026-06-17')).resolves.toBeNull();
    await expect(adapter.set('u1', '2026-06-17', 'v')).resolves.toBe(false);
    await expect(adapter.del('u1', '2026-06-17')).resolves.toBe(false);
  });

  test('invalidateUser resolves false when SCAN throws — never throws', async () => {
    mockRedisClient = { scan: jest.fn(async () => { throw new Error('redis down'); }) };
    const adapter = new RedisScheduleCache(new InMemoryCacheAdapter());
    await expect(adapter.invalidateUser('u1')).resolves.toBe(false);
  });

  test('invalidateUser propagates false when the cache DEL reports failure', async () => {
    mockRedisClient = makeScanClient([['0', ['schedule:u1:2026-06-17']]]);
    const adapter = new RedisScheduleCache(downCache);
    await expect(adapter.invalidateUser('u1')).resolves.toBe(false);
  });
});

describe('RedisScheduleCache — invalidateUser SCAN loop', () => {
  afterEach(() => { mockRedisClient = null; });

  test('no redis client -> zero keys -> resolves true without calling del', async () => {
    mockRedisClient = null;
    const spyCache = { del: jest.fn() };
    const adapter = new RedisScheduleCache(spyCache);
    await expect(adapter.invalidateUser('u1')).resolves.toBe(true);
    expect(spyCache.del).not.toHaveBeenCalled();
  });

  test('zero matching keys -> resolves true without calling del', async () => {
    mockRedisClient = makeScanClient([['0', []]]);
    const spyCache = { del: jest.fn() };
    const adapter = new RedisScheduleCache(spyCache);
    await expect(adapter.invalidateUser('u1')).resolves.toBe(true);
    expect(spyCache.del).not.toHaveBeenCalled();
  });

  test('scans with the SC-5 user pattern and iterative cursor (COUNT 100), deleting every batch key', async () => {
    mockRedisClient = makeScanClient([
      ['17', ['schedule:u1:2026-06-17']],
      ['0', ['schedule:u1:2026-06-18', 'schedule:u1:2026-06-19']]
    ]);
    const spyCache = { del: jest.fn(async () => true) };
    const adapter = new RedisScheduleCache(spyCache);

    await expect(adapter.invalidateUser('u1')).resolves.toBe(true);

    expect(mockRedisClient.scan).toHaveBeenCalledTimes(2);
    expect(mockRedisClient.scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'schedule:u1:*', 'COUNT', 100);
    expect(mockRedisClient.scan).toHaveBeenNthCalledWith(2, '17', 'MATCH', 'schedule:u1:*', 'COUNT', 100);
    // All keys from every SCAN batch deleted in ONE variadic del call.
    expect(spyCache.del).toHaveBeenCalledTimes(1);
    expect(spyCache.del).toHaveBeenCalledWith(
      'schedule:u1:2026-06-17', 'schedule:u1:2026-06-18', 'schedule:u1:2026-06-19'
    );
  });

  test('end-to-end over InMemoryCacheAdapter: busts ALL dates for the user, leaves other users cached', async () => {
    const mem = new InMemoryCacheAdapter();
    const adapter = new RedisScheduleCache(mem);
    await adapter.set('u1', '2026-06-17', 'a');
    await adapter.set('u1', '2026-06-18', 'b');
    await adapter.set('u2', '2026-06-17', 'c');

    // Fake client scans the in-memory store's real keys with prefix matching.
    mockRedisClient = {
      scan: jest.fn(async (_cursor, _m, pattern) => {
        const prefix = pattern.slice(0, -1); // strip trailing '*'
        const keys = Array.from(mem._store.keys()).filter((k) => k.startsWith(prefix));
        return ['0', keys];
      })
    };

    await expect(adapter.invalidateUser('u1')).resolves.toBe(true);

    await expect(adapter.get('u1', '2026-06-17')).resolves.toBeNull();
    await expect(adapter.get('u1', '2026-06-18')).resolves.toBeNull();
    await expect(adapter.get('u2', '2026-06-17')).resolves.toBe('c'); // untouched
  });
});
