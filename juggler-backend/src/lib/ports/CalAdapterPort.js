/**
 * CalAdapterPort — driven-port contract for the calendar adapter registry
 * (999.944 H7 — lib/cal-adapters/).
 *
 * Mirrors the LockPort/SSEPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/cal-adapters/index.js` — the adapter registry that maps
 * provider IDs ({gcal, msft, apple}) to their concrete adapter objects.
 * The index.js shim re-exports from the calendar slice facade (W5).
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT CA-1 (provider set): the registry contains exactly the three
 *   supported providers: gcal, msft, apple. No other keys are valid.
 *
 * INVARIANT CA-2 (connected-only): getConnectedAdapters(user) returns only
 *   adapters whose isConnected(user) returns true — i.e. those with valid
 *   connected credentials for the given user.
 *
 * INVARIANT CA-3 (register is additive): registerAdapter(adapter) adds or
 *   replaces an adapter, keyed by adapter.providerId; it does not remove or
 *   clear other providers.
 *
 * @typedef {Object} CalAdapterPort
 *
 * @property {() => Array<Object>} getAllAdapters
 *   Return an array of all registered adapters.
 *
 * @property {(user: Object) => Array<Object>} getConnectedAdapters
 *   Return only adapters with valid connected credentials for the user (INVARIANT CA-2).
 *
 * @property {(providerId: string) => Object|null} getAdapter
 *   Return the adapter for a provider ID, or null if not registered.
 *
 * @property {(adapter: Object) => void} registerAdapter
 *   Register or replace an adapter, keyed by adapter.providerId (INVARIANT CA-3).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function CalAdapterPort() {}

/**
 * @returns {Array<Object>}
 */
CalAdapterPort.prototype.getAllAdapters = function getAllAdapters() {
  throw new Error('CalAdapterPort.getAllAdapters not implemented');
};

/**
 * @param {Object} user
 * @returns {Array<Object>}
 */
CalAdapterPort.prototype.getConnectedAdapters = function getConnectedAdapters(_user) {
  throw new Error('CalAdapterPort.getConnectedAdapters not implemented');
};

/**
 * @param {string} providerId
 * @returns {Object|null}
 */
CalAdapterPort.prototype.getAdapter = function getAdapter(_providerId) {
  throw new Error('CalAdapterPort.getAdapter not implemented');
};

/**
 * @param {Object} adapter
 * @returns {void}
 */
CalAdapterPort.prototype.registerAdapter = function registerAdapter(_adapter) {
  throw new Error('CalAdapterPort.registerAdapter not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy CalAdapterPort.
 * @type {ReadonlyArray<string>}
 */
var CAL_ADAPTER_PORT_METHODS = Object.freeze([
  'getAllAdapters',
  'getConnectedAdapters',
  'getAdapter',
  'registerAdapter'
]);

module.exports = CalAdapterPort;
module.exports.CalAdapterPort = CalAdapterPort;
module.exports.CAL_ADAPTER_PORT_METHODS = CAL_ADAPTER_PORT_METHODS;