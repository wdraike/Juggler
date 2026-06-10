/**
 * InMemoryCacheAdapter — CachePort implementation backed by a process-local Map.
 *
 * For tests and local/dev use where Redis is not available. It replicates the
 * RedisCacheAdapter / lib/redis observable behavior (CachePort invariants
 * C-1..C-5) so the SAME contract suite passes against both:
 *
 *   - C-1 JSON semantics: values are JSON.stringify'd on set and JSON.parse'd on
 *     get, so non-JSON-safe fields (undefined, functions) are dropped EXACTLY as
 *     Redis would. Miss -> null.
 *   - C-2 TTL: ttlSeconds (whole seconds) sets an absolute expiry; omitted/falsy
 *     persists with no expiry. Expired entries read as a miss and are evicted.
 *   - C-3 fail-open / C-4 return shapes: get -> value|null;
 *     set/del/invalidate* -> boolean. This in-memory store never "fails", so it
 *     returns true for writes (matching a healthy Redis); it does not throw.
 *   - C-5 invalidation key layout: identical `user:<id>:…` keys.
 *
 * Each instance owns its own Map (isolated stores for parallel tests). TTL uses
 * an injectable clock (`now`) so expiry can be tested deterministically without
 * real timers.
 */

'use strict';

/**
 * @constructor
 * @param {{ now?: () => number }} [opts] Injectable clock (ms epoch) for tests.
 */
function InMemoryCacheAdapter(opts) {
  var options = opts === undefined ? {} : opts;
  this._store = new Map(); // key -> { json: string, expiresAtMs: number|null }
  // No `||` on a maybe-missing value: explicitly default the clock to Date.now.
  this._now = typeof options.now === 'function' ? options.now : function () { return Date.now(); };
}

InMemoryCacheAdapter.prototype._isExpired = function _isExpired(entry) {
  return entry.expiresAtMs !== null && this._now() >= entry.expiresAtMs;
};

/** @param {string} key @returns {Promise<*>} */
InMemoryCacheAdapter.prototype.get = function get(key) {
  var entry = this._store.get(key);
  if (!entry) return Promise.resolve(null);
  if (this._isExpired(entry)) {
    this._store.delete(key);
    return Promise.resolve(null);
  }
  // Round-trip through JSON to match Redis: a fresh parse each read, and the
  // same value-shape Redis would have stored/returned.
  return Promise.resolve(JSON.parse(entry.json));
};

/** @param {string} key @param {*} value @param {number} [ttlSeconds] @returns {Promise<boolean>} */
InMemoryCacheAdapter.prototype.set = function set(key, value, ttlSeconds) {
  var json = JSON.stringify(value);
  // ttlSeconds truthy => SETEX-equivalent; falsy/omitted => no expiry (C-2),
  // matching lib/redis's `if (ttlSeconds)` branch exactly.
  var expiresAtMs = ttlSeconds ? this._now() + ttlSeconds * 1000 : null;
  this._store.set(key, { json: json, expiresAtMs: expiresAtMs });
  return Promise.resolve(true);
};

/** @param {...string} keys @returns {Promise<boolean>} */
InMemoryCacheAdapter.prototype.del = function del() {
  var keys = Array.prototype.slice.call(arguments);
  for (var i = 0; i < keys.length; i++) {
    this._store.delete(keys[i]);
  }
  return Promise.resolve(true);
};

/** @param {string} userId @returns {Promise<boolean>} */
InMemoryCacheAdapter.prototype.invalidateTasks = function invalidateTasks(userId) {
  return this.del(
    'user:' + userId + ':tasks',
    'user:' + userId + ':version',
    'user:' + userId + ':placements'
  );
};

/** @param {string} userId @returns {Promise<boolean>} */
InMemoryCacheAdapter.prototype.invalidateConfig = function invalidateConfig(userId) {
  return this.del('user:' + userId + ':config');
};

module.exports = InMemoryCacheAdapter;
module.exports.InMemoryCacheAdapter = InMemoryCacheAdapter;
