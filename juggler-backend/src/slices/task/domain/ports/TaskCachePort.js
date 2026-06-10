/**
 * TaskCachePort — driven-port contract for the task slice's read-through cache
 * (Phase H3 — defined in W3, IMPLEMENTED in W4 by `RedisTaskCache` over lib/cache).
 *
 * Models the EXACT cache surface the legacy `task.controller.js` uses against
 * `src/lib/redis` (characterized, not redesigned):
 *
 *   - `getTasks(userId)` / `setTasks(userId, payload, ttl)` — the `getAllTasks`
 *     full-list cache (`user:<id>:tasks`, 300s TTL, controller ~662-675).
 *   - `getVersion(userId)` / `setVersion(userId, payload, ttl)` — the `getVersion`
 *     cache (`user:<id>:version`, 30s TTL, controller ~713-718).
 *   - `invalidateTasks(userId)` — the post-write cache bust every mutation path
 *     calls (`cache.invalidateTasks(req.user.id)`, 19 call sites).
 *
 * The keying + TTL semantics are owned by the W4 adapter and MUST match the
 * legacy `user:<userId>:tasks` / `:version` keys and the 300s / 30s TTLs exactly
 * — the port keeps the seam `userId`-shaped so the adapter, not the caller, owns
 * the key string. Read-misses resolve null (NOT a thrown error and NOT a silent
 * default), exactly as `redis.get` does on a miss.
 *
 * ── BINDING NOTE (no new fallbacks) ──────────────────────────────────────────
 * `invalidateTasks` MUST NOT throw into the write path — the legacy call sites
 * either `await` it inside the handler's try/catch or fire-and-forget with an
 * explicit `.catch(e => logger.error(...))` (controller ~1044). The W4 adapter
 * preserves that error-isolation verbatim; it introduces no `|| default`.
 *
 * Contract only (W3) — JSDoc `@typedef` + throw-not-implemented base, mirroring
 * `WeatherCacheRepositoryPort`.
 *
 * @typedef {Object} TaskCachePort
 *
 * @property {(userId: string) => Promise<?Object>} getTasks
 *   Read the cached full task-list payload (`{ tasks, version }`) for the user;
 *   resolve null on miss. (Legacy: `cache.get('user:<id>:tasks')`.)
 *
 * @property {(userId: string, payload: Object, ttlSeconds: number) => Promise<void>} setTasks
 *   Cache the full task-list payload with the given TTL (legacy: 300s).
 *
 * @property {(userId: string) => Promise<?Object>} getVersion
 *   Read the cached version payload for the user; resolve null on miss.
 *
 * @property {(userId: string, payload: Object, ttlSeconds: number) => Promise<void>} setVersion
 *   Cache the version payload with the given TTL (legacy: 30s).
 *
 * @property {(userId: string) => Promise<void>} invalidateTasks
 *   Bust the user's cached task list + version after a mutation. MUST NOT throw
 *   into the write path. (Legacy: `cache.invalidateTasks(userId)`.)
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses (W4 `RedisTaskCache`) MUST override
 * every method.
 * @constructor
 */
function TaskCachePort() {}

TaskCachePort.prototype.getTasks = function getTasks(_userId) {
  throw new Error('TaskCachePort.getTasks not implemented');
};

TaskCachePort.prototype.setTasks = function setTasks(_userId, _payload, _ttlSeconds) {
  throw new Error('TaskCachePort.setTasks not implemented');
};

TaskCachePort.prototype.getVersion = function getVersion(_userId) {
  throw new Error('TaskCachePort.getVersion not implemented');
};

TaskCachePort.prototype.setVersion = function setVersion(_userId, _payload, _ttlSeconds) {
  throw new Error('TaskCachePort.setVersion not implemented');
};

TaskCachePort.prototype.invalidateTasks = function invalidateTasks(_userId) {
  throw new Error('TaskCachePort.invalidateTasks not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy TaskCachePort.
 * @type {ReadonlyArray<string>}
 */
var TASK_CACHE_PORT_METHODS = Object.freeze([
  'getTasks',
  'setTasks',
  'getVersion',
  'setVersion',
  'invalidateTasks'
]);

module.exports = TaskCachePort;
module.exports.TaskCachePort = TaskCachePort;
module.exports.TASK_CACHE_PORT_METHODS = TASK_CACHE_PORT_METHODS;
