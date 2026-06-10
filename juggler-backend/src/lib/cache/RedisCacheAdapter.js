/**
 * RedisCacheAdapter — CachePort implementation over `src/lib/redis.js`.
 *
 * Thin delegation: it forwards each CachePort method to the SAME `lib/redis`
 * function the codebase already used, preserving its exact serialization, TTL,
 * fail-open, and invalidation-key semantics (CachePort invariants C-1..C-5).
 * No behavior is added or changed — this is the production binding for the
 * port, so a consumer routed through CachePort behaves identically to one that
 * called lib/redis directly (pinned by the characterization suite).
 *
 * lib/redis lazy-initializes its ioredis client (keyPrefix 'strivers:') on
 * first use and fails open when REDIS_URL is unset or the connection is down —
 * that contract is inherited unchanged.
 */

'use strict';

var libRedis = require('../redis');

/**
 * @constructor
 * @param {object} [redisModule] Injectable for tests; defaults to lib/redis.
 */
function RedisCacheAdapter(redisModule) {
  // No `||` fallback on a maybe-missing value: default the param explicitly to
  // the module singleton when not supplied (documented, not a silent substitute).
  this._redis = redisModule === undefined ? libRedis : redisModule;
}

/** @param {string} key @returns {Promise<*>} */
RedisCacheAdapter.prototype.get = function get(key) {
  return this._redis.get(key);
};

/** @param {string} key @param {*} value @param {number} [ttlSeconds] @returns {Promise<boolean>} */
RedisCacheAdapter.prototype.set = function set(key, value, ttlSeconds) {
  return this._redis.set(key, value, ttlSeconds);
};

/** @param {...string} keys @returns {Promise<boolean>} */
RedisCacheAdapter.prototype.del = function del() {
  var keys = Array.prototype.slice.call(arguments);
  return this._redis.del.apply(this._redis, keys);
};

/** @param {string} userId @returns {Promise<boolean>} */
RedisCacheAdapter.prototype.invalidateTasks = function invalidateTasks(userId) {
  return this._redis.invalidateTasks(userId);
};

/** @param {string} userId @returns {Promise<boolean>} */
RedisCacheAdapter.prototype.invalidateConfig = function invalidateConfig(userId) {
  return this._redis.invalidateConfig(userId);
};

module.exports = RedisCacheAdapter;
module.exports.RedisCacheAdapter = RedisCacheAdapter;
