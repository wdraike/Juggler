/**
 * Unit tests — csv-to-tasks.js (AC3, AC4)
 *
 * PURE unit — no I/O, no DB, no mocks needed; csvToTasks is a deterministic
 * pure function. Tests are paired with the tasks-csv.js exporter so that the
 * round-trip invariant acts as the primary regression anchor.
 *
 * AC3: csvToTasks reverses export (RFC-4180, ;-split, '-strip, bool) + round-trips.
 * AC4: malformed CSV → throws (unbalanced quote / ragged row / missing header).
 *      (The 400 mapping is tested in the API layer: data-import-csv.test.js.)
 */

'use strict';

const { csvToTasks } = require('../../../src/lib/csv-to-tasks');
const { tasksToCsv } = require('../../../src/lib/tasks-csv');

// Column index helper (matches COLUMNS order in tasks-csv.js)
const COLS = [
  'id','text','taskType','status','pri','project','dur','scheduledAt',
  'date','time','deadline','startAfter','recurring','location','tools',
  'notes','url','completedAt'
];
const colIdx = (name) => COLS.indexOf(name);

// ── RFC-4180 parse: primitive cases ──────────────────────────────────────────

describe('csvToTasks — RFC-4180 parse', () => {
  it('parses a plain unquoted row', () => {
    const csv = 'text,status\r\nBuy milk,active\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('Buy milk');
    expect(tasks[0].status).toBe('active');
  });

  it('handles \\n line endings (no \\r)', () => {
    const csv = 'text,status\nBuy milk,active\n';
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('Buy milk');
  });

  it('handles mixed \\r\\n and \\n line endings in same CSV', () => {
    const csv = 'text,status\r\nFirst task,active\nSecond task,done\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].text).toBe('First task');
    expect(tasks[1].text).toBe('Second task');
  });

  it('quoted field containing an embedded comma is treated as one cell', () => {
    const csv = 'text\r\n"Buy milk, eggs"\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('Buy milk, eggs');
  });

  it('quoted field containing an embedded newline is treated as one cell', () => {
    const csv = 'text\r\n"Line1\nLine2"\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('Line1\nLine2');
  });

  it('doubled double-quote inside quoted field decodes to single double-quote', () => {
    const csv = 'text\r\n"say ""hello"""\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('say "hello"');
  });

  it('CSV without trailing newline is accepted', () => {
    // No \r\n at end — still valid input
    const csv = 'text\r\nno newline at end';
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('no newline at end');
  });
});

// ── Column mapping: decoding rules ──────────────────────────────────────────

describe('csvToTasks — column decoding', () => {
  it('location "home;office" → [\'home\', \'office\']', () => {
    const csv = 'text,location\r\nTask,home;office\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].location).toEqual(['home', 'office']);
  });

  it('location single value "home" → [\'home\']', () => {
    const csv = 'text,location\r\nTask,home\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].location).toEqual(['home']);
  });

  it('location empty cell → []', () => {
    const csv = 'text,location\r\nTask,\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].location).toEqual([]);
  });

  it('tools "Slack;Notion;VS Code" → [\'Slack\', \'Notion\', \'VS Code\']', () => {
    const csv = 'text,tools\r\nTask,Slack;Notion;VS Code\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].tools).toEqual(['Slack', 'Notion', 'VS Code']);
  });

  it('tools empty cell → []', () => {
    const csv = 'text,tools\r\nTask,\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].tools).toEqual([]);
  });

  it('recurring "true" → boolean true', () => {
    const csv = 'text,recurring\r\nTask,true\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].recurring).toBe(true);
  });

  it('recurring "false" → boolean false', () => {
    const csv = 'text,recurring\r\nTask,false\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].recurring).toBe(false);
  });

  it('recurring empty cell → field omitted (decodeCell step 1: empty → undefined)', () => {
    // decodeCell step 1: raw==='' && not an ARRAY_COLUMN → return undefined → field omitted.
    // The recurring boolean branch (step 4) is only reached for non-empty cells.
    const csv = 'text,recurring\r\nTask,\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].recurring).toBeUndefined();
  });

  it('recurring "anything-else" → false', () => {
    const csv = 'text,recurring\r\nTask,maybe\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].recurring).toBe(false);
  });

  it('leading single-quote stripped: \'=danger → =danger', () => {
    // The exporter guards formula cells by prefixing with a single quote.
    // csvToTasks strips it so the re-imported value is the original.
    const csv = "text\r\n'=danger\r\n";
    const tasks = csvToTasks(csv);
    expect(tasks[0].text).toBe('=danger');
  });

  it('leading single-quote stripped: \'+1+1 → +1+1', () => {
    const csv = "text\r\n'+1+1\r\n";
    const tasks = csvToTasks(csv);
    expect(tasks[0].text).toBe('+1+1');
  });

  it('empty cell (non-array, non-recurring) → field omitted from task object', () => {
    const csv = 'text,notes\r\nTask,\r\n';
    const tasks = csvToTasks(csv);
    // notes empty → undefined → should be omitted (not set at all)
    expect(Object.prototype.hasOwnProperty.call(tasks[0], 'notes')).toBe(false);
  });

  it('row with empty text cell is silently skipped', () => {
    const csv = 'text,status\r\n,active\r\nReal task,active\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('Real task');
  });

  it('non-empty pri and dur remain as strings', () => {
    const csv = 'text,pri,dur\r\nTask,P2,30\r\n';
    const tasks = csvToTasks(csv);
    expect(tasks[0].pri).toBe('P2');
    expect(tasks[0].dur).toBe('30');
  });
});

// ── ROUND-TRIP (the primary regression anchor) ────────────────────────────────
// tasksToCsv(tasks) → csvToTasks(csv) must reproduce the 18-column task fields.
// Each round-trip assertion is on EXECUTION output, never source text.

describe('csvToTasks — ROUND-TRIP anchor with tasksToCsv', () => {
  it('RT-1: plain task round-trips all scalar fields', () => {
    const original = {
      id: 'task-abc',
      text: 'Buy groceries',
      taskType: 'one-off',
      status: 'active',
      pri: 'P1',
      project: 'Personal',
      dur: '45',
      scheduledAt: '2026-06-15T09:00:00Z',
      date: '2026-06-15',
      time: '09:00',
      deadline: '2026-06-16',
      startAfter: null,
      recurring: false,
      location: ['Home'],
      tools: ['Notion'],
      notes: null,
      url: null,
      completedAt: null,
    };

    const csv = tasksToCsv([original]);
    const [roundTripped] = csvToTasks(csv);

    // Scalar fields
    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.text).toBe(original.text);
    expect(roundTripped.taskType).toBe(original.taskType);
    expect(roundTripped.status).toBe(original.status);
    expect(roundTripped.pri).toBe(original.pri);
    expect(roundTripped.project).toBe(original.project);
    expect(roundTripped.dur).toBe(original.dur);
    expect(roundTripped.scheduledAt).toBe(original.scheduledAt);
    expect(roundTripped.date).toBe(original.date);
    expect(roundTripped.time).toBe(original.time);
    expect(roundTripped.deadline).toBe(original.deadline);

    // Array fields
    expect(roundTripped.location).toEqual(original.location);
    expect(roundTripped.tools).toEqual(original.tools);

    // Boolean recurring
    // original recurring=false → encoded as 'false' → decoded to false
    expect(roundTripped.recurring).toBe(false);
  });

  it('RT-2: task with embedded comma and quotes in text round-trips', () => {
    const original = {
      text: 'Buy milk, eggs, and "organic" bread',
      status: 'active',
      location: [],
      tools: [],
    };

    const csv = tasksToCsv([original]);
    const [roundTripped] = csvToTasks(csv);

    expect(roundTripped.text).toBe(original.text);
  });

  it('RT-3: task with embedded newline in notes round-trips', () => {
    const original = {
      text: 'Multiline task',
      notes: 'Line1\nLine2\nLine3',
      location: [],
      tools: [],
    };

    const csv = tasksToCsv([original]);
    const [roundTripped] = csvToTasks(csv);

    expect(roundTripped.text).toBe('Multiline task');
    expect(roundTripped.notes).toBe('Line1\nLine2\nLine3');
  });

  it('RT-4: location array with multiple elements round-trips', () => {
    const original = {
      text: 'Task with locations',
      location: ['Home', 'Office', 'Gym'],
      tools: ['Slack', 'Notion'],
    };

    const csv = tasksToCsv([original]);
    const [roundTripped] = csvToTasks(csv);

    expect(roundTripped.location).toEqual(['Home', 'Office', 'Gym']);
    expect(roundTripped.tools).toEqual(['Slack', 'Notion']);
  });

  it('RT-5: formula-prefixed text (=danger) round-trips to original value', () => {
    // The exporter guards '=danger' → "'=danger" in CSV; importer strips the leading '
    const original = {
      text: '=HYPERLINK("http://evil","click")',
      location: [],
      tools: [],
    };

    const csv = tasksToCsv([original]);
    const [roundTripped] = csvToTasks(csv);

    expect(roundTripped.text).toBe('=HYPERLINK("http://evil","click")');
  });

  it('RT-6: recurring=true round-trips to boolean true', () => {
    const original = {
      text: 'Daily standup',
      recurring: true,
      location: [],
      tools: [],
    };

    const csv = tasksToCsv([original]);
    const [roundTripped] = csvToTasks(csv);

    expect(roundTripped.recurring).toBe(true);
  });

  it('RT-7: multiple tasks round-trip in order with correct count', () => {
    const originals = [
      { text: 'Task A', status: 'active', location: [], tools: [] },
      { text: 'Task B', status: 'done', location: ['Home'], tools: [] },
      { text: 'Task C, with comma', status: 'active', location: [], tools: ['Slack'] },
    ];

    const csv = tasksToCsv(originals);
    const roundTripped = csvToTasks(csv);

    expect(roundTripped).toHaveLength(3);
    expect(roundTripped[0].text).toBe('Task A');
    expect(roundTripped[1].text).toBe('Task B');
    expect(roundTripped[2].text).toBe('Task C, with comma');
    expect(roundTripped[1].location).toEqual(['Home']);
    expect(roundTripped[2].tools).toEqual(['Slack']);
  });

  it('RT-8: empty tasksToCsv([]) → csvToTasks → empty array (header-only CSV)', () => {
    const csv = tasksToCsv([]);
    const tasks = csvToTasks(csv);
    expect(tasks).toEqual([]);
  });
});

// ── MALFORMED → throws ────────────────────────────────────────────────────────

describe('csvToTasks — malformed input throws', () => {
  it('throws on unbalanced quote (RFC-4180 violation)', () => {
    const csv = 'text\r\n"unclosed\r\n';
    expect(() => csvToTasks(csv)).toThrow();
  });

  it('throws on ragged row (fewer cells than header)', () => {
    const csv = 'text,status,pri\r\nTask,active\r\n'; // 2 cells vs 3-column header
    expect(() => csvToTasks(csv)).toThrow(/ragged/i);
  });

  it('throws on ragged row (more cells than header)', () => {
    const csv = 'text,status\r\nTask,active,extra\r\n'; // 3 cells vs 2-column header
    expect(() => csvToTasks(csv)).toThrow();
  });

  it('throws on header missing "text" column', () => {
    const csv = 'id,status\r\ntask-1,active\r\n'; // no "text" column
    expect(() => csvToTasks(csv)).toThrow(/text/i);
  });

  it('throws on completely empty CSV string (no header)', () => {
    expect(() => csvToTasks('')).toThrow();
  });

  it('throws when input is not a string (e.g. null)', () => {
    expect(() => csvToTasks(null)).toThrow();
  });

  it('throws when input is not a string (e.g. object)', () => {
    expect(() => csvToTasks({})).toThrow();
  });
});

// ── Prototype-pollution guard ─────────────────────────────────────────────────

describe('csvToTasks — prototype-pollution guard', () => {
  it('rejects a CSV with __proto__ as a header key', () => {
    const csv = 'text,__proto__\r\nTask,polluted\r\n';
    expect(() => csvToTasks(csv)).toThrow(/forbidden/i);
  });

  it('rejects a CSV with constructor as a header key', () => {
    const csv = 'text,constructor\r\nTask,polluted\r\n';
    expect(() => csvToTasks(csv)).toThrow(/forbidden/i);
  });

  it('rejects a CSV with prototype as a header key', () => {
    const csv = 'text,prototype\r\nTask,polluted\r\n';
    expect(() => csvToTasks(csv)).toThrow(/forbidden/i);
  });

  it('does NOT pollute Object.prototype after a crafted __proto__ CSV', () => {
    // Even if the throw is caught, Object.prototype must remain clean
    const csv = 'text,__proto__\r\nTask,polluted\r\n';
    try { csvToTasks(csv); } catch (e) { /* expected */ }

    // Object.prototype must be clean
    expect(({}).polluted).toBeUndefined();
  });

  it('a valid CSV does not pollute Object.prototype via task fields', () => {
    const csv = 'text,status\r\nTask,active\r\n';
    csvToTasks(csv);
    expect(({}).status).toBeUndefined();
  });
});

// ── Regression anchors (bert-referred after ernie BLOCK+WARN fixes) ──────────
//
// Each test below FAILS on pre-fix csv-to-tasks.js and PASSES on the fixed code.
// They pin the three ernie findings: ernie-jcsv-01 (BLOCK), ernie-jcsv-02 (WARN),
// ernie-jcsv-03b (WARN).  The pre-fix failure behaviour is noted inline.

describe('csvToTasks — regression: ernie-jcsv-01 — no-trailing-newline + empty last column', () => {
  // ernie-jcsv-01 BLOCK: tasksToCsv produces a \r\n-terminated string whose last
  // column (completedAt) is empty. When the trailing \r\n is stripped (as tools
  // like curl --data-binary, editors, and copy-paste do), the final empty cell
  // was silently dropped by the parse loop, yielding 17 cells vs an 18-column
  // header — a false "ragged row" 400 rejection.
  //
  // Pre-fix: csvToTasks(noNewline) throws /ragged/i → test FAILS on .toHaveLength(1).
  // Post-fix: trailing-comma flush (csv-to-tasks.js lines 161-167) pushes the
  // missing empty cell before flushing, yielding exactly 18 cells — no throw.

  it('ernie-jcsv-01: round-trip with trailing \\r\\n stripped → 1 row, text===hi, no ragged-row throw', () => {
    // Build a canonical 18-column CSV via the real exporter, then strip the final \r\n
    const exported = tasksToCsv([{ id: '1', text: 'hi', completedAt: '' }]);
    // Confirm the exporter terminates with \r\n before we strip it
    expect(exported.endsWith('\r\n')).toBe(true);
    const noNewline = exported.slice(0, -2); // strip exactly the trailing \r\n

    // Must NOT throw; must return exactly 1 row
    let tasks;
    expect(() => { tasks = csvToTasks(noNewline); }).not.toThrow();
    expect(tasks).toHaveLength(1);

    // text round-trips correctly
    expect(tasks[0].text).toBe('hi');

    // All 18 header columns are present in the parsed row (verifies correct cell count)
    const ALL_18 = [
      'id', 'text', 'taskType', 'status', 'pri', 'project', 'dur',
      'scheduledAt', 'date', 'time', 'deadline', 'startAfter', 'recurring',
      'location', 'tools', 'notes', 'url', 'completedAt',
    ];
    // The parser only sets a field if the cell is non-empty; id='1' and text='hi'
    // are non-empty; all others are empty → omitted. So verify the two non-empty
    // fields round-trip AND that the parser didn't throw on cell count.
    expect(tasks[0].id).toBe('1');
    // Spot-check that location and tools (always array columns) decode correctly
    // even when empty on the trailing-no-newline row.
    expect(tasks[0].location).toEqual([]);
    expect(tasks[0].tools).toEqual([]);
    // completedAt was empty → omitted; confirm no spurious ragged-row artefact
    expect(Object.prototype.hasOwnProperty.call(tasks[0], 'completedAt')).toBe(false);
  });
});

describe('csvToTasks — regression: ernie-jcsv-02 — apostrophe preservation', () => {
  // ernie-jcsv-02 WARN: stripInjectionGuard formerly stripped the leading '
  // unconditionally, corrupting genuine apostrophe-led values ('tis, '90s, etc.)
  // that the exporter never guarded.
  //
  // Pre-fix: csvToTasks("text\r\n'tis the season\r\n")[0].text === 'tis the season'
  //   (leading apostrophe silently removed) → toBe("'tis the season") FAILS.
  // Post-fix: strip only when s[1] is in INJECTION_TRIGGER_CHARS
  //   ({= + - @ \t \r}); 't' is not a trigger → apostrophe kept.

  it('ernie-jcsv-02a: genuine apostrophe-led value "\'tis the season" is preserved unchanged', () => {
    // 't' is NOT an injection trigger → the leading apostrophe must be kept
    const csv = "text\r\n'tis the season\r\n";
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("'tis the season");
  });

  it('ernie-jcsv-02b: injection-guard apostrophe before "=" is still stripped ("\'=danger" → "=danger")', () => {
    // '=' IS an injection trigger → the leading apostrophe must be stripped.
    // This confirms the fix did not over-correct and break the OWASP reversal.
    const csv = "text\r\n'=danger\r\n";
    const tasks = csvToTasks(csv);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe('=danger');
  });
});

describe('csvToTasks — regression: ernie-jcsv-03b — two id-less rows stay distinct', () => {
  // ernie-jcsv-03b WARN: before the fix, rows with an empty id cell produced
  // task objects with id===undefined. MergeImportData keyed its dedup Map on
  // t.id, so all id-less rows shared the key `undefined` and collapsed to one.
  //
  // Pre-fix: csvToTasks(twoIdlessRows)[1].id === undefined → tasks.length may
  //   be 2 from csvToTasks itself, but merging would silently discard one.
  //   More directly, the fix assigns task.id — so on pre-fix code tasks[0].id
  //   is undefined (falsy), failing the expect(tasks[0].id).toBeTruthy() check.
  // Post-fix: each id-less row gets task.id = 'csv-import-row-' + ri (a truthy,
  //   row-index-unique string), so both rows survive MergeImportData dedup.

  it('ernie-jcsv-03b: two data rows with empty id cells → 2 distinct task objects with distinct truthy ids', () => {
    // Two rows, no id column value, both have text (so neither is skipped).
    // Using only text column to keep the fixture simple and unambiguous.
    const csv = [
      'id,text',
      ',First task',
      ',Second task',
      '',
    ].join('\r\n');

    const tasks = csvToTasks(csv);

    // Must produce exactly 2 tasks — no collapse
    expect(tasks).toHaveLength(2);

    // Both ids must be truthy (not undefined / null / '')
    expect(tasks[0].id).toBeTruthy();
    expect(tasks[1].id).toBeTruthy();

    // Ids must be DISTINCT — different rows must not share the same id
    expect(tasks[0].id).not.toBe(tasks[1].id);

    // Text fields verify the rows are in order and not mangled
    expect(tasks[0].text).toBe('First task');
    expect(tasks[1].text).toBe('Second task');
  });
});
