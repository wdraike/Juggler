/**
 * CalSyncHelpersPort — driven-port contract for calendar-sync terminal-status
 * helpers (999.944 H7 — lib/cal-sync-helpers.js).
 *
 * Mirrors the LockPort/SSEPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/cal-sync-helpers.js` — helper functions for calendar sync
 * terminal-status handling, extracted from cal-sync.controller.js (Plan C).
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT CSH-1 (Juggler-origin only): handleTerminalTaskSync only processes
 *   tasks where ledger.origin === JUGGLER_ORIGIN; non-Juggler events are no-ops.
 *
 * INVARIANT CSH-2 (ingest-only skip): when isIngestOnly is true, returns empty
 *   updates — ingest-only sync never mutates calendar events.
 *
 * INVARIANT CSH-3 (swallow 404/410): when deleting a calendar event, 404/410
 *   errors are swallowed (event already deleted); other errors propagate.
 *
 * @typedef {Object} CalSyncHelpersPort
 *
 * @property {(task: Object, event: Object, ledger: Object, adapter: Object, pToken: string, calCompletedBehavior: string, isIngestOnly: boolean, JUGGLER_ORIGIN: string, throttle: Function) => Promise<Object>} handleTerminalTaskSync
 *   Handle terminal-task calendar sync: delete or update events based on
 *   calCompletedBehavior and task status (INVARIANTS CSH-1..CSH-3).
 *
 * @property {(status: string) => boolean} isTerminalForSync
 *   Check if a task status is terminal for calendar sync purposes.
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function CalSyncHelpersPort() {}

/**
 * @param {Object} task
 * @param {Object} event
 * @param {Object} ledger
 * @param {Object} adapter
 * @param {string} pToken
 * @param {string} calCompletedBehavior
 * @param {boolean} isIngestOnly
 * @param {string} JUGGLER_ORIGIN
 * @param {Function} throttle
 * @returns {Promise<Object>}
 */
CalSyncHelpersPort.prototype.handleTerminalTaskSync = function handleTerminalTaskSync(_task, _event, _ledger, _adapter, _pToken, _calCompletedBehavior, _isIngestOnly, _JUGGLER_ORIGIN, _throttle) {
  throw new Error('CalSyncHelpersPort.handleTerminalTaskSync not implemented');
};

/**
 * @param {string} status
 * @returns {boolean}
 */
CalSyncHelpersPort.prototype.isTerminalForSync = function isTerminalForSync(_status) {
  throw new Error('CalSyncHelpersPort.isTerminalForSync not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy CalSyncHelpersPort.
 * @type {ReadonlyArray<string>}
 */
var CAL_SYNC_HELPERS_PORT_METHODS = Object.freeze([
  'handleTerminalTaskSync',
  'isTerminalForSync'
]);

module.exports = CalSyncHelpersPort;
module.exports.CalSyncHelpersPort = CalSyncHelpersPort;
module.exports.CAL_SYNC_HELPERS_PORT_METHODS = CAL_SYNC_HELPERS_PORT_METHODS;