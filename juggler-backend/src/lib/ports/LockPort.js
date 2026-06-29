/**
 * LockPort — driven-port contract for the per-user DB-backed sync lock
 * (H2 / W2 — lib-sync-lock). Authoritative interface for the distributed
 * mutex that gates scheduling-relevant writers: the scheduler, cal-sync,
 * and (via task-write-queue) user/MCP task mutations.
 *
 * Mirrors the CachePort idiom: a JSDoc `@typedef`, a throw-not-implemented
 * prototype base, and a frozen `LOCK_PORT_METHODS` array.
 *
 * This port wraps the behavior of `src/lib/sync-lock.js` — the de-facto lock
 * API the codebase already uses — so it exposes EXACTLY that surface:
 * `acquireLock` / `releaseLock` / `refreshLock` / `isLocked` / `withSyncLock`
 * / `withLock`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT L-1 (atomic acquisition):
 *   acquireLock uses INSERT with duplicate-key rejection so the first writer
 *   wins atomically. Returns { acquired: true, token } on success or
 *   { acquired: false } if another holder already has the lock.
 *
 * INVARIANT L-2 (token-gated release):
 *   releaseLock requires the correct lock_token. Only the holder can release.
 *
 * INVARIANT L-3 (heartbeat refresh):
 *   refreshLock extends the lock TTL. Returns true if the lock was refreshed,
 *   false if the lock expired or was stolen (0 rows updated).
 *
 * INVARIANT L-4 (safety cap):
 *   Heartbeat stops after MAX_LOCK_AGE (5 min) so a stuck handler can't hold
 *   the lock forever.
 *
 * INVARIANT L-5 (pre-release flush):
 *   withLock flushes the task-write-queue BEFORE releasing the lock so the
 *   scheduler can't grab the lock between release and flush.
 *
 * @typedef {Object} LockPort
 *
 * @property {(userId: string) => Promise<{ acquired: boolean, token?: string }>} acquireLock
 *   Acquire the per-user lock. Returns { acquired: true, token } on success,
 *   { acquired: false } if already held (INVARIANT L-1).
 *
 * @property {(userId: string, token: string) => Promise<void>} releaseLock
 *   Release the per-user lock. Requires the correct token (INVARIANT L-2).
 *
 * @property {(userId: string, token: string) => Promise<boolean>} refreshLock
 *   Extend the lock TTL. Returns true if refreshed, false if expired/stolen
 *   (INVARIANT L-3).
 *
 * @property {(userId: string) => Promise<boolean>} isLocked
 *   Fast non-blocking check: is the lock currently held for this user?
 *
 * @property {(handler: Function) => Function} withSyncLock
 *   Express middleware wrapper. Acquires the lock before the handler,
 *   releases after. Returns 409 if lock can't be acquired.
 *
 * @property {(userId: string, fn: Function, opts?: { flushOnRelease?: boolean }) => Promise<*>} withLock
 *   Programmatic wrapper. Acquires the lock, calls fn with a lock handle,
 *   releases after. Flushes task-write-queue before release (INVARIANT L-5).
 *   Returns null if lock can't be acquired.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function LockPort() {}

/**
 * @param {string} userId
 * @returns {Promise<{ acquired: boolean, token?: string }>}
 */
LockPort.prototype.acquireLock = function acquireLock(_userId) {
  throw new Error('LockPort.acquireLock not implemented');
};

/**
 * @param {string} userId
 * @param {string} token
 * @returns {Promise<void>}
 */
LockPort.prototype.releaseLock = function releaseLock(_userId, _token) {
  throw new Error('LockPort.releaseLock not implemented');
};

/**
 * @param {string} userId
 * @param {string} token
 * @returns {Promise<boolean>}
 */
LockPort.prototype.refreshLock = function refreshLock(_userId, _token) {
  throw new Error('LockPort.refreshLock not implemented');
};

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
LockPort.prototype.isLocked = function isLocked(_userId) {
  throw new Error('LockPort.isLocked not implemented');
};

/**
 * @param {Function} handler
 * @returns {Function}
 */
LockPort.prototype.withSyncLock = function withSyncLock(_handler) {
  throw new Error('LockPort.withSyncLock not implemented');
};

/**
 * @param {string} userId
 * @param {Function} fn
 * @param {{ flushOnRelease?: boolean }} [opts]
 * @returns {Promise<*>}
 */
LockPort.prototype.withLock = function withLock(_userId, _fn, _opts) {
  throw new Error('LockPort.withLock not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy LockPort.
 * @type {ReadonlyArray<string>}
 */
var LOCK_PORT_METHODS = Object.freeze([
  'acquireLock',
  'releaseLock',
  'refreshLock',
  'isLocked',
  'withSyncLock',
  'withLock'
]);

module.exports = LockPort;
module.exports.LockPort = LockPort;
module.exports.LOCK_PORT_METHODS = LOCK_PORT_METHODS;
