/**
 * Unit tests — tasks-csv.js (AC3, AC5)
 *
 * Covers:
 *   AC3: RFC-4180 escaping + array-join(;)
 *   AC5: CSV formula-injection guard (OWASP), including leading-whitespace bypass fix
 *
 * PURE unit — no I/O, no mocks needed; tasksToCsv is deterministic.
 */

'use strict';

const { tasksToCsv } = require('../../../src/lib/tasks-csv');

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a single RFC-4180 line into cells.
 * Handles quoted fields (with internal doubled-quotes and embedded commas/newlines).
 *
 * Correctly handles:
 *  - empty trailing cells (a,b, → ["a","b",""])
 *  - empty leading/middle cells (,b → ["","b"])
 *  - quoted cells with internal doubled double-quotes
 */
function parseCsvRow(line) {
  const cells = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // Trailing comma case: we've consumed the comma before the loop iteration,
      // so the last cell is empty. Push it and break.
      // Actually: we push after the comma below, so just break if we've gone past end.
      break;
    }

    if (line[i] === '"') {
      // quoted field
      let cell = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          cell += line[i++];
        }
      }
      cells.push(cell);
      // skip the comma separator after the closing quote
      if (i < line.length && line[i] === ',') i++;
    } else {
      // unquoted field — read until comma or end
      const end = line.indexOf(',', i);
      if (end === -1) {
        cells.push(line.slice(i));
        i = line.length;
      } else {
        cells.push(line.slice(i, end));
        i = end + 1; // move past the comma
        // If the comma was the last character, push the trailing empty cell
        if (i === line.length) {
          cells.push('');
          break;
        }
      }
    }
  }
  return cells;
}

/**
 * Split CSV output into lines (strips the trailing \r\n so the last entry is not empty).
 */
function splitCsvLines(csv) {
  // Strip trailing \r\n, then split
  return csv.replace(/\r\n$/, '').split('\r\n');
}

const EXPECTED_HEADERS = [
  'id', 'text', 'taskType', 'status', 'pri', 'project', 'dur',
  'scheduledAt', 'date', 'time', 'deadline', 'earliestStart', 'recurring',
  'location', 'tools', 'notes', 'url', 'completedAt'
];

// ── AC3 + header ──────────────────────────────────────────────────────────────

describe('tasksToCsv — header row', () => {
  it('AC3: produces exact header as first row in correct column order', () => {
    const csv = tasksToCsv([]);
    const lines = splitCsvLines(csv);
    expect(lines[0]).toBe(EXPECTED_HEADERS.join(','));
  });

  it('AC3: header columns match the 18 documented column names', () => {
    const csv = tasksToCsv([]);
    const lines = splitCsvLines(csv);
    const cols = lines[0].split(',');
    expect(cols).toEqual(EXPECTED_HEADERS);
    expect(cols).toHaveLength(18);
  });
});

// ── Empty / all-null ──────────────────────────────────────────────────────────

describe('tasksToCsv — empty / null inputs', () => {
  it('AC3: tasksToCsv([]) returns only the header row (no data rows)', () => {
    const csv = tasksToCsv([]);
    const lines = splitCsvLines(csv);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(EXPECTED_HEADERS.join(','));
  });

  it('AC3: all-null task produces header + one all-empty data row', () => {
    const task = {}; // all fields undefined
    const csv = tasksToCsv([task]);
    const lines = splitCsvLines(csv);
    expect(lines).toHaveLength(2);
    // all 18 cells should be empty
    const dataRow = lines[1];
    const cells = parseCsvRow(dataRow);
    expect(cells).toHaveLength(18);
    cells.forEach((cell, idx) => {
      expect(cell).toBe('');
    });
  });

  it('AC3: task with explicit null values → all-empty cells', () => {
    const task = {
      id: null, text: null, taskType: null, status: null,
      pri: null, project: null, dur: null, scheduledAt: null,
      date: null, time: null, deadline: null, earliestStart: null,
      recurring: null, location: null, tools: null, notes: null,
      url: null, completedAt: null
    };
    const csv = tasksToCsv([task]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    cells.forEach(cell => expect(cell).toBe(''));
  });
});

// ── Non-ragged: every row has exact same column count as header ───────────────

describe('tasksToCsv — non-ragged rows', () => {
  it('AC3: every row has the same column count as the header', () => {
    const tasks = [
      { id: '1', text: 'task one', status: 'active' },
      { id: '2', notes: 'has,comma', location: ['Home', 'Office'] },
      { id: '3', text: null, tools: [], url: undefined }
    ];
    const csv = tasksToCsv(tasks);
    const lines = splitCsvLines(csv);
    const headerCount = parseCsvRow(lines[0]).length;
    expect(headerCount).toBe(18);
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvRow(lines[i]);
      expect(cells).toHaveLength(headerCount);
    }
  });
});

// ── CRLF line endings ─────────────────────────────────────────────────────────

describe('tasksToCsv — CRLF line endings (RFC-4180 §2)', () => {
  it('AC3: output uses \\r\\n line endings throughout', () => {
    const csv = tasksToCsv([{ id: '1', text: 'hello' }]);
    // Every line-break must be \r\n
    expect(csv).toContain('\r\n');
    // No bare \n (without preceding \r)
    const bareNewlines = (csv.replace(/\r\n/g, '')).match(/\n/g);
    expect(bareNewlines).toBeNull();
  });

  it('AC3: output is terminated with a trailing \\r\\n', () => {
    const csv = tasksToCsv([{ id: '1' }]);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

// ── RFC-4180 quoting rules ────────────────────────────────────────────────────

describe('tasksToCsv — RFC-4180 escaping', () => {
  it('AC3: a value with a comma is wrapped in double-quotes', () => {
    const csv = tasksToCsv([{ text: 'buy milk, eggs' }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const textIdx = EXPECTED_HEADERS.indexOf('text');
    expect(cells[textIdx]).toBe('buy milk, eggs');
    // Raw cell in CSV must be quoted
    expect(lines[1]).toContain('"buy milk, eggs"');
  });

  it('AC3: a value with a double-quote → internal quote doubled + wrapped', () => {
    const csv = tasksToCsv([{ text: 'say "hello"' }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const textIdx = EXPECTED_HEADERS.indexOf('text');
    // After RFC-4180 decode the parsed cell must equal the original string
    expect(cells[textIdx]).toBe('say "hello"');
    // Raw encoding: doubled internal quote + wrapping
    expect(lines[1]).toContain('"say ""hello"""');
  });

  it('AC3: a value with \\n → wrapped in double-quotes', () => {
    const csv = tasksToCsv([{ notes: 'line1\nline2' }]);
    const lines = splitCsvLines(csv);
    // The overall CSV has the embedded \n inside the quoted cell
    expect(csv).toContain('"line1\nline2"');
  });

  it('AC3: a value with \\r → wrapped in double-quotes', () => {
    const csv = tasksToCsv([{ notes: 'before\rafter' }]);
    expect(csv).toContain('"before\rafter"');
  });

  it('AC3: a plain value (no comma/quote/newline) → unquoted', () => {
    const csv = tasksToCsv([{ text: 'plain value' }]);
    const lines = splitCsvLines(csv);
    expect(lines[1]).toContain('plain value');
    // The raw cell must NOT be quoted
    expect(lines[1]).not.toContain('"plain value"');
  });

  it('AC3: a value with both comma and double-quote → RFC-4180 encoded correctly', () => {
    const csv = tasksToCsv([{ text: 'he said "hi", ok' }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const textIdx = EXPECTED_HEADERS.indexOf('text');
    expect(cells[textIdx]).toBe('he said "hi", ok');
  });
});

// ── Type coercions ────────────────────────────────────────────────────────────

describe('tasksToCsv — type coercions', () => {
  it('AC3: boolean recurring=true → cell value "true"', () => {
    const csv = tasksToCsv([{ recurring: true }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('recurring');
    expect(cells[idx]).toBe('true');
  });

  it('AC3: boolean recurring=false → cell value "false"', () => {
    const csv = tasksToCsv([{ recurring: false }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('recurring');
    expect(cells[idx]).toBe('false');
  });

  it('AC3: numeric dur → serialized as string (e.g. 30 → "30")', () => {
    const csv = tasksToCsv([{ dur: 30 }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('dur');
    expect(cells[idx]).toBe('30');
  });

  it('AC3: number 0 → cell value "0" (not empty)', () => {
    const csv = tasksToCsv([{ dur: 0 }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('dur');
    expect(cells[idx]).toBe('0');
  });
});

// ── Array fields (location, tools) ───────────────────────────────────────────

describe('tasksToCsv — array fields joined by semicolon', () => {
  it('AC3: location array joined by ";"', () => {
    const csv = tasksToCsv([{ location: ['Home', 'Office'] }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('location');
    expect(cells[idx]).toBe('Home;Office');
  });

  it('AC3: tools array joined by ";"', () => {
    const csv = tasksToCsv([{ tools: ['Slack', 'Notion', 'VS Code'] }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('tools');
    expect(cells[idx]).toBe('Slack;Notion;VS Code');
  });

  it('AC3: null location → empty cell', () => {
    const csv = tasksToCsv([{ location: null }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('location');
    expect(cells[idx]).toBe('');
  });

  it('AC3: empty array [] → empty cell', () => {
    const csv = tasksToCsv([{ tools: [] }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('tools');
    expect(cells[idx]).toBe('');
  });

  it('AC3: undefined array field → empty cell', () => {
    const csv = tasksToCsv([{}]); // location undefined
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('location');
    expect(cells[idx]).toBe('');
  });

  it('AC3: array element containing "," → joined cell is RFC-4180 quoted', () => {
    // e.g. location = ['Gym, Downtown', 'Home'] → joined = 'Gym, Downtown;Home'
    // contains comma → must be quoted
    const csv = tasksToCsv([{ location: ['Gym, Downtown', 'Home'] }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('location');
    expect(cells[idx]).toBe('Gym, Downtown;Home');
    // Raw CSV cell must be quoted because it contains a comma
    expect(lines[1]).toContain('"Gym, Downtown;Home"');
  });

  it('AC3: array element containing \\" → joined cell is RFC-4180 quoted with doubled internal quote', () => {
    const csv = tasksToCsv([{ tools: ['say "hi"', 'tool2'] }]);
    const lines = splitCsvLines(csv);
    const cells = parseCsvRow(lines[1]);
    const idx = EXPECTED_HEADERS.indexOf('tools');
    expect(cells[idx]).toBe('say "hi";tool2');
  });
});

// ── AC5: Formula-injection guard ──────────────────────────────────────────────

describe('tasksToCsv — AC5: formula-injection guard (OWASP)', () => {
  // Helper: get the raw (pre-parse) cell text for the named column in row 1
  function getRawCell(csv, colName) {
    const lines = splitCsvLines(csv);
    // We need to find the raw cell from line[1] for the given column index.
    // We can't use parseCsvRow here for the full line because we want the raw text.
    // Instead: get the parsed cells and their positions in the raw line.
    // Simpler: use parseCsvRow to get the DECODED value and separately check the raw line.
    // Return both.
    const decodedCells = parseCsvRow(lines[1]);
    const colIdx = EXPECTED_HEADERS.indexOf(colName);
    return { decoded: decodedCells[colIdx], rawLine: lines[1] };
  }

  // Each injection-triggering test asserts that:
  //   1. The DECODED cell value starts with a single quote followed by the original string
  //   2. The raw CSV line contains the ' prefix (so the spreadsheet client sees it)

  it('AC5: cell starting with "=" is prefixed with a leading single-quote', () => {
    const csv = tasksToCsv([{ text: '=cmd()' }]);
    const { decoded } = getRawCell(csv, 'text');
    expect(decoded.startsWith("'")).toBe(true);
    expect(decoded).toBe("'=cmd()");
  });

  it('AC5: cell starting with "+" is prefixed with a single-quote', () => {
    const csv = tasksToCsv([{ text: '+1+1' }]);
    const { decoded } = getRawCell(csv, 'text');
    expect(decoded).toBe("'+1+1");
  });

  it('AC5: cell starting with "-" is prefixed with a single-quote', () => {
    const csv = tasksToCsv([{ text: '-2' }]);
    const { decoded } = getRawCell(csv, 'text');
    expect(decoded).toBe("'-2");
  });

  it('AC5: cell starting with "@" is prefixed with a single-quote', () => {
    const csv = tasksToCsv([{ text: '@SUM(A1)' }]);
    const { decoded } = getRawCell(csv, 'text');
    expect(decoded).toBe("'@SUM(A1)");
  });

  it('AC5: cell starting with leading-whitespace then "=" is neutralized (leading-whitespace bypass fix)', () => {
    // Security fix: spreadsheets strip leading whitespace before formula eval.
    // " =HYPERLINK(...)" still executes without the fix.
    const csv = tasksToCsv([{ text: ' =HYPERLINK("x")' }]);
    const { decoded } = getRawCell(csv, 'text');
    // The decoded cell must begin with a single quote (BEFORE any whitespace/formula)
    expect(decoded.startsWith("'")).toBe(true);
    expect(decoded).toBe("' =HYPERLINK(\"x\")");
  });

  it('AC5: cell with multiple leading spaces then "+" is neutralized', () => {
    const csv = tasksToCsv([{ notes: '   +1+1' }]);
    const { decoded } = getRawCell(csv, 'notes');
    expect(decoded.startsWith("'")).toBe(true);
    expect(decoded).toBe("'   +1+1");
  });

  it('AC5: cell starting with \\t (tab) at index-0 is prefixed with a single-quote', () => {
    const csv = tasksToCsv([{ text: '\tcmd' }]);
    const { decoded } = getRawCell(csv, 'text');
    expect(decoded.startsWith("'")).toBe(true);
    expect(decoded).toBe("'\tcmd");
  });

  it('AC5: cell starting with \\r at index-0 is prefixed with a single-quote', () => {
    const csv = tasksToCsv([{ text: '\rvalue' }]);
    const { decoded } = getRawCell(csv, 'text');
    expect(decoded.startsWith("'")).toBe(true);
    expect(decoded).toBe("'\rvalue");
  });

  it('AC5: benign value "normal" is NOT prefixed with a single-quote', () => {
    const csv = tasksToCsv([{ text: 'normal task' }]);
    const { decoded } = getRawCell(csv, 'text');
    expect(decoded).toBe('normal task');
    expect(decoded.startsWith("'")).toBe(false);
  });

  it('AC5: injection cell containing a comma is both neutralized AND RFC-4180 quoted', () => {
    // =SUM(A1,B1) starts with = (injection) AND contains comma (needs quoting)
    // Expected raw cell in CSV: "'=SUM(A1,B1)" → quoted because of comma, prefixed with '
    const csv = tasksToCsv([{ text: '=SUM(A1,B1)' }]);
    const { decoded, rawLine } = getRawCell(csv, 'text');
    // Decoded value starts with '
    expect(decoded).toBe("'=SUM(A1,B1)");
    // Raw CSV wraps in quotes because ' prefix + comma triggers quoting
    expect(rawLine).toContain('"\'=SUM(A1,B1)"');
  });

  it('AC5: regression anchor — "-5" as a literal numeric string gets prefixed', () => {
    // This is expected behavior: a string "-5" (not a number) starts with "-"
    // and gets the injection prefix. Consistent with OWASP guidance.
    const csv = tasksToCsv([{ text: '-5' }]);
    const { decoded } = getRawCell(csv, 'text');
    expect(decoded).toBe("'-5");
  });

  it('AC5: injection guard applies to notes field (user-controlled content)', () => {
    const csv = tasksToCsv([{ notes: '=HYPERLINK("http://evil","click")' }]);
    const { decoded } = getRawCell(csv, 'notes');
    expect(decoded.startsWith("'")).toBe(true);
  });

  it('AC5: injection guard applies to project field (user-controlled content)', () => {
    const csv = tasksToCsv([{ project: '+evil_formula' }]);
    const { decoded } = getRawCell(csv, 'project');
    expect(decoded).toBe("'+evil_formula");
  });

  it('AC5: injection guard applies to url field', () => {
    const csv = tasksToCsv([{ url: '@javascript:evil()' }]);
    const { decoded } = getRawCell(csv, 'url');
    expect(decoded.startsWith("'")).toBe(true);
  });
});

// ── Multiple tasks / multiple rows ────────────────────────────────────────────

describe('tasksToCsv — multiple task rows', () => {
  it('AC3: serializes multiple tasks each as a separate data row', () => {
    const tasks = [
      { id: '1', text: 'first' },
      { id: '2', text: 'second' },
      { id: '3', text: 'third' }
    ];
    const csv = tasksToCsv(tasks);
    const lines = splitCsvLines(csv);
    // 1 header + 3 data rows
    expect(lines).toHaveLength(4);
    const cells0 = parseCsvRow(lines[1]);
    const cells1 = parseCsvRow(lines[2]);
    const cells2 = parseCsvRow(lines[3]);
    expect(cells0[EXPECTED_HEADERS.indexOf('id')]).toBe('1');
    expect(cells1[EXPECTED_HEADERS.indexOf('id')]).toBe('2');
    expect(cells2[EXPECTED_HEADERS.indexOf('id')]).toBe('3');
  });
});
