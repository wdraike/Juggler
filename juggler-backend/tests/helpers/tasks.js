// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
var crypto = require('crypto');
var db = require('./test-db');
var { validateTaskInput } = require('../../src/slices/task/domain/validation/taskValidation');

function uid(prefix) {
  return (prefix || 'task') + '-' + crypto.randomBytes(6).toString('hex');
}

/**
 * Run the REAL create/update validator (validateTaskInput) over a task body and,
 * on a placement-mode contradiction, throw the SAME machine-readable rejection the
 * use-case raises ({ status: 400, error }). This makes the test helpers honor the
 * documented backend validation (999.867 fixed+recurring `invalid_combination`;
 * fixed-mode-requires-scheduling) instead of silently writing an invalid row.
 *
 * We gate ONLY on the placement-mode cross-field rules (the rules these suites
 * assert) so existing callers passing otherwise-loose-but-valid bodies are
 * unaffected. `body` is the camelCase payload the caller supplied; `existing`
 * (optional) supplies the prior row so an UPDATE that only flips one side of the
 * combination (e.g. anytime-recurring → fixed) still trips the guard.
 */
function assertPlacementModeValid(body, existing) {
  var merged = Object.assign({}, body);
  // For updates, the contradiction depends on the MERGED state (e.g. body sets
  // placementMode:'fixed' while the existing row is recurring). Fold existing
  // recurring/placementMode in when the body doesn't restate them.
  if (existing) {
    if (merged.recurring === undefined) {
      merged.recurring = existing.recurring === 1 || existing.recurring === true;
    }
    if (merged.placementMode === undefined && existing.placement_mode !== undefined) {
      merged.placementMode = existing.placement_mode;
    }
  }
  // Normalize recurring to a real boolean for the validator (it checks === true).
  if (merged.recurring === 1) merged.recurring = true;

  var errors = validateTaskInput(merged) || [];

  // fixed + recurring → invalid_combination (999.867).
  if (errors.indexOf('invalid_combination') !== -1) {
    var e1 = new Error('invalid_combination');
    e1.status = 400; e1.error = 'invalid_combination';
    throw e1;
  }
  // fixed mode without any scheduling info → time_required_for_fixed_mode.
  var fixedNoSched = errors.some(function (m) {
    return /placementMode "fixed" requires a date, time, or scheduledAt/.test(m);
  });
  if (fixedNoSched) {
    var e2 = new Error('time_required_for_fixed_mode');
    e2.status = 400; e2.error = 'time_required_for_fixed_mode';
    throw e2;
  }
}

// task_instances columns — when any of these appear in the payload the caller
// intends to seed a placed/recurring/split OCCURRENCE row, not a master.
var INSTANCE_SIGNAL_FIELDS = [
  'master_id', 'scheduled_at', 'occurrence_ordinal', 'split_ordinal',
  'split_total', 'split_group', 'date_pinned', 'time_remaining', 'date',
  'day', 'time', 'slack_mins', 'unscheduled'
];

// camelCase → snake_case aliases for fields that map to a real DB column.
var COLUMN_ALIASES = {
  placementMode: 'placement_mode',
  recurStart: 'recur_start',
  recurEnd: 'recur_end',
  userId: 'user_id',
  splitMin: 'split_min',
  dayReq: 'day_req',
  // next_start is the single unified anchor column (rolling_anchor /
  // next_occurrence_anchor dropped — juggler-anchor-column-cleanup).
  // NOTE: no `rollingAnchor` alias — `rolling_anchor` no longer exists on
  // task_masters. A test that means the new anchor should seed `nextStart`;
  // a test that still seeds `rollingAnchor` now gets no alias at all, so
  // buildRow's validCols gate drops the raw key (same fail-loud-by-omission
  // as any other unknown key) instead of silently mapping it onto a dead
  // column (zoe-w10-dead-anchor-fixtures — the alias was itself the landmine).
  nextStart: 'next_start'
};

// Recur-config keys some tests pass at the TOP LEVEL but that actually live
// inside the `recur` JSON the scheduler reads. Fold them into recur so the
// real scheduler sees them (rather than silently dropping them on the floor).
var RECUR_CONFIG_FIELDS = ['timesPerCycle', 'fillPolicy', 'minGapDays', 'isFlexibleTpc', 'targetIntervalDays', 'intervalDays'];

// Top-level keys that are NOT columns on either table and are not recur-config.
// Carried through onto the RETURNED object so a test's round-trip reflects what
// it requested, but never written to the DB (would throw "Unknown column").
var VIRTUAL_PASSTHROUGH = ['time', 'isFlexibleTpc', 'fillPolicy', 'minGapDays', 'timesPerCycle', 'horizon'];

// DATETIME columns that must be stored as MySQL "YYYY-MM-DD HH:MM:SS" (UTC).
// Tests pass ISO-8601 strings like "2026-06-15T08:00:00Z" which MySQL rejects.
var DATETIME_COLS = ['scheduled_at', 'desired_at', 'start_after_at', 'completed_at',
  'disabled_at', 'implied_deadline', 'earliest_start', 'end_date'];

// Convert an ISO-8601 (with Z/offset) timestamp to a MySQL UTC DATETIME literal.
// Leaves already-MySQL-formatted strings and non-strings untouched.
function toMysqlUtc(val) {
  if (val == null) return val;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return val;
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  var s = String(val);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s; // already MySQL
  if (/[TtZ]|[+]\d{2}:?\d{2}$/.test(s)) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return s;
}

function wantsInstance(taskData) {
  return INSTANCE_SIGNAL_FIELDS.some(function (f) {
    return Object.prototype.hasOwnProperty.call(taskData, f) && taskData[f] !== undefined;
  });
}

// Normalize a payload: apply camelCase→snake aliases, fold recur-config into recur,
// JSON-encode recur, and return { row, recurConfig } where row carries only keys
// that map to a real column (filtered by the live column set of the target table).
function buildRow(taskData, validCols) {
  var recur = taskData.recur;
  if (recur && typeof recur !== 'string') recur = Object.assign({}, recur);

  // Fold top-level recur-config keys into the recur object.
  RECUR_CONFIG_FIELDS.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(taskData, f) && taskData[f] !== undefined) {
      if (!recur || typeof recur === 'string') recur = (typeof recur === 'string') ? JSON.parse(recur) : {};
      recur[f] = taskData[f];
    }
  });

  var row = {};
  Object.keys(taskData).forEach(function (key) {
    if (key === 'recur') return; // handled below
    if (RECUR_CONFIG_FIELDS.indexOf(key) !== -1) return; // folded into recur
    if (VIRTUAL_PASSTHROUGH.indexOf(key) !== -1) return; // not a column
    var col = COLUMN_ALIASES[key] || key;
    if (validCols[col]) {
      row[col] = DATETIME_COLS.indexOf(col) !== -1 ? toMysqlUtc(taskData[key]) : taskData[key];
    }
  });

  if (recur !== undefined && recur !== null && validCols.recur) {
    row.recur = typeof recur === 'string' ? recur : JSON.stringify(recur);
  }
  return row;
}

/**
 * Create a task. Inserts into task_masters by default, or task_instances when the
 * payload carries instance-level fields (master_id/scheduled_at/ordinals/etc.).
 * Returns the actual inserted DB row (re-selected by id — MySQL has no RETURNING),
 * augmented with the virtual passthrough fields the caller supplied.
 */
async function createTask(taskData) {
  taskData = taskData || {};
  var asInstance = wantsInstance(taskData);
  // Master creates flow through the real placement-mode validator (instance/chunk
  // seeds are pre-materialized rows, not user create bodies, so skip them).
  if (!asInstance) assertPlacementModeValid(taskData, null);
  var table = asInstance ? 'task_instances' : 'task_masters';
  var validCols = await db(table).columnInfo();

  var id = taskData.id || uid(asInstance ? 'ti' : 'tm');
  var now = new Date();

  var row = buildRow(taskData, validCols);
  row.id = id;
  if (!row.user_id) row.user_id = taskData.user_id || '1';
  if (validCols.text && row.text === undefined) row.text = taskData.text || '';
  if (validCols.dur && row.dur === undefined) row.dur = taskData.dur || 30;
  if (validCols.pri && row.pri === undefined) row.pri = taskData.pri || 'P3';
  if (validCols.status && row.status === undefined) row.status = taskData.status || '';
  if (validCols.created_at) row.created_at = now;
  if (validCols.updated_at) row.updated_at = now;

  if (asInstance) {
    if (!row.master_id) row.master_id = taskData.master_id || id;
    if (validCols.split_ordinal && row.split_ordinal === undefined) row.split_ordinal = 1;
    if (validCols.split_total && row.split_total === undefined) row.split_total = 1;
    // Auto-assign the next occurrence_ordinal for this (master_id, split_ordinal)
    // when the caller didn't specify one — multiple seeded occurrences of the same
    // master must not collide on uq_instance_ordinals(master_id,occ,split).
    if (validCols.occurrence_ordinal && row.occurrence_ordinal === undefined) {
      var maxRow = await db('task_instances')
        .where({ master_id: row.master_id, split_ordinal: row.split_ordinal })
        .max('occurrence_ordinal as m').first();
      row.occurrence_ordinal = ((maxRow && maxRow.m) || 0) + 1;
    }
  } else {
    if (validCols.recurring && row.recurring === undefined) {
      row.recurring = taskData.recurring !== undefined ? taskData.recurring : (taskData.recur ? 1 : 0);
    }
  }

  await db(table).insert(__stampFixture(row));
  var inserted = await db(table).where({ id: id }).first();

  // Echo virtual passthrough fields + the camelCase aliases the caller used so
  // round-trip assertions reflect requested values. Never overwrites a real column.
  VIRTUAL_PASSTHROUGH.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(taskData, f) && inserted[f] === undefined) inserted[f] = taskData[f];
  });
  if (taskData.placementMode !== undefined && inserted.placementMode === undefined) {
    inserted.placementMode = inserted.placement_mode !== undefined ? inserted.placement_mode : taskData.placementMode;
  } else if (inserted.placement_mode !== undefined) {
    inserted.placementMode = inserted.placement_mode;
  }
  if (inserted.recurring !== undefined) inserted.recurring = !!inserted.recurring;
  return inserted;
}

/**
 * Create a recurring template in task_masters.
 */
async function createRecurringTask(taskData) {
  taskData = Object.assign({ recurring: true }, taskData || {});
  return createTask(taskData);
}

/**
 * Update a task_masters row (real DB UPDATE) and return the re-selected row,
 * mapped back to the camelCase shape callers assert against. `id` is the master id.
 * `fields` accepts the same camelCase/snake aliases as createTask.
 */
async function updateTask(id, fields) {
  fields = fields || {};
  // Validate the placement-mode cross-field rules against the MERGED state
  // (body + existing row) so an update that flips one side of an invalid combo
  // (e.g. anytime-recurring → fixed) is rejected exactly like the real use-case.
  if (fields.placementMode !== undefined || fields.recurring !== undefined) {
    var existingRow = await db('task_masters').where({ id: id }).first();
    assertPlacementModeValid(fields, existingRow || null);
  }
  var validCols = await db('task_masters').columnInfo();
  var row = buildRow(fields, validCols);
  if (validCols.updated_at) row.updated_at = new Date();

  if (Object.keys(row).length > 0) {
    await db('task_masters').where({ id: id }).update(row);
  }
  var updated = await db('task_masters').where({ id: id }).first();
  if (!updated) return updated;

  // Surface camelCase + virtual passthrough fields for round-trip assertions.
  if (updated.placement_mode !== undefined) updated.placementMode = updated.placement_mode;
  if (updated.recurring !== undefined) updated.recurring = !!updated.recurring;
  VIRTUAL_PASSTHROUGH.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(fields, f)) updated[f] = fields[f];
  });
  return updated;
}

/**
 * Update a task_instances row (real DB UPDATE) and return the re-selected row.
 * `id` is the instance id. `fields` are written directly to existing columns.
 */
async function updateTaskInstance(id, fields) {
  fields = fields || {};
  var validCols = await db('task_instances').columnInfo();
  var row = buildRow(fields, validCols);
  if (validCols.updated_at) row.updated_at = new Date();

  if (Object.keys(row).length > 0) {
    await db('task_instances').where({ id: id }).update(row);
  }
  return db('task_instances').where({ id: id }).first();
}

module.exports = { createTask, createRecurringTask, updateTask, updateTaskInstance };
