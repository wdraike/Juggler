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
