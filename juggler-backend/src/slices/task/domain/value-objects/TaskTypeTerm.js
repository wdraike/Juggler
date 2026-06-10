/**
 * TaskTypeTerm — closed-enum value object enforcing invariant **S7**: the ONLY
 * accepted scheduler task-type terms are the four canonical strings from
 * `juggler/CLAUDE.md §Scheduler` and `JUGGLER-HEX-DESIGN §6`:
 *
 *     'one-off' | 'chain member' | 'recurring instance' | 'split chunk'
 *
 * It rejects every other term (throws).
 *
 * ── CHARACTERIZED, NOT ASSUMED ────────────────────────────────────────────────
 * IMPORTANT: these four S7 terms are the *conceptual scheduler classification* —
 * they are NOT the raw values of the DB `task_type` column. Verified against the
 * controller and the W1 golden-master (`task.goldenMaster.http.test.js` lines
 * 1368-1374), the ACTUAL stored `task_type` values are snake_case:
 *
 *     S7 term               DB task_type (+ discriminator)
 *     ──────────────────    ────────────────────────────────────────────────────
 *     'one-off'         →   task_type='task'  with empty depends_on
 *     'chain member'    →   task_type='task'  with depends_on non-empty
 *     'recurring instance'→ task_type='recurring_instance' with split_total <= 1
 *     'split chunk'     →   task_type='recurring_instance' with split_total > 1
 *     (blueprint)       →   task_type='recurring_template'  (not a scheduled S7
 *                                                            term — see note)
 *
 * The golden-master proves `rowToTask` surfaces the RAW `task_type` verbatim
 * (`taskType: row.task_type || 'task'`) and explicitly asserts it is NEVER the
 * spaced display form (`expect(task.taskType).not.toBe('recurring instance')`).
 * Therefore the mappers MUST continue to emit the snake_case `task_type` — this
 * VO does NOT change that. {@link TaskTypeTerm.fromRow} provides the characterized
 * DERIVATION (snake_case row → S7 display term) for the scheduler/application
 * layers that reason in S7 vocabulary, without altering any mapper output.
 *
 * `recurring_template` is the recurrence *blueprint*, not one of the four
 * scheduled S7 terms (CLAUDE.md's S7 table covers scheduled task types). It is a
 * valid `task_type` but has no S7 term; {@link TaskTypeTerm.fromRow} returns
 * `null` for a pure template row (the caller decides — templates are not placed).
 */

'use strict';

var ONE_OFF = 'one-off';
var CHAIN_MEMBER = 'chain member';
var RECURRING_INSTANCE = 'recurring instance';
var SPLIT_CHUNK = 'split chunk';

// The closed S7 set — the four canonical terms, verbatim from CLAUDE.md §Scheduler.
var TERMS = Object.freeze([ONE_OFF, CHAIN_MEMBER, RECURRING_INSTANCE, SPLIT_CHUNK]);

/**
 * @param {string} value One of the four canonical S7 terms.
 * @throws {Error} if `value` is not exactly one of the four canonical terms (S7).
 */
function TaskTypeTerm(value) {
  if (TERMS.indexOf(value) === -1) {
    throw new Error(
      'TaskTypeTerm (S7) must be one of [' +
      TERMS.map(function(v) { return "'" + v + "'"; }).join(', ') +
      '], got: ' + JSON.stringify(value)
    );
  }
  this.value = value;
  Object.freeze(this);
}

/** The four canonical S7 terms (closed set). @type {ReadonlyArray<string>} */
TaskTypeTerm.TERMS = TERMS;

/** @type {'one-off'} */            TaskTypeTerm.ONE_OFF = ONE_OFF;
/** @type {'chain member'} */       TaskTypeTerm.CHAIN_MEMBER = CHAIN_MEMBER;
/** @type {'recurring instance'} */ TaskTypeTerm.RECURRING_INSTANCE = RECURRING_INSTANCE;
/** @type {'split chunk'} */        TaskTypeTerm.SPLIT_CHUNK = SPLIT_CHUNK;

/**
 * True iff `value` is exactly one of the four canonical S7 terms (no throw).
 * @param {*} value
 * @returns {boolean}
 */
TaskTypeTerm.isValid = function isValid(value) {
  return TERMS.indexOf(value) !== -1;
};

/**
 * Characterized derivation: given a DB task row's discriminators, return the S7
 * term it represents (as a TaskTypeTerm), or `null` for a pure recurring_template
 * (the blueprint — no scheduled S7 term).
 *
 * This is the INVERSE of how the controller stores task types; it does NOT run on
 * the read/write hot path (the mappers keep emitting raw snake_case). It exists so
 * S7-reasoning code can classify a row without re-deriving the rules inline.
 *
 * Rules (verbatim from the golden-master S7 section, lines 1371-1374):
 *   - task_type === 'recurring_instance' && Number(split_total) > 1 → 'split chunk'
 *   - task_type === 'recurring_instance'                            → 'recurring instance'
 *   - task_type === 'recurring_template'                            → null (blueprint)
 *   - task_type === 'task' (or null → defaults 'task') with a non-empty
 *     depends_on                                                    → 'chain member'
 *   - task_type === 'task' (or null) otherwise                      → 'one-off'
 *
 * @param {{task_type?: ?string, split_total?: *, depends_on?: *}} row
 * @returns {?TaskTypeTerm} the S7 term, or null for a recurring_template blueprint.
 */
TaskTypeTerm.fromRow = function fromRow(row) {
  var r = row || {};
  var type = r.task_type || 'task'; // mirrors rowToTask's `row.task_type || 'task'`
  if (type === 'recurring_template') return null;
  if (type === 'recurring_instance') {
    return new TaskTypeTerm(Number(r.split_total) > 1 ? SPLIT_CHUNK : RECURRING_INSTANCE);
  }
  // task_type === 'task' (or any non-recurring type defaulting to task)
  return new TaskTypeTerm(hasDependencies(r.depends_on) ? CHAIN_MEMBER : ONE_OFF);
};

/**
 * Whether a `depends_on` field carries at least one dependency. The column stores
 * a JSON array string (rowToTask does `safeParseJSON(row.depends_on, [])`); this
 * accepts either the raw JSON string or an already-parsed array, matching the
 * golden-master's "depends_on non-empty" discriminator.
 * @param {*} dependsOn
 * @returns {boolean}
 */
function hasDependencies(dependsOn) {
  if (dependsOn == null) return false;
  if (Array.isArray(dependsOn)) return dependsOn.length > 0;
  if (typeof dependsOn === 'string') {
    if (dependsOn === '' || dependsOn === 'null' || dependsOn === '[]') return false;
    try {
      var parsed = JSON.parse(dependsOn);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

/** @returns {string} the canonical S7 term string. */
TaskTypeTerm.prototype.toString = function toString() {
  return this.value;
};

/**
 * @param {*} other
 * @returns {boolean}
 */
TaskTypeTerm.prototype.equals = function equals(other) {
  return other instanceof TaskTypeTerm && other.value === this.value;
};

/**
 * Factory. Returns the input unchanged if it is already a TaskTypeTerm.
 * @param {(TaskTypeTerm|string)} value
 * @returns {TaskTypeTerm}
 */
TaskTypeTerm.from = function from(value) {
  if (value instanceof TaskTypeTerm) return value;
  return new TaskTypeTerm(value);
};

module.exports = TaskTypeTerm;
