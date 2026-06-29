/**
 * RedisPort — driven-port contract for the Redis client (H2 / W2 — lib-redis).
 * Authoritative interface for the Redis caching and lightweight lock layer that
 * controllers, the scheduler, and other infrastructure consume.
 *
 * Mirrors the CachePort idiom: a JSDoc `@typedef`, a throw-not-implemented
 * prototype base, and a frozen `REDIS_PORT_METHODS` array.
 *
 * This port wraps the behavior of `src/lib/redis.js` — the de-facto Redis API
 * the codebase already uses — so it exposes EXACTLY that surface:
 * `get` / `set` / `del` / `acquireLock` / `invalidateTasks` / `invalidateConfig`
 * / `quit`, plus the diagnostic helpers `getClient` and `isConnected`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT R-1 (JSON value semantics):
 *   `set(key, value)` serializes `value` with JSON.stringify; `get(key)` returns
 *   the JSON.parse'd value, or null on miss. Round-trip MUST be value-equal for
 *   any JSON-serializable input.
 *
 * INVARIANT R-2 (TTL semantics):
 *   `set(key, value, ttlSeconds)` with a truthy ttlSeconds sets that TTL in
 *   SECONDS (SETEX-equivalent). Omitting ttlSeconds (or falsy) persists the key
 *   with NO expiry.
 *
 * INVARIANT R-3 (fail-open, never throw):
 *   When the backing store is unavailable, get() resolves null and
 *   set()/del()/acquireLock()/invalidate*() resolve false — they MUST NOT throw.
 *
 * INVARIANT R-4 (return shapes):
 *   get() -> Promise<any|null>; set()/del()/acquireLock()/invalidateTasks()/
 *   invalidateConfig() -> Promise<boolean>; quit() -> Promise<void>.
 *
 * INVARIANT R-5 (invalidation key layout — preserved from lib/redis verbatim):
 *   invalidateTasks(userId) deletes `user:<userId>:tasks`,
 *   `user:<userId>:version`, `user:<userId>:placements`.
 *   invalidateConfig(userId) deletes `user:<userId>:config`.
 *
 * @typedef {Object} RedisPort
 *
 * @property {() => object|null} getClient
 *   Return the underlying Redis client instance, or null if not connected.
 *
 * @property {() => boolean} isConnected
 *   Return true if the Redis client is connected and ready.
 *
 * @property {(key: string) => Promise<*>} get
 *   Read a cached value. Resolve the JSON-parsed value, or null on miss /
 *   unavailable store (INVARIANT R-1, R-3).
 *
 * @property {(key: string, value: *, ttlSeconds?: number) => Promise<boolean>} set
 *   Write a cached value (JSON-serialized). With a truthy `ttlSeconds`, apply
 *   that TTL in seconds; otherwise persist with no expiry. Resolve true on
 *   success, false on failure/unavailable (INVARIANT R-2, R-3, R-4).
 *
 * @property {(...keys: string[]) => Promise<boolean>} del
 *   Delete one or more keys. Resolve true on success, false on
 *   failure/unavailable (INVARIANT R-3, R-4).
 *
 * @property {(key: string, ttlSeconds: number) => Promise<boolean>} acquireLock
 *   Acquire a short-lived dedupe lock (SET key value NX EX ttl). Resolve true
 *   if THIS caller set the key, false if the key already exists or Redis is
 *   unavailable (INVARIANT R-3, R-4).
 *
 * @property {(userId: string) => Promise<boolean>} invalidateTasks
 *   Delete the task-related caches for a user (tasks + version + placements —
 *   INVARIANT R-5). Resolve true on success, false on failure/unavailable.
 *
 * @property {(userId: string) => Promise<boolean>} invalidateConfig
 *   Delete the config cache for a user (INVARIANT R-5). Resolve true on success,
 *   false on failure/unavailable.
 *
 * @property {() => Promise<void>} quit
 *   Gracefully close the Redis connection.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function RedisPort() {}

/**
 * @returns {object|null}
 */
RedisPort.prototype.getClient = function getClient() {
  throw new Error('RedisPort.getClient not implemented');
};

/**
 * @returns {boolean}
 */
RedisPort.prototype.isConnected = function isConnected() {
  throw new Error('RedisPort.isConnected not implemented');
};

/**
 * @param {string} key
 * @returns {Promise<*>}
 */
RedisPort.prototype.get = function get(_key) {
  throw new Error('RedisPort.get not implemented');
};

/**
 * @param {string} key
 * @param {*} value
 * @param {number} [ttlSeconds]
 * @returns {Promise<boolean>}
 */
RedisPort.prototype.set = function set(_key, _value, _ttlSeconds) {
  throw new Error('RedisPort.set not implemented');
};

/**
 * @param {...string} keys
 * @returns {Promise<boolean>}
 */
RedisPort.prototype.del = function del(..._keys) {
  throw new Error('RedisPort.del not implemented');
};

/**
 * @param {string} key
 * @param {number} ttlSeconds
 * @returns {Promise<boolean>}
 */
RedisPort.prototype.acquireLock = function acquireLock(_key, _ttlSeconds) {
  throw new Error('RedisPort.acquireLock not implemented');
};

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
RedisPort.prototype.invalidateTasks = function invalidateTasks(_userId) {
  throw new Error('RedisPort.invalidateTasks not implemented');
};

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
RedisPort.prototype.invalidateConfig = function invalidateConfig(_userId) {
  throw new Error('RedisPort.invalidateConfig not implemented');
};

/**
 * @returns {Promise<void>}
 */
RedisPort.prototype.quit = function quit() {
  throw new Error('RedisPort.quit not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy RedisPort.
 * @type {ReadonlyArray<string>}
 */
var REDIS_PORT_METHODS = Object.freeze([
  'getClient',
  'isConnected',
  'get',
  'set',
  'del',
  'acquireLock',
  'invalidateTasks',
  'invalidateConfig',
  'quit'
]);

module.exports = RedisPort;
module.exports.RedisPort = RedisPort;
module.exports.REDIS_PORT_METHODS = REDIS_PORT_METHODS;
