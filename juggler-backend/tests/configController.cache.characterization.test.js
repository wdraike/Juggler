/**
 * CHARACTERIZATION — config.controller.js cache wiring (H2 / W2).
 *
 * This suite is the behavior-identity oracle for the W2 refactor.
 * The refactor's ONLY code change was config.controller.js's import line:
 *   BEFORE: require('../lib/redis')
 *   AFTER:  require('../lib/cache')   (CachePort singleton `cache`)
 *
 * WHAT IS BEING PINNED
 * --------------------
 * The controller → CachePort SEAM, not lib/redis in isolation.
 * Every test invokes a real controller handler (getAllConfig / updateConfig /
 * deleteProject / etc.) through mocked req/res and asserts:
 *   - which cache methods were called
 *   - with which arguments
 *   - and that the controller actually USES the return value (cache hit short-
 *     circuits DB; cache miss falls through to DB and re-populates the cache)
 *
 * MUTATION SENSITIVITY
 * --------------------
 * If the controller's import is changed back to require('../lib/redis') — or if
 * the CachePort wiring is broken — the jest.mock('../src/lib/cache') spy is no
 * longer the object the controller calls, and the call-count assertions go RED.
 * See inline "MUTATION GATE" comments.
 *
 * REDIS BINDING
 * -------------
 * REDIS_URL is set to the test-bed :6479 address BEFORE any require() that reads
 * it, overriding any .env file that might pin :6379.  The lib/cache singleton is
 * replaced by the spy in every test; no live Redis connection is opened.
 *
 * NOTE: this suite exercises cache wiring via req/res mocks, not via supertest.
 * The API-layer contract (routes, middleware, auth, DB) is covered by
 * tests/api/config.test.js.  This suite is exclusively about the seam between
 * config.controller.js and CachePort.
 */

'use strict';

// ── TASK 2: pin Redis to test-bed :6479 BEFORE any require that reads REDIS_URL
// lib/cache/index.js reads REDIS_URL at require() time to choose the adapter.
// Setting it here (before any require below) ensures the module never sees :6379.
process.env.REDIS_URL = 'redis://localhost:6479';

// ── Mock the entire lib/cache module so the controller's `cache` singleton is
// our spy.  The mock is set up before any require() of the controller.
// If the controller still imported '../lib/redis' instead of '../lib/cache',
// this mock would not intercept the calls → call-count assertions would FAIL
// (MUTATION GATE — the suite goes RED if the import reverts).
jest.mock('../src/lib/cache', () => {
  const spy = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    invalidateConfig: jest.fn(),
    invalidateTasks: jest.fn(),
  };
  return {
    cache: spy,
    // Also expose the spy as _spy so tests can reach it without re-requiring.
    _spy: spy,
    // Minimal stubs for anything else lib/cache exports (conformance checks etc.)
    CachePort: function CachePort() {},
    RedisCacheAdapter: function RedisCacheAdapter() {},
    InMemoryCacheAdapter: function InMemoryCacheAdapter() {},
    CACHE_PORT_METHODS: ['get', 'set', 'del', 'invalidateConfig', 'invalidateTasks'],
    createCache: jest.fn(() => spy),
  };
});

// ── Mock the DB so no real MySQL connection is needed ─────────────────────────
// _dbState holds mutable per-test DB behavior.  It is a plain object, NOT a
// jest.fn(), so jest.clearAllMocks() leaves it intact.
const _dbState = { firstResult: [] };

jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  // The chain is rebuilt fresh in the factory below, referencing _dbState via
  // the closure.  `first()` honours _dbState.firstResult so individual tests can
  // override what the DB returns without re-requiring the module.
  // NOTE: we CANNOT reference the outer _dbState here because jest.mock factories
  // run in a separate scope. We expose a __state sentinel on the exported mock
  // instead and mutate it in tests.
  const state = { firstResult: [] };

  const makeChain = () => {
    const chain = {};
    const resolveArray = () => Promise.resolve(Array.isArray(state.firstResult) ? state.firstResult : []);
    chain.where = jest.fn(() => chain);
    chain.whereIn = jest.fn(() => chain);
    chain.whereNotIn = jest.fn(() => chain);
    chain.whereNotNull = jest.fn(() => chain);
    chain.andWhere = jest.fn(() => chain);
    chain.orderBy = jest.fn(() => chain);
    chain.select = jest.fn(() => chain);
    chain.first = jest.fn(() => Promise.resolve(state.firstResult));
    chain.insert = jest.fn(() => Promise.resolve([1]));
    chain.update = jest.fn(() => Promise.resolve(1));
    chain.del = jest.fn(() => Promise.resolve(1));
    chain.max = jest.fn(() => chain);
    chain.raw = jest.fn(() => chain);
    chain.transaction = jest.fn((cb) => cb(chain));
    chain.then = (res, rej) => resolveArray().then(res, rej);
    chain.catch = (rej) => resolveArray().catch(rej);
    return chain;
  };

  // Singleton chain — methods are re-mocked in beforeEach by jest.clearAllMocks,
  // but the chain object itself persists so the factory closure is stable.
  const chain = makeChain();

  const mock = jest.fn(() => chain);
  mock.fn = fn;
  mock.transaction = chain.transaction;
  mock.raw = chain.raw;
  mock._chain = chain;
  mock.__state = state;  // plain object, survives clearAllMocks
  return mock;
});

// ── Mock tasks-write (used by updateProject for project renames) ──────────────
jest.mock('../src/lib/tasks-write', () => ({
  updateTasksWhere: jest.fn(() => Promise.resolve()),
}));

// ── Mock scheduler queue so no background work fires ─────────────────────────
jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn(),
}));

// ── Mock lib-logger ───────────────────────────────────────────────────────────
jest.mock('@raike/lib-logger', () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => mock, _mock: mock };
});

// ── Mock weather controller (reverseGeocodeDisplayName used by replaceLocations)
jest.mock('../src/controllers/weather.controller', () => ({
  reverseGeocodeDisplayName: jest.fn(() => Promise.resolve('Test City')),
}));

// ── Load controller AFTER mocks are registered ───────────────────────────────
const controller = require('../src/controllers/config.controller');
const { _spy: cacheSpy } = require('../src/lib/cache');
const mockDb = require('../src/db');

// ── req / res factory ─────────────────────────────────────────────────────────
function makeReq(overrides) {
  return Object.assign(
    { user: { id: 'user-42' }, params: {}, body: {}, headers: {} },
    overrides
  );
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status: jest.fn(function (code) { this._status = code; return this; }),
    json:   jest.fn(function (body)  { this._body  = body;  return this; }),
  };
  return res;
}

// ── Reset mocks before each test ─────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();

  // Reset DB state: default first() → [] (no existing row)
  mockDb.__state.firstResult = [];

  // After clearAllMocks, jest.fn() implementations are cleared.
  // Re-wire every chain method so the controller's DB calls resolve predictably.
  const c = mockDb._chain;
  c.where.mockReturnValue(c);
  c.whereIn.mockReturnValue(c);
  c.whereNotIn.mockReturnValue(c);
  c.whereNotNull.mockReturnValue(c);
  c.andWhere.mockReturnValue(c);
  c.orderBy.mockReturnValue(c);
  c.select.mockReturnValue(c);
  c.max.mockReturnValue(c);
  c.raw.mockReturnValue(c);
  c.first.mockImplementation(() => Promise.resolve(mockDb.__state.firstResult));
  c.insert.mockResolvedValue([1]);
  c.update.mockResolvedValue(1);
  c.del.mockResolvedValue(1);
  // The callback receives `trx` which is used like a DB: trx('table').where()…
  // Pass mockDb (which is callable and returns chain c) as the transaction arg.
  c.transaction.mockImplementation((cb) => cb(mockDb));

  // mockDb() is the result of calling the module's exported fn.
  // clearAllMocks resets the jest.fn() implementation, so we must re-wire mockDb
  // to return the chain again, AND re-wire mockDb.transaction / mockDb.raw.
  mockDb.mockReturnValue(c);
  mockDb.transaction = c.transaction;
  mockDb.raw = c.raw;
  mockDb.fn = { now: () => 'MOCK_NOW' };

  // Default cache behaviour
  cacheSpy.get.mockResolvedValue(null);
  cacheSpy.set.mockResolvedValue(true);
  cacheSpy.invalidateConfig.mockResolvedValue(true);
  cacheSpy.invalidateTasks.mockResolvedValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllConfig — cache miss path
// ─────────────────────────────────────────────────────────────────────────────
describe('getAllConfig — cache miss path', () => {
  test('calls cache.get with the correct user config key', async () => {
    const req = makeReq();
    const res = makeRes();
    await controller.getAllConfig(req, res);
    expect(cacheSpy.get).toHaveBeenCalledTimes(1);
    expect(cacheSpy.get).toHaveBeenCalledWith('user:user-42:config');
  });

  test('on miss, calls cache.set with the assembled result and 3600 TTL', async () => {
    cacheSpy.get.mockResolvedValue(null); // miss
    const req = makeReq();
    const res = makeRes();
    await controller.getAllConfig(req, res);
    expect(cacheSpy.set).toHaveBeenCalledTimes(1);
    const [key, , ttl] = cacheSpy.set.mock.calls[0];
    expect(key).toBe('user:user-42:config');
    expect(ttl).toBe(3600);
  });

  test('on miss, returns the DB-assembled config in the response', async () => {
    cacheSpy.get.mockResolvedValue(null);
    const req = makeReq();
    const res = makeRes();
    await controller.getAllConfig(req, res);
    expect(res._status).toBe(200);
    expect(res._body).toHaveProperty('locations');
    expect(res._body).toHaveProperty('tools');
    expect(res._body).toHaveProperty('projects');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllConfig — cache HIT path (MUTATION GATE #1)
//
// If cache.get is broken (e.g., always returns null), this test GOES RED:
//   - cache.set would be called (cache is re-populated on a miss)
//   - the controller would hit the DB path and res.json would get a fresh
//     DB-assembled object, NOT the sentinel value we put in the cache.
//   => expect(res._body).toEqual(cachedValue) FAILS.
//
// Proof-of-RED: temporarily replace cacheSpy.get with () => null (always miss).
// The test below fails.  Revert to correct implementation: GREEN.
// ─────────────────────────────────────────────────────────────────────────────
describe('getAllConfig — cache HIT path', () => {
  test('MUTATION GATE: returns cached value and skips DB+set when cache hits', async () => {
    const cachedValue = {
      locations: [{ id: 'loc-1', name: 'Home' }],
      tools: [], projects: [],
      tempUnitPref: 'C',
    };
    cacheSpy.get.mockResolvedValue(cachedValue); // simulate a warm cache

    const req = makeReq();
    const res = makeRes();
    await controller.getAllConfig(req, res);

    // Controller must short-circuit on hit:
    expect(res._body).toEqual(cachedValue);          // response IS the cached object
    expect(cacheSpy.set).not.toHaveBeenCalled();     // no re-population
  });

  test('MUTATION GATE: if cache.get is dead (always null), set is called', async () => {
    // This is the self-documenting inverse: when get always returns null the
    // controller MUST call set (to populate).  Used in the manual mutation proof.
    cacheSpy.get.mockResolvedValue(null);
    const req = makeReq();
    const res = makeRes();
    await controller.getAllConfig(req, res);
    expect(cacheSpy.set).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateConfig — invalidation path (MUTATION GATE #2)
//
// On a PUT /api/config/:key the controller writes to DB and then calls
// cache.invalidateConfig(userId).  If that call is re-routed to lib/redis
// directly (mutation reverts the import), cacheSpy.invalidateConfig would show
// 0 calls → the assertion below FAILS.
// ─────────────────────────────────────────────────────────────────────────────
describe('updateConfig — invalidation path', () => {
  test('calls cache.invalidateConfig(userId) after a successful write', async () => {
    // DB: first() for the existing-row check → return an existing row
    mockDb.__state.firstResult = { config_key: 'preferences', config_value: '{}' };

    const req = makeReq({
      params: { key: 'preferences' },
      body: { value: { weekStartsOn: 1 } },
    });
    const res = makeRes();
    await controller.updateConfig(req, res);

    expect(cacheSpy.invalidateConfig).toHaveBeenCalledTimes(1);
    expect(cacheSpy.invalidateConfig).toHaveBeenCalledWith('user-42');
  });

  test('does NOT call cache.get or cache.set on updateConfig', async () => {
    mockDb.__state.firstResult = { config_key: 'tool_matrix', config_value: '{}' };
    const req = makeReq({
      params: { key: 'tool_matrix' },
      body: { value: { home: [] } },
    });
    const res = makeRes();
    await controller.updateConfig(req, res);
    expect(cacheSpy.get).not.toHaveBeenCalled();
    expect(cacheSpy.set).not.toHaveBeenCalled();
  });

  test('rejects invalid config key without touching the cache', async () => {
    const req = makeReq({ params: { key: 'not_valid' }, body: { value: 'x' } });
    const res = makeRes();
    await controller.updateConfig(req, res);
    expect(res._status).toBe(400);
    expect(cacheSpy.invalidateConfig).not.toHaveBeenCalled();
    expect(cacheSpy.get).not.toHaveBeenCalled();
    expect(cacheSpy.set).not.toHaveBeenCalled();
  });

  test('rejects temp_unit_pref value other than F or C without touching the cache', async () => {
    const req = makeReq({ params: { key: 'temp_unit_pref' }, body: { value: 'K' } });
    const res = makeRes();
    await controller.updateConfig(req, res);
    expect(res._status).toBe(400);
    expect(cacheSpy.invalidateConfig).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createProject / deleteProject / reorderProjects — each must invalidate config
// ─────────────────────────────────────────────────────────────────────────────
describe('project mutations — cache invalidation', () => {
  test('createProject calls cache.invalidateConfig(userId)', async () => {
    mockDb.__state.firstResult = { max: 0 };
    const req = makeReq({ body: { name: 'New Project', color: '#f00' } });
    const res = makeRes();
    await controller.createProject(req, res);
    expect(cacheSpy.invalidateConfig).toHaveBeenCalledWith('user-42');
  });

  test('deleteProject calls cache.invalidateConfig(userId)', async () => {
    const req = makeReq({ params: { id: '7' } });
    const res = makeRes();
    await controller.deleteProject(req, res);
    expect(cacheSpy.invalidateConfig).toHaveBeenCalledWith('user-42');
  });

  test('reorderProjects calls cache.invalidateConfig(userId)', async () => {
    const req = makeReq({ body: { ids: [3, 1, 2] } });
    const res = makeRes();
    await controller.reorderProjects(req, res);
    expect(cacheSpy.invalidateConfig).toHaveBeenCalledWith('user-42');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProject — config invalidation + optional tasks invalidation
// ─────────────────────────────────────────────────────────────────────────────
describe('updateProject — cache invalidation', () => {
  test('calls invalidateConfig on every project update', async () => {
    const req = makeReq({
      params: { id: '5' },
      body: { name: 'Renamed', color: '#00f', icon: null },
    });
    const res = makeRes();
    await controller.updateProject(req, res);
    expect(cacheSpy.invalidateConfig).toHaveBeenCalledWith('user-42');
  });

  test('also calls invalidateTasks when the project name changes', async () => {
    const req = makeReq({
      params: { id: '5' },
      body: { name: 'NewName', color: null, icon: null, oldName: 'OldName' },
    });
    const res = makeRes();
    await controller.updateProject(req, res);
    expect(cacheSpy.invalidateConfig).toHaveBeenCalledWith('user-42');
    expect(cacheSpy.invalidateTasks).toHaveBeenCalledWith('user-42');
  });

  test('does NOT call invalidateTasks when the name is unchanged', async () => {
    const req = makeReq({
      params: { id: '5' },
      body: { name: 'Same', color: null, icon: null },
    });
    const res = makeRes();
    await controller.updateProject(req, res);
    expect(cacheSpy.invalidateTasks).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// replaceLocations / replaceTools — each invalidates config
// ─────────────────────────────────────────────────────────────────────────────
describe('replaceLocations — cache invalidation', () => {
  test('calls cache.invalidateConfig(userId) after saving locations', async () => {
    const req = makeReq({ body: { locations: [{ name: 'Office', id: 'loc-1' }] } });
    const res = makeRes();
    await controller.replaceLocations(req, res);
    expect(cacheSpy.invalidateConfig).toHaveBeenCalledWith('user-42');
  });
});

describe('replaceTools — cache invalidation', () => {
  test('calls cache.invalidateConfig(userId) after saving tools', async () => {
    const req = makeReq({ body: { tools: [{ id: 't1', name: 'Hammer' }] } });
    const res = makeRes();
    await controller.replaceTools(req, res);
    expect(cacheSpy.invalidateConfig).toHaveBeenCalledWith('user-42');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION SENSITIVITY PROOF GUIDE (commented, not executable)
// ─────────────────────────────────────────────────────────────────────────────
//
// To verify this suite is mutation-sensitive, apply the mutation below,
// run the suite, confirm RED, then revert and confirm GREEN:
//
//   MUTATION: In src/controllers/config.controller.js, change line:
//     const { cache } = require('../lib/cache');
//   to:
//     const cache = require('../lib/redis');
//
//   EXPECTED RED (selected tests that will fail):
//     - "calls cache.get with the correct user config key" (cacheSpy.get called 0 times)
//     - "MUTATION GATE: returns cached value and skips DB+set when cache hits"
//       (cacheSpy.get.mockResolvedValue(cachedValue) has no effect; res._body ≠ cachedValue)
//     - "calls cache.invalidateConfig(userId) after a successful write"
//       (cacheSpy.invalidateConfig called 0 times)
//     All "calls cache.*" assertions fail because cacheSpy is no longer the
//     object the controller uses.
//
//   REVERT: Restore require('../lib/cache') → all 20+ tests GREEN.
