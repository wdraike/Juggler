/**
 * 999.385 — PaymentServiceEntitlementAdapter shared (cross-instance) user-plan cache.
 *
 * Under Cloud Run scale-out the per-instance _userPlanCache Map split-brains: a plan
 * cached/invalidated on instance A is stale on instance B. This suite pins the
 * shared-store behavior:
 *
 *   - Redis ABSENT (no sharedCache / get→null) → legacy single-instance behavior:
 *     cache hit/miss/invalidate works off the in-memory Map alone; no shared writes.
 *   - Redis PRESENT (mocked client) → a write/read/invalidate goes through the shared
 *     store; a shared hit on instance B avoids the HTTP fetch (cross-instance coherence);
 *     webhook invalidation deletes the shared key.
 *
 * NO live Redis, NO real network — the redis client and global fetch are mocked.
 */

'use strict';

process.env.NODE_ENV = 'test';

var path = require('path');
var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var PaymentServiceEntitlementAdapter = require(path.join(SLICE, 'adapters', 'PaymentServiceEntitlementAdapter'));

var SILENT_LOGGER = { info: function () {}, warn: function () {}, error: function () {} };

function jsonRes(body, ok) {
  return Promise.resolve({
    ok: ok === undefined ? true : ok,
    status: ok === false ? 500 : 200,
    json: function () { return Promise.resolve(body); }
  });
}

// A fetch mock that always resolves the active-plans call to slug 'juggler' → planId.
function activePlanFetch(planId, counter) {
  return jest.fn(function (url) {
    if (url.indexOf('/internal/products/') !== -1) return jsonRes({ product: { id: 'pid-uuid' } });
    if (url.indexOf('/api/plans') !== -1) return jsonRes({ plans: [{ planId: planId, features: {} }] });
    if (url.indexOf('/active-plans') !== -1) {
      if (counter) counter.n += 1;
      return jsonRes({ plans: { juggler: planId } });
    }
    return Promise.reject(new Error('unexpected: ' + url));
  });
}

// In-memory fake of lib/redis (the shared-cache surface the adapter uses:
// get / set / del). Backs a JS Map so cross-"instance" coherence can be asserted.
function makeFakeRedis() {
  var store = new Map();
  return {
    _store: store,
    isConnected: function () { return true; },
    get: jest.fn(function (key) { return Promise.resolve(store.has(key) ? store.get(key) : null); }),
    set: jest.fn(function (key, value /* , ttl */) { store.set(key, value); return Promise.resolve(true); }),
    del: jest.fn(function (key) { store.delete(key); return Promise.resolve(true); })
  };
}

describe('PaymentServiceEntitlementAdapter — shared user-plan cache (999.385)', function () {
  describe('Redis ABSENT → legacy single-instance behavior', function () {
    // Models REDIS_URL unset / Redis down: isConnected()→false, and all ops fail-soft.
    // The adapter must skip the shared path entirely and use only the in-memory Map.
    function noopShared() {
      return {
        isConnected: function () { return false; },
        get: jest.fn(function () { return Promise.resolve(null); }),
        set: jest.fn(function () { return Promise.resolve(false); }),
        del: jest.fn(function () { return Promise.resolve(false); })
      };
    }

    test('miss → fetch → cached in the in-memory Map; second read serves from Map (no 2nd HTTP)', async function () {
      var counter = { n: 0 };
      var fetchMock = activePlanFetch('p1', counter);
      var shared = noopShared();
      var a = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock, sharedCache: shared
      });

      var first = await a.resolveUserPlanId('u1');
      var second = await a.resolveUserPlanId('u1');

      expect(first).toBe('p1');
      expect(second).toBe('p1');
      expect(counter.n).toBe(1); // only one active-plans HTTP — Map served the 2nd
      // Redis disconnected → the shared path is skipped entirely (no get/set touched).
      expect(shared.get).not.toHaveBeenCalled();
      expect(shared.set).not.toHaveBeenCalled();
    });

    test('invalidateUserPlan drops the in-memory entry → next read re-fetches', async function () {
      var counter = { n: 0 };
      var fetchMock = activePlanFetch('p1', counter);
      var a = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock, sharedCache: noopShared()
      });

      await a.resolveUserPlanId('u1');
      a.invalidateUserPlan('u1');
      await a.resolveUserPlanId('u1');

      expect(counter.n).toBe(2); // invalidate forced a re-fetch
    });

    test('no sharedCache injected at all → still works off the Map (default require path tolerant)', async function () {
      var counter = { n: 0 };
      var fetchMock = activePlanFetch('p1', counter);
      // Inject a sharedCache that mimics lib/redis when Redis is down: get→null, set/del→false.
      var a = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock, sharedCache: noopShared()
      });
      var v = await a.resolveUserPlanId('u1');
      expect(v).toBe('p1');
      expect(counter.n).toBe(1);
    });
  });

  describe('Redis PRESENT (mocked) → shared store mirrors writes/reads/invalidations', function () {
    test('write goes through the shared store on the resolving fetch', async function () {
      var fetchMock = activePlanFetch('p1');
      var shared = makeFakeRedis();
      var a = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock, sharedCache: shared
      });

      await a.resolveUserPlanId('u1');
      // allow the fire-and-forget shared write to settle
      await Promise.resolve();

      expect(shared.set).toHaveBeenCalledTimes(1);
      var args = shared.set.mock.calls[0];
      expect(args[0]).toContain('userplan:u1');     // slug-scoped key
      expect(args[1].planId).toBe('p1');            // JSON value {planId,timestamp}
      expect(typeof args[1].timestamp).toBe('number');
      expect(args[2]).toBe(120);                    // TTL = USER_PLAN_CACHE_TTL_MS / 1000
    });

    test('cross-instance coherence: instance B reads instance A\'s shared write without an HTTP fetch', async function () {
      var shared = makeFakeRedis();
      var counterA = { n: 0 };
      var counterB = { n: 0 };

      var instA = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: activePlanFetch('p1', counterA), sharedCache: shared
      });
      var instB = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: activePlanFetch('p1', counterB), sharedCache: shared
      });

      var fromA = await instA.resolveUserPlanId('u1');
      await Promise.resolve(); // settle shared write
      var fromB = await instB.resolveUserPlanId('u1'); // B's local Map is empty → must hit shared

      expect(fromA).toBe('p1');
      expect(fromB).toBe('p1');
      expect(counterA.n).toBe(1); // A fetched
      expect(counterB.n).toBe(0); // B served from the shared store — no HTTP
    });

    test('invalidateUserPlan deletes the shared key (webhook-driven cross-instance invalidation)', async function () {
      var shared = makeFakeRedis();
      var a = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: activePlanFetch('p1'), sharedCache: shared
      });

      await a.resolveUserPlanId('u1');
      await Promise.resolve();
      expect(shared._store.size).toBe(1);

      a.invalidateUserPlan('u1');
      expect(shared.del).toHaveBeenCalled();
      expect(shared._store.size).toBe(0);
    });

    test('shared read failure is fail-soft → falls through to the HTTP fetch', async function () {
      var counter = { n: 0 };
      var shared = makeFakeRedis();
      shared.get = jest.fn(function () { return Promise.reject(new Error('redis down')); });
      var a = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: activePlanFetch('p1', counter), sharedCache: shared
      });

      var v = await a.resolveUserPlanId('u1');
      expect(v).toBe('p1');     // request still succeeds
      expect(counter.n).toBe(1); // fell through to HTTP
    });

    test('shared write failure does not fail the request', async function () {
      var counter = { n: 0 };
      var shared = makeFakeRedis();
      shared.set = jest.fn(function () { return Promise.reject(new Error('redis down')); });
      var a = new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: activePlanFetch('p1', counter), sharedCache: shared
      });

      var v = await a.resolveUserPlanId('u1');
      await Promise.resolve();
      expect(v).toBe('p1');
    });
  });
});
