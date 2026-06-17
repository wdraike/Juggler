/**
 * csv-to-tasks.js — RFC-4180 CSV parser + inverse column mapper for juggler tasks.
 *
 * This is the INVERSE of tasks-csv.js: converts a CSV string produced by
 * tasksToCsv() back to an array of task objects suitable for the existing
 * facade.importData({ extraTasks, v7: true }) merge path.
 *
 * PURE: no I/O, no Date(), no DB, no require of any app module.
 * INPUT:  csvString — raw text/csv body (may use \r\n or \n line endings)
 * OUTPUT: Array<taskObject>
 *
 * Throws a descriptive Error (caller maps to HTTP 400) for:
 *   - Missing or unrecognised header (no 'text' column)
 *   - Unbalanced quotes (malformed RFC-4180)
 *   - Ragged rows (cell count != header column count)
 *   - All rows empty after header (not an error; returns [])
 *   - A data row whose 'text' cell is empty → that row is SKIPPED (not an error)
 *
 * Prototype-pollution guard: header keys '__proto__', 'constructor', and
 * 'prototype' are rejected with a parse error.
 *
 * Column order (must match tasks-csv.js COLUMNS exactly):
 *   id, text, taskType, status, pri, project, dur, scheduledAt, date, time,
 *   deadline, earliestStart, recurring, location, tools, notes, url, completedAt
 *
 * Reverse-encoding rules (applied per cell, AFTER RFC-4180 unescaping):
 *   1. Empty cell          → field omitted from task object (not null, not '')
 *   2. Leading single-quote → strip ONE leading ' ONLY when str[1] is one of
 *      the injection-trigger chars (= + - @ \t \r).  This is the TRUE inverse
 *      of the exporter's guard (tasks-csv.js encodeCell step 5), which only
 *      prepends ' when the first non-whitespace char is a trigger.  Genuine
 *      apostrophe-led values ('tis, '90s, etc.) are preserved unchanged.
 *   3. location / tools    → split on ';' → array; empty string → []
 *      KNOWN LIMITATION: a location or tools name that itself contains ';' will
 *      be mis-split on import (the ';' separator is ambiguous with content).
 *      This is inherent to the ';' join/split convention and is not round-trip-safe
 *      for names containing ';'.  Do not change the separator without also
 *      regenerating all previously exported files.
 *   4. recurring           → 'true' → true; anything else → false (omitted if falsy)
 *   5. pri, dur            → left as string (buildTaskRow/rowToTask handles coercion)
 */

'use strict';

/** The minimum required header columns (must include 'text'). */
var REQUIRED_COLUMNS = new Set(['text']);

/**
 * Prototype-pollution danger keys — reject any CSV that names these as headers.
 * @type {Set<string>}
 */
var FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Columns whose value is a ';'-delimited array. */
var ARRAY_COLUMNS = new Set(['location', 'tools']);

/**
 * Parse a RFC-4180 CSV string into an array of string arrays (rows of cells).
 * Handles:
 *   - Quoted fields (may contain commas, newlines, carriage returns)
 *   - Doubled double-quotes inside quoted fields ("" → ")
 *   - \r\n and \n line endings
 *   - Trailing \r\n or \n on last row
 *
 * Throws Error with a descriptive message on malformed input (unbalanced quotes).
 *
 * @param {string} csv
 * @returns {string[][]} rows of cells (including the header row as row 0)
 */
function parseRfc4180(csv) {
  var rows = [];
  var row = [];
  var i = 0;
  var len = csv.length;

  while (i < len) {
    // Start of a new cell
    if (csv[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      var cell = '';
      var closed = false;

      while (i < len) {
        if (csv[i] === '"') {
          if (i + 1 < len && csv[i + 1] === '"') {
            // Escaped double-quote ("" → ")
            cell += '"';
            i += 2;
          } else {
            // Closing quote
            i++;
            closed = true;
            break;
          }
        } else {
          cell += csv[i];
          i++;
        }
      }

      if (!closed) {
        throw new Error('Unbalanced quote in CSV field near position ' + i);
      }

      row.push(cell);

      // After closing quote: expect , or \r\n or \n or end-of-string
      if (i < len) {
        if (csv[i] === ',') {
          i++; // separator → next cell
        } else if (csv[i] === '\r' && i + 1 < len && csv[i + 1] === '\n') {
          i += 2;
          rows.push(row);
          row = [];
        } else if (csv[i] === '\n') {
          i++;
          rows.push(row);
          row = [];
        } else {
          throw new Error('Unexpected character after closing quote at position ' + i + ': ' + JSON.stringify(csv[i]));
        }
      }
    } else {
      // Unquoted field — read until comma or newline
      var start = i;
      while (i < len && csv[i] !== ',' && csv[i] !== '\n' && !(csv[i] === '\r' && i + 1 < len && csv[i + 1] === '\n')) {
        // Also stop at bare \r (shouldn't appear in valid RFC-4180 but be defensive)
        if (csv[i] === '\r') break;
        i++;
      }
      row.push(csv.slice(start, i));

      if (i < len) {
        if (csv[i] === ',') {
          i++; // separator → next cell
        } else if (csv[i] === '\r' && i + 1 < len && csv[i + 1] === '\n') {
          i += 2;
          rows.push(row);
          row = [];
        } else if (csv[i] === '\n') {
          i++;
          rows.push(row);
          row = [];
        } else if (csv[i] === '\r') {
          // bare \r without \n — treat as line ending
          i++;
          rows.push(row);
          row = [];
        }
      }
    }
  }

  // Flush the last row.
  // If the input ended with a comma (the final cell is empty and there is no
  // trailing newline), the outer loop exited without ever visiting that trailing
  // empty cell.  Detect this case by checking whether the last non-\r character
  // in the input is a comma, and if so push the missing empty cell before
  // flushing.  This handles both the unquoted and quoted-then-comma cases.
  if (len > 0) {
    var lastNonCR = len - 1;
    if (csv[lastNonCR] === '\r' && lastNonCR > 0) lastNonCR--;
    if (csv[lastNonCR] === ',') {
      row.push('');
    }
  }
  if (row.length > 0) {
    rows.push(row);
  }

  return rows;
}

/**
 * Strip a single leading straight single-quote ONLY when it is the guard that
 * tasks-csv.js encodeCell() injected (i.e. the character immediately after the
 * quote is one of the injection-trigger chars: = + - @ \t \r).
 *
 * The exporter (tasks-csv.js:84-88) prefixes ' ONLY when the first
 * non-whitespace character of the cell is in {= + - @ \t \r}.  So the correct
 * inverse is: strip the leading ' if and only if str[1] is one of those chars.
 *
 * This preserves genuine apostrophe-led values such as "'tis the season" or
 * "'90s playlist", while still reversing injected guards like "'=HYPERLINK(…)".
 *
 * Note: a cell that genuinely starts with '= is inherently ambiguous and
 * unrecoverable regardless; that is an acceptable corner-case.
 *
 * @param {string} s
 * @returns {string}
 */
var INJECTION_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

function stripInjectionGuard(s) {
  if (s.length >= 2 && s[0] === "'" && INJECTION_TRIGGER_CHARS.has(s[1])) {
    return s.slice(1);
  }
  return s;
}

/**
 * Convert a raw RFC-4180-unescaped cell string to a task field value,
 * applying the reverse-encoding rules for the given column name.
 *
 * Returns undefined to signal "omit this field" (empty cell).
 *
 * @param {string} colName
 * @param {string} raw  — already RFC-4180-decoded cell string
 * @returns {*}
 */
function decodeCell(colName, raw) {
  // Step 1: empty cell → omit
  if (raw === '') {
    if (ARRAY_COLUMNS.has(colName)) return [];
    return undefined;
  }

  // Step 2: strip single leading ' (formula-injection guard reversal)
  var val = stripInjectionGuard(raw);

  // Step 3: array columns — split on ';'
  if (ARRAY_COLUMNS.has(colName)) {
    if (val === '') return [];
    return val.split(';');
  }

  // Step 4: recurring boolean
  if (colName === 'recurring') {
    return val === 'true' ? true : false;
  }

  // Step 5: all other columns — return as string (pri/dur left as string
  // because buildTaskRow/rowToTask handles number coercion downstream)
  return val;
}

/**
 * Parse a CSV string (as produced by tasksToCsv) back to an array of task objects.
 *
 * Throws a descriptive Error for malformed input (unbalanced quotes, missing
 * required header, ragged rows). Empty-text rows are silently skipped (not
 * an error; the export can't produce them but user-edited CSVs might).
 *
 * @param {string} csvString
 * @returns {Array<Object>} task objects ready for facade.importData({ extraTasks })
 */
function csvToTasks(csvString) {
  if (typeof csvString !== 'string') {
    throw new Error('csvToTasks: input must be a string, got ' + typeof csvString);
  }

  // RFC-4180 parse → rows of string arrays (may throw on malformed input)
  var rows = parseRfc4180(csvString);

  if (rows.length === 0) {
    throw new Error('CSV header missing — file is empty');
  }

  // Row 0 is the header
  var header = rows[0];

  // Validate: no forbidden prototype-pollution keys
  for (var hi = 0; hi < header.length; hi++) {
    if (FORBIDDEN_KEYS.has(header[hi])) {
      throw new Error('CSV header contains forbidden key: ' + header[hi]);
    }
  }

  // Validate: must contain at least the 'text' column
  var headerSet = new Set(header);
  var missingRequired = [];
  REQUIRED_COLUMNS.forEach(function (col) {
    if (!headerSet.has(col)) missingRequired.push(col);
  });
  if (missingRequired.length > 0) {
    throw new Error('CSV header missing required columns: ' + missingRequired.join(', '));
  }

  var colCount = header.length;
  var tasks = [];

  // Data rows (index 1+)
  for (var ri = 1; ri < rows.length; ri++) {
    var cells = rows[ri];

    // Skip completely empty trailing rows (e.g. a lone \r\n at EOF)
    if (cells.length === 1 && cells[0] === '') continue;

    // Ragged row check
    if (cells.length !== colCount) {
      throw new Error(
        'CSV row ' + (ri + 1) + ' has ' + cells.length + ' cells but header has ' + colCount +
        ' — ragged row (unbalanced quotes or extra commas?)'
      );
    }

    // Build task object using Object.create(null) as base to prevent prototype pollution
    var task = Object.create(null);
    var hasText = false;

    for (var ci = 0; ci < colCount; ci++) {
      var colName = header[ci];
      // Extra protection: skip any key that would pollute (shouldn't reach here after header check)
      if (FORBIDDEN_KEYS.has(colName)) continue;

      var decoded = decodeCell(colName, cells[ci]);

      if (decoded !== undefined) {
        task[colName] = decoded;
        if (colName === 'text') hasText = true;
      }
    }

    // Skip rows with no text value (empty text = invalid task)
    if (!hasText) continue;

    // FIX ernie-jcsv-03b: give every id-less row a distinct synthetic placeholder
    // so that MergeImportData's dedup-by-id (deduped.set(t.id, t)) does not
    // collapse multiple id-less rows to a single Map entry keyed on undefined.
    // MergeImportData always fabricates final unique ids (fabricateTaskId) before
    // DB insert, so this placeholder never reaches the DB as-is.
    // Rows that already have an id keep it unchanged.
    if (!task.id) {
      task.id = 'csv-import-row-' + ri;
    }

    // Convert Object.create(null) to plain object for downstream compat
    tasks.push(Object.assign({}, task));
  }

  return tasks;
}

module.exports = { csvToTasks: csvToTasks };
