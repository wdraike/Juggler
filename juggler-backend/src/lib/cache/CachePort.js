/**
 * CachePort — driven-port contract for the application's key/value read cache
 * (H2 / W2 — lib-cache). Authoritative interface for the caching layer that
 * controllers and the scheduler consume.
 *
 * Mirrors the weather slice's port idiom (WeatherCacheRepositoryPort):
 * a JSDoc `@typedef`, a throw-not-implemented prototype base, and a frozen
 * `CACHE_PORT_METHODS` array a contract test asserts adapters conform to.
 *
 * This port wraps the behavior of `src/lib/redis.js` — the de-facto cache API
 * the codebase already uses — so it exposes EXACTLY that surface:
 * `get` / `set` / `del`, plus the two domain invalidation helpers
 * (`invalidateTasks`, `invalidateConfig`) that consumers call by name.
 *
 * ── BINDING INVARIANTS (implementations MUST honor; pinned by the contract +
 *    characterization suites — NOT optional) ──────────────────────────────────
 *
 * INVARIANT C-1 (JSON value semantics):
 *   `set(key, value)` serializes `value` with JSON.stringify; `get(key)` returns
 *   the JSON.parse'd value, or null on miss. Round-trip MUST be value-equal for
 *   any JSON-serializable input. (lib/redis stores JSON strings.)
 *
 * INVARIANT C-2 (TTL semantics):
 *   `set(key, value, ttlSeconds)` with a truthy ttlSeconds sets that TTL in
 *   SECONDS (SETEX-equivalent). Omitting ttlSeconds (or falsy) persists the key
 *   with NO expiry. The TTL is whole seconds, applied at write time.
 *
 * INVARIANT C-3 (fail-open, never throw):
 *   When the backing store is unavailable, get() resolves null and
 *   set()/del()/invalidate*() resolve false — they MUST NOT throw. This mirrors
 *   lib/redis's documented fail-open contract (app falls through to MySQL).
 *
 * INVARIANT C-4 (return shapes):
 *   get() -> Promise<any|null>; set()/del()/invalidateTasks()/invalidateConfig()
 *   -> Promise<boolean> (true on success, false on failure/unavailable).
 *
 * INVARIANT C-5 (invalidation key layout — preserved from lib/redis verbatim):
 *   invalidateTasks(userId) deletes `user:<userId>:tasks`,
 *   `user:<userId>:version`, `user:<userId>:placements`.
 *   invalidateConfig(userId) deletes `user:<userId>:config`.
 *
 * ── end binding invariants ──────────────────────────────────────────────────
 *
 * @typedef {Object} CachePort
 *
 * @property {(key: string) => Promise<*>} get
 *   Read a cached value. Resolve the JSON-parsed value, or null on miss /
 *   unavailable store (INVARIANT C-1, C-3).
 *
 * @property {(key: string, value: *, ttlSeconds?: number) => Promise<boolean>} set
 *   Write a cached value (JSON-serialized). With a truthy `ttlSeconds`, apply
 *   that TTL in seconds; otherwise persist with no expiry. Resolve true on
 *   success, false on failure/unavailable (INVARIANT C-2, C-3, C-4).
 *
 * @property {(...keys: string[]) => Promise<boolean>} del
 *   Delete one or more keys. Resolve true on success, false on
 *   failure/unavailable (INVARIANT C-3, C-4).
 *
 * @property {(userId: string) => Promise<boolean>} invalidateTasks
 *   Delete the task-related caches for a user (tasks + version + placements —
 *   INVARIANT C-5). Resolve true on success, false on failure/unavailable.
 *
 * @property {(userId: string) => Promise<boolean>} invalidateConfig
 *   Delete the config cache for a user (INVARIANT C-5). Resolve true on success,
 *   false on failure/unavailable.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function CachePort() {}

/**
 * @param {string} key
 * @returns {Promise<*>}
 */
CachePort.prototype.get = function get(_key) {
  throw new Error('CachePort.get not implemented');
};

/**
 * @param {string} key
 * @param {*} value
 * @param {number} [ttlSeconds]
 * @returns {Promise<boolean>}
 */
CachePort.prototype.set = function set(_key, _value, _ttlSeconds) {
  throw new Error('CachePort.set not implemented');
};

/**
 * @param {...string} keys
 * @returns {Promise<boolean>}
 */
CachePort.prototype.del = function del(..._keys) {
  throw new Error('CachePort.del not implemented');
};

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
CachePort.prototype.invalidateTasks = function invalidateTasks(_userId) {
  throw new Error('CachePort.invalidateTasks not implemented');
};

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
CachePort.prototype.invalidateConfig = function invalidateConfig(_userId) {
  throw new Error('CachePort.invalidateConfig not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy CachePort.
 * A contract test asserts adapters conform.
 * @type {ReadonlyArray<string>}
 */
var CACHE_PORT_METHODS = Object.freeze([
  'get',
  'set',
  'del',
  'invalidateTasks',
  'invalidateConfig'
]);

module.exports = CachePort;
module.exports.CachePort = CachePort;
module.exports.CACHE_PORT_METHODS = CACHE_PORT_METHODS;
