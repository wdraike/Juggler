/**
 * RecurrenceRule — the recurrence configuration carried on a template's `recur`
 * JSON column (Phase H3 / W2). PURE — zero infra requires.
 *
 * CHARACTERIZED from `validateTaskInput` (task.controller.js ~814-852) and the
 * stored `recur` object shape (`rowToTask` does `recur: safeParseJSON(row.recur,
 * null)`; `taskToRow` does `row.recur = task.recur ? JSON.stringify(task.recur)
 * : null`). The accepted recurrence TYPES are the EXACT controller list:
 *
 *     daily, weekly, biweekly, monthly, interval, none, rolling
 *
 * and the accepted interval UNITS are: days, weeks, months (controller
 * VALID_RECUR_UNITS). Type matching is case-insensitive exactly as the controller
 * does it (`(body.recur.type || '').toLowerCase()`).
 *
 * This entity is a TYPED VIEW over the recur object — it does NOT re-run
 * validation on the write path (that stays in `validateTaskInput`, relocated to
 * ../validation/taskValidation.js) and does NOT alter the stored shape. The
 * mappers continue to carry the raw `recur` object verbatim. RecurrenceRule is a
 * convenience for the scheduler/application layers to read the rule with one
 * invariant: the type, when present, must be one of the canonical types.
 */

'use strict';

// Closed sets — verbatim from validateTaskInput's validRecurTypes / VALID_RECUR_UNITS.
var VALID_TYPES = Object.freeze(['daily', 'weekly', 'biweekly', 'monthly', 'interval', 'none', 'rolling']);
var VALID_UNITS = Object.freeze(['days', 'weeks', 'months']);

/**
 * @param {Object} recur The stored recur config object (e.g. `{ type: 'daily' }`,
 *   `{ type: 'interval', every: 2, unit: 'weeks' }`). May be `null` (no
 *   recurrence) — use {@link RecurrenceRule.from} which returns null for that.
 * @throws {Error} if `recur.type` is present but not one of the canonical types,
 *   or `recur.unit` is present but not a canonical unit. (Mirrors the
 *   controller's reject conditions; does NOT add new validation.)
 */
function RecurrenceRule(recur) {
  if (!recur || typeof recur !== 'object') {
    throw new Error('RecurrenceRule requires a recur config object (use RecurrenceRule.from for null)');
  }
  var type = (recur.type || '').toLowerCase();
  if (type && VALID_TYPES.indexOf(type) === -1) {
    throw new Error('RecurrenceRule.type must be one of [' + VALID_TYPES.join(', ') + '], got: ' + JSON.stringify(recur.type));
  }
  if (recur.unit !== undefined && recur.unit !== null && VALID_UNITS.indexOf(String(recur.unit)) === -1) {
    throw new Error('RecurrenceRule.unit must be one of [' + VALID_UNITS.join(', ') + '], got: ' + JSON.stringify(recur.unit));
  }
  this.type = type || null;
  this.every = recur.every !== undefined ? recur.every : null;
  this.unit = recur.unit !== undefined ? recur.unit : null;
  // Carry the full raw config so nothing is lost (the controller stores it whole).
  this.config = Object.freeze(Object.assign({}, recur));
  Object.freeze(this);
}

/** The canonical recurrence types (closed set). @type {ReadonlyArray<string>} */
RecurrenceRule.VALID_TYPES = VALID_TYPES;
/** The canonical interval units (closed set). @type {ReadonlyArray<string>} */
RecurrenceRule.VALID_UNITS = VALID_UNITS;

/**
 * True iff `type` is a canonical recurrence type (case-insensitive — matches the
 * controller's `.toLowerCase()` compare).
 * @param {*} type
 * @returns {boolean}
 */
RecurrenceRule.isValidType = function isValidType(type) {
  return VALID_TYPES.indexOf(String(type == null ? '' : type).toLowerCase()) !== -1;
};

/** @returns {Object} the raw recur config, verbatim. */
RecurrenceRule.prototype.toConfig = function toConfig() {
  return this.config;
};

/**
 * Factory. Returns `null` for a null/absent recur config (matching `rowToTask`'s
 * `safeParseJSON(row.recur, null)` → null for non-recurring tasks); returns the
 * input unchanged if it is already a RecurrenceRule.
 * @param {(RecurrenceRule|Object|null|undefined)} recur
 * @returns {?RecurrenceRule}
 */
RecurrenceRule.from = function from(recur) {
  if (recur == null) return null;
  if (recur instanceof RecurrenceRule) return recur;
  return new RecurrenceRule(recur);
};

module.exports = RecurrenceRule;
