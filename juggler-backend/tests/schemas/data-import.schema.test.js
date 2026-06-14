/**
 * W1 unit test — data-import.schema (two-mode import, Wave 1).
 *
 * Pure unit test, NO DB. Asserts the schema's OWN verdict:
 *   - a valid v7 body passes (incl. extra unknown top-level keys via .passthrough()).
 *   - `extraTasks` as a string (non-array) → fails.
 *   - missing `extraTasks` → schema fails (it treats extraTasks as a required array);
 *     the legacy `!data.extraTasks` guard still owns the user-facing "Invalid import
 *     data" message — this test only asserts the schema verdict, not the message.
 *
 * Traceability: WBS Wave-1 W1; golden-master H2-6 (the "Invalid import data" message
 * stays owned by the legacy guard — see schema header).
 */

'use strict';

var path = require('path');
var SCHEMA = path.join(__dirname, '..', '..', 'src', 'schemas', 'data-import.schema');
var { dataImportSchema, validateImportBody } = require(SCHEMA);

// A full v7 body that mirrors ExportData's output, carrying export-only EXTRA keys
// (v7, updated) to prove .passthrough() allows unknown top-level keys.
function validV7Body() {
  return {
    v7: true,                              // unknown top-level key — must pass through
    extraTasks: [{ id: 't1', text: 'A' }, { id: 't2', text: 'B' }],
    statuses: { t1: 'done' },
    locations: [{ id: 'l1', name: 'Home', icon: '' }],
    tools: [{ id: 'tool1', name: 'Laptop', icon: '💻' }],
    projects: [{ id: 1, name: 'Work', color: '#f00', icon: null }],
    toolMatrix: { t1: { tool1: true } },
    timeBlocks: { mon: [] },
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    gridZoom: 90,
    splitDefault: true,
    splitMinDefault: 15,
    schedFloor: 480,
    schedCeiling: 1380,
    updated: '2026-06-13T00:00:00.000Z',  // unknown top-level key — must pass through
  };
}

describe('data-import.schema — dataImportSchema.safeParse', () => {
  test('a valid v7 body passes (incl. unknown extra top-level keys)', () => {
    var result = dataImportSchema.safeParse(validV7Body());
    expect(result.success).toBe(true);
    // .passthrough() keeps unknown keys
    expect(result.data.v7).toBe(true);
    expect(result.data.updated).toBe('2026-06-13T00:00:00.000Z');
    expect(result.data.extraTasks).toHaveLength(2);
  });

  test('a minimal body with ONLY extraTasks passes (all other fields optional)', () => {
    var result = dataImportSchema.safeParse({ extraTasks: [] });
    expect(result.success).toBe(true);
  });

  test('extraTasks as a STRING → fails (must be an array)', () => {
    var body = validV7Body();
    body.extraTasks = 'not-an-array';
    var result = dataImportSchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  test('extraTasks as a NUMBER → fails (must be an array)', () => {
    var result = dataImportSchema.safeParse({ extraTasks: 5 });
    expect(result.success).toBe(false);
  });

  test('missing extraTasks → schema fails (required array)', () => {
    var result = dataImportSchema.safeParse({ notExtraTasks: [] });
    expect(result.success).toBe(false);
  });

  test('a non-number gridZoom → fails (preference is a number)', () => {
    var body = validV7Body();
    body.gridZoom = 'big';
    var result = dataImportSchema.safeParse(body);
    expect(result.success).toBe(false);
  });
});

describe('data-import.schema — validateImportBody helper', () => {
  test('valid body → { ok: true, data, errors: null }', () => {
    var out = validateImportBody(validV7Body());
    expect(out.ok).toBe(true);
    expect(out.errors).toBeNull();
    expect(out.data.extraTasks).toHaveLength(2);
  });

  test('invalid body → { ok: false, data: null, errors: [path: message] }', () => {
    var out = validateImportBody({ extraTasks: 'nope' });
    expect(out.ok).toBe(false);
    expect(out.data).toBeNull();
    expect(Array.isArray(out.errors)).toBe(true);
    expect(out.errors.length).toBeGreaterThan(0);
    // error string mirrors validate.js shape: 'extraTasks: <message>'
    expect(out.errors[0]).toMatch(/^extraTasks: /);
  });
});
