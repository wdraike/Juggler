/**
 * H4 W4 — PaymentServiceEntitlementAdapter adapter-specific suite.
 *
 * The contract suite (entitlementAdapter.contract.test.js) pins behavior shared by
 * BOTH adapters. This file pins the legacy cross-service I/O details that ONLY the
 * real adapter has — byte-identical to plan-features.middleware.js, as the
 * golden-master H7/H13 pin:
 *
 *   - product-discovery URL  /internal/products/juggler   (slug in URL — H7-3)
 *   - catalog URL            /api/plans?product=<UUID|slug>&include_all=true (H7-4)
 *   - user-plan URL          /internal/users/<id>/active-plans
 *   - PAYMENT_SERVICE_URL || 'http://localhost:5020' fallback (H13) — preserved
 *   - X-Internal-Key header from INTERNAL_SERVICE_KEY || ''
 *   - slug→UUID startup resolution: the resolved UUID becomes the catalog filter,
 *     and discovery is cached for the instance lifetime (one discovery fetch).
 *   - fail-soft: resolveUserPlanId returns null on a non-OK / thrown fetch.
 *   - catalog refetch error returns the LAST cache if present, else rejects.
 *
 * NO real network — global.fetch is mocked throughout. Traceability: WBS W4
 * (b),(c),(d),(e),(g); golden-master H7-3/H7-4/H13.
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

describe('PaymentServiceEntitlementAdapter — legacy I/O parity', function () {
  var savedUrl;
  var savedKey;

  beforeEach(function () {
    savedUrl = process.env.PAYMENT_SERVICE_URL;
    savedKey = process.env.INTERNAL_SERVICE_KEY;
  });

  afterEach(function () {
    if (savedUrl === undefined) delete process.env.PAYMENT_SERVICE_URL;
    else process.env.PAYMENT_SERVICE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.INTERNAL_SERVICE_KEY;
    else process.env.INTERNAL_SERVICE_KEY = savedKey;
  });

  test('H13: getProductId/catalog/user-plan use PAYMENT_SERVICE_URL || "http://localhost:5020"', async function () {
    delete process.env.PAYMENT_SERVICE_URL; // force the fallback
    var urls = [];
    var fetchMock = jest.fn(function (url) {
      urls.push(url);
      if (url.indexOf('/internal/products/') !== -1) return jsonRes({ product: { id: 'pid-uuid' } });
      if (url.indexOf('/api/plans') !== -1) return jsonRes({ plans: [{ planId: 'p1', features: {} }] });
      if (url.indexOf('/active-plans') !== -1) return jsonRes({ plans: { juggler: 'p1' } });
      return Promise.reject(new Error('unexpected: ' + url));
    });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });

    await a.resolveProductId();
    await a.resolvePlanCatalog();
    await a.resolveUserPlanId('u1');

    urls.forEach(function (u) {
      expect(u.indexOf('http://localhost:5020')).toBe(0);
    });
  });

  test('H7-3: product discovery fetches /internal/products/juggler (slug in URL)', async function () {
    var seen = null;
    var fetchMock = jest.fn(function (url) {
      seen = url;
      return jsonRes({ product: { id: 'pid-uuid' } });
    });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });
    await a.resolveProductId();
    expect(seen).toContain('/internal/products/juggler');
  });

  test('H7-4: catalog URL uses the resolved UUID as ?product= filter + &include_all=true', async function () {
    var catalogUrl = null;
    var fetchMock = jest.fn(function (url) {
      if (url.indexOf('/internal/products/') !== -1) return jsonRes({ product: { id: 'resolved-uuid-123' } });
      if (url.indexOf('/api/plans') !== -1) { catalogUrl = url; return jsonRes({ plans: [] }); }
      return Promise.reject(new Error('unexpected: ' + url));
    });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });
    await a.resolvePlanCatalog();
    expect(catalogUrl).toContain('?product=resolved-uuid-123');
    expect(catalogUrl).toContain('&include_all=true');
  });

  test('catalog filter falls back to the SLUG when product discovery returns null', async function () {
    var catalogUrl = null;
    var fetchMock = jest.fn(function (url) {
      if (url.indexOf('/internal/products/') !== -1) return jsonRes({}, false); // discovery fails → null id
      if (url.indexOf('/api/plans') !== -1) { catalogUrl = url; return jsonRes({ plans: [] }); }
      return Promise.reject(new Error('unexpected: ' + url));
    });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });
    await a.resolvePlanCatalog();
    expect(catalogUrl).toContain('?product=juggler'); // slug, NOT a uuid
  });

  test('slug→UUID discovery is cached for the instance lifetime (one discovery fetch)', async function () {
    var discoveryCount = 0;
    var fetchMock = jest.fn(function (url) {
      if (url.indexOf('/internal/products/') !== -1) { discoveryCount++; return jsonRes({ product: { id: 'pid' } }); }
      if (url.indexOf('/api/plans') !== -1) return jsonRes({ plans: [] });
      return Promise.reject(new Error('unexpected: ' + url));
    });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });
    var id1 = await a.resolveProductId();
    var id2 = await a.resolveProductId();
    await a.resolvePlanCatalog(); // also calls resolveProductId internally
    expect(id1).toBe('pid');
    expect(id2).toBe('pid');
    expect(discoveryCount).toBe(1);
  });

  test('user-plan URL is /internal/users/<id>/active-plans with X-Internal-Key header', async function () {
    process.env.INTERNAL_SERVICE_KEY = 'secret-key';
    var seenUrl = null;
    var seenHeaders = null;
    var fetchMock = jest.fn(function (url, opts) {
      seenUrl = url; seenHeaders = opts.headers;
      return jsonRes({ plans: { juggler: 'p1' } });
    });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });
    await a.resolveUserPlanId('user-42');
    expect(seenUrl).toContain('/internal/users/user-42/active-plans');
    expect(seenHeaders['X-Internal-Key']).toBe('secret-key');
  });

  test('fail-soft: resolveUserPlanId returns null on a non-OK response', async function () {
    var fetchMock = jest.fn(function () { return jsonRes({}, false); });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });
    var planId = await a.resolveUserPlanId('u1');
    expect(planId).toBeNull();
  });

  test('fail-soft: resolveUserPlanId returns null when fetch throws', async function () {
    var fetchMock = jest.fn(function () { return Promise.reject(new Error('network down')); });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });
    var planId = await a.resolveUserPlanId('u1');
    expect(planId).toBeNull();
  });

  test('catalog refetch error returns the LAST cache when present', async function () {
    jest.useFakeTimers();
    var call = 0;
    var fetchMock = jest.fn(function (url) {
      if (url.indexOf('/internal/products/') !== -1) return jsonRes({ product: { id: null } });
      if (url.indexOf('/api/plans') !== -1) {
        call++;
        if (call === 1) return jsonRes({ plans: [{ planId: 'p1', features: { a: 1 } }] });
        return Promise.reject(new Error('payment down on refetch'));
      }
      return Promise.reject(new Error('unexpected: ' + url));
    });
    var a = new PaymentServiceEntitlementAdapter({ productSlug: 'juggler', logger: SILENT_LOGGER, fetchImpl: fetchMock });
    var first = await a.resolvePlanCatalog();
    expect(first).toEqual({ p1: { a: 1 } });

    // Expire the catalog TTL → next read refetches → refetch throws → last cache returned.
    jest.advanceTimersByTime(5 * 60 * 1000 + 1000);
    var second = await a.resolvePlanCatalog();
    expect(second).toEqual({ p1: { a: 1 } });
    jest.useRealTimers();
  });

  test('constructing with a UUID product slug throws (slug-keying assertion)', function () {
    expect(function () {
      new PaymentServiceEntitlementAdapter({
        productSlug: '11111111-2222-4333-8444-555555555555',
        logger: SILENT_LOGGER
      });
    }).toThrow(/UUID|slug/i);
  });
});

// ── Circuit breaker (999.374) ─────────────────────────────────────────────────
// A payment-service outage otherwise makes every cross-service call hang for the
// full 30s AbortSignal.timeout. The breaker opens after N consecutive failures and
// fast-fails (returns the SAME fail-soft result WITHOUT calling fetch); after a
// cooldown one half-open trial closes it on success or re-opens it on failure. These
// tests use a tiny threshold + injected clock for determinism. The fail-soft contract
// (null on failure) is unchanged — the breaker only avoids the hang.
describe('PaymentServiceEntitlementAdapter — circuit breaker (999.374)', function () {
  function rejectingFetch() {
    return jest.fn(function () { return Promise.reject(new Error('payment-service down')); });
  }

  test('(a) after N consecutive failures the breaker OPENs and the next call fast-fails WITHOUT calling fetch', async function () {
    var fetchMock = rejectingFetch();
    var clock = 1000;
    var a = new PaymentServiceEntitlementAdapter({
      productSlug: 'juggler',
      logger: SILENT_LOGGER,
      fetchImpl: fetchMock,
      breakerThreshold: 3,
      breakerCooldownMs: 30000,
      now: function () { return clock; }
    });

    // 3 consecutive failures — each makes a (failing) fetch call; all fail-soft to null.
    for (var i = 0; i < 3; i++) {
      var r = await a.resolveUserPlanId('u' + i);
      expect(r).toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(3); // breaker still CLOSED for these 3
    expect(a._breakerState).toBe('open');       // threshold reached → OPEN

    // Next call within the cooldown window → fast-fail null WITHOUT a 4th fetch.
    var fast = await a.resolveUserPlanId('u-after-open');
    expect(fast).toBeNull();                    // same fail-soft contract
    expect(fetchMock).toHaveBeenCalledTimes(3); // NO new fetch — the hang is avoided
  });

  test('(b) after the cooldown a successful HALF-OPEN trial CLOSEs the breaker', async function () {
    var clock = 1000;
    // Fail first to OPEN the breaker, then succeed on the half-open trial.
    var callCount = 0;
    var fetchMock = jest.fn(function () {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error('down'));
      // half-open trial + subsequent calls succeed (active-plans map, slug-keyed)
      return jsonRes({ plans: { juggler: 'plan-starter' } });
    });
    var a = new PaymentServiceEntitlementAdapter({
      productSlug: 'juggler',
      logger: SILENT_LOGGER,
      fetchImpl: fetchMock,
      breakerThreshold: 2,
      breakerCooldownMs: 30000,
      now: function () { return clock; }
    });

    // 2 failures → OPEN.
    await a.resolveUserPlanId('u1');
    await a.resolveUserPlanId('u2');
    expect(a._breakerState).toBe('open');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Still within cooldown → fast-fail, NO fetch.
    expect(await a.resolveUserPlanId('u3')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Advance past the cooldown → next call is a HALF-OPEN trial → fetch runs + succeeds.
    clock += 30001;
    var resolved = await a.resolveUserPlanId('u4');
    expect(resolved).toBe('plan-starter');       // success
    expect(fetchMock).toHaveBeenCalledTimes(3);   // the half-open trial fetched
    expect(a._breakerState).toBe('closed');       // success CLOSEs the breaker
    expect(a._breakerFailures).toBe(0);

    // Breaker closed → subsequent calls flow normally (fetch again).
    await a.resolveUserPlanId('u5');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test('(c) a catalog fetch counts as ONE breaker failure, not two (no product-discovery double-count)', async function () {
    // Regression (999.374, elmo WARN-2a): _fetchPlanCatalog used to record a breaker
    // outcome AND its nested resolveProductId recorded another — TWO records per
    // logical catalog fetch, halving the effective threshold. With threshold 2, a
    // SINGLE failing catalog fetch must NOT open the breaker (1 failure, not 2). A
    // second failing catalog fetch then reaches the threshold and opens it.
    var clock = 1000;
    var fetchMock = jest.fn(function () { return Promise.reject(new Error('down')); });
    var a = new PaymentServiceEntitlementAdapter({
      productSlug: 'juggler',
      logger: SILENT_LOGGER,
      fetchImpl: fetchMock,
      breakerThreshold: 2,
      breakerCooldownMs: 30000,
      now: function () { return clock; }
    });

    // ONE logical catalog fetch fails (discovery + /api/plans both error). It must
    // record exactly ONE failure — below threshold 2 → breaker stays CLOSED.
    await expect(a.resolvePlanCatalog()).rejects.toThrow();
    expect(a._breakerState).toBe('closed');
    expect(a._breakerFailures).toBe(1); // ONE failure, not two — the fix

    // A second logical catalog fetch fails → now 2 failures → threshold reached → OPEN.
    await expect(a.resolvePlanCatalog()).rejects.toThrow();
    expect(a._breakerState).toBe('open');
    expect(a._breakerFailures).toBe(2);

    // While OPEN within cooldown, the next catalog fetch fast-fails WITHOUT new fetch.
    var fetchesBefore = fetchMock.mock.calls.length;
    await expect(a.resolvePlanCatalog()).rejects.toThrow(/circuit breaker open/);
    expect(fetchMock).toHaveBeenCalledTimes(fetchesBefore); // no HTTP — the hang is avoided
  });

  test('(d) only ONE half-open trial is admitted — a concurrent same-tick call is fast-failed, not a 2nd trial', async function () {
    // Regression (999.374, elmo WARN-2b): the half-open transition was a non-atomic
    // check-then-set, so two concurrent post-cooldown calls could BOTH be admitted as
    // trials. The admission now flips the state to 'half-open-pending' atomically, so a
    // concurrent same-tick call sees the pending marker and is fast-failed. We model two
    // concurrent calls by starting both BEFORE either's fetch resolves.
    var clock = 1000;
    var resolvers = [];
    var fetchMock = jest.fn(function () {
      // Each call returns a promise we resolve manually → both half-open candidates are
      // in flight simultaneously (neither has recorded an outcome yet).
      return new Promise(function (resolve) {
        resolvers.push(function () { resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ plans: { juggler: 'p1' } }); } }); });
      });
    });
    var a = new PaymentServiceEntitlementAdapter({
      productSlug: 'juggler',
      logger: SILENT_LOGGER,
      fetchImpl: fetchMock,
      breakerThreshold: 1,
      breakerCooldownMs: 30000,
      now: function () { return clock; }
    });

    // 1 failure (threshold 1) → OPEN. Use a rejecting first call.
    fetchMock.mockImplementationOnce(function () { return Promise.reject(new Error('down')); });
    expect(await a.resolveUserPlanId('u1')).toBeNull();
    expect(a._breakerState).toBe('open');

    // Advance past cooldown → the breaker will admit ONE half-open trial.
    clock += 30001;

    // Two concurrent calls in the same tick (neither awaited yet → both pass through
    // _breakerAllowsCall before any fetch settles).
    var p1 = a.resolveUserPlanId('u-a');
    var p2 = a.resolveUserPlanId('u-b');

    // Only ONE was admitted as the trial (one fetch); the other was fast-failed (null,
    // no fetch) by the 'half-open-pending' marker.
    expect(a._breakerState).toBe('half-open-pending');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial failure + 1 trial fetch only

    // Resolve the single in-flight trial → success CLOSEs the breaker.
    resolvers[0]();
    var r1 = await p1;
    var r2 = await p2;
    // One of the two is the admitted trial (resolves to 'p1'); the other was fast-failed (null).
    var results = [r1, r2].sort();
    expect(results).toEqual([null, 'p1']);
    expect(a._breakerState).toBe('closed');
  });

  test('breaker is SHARED across the 3 calls — failures from resolveProductId count toward the open threshold', async function () {
    var clock = 1000;
    var fetchMock = jest.fn(function () { return Promise.reject(new Error('down')); });
    var a = new PaymentServiceEntitlementAdapter({
      productSlug: 'juggler',
      logger: SILENT_LOGGER,
      fetchImpl: fetchMock,
      breakerThreshold: 2,
      breakerCooldownMs: 30000,
      now: function () { return clock; }
    });

    // Mix call types: 1 product-discovery failure + 1 user-plan failure → threshold 2.
    expect(await a.resolveProductId()).toBeNull();
    expect(await a.resolveUserPlanId('u1')).toBeNull();
    expect(a._breakerState).toBe('open');
    var callsBefore = fetchMock.mock.calls.length;

    // Now a user-plan call fast-fails without fetch (breaker shared/open).
    expect(await a.resolveUserPlanId('u2')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(callsBefore); // no new fetch
  });
});
