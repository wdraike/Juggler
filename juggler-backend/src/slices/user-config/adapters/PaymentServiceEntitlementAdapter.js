/**
 * PaymentServiceEntitlementAdapter — EntitlementPort implementation over the
 * payment-service, absorbing the cross-service I/O currently inline in
 * `src/middleware/plan-features.middleware.js` (Phase H4 / W4 — the SECURITY seam).
 *
 * ABSORBS (byte-identical to legacy):
 *   resolveProductId    ⇔ getProductId           (plan-features.middleware.js:26-51)
 *                          slug→UUID startup discovery via /internal/products/juggler,
 *                          cached for the process lifetime; in-flight dedup promise;
 *                          null on failure (fail-soft); discovery-promise reset on error.
 *   resolvePlanCatalog  ⇔ getCachedPlanFeatures   (plan-features.middleware.js:79-100)
 *                          5min TTL; _fetchPromise in-flight dedup; on refetch error
 *                          return last cache if present else throw.
 *   _fetchPlanCatalog   ⇔ fetchPlanFeatures       (plan-features.middleware.js:58-77)
 *                          /api/plans?product=<UUID|slug>&include_all=true; build the
 *                          { planId → features } map (delegates to the W2 pure
 *                          extractCatalogFeatures).
 *   resolveUserPlanId   ⇔ getUserPlanId           (plan-features.middleware.js:105-134)
 *                          2min TTL; SLUG-keyed lookup data.plans?.['juggler'] (the W2
 *                          pure resolvePlanIdBySlug); only cache a truthy planId
 *                          (no-cache-on-null); null on any error (fail-soft).
 *   invalidateUserPlan  ⇔ invalidateUserPlanCache (plan-features.middleware.js:142-144)
 *
 * ── SLUG-KEYING (BINDING — INVARIANT EP-1) ───────────────────────────────────
 * The user plan is resolved by the product SLUG key (`'juggler'`, PRODUCT_LABEL),
 * NEVER a product UUID. The slug is coerced through `PlanSlug` (rejects UUID), and
 * `resolveUserPlanId` delegates the lookup to the pure `resolvePlanIdBySlug` which
 * coerces the key through PlanSlug again — a UUID can never become a plan key. The
 * product UUID from `resolveProductId` is used ONLY as the `?product=` catalog
 * FILTER. The constructor ASSERTS the configured slug is not UUID-shaped.
 *
 * ── PAYMENT_SERVICE_URL (pre-existing approved fallback — VALUE PRESERVED VERBATIM) ─
 * The `'http://localhost:5020'` dev default is reproduced byte-identically
 * outside production (golden-master H13: appears for getProductId,
 * fetchPlanFeatures, getUserPlanId) — same behavior as before. 999.1202 routes
 * the read through lib/config's PAYMENT_SERVICE_URL (requiredInProduction),
 * which only changes the PRODUCTION branch: a missing prod value now fails
 * loud instead of silently resolving every payment-service call to localhost.
 * `INTERNAL_SERVICE_KEY || ''` is still preserved verbatim (out of 999.1202
 * scope — no existing URL-fallback risk there). PRODUCT_LABEL (the slug) is
 * read via lib-config (through service-identity, H2). No NEW `||`/`??`
 * fallback is introduced.
 *
 * ── CIRCUIT BREAKER (999.374, instance-scoped, SHARED across the 3 calls) ─────
 * Each cross-service call (resolveProductId, _fetchPlanCatalog, resolveUserPlanId)
 * uses AbortSignal.timeout(30000) and fail-softs on error. Without a breaker a
 * payment-service outage makes EVERY request hang for the full 30s. A simple
 * in-adapter breaker tracks CONSECUTIVE failures across all 3 calls; after a
 * threshold (default 5) it OPENs and fast-fails (returns the SAME fail-soft result
 * — null, or a throw for the catalog — WITHOUT the HTTP call) for a cooldown
 * (default 30s); after cooldown EXACTLY ONE half-open trial (admitted atomically —
 * a concurrent same-tick call is fast-failed) closes the breaker on success or
 * re-opens it on failure. Each LOGICAL cross-service fetch records AT MOST one
 * outcome (the catalog fetch's product-discovery sub-step does NOT double-count).
 * The fail-soft return contract is UNCHANGED — only the 30s hang is avoided.
 * Threshold / cooldown / clock are deps-injectable for tests.
 *
 * ── CACHE STATE (instance-scoped) ────────────────────────────────────────────
 * The legacy module-global caches become per-instance fields. One adapter instance
 * == one process's cache — behavior-identical to the legacy singleton, and
 * testable (a fresh adapter == a fresh process). The facade (W6) constructs ONE
 * instance, preserving the singleton semantics end-to-end.
 *
 * @implements {import('../domain/ports/EntitlementPort')}
 */

'use strict';

var EntitlementPort = require('../domain/ports/EntitlementPort');
var PlanSlug = require('../domain/value-objects/PlanSlug');
var Entitlement = require('../domain/entities/Entitlement');
var entitlementLogic = require('../domain/logic/entitlement');
var config = require('../../../lib/config');

var CATALOG_CACHE_TTL_MS = EntitlementPort.CATALOG_CACHE_TTL_MS;     // 5 * 60 * 1000
var USER_PLAN_CACHE_TTL_MS = EntitlementPort.USER_PLAN_CACHE_TTL_MS; // 2 * 60 * 1000

/**
 * @constructor
 * @param {object} [deps]
 * @param {string} [deps.productSlug]  the product slug (PRODUCT_LABEL). Defaults to
 *   the lib-config-resolved `service-identity.PRODUCT_LABEL` (slug 'juggler', H2) —
 *   an explicit default through the typed config front door, NOT a `||` data
 *   fallback. Coerced through PlanSlug (rejects UUID — slug-keying assertion).
 * @param {object} [deps.logger]  a logger exposing info/warn/error. Defaults to the
 *   shared lib-logger 'plan-features' channel — explicit default, not a `||`
 *   substitution. Injectable for tests.
 * @param {Function} [deps.fetchImpl]  the fetch implementation. Defaults to the
 *   global `fetch` AT CALL TIME (read lazily so a test mocking `global.fetch`
 *   after construction is honored) — explicit, not a silent fallback.
 */
function PaymentServiceEntitlementAdapter(deps) {
  var d = deps || {};

  // Slug identity — via lib-config (service-identity → config.getString), H2.
  // PlanSlug.from REJECTS a UUID — the slug-keying assertion (INVARIANT EP-1).
  var slugInput = d.productSlug === undefined
    ? require('../../../service-identity').PRODUCT_LABEL
    : d.productSlug;
  this._productSlug = PlanSlug.from(slugInput); // throws if UUID-shaped
  // Belt-and-braces assertion: never a UUID key (slug-keying invariant).
  if (PlanSlug.isUuidShaped(this._productSlug.value)) {
    throw new Error(
      'PaymentServiceEntitlementAdapter: product slug must NOT be a UUID ' +
      '(slug-keying invariant), got: ' + JSON.stringify(this._productSlug.value)
    );
  }

  this._logger = d.logger === undefined
    ? require('@raike/lib-logger').createLogger('plan-features')
    : d.logger;

  // Lazy fetch resolution: read global.fetch at call time (so tests that set
  // global.fetch after constructing the adapter are honored). Explicit injection
  // overrides. NOT a `||` data fallback.
  this._fetchImpl = d.fetchImpl;

  // ── Product UUID discovery state (legacy module-globals → instance fields) ──
  this._productId = null;
  this._productDiscoveryPromise = null;

  // ── Plan catalog cache state ──
  this._planFeaturesCache = null;
  this._cacheTimestamp = 0;
  this._fetchPromise = null;

  // ── User plan cache state ──
  // Per-instance Map — preserved as the single-instance fallback AND a local
  // mirror in front of the shared store. Reads hit it first (fast path, identical
  // to legacy behavior); writes/invalidations go to both.
  this._userPlanCache = new Map();

  // ── Shared (cross-instance) user-plan cache (999.385) ──────────────────────
  // Under Cloud Run scale-out the per-instance Map split-brains: a plan cached or
  // invalidated on instance A is stale on instance B. When REDIS_URL is set we
  // mirror the user-plan cache into the shared lib/redis store (string key per
  // userId, JSON {planId,timestamp}, TTL = USER_PLAN_CACHE_TTL_MS) so all
  // instances see one cache. When Redis is absent/down this layer no-ops (get→null,
  // set/del→false, all fail-soft) and only the in-memory Map is used — the exact
  // legacy single-instance behavior. Injectable for tests (mock the redis client).
  this._sharedCache = d.sharedCache === undefined ? require('../../../lib/redis') : d.sharedCache;

  // ── Circuit breaker state (999.374) — SHARED across all 3 cross-service calls ──
  // A payment-service outage otherwise makes EVERY request hang for the full 30s
  // per-call AbortSignal.timeout before fail-softing. The breaker tracks consecutive
  // failures; after _breakerThreshold it OPENs and fast-fails (returns the SAME
  // fail-soft result WITHOUT making the HTTP call) for _breakerCooldownMs; after the
  // cooldown EXACTLY ONE half-open trial is admitted (the state flips ATOMICALLY to
  // 'half-open-pending' on admission, so a concurrent same-tick call is fast-failed,
  // not admitted as a second trial) — a success CLOSEs the breaker, a failure re-OPENs
  // it. Each LOGICAL cross-service fetch records AT MOST ONE outcome (via _withBreaker;
  // the catalog fetch no longer double-counts product discovery + the catalog HTTP).
  // The fail-soft return contract is UNCHANGED (callers still get null / the same
  // throw); the breaker only avoids the 30s hang. Configurable via deps for tests.
  this._breakerThreshold = d.breakerThreshold === undefined ? 5 : d.breakerThreshold;
  this._breakerCooldownMs = d.breakerCooldownMs === undefined ? 30000 : d.breakerCooldownMs;
  this._breakerState = 'closed';   // 'closed' | 'open' | 'half-open-pending'
  this._breakerFailures = 0;       // consecutive failures
  this._breakerOpenedAt = 0;       // Date.now() when the breaker last OPENed
  // Injectable clock (defaults to Date.now) so tests can advance time deterministically.
  this._now = typeof d.now === 'function' ? d.now : Date.now;
}

PaymentServiceEntitlementAdapter.prototype = Object.create(EntitlementPort.prototype);
PaymentServiceEntitlementAdapter.prototype.constructor = PaymentServiceEntitlementAdapter;

/** @returns {string} the slug string ('juggler'). */
PaymentServiceEntitlementAdapter.prototype._slug = function _slug() {
  return this._productSlug.value;
};

/**
 * Shared-cache key for a user's resolved plan (999.385). Slug-scoped so a future
 * second product never collides. lib/redis prepends its own 'strivers:' keyPrefix.
 * @param {string} userId
 * @returns {string}
 */
PaymentServiceEntitlementAdapter.prototype._userPlanKey = function _userPlanKey(userId) {
  return 'entitlement:' + this._slug() + ':userplan:' + userId;
};

/**
 * Resolve the fetch impl at CALL time. Injected impl wins; else global fetch.
 * Throws loudly if neither exists (fail-loud, not a silent no-op).
 * @returns {Function}
 */
PaymentServiceEntitlementAdapter.prototype._fetch = function _fetch() {
  var f = this._fetchImpl !== undefined ? this._fetchImpl : global.fetch;
  if (typeof f !== 'function') {
    throw new Error('PaymentServiceEntitlementAdapter: no fetch implementation available');
  }
  return f;
};

/**
 * Circuit-breaker gate (999.374). Decide whether a cross-service HTTP call may
 * proceed. Returns true when the breaker is CLOSED, or when it is OPEN but the
 * cooldown has elapsed (transitions to HALF-OPEN, allowing ONE trial). Returns
 * false while OPEN and still within the cooldown window (caller must fast-fail).
 * @returns {boolean}
 */
PaymentServiceEntitlementAdapter.prototype._breakerAllowsCall = function _breakerAllowsCall() {
  if (this._breakerState === 'open') {
    if ((this._now() - this._breakerOpenedAt) >= this._breakerCooldownMs) {
      // Cooldown elapsed → admit exactly ONE half-open trial. Flip to a
      // half-open-IN-FLIGHT marker ('half-open-pending') ATOMICALLY (single-tick,
      // no await between the check and the set) so a concurrent call landing in the
      // same tick sees the pending marker and is fast-failed below — NOT admitted as
      // a second trial. The trial resolves the marker via _breakerRecordSuccess
      // (→ 'closed') or _breakerRecordFailure (→ 'open'). (999.374, half-open
      // atomicity.)
      this._breakerState = 'half-open-pending';
      return true;
    }
    return false; // still OPEN within cooldown → fast-fail
  }
  if (this._breakerState === 'half-open-pending') {
    // A half-open trial is already in flight (admitted earlier this cooldown). Only
    // ONE trial is allowed → fast-fail this concurrent call.
    return false;
  }
  // 'closed' → allow.
  return true;
};

/**
 * Wrap ONE logical cross-service fetch in the breaker so it records AT MOST one
 * success/failure (999.374 — prevents the catalog double-count where product
 * discovery + the catalog HTTP each recorded separately, halving the effective
 * threshold). Gates the call; on fast-fail invokes onFastFail (caller decides the
 * fail-soft shape — null vs throw); otherwise runs fn and records exactly one
 * outcome. fn MUST NOT itself touch the breaker (call the raw `_*Raw` helpers).
 * @template T
 * @param {() => Promise<T>} fn  the raw I/O (no breaker accounting)
 * @param {() => T} onFastFail  produce the fast-fail result when the breaker is open
 * @returns {Promise<T>}
 */
PaymentServiceEntitlementAdapter.prototype._withBreaker = function _withBreaker(fn, onFastFail) {
  if (!this._breakerAllowsCall()) {
    return Promise.resolve().then(onFastFail);
  }
  var self = this;
  return fn().then(function (value) {
    self._breakerRecordSuccess();
    return value;
  }, function (err) {
    self._breakerRecordFailure();
    throw err;
  });
};

/** Record a successful cross-service call — resets failures, CLOSEs the breaker. */
PaymentServiceEntitlementAdapter.prototype._breakerRecordSuccess = function _breakerRecordSuccess() {
  this._breakerFailures = 0;
  this._breakerState = 'closed';
};

/**
 * Record a failed cross-service call. Increments the consecutive-failure count and
 * OPENs the breaker once the threshold is reached (or immediately re-OPENs if the
 * failure happened during a HALF-OPEN trial).
 */
PaymentServiceEntitlementAdapter.prototype._breakerRecordFailure = function _breakerRecordFailure() {
  if (this._breakerState === 'half-open-pending') {
    // The single in-flight half-open trial failed → re-OPEN immediately, restart
    // the cooldown (the pending marker is resolved).
    this._breakerState = 'open';
    this._breakerOpenedAt = this._now();
    return;
  }
  this._breakerFailures += 1;
  if (this._breakerFailures >= this._breakerThreshold) {
    this._breakerState = 'open';
    this._breakerOpenedAt = this._now();
  }
};

/**
 * Slug→UUID product discovery — verbatim from getProductId
 * (plan-features.middleware.js:26-51). Cached for the process (instance) lifetime;
 * in-flight dedup; null on failure; discovery-promise reset so a later call retries.
 * The UUID is the catalog `?product=` FILTER only — never a plan key.
 * @returns {Promise<?string>}
 */
PaymentServiceEntitlementAdapter.prototype.resolveProductId = function resolveProductId() {
  var self = this;
  if (self._productId) return Promise.resolve(self._productId);
  if (self._productDiscoveryPromise) return self._productDiscoveryPromise;

  // Top-level logical fetch → ONE breaker outcome via _withBreaker. The raw HTTP
  // lives in _discoverProductIdRaw (no breaker accounting) so that when the catalog
  // fetch reuses discovery it does NOT double-count (999.374). On fast-fail (breaker
  // open) return the SAME fail-soft null WITHOUT the HTTP call, and reset the in-flight
  // discovery promise so a later (post-cooldown) call retries.
  self._productDiscoveryPromise = self._withBreaker(
    function () { return self._discoverProductIdRaw(); },
    function () { self._productDiscoveryPromise = null; return null; }
  ).catch(function (err) {
    // Raw discovery error → fail-soft null (legacy contract), reset for retry.
    self._productDiscoveryPromise = null;
    self._logger.error('[plan-features] Product discovery failed:', { error: err });
    return null;
  });

  return self._productDiscoveryPromise;
};

/**
 * Raw product discovery HTTP — NO breaker accounting (the caller's _withBreaker owns
 * the single success/failure record). Verbatim from getProductId
 * (plan-features.middleware.js:26-51) minus the breaker. Throws on a non-OK/failed
 * fetch (the breaker wrapper records the failure; resolveProductId maps it to the
 * fail-soft null). Sets _productId on success.
 * @returns {Promise<?string>}
 */
PaymentServiceEntitlementAdapter.prototype._discoverProductIdRaw = async function _discoverProductIdRaw() {
  var PRODUCT_LABEL = this._slug();
  var paymentUrl = config.getString('PAYMENT_SERVICE_URL'); // 999.1202
  var internalKey = process.env.INTERNAL_SERVICE_KEY || '';
  var res = await this._fetch()(paymentUrl + '/internal/products/' + PRODUCT_LABEL, {
    headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error('Product discovery failed (' + res.status + ')');
  var data = await res.json();
  this._productId = data.product.id;
  this._logger.info('[plan-features] Product "' + PRODUCT_LABEL + '" -> ' + this._productId);
  return this._productId;
};

/**
 * Plan catalog fetch — verbatim from fetchPlanFeatures
 * (plan-features.middleware.js:58-77). Filters by the resolved UUID, falling back
 * to the SLUG label as the `?product=` filter when discovery returned null. The
 * { planId → features } map is built by the W2 pure extractCatalogFeatures.
 * @returns {Promise<Object<string, Object>>}
 */
PaymentServiceEntitlementAdapter.prototype._fetchPlanCatalog = function _fetchPlanCatalog() {
  var self = this;
  // ONE logical cross-service fetch = (product discovery, if needed) + the /api/plans
  // HTTP. Wrap the WHOLE thing in a single _withBreaker so it records AT MOST one
  // success/failure (999.374). Previously discovery (via resolveProductId) recorded
  // its own outcome AND the catalog recorded another — two records per logical fetch,
  // halving the effective threshold. The inner step uses the RAW discovery helper (no
  // breaker), never resolveProductId, so there is no nested breaker accounting.
  // On fast-fail (breaker open within cooldown) THROW the same error shape a real
  // failure produces (no HTTP) — resolvePlanCatalog().catch then returns the last
  // cache or re-throws, identical to a real outage. Fail-soft contract unchanged.
  return this._withBreaker(
    function () { return self._fetchPlanCatalogRaw(); },
    function () { throw new Error('Payment service circuit breaker open'); }
  );
};

/**
 * Raw catalog fetch — NO breaker accounting (the _withBreaker wrapper owns the single
 * outcome). Resolves the product UUID for the `?product=` filter via the raw discovery
 * helper (cached UUID reused; no nested breaker), then fetches /api/plans. Verbatim
 * from fetchPlanFeatures (plan-features.middleware.js:58-77) minus the breaker.
 * @returns {Promise<Object<string, Object>>}
 */
PaymentServiceEntitlementAdapter.prototype._fetchPlanCatalogRaw = async function _fetchPlanCatalogRaw() {
  var paymentUrl = config.getString('PAYMENT_SERVICE_URL'); // 999.1202
  var PRODUCT_LABEL = this._slug();

  // Resolve the UUID for the catalog filter WITHOUT a nested breaker record: reuse the
  // cached _productId, else do the raw discovery. A discovery failure here is fail-soft
  // to null (the slug filter is used) — it must NOT abort the catalog fetch, matching
  // resolveProductId's null-on-failure contract. The single breaker outcome for this
  // logical fetch is decided by the /api/plans call below.
  var productId = this._productId;
  if (!productId) {
    try {
      productId = await this._discoverProductIdRaw();
    } catch (err) {
      this._logger.error('[plan-features] Product discovery failed:', { error: err });
      productId = null;
    }
  }
  var filter = productId ? '?product=' + productId : '?product=' + PRODUCT_LABEL;

  var internalKey = process.env.INTERNAL_SERVICE_KEY || '';
  var response = await this._fetch()(paymentUrl + '/api/plans' + filter + '&include_all=true', {
    headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error('Payment service returned ' + response.status);
  var data = await response.json();
  // Pure map build (W2) — byte-identical to the legacy inline loop.
  return entitlementLogic.extractCatalogFeatures(data.plans || []);
};

/**
 * Cached plan catalog — verbatim from getCachedPlanFeatures
 * (plan-features.middleware.js:79-100). 5min TTL; in-flight _fetchPromise dedup;
 * on refetch error return last cache if present, else throw.
 * @returns {Promise<Object<string, Object>>}
 */
PaymentServiceEntitlementAdapter.prototype.resolvePlanCatalog = function resolvePlanCatalog() {
  var self = this;
  var now = Date.now();
  if (self._planFeaturesCache && (now - self._cacheTimestamp) < CATALOG_CACHE_TTL_MS) {
    return Promise.resolve(self._planFeaturesCache);
  }

  if (self._fetchPromise) return self._fetchPromise;

  self._fetchPromise = self._fetchPlanCatalog().then(function (cache) {
    self._planFeaturesCache = cache;
    self._cacheTimestamp = Date.now();
    self._fetchPromise = null;
    return cache;
  }).catch(function (err) {
    self._fetchPromise = null;
    self._logger.error('[plan-features] Failed to fetch from payment service:', { error: err });
    if (self._planFeaturesCache) return self._planFeaturesCache;
    throw err;
  });

  return self._fetchPromise;
};

/**
 * Slug-keyed user-plan resolution — verbatim from getUserPlanId
 * (plan-features.middleware.js:105-134). 2min TTL; the lookup
 * data.plans?.['juggler'] is the W2 pure resolvePlanIdBySlug (coerced through
 * PlanSlug — UUID rejected); only a TRUTHY planId is cached (no-cache-on-null);
 * null on any error (fail-soft).
 * @param {string} userId
 * @returns {Promise<?string>}
 */
PaymentServiceEntitlementAdapter.prototype.resolveUserPlanId = function resolveUserPlanId(userId) {
  var self = this;
  var cached = this._userPlanCache.get(userId);
  if (cached && (Date.now() - cached.timestamp) < USER_PLAN_CACHE_TTL_MS) {
    return Promise.resolve(cached.planId);
  }

  // Local Map miss → consult the shared (cross-instance) cache before the HTTP call
  // (999.385) — but ONLY when the shared store is actually connected. When Redis is
  // absent/down we MUST fall straight through to the breaker SYNCHRONOUSLY (no extra
  // microtask hop): the breaker's half-open atomicity depends on two same-tick callers
  // both reaching _breakerAllowsCall before either awaits. Adding a Promise hop on the
  // legacy/no-Redis path would break that (and is needless work). So: skip the shared
  // read entirely unless the store reports connected.
  if (!this._sharedCacheConnected()) {
    return self._fetchUserPlanIdViaBreaker(userId);
  }

  // Shared store is live → consult it. On a shared hit we warm the local Map (so
  // subsequent same-instance reads stay on the fast path) and return without an HTTP
  // round-trip; on a miss/outage we fall through to the breaker fetch.
  return self._readSharedUserPlan(userId).then(function (shared) {
    if (shared && (Date.now() - shared.timestamp) < USER_PLAN_CACHE_TTL_MS) {
      self._userPlanCache.set(userId, shared);
      return shared.planId;
    }
    return self._fetchUserPlanIdViaBreaker(userId);
  });
};

/**
 * True when the shared cache is present AND reports a live connection. lib/redis
 * exposes isConnected(); a sharedCache without that method (e.g. an always-on test
 * double) is treated as connected so injected mocks still exercise the shared path.
 * (999.385)
 * @returns {boolean}
 */
PaymentServiceEntitlementAdapter.prototype._sharedCacheConnected = function _sharedCacheConnected() {
  var sc = this._sharedCache;
  if (!sc || typeof sc.get !== 'function') return false;
  if (typeof sc.isConnected === 'function') return !!sc.isConnected();
  return true; // injected double without isConnected() → assume usable
};

/**
 * Read the shared (cross-instance) user-plan entry. Returns {planId,timestamp} or
 * null. Fail-soft: any Redis miss/outage/parse issue → null (caller falls back to
 * the HTTP fetch). lib/redis.get already JSON-parses and swallows errors. (999.385)
 * @param {string} userId
 * @returns {Promise<?{planId:string, timestamp:number}>}
 */
PaymentServiceEntitlementAdapter.prototype._readSharedUserPlan = function _readSharedUserPlan(userId) {
  var self = this;
  if (!this._sharedCache || typeof this._sharedCache.get !== 'function') return Promise.resolve(null);
  return Promise.resolve()
    .then(function () { return self._sharedCache.get(self._userPlanKey(userId)); })
    .then(function (val) {
      if (val && typeof val.planId !== 'undefined' && typeof val.timestamp === 'number') return val;
      return null;
    })
    .catch(function () { return null; });
};

/**
 * Run the breaker-wrapped user-plan fetch (extracted so resolveUserPlanId can defer
 * to it after the shared-cache check). Preserves the legacy fail-soft null. (999.385)
 * @param {string} userId
 * @returns {Promise<?string>}
 */
PaymentServiceEntitlementAdapter.prototype._fetchUserPlanIdViaBreaker = function _fetchUserPlanIdViaBreaker(userId) {
  var self = this;
  // ONE logical cross-service fetch → ONE breaker outcome via _withBreaker (raw HTTP
  // in _fetchUserPlanIdRaw, no breaker accounting). On fast-fail (breaker open within
  // cooldown) return the SAME fail-soft null WITHOUT the HTTP call. A raw error is also
  // mapped to the legacy fail-soft null (plan-features.middleware.js:131). (999.374.)
  return this._withBreaker(
    function () { return self._fetchUserPlanIdRaw(userId); },
    function () { return null; }
  ).catch(function () {
    return null;
  });
};

/**
 * Raw user-plan HTTP — NO breaker accounting (the _withBreaker wrapper owns the single
 * outcome). Verbatim from getUserPlanId (plan-features.middleware.js:105-134) minus the
 * breaker. Throws on a non-OK/failed fetch (the wrapper records the failure;
 * resolveUserPlanId maps it to the fail-soft null). Caches only a TRUTHY planId.
 * @param {string} userId
 * @returns {Promise<?string>}
 */
PaymentServiceEntitlementAdapter.prototype._fetchUserPlanIdRaw = async function _fetchUserPlanIdRaw(userId) {
  var paymentUrl = config.getString('PAYMENT_SERVICE_URL'); // 999.1202
  var internalKey = process.env.INTERNAL_SERVICE_KEY || '';
  var res = await this._fetch()(paymentUrl + '/internal/users/' + userId + '/active-plans', {
    headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error('Payment service returned ' + res.status);
  var data = await res.json();
  // active-plans returns a map keyed by products.productId (app SLUG) — look up
  // by the slug 'juggler', same key as the JWT `plans` claims. The pure
  // resolvePlanIdBySlug coerces the key through PlanSlug (rejects UUID).
  var planId = entitlementLogic.resolvePlanIdBySlug(data.plans, this._productSlug);
  // Only cache a TRUTHY planId — don't cache null so a just-subscribed user
  // isn't blocked by a stale null (the W2 pure shouldCacheUserPlan predicate).
  if (entitlementLogic.shouldCacheUserPlan(planId)) {
    var entry = { planId: planId, timestamp: Date.now() };
    this._userPlanCache.set(userId, entry);
    // Mirror to the shared cross-instance store (999.385) with the SAME 2-min TTL
    // as the in-memory expiry. Fire-and-forget + fail-soft — a Redis outage must
    // not fail the request; the local Map already holds the value.
    this._writeSharedUserPlan(userId, entry);
  } else {
    this._userPlanCache.delete(userId);
    this._deleteSharedUserPlan(userId);
  }
  return planId;
};

/**
 * Mirror a user-plan entry into the shared store with the same TTL as the in-memory
 * expiry (999.385). Fire-and-forget; fail-soft (lib/redis.set returns false on outage).
 * @param {string} userId
 * @param {{planId:string, timestamp:number}} entry
 */
PaymentServiceEntitlementAdapter.prototype._writeSharedUserPlan = function _writeSharedUserPlan(userId, entry) {
  if (!this._sharedCacheConnected() || typeof this._sharedCache.set !== 'function') return;
  var ttlSeconds = Math.ceil(USER_PLAN_CACHE_TTL_MS / 1000);
  try {
    var p = this._sharedCache.set(this._userPlanKey(userId), entry, ttlSeconds);
    if (p && typeof p.catch === 'function') p.catch(function () {});
  } catch { /* fail-soft: shared mirror is best-effort */ }
};

/**
 * Delete the shared user-plan entry (999.385). Fire-and-forget; fail-soft.
 * @param {string} userId
 */
PaymentServiceEntitlementAdapter.prototype._deleteSharedUserPlan = function _deleteSharedUserPlan(userId) {
  if (!this._sharedCacheConnected() || typeof this._sharedCache.del !== 'function') return;
  try {
    var p = this._sharedCache.del(this._userPlanKey(userId));
    if (p && typeof p.catch === 'function') p.catch(function () {});
  } catch { /* fail-soft */ }
};

/**
 * Compose user-plan + catalog into an Entitlement entity (slug-keyed), through
 * the W2 pure decideResolvePlan. Returns null when there is no active plan
 * (subscription_required) or the catalog is unavailable — the caller (W5) maps
 * those to the legacy 402/503. The returned Entitlement carries productSlug =
 * 'juggler' (coerced through PlanSlug).
 * @param {string} userId
 * @param {(string|PlanSlug)} [productSlug]  defaults to this adapter's slug.
 * @returns {Promise<?Entitlement>}
 */
PaymentServiceEntitlementAdapter.prototype.resolveEntitlement = async function resolveEntitlement(userId, productSlug) {
  var slug = productSlug === undefined ? this._productSlug : PlanSlug.from(productSlug);
  var realPlanId = await this.resolveUserPlanId(userId);
  var catalog = await this.resolvePlanCatalog();
  var decision = entitlementLogic.decideResolvePlan(realPlanId, catalog);
  if (decision.outcome !== 'resolve') return null;
  return new Entitlement({
    planId: decision.planId,
    planFeatures: decision.planFeatures,
    productSlug: slug
  });
};

/**
 * Drop the cached user-plan — verbatim from invalidateUserPlanCache
 * (plan-features.middleware.js:142-144).
 * @param {string} userId
 */
PaymentServiceEntitlementAdapter.prototype.invalidateUserPlan = function invalidateUserPlan(userId) {
  this._userPlanCache.delete(userId);
  // Webhook-driven invalidation must also drop the SHARED entry (999.385) so a plan
  // change on one instance invalidates the cache for ALL instances — otherwise a
  // stale plan survives on every other instance until its 2-min TTL lapses. Fail-soft.
  this._deleteSharedUserPlan(userId);
};

module.exports = PaymentServiceEntitlementAdapter;
module.exports.PaymentServiceEntitlementAdapter = PaymentServiceEntitlementAdapter;
