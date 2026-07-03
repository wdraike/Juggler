/**
 * IsAllDayTaskPort — driven-port contract for the all-day-task backend predicate
 * (999.944 H7 — lib/isAllDayTaskBackend.js).
 *
 * Mirrors the LockPort/SSEPort idiom: a JSDoc `@typedef`, a
 * throw-not-implemented prototype base, and a frozen METHODS array.
 *
 * Wraps `src/lib/isAllDayTaskBackend.js` — the canonical predicate that
 * determines whether a task is an all-day task by checking placement_mode
 * against PLACEMENT_MODES.ALL_DAY (Phase 15 migration).
 *
 * ── BINDING INVARIANTS ──────────────────────────────────────────────────────
 *
 * INVARIANT IAT-1 (null-safe): returns false for null/undefined task.
 *
 * INVARIANT IAT-2 (dual-field check): checks both `placementMode` (camelCase)
 *   and `placement_mode` (snake_case) for DB-row / API-object compatibility.
 *
 * @typedef {Object} IsAllDayTaskPort
 *
 * @property {(task: Object|null|undefined) => boolean} isAllDayTaskBackend
 *   Returns true if the task's placement mode is ALL_DAY (INVARIANT IAT-1, IAT-2).
 */

'use strict';

/**
 * Throw-not-implemented base. Subclasses MUST override every method.
 * @constructor
 */
function IsAllDayTaskPort() {}

/**
 * @param {Object|null|undefined} task
 * @returns {boolean}
 */
IsAllDayTaskPort.prototype.isAllDayTaskBackend = function isAllDayTaskBackend(_task) {
  throw new Error('IsAllDayTaskPort.isAllDayTaskBackend not implemented');
};

/**
 * The exact set of methods an adapter MUST expose to satisfy IsAllDayTaskPort.
 * @type {ReadonlyArray<string>}
 */
var IS_ALL_DAY_TASK_PORT_METHODS = Object.freeze([
  'isAllDayTaskBackend'
]);

module.exports = IsAllDayTaskPort;
module.exports.IsAllDayTaskPort = IsAllDayTaskPort;
module.exports.IS_ALL_DAY_TASK_PORT_METHODS = IS_ALL_DAY_TASK_PORT_METHODS;