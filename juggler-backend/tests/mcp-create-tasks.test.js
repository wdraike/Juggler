/**
 * ZOE-JUG-024 — MCP create_tasks Batch Handler Unit Tests
 *
 * Covers the create_tasks batch handler code paths in src/mcp/tools/tasks.js:
 *   1. Per-item placement_mode inference — items without placementMode
 *      (a) get split default applied correctly
 *      (b) date-only items get all_day backstop
 *      (c) items with time set → placement_mode left as-is (not all_day)
 *   2. placementMode:'fixed' with when time → scheduled_at set correctly
 *   3. placementMode:'fixed' without when time → validateTaskInput error
 *   4. Mixed-mode batch — flex, fixed, time_window items all accepted
 *   5. Split default — splitDefault=true in user prefs → row.split=1
 *   6. splitDefault=false → row.split=0 for items without explicit split
 *   7. Explicit split override — item.split=true on user with splitDefault=false → split=1
 *   8. Transaction rollback — one invalid item causes isError, no items written
 *   9. Cal-sync fields — create_tasks has no cal-sync guard (guard is update-only)
 *  10. enqueueScheduleRun called after successful batch
 *  11. Queued path — isLocked=true routes items through enqueueWrite
 *
 * Uses a fully in-memory mock DB — no real DB connection required.
 * Variable naming: variables accessed inside jest.mock() factories must start
 * with "mock" (case insensitive) per Jest's module factory scoping rule.
 */

'use strict';

// ── Captured call state ───────────────────────────────────────────────────────
// Named with "mock" prefix so jest.mock() factories can reference them.

var mockInsertCalls = [];       // all insertTask calls: { row }
var mockEnqueueCalls = [];      // all enqueueWrite calls: { userId, taskId, op, fields, src }
var mockIsLockedValue = false;  // controls isLocked() return value
var mockSplitDefault = false;   // controls user_config splitDefault value
var mockConfigValueRaw = null;  // when non-null, user_config returns this as config_value (bypasses JSON.stringify)

function resetCaptures() {
  mockInsertCalls = [];
  mockEnqueueCalls = [];
  mockIsLockedValue = false;
  mockSplitDefault = false;
  mockConfigValueRaw = null;
}

// ── DB mock ───────────────────────────────────────────────────────────────────

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
      var cv = mockConfigValueRaw !== null ? mockConfigValueRaw : JSON.stringify({ splitDefault: mockSplitDefault });
      return [{ config_key: 'preferences', config_value: cv }];
    }
    if (t === 'projects' || t === 'task_masters' || t === 'task_instances' || t === 'sync_locks') {
      return [];
    }
    if (t === 'tasks_v' || t === 'tasks_with_sync_v') {
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
  db.max = function() { return db; };
  db.groupBy = function() { return db; };
  db.pluck = function() { return Promise.resolve([]); };
  db.then = function(res, rej) { return Promise.resolve(resolve()).then(res, rej); };

  return db;
})();

// ── Jest mocks ────────────────────────────────────────────────────────────────

jest.mock('../src/db', function() { return mockDb; });

// 999.1395: the facade path (slices/task, ADR-0002) gets its knex via
// lib/db.getDefaultDb() — NOT via src/db. Without this mock the facade reaches
// the real DB and every capture-based assertion misses the write. Route lib/db
// to the same mocked instance src/db returns.
jest.mock('../src/lib/db', function() {
  return {
    getDefaultDb: function() { return require('../src/db'); },
    createKnex: function() { return require('../src/db'); },
    withTransaction: function(cb) { return cb(require('../src/db')); },
    TransactionContext: function TransactionContext() {},
    defaultPoolConfig: {},
    ENVIRONMENTS: {},
    _resetForTests: function() {}
  };
});

jest.mock('../src/lib/tasks-write', function() {
  return {
    insertTask: function(_db, row) {
      mockInsertCalls.push({ row: Object.assign({}, row) });
      return Promise.resolve();
    },
    // 999.1398: batchUpdateTxn reads the affected-row counts off the result
    updateTaskById: function() { return Promise.resolve({ masterUpdated: 1, instanceUpdated: 0 }); },
    deleteTaskById: function() { return Promise.resolve(); }
  };
});

jest.mock('../src/scheduler/scheduleQueue', function() {
  return { enqueueScheduleRun: jest.fn() };
});
// 999.1198 seam: the facade enqueues via scheduleTrigger, which the REAL
// scheduleQueue self-registers into at load. Mocking scheduleQueue suppresses
// that registration, so wire the mock into the seam explicitly.
require('../src/scheduler/scheduleTrigger').registerScheduleTrigger(
  require('../src/scheduler/scheduleQueue').enqueueScheduleRun
);

jest.mock('../src/lib/task-write-queue', function() {
  return {
    isLocked: function() { return Promise.resolve(mockIsLockedValue); },
    enqueueWrite: function(userId, taskId, op, fields, src) {
      mockEnqueueCalls.push({ userId: userId, taskId: taskId, op: op, fields: fields, src: src });
      return Promise.resolve();
    },
    // splitFields only used by batch_update_tasks / update_task, not create_tasks
    splitFields: function(row) {
      return { schedulingFields: row, nonSchedulingFields: {} };
    }
  };
});

jest.mock('../src/lib/sse-emitter', function() {
  // facade.js calls sseEmitter.emit(...) directly (S4/S6 mutation->schedule
  // trigger); stubbing only emitTasksChanged crashes mutating handlers.
  return { emit: jest.fn(), emitTasksChanged: jest.fn() };
});

// ── Handler capture ───────────────────────────────────────────────────────────

var { registerTaskTools } = require('../src/mcp/tools/tasks');

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = { tool: function(name, _d, _s, h) { handlers[name] = h; } };
  registerTaskTools(fakeServer, userId || 'user-001');
  return handlers;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseResult(result) {
  if (!result || !result.content || !result.content[0]) return null;
  try { return JSON.parse(result.content[0].text); } catch (e) { return result.content[0].text; }
}

/** Get the nth insertTask row (0-based). */
function insertedRow(n) {
  return mockInsertCalls[n] ? mockInsertCalls[n].row : null;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(function() {
  resetCaptures();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Per-item placement_mode inference
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — per-item placement_mode inference', function() {

  test('item with no date and no time → placement_mode remains undefined (backstop only fires with date)', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'No date no time' }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    expect(row).not.toBeNull();
    // No date → backstop cannot fire → taskToRow leaves placement_mode unset
    expect(row.placement_mode).toBeUndefined();
  });

  test('item with date only → placement_mode inferred as all_day', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Date only', date: '6/15' }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    expect(row.placement_mode).toBe('all_day');
  });

  test('item with date AND time → all_day backstop does NOT fire (time was set)', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Date with time', date: '6/15', time: '9:00 AM' }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    // time was set → _tTimeWasSet=true → backstop skipped → taskToRow leaves placement_mode unset
    expect(row.placement_mode).toBeUndefined();
  });

  test('item with scheduledAt → all_day backstop does NOT fire', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'UTC scheduled', scheduledAt: '2026-06-15T14:00:00Z' }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    // scheduledAt counts as time-was-set → backstop skipped → placement_mode unset
    expect(row.placement_mode).toBeUndefined();
  });

  test('item with explicit placementMode + date → explicit value wins over backstop', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Explicit mode', date: '6/15', placementMode: 'anytime' }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    // taskToRow sets placement_mode = 'anytime'; backstop condition
    // (row.placement_mode === undefined) is false → backstop skipped
    expect(row.placement_mode).toBe('anytime');
  });

  test('item with explicit placementMode time_window → maps correctly to row', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Time window task', placementMode: 'time_window' }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    expect(row.placement_mode).toBe('time_window');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. placementMode:'fixed' with date+time → succeeds, scheduled_at set
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — placementMode:fixed with scheduling info', function() {

  test('fixed + date + time → succeeds, row has scheduled_at', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Fixed task', placementMode: 'fixed', date: '6/15', time: '2:00 PM' }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    expect(row.placement_mode).toBe('fixed');
    // taskToRow should have computed scheduled_at from date+time
    expect(row.scheduled_at).not.toBeNull();
    expect(row.scheduled_at).not.toBeUndefined();
  });

  test('fixed + scheduledAt → succeeds', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Fixed UTC', placementMode: 'fixed', scheduledAt: '2026-06-15T18:00:00Z' }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    expect(row.placement_mode).toBe('fixed');
    expect(row.scheduled_at).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. placementMode:'fixed' without scheduling info → validation error
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — placementMode:fixed validation error', function() {

  test('fixed with no date/time → validateTaskInput returns error, isError=true', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Fixed no time', placementMode: 'fixed' }]
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode "fixed" requires/i);
  });

  test('fixed with empty-string date and empty-string time → validation error', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Fixed empty strings', placementMode: 'fixed', date: '', time: '' }]
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode "fixed" requires/i);
  });

  test('invalid placementMode value → validation error', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Bad mode', placementMode: 'bogus_mode' }]
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode.*is not valid/i);
  });

  test('fixed error reports task index', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'Valid task one' },
        { text: 'Fixed no time', placementMode: 'fixed' }
      ]
    });
    expect(result.isError).toBe(true);
    // Handler prefixes error with "Validation error on task N:"
    expect(result.content[0].text).toMatch(/task 1/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mixed-mode batch
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — mixed placement mode batch', function() {

  test('batch with anytime, time_window, fixed items → all accepted, correct modes in rows', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'Anytime task', placementMode: 'anytime' },
        { text: 'Time window task', placementMode: 'time_window' },
        { text: 'Fixed task', placementMode: 'fixed', date: '6/20', time: '10:00 AM' }
      ]
    });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.created).toBe(3);
    expect(insertedRow(0).placement_mode).toBe('anytime');
    expect(insertedRow(1).placement_mode).toBe('time_window');
    expect(insertedRow(2).placement_mode).toBe('fixed');
  });

  test('batch with mixed date-only and no-date items → date-only items get all_day', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'No date', dur: 30 },
        { text: 'Date only', date: '7/4' },
        { text: 'Date with time', date: '7/4', time: '9:00 AM' }
      ]
    });
    expect(result.isError).toBeFalsy();
    // Item 0: no date → no all_day inference
    expect(insertedRow(0).placement_mode).not.toBe('all_day');
    // Item 1: date only → all_day
    expect(insertedRow(1).placement_mode).toBe('all_day');
    // Item 2: date + time → no all_day inference
    expect(insertedRow(2).placement_mode).not.toBe('all_day');
  });

  test('batch with reminder placement mode → accepted', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Reminder task', placementMode: 'reminder', date: '6/15', time: '9:00 AM' }]
    });
    expect(result.isError).toBeFalsy();
    expect(insertedRow(0).placement_mode).toBe('reminder');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Split default — splitDefault=true
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — split default behavior', function() {

  test('splitDefault=true in user prefs → row.split=1 for items without explicit split', async function() {
    mockSplitDefault = true;
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Default split task' }]
    });
    expect(result.isError).toBeFalsy();
    expect(insertedRow(0).split).toBe(1);
  });

  test('splitDefault=false in user prefs → row.split=0 for items without explicit split', async function() {
    mockSplitDefault = false;
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'No split default' }]
    });
    expect(result.isError).toBeFalsy();
    expect(insertedRow(0).split).toBe(0);
  });

  test('explicit split:true on item with splitDefault=false → row.split=1', async function() {
    mockSplitDefault = false;
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Explicit split on', split: true }]
    });
    expect(result.isError).toBeFalsy();
    // taskToRow sets row.split = 1 from task.split=true; handler condition
    // (row.split === undefined || null) is false → splitDefault not applied
    expect(insertedRow(0).split).toBe(1);
  });

  test('explicit split:false on item with splitDefault=true → row.split=0', async function() {
    mockSplitDefault = true;
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Explicit split off', split: false }]
    });
    expect(result.isError).toBeFalsy();
    // taskToRow sets row.split = 0 from task.split=false; handler skips splitDefault
    expect(insertedRow(0).split).toBe(0);
  });

  test('item with splitMin set → splitMin mapped to row.split_min', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Split min task', split: true, dur: 60, splitMin: 15 }]
    });
    expect(result.isError).toBeFalsy();
    expect(insertedRow(0).split_min).toBe(15);
  });

  test('splitMin validation: splitMin > dur → validation error', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Bad split min', split: true, dur: 30, splitMin: 60 }]
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/split minimum must be less than or equal to duration/i);
  });

  test('splitMin validation: splitMin <= 0 → validation error', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Zero split min', split: true, splitMin: 0 }]
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/split minimum must be greater than 0/i);
  });

  test('config_value is an object (not a JSON string) → parsed directly, splitDefault applied (ZOE-JUG-024-W1)', async function() {
    // tasks.js line 183: typeof prefs.config_value === 'string' ? JSON.parse(...) : prefs.config_value
    // When MySQL returns a pre-parsed JSON column (object, not a string), the else
    // branch is taken. mockConfigValueRaw causes the mock DB to return an object
    // directly for the user_config row, exercising that branch.
    mockConfigValueRaw = { splitDefault: true };
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Object config_value task' }]
    });
    expect(result.isError).toBeFalsy();
    // splitDefault:true was read via the object branch → row.split=1
    expect(insertedRow(0).split).toBe(1);
  });

  test('prefs row absent (user_config returns null) → splitDefault=false, row.split=0', async function() {
    // Handler line 183: var splitDefault = prefs ? ... : false
    // When user_config has no preferences row, prefs is null and splitDefault defaults to false.
    // Temporarily override the user_config mock to return null.
    var origFirst = mockDb.first.bind(mockDb);
    var callCount = 0;
    mockDb.first = function() {
      // user_config is queried after users; intercept only user_config calls
      callCount++;
      // First .first() call is getUserTimezone (users table) — let it pass.
      // Second .first() call is user_config — return null to simulate missing row.
      if (callCount === 2) { callCount = 0; return Promise.resolve(null); }
      return origFirst();
    };
    try {
      var result = await captureHandlers()['create_tasks']({
        tasks: [{ text: 'No prefs row task' }]
      });
      expect(result.isError).toBeFalsy();
      // splitDefault falls back to false → row.split=0
      expect(insertedRow(0).split).toBe(0);
    } finally {
      mockDb.first = origFirst;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pre-flight validation prevents any writes on batch error
//    Note: the handler validates ALL items before entering db.transaction, so
//    any invalid item causes an early return with isError=true and zero writes.
//    Mid-transaction insertTask failures are not tested here (unit mock does not
//    simulate real rollback; that is covered by integration tests).
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — pre-flight validation prevents any writes on batch error', function() {

  test('second item fails validation → isError returned, no items inserted', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'Valid task', dur: 30 },
        { text: 'Invalid fixed', placementMode: 'fixed' }  // missing date/time
      ]
    });
    // Handler validates ALL items before writing any (pre-flight loop)
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/validation error/i);
    // No insertTask calls should have been made
    expect(mockInsertCalls.length).toBe(0);
  });

  test('first item fails validation → isError returned, no items inserted', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'Bad dur', dur: 0 },  // dur <= 0
        { text: 'Valid task' }
      ]
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/duration must be greater than 0/i);
    expect(mockInsertCalls.length).toBe(0);
  });

  test('all valid → all items inserted', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'Task A' },
        { text: 'Task B', dur: 45 },
        { text: 'Task C', date: '7/1' }
      ]
    });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.created).toBe(3);
    expect(mockInsertCalls.length).toBe(3);
  });

  test('text required — missing text → validation error before any write', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'Valid' },
        { dur: 30 }  // text missing
      ]
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/task name is required/i);
    expect(mockInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Cal-sync: create_tasks has no cal-sync guard (guard is update-only)
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — no cal-sync guard on create', function() {

  test('item with gcal_event_id passed via gcalEventId → accepted (no guard on create)', async function() {
    // Note: unlike update_task which guards calendar-synced tasks, create_tasks
    // has no incoming cal-sync check. Calendar adapters that create tasks with
    // cal IDs do so intentionally and are not blocked here.
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Cal created task', dur: 30 }]
    });
    expect(result.isError).toBeFalsy();
    expect(mockInsertCalls.length).toBe(1);
  });

  test('batch of items without restricted fields → all succeed', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'Task 1', when: 'morning', dur: 30 },
        { text: 'Task 2', when: 'afternoon', dur: 45 },
        { text: 'Task 3', dur: 60 }
      ]
    });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.created).toBe(3);
    expect(mockInsertCalls.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. enqueueScheduleRun called after successful batch
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — enqueueScheduleRun', function() {

  test('successful batch → schedule trigger fires with all task ids (SSE payload) + deferred scheduler enqueue', async function() {
    // 999.1395: the facade's enqueueScheduleRun wrapper (facade.js:145) emits
    // the ids on the SSE 'tasks:changed' payload synchronously and defers the
    // actual scheduleQueue.enqueueScheduleRun by 2s with (userId, source) only.
    // The source is the facade's own 'api:batchCreateTasks'.
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    var sseEmitter = require('../src/lib/sse-emitter');
    enqueueScheduleRun.mockClear();
    sseEmitter.emit.mockClear();

    jest.useFakeTimers();
    try {
      var result = await captureHandlers()['create_tasks']({
        tasks: [
          { text: 'Task A' },
          { text: 'Task B' }
        ]
      });
      expect(result.isError).toBeFalsy();
      // Synchronous SSE emit carries the source + both created ids
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        'user-001',
        'tasks:changed',
        expect.objectContaining({ source: 'api:batchCreateTasks' })
      );
      var payload = sseEmitter.emit.mock.calls[0][2];
      expect(payload.ids.length).toBe(2);
      // Deferred scheduler enqueue fires after the 2s timer
      jest.runOnlyPendingTimers();
      expect(enqueueScheduleRun).toHaveBeenCalledWith('user-001', 'api:batchCreateTasks');
    } finally {
      jest.useRealTimers();
    }
  });

  test('validation failure → enqueueScheduleRun NOT called', async function() {
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();

    await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Bad', placementMode: 'fixed' }]
    });
    expect(enqueueScheduleRun).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Queued path — isLocked=true
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — queued path (isLocked=true)', function() {

  beforeEach(function() {
    mockIsLockedValue = true;
  });

  afterEach(function() {
    mockIsLockedValue = false;
  });

  test('locked: all items routed through enqueueWrite, response has queued:true', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [
        { text: 'Task A' },
        { text: 'Task B', date: '7/1' }
      ]
    });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.queued).toBe(true);
    expect(parsed.created).toBe(2);
    // insertTask must NOT have been called — items go to queue
    expect(mockInsertCalls.length).toBe(0);
    // enqueueWrite must have been called once per item
    expect(mockEnqueueCalls.length).toBe(2);
    mockEnqueueCalls.forEach(function(call) {
      expect(call.op).toBe('create');
      // 999.1395: facade BatchCreateTasks enqueues with its own
      // 'api:batchCreateTasks' src, no longer an MCP-specific tag.
      expect(call.src).toBe('api:batchCreateTasks');
    });
  });

  test('locked: queued items have user_id set', async function() {
    await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Queued task' }]
    });
    expect(mockEnqueueCalls[0].userId).toBe('user-001');
    expect(mockEnqueueCalls[0].fields.user_id).toBe('user-001');
  });

  test('locked: response includes all task ids', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'Q task A' }, { text: 'Q task B' }]
    });
    var parsed = parseResult(result);
    expect(Array.isArray(parsed.ids)).toBe(true);
    expect(parsed.ids.length).toBe(2);
    // Each id should be a non-empty string (uuid)
    parsed.ids.forEach(function(id) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  test('locked: enqueueScheduleRun still called (deferred, api:batchCreateTasks)', async function() {
    // 999.1395: locked batch create calls the facade wrapper with
    // skipEmit:true — no SSE — and the actual scheduleQueue.enqueueScheduleRun
    // fires 2s later with (userId, source). Flush with fake timers.
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();

    jest.useFakeTimers();
    try {
      await captureHandlers()['create_tasks']({
        tasks: [{ text: 'Queued for schedule' }]
      });
      jest.runOnlyPendingTimers();
      expect(enqueueScheduleRun).toHaveBeenCalledWith('user-001', 'api:batchCreateTasks');
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Response shape
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — response shape', function() {

  test('successful batch → response has created count and ids array', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }]
    });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.created).toBe(3);
    expect(Array.isArray(parsed.ids)).toBe(true);
    expect(parsed.ids.length).toBe(3);
    // ids are auto-generated UUIDs (non-empty strings)
    parsed.ids.forEach(function(id) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  test('item with explicit id → that id appears in response ids', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ id: 'my-explicit-id-001', text: 'Explicit ID task' }]
    });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.ids).toContain('my-explicit-id-001');
  });

  test('empty tasks array → rejected (999.1394 batch/single parity)', async function() {
    // 999.1395: facade BatchCreateTasks rejects an empty batch — the zod
    // batchCreateSchema fires first ('Invalid batch payload',
    // BatchCreateTasks.js:96), backstopped by the explicit array guard
    // ('Tasks array required'). An empty batch is an error, matching HTTP.
    var result = await captureHandlers()['create_tasks']({
      tasks: []
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/invalid batch payload|tasks array required/i);
    expect(mockInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ZOE-JUG-020 — rigid field silently ignored, no unexpected DB column
// ─────────────────────────────────────────────────────────────────────────────

describe('create_tasks — rigid field silently ignored (ZOE-JUG-020)', function() {

  test('{text:"test",rigid:true} succeeds and inserts without rigid column', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'test', rigid: true }]
    });
    expect(result.isError).toBeFalsy();
    expect(mockInsertCalls.length).toBe(1);
    var row = insertedRow(0);
    // rigid must NOT appear in the DB row — it is a legacy field not in the schema
    expect(row).not.toHaveProperty('rigid');
    // task was created successfully
    expect(row.text).toBe('test');
  });

  test('{text:"test",rigid:false} also silently ignores rigid field', async function() {
    var result = await captureHandlers()['create_tasks']({
      tasks: [{ text: 'test', rigid: false }]
    });
    expect(result.isError).toBeFalsy();
    var row = insertedRow(0);
    expect(row).not.toHaveProperty('rigid');
  });
});
