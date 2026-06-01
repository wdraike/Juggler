/**
 * ZOE-JUG-028 — MCP create_task Boundary Validation Tests
 *
 * Exercises the create_task (singular) handler's invalid-input rejection paths
 * so that any relaxation of validation is caught by tests:
 *
 *   1. Missing text           → error "Task name is required"
 *   2. text > 500 chars       → error "Task name must be 500 characters or less"
 *   3. dur ≤ 0                → error "Duration must be greater than 0"
 *   4. splitMin > dur         → error "Split minimum must be less than or equal to duration"
 *   5. deadline < startAfter  → error "Deadline must be on or after start-after date"
 *   6. invalid recur type     → error "Invalid recurrence type"
 *   7. timeFlex < 0           → error "Time flex must be between 0 and 480 minutes"
 *   8. timeFlex > 480         → error "Time flex must be between 0 and 480 minutes"
 *   9. Boundary: text exactly 500 chars → accepted
 *  10. Boundary: dur = 1      → accepted
 *  11. Boundary: splitMin = dur → accepted (equal is allowed)
 *  12. Boundary: deadline = startAfter → accepted (same-day is allowed)
 *  13. Boundary: timeFlex = 0 → accepted
 *  14. Boundary: timeFlex = 480 → accepted
 *  15. Valid recur type       → accepted
 *  16. isError flag is true on any validation failure
 *  17. No insertTask call on validation failure
 *  18. enqueueScheduleRun NOT called on validation failure
 *
 * Uses a fully in-memory mock DB — no real DB connection required.
 * Variable naming: variables accessed inside jest.mock() factories must start
 * with "mock" (case insensitive) per Jest's module factory scoping rule.
 */

'use strict';

// ── Captured call state ───────────────────────────────────────────────────────

var mockInsertCalls = [];
var mockEnqueueCalls = [];
var mockIsLockedValue = false;

function resetCaptures() {
  mockInsertCalls = [];
  mockEnqueueCalls = [];
  mockIsLockedValue = false;
}

// ── DB mock ───────────────────────────────────────────────────────────────────
// create_task reads: users (timezone), user_config (splitDefault),
// projects (ensureProject), and tasks_with_sync_v (return value after insert).
// We return minimal stubs for each.

var mockCreatedRow = null; // set per-test to control what the final .first() returns

var mockDb = (function() {
  var _table = null;
  var _where = {};

  function db(tableName) {
    _table = tableName;
    _where = {};
    return db;
  }

  db.fn = { now: function() { return 'MOCK_NOW'; } };
  db.raw = function() { return Promise.resolve([[], []]); };

  db.where = function(condOrField, val) {
    if (typeof condOrField === 'object' && condOrField !== null) {
      Object.assign(_where, condOrField);
    } else if (typeof condOrField === 'function') {
      // complex builder — ignored
    } else if (typeof condOrField === 'string' && val !== undefined) {
      _where[condOrField] = val;
    }
    return db;
  };
  db.whereIn    = function() { return db; };
  db.whereRaw   = function() { return db; };
  db.whereNot   = function() { return db; };
  db.whereNull  = function() { return db; };
  db.orWhere    = function() { return db; };
  db.orWhereNull = function() { return db; };
  db.orderBy    = function() { return db; };
  db.orderByRaw = function() { return db; };
  db.limit      = function() { return db; };
  db.insert     = function() { return Promise.resolve([1]); };
  db.update     = function() { return Promise.resolve(1); };
  db.del        = function() { return Promise.resolve(1); };
  db.catch      = function(fn) { return Promise.resolve([]).catch(fn); };
  db.transaction = function(cb) { return cb(db); };

  function resolve() {
    var t = _table;
    var w = _where;
    if (t === 'users') {
      return [{ id: w.id || 'user-001', timezone: 'America/New_York' }];
    }
    if (t === 'user_config') {
      return [{ config_key: 'preferences', config_value: JSON.stringify({ splitDefault: false }) }];
    }
    if (t === 'projects' || t === 'task_masters' || t === 'task_instances' || t === 'sync_locks') {
      return [];
    }
    if (t === 'tasks_with_sync_v') {
      // Return the mockCreatedRow when the handler fetches the newly created task.
      return mockCreatedRow ? [mockCreatedRow] : [];
    }
    if (t === 'tasks_v') {
      return [];
    }
    return [];
  }

  db.first = function() {
    var rows = resolve();
    return Promise.resolve(rows.length > 0 ? rows[0] : null);
  };
  db.select = function() {
    var rows = resolve();
    var p = Promise.resolve(rows);
    p.first = function() { return Promise.resolve(rows.length > 0 ? rows[0] : null); };
    return p;
  };
  db.max    = function() { return db; };
  db.groupBy = function() { return db; };
  db.pluck  = function() { return Promise.resolve([]); };
  db.then   = function(res, rej) { return Promise.resolve(resolve()).then(res, rej); };

  return db;
})();

// ── Jest mocks ────────────────────────────────────────────────────────────────

jest.mock('../src/db', function() { return mockDb; });

jest.mock('../src/lib/tasks-write', function() {
  return {
    insertTask: function(_db, row) {
      mockInsertCalls.push({ row: Object.assign({}, row) });
      return Promise.resolve();
    },
    updateTaskById: function() { return Promise.resolve(); },
    deleteTaskById: function() { return Promise.resolve(); }
  };
});

jest.mock('../src/scheduler/scheduleQueue', function() {
  return { enqueueScheduleRun: jest.fn() };
});

jest.mock('../src/lib/task-write-queue', function() {
  return {
    isLocked: function() { return Promise.resolve(mockIsLockedValue); },
    enqueueWrite: function(userId, taskId, op, fields, src) {
      mockEnqueueCalls.push({ userId: userId, taskId: taskId, op: op, fields: fields, src: src });
      return Promise.resolve();
    },
    splitFields: function(row) {
      return { schedulingFields: row, nonSchedulingFields: {} };
    }
  };
});

jest.mock('../src/lib/sse-emitter', function() {
  return { emitTasksChanged: jest.fn() };
});

// ── Handler capture ───────────────────────────────────────────────────────────

var { registerTaskTools } = require('../src/mcp/tools/tasks');

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = { tool: function(name, _d, _s, h) { handlers[name] = h; } };
  registerTaskTools(fakeServer, userId || 'user-001');
  return handlers;
}

// ── Row factory ───────────────────────────────────────────────────────────────
// Use a real ISO-formatted date string so rowToTask's new Date().toISOString() works.
// source_id must be null (not undefined) but task_type must NOT be 'recurring_instance'
// so the orphan-check warning path is not triggered.

function makeSuccessRow(overrides) {
  return Object.assign({
    id: 'task-' + Math.random().toString(36).slice(2),
    user_id: 'user-001',
    task_type: 'task',
    text: 'Test task',
    dur: null,
    pri: 'P3',
    status: '',
    when: null,
    day_req: null,
    scheduled_at: null,
    desired_at: null,
    tz: null,
    deadline: null,
    start_after_at: null,
    recur_start: null,
    recur_end: null,
    location: '[]',
    tools: '[]',
    recurring: 0,
    recur: null,
    source_id: null,
    generated: 0,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    depends_on: '[]',
    marker: 0,
    placement_mode: null,
    flex_when: 0,
    travel_before: null,
    travel_after: null,
    notes: null,
    url: null,
    split: 0,
    split_min: null,
    split_total: null,
    time_remaining: null,
    time_flex: null,
    master_id: null,
    project: null,
    section: null,
    overdue: 0,
    slack_mins: null,
    // Use a real date string — rowToTask calls new Date(created_at).toISOString()
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  }, overrides);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errorText(result) {
  return result && result.content && result.content[0] ? result.content[0].text : '';
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(function() {
  resetCaptures();
  mockCreatedRow = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Missing text → error
// ─────────────────────────────────────────────────────────────────────────────

describe('create_task boundary — missing text', function() {

  test('no text field → isError=true, "Task name is required"', async function() {
    var result = await captureHandlers()['create_task']({ dur: 30 });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/task name is required/i);
  });

  test('empty string text → isError=true', async function() {
    var result = await captureHandlers()['create_task']({ text: '' });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/task name is required/i);
  });

  test('whitespace-only text → isError=true', async function() {
    var result = await captureHandlers()['create_task']({ text: '   ' });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/task name is required/i);
  });

  test('no text → insertTask NOT called', async function() {
    await captureHandlers()['create_task']({ dur: 30 });
    expect(mockInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. text > 500 chars → error
// ─────────────────────────────────────────────────────────────────────────────

describe('create_task boundary — text length', function() {

  test('text of 501 chars → isError=true, length message', async function() {
    var result = await captureHandlers()['create_task']({ text: 'x'.repeat(501) });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/500 characters or less/i);
  });

  test('text of 500 chars → accepted (boundary)', async function() {
    mockCreatedRow = makeSuccessRow({ text: 'x'.repeat(500) });
    var result = await captureHandlers()['create_task']({ text: 'x'.repeat(500) });
    expect(result.isError).toBeFalsy();
    expect(mockInsertCalls.length).toBe(1);
  });

  test('text of 501 chars → insertTask NOT called', async function() {
    await captureHandlers()['create_task']({ text: 'x'.repeat(501) });
    expect(mockInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. dur ≤ 0 → error
// ─────────────────────────────────────────────────────────────────────────────

describe('create_task boundary — duration', function() {

  test('dur=0 → isError=true, "Duration must be greater than 0"', async function() {
    var result = await captureHandlers()['create_task']({ text: 'Task', dur: 0 });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/duration must be greater than 0/i);
  });

  test('dur=-1 → isError=true', async function() {
    var result = await captureHandlers()['create_task']({ text: 'Task', dur: -1 });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/duration must be greater than 0/i);
  });

  test('dur=-100 → isError=true', async function() {
    var result = await captureHandlers()['create_task']({ text: 'Task', dur: -100 });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/duration must be greater than 0/i);
  });

  test('dur=0 → insertTask NOT called', async function() {
    await captureHandlers()['create_task']({ text: 'Task', dur: 0 });
    expect(mockInsertCalls.length).toBe(0);
  });

  test('dur=1 → accepted (boundary)', async function() {
    mockCreatedRow = makeSuccessRow({ text: 'Task', dur: 1 });
    var result = await captureHandlers()['create_task']({ text: 'Task', dur: 1 });
    expect(result.isError).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. splitMin > dur → error
// ─────────────────────────────────────────────────────────────────────────────

describe('create_task boundary — splitMin vs dur', function() {

  test('split=true, splitMin=60, dur=30 → isError=true', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task', split: true, dur: 30, splitMin: 60
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/split minimum must be less than or equal to duration/i);
  });

  test('split=true, splitMin=31, dur=30 → isError=true (off-by-one)', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task', split: true, dur: 30, splitMin: 31
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/split minimum must be less than or equal to duration/i);
  });

  test('split=true, splitMin=30, dur=30 → accepted (equal is allowed)', async function() {
    mockCreatedRow = makeSuccessRow({ text: 'Task', dur: 30, split: 1, split_min: 30 });
    var result = await captureHandlers()['create_task']({
      text: 'Task', split: true, dur: 30, splitMin: 30
    });
    expect(result.isError).toBeFalsy();
  });

  test('split=true, splitMin=60, dur=30 → insertTask NOT called', async function() {
    await captureHandlers()['create_task']({
      text: 'Task', split: true, dur: 30, splitMin: 60
    });
    expect(mockInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. deadline < startAfter → error
// ─────────────────────────────────────────────────────────────────────────────

describe('create_task boundary — deadline vs startAfter', function() {

  test('deadline before startAfter → isError=true', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      deadline: '2026-06-01',
      startAfter: '2026-06-15'
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/deadline must be on or after start-after date/i);
  });

  test('deadline 1 day before startAfter → isError=true', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      deadline: '2026-06-14',
      startAfter: '2026-06-15'
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/deadline must be on or after start-after date/i);
  });

  test('deadline same as startAfter → accepted (same-day is allowed)', async function() {
    mockCreatedRow = makeSuccessRow({
      text: 'Task',
      deadline: '2026-06-15',
      start_after_at: '2026-06-15'
    });
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      deadline: '2026-06-15',
      startAfter: '2026-06-15'
    });
    expect(result.isError).toBeFalsy();
  });

  test('deadline after startAfter → accepted', async function() {
    mockCreatedRow = makeSuccessRow({
      text: 'Task',
      deadline: '2026-06-20',
      start_after_at: '2026-06-15'
    });
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      deadline: '2026-06-20',
      startAfter: '2026-06-15'
    });
    expect(result.isError).toBeFalsy();
  });

  test('deadline before startAfter → insertTask NOT called', async function() {
    await captureHandlers()['create_task']({
      text: 'Task',
      deadline: '2026-06-01',
      startAfter: '2026-06-15'
    });
    expect(mockInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. invalid recur value → error
// ─────────────────────────────────────────────────────────────────────────────

describe('create_task boundary — recur type validation', function() {

  test('recur.type="banana" → isError=true, "Invalid recurrence type"', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      recur: { type: 'banana' }
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/invalid recurrence type/i);
  });

  test('recur.type="" (empty) → isError=true, "Recurrence type is required"', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      recur: { type: '' }
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/recurrence type is required/i);
  });

  test('recur.type="WEEKLY" → accepted (validateTaskInput normalises to lowercase before checking)', async function() {
    // validateTaskInput: var rType = (body.recur.type || '').toLowerCase();
    // So "WEEKLY".toLowerCase() === "weekly" which IS in the valid list.
    // This test documents that the handler is case-insensitive via toLowerCase().
    mockCreatedRow = makeSuccessRow({ text: 'Task', recurring: 1 });
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      recur: { type: 'WEEKLY' }
    });
    // ZOE-JUG-028-W1: positive assertions — must not be an error AND must have inserted a task
    expect(result.isError).toBeFalsy();
    expect(result).toBeDefined();
    expect(mockInsertCalls.length).toBe(1);
  });

  test('recur.type="yearly" → isError=true (not a known type)', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      recur: { type: 'yearly' }
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/invalid recurrence type/i);
  });

  test('recur.type="fortnightly" → isError=true', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      recur: { type: 'fortnightly' }
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/invalid recurrence type/i);
  });

  test('recur.type="quarterly" → isError=true', async function() {
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      recur: { type: 'quarterly' }
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/invalid recurrence type/i);
  });

  test('all valid recur types produce no "invalid recurrence type" error', async function() {
    // Valid types: daily, weekly, biweekly, monthly, interval, none, rolling
    // biweekly and interval are anchor-dependent so they may fail on missing recurStart,
    // but they must not fail with "invalid recurrence type".
    var validTypes = ['daily', 'weekly', 'biweekly', 'monthly', 'interval', 'none', 'rolling'];
    for (var i = 0; i < validTypes.length; i++) {
      var type = validTypes[i];
      mockInsertCalls = [];
      mockCreatedRow = makeSuccessRow({ text: 'Task', recurring: 1 });
      var result = await captureHandlers()['create_task']({
        text: 'Task',
        recur: { type: type }
      });
      // Whatever the outcome, it must not be "invalid recurrence type"
      if (result.isError) {
        expect(errorText(result)).not.toMatch(/invalid recurrence type/i);
      }
    }
  });

  test('invalid recur type → insertTask NOT called', async function() {
    await captureHandlers()['create_task']({
      text: 'Task',
      recur: { type: 'quarterly' }
    });
    expect(mockInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. timeFlex outside 0–480 → error
// ─────────────────────────────────────────────────────────────────────────────

describe('create_task boundary — timeFlex range', function() {

  test('timeFlex=-1 → isError=true, "Time flex must be between 0 and 480"', async function() {
    var result = await captureHandlers()['create_task']({ text: 'Task', timeFlex: -1 });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/time flex must be between 0 and 480/i);
  });

  test('timeFlex=481 → isError=true', async function() {
    var result = await captureHandlers()['create_task']({ text: 'Task', timeFlex: 481 });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/time flex must be between 0 and 480/i);
  });

  test('timeFlex=1000 → isError=true', async function() {
    var result = await captureHandlers()['create_task']({ text: 'Task', timeFlex: 1000 });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/time flex must be between 0 and 480/i);
  });

  test('timeFlex=0 → accepted (boundary lower)', async function() {
    mockCreatedRow = makeSuccessRow({ text: 'Task', time_flex: 0 });
    var result = await captureHandlers()['create_task']({ text: 'Task', timeFlex: 0 });
    expect(result.isError).toBeFalsy();
  });

  test('timeFlex=480 → accepted (boundary upper)', async function() {
    mockCreatedRow = makeSuccessRow({ text: 'Task', time_flex: 480 });
    var result = await captureHandlers()['create_task']({ text: 'Task', timeFlex: 480 });
    expect(result.isError).toBeFalsy();
  });

  test('timeFlex=-1 → insertTask NOT called', async function() {
    await captureHandlers()['create_task']({ text: 'Task', timeFlex: -1 });
    expect(mockInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. isError flag and side-effect suppression (cross-cutting)
// ─────────────────────────────────────────────────────────────────────────────

describe('create_task boundary — isError flag and side-effect suppression', function() {

  test('any validation failure sets isError=true on the returned object', async function() {
    var cases = [
      { text: 'Task', dur: 0 },
      { text: 'Task', timeFlex: -1 },
      { text: 'Task', split: true, dur: 10, splitMin: 20 },
      { text: 'Task', deadline: '2026-01-01', startAfter: '2026-06-01' },
      { text: 'Task', recur: { type: 'fortnightly' } },
      { text: 'x'.repeat(501) }
    ];
    for (var i = 0; i < cases.length; i++) {
      var result = await captureHandlers()['create_task'](cases[i]);
      expect(result.isError).toBe(true);
    }
  });

  test('validation failure → enqueueScheduleRun NOT called', async function() {
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();

    await captureHandlers()['create_task']({ text: 'Task', dur: 0 });
    expect(enqueueScheduleRun).not.toHaveBeenCalled();
  });

  test('validation failure → response content is a plain string containing "Validation error"', async function() {
    var result = await captureHandlers()['create_task']({ text: 'Task', timeFlex: 999 });
    expect(result.isError).toBe(true);
    var text = errorText(result);
    expect(typeof text).toBe('string');
    expect(text).toMatch(/validation error/i);
  });

  test('multiple simultaneous violations → all reported in error string', async function() {
    // dur=0 AND timeFlex=999: both caught by validateTaskInput
    var result = await captureHandlers()['create_task']({
      text: 'Task',
      dur: 0,
      timeFlex: 999
    });
    expect(result.isError).toBe(true);
    var text = errorText(result);
    expect(text).toMatch(/duration must be greater than 0/i);
    expect(text).toMatch(/time flex must be between 0 and 480/i);
  });

  test('no text AND dur=0 → reports at least "Task name is required"', async function() {
    var result = await captureHandlers()['create_task']({ dur: 0 });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/task name is required/i);
  });
});
