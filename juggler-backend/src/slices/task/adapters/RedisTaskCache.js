/**
 * RedisTaskCache — TaskCachePort implementation over the H2 lib/cache CachePort
 * (Phase H3 / W4). Formalizes the legacy `task.controller.js` redis-cache path.
 *
 * ── LEGACY PATH CHARACTERIZED (task.controller.js, `require('../lib/redis')`) ──
 * The controller cached two read endpoints and busted them on every mutation:
 *
 *   - getAllTasks (≈662-675):
 *       key  `user:<id>:tasks`
 *       read `cache.get(key)` — return cached `{ tasks, version }` on hit, else
 *            fall through to MySQL
 *       write `cache.set(key, result, 300)` — 300s (5-min) TTL
 *
 *   - getVersion (≈710-718):
 *       key  `user:<id>:version`   ← NOTE: legacy key is `:version`, NOT
 *            `:tasks:version` (the TaskCachePort JSDoc comment said
 *            `:tasks:version`; the SHIPPING controller uses `:version`, and
 *            `lib/redis.invalidateTasks` busts `:version`). This adapter mirrors
 *            the SHIPPING behavior — characterization is the binding gate, so the
 *            real `:version` key wins. Flagged for W5/W6.
 *       read  `cache.get(key)` — return cached `{ version }` on hit
 *       write `cache.set(key, result, 30)` — 30s TTL
 *
 *   - mutation paths (19 call sites): `cache.invalidateTasks(req.user.id)` which
 *     (via lib/redis) deletes `user:<id>:tasks`, `user:<id>:version`,
 *     `user:<id>:placements`.
 *
 * This adapter reproduces those get/set/del semantics IDENTICALLY. It consumes
 * the H2 lib/cache `CachePort` (never a raw redis client) — the production
 * binding (RedisCacheAdapter) forwards to the SAME `lib/redis` functions the
 * controller used, so behavior is byte-for-byte preserved (CachePort invariants
 * C-1..C-5; pinned by the W4 characterization + contract suites).
 *
 * ── TTLs OWNED HERE (the adapter, not the caller, owns key + TTL) ────────────
 *   TASKS_TTL_SECONDS   = 300  (getAllTasks)
 *   VERSION_TTL_SECONDS = 30   (getVersion)
 * The port keeps the seam `userId`-shaped; callers pass a ttl through, but the
 * legacy defaults live here so the application layer (W5) need not re-specify
 * them — matching the literal `300` / `30` in the controller.
 *
 * ── NO NEW FALLBACKS ─────────────────────────────────────────────────────────
 * `getTasks`/`getVersion` resolve null on miss (NOT a thrown error, NOT a silent
 * default) — exactly as `cache.get` does. `invalidateTasks` MUST NOT throw into
 * the write path; the underlying CachePort is fail-open (resolves false, never
 * throws), so this adapter inherits that error-isolation verbatim and adds no
 * `|| default`.
 *
 * @implements {import('../domain/ports/TaskCachePort')}
 */

'use strict';

var TaskCachePort = require('../domain/ports/TaskCachePort');
var libCache = require('../../../lib/cache');

/** Legacy getAllTasks TTL (controller ~675: `cache.set(key, result, 300)`). */
var TASKS_TTL_SECONDS = 300;
/** Legacy getVersion TTL (controller ~718: `cache.set(key, result, 30)`). */
var VERSION_TTL_SECONDS = 30;

/** @param {string} userId */
function tasksKey(userId) {
  return 'user:' + userId + ':tasks';
}

/** @param {string} userId */
function versionKey(userId) {
  return 'user:' + userId + ':version';
}

/**
 * @constructor
 * @param {object} [cache] A CachePort instance. Defaults to the lib/cache
 *   module-singleton (`libCache.cache`) — explicit default, not a `||` silent
 *   substitution for a maybe-missing value.
 */
function RedisTaskCache(cache) {
  this._cache = cache === undefined ? libCache.cache : cache;
}

RedisTaskCache.prototype = Object.create(TaskCachePort.prototype);
RedisTaskCache.prototype.constructor = RedisTaskCache;

/**
 * Read the cached full task-list payload (`{ tasks, version }`) for the user;
 * resolve null on miss. (Legacy: `cache.get('user:<id>:tasks')`.)
 * @param {string} userId
 * @returns {Promise<?Object>}
 */
RedisTaskCache.prototype.getTasks = function getTasks(userId) {
  return this._cache.get(tasksKey(userId));
};

/**
 * Cache the full task-list payload. Defaults to the legacy 300s TTL when the
 * caller omits one. (Legacy: `cache.set('user:<id>:tasks', result, 300)`.)
 * @param {string} userId
 * @param {Object} payload
 * @param {number} [ttlSeconds]
 * @returns {Promise<*>}
 */
RedisTaskCache.prototype.setTasks = function setTasks(userId, payload, ttlSeconds) {
  // Explicit default to the legacy TTL — not a `||`/`??` on a maybe-missing
  // value; the port allows the caller to override, but the legacy literal is
  // owned here.
  var ttl = ttlSeconds === undefined ? TASKS_TTL_SECONDS : ttlSeconds;
  return this._cache.set(tasksKey(userId), payload, ttl);
};

/**
 * Read the cached version payload (`{ version }`) for the user; resolve null on
 * miss. (Legacy: `cache.get('user:<id>:version')`.)
 * @param {string} userId
 * @returns {Promise<?Object>}
 */
RedisTaskCache.prototype.getVersion = function getVersion(userId) {
  return this._cache.get(versionKey(userId));
};

/**
 * Cache the version payload. Defaults to the legacy 30s TTL when the caller
 * omits one. (Legacy: `cache.set('user:<id>:version', result, 30)`.)
 * @param {string} userId
 * @param {Object} payload
 * @param {number} [ttlSeconds]
 * @returns {Promise<*>}
 */
RedisTaskCache.prototype.setVersion = function setVersion(userId, payload, ttlSeconds) {
  var ttl = ttlSeconds === undefined ? VERSION_TTL_SECONDS : ttlSeconds;
  return this._cache.set(versionKey(userId), payload, ttl);
};

/**
 * Bust the user's cached task list + version (+ placements) after a mutation.
 * Delegates to the CachePort's fail-open `invalidateTasks` — MUST NOT throw into
 * the write path. (Legacy: `cache.invalidateTasks(userId)`.)
 * @param {string} userId
 * @returns {Promise<*>}
 */
RedisTaskCache.prototype.invalidateTasks = function invalidateTasks(userId) {
  return this._cache.invalidateTasks(userId);
};

module.exports = RedisTaskCache;
module.exports.RedisTaskCache = RedisTaskCache;
module.exports.TASKS_TTL_SECONDS = TASKS_TTL_SECONDS;
module.exports.VERSION_TTL_SECONDS = VERSION_TTL_SECONDS;
