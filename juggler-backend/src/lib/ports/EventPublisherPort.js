/**
 * EventPublisherPort — driven-port contract for the SSE event emitter
 * (999.1535 — lib/sse-emitter.js).
 *
 * Mirrors the GcalApiPort/AppleCalApiPort/MsftCalApiPort idiom: a JSDoc
 * `@typedef`, a throw-not-implemented prototype base, and a frozen METHODS
 * array.
 *
 * Wraps `src/lib/sse-emitter.js` — the multi-instance SSE emitter consumed
 * throughout controllers and facades — so it exposes EXACTLY that surface:
 * `addClient` / `emit` / `clientCount` / `getStats`.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT EP-1 (multi-instance via Redis pub/sub): events are published to
 *   a Redis channel `sse:{userId}` so all instances receive them regardless
 *   of which instance handled the mutation. Each instance holds its own
 *   in-memory client map for response writing.
 *
 * INVARIANT EP-2 (fallback to local-only): if Redis is unavailable, emit
 *   falls back to direct local emit (single-instance OK). The app never
 *   throws on Redis outage.
 *
 * INVARIANT EP-3 (error isolation): emit and addClient MUST NOT throw into
 *   the caller. Write errors on individual responses are caught and the dead
 *   response is removed from the client set.
 *
 * INVARIANT EP-4 (SSE payload format): emit produces SSE-formatted text
 *   (`event: <type>\ndata: <json>\n\n`) — the wire format the browser
 *   EventSource API expects.
 *
 * @typedef {Object} EventPublisherPort
 *
 * @property {(userId: string, res: ServerResponse) => void} addClient
 *   Register an SSE response for a user. Subscribes to the user's Redis
 *   channel on first local client; cleans up on response close.
 *
 * @property {(userId: string, event: string, data?: Object) => void} emit
 *   Send an SSE event to all connections for a user (local + remote via
 *   Redis pub/sub). Never throws (EP-2, EP-3).
 *
 * @property {(userId: string) => number} clientCount
 *   Number of active SSE connections for a user on THIS instance.
 *
 * @property {() => {activeConnections: number}} getStats
 *   Total active SSE connections on THIS instance.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function EventPublisherPort() {}

EventPublisherPort.prototype.addClient = function addClient(_userId, _res) {
  throw new Error('EventPublisherPort.addClient not implemented');
};

EventPublisherPort.prototype.emit = function emit(_userId, _event, _data) {
  throw new Error('EventPublisherPort.emit not implemented');
};

EventPublisherPort.prototype.clientCount = function clientCount(_userId) {
  throw new Error('EventPublisherPort.clientCount not implemented');
};

EventPublisherPort.prototype.getStats = function getStats() {
  throw new Error('EventPublisherPort.getStats not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy EventPublisherPort.
 * @type {ReadonlyArray<string>}
 */
var EVENT_PUBLISHER_PORT_METHODS = Object.freeze([
  'addClient',
  'emit',
  'clientCount',
  'getStats'
]);

module.exports = EventPublisherPort;
module.exports.EventPublisherPort = EventPublisherPort;
module.exports.EVENT_PUBLISHER_PORT_METHODS = EVENT_PUBLISHER_PORT_METHODS;