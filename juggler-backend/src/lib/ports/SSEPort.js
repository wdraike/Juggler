/**
 * SSEPort — driven-port contract for the SSE event emitter (H2 / W2 — lib-sse-emitter).
 * Authoritative interface for server-sent event broadcasting that controllers and
 * infrastructure consume to push real-time updates to connected frontend clients.
 *
 * Mirrors the CachePort idiom: a JSDoc `@typedef`, a throw-not-implemented
 * prototype base, and a frozen `SSE_PORT_METHODS` array.
 *
 * This port wraps the behavior of `src/lib/sse-emitter.js` — the de-facto SSE API
 * the codebase already uses — so it exposes EXACTLY that surface:
 * `addClient` / `emit` / `clientCount` / `getStats`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT S-1 (multi-instance safety):
 *   Events are published to Redis channel `sse:{userId}` so all instances
 *   receive them regardless of which instance handled the mutation. Falls back
 *   to direct local-only emit if Redis is unavailable.
 *
 * INVARIANT S-2 (fail-soft):
 *   If Redis is unavailable, emit() falls back to local-only delivery to
 *   connected clients on this instance. It never throws.
 *
 * INVARIANT S-3 (client lifecycle):
 *   addClient registers a response object for a userId. When the response
 *   closes, the client is automatically removed. The emitter subscribes to
 *   the Redis channel on first client and unsubscribes when the last client
 *   for that userId disconnects.
 *
 * @typedef {Object} SSEPort
 *
 * @property {(userId: string, res: object) => void} addClient
 *   Register an SSE response object for a userId. The response is added to
 *   the in-memory client set and a Redis pub/sub subscription is established
 *   for this user's channel if this is the first local client (INVARIANT S-3).
 *
 * @property {(userId: string, event: string, data: *) => void} emit
 *   Emit an SSE event to a user. The event is published to Redis (all instances)
 *   and delivered locally. Falls back to local-only if Redis is unavailable
 *   (INVARIANT S-1, S-2).
 *
 * @property {(userId: string) => number} clientCount
 *   Return the number of connected SSE clients for a userId.
 *
 * @property {() => { activeConnections: number }} getStats
 *   Return diagnostic stats about the emitter (total active connections).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function SSEPort() {}

/**
 * @param {string} userId
 * @param {object} res
 */
SSEPort.prototype.addClient = function addClient(_userId, _res) {
  throw new Error('SSEPort.addClient not implemented');
};

/**
 * @param {string} userId
 * @param {string} event
 * @param {*} data
 */
SSEPort.prototype.emit = function emit(_userId, _event, _data) {
  throw new Error('SSEPort.emit not implemented');
};

/**
 * @param {string} userId
 * @returns {number}
 */
SSEPort.prototype.clientCount = function clientCount(_userId) {
  throw new Error('SSEPort.clientCount not implemented');
};

/**
 * @returns {{ activeConnections: number }}
 */
SSEPort.prototype.getStats = function getStats() {
  throw new Error('SSEPort.getStats not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy SSEPort.
 * @type {ReadonlyArray<string>}
 */
var SSE_PORT_METHODS = Object.freeze([
  'addClient',
  'emit',
  'clientCount',
  'getStats'
]);

module.exports = SSEPort;
module.exports.SSEPort = SSEPort;
module.exports.SSE_PORT_METHODS = SSE_PORT_METHODS;
