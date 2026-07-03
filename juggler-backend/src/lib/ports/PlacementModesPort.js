/**
 * PlacementModesPort — driven-port contract for placement-mode constants
 * (999.944 H7 — lib/placementModes.js).
 *
 * Mirrors the LockPort/SSEPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/placementModes.js` — the canonical set of placement-mode
 * enum values that match the `task_masters.placement_mode` ENUM column
 * (migration 20260518000100).
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT PM-1 (ENUM parity): the values MUST exactly match the database
 *   ENUM column — any mismatch causes silent data corruption.
 *
 * INVARIANT PM-2 (frozen): PLACEMENT_MODES is Object.freeze'd.
 *
 * @typedef {Object} PlacementModesPort
 *
 * @property {Object} PLACEMENT_MODES — frozen enum { REMINDER, ALL_DAY, FIXED,
 *   TIME_WINDOW, TIME_BLOCKS, ANYTIME }
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every property.
 * @constructor
 */
function PlacementModesPort() {}

PlacementModesPort.prototype.PLACEMENT_MODES = Object.freeze({});

/**
 * The exact set of properties an adapter MUST expose to satisfy PlacementModesPort.
 * @type {ReadonlyArray<string>}
 */
var PLACEMENT_MODES_PORT_METHODS = Object.freeze([
  'PLACEMENT_MODES'
]);

module.exports = PlacementModesPort;
module.exports.PlacementModesPort = PlacementModesPort;
module.exports.PLACEMENT_MODES_PORT_METHODS = PLACEMENT_MODES_PORT_METHODS;