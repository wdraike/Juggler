/**
 * lib-cache barrel + factory (H2 / W2).
 *
 * Exposes the CachePort contract, both adapters, and a `createCache()` factory
 * that selects the adapter the way the weather slice selects its provider:
 *
 *   - REDIS_URL set            -> RedisCacheAdapter (production binding over
 *                                 lib/redis; preserves all current semantics).
 *   - REDIS_URL absent + production  -> throws Error (misconfiguration — fail loud).
 *   - REDIS_URL absent + dev/test    -> InMemoryCacheAdapter (deliberate default).
 *
 * In production, a missing REDIS_URL is treated as a misconfiguration rather than
 * a graceful fallback — per-instance in-memory caches would silently diverge across
 * Cloud Run autoscaled instances (BASE-NFR-STANDARD §3.4: no instance-local shared
 * state under scale-out). The in-memory adapter is deliberately kept for dev/test.
 *
 * A single shared CachePort instance is exported as `cache` for consumers that
 * want the module-singleton (matching the old `require('../lib/redis')` shape).
 */

'use strict';

var CachePort = require('./CachePort');
var RedisCacheAdapter = require('./RedisCacheAdapter');
var InMemoryCacheAdapter = require('./InMemoryCacheAdapter');

/**
 * Build a CachePort-conforming cache adapter.
 *
 * @param {object} [opts]
 * @param {('redis'|'memory')} [opts.driver] Force a driver. When omitted, the
 *   driver is chosen from REDIS_URL: set => redis; unset + non-production => memory;
 *   unset + production => throws (misconfiguration).
 * @returns {CachePort}
 */
function createCache(opts) {
  var options = opts === undefined ? {} : opts;
  var driver = options.driver;
  if (driver === undefined) {
    if (!process.env.REDIS_URL) {
      // Deliberate environment-gated default: in-memory is allowed only outside production;
      // a missing REDIS_URL in production is a misconfiguration, not a graceful fallback.
      if (process.env.NODE_ENV === 'production') {
        throw new Error('lib/cache: REDIS_URL is required in production');
      }
      driver = 'memory';
    } else {
      driver = 'redis';
    }
  }
  if (driver === 'redis') return new RedisCacheAdapter();
  if (driver === 'memory') return new InMemoryCacheAdapter();
  throw new Error('createCache: unknown driver "' + driver + '" (expected "redis" or "memory")');
}

module.exports = {
  CachePort: CachePort,
  CACHE_PORT_METHODS: CachePort.CACHE_PORT_METHODS,
  RedisCacheAdapter: RedisCacheAdapter,
  InMemoryCacheAdapter: InMemoryCacheAdapter,
  createCache: createCache,
  // Module-singleton instance, driver chosen at require-time from env.
  cache: createCache()
};
