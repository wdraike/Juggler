/**
 * H4 W4 — EntitlementPort CONTRACT suite (run against BOTH adapters).
 *
 * WBS W4 acceptance (f): the MockEntitlementAdapter passes the SAME port-contract
 * suite as the PaymentServiceEntitlementAdapter — proving the test double is
 * faithful to the cross-service entitlement seam.
 *
 * HOW: one parameterized describe block runs every contract assertion against a
 * fresh adapter produced by a per-adapter `makeAdapter(spec)`:
 *   - Payment: a PaymentServiceEntitlementAdapter with `global.fetch` MOCKED — NO
 *     real network to payment-service. The mock fetch routes by URL
 *     (/internal/products/, /api/plans, /internal/users/.../active-plans) to the
 *     same logical responses the Mock adapter's sources serve, and counts calls.
 *   - Mock:    a MockEntitlementAdapter with injected catalogSource /
 *     activePlansSource that count invocations.
 *
 * Both legs assert IDENTICAL behavior for the contract surface:
 *   - port conformance (every ENTITLEMENT_PORT_METHODS member present)
 *   - SLUG-KEYING: user-plan resolves by slug 'juggler'; a UUID-keyed plans map
 *     resolves to null; constructing with a UUID slug THROWS (reject UUID).
 *   - catalog 5min TTL: within-TTL = no refetch; after-TTL = refetch.
 *   - user-plan 2min TTL: within-TTL = no refetch; after-TTL = refetch.
 *   - catalog in-flight dedup (_fetchPromise): two concurrent misses = ONE fetch.
 *   - no-cache-on-null: a null user-plan is never cached (every read re-fetches).
 *   - resolveEntitlement composes a slug-keyed Entitlement (productSlug='juggler').
 *
 * Traceability: WBS W4 (a),(b),(d),(f),(g); golden-master H7/H8/H13.
 */

'use strict';

process.env.NODE_ENV = 'test';

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var EntitlementPort = require(path.join(SLICE, 'domain', 'ports', 'EntitlementPort'));
var Entitlement = require(path.join(SLICE, 'domain', 'entities', 'Entitlement'));
var PlanSlug = require(path.join(SLICE, 'domain', 'value-objects', 'PlanSlug'));
var PaymentServiceEntitlementAdapter = require(path.join(SLICE, 'adapters', 'PaymentServiceEntitlementAdapter'));
var MockEntitlementAdapter = require(path.join(SLICE, 'adapters', 'MockEntitlementAdapter'));

var ENTITLEMENT_PORT_METHODS = EntitlementPort.ENTITLEMENT_PORT_METHODS;

// Silent logger so the fail-soft error paths don't spam test output.
var SILENT_LOGGER = { info: function () {}, warn: function () {}, error: function () {} };

// Canonical catalog `plans` array (payment-service /api/plans shape). 'plan-starter'
// has an OBJECT features; 'free' a JSON STRING (exercises the parse branch).
var STARTER_FEATURES = { limits: { projects: 10 }, ai: { enrich: true } };
var FREE_FEATURES = { limits: { projects: 1 }, ai: { enrich: false } };
function makeCatalogPlans() {
  return [
    { planId: 'plan-starter', features: STARTER_FEATURES },
    { planId: 'free', features: JSON.stringify(FREE_FEATURES) }
  ];
}

// ── Per-adapter harnesses ────────────────────────────────────────────────────
// Each spec describes the world: which planId a user has, and counters the test
// reads to assert refetch / dedup behavior. Both harnesses honor the SAME spec.

/**
 * spec = {
 *   userPlanId: ?string,      // what active-plans returns for the test user (slug-keyed)
 *   uuidKeyedPlans: boolean,  // if true, the plans map is keyed by a UUID (slug mismatch)
 *   counters: { catalog: 0, userPlan: 0 }
 * }
 */
var TEST_USER = 'user-contract-1';
var UUID_KEY = '11111111-2222-4333-8444-555555555555';

var ADAPTERS = {
  Payment: {
    makeAdapter: function (spec) {
      // Mock global.fetch — routes by URL, counts catalog + user-plan fetches.
      var fetchMock = jest.fn(function (url) {
        if (typeof url === 'string' && url.indexOf('/internal/products/') !== -1) {
          // Product discovery → return null id (fail-soft parity: catalog falls
          // back to the slug filter). Counted separately; not a contract counter.
          return Promise.resolve({
            ok: true,
            json: function () { return Promise.resolve({ product: { id: null } }); }
          });
        }
        if (typeof url === 'string' && url.indexOf('/api/plans') !== -1) {
          spec.counters.catalog++;
          return Promise.resolve({
            ok: true,
            json: function () { return Promise.resolve({ plans: makeCatalogPlans() }); }
          });
        }
        if (typeof url === 'string' && url.indexOf('/active-plans') !== -1) {
          spec.counters.userPlan++;
          var plans;
          if (spec.uuidKeyedPlans) {
            plans = {};
            plans[UUID_KEY] = spec.userPlanId; // UUID-keyed → slug lookup misses
          } else {
            plans = spec.userPlanId ? { juggler: spec.userPlanId } : {};
          }
          return Promise.resolve({
            ok: true,
            json: function () { return Promise.resolve({ plans: plans }); }
          });
        }
        return Promise.reject(new Error('unexpected url: ' + url));
      });
      return new PaymentServiceEntitlementAdapter({
        productSlug: 'juggler',
        logger: SILENT_LOGGER,
        fetchImpl: fetchMock
      });
    },
    // Constructing with a UUID slug must throw (reject UUID).
    makeWithUuidSlug: function () {
      return new PaymentServiceEntitlementAdapter({ productSlug: UUID_KEY, logger: SILENT_LOGGER });
    }
  },
  Mock: {
    makeAdapter: function (spec) {
      return new MockEntitlementAdapter({
        productSlug: 'juggler',
        productId: null,
        catalogSource: function () {
          spec.counters.catalog++;
          return makeCatalogPlans();
        },
        activePlansSource: function () {
          spec.counters.userPlan++;
          if (spec.uuidKeyedPlans) {
            var m = {};
            m[UUID_KEY] = spec.userPlanId;
            return m;
          }
          return spec.userPlanId ? { juggler: spec.userPlanId } : {};
        }
      });
    },
    makeWithUuidSlug: function () {
      return new MockEntitlementAdapter({ productSlug: UUID_KEY });
    }
  }
};

function freshSpec(overrides) {
  return Object.assign({
    userPlanId: 'plan-starter',
    uuidKeyedPlans: false,
    counters: { catalog: 0, userPlan: 0 }
  }, overrides);
}

// ── The parameterized contract ───────────────────────────────────────────────

Object.keys(ADAPTERS).forEach(function (name) {
  var A = ADAPTERS[name];

  describe('EntitlementPort contract — ' + name, function () {
    afterEach(function () {
      jest.useRealTimers();
    });

    // ── Port conformance ──────────────────────────────────────────────────────
    test('implements every ENTITLEMENT_PORT_METHODS member', function () {
      var adapter = A.makeAdapter(freshSpec());
      ENTITLEMENT_PORT_METHODS.forEach(function (m) {
        expect(typeof adapter[m]).toBe('function');
      });
    });

    // ── SLUG-KEYING (INVARIANT EP-1) ──────────────────────────────────────────
    test('resolveUserPlanId resolves by slug "juggler" key', async function () {
      var adapter = A.makeAdapter(freshSpec({ userPlanId: 'plan-starter' }));
      var planId = await adapter.resolveUserPlanId(TEST_USER);
      expect(planId).toBe('plan-starter');
    });

    test('resolveUserPlanId returns null when the plans map is UUID-keyed (slug mismatch)', async function () {
      var adapter = A.makeAdapter(freshSpec({ userPlanId: 'plan-starter', uuidKeyedPlans: true }));
      var planId = await adapter.resolveUserPlanId(TEST_USER);
      expect(planId).toBeNull();
    });

    // zoe-1-FIX: tighten so the test specifically proves PlanSlug.UUID_RE fires
    // (INVARIANT EP-1). The old assertion matched /UUID|slug/i which would pass even
    // if UUID_RE were disabled and the throw came only from the closed-SLUGS-set
    // branch ("not one of [...]"). This version asserts the UUID-rejection message
    // explicitly — it will FAIL if PlanSlug.UUID_RE is disabled (the slug would fall
    // through to the SLUGS-set rejection which does NOT contain the slug-keying phrase).
    //
    // Self-mutation proof: commenting out `if (UUID_RE.test(value)) { throw … }` in
    // PlanSlug.js makes the error message come from the closed-set branch ("must be
    // one of [...]"), which does NOT match the UUID_RE assertion below → test FAILS.
    test('constructing the adapter with a UUID slug THROWS — PlanSlug.UUID_RE fires (INVARIANT EP-1)', function () {
      // UUID_KEY is a well-formed UUID v4-shaped string — must trigger UUID_RE.
      expect(PlanSlug.isUuidShaped(UUID_KEY)).toBe(true); // guard: confirms UUID_KEY triggers the regex
      expect(function () { A.makeWithUuidSlug(); }).toThrow(/slug-keying invariant/i);
    });

    test('resolveEntitlement returns a slug-keyed Entitlement (productSlug = "juggler")', async function () {
      var adapter = A.makeAdapter(freshSpec({ userPlanId: 'plan-starter' }));
      var ent = await adapter.resolveEntitlement(TEST_USER);
      expect(ent).toBeInstanceOf(Entitlement);
      expect(ent.planId).toBe('plan-starter');
      expect(ent.planFeatures).toEqual(STARTER_FEATURES);
      expect(ent.productSlug.value).toBe('juggler');
    });

    test('resolveEntitlement returns null when the user has no active plan', async function () {
      var adapter = A.makeAdapter(freshSpec({ userPlanId: null }));
      var ent = await adapter.resolveEntitlement(TEST_USER);
      expect(ent).toBeNull();
    });

    // ── RESPONSE SHAPE (INVARIANT EP-3) ───────────────────────────────────────
    test('resolvePlanCatalog builds the { planId → features } map (string features JSON-parsed)', async function () {
      var adapter = A.makeAdapter(freshSpec());
      var catalog = await adapter.resolvePlanCatalog();
      expect(catalog['plan-starter']).toEqual(STARTER_FEATURES);
      // 'free' arrived as a JSON STRING → must be parsed to the object.
      expect(catalog['free']).toEqual(FREE_FEATURES);
    });

    // ── F3: resolveEntitlement propagates catalog rejection (no null swallow) ──
    // When resolvePlanCatalog REJECTS on the FIRST-EVER call (no last-cache),
    // resolveEntitlement must propagate the rejection. If it swallowed to null a
    // caller receiving null would return 402/subscription_required — but the actual
    // cause is a 503/catalog-unavailable, creating a silent degradation. Both legs
    // must reject, not resolve to null.
    //
    // Self-mutation proof: if resolveEntitlement's catalog-error path is changed to
    // `return null` on a thrown error, this test fails.
    test('resolveEntitlement PROPAGATES rejection when resolvePlanCatalog fails and there is no last-cache', async function () {
      // Build an adapter whose catalog source always rejects.
      var catalogError = new Error('catalog service unreachable');
      var badCatalogAdapter;
      if (name === 'Payment') {
        var badFetch = jest.fn(function (url) {
          if (typeof url === 'string' && url.indexOf('/internal/products/') !== -1) {
            return Promise.resolve({
              ok: true,
              json: function () { return Promise.resolve({ product: { id: null } }); }
            });
          }
          if (typeof url === 'string' && url.indexOf('/api/plans') !== -1) {
            return Promise.reject(catalogError);
          }
          if (typeof url === 'string' && url.indexOf('/active-plans') !== -1) {
            return Promise.resolve({
              ok: true,
              json: function () { return Promise.resolve({ plans: { juggler: 'plan-starter' } }); }
            });
          }
          return Promise.reject(new Error('unexpected url: ' + url));
        });
        badCatalogAdapter = new (require(path.join(SLICE, 'adapters', 'PaymentServiceEntitlementAdapter')))({
          productSlug: 'juggler',
          logger: SILENT_LOGGER,
          fetchImpl: badFetch
        });
      } else {
        badCatalogAdapter = new (require(path.join(SLICE, 'adapters', 'MockEntitlementAdapter')))({
          productSlug: 'juggler',
          catalogSource: function () { return Promise.reject(catalogError); },
          activePlansSource: function () { return { juggler: 'plan-starter' }; }
        });
      }
      // No prior cache — first-ever catalog call rejects.
      // resolveEntitlement must propagate the error, NOT return null.
      await expect(badCatalogAdapter.resolveEntitlement(TEST_USER)).rejects.toThrow('catalog service unreachable');
    });

    // ── CATALOG 5min TTL (INVARIANT EP-2 / golden-master H8-1) ────────────────
    test('resolvePlanCatalog caches within 5min and refetches after', async function () {
      jest.useFakeTimers();
      // F1-FIX: pin the epoch immediately so Date.now() inside every .then()
      // callback is deterministic (no wall-clock bleeding across the
      // useRealTimers boundary in afterEach).
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      var spec = freshSpec();
      var adapter = A.makeAdapter(spec);

      await adapter.resolvePlanCatalog();
      expect(spec.counters.catalog).toBe(1);

      // Within TTL (4min59s) — no refetch.
      jest.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
      await adapter.resolvePlanCatalog();
      expect(spec.counters.catalog).toBe(1);

      // Past TTL (now > 5min total) — refetch.
      jest.advanceTimersByTime(2 * 1000);
      await adapter.resolvePlanCatalog();
      expect(spec.counters.catalog).toBe(2);
    });

    // ── USER-PLAN 2min TTL (INVARIANT EP-2 / golden-master H8-2) ──────────────
    test('resolveUserPlanId caches within 2min and refetches after', async function () {
      jest.useFakeTimers();
      // F1-FIX: pin the epoch immediately so Date.now() inside every .then()
      // callback is deterministic (no wall-clock bleeding across the
      // useRealTimers boundary in afterEach).
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      var spec = freshSpec({ userPlanId: 'plan-starter' });
      var adapter = A.makeAdapter(spec);

      await adapter.resolveUserPlanId(TEST_USER);
      expect(spec.counters.userPlan).toBe(1);

      // Within TTL (1min59s) — no refetch.
      jest.advanceTimersByTime(60 * 1000 + 59 * 1000);
      await adapter.resolveUserPlanId(TEST_USER);
      expect(spec.counters.userPlan).toBe(1);

      // Past TTL — refetch.
      jest.advanceTimersByTime(2 * 1000);
      await adapter.resolveUserPlanId(TEST_USER);
      expect(spec.counters.userPlan).toBe(2);
    });

    // ── catalog in-flight dedup (_fetchPromise / golden-master H8-3) ──────────
    test('resolvePlanCatalog deduplicates concurrent misses into ONE fetch', async function () {
      var spec = freshSpec();
      var adapter = A.makeAdapter(spec);

      // Two concurrent calls with no cache — share the in-flight _fetchPromise.
      var p1 = adapter.resolvePlanCatalog();
      var p2 = adapter.resolvePlanCatalog();
      await Promise.all([p1, p2]);

      expect(spec.counters.catalog).toBe(1);
    });

    // ── no-cache-on-null (golden-master H8-4) ─────────────────────────────────
    test('resolveUserPlanId does NOT cache a null planId (every read re-fetches)', async function () {
      var spec = freshSpec({ userPlanId: null });
      var adapter = A.makeAdapter(spec);

      var a = await adapter.resolveUserPlanId(TEST_USER);
      var b = await adapter.resolveUserPlanId(TEST_USER);
      expect(a).toBeNull();
      expect(b).toBeNull();
      // No cache of null → both reads hit the backing store.
      expect(spec.counters.userPlan).toBe(2);
    });

    // ── invalidateUserPlan drops the cache (forces a refetch) ─────────────────
    test('invalidateUserPlan drops the cached user-plan', async function () {
      var spec = freshSpec({ userPlanId: 'plan-starter' });
      var adapter = A.makeAdapter(spec);

      await adapter.resolveUserPlanId(TEST_USER);
      expect(spec.counters.userPlan).toBe(1);
      // Cached — no refetch.
      await adapter.resolveUserPlanId(TEST_USER);
      expect(spec.counters.userPlan).toBe(1);

      adapter.invalidateUserPlan(TEST_USER);
      await adapter.resolveUserPlanId(TEST_USER);
      expect(spec.counters.userPlan).toBe(2);
    });
  });
});
