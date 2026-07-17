/**
 * LockPort — driven-port contract for the per-user sync lock
 * (999.1535 — lib/sync-lock.js).
 *
 * Mirrors the GcalApiPort/AppleCalApiPort/MsftCalApiPort idiom: a JSDoc
 * `@typedef`, a throw-not-implemented prototype base, and a frozen METHODS
 * array.
 *
 * Wraps `src/lib/sync-lock.js` — the DB-backed per-user lock consumed by
 * cal-sync, the scheduler, and task-write-queue — so it exposes EXACTLY
 * that surface: `withSyncLock` / `withLock` / `acquireLock` / `releaseLock` /
 * `refreshLock` / `isLocked`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT L-1 (DB-backed, first-writer-wins): uses INSERT with
 *   duplicate-key rejection (ER_DUP_ENTRY). The first caller to INSERT
 *   wins; all others get { acquired: false }. No transaction needed —
 *   the duplicate-key rejection is atomic.
 *
 * INVARIANT L-2 (MySQL clock): all time comparisons use MySQL NOW() to
 *   avoid timezone mismatches between JS Date and the dateStrings knex
 *   config. Heartbeat TTL extension uses DATE_ADD(NOW(), INTERVAL ...).
 *
 * INVARIANT L-3 (heartbeat with safety cap): a background heartbeat
 *   refreshes the lock every 10s (extending TTL by 30s). The heartbeat
 *   stops after MAX_LOCK_AGE (5 min) so a stuck handler cannot hold the
 *   lock forever — it expires via TTL.
 *
 * INVARIANT L-4 (pre-release flush): withLock flushes pending task-write-queue
 *   entries BEFORE releasing the lock so the scheduler cannot grab the lock
 *   between release and flush. This ordering is load-bearing.
 *
 * INVARIANT L-5 (409 on contention): withSyncLock middleware returns
 *   HTTP 409 with retryAfter when the lock is held by another caller.
 *
 * @typedef {Object} LockPort
 *
 * @property {(handler: Function) => Function} withSyncLock
 *   Express middleware wrapper: acquires lock, runs handler, releases on
 *   completion. Returns 409 on contention (L-5).
 *
 * @property {(userId: string, fn: Function, opts?: Object) => Promise<*>} withLock
 *   Acquire lock, run fn({ lost, refresh }), release. Flushes task-write-queue
 *   before release unless opts.flushOnRelease === false (L-4).
 *
 * @property {(userId: string) => Promise<{acquired: boolean, token?: string}>} acquireLock
 *   Low-level acquire. Returns { acquired: true, token } or { acquired: false }.
 *
 * @property {(userId: string, token: string) => Promise<void>} releaseLock
 *   Release the lock by deleting the row matching user_id + token.
 *
 * @property {(userId: string, token: string) => Promise<boolean>} refreshLock
 *   Extend the lock TTL by REFRESH_TTL_SECONDS. True if the row was updated.
 *
 * @property {(userId: string) => Promise<boolean>} isLocked
 *   Fast non-blocking check: is the lock currently held for this user?
 *   PK lookup — sub-millisecond.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function LockPort() {}

LockPort.prototype.withSyncLock = function withSyncLock(_handler) {
  throw new Error('LockPort.withSyncLock not implemented');
};

LockPort.prototype.withLock = function withLock(_userId, _fn, _opts) {
  throw new Error('LockPort.withLock not implemented');
};

LockPort.prototype.acquireLock = function acquireLock(_userId) {
  throw new Error('LockPort.acquireLock not implemented');
};

LockPort.prototype.releaseLock = function releaseLock(_userId, _token) {
  throw new Error('LockPort.releaseLock not implemented');
};

LockPort.prototype.refreshLock = function refreshLock(_userId, _token) {
  throw new Error('LockPort.refreshLock not implemented');
};

LockPort.prototype.isLocked = function isLocked(_userId) {
  throw new Error('LockPort.isLocked not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy LockPort.
 * @type {ReadonlyArray<string>}
 */
var LOCK_PORT_METHODS = Object.freeze([
  'withSyncLock',
  'withLock',
  'acquireLock',
  'releaseLock',
  'refreshLock',
  'isLocked'
]);

module.exports = LockPort;
module.exports.LockPort = LockPort;
module.exports.LOCK_PORT_METHODS = LOCK_PORT_METHODS;