/**
 * RedisPort — driven-port contract for the Redis cache client
 * (999.1535 — lib/redis.js).
 *
 * Mirrors the GcalApiPort/AppleCalApiPort/MsftCalApiPort idiom: a JSDoc
 * `@typedef`, a throw-not-implemented prototype base, and a frozen METHODS
 * array.
 *
 * Wraps `src/lib/redis.js` — the ioredis singleton consumed throughout
 * controllers, facades, and the task-write-queue — so it exposes EXACTLY
 * that surface: `getClient` / `isConnected` / `get` / `set` / `del` /
 * `acquireLock` / `invalidateTasks` / `invalidateConfig` / `quit`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT R-1 (fail-open, never throw): when Redis is unavailable, all
 *   read operations resolve null, all write/delete operations resolve false,
 *   and acquireLock resolves false. The app falls through to MySQL. No
 *   operation throws — callers rely on this error-isolation.
 *
 * INVARIANT R-2 (lazy initialization): the connection is created on first
 *   use (ensureClient), not on require(). This prevents open handles in test
 *   environments and means require() has no side effects.
 *
 * INVARIANT R-3 (JSON value semantics): get returns the JSON-parsed value
 *   (or null on miss), set serializes with JSON.stringify. Round-trip is
 *   value-equal for any JSON-serializable input.
 *
 * INVARIANT R-4 (TTL in seconds): set with a truthy ttlSeconds sets that
 *   TTL via SETEX; omitting it persists with no expiry.
 *
 * INVARIANT R-5 (acquireLock is SET NX EX): returns true only if THIS
 *   caller set the key (SET key value NX EX ttl). False if the key already
 *   exists OR Redis is unavailable. Used for cross-instance dedupe.
 *
 * @typedef {Object} RedisPort
 *
 * @property {() => (Object|null)} getClient
 *   Return the lazy ioredis client (null if REDIS_URL not configured).
 *
 * @property {() => boolean} isConnected
 *   True only when the client exists and status is 'ready'.
 *
 * @property {(key: string) => Promise<?*>} get
 *   Read a cached value (JSON-parsed), or null on miss/unavailable (R-1, R-3).
 *
 * @property {(key: string, value: *, ttlSeconds?: number) => Promise<boolean>} set
 *   Cache a value with optional TTL in seconds (R-3, R-4).
 *
 * @property {(...keys: string) => Promise<boolean>} del
 *   Delete one or more keys. Resolve true on success, false on failure (R-1).
 *
 * @property {(key: string, ttlSeconds: number) => Promise<boolean>} acquireLock
 *   SET key NX EX ttl — true only if THIS caller acquired the lock (R-5).
 *
 * @property {(userId: string) => Promise<boolean>} invalidateTasks
 *   Bust user's cached tasks + version + placements keys.
 *
 * @property {(userId: string) => Promise<boolean>} invalidateConfig
 *   Bust user's cached config key.
 *
 * @property {() => Promise<void>} quit
 *   Graceful shutdown — quit the client and reset internal state.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function RedisPort() {}

RedisPort.prototype.getClient = function getClient() {
  throw new Error('RedisPort.getClient not implemented');
};

RedisPort.prototype.isConnected = function isConnected() {
  throw new Error('RedisPort.isConnected not implemented');
};

RedisPort.prototype.get = function get(_key) {
  throw new Error('RedisPort.get not implemented');
};

RedisPort.prototype.set = function set(_key, _value, _ttlSeconds) {
  throw new Error('RedisPort.set not implemented');
};

RedisPort.prototype.del = function del() {
  throw new Error('RedisPort.del not implemented');
};

RedisPort.prototype.acquireLock = function acquireLock(_key, _ttlSeconds) {
  throw new Error('RedisPort.acquireLock not implemented');
};

RedisPort.prototype.invalidateTasks = function invalidateTasks(_userId) {
  throw new Error('RedisPort.invalidateTasks not implemented');
};

RedisPort.prototype.invalidateConfig = function invalidateConfig(_userId) {
  throw new Error('RedisPort.invalidateConfig not implemented');
};

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