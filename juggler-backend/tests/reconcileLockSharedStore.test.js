/**
 * 999.385 — reconcileLimitsIfNeeded cross-instance dedupe lock.
 *
 * reconcileLimitsIfNeeded de-dupes the background enforceDowngradeLimits run. The
 * per-instance _reconciliationPending Map alone lets TWO Cloud Run instances each run
 * reconciliation for the same user in the same window. When Redis is connected we add a
 * SETNX lock (lib/redis.acquireLock) so only the lock winner proceeds. This suite pins:
 *
 *   - Redis ABSENT (isConnected→false): local-Map debounce ONLY — first call runs,
 *     immediate repeat is debounced (legacy behavior preserved). acquireLock is never
 *     consulted as a gate (or, if called, a false return must NOT suppress the run).
 *   - Redis PRESENT (isConnected→true): the lock winner runs; the loser (acquireLock→
 *     false) is skipped — even across two independent module instances (two "processes").
 *   - Lock errors are fail-soft → fall back to the local guard, never crash.
 *
 * lib/redis and the billing-webhooks controller are mocked — no live Redis, no DB.
 */

'use strict';

process.env.NODE_ENV = 'test';

// Wait for setImmediate-scheduled background work to flush.
function flushImmediate() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

describe('reconcileLimitsIfNeeded — cross-instance dedupe lock (999.385)', function () {
  var enforceMock;

  function loadMiddleware(redisStub) {
    jest.resetModules();
    enforceMock = jest.fn(function () { return Promise.resolve(); });
    jest.doMock('../src/controllers/billing-webhooks.controller', function () {
      return { enforceDowngradeLimits: enforceMock, handleWebhook: jest.fn() };
    });
    jest.doMock('../src/lib/redis', function () { return redisStub; });
    return require('../src/middleware/plan-features.middleware');
  }

  afterEach(function () {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('Redis ABSENT (isConnected → false)', function () {
    var redisStub = {
      isConnected: function () { return false; },
      acquireLock: jest.fn(function () { return Promise.resolve(false); })
    };

    test('first call runs; immediate repeat is locally debounced', async function () {
      var mw = loadMiddleware(redisStub);

      await mw.reconcileLimitsIfNeeded('user-absent-1', { tasks: 10 });
      await flushImmediate();
      expect(enforceMock).toHaveBeenCalledTimes(1);

      // Second call within the debounce window → suppressed by the local Map alone.
      await mw.reconcileLimitsIfNeeded('user-absent-1', { tasks: 10 });
      await flushImmediate();
      expect(enforceMock).toHaveBeenCalledTimes(1);
    });

    test('acquireLock is NOT used as a gate when Redis is disconnected', async function () {
      var mw = loadMiddleware(redisStub);
      await mw.reconcileLimitsIfNeeded('user-absent-2', { tasks: 10 });
      await flushImmediate();
      expect(enforceMock).toHaveBeenCalledTimes(1); // ran despite acquireLock→false
    });
  });

  describe('Redis PRESENT (isConnected → true)', function () {
    test('lock winner runs; lock loser is skipped', async function () {
      // Shared lock state across two module instances → models two Cloud Run instances.
      var locked = new Set();
      function sharedRedisStub() {
        return {
          isConnected: function () { return true; },
          acquireLock: jest.fn(function (key) {
            if (locked.has(key)) return Promise.resolve(false); // someone holds it
            locked.add(key);
            return Promise.resolve(true);
          })
        };
      }

      var mwA = loadMiddleware(sharedRedisStub());
      var enforceA = enforceMock;
      await mwA.reconcileLimitsIfNeeded('user-present-1', { tasks: 10 });
      await flushImmediate();
      expect(enforceA).toHaveBeenCalledTimes(1); // A won the lock

      var mwB = loadMiddleware(sharedRedisStub());
      var enforceB = enforceMock;
      await mwB.reconcileLimitsIfNeeded('user-present-1', { tasks: 10 });
      await flushImmediate();
      expect(enforceB).toHaveBeenCalledTimes(0); // B lost the lock → skipped
    });

    test('lock error is fail-soft → falls back to the local guard and still runs', async function () {
      var redisStub = {
        isConnected: function () { return true; },
        acquireLock: jest.fn(function () { return Promise.reject(new Error('redis blip')); })
      };
      var mw = loadMiddleware(redisStub);
      await mw.reconcileLimitsIfNeeded('user-present-err', { tasks: 10 });
      await flushImmediate();
      expect(enforceMock).toHaveBeenCalledTimes(1); // ran despite the lock error
    });
  });
});
