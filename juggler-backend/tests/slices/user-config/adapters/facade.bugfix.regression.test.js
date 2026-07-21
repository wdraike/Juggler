/**
 * BUGFIX REGRESSION — facade.js B1 + B2 (juggler-h4-cache-catalog-renametask-fix)
 *
 * This file exercises the REAL facade wiring. Each test drives the actual facade
 * module (not a copy, not a shim, not an isolated use-case) and proves:
 *   – PRE-FIX: the assertion FAILS (true repro of the bug).
 *   – POST-FIX: the assertion PASSES (bert's fix is in effect).
 *
 * ── B1 — Plan-CATALOG cache split-brain (facade.js:348-352) ─────────────────
 * BUG (pre-fix): `_billingEntitlement.resolvePlanCatalog` called
 *   `require('…/plan-features.middleware').getCachedPlanFeatures()` — a SEPARATE
 *   module-level catalog cache. After facade.checkEntitlement warmed the adapter
 *   instance cache (1 fetch), facade.handleBillingWebhook's downgrade_applied path
 *   called the cold legacy cache → a SECOND catalog fetch.
 *
 * FIX: `_billingEntitlement.resolvePlanCatalog` routes to
 *   `_entitlement.resolvePlanCatalog()` — the same adapter-instance cache.
 *   Only 1 fetch total after warm.
 *
 * TRUE REPRO STRATEGY:
 *   1. Set `global.fetch` to a counting mock before requiring the facade in an
 *      isolated module registry (jest.isolateModules).
 *   2. Call the REAL `facade.checkEntitlement({ user: {id} })` → warms
 *      `_entitlement`'s catalog cache (1 /api/plans fetch).
 *   3. Call the REAL `facade.handleBillingWebhook(downgrade_event)` → exercises
 *      the REAL `_billingEntitlement.resolvePlanCatalog` from the facade's wiring.
 *   4. Assert `global.fetch` was called exactly 2 times total (1 product-discovery
 *      + 1 catalog fetch), NOT 3 (which would indicate a second catalog fetch).
 *      OR: assert catalogFetches === 1 by counting /api/plans hits only.
 *
 * TRUE-REPRO VERIFIED (inverse-edit method):
 *   Temporarily changed facade.js:349-350 to call
 *     `require('../../middleware/plan-features.middleware').getCachedPlanFeatures()`
 *   → B1 assertion FAILED (catalogFetches became 2 after the webhook call).
 *   Restored `_entitlement.resolvePlanCatalog()` → PASSED (catalogFetches stayed 1).
 *   For B1-DOWNGRADE: same revert → FAILED (count=2). Restored → PASSED (count=1).
 *
 * ── B2 — renameTasks server-clock timestamp (facade.js:124) ─────────────────
 * BUG (pre-fix): `renameTasks` passed `{ project: name, updated_at: new Date() }`
 *   to `tasksWrite.updateTasksWhere` (JS app-clock Date, not MySQL server clock).
 *
 * FIX: `renameTasks` now passes `{ project: name, updated_at: trxRepo.db.fn.now() }`
 *   — the knex Raw fragment (MySQL server clock).
 *
 * TRUE REPRO STRATEGY:
 *   Spy on `tasksWrite.updateTasksWhere` via jest.isolateModules + jest.mock.
 *   Drive the REAL `facade.updateProject({ userId, id, body: { name, oldName } })`
 *   so the rename branch fires. Capture `changes`. Assert `updated_at` is NOT
 *   instanceof Date (knex Raw 'MOCK_NOW', not a JS Date).
 *
 * TRUE-REPRO VERIFIED (inverse-edit method):
 *   Temporarily changed facade.js:124 to `updated_at: new Date()`.
 *   → B2 assertion FAILED (Expected: not Date, Received: [Date]).
 *   Restored `trxRepo.db.fn.now()` → PASSED.
 *
 * Traceability: juggler-h4-cache-catalog-renametask-fix TRACEABILITY.md B1 / B2.
 * Mode: bugfix. Tier: unit (no network, no DB — global.fetch stub + mockChainDb).
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.PRODUCT_LABEL = 'juggler';
// Pool/CI runs inject their slot's REDIS_URL — honor it. Pin the fixed
// test-bed :6479 ONLY when unset (bare `npx jest` on a dev shell). The old
// unconditional pin stomped the injected env: the suite silently escaped its
// pool slot locally and dialed a nonexistent localhost in the CI container
// (run 29382813936).
if (!process.env.REDIS_URL) process.env.REDIS_URL = 'redis://localhost:6479';
process.env.INTERNAL_SERVICE_KEY = 'test-key-b1b2';

var path = require('path');
var { createMockChainDb } = require('../../../helpers/mockChainDb');

// ── Module-level state object (mock-prefixed so jest.mock factories can reference it) ──
// Babel-jest permits variables prefixed 'mock' in jest.mock factory functions.
// Reset at the start of each test via mockSharedState.reset().
var mockSharedState = {
  catalogFetches: 0,
  capturedChanges: null,
  reset: function () {
    mockSharedState.catalogFetches = 0;
    mockSharedState.capturedChanges = null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared fetch-stub builder
// ─────────────────────────────────────────────────────────────────────────────

var CATALOG_PAYLOAD = {
  plans: [
    { planId: 'plan-paid', features: { limits: { active_tasks: -1 }, ai: { enrich: true } } },
    { planId: 'free',      features: { limits: { active_tasks: 5  }, ai: { enrich: false } } }
  ]
};

/**
 * Build a global.fetch replacement that routes by URL:
 *   /internal/products/  → product discovery (returns null id, fail-soft)
 *   /api/plans           → catalog fetch; increments mockSharedState.catalogFetches
 *   /active-plans        → user-plan lookup; returns planId='plan-paid'
 *
 * All three URLs are needed because PaymentServiceEntitlementAdapter.resolvePlanCatalog
 * calls _fetchPlanCatalog → resolveProductId (product discovery) then /api/plans.
 * resolveUserPlanId calls /active-plans.
 */
function makeCountingFetch() {
  return jest.fn(function (url) {
    var u = typeof url === 'string' ? url : String(url);

    if (u.indexOf('/internal/products/') !== -1) {
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ product: { id: null } }); }
      });
    }

    if (u.indexOf('/api/plans') !== -1) {
      mockSharedState.catalogFetches++;
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve(CATALOG_PAYLOAD); }
      });
    }

    if (u.indexOf('/active-plans') !== -1) {
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ plans: { juggler: 'plan-paid' } }); }
      });
    }

    return Promise.reject(new Error('Unexpected fetch URL: ' + u));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// B1 — Plan-CATALOG cache split-brain: real facade path
// ─────────────────────────────────────────────────────────────────────────────

describe('B1 — REGRESSION (real facade): plan-catalog cache split-brain after checkEntitlement warms cache', function () {
  beforeEach(() => {
    // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
    installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });


  /**
   * B1: After facade.checkEntitlement warms the adapter catalog cache (1 fetch),
   * facade.handleBillingWebhook's downgrade_applied path MUST reuse the warm cache.
   *
   * POST-FIX (GREEN): catalogFetches === 1 (both paths share _entitlement's cache).
   * PRE-FIX (RED):    catalogFetches === 2 (split-brain: _billingEntitlement routed
   *                   to getCachedPlanFeatures which hits the cold legacy cache,
   *                   triggering a 2nd /api/plans fetch via global.fetch).
   *
   * This test drives the REAL facade. The adapter's lazy this._fetch() reads
   * global.fetch at call time, so the counting stub set before loading the facade
   * is honored by every subsequent payment-service call.
   */
  test('B1: checkEntitlement warms catalog cache; handleBillingWebhook(downgrade) reuses warm cache (catalogFetches stays 1)', async function () {
    mockSharedState.reset();
    var savedFetch = global.fetch;
    global.fetch = makeCountingFetch();

    var facade;
    await jest.isolateModules(async function () {
      jest.mock('../../../../src/lib/db', function () {
        var h = require('../../../helpers/mockChainDb');
        var r = h.createMockChainDb();
        return { getDefaultDb: function () { return r.mockDb; } };
      });
      jest.mock('../../../../src/lib/cache', function () {
        var s = {
          get: jest.fn(function () { return Promise.resolve(null); }),
          set: jest.fn(function () { return Promise.resolve(true); }),
          invalidateConfig: jest.fn(function () { return Promise.resolve(true); }),
          invalidateTasks: jest.fn(function () { return Promise.resolve(true); })
        };
        return { cache: s };
      });
      // 999.1199: textually IDENTICAL to the B2 block's mock (including the
      // capturedChanges-recording body, even though this test never asserts on
      // it) — kept identical across all three describe blocks in this file.
      // jest's mock factory registration for a given path was observed to be
      // sticky to the FIRST-registered factory across sequential
      // jest.isolateModules calls within one test file (a divergent shape in an
      // earlier block silently wins for later blocks too), so all three must
      // agree byte-for-byte on every mocked path they share.
      jest.mock('../../../../src/lib/tasks-write', function () {
        return {
          updateTasksWhere: jest.fn(function (db, userId, applyWhere, changes) {
            mockSharedState.capturedChanges = changes;
            return Promise.resolve(1);
          }),
          deleteTasksWhere: jest.fn(function () { return Promise.resolve(1); }),
          insertTask: jest.fn(function () { return Promise.resolve(); }),
          updateTaskById: jest.fn(function () { return Promise.resolve(1); }),
          deleteTaskById: jest.fn(function () { return Promise.resolve(1); })
        };
      });
      jest.mock('../../../../src/lib/usage-reporter', function () {
        return { reportUsage: jest.fn(), setProductIdResolver: jest.fn() };
      });
      jest.mock('@raike/lib-logger', function () {
        var noop = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        return { createLogger: function () { return noop; } };
      });
      // plan-features.middleware — getCachedPlanFeatures is the PRE-FIX path.
      // Post-fix: _billingEntitlement.resolvePlanCatalog does NOT call this.
      // Pre-fix: it would — and since this mock itself calls global.fetch to
      // simulate the legacy module's behavior (cold cache = fetches), catalogFetches
      // would increment to 2.
      jest.mock('../../../../src/middleware/plan-features.middleware', function () {
        return {
          resolvePlanFeatures: jest.fn(),
          reconcileLimitsIfNeeded: jest.fn(),
          invalidateUserPlanCache: jest.fn(),
          // Simulates the cold legacy module cache: on every call it fetches from
          // the payment service (via global.fetch). Post-fix: never called by
          // _billingEntitlement.resolvePlanCatalog so this never fires for that path.
          getCachedPlanFeatures: jest.fn(function () {
            // Simulate the legacy getCachedPlanFeatures behavior (cold module cache):
            // it would call global.fetch to /api/plans, incrementing catalogFetches.
            return fetch('http://localhost:5020/api/plans?product=juggler&include_all=true', {})
              .then(function (r) { return r.json(); })
              .then(function (data) {
                var out = {};
                (data.plans || []).forEach(function (p) { out[p.planId] = p.features; });
                return out;
              });
          }),
          PRODUCT_LABEL: 'juggler'
        };
      });
      jest.mock('../../../../src/middleware/feature-gate.js', function () {
        return { requireFeature: jest.fn(), requireFeatureIncludes: jest.fn(), checkUsageLimit: jest.fn() };
      });
      // 999.994: enforceDowngradeLimits now lives in the task slice facade,
      // not controllers/billing-webhooks.controller.
      // 999.1199: renameTasks now resolves lib/tasks-write via the task slice
      // facade's exported KnexTaskRepository class. Kept IDENTICAL across all
      // three describe blocks in this file (B1/B1-downgrade/B2) — jest's mock
      // factory registration for a given path was observed to be sticky to the
      // FIRST-registered factory across sequential jest.isolateModules calls
      // within one test file, so a divergent shape in an earlier block silently
      // wins for later blocks too.
      jest.mock('../../../../src/slices/task/facade', function () {
        return {
          enforceDowngradeLimits: jest.fn(function () { return Promise.resolve(); }),
          KnexTaskRepository: require('../../../../src/slices/task/adapters/KnexTaskRepository')
        };
      });
      jest.mock('../../../../src/slices/user-config/domain/featureCatalog', function () {
        // 999.1192: the facade reads CATALOG from its own domain module now.
        return { CATALOG: {} };
      });
      jest.mock('../../../../src/scheduler/scheduleQueue', function () {
        return { enqueueScheduleRun: jest.fn() };
      });

      facade = require('../../../../src/slices/user-config/facade');
    });

    // ── Step 1: Warm the adapter catalog cache via facade.checkEntitlement ─────
    // CheckEntitlement calls:
    //   _entitlement.resolveUserPlanId → /active-plans (returns 'plan-paid')
    //   _entitlement.resolvePlanCatalog → /api/plans (catalogFetches: 0→1)
    var r1 = await facade.checkEntitlement({ user: { id: 'user-b1-real' } });
    expect(r1.status).toBe(200);  // paid plan → 200
    expect(mockSharedState.catalogFetches).toBe(1);  // exactly 1 catalog fetch so far

    // ── Step 2: Confirm adapter cache is warm — a second checkEntitlement must NOT
    //    add another catalog fetch (this verifies the warm-cache baseline).
    var r2 = await facade.checkEntitlement({ user: { id: 'user-b1-real' } });
    expect(r2.status).toBe(200);
    expect(mockSharedState.catalogFetches).toBe(1);  // still 1 — adapter cache hit

    // ── Step 3: Fire a downgrade webhook — drives the REAL _billingEntitlement
    //    from facade.js wiring. HandleBillingWebhook.execute calls:
    //      this.entitlement.resolvePlanCatalog()  ← _billingEntitlement shim
    //
    //    POST-FIX: shim routes to _entitlement.resolvePlanCatalog() → warm cache
    //              → NO /api/plans fetch → catalogFetches stays 1.
    //    PRE-FIX:  shim called getCachedPlanFeatures() (mocked to call global.fetch
    //              for /api/plans, simulating the cold legacy cache) → catalogFetches=2.
    var r3 = await facade.handleBillingWebhook({
      body: {
        event: 'subscription.downgrade_applied',
        user_id: 'user-b1-real',
        to_planId: 'free'
      }
    });
    expect(r3.status).toBe(200);
    expect(r3.body.success).toBe(true);

    // ── B1 CORE ASSERTION ─────────────────────────────────────────────────────
    // POST-FIX (GREEN): catalog reused from adapter warm cache → count stays 1.
    // PRE-FIX (RED):    getCachedPlanFeatures() would be called → count becomes 2.
    expect(mockSharedState.catalogFetches).toBe(1);

    global.fetch = savedFetch;
  });

  /**
   * B1-DOWNGRADE: focused variant — warms the catalog DIRECTLY via facade._entitlement
   * (not through checkEntitlement) to eliminate ambiguity. Then fires the webhook.
   *
   * Proves that the webhook's resolvePlanCatalog path uses the SAME instance cache
   * that was warmed by the direct adapter call, not a separate cold legacy cache.
   *
   * POST-FIX (GREEN): count stays 1 after webhook.
   * PRE-FIX (RED):    getCachedPlanFeatures() fires (cold) → count becomes 2.
   */
  test('B1-DOWNGRADE: downgrade_applied webhook reuses warm adapter catalog (no extra fetch)', async function () {
    mockSharedState.reset();
    var savedFetch = global.fetch;
    global.fetch = makeCountingFetch();

    var facade;
    await jest.isolateModules(async function () {
      jest.mock('../../../../src/lib/db', function () {
        var h = require('../../../helpers/mockChainDb');
        var r = h.createMockChainDb();
        return { getDefaultDb: function () { return r.mockDb; } };
      });
      jest.mock('../../../../src/lib/cache', function () {
        var s = {
          get: jest.fn(function () { return Promise.resolve(null); }),
          set: jest.fn(function () { return Promise.resolve(true); }),
          invalidateConfig: jest.fn(function () { return Promise.resolve(true); }),
          invalidateTasks: jest.fn(function () { return Promise.resolve(true); })
        };
        return { cache: s };
      });
      // 999.1199: textually IDENTICAL to the B2 block's mock (including the
      // capturedChanges-recording body, even though this test never asserts on
      // it) — kept identical across all three describe blocks in this file.
      // jest's mock factory registration for a given path was observed to be
      // sticky to the FIRST-registered factory across sequential
      // jest.isolateModules calls within one test file (a divergent shape in an
      // earlier block silently wins for later blocks too), so all three must
      // agree byte-for-byte on every mocked path they share.
      jest.mock('../../../../src/lib/tasks-write', function () {
        return {
          updateTasksWhere: jest.fn(function (db, userId, applyWhere, changes) {
            mockSharedState.capturedChanges = changes;
            return Promise.resolve(1);
          }),
          deleteTasksWhere: jest.fn(function () { return Promise.resolve(1); }),
          insertTask: jest.fn(function () { return Promise.resolve(); }),
          updateTaskById: jest.fn(function () { return Promise.resolve(1); }),
          deleteTaskById: jest.fn(function () { return Promise.resolve(1); })
        };
      });
      jest.mock('../../../../src/lib/usage-reporter', function () {
        return { reportUsage: jest.fn(), setProductIdResolver: jest.fn() };
      });
      jest.mock('@raike/lib-logger', function () {
        var noop = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        return { createLogger: function () { return noop; } };
      });
      jest.mock('../../../../src/middleware/plan-features.middleware', function () {
        return {
          resolvePlanFeatures: jest.fn(),
          reconcileLimitsIfNeeded: jest.fn(),
          invalidateUserPlanCache: jest.fn(),
          // Cold legacy module cache simulation: calls global.fetch (increments counter).
          // Post-fix: this is never called by _billingEntitlement.resolvePlanCatalog.
          // Pre-fix: it WOULD be called, making count=2.
          getCachedPlanFeatures: jest.fn(function () {
            return fetch('http://localhost:5020/api/plans?product=juggler&include_all=true', {})
              .then(function (r) { return r.json(); })
              .then(function (data) {
                var out = {};
                (data.plans || []).forEach(function (p) { out[p.planId] = p.features; });
                return out;
              });
          }),
          PRODUCT_LABEL: 'juggler'
        };
      });
      jest.mock('../../../../src/middleware/feature-gate.js', function () {
        return { requireFeature: jest.fn(), requireFeatureIncludes: jest.fn(), checkUsageLimit: jest.fn() };
      });
      // 999.994: enforceDowngradeLimits now lives in the task slice facade,
      // not controllers/billing-webhooks.controller. 999.1199: kept identical
      // to the B1/B2 blocks' 'slices/task/facade' mock — see the comment there.
      jest.mock('../../../../src/slices/task/facade', function () {
        return {
          enforceDowngradeLimits: jest.fn(function () { return Promise.resolve(); }),
          KnexTaskRepository: require('../../../../src/slices/task/adapters/KnexTaskRepository')
        };
      });
      jest.mock('../../../../src/slices/user-config/domain/featureCatalog', function () {
        // 999.1192: the facade reads CATALOG from its own domain module now.
        return { CATALOG: {} };
      });
      jest.mock('../../../../src/scheduler/scheduleQueue', function () {
        return { enqueueScheduleRun: jest.fn() };
      });

      facade = require('../../../../src/slices/user-config/facade');
    });

    // ── Step 1: Warm the adapter catalog DIRECTLY via facade._entitlement ───────
    // (facade exports _entitlement for testing) — this warms the adapter's own
    // _planFeaturesCache. Note: resolvePlanCatalog calls resolveProductId first
    // (product-discovery /internal/products/ — does NOT count as catalogFetch),
    // then /api/plans (catalogFetches: 0→1).
    await facade._entitlement.resolvePlanCatalog();
    expect(mockSharedState.catalogFetches).toBe(1);  // one catalog fetch to warm cache

    // ── Step 2: Cache warm — second direct call must NOT fetch again ─────────
    await facade._entitlement.resolvePlanCatalog();
    expect(mockSharedState.catalogFetches).toBe(1);  // still 1

    // ── Step 3: Webhook downgrade fires _billingEntitlement.resolvePlanCatalog ─
    // POST-FIX: routes to _entitlement.resolvePlanCatalog() → warm → count stays 1.
    // PRE-FIX:  routes to getCachedPlanFeatures() (cold) → increments → count=2.
    var result = await facade.handleBillingWebhook({
      body: {
        event: 'subscription.downgrade_applied',
        user_id: 'user-b1d-real',
        to_planId: 'free'
      }
    });
    expect(result.status).toBe(200);

    // ── B1-DOWNGRADE CORE ASSERTION ───────────────────────────────────────────
    // POST-FIX (GREEN): no second catalog fetch — adapter cache reused.
    // PRE-FIX (RED):    getCachedPlanFeatures fires (cold) → catalogFetches=2.
    expect(mockSharedState.catalogFetches).toBe(1);

    global.fetch = savedFetch;
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// B2 — renameTasks server-clock timestamp: real facade path
// ─────────────────────────────────────────────────────────────────────────────

describe('B2 — REGRESSION (real facade): renameTasks passes updated_at as knex fn.now() Raw', function () {

  /**
   * B2: facade.updateProject with a changed name triggers the renameTasks branch.
   * The REAL renameTasks (facade.js:121-125) calls:
   *   tasksWrite.updateTasksWhere(trxRepo.db, userId, whereFn,
   *     { project: name, updated_at: trxRepo.db.fn.now() })  ← POST-FIX
   *
   * We spy on tasksWrite.updateTasksWhere (via jest.isolateModules + jest.mock)
   * and capture the `changes` argument. The assertions:
   *   (1) changes.updated_at is NOT instanceof Date
   *   (2) changes.updated_at is the knex Raw sentinel: mockChainDb returns 'MOCK_NOW'
   *       for fn.now(), so trxRepo.db.fn.now() === 'MOCK_NOW'.
   *
   * POST-FIX (GREEN): updated_at is 'MOCK_NOW' (knex Raw path), NOT instanceof Date.
   * PRE-FIX (RED):    updated_at is instanceof Date → assertion (1) FAILS.
   *
   * TRUE-REPRO VERIFIED (inverse-edit): reverted facade.js:124 to `new Date()`.
   *   → FAILED: "Expected: not Date, Received: [Date]". Restored fn.now() → PASSED.
   */
  test('B2: updateProject rename cascade passes updated_at as knex Raw (not new Date()) to tasksWrite.updateTasksWhere', async function () {
    mockSharedState.reset();
    var savedFetch = global.fetch;

    // Minimal fetch stub for facade module load (product-discovery only path).
    global.fetch = jest.fn(function (url) {
      var u = typeof url === 'string' ? url : String(url);
      if (u.indexOf('/internal/products/') !== -1) {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve({ product: { id: null } }); }
        });
      }
      return Promise.reject(new Error('Unexpected fetch in B2: ' + u));
    });

    var facade;
    await jest.isolateModules(async function () {
      // ── mockChainDb: provides the trx handle with fn.now() returning 'MOCK_NOW' ─
      // KnexConfigRepository.runInTransaction calls this.db.transaction(cb).
      // mockChainDb.transaction(cb) passes cb(mockDb) as the trxRepo.db.
      // mockChainDb.fn.now() returns 'MOCK_NOW' (a string, never instanceof Date).
      // POST-FIX: renameTasks passes trxRepo.db.fn.now() → changes.updated_at = 'MOCK_NOW'.
      // PRE-FIX:  renameTasks passes new Date() → changes.updated_at instanceof Date.
      jest.mock('../../../../src/lib/db', function () {
        var h = require('../../../helpers/mockChainDb');
        var r = h.createMockChainDb();
        return { getDefaultDb: function () { return r.mockDb; } };
      });

      jest.mock('../../../../src/lib/cache', function () {
        var s = {
          get: jest.fn(function () { return Promise.resolve(null); }),
          set: jest.fn(function () { return Promise.resolve(true); }),
          invalidateConfig: jest.fn(function () { return Promise.resolve(true); }),
          invalidateTasks: jest.fn(function () { return Promise.resolve(true); })
        };
        return { cache: s };
      });

      // ── tasksWrite spy: captures the `changes` argument from renameTasks ─────
      // Post-fix: renameTasks calls updateTasksWhere(..., { project, updated_at: fn.now() }).
      // The spy captures changes and stores to mockSharedState.capturedChanges.
      jest.mock('../../../../src/lib/tasks-write', function () {
        return {
          updateTasksWhere: jest.fn(function (db, userId, applyWhere, changes) {
            mockSharedState.capturedChanges = changes;
            return Promise.resolve(1);
          }),
          deleteTasksWhere: jest.fn(function () { return Promise.resolve(1); }),
          insertTask: jest.fn(function () { return Promise.resolve(); }),
          updateTaskById: jest.fn(function () { return Promise.resolve(1); }),
          deleteTaskById: jest.fn(function () { return Promise.resolve(1); })
        };
      });

      jest.mock('../../../../src/lib/usage-reporter', function () {
        return { reportUsage: jest.fn(), setProductIdResolver: jest.fn() };
      });
      jest.mock('@raike/lib-logger', function () {
        var noop = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        return { createLogger: function () { return noop; } };
      });
      jest.mock('../../../../src/middleware/plan-features.middleware', function () {
        return {
          resolvePlanFeatures: jest.fn(),
          reconcileLimitsIfNeeded: jest.fn(),
          invalidateUserPlanCache: jest.fn(),
          getCachedPlanFeatures: jest.fn(function () { return Promise.resolve({}); }),
          PRODUCT_LABEL: 'juggler'
        };
      });
      jest.mock('../../../../src/middleware/feature-gate.js', function () {
        return { requireFeature: jest.fn(), requireFeatureIncludes: jest.fn(), checkUsageLimit: jest.fn() };
      });
      // 999.994: enforceDowngradeLimits now lives in the task slice facade,
      // not controllers/billing-webhooks.controller.
      // 999.1199: renameTasks/importWipeTasks/importInsertTask now resolve
      // lib/tasks-write via the task slice facade's exported KnexTaskRepository
      // class (not a direct require), so the mock must expose the REAL adapter
      // class here too — it picks up the already-mocked
      // '../../../../src/lib/tasks-write' below through its own require() (same
      // module-registry instance under jest.isolateModules), preserving any spy
      // on tasksWrite's methods.
      jest.mock('../../../../src/slices/task/facade', function () {
        return {
          enforceDowngradeLimits: jest.fn(function () { return Promise.resolve(); }),
          KnexTaskRepository: require('../../../../src/slices/task/adapters/KnexTaskRepository')
        };
      });
      jest.mock('../../../../src/slices/user-config/domain/featureCatalog', function () {
        // 999.1192: the facade reads CATALOG from its own domain module now.
        return { CATALOG: {} };
      });
      jest.mock('../../../../src/scheduler/scheduleQueue', function () {
        return { enqueueScheduleRun: jest.fn() };
      });

      facade = require('../../../../src/slices/user-config/facade');
    });

    // ── Drive facade.updateProject with a real name change ─────────────────────
    // body.oldName !== body.name → rename branch fires in UpdateProject.execute.
    // UpdateProject.execute → repo.runInTransaction → trxRepo.updateProjectById(...)
    //   THEN renameTasks(trxRepo, userId, oldName, name)
    //   → tasksWrite.updateTasksWhere(trxRepo.db, ..., { project: name, updated_at: trxRepo.db.fn.now() })
    var result = await facade.updateProject({
      userId: 'user-b2-real',
      id: '42',
      body: {
        name: 'NewProject',
        color: '#ff0000',
        icon: null,
        oldName: 'OldProject'   // ← different from name → triggers rename branch
      }
    });

    // use-case returns 200 on success
    expect(result.status).toBe(200);
    expect(result.body.renamed).toEqual({ from: 'OldProject', to: 'NewProject' });

    // ── B2 CORE ASSERTIONS ────────────────────────────────────────────────────
    // Verify the spy captured a call (renameTasks ran and called updateTasksWhere).
    expect(mockSharedState.capturedChanges).not.toBeNull();
    expect(mockSharedState.capturedChanges.project).toBe('NewProject');

    // (1) POST-FIX (GREEN): updated_at is a knex Raw sentinel (NOT a JS Date).
    //     PRE-FIX (RED):    updated_at is instanceof Date → FAILS.
    expect(mockSharedState.capturedChanges.updated_at).not.toBeInstanceOf(Date);

    // (2) Specifically: updated_at is the value mockChainDb.fn.now() returns ('MOCK_NOW').
    //     This proves the code followed the trxRepo.db.fn.now() path, not new Date().
    expect(mockSharedState.capturedChanges.updated_at).toBe('MOCK_NOW');

    global.fetch = savedFetch;
  });

});
