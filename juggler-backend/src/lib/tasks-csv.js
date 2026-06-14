/**
 * tasks-csv.js — pure CSV serialiser for the juggler task array.
 *
 * Converts the array produced by rowToTask (task domain mapper) to a
 * RFC-4180 CSV string with \r\n line endings.
 *
 * PURE: no I/O, no Date(), no require of any app module.
 * INPUT:  tasks[]  — array of task objects (may be empty → header row only)
 * OUTPUT: CSV string, \r\n terminated lines (RFC-4180 §2), UTF-8.
 *
 * Column order (fixed):
 *   id, text, taskType, status, pri, project, dur, scheduledAt, date, time,
 *   deadline, startAfter, recurring, location, tools, notes, url, completedAt
 *
 * Encoding rules (applied in order):
 *   1. null/undefined  → empty cell (no quotes, no content)
 *   2. Boolean         → "true" | "false"
 *   3. Number          → String(n)
 *   4. Array           → elements joined with ";" (then steps 5-6 on joined string)
 *   5. CSV injection guard (OWASP): if the string starts with = + - @ \t \r
 *      prefix with a single quote ' (before RFC-4180 escaping)
 *   6. RFC-4180 escaping: wrap in double-quotes IFF the string contains , " \n \r;
 *      any " inside is doubled ("")
 */

'use strict';

/** Fixed column definitions: [header, accessor-key]. */
var COLUMNS = [
  ['id',          'id'],
  ['text',        'text'],
  ['taskType',    'taskType'],
  ['status',      'status'],
  ['pri',         'pri'],
  ['project',     'project'],
  ['dur',         'dur'],
  ['scheduledAt', 'scheduledAt'],
  ['date',        'date'],
  ['time',        'time'],
  ['deadline',    'deadline'],
  ['startAfter',  'startAfter'],
  ['recurring',   'recurring'],
  ['location',    'location'],
  ['tools',       'tools'],
  ['notes',       'notes'],
  ['url',         'url'],
  ['completedAt', 'completedAt'],
];

/** Characters that trigger RFC-4180 quoting. */
var NEEDS_QUOTE_RE = /[,"\n\r]/;

/** Characters at position 0 that trigger CSV injection guard. */
var INJECTION_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Encode a single cell value to its CSV representation.
 * @param {*} value
 * @returns {string}
 */
function encodeCell(value) {
  // 1. null / undefined → empty cell
  if (value === null || value === undefined) return '';

  // 2. Boolean
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  // 3. Number
  if (typeof value === 'number') return String(value);

  // 4. Array — join with semicolon, then fall through to string encoding
  var str;
  if (Array.isArray(value)) {
    str = value.join(';');
  } else {
    str = String(value);
  }

  // 5. CSV injection guard (OWASP)
  // Check index-0 for leading-control chars (\t, \r) AND first non-whitespace
  // char for formula-trigger chars (=, +, -, @).  A leading regular space
  // bypasses an index-0-only check because spreadsheet clients strip leading
  // whitespace before formula evaluation (" =HYPERLINK(...)" still executes).
  if (str.length > 0) {
    var firstNonWs = str.replace(/^\s*/, '')[0];
    if (INJECTION_CHARS.has(str[0]) || (firstNonWs !== undefined && INJECTION_CHARS.has(firstNonWs))) {
      str = "'" + str;
    }
  }

  // 6. RFC-4180 escaping
  if (NEEDS_QUOTE_RE.test(str)) {
    // double any internal double-quotes, then wrap
    str = '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * Serialise a tasks array to RFC-4180 CSV (\r\n line endings).
 *
 * @param {Object[]} tasks — task objects from rowToTask
 * @returns {string} CSV string (header + data rows), \r\n terminated
 */
function tasksToCsv(tasks) {
  var lines = [];

  // Header row
  lines.push(COLUMNS.map(function (col) { return col[0]; }).join(','));

  // Data rows
  if (Array.isArray(tasks)) {
    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      var row = COLUMNS.map(function (col) {
        return encodeCell(task[col[1]]);
      });
      lines.push(row.join(','));
    }
  }

  return lines.join('\r\n') + '\r\n';
}

module.exports = { tasksToCsv: tasksToCsv };
