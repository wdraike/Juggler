/**
 * ScheduleCachePort — driven-port contract for the scheduler slice's
 * computed-schedule read cache (999.628).
 *
 * Caches the computed schedule (day placements) keyed by `userId:date` with a
 * TTL that lives until the next task mutation. Schedule reads are the most
 * frequent scheduler operation; caching eliminates DB load.
 *
 * Invalidation is driven by task mutation events (already published by
 * TaskEventPort) — the adapter's `invalidateUser(userId)` busts ALL cached
 * schedule entries for that user.
 *
 * ── BINDING INVARIANTS (implementations MUST honor; not optional) ───────────
 *
 * INVARIANT SC-1 (JSON value semantics):
 *   `get(userId, date)` returns the JSON-parsed value, or null on miss.
 *   `set(userId, date, value, ttlSeconds)` serializes with JSON.stringify.
 *   Round-trip MUST be value-equal for any JSON-serializable input.
 *
 * INVARIANT SC-2 (TTL semantics):
 *   `set(userId, date, value, ttlSeconds)` with a truthy ttlSeconds sets that
 *   TTL in SECONDS. Omitting ttlSeconds (or falsy) persists the key with NO
 *   expiry. The TTL is whole seconds, applied at write time.
 *
 * INVARIANT SC-3 (fail-open, never throw):
 *   When the backing store is unavailable, get() resolves null and
 *   set()/del()/invalidateUser() resolve false — they MUST NOT throw. This
 *   mirrors the CachePort fail-open contract (app falls through to MySQL).
 *
 * INVARIANT SC-4 (return shapes):
 *   get() -> Promise<any|null>; set()/del()/invalidateUser() -> Promise<boolean>
 *   (true on success, false on failure/unavailable).
 *
 * INVARIANT SC-5 (key layout):
 *   Keys are namespaced under `schedule:<userId>:<date>` to avoid collision
 *   with other cache namespaces. The adapter owns the key string; callers pass
 *   userId + date.
 *
 * ── end binding invariants ─────────────────────────────────────────────────
 *
 * @typedef {Object} ScheduleCachePort
 *
 * @property {(userId: string, date: string) => Promise<*>} get
 *   Read a cached schedule for a user on a given date (ISO date string
 *   YYYY-MM-DD). Resolve the JSON-parsed value, or null on miss / unavailable
 *   store (INVARIANT SC-1, SC-3).
 *
 * @property {(userId: string, date: string, value: *, ttlSeconds?: number) => Promise<boolean>} set
 *   Cache a schedule value for a user+date. With a truthy `ttlSeconds`, apply
 *   that TTL in seconds; otherwise persist with no expiry. Resolve true on
 *   success, false on failure/unavailable (INVARIANT SC-2, SC-3, SC-4).
 *
 * @property {(userId: string, date: string) => Promise<boolean>} del
 *   Delete a cached schedule entry for a specific user+date. Resolve true on
 *   success, false on failure/unavailable (INVARIANT SC-3, SC-4).
 *
 * @property {(userId: string) => Promise<boolean>} invalidateUser
 *   Bust ALL cached schedule entries for a user (all dates). Called on task
 *   mutation events. Resolve true on success, false on failure/unavailable
 *   (INVARIANT SC-3, SC-4, SC-5).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function ScheduleCachePort() {}

/**
 * @param {string} userId
 * @param {string} date  ISO date string YYYY-MM-DD
 * @returns {Promise<*>}
 */
ScheduleCachePort.prototype.get = function get(_userId, _date) {
  throw new Error('ScheduleCachePort.get not implemented');
};

/**
 * @param {string} userId
 * @param {string} date  ISO date string YYYY-MM-DD
 * @param {*} value
 * @param {number} [ttlSeconds]
 * @returns {Promise<boolean>}
 */
ScheduleCachePort.prototype.set = function set(_userId, _date, _value, _ttlSeconds) {
  throw new Error('ScheduleCachePort.set not implemented');
};

/**
 * @param {string} userId
 * @param {string} date  ISO date string YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
ScheduleCachePort.prototype.del = function del(_userId, _date) {
  throw new Error('ScheduleCachePort.del not implemented');
};

/**
 * Bust ALL cached schedule entries for a user (all dates).
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
ScheduleCachePort.prototype.invalidateUser = function invalidateUser(_userId) {
  throw new Error('ScheduleCachePort.invalidateUser not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy ScheduleCachePort.
 * @type {ReadonlyArray<string>}
 */
var SCHEDULE_CACHE_PORT_METHODS = Object.freeze([
  'get',
  'set',
  'del',
  'invalidateUser'
]);

module.exports = ScheduleCachePort;
module.exports.ScheduleCachePort = ScheduleCachePort;
module.exports.SCHEDULE_CACHE_PORT_METHODS = SCHEDULE_CACHE_PORT_METHODS;
