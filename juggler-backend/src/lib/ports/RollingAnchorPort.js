/**
 * RollingAnchorPort — driven-port contract for rolling-cadence anchor logic
 * (999.944 H7 — lib/rolling-anchor.js).
 *
 * Mirrors the LockPort/SSEPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/rolling-anchor.js` — helpers for the rolling-cadence recurring
 * task anchor update logic, used by task.controller.js, cal-history-cron.js,
 * and mcp/tools/tasks.js.
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT RA-1 (done anchors to actual completion): for status='done', the
 *   anchor is set to completionDate (falling back to instanceDate) so a late
 *   completion pushes the next occurrence from the real completion day.
 *
 * INVARIANT RA-2 (skip anchors to scheduled day): for status='skip', the anchor
 *   is set to instanceDate — skip is NOT a completion.
 *
 * INVARIANT RA-3 (cancel = no change): for status='cancel', returns null.
 *
 * INVARIANT RA-4 (never move backwards): if the candidate date < currentAnchor,
 *   returns null (stale/duplicate event guard).
 *
 * @typedef {Object} RollingAnchorPort
 *
 * @property {(masterRow: Object) => boolean} isRollingMaster
 *   Returns true if the task_masters row has recur.type === 'rolling'.
 *
 * @property {(status: string, instanceDate: string, currentAnchor: string|null, completionDate?: string) => string|null} computeRollingAnchor
 *   Compute the new rolling_anchor for a terminal status event (INVARIANTS RA-1..RA-4).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function RollingAnchorPort() {}

/**
 * @param {Object} masterRow
 * @returns {boolean}
 */
RollingAnchorPort.prototype.isRollingMaster = function isRollingMaster(_masterRow) {
  throw new Error('RollingAnchorPort.isRollingMaster not implemented');
};

/**
 * @param {string} status
 * @param {string} instanceDate
 * @param {string|null} currentAnchor
 * @param {string} [completionDate]
 * @returns {string|null}
 */
RollingAnchorPort.prototype.computeRollingAnchor = function computeRollingAnchor(_status, _instanceDate, _currentAnchor, _completionDate) {
  throw new Error('RollingAnchorPort.computeRollingAnchor not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy RollingAnchorPort.
 * @type {ReadonlyArray<string>}
 */
var ROLLING_ANCHOR_PORT_METHODS = Object.freeze([
  'isRollingMaster',
  'computeRollingAnchor'
]);

module.exports = RollingAnchorPort;
module.exports.RollingAnchorPort = RollingAnchorPort;
module.exports.ROLLING_ANCHOR_PORT_METHODS = ROLLING_ANCHOR_PORT_METHODS;