/**
 * RedisScheduleCache — ScheduleCachePort implementation over the H2 lib/cache
 * CachePort (999.628).
 *
 * Caches computed schedule (day placements) keyed by `userId:date` with a TTL
 * that lives until the next task mutation. Schedule reads are the most frequent
 * scheduler operation; caching eliminates DB load.
 *
 * ── KEY LAYOUT (INVARIANT SC-5) ─────────────────────────────────────────────
 *   `schedule:<userId>:<date>` — e.g. `schedule:abc123:2026-06-17`
 *
 * ── INVALIDATION ─────────────────────────────────────────────────────────────
 *   `invalidateUser(userId)` scans for all keys matching `schedule:<userId>:*`
 *   and deletes them. This is called on task mutation events (published by
 *   TaskEventPort) to bust the cached schedule for the affected user.
 *
 * ── FAIL-OPEN (INVARIANT SC-3) ───────────────────────────────────────────────
 *   All methods resolve null/false when the backing store is unavailable — they
 *   MUST NOT throw. This mirrors the CachePort fail-open contract (app falls
 *   through to MySQL).
 *
 * @implements {import('../domain/ports/ScheduleCachePort')}
 */

'use strict';

var ScheduleCachePort = require('../domain/ports/ScheduleCachePort');
var libCache = require('../../../lib/cache');
var libRedis = require('../../../lib/redis');

/** Default TTL for cached schedule entries (seconds). */
var DEFAULT_TTL_SECONDS = 300; // 5 minutes — matches the task-list cache TTL

/**
 * Build the cache key for a user+date pair.
 * @param {string} userId
 * @param {string} date  ISO date string YYYY-MM-DD
 * @returns {string}
 */
function scheduleKey(userId, date) {
  return 'schedule:' + userId + ':' + date;
}

/**
 * Build the scan pattern for all schedule keys belonging to a user.
 * @param {string} userId
 * @returns {string}
 */
function userScanPattern(userId) {
  return 'schedule:' + userId + ':*';
}

/**
 * @constructor
 * @param {object} [cache] A CachePort instance. Defaults to the lib/cache
 *   module-singleton.
 */
function RedisScheduleCache(cache) {
  this._cache = cache === undefined ? libCache.cache : cache;
}

RedisScheduleCache.prototype = Object.create(ScheduleCachePort.prototype);
RedisScheduleCache.prototype.constructor = RedisScheduleCache;

/**
 * Read a cached schedule for a user on a given date.
 * Resolve null on miss or unavailable store (INVARIANT SC-1, SC-3).
 * @param {string} userId
 * @param {string} date  ISO date string YYYY-MM-DD
 * @returns {Promise<*>}
 */
RedisScheduleCache.prototype.get = function get(userId, date) {
  return this._cache.get(scheduleKey(userId, date));
};

/**
 * Cache a schedule value for a user+date. Defaults to the 300s TTL when the
 * caller omits one (INVARIANT SC-2).
 * @param {string} userId
 * @param {string} date  ISO date string YYYY-MM-DD
 * @param {*} value
 * @param {number} [ttlSeconds]
 * @returns {Promise<boolean>}
 */
RedisScheduleCache.prototype.set = function set(userId, date, value, ttlSeconds) {
  var ttl = ttlSeconds === undefined ? DEFAULT_TTL_SECONDS : ttlSeconds;
  return this._cache.set(scheduleKey(userId, date), value, ttl);
};

/**
 * Delete a cached schedule entry for a specific user+date.
 * Resolve true on success, false on failure/unavailable (INVARIANT SC-3, SC-4).
 * @param {string} userId
 * @param {string} date  ISO date string YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
RedisScheduleCache.prototype.del = function del(userId, date) {
  return this._cache.del(scheduleKey(userId, date));
};

/**
 * Bust ALL cached schedule entries for a user (all dates). Uses SCAN to find
 * matching keys and DEL to remove them. Resolve true on success, false on
 * failure/unavailable (INVARIANT SC-3, SC-4, SC-5).
 *
 * Called on task mutation events to ensure stale schedule data is not served.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
RedisScheduleCache.prototype.invalidateUser = async function invalidateUser(userId) {
  var pattern = userScanPattern(userId);
  try {
    var keys = await scanKeys(pattern);
    if (keys.length === 0) return true;
    return this._cache.del.apply(this._cache, keys);
  } catch (__err) {
    return false;
  }
};

/**
 * Scan Redis for all keys matching a glob pattern. Uses iterative SCAN (not
 * KEYS) to avoid blocking the Redis event loop on large key spaces.
 *
 * @param {string} pattern  Redis glob pattern (e.g. `schedule:abc123:*`)
 * @returns {Promise<string[]>}  Resolved array of matching key names
 */
async function scanKeys(pattern) {
  var client = libRedis.getClient();
  if (!client) return [];

  var keys = [];
  var cursor = '0';

  do {
    var result = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    var batch = result[1];
    if (batch.length > 0) {
      keys = keys.concat(batch);
    }
  } while (cursor !== '0');

  return keys;
}

module.exports = RedisScheduleCache;
module.exports.RedisScheduleCache = RedisScheduleCache;
module.exports.DEFAULT_TTL_SECONDS = DEFAULT_TTL_SECONDS;
