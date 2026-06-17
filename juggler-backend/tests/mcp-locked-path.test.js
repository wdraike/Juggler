/**
 * ZOE-JUG-026 — Locked-path (isLocked=true) tests for MCP create/update/batch_update handlers
 *
 * When a task has isLocked=true, MCP handlers route through enqueueWrite
 * (task-write-queue.js) instead of calling the DB directly. This file tests
 * that routing for all three handlers:
 *
 *   1. create_task locked → enqueueWrite called, insertTask NOT called, queued:true in response
 *   2. update_task locked (scheduling fields) → enqueueWrite called, queued:true in response
 *   3. update_task locked (non-scheduling fields only) → direct write, enqueueWrite NOT called, queued:true
 *   4. batch_update_tasks locked → enqueueWrite called per task (scheduling fields), db.transaction NOT called
 *   5. Mock resets between tests — assertions do not bleed across tests
 *
 * Uses a fully in-memory mock DB — no real DB connection required.
 * Variable naming: variables accessed inside jest.mock() factories must start
 * with "mock" (case insensitive) per Jest's module factory scoping rule.
 */

'use strict';

// ── Captured call state ───────────────────────────────────────────────────────
// Named with "mock" prefix so jest.mock() factories can reference them.

var mockInsertCalls = [];        // all insertTask calls: { row }
var mockWriteCalls = [];         // all updateTaskById calls: { id, row }
var mockEnqueueCalls = [];       // all enqueueWrite calls: { userId, taskId, op, fields, src }
var mockTransactionCalls = 0;    // count of db.transaction() invocations
var mockIsLockedValue = true;    // ALL tests in this file use isLocked=true

function resetCaptures() {
  mockInsertCalls = [];
  mockWriteCalls = [];
  mockEnqueueCalls = [];
  mockTransactionCalls = 0;
  // mockIsLockedValue stays true for all tests in this file
}

// ── Task row factory ──────────────────────────────────────────────────────────

function makeTask(overrides) {
  return Object.assign({
    id: 'task-001',
    user_id: 'user-001',
    task_type: 'task',
    text: 'Test task',
    dur: 30,
    pri: 'P3',
    status: '',
    scheduled_at: null,
    desired_at: null,
    tz: null,
    deadline: null,
    earliest_start_at: null,
    location: '[]',
    tools: '[]',
    when: null,
    day_req: null,
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
    split: null,
    split_min: null,
    time_remaining: null,
    time_flex: null,
    master_id: null,
    project: null,
    section: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00'
  }, overrides);
}

// ── In-memory task store ──────────────────────────────────────────────────────

var taskStore = {};

function resetStore(overrides) {
  taskStore = {};
  taskStore['task-001'] = makeTask(overrides);
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

  db.fn = { now: function() { return new Date('2026-01-01T00:00:00.000Z'); } };
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
  db.transaction = function(cb) {
    mockTransactionCalls++;
    return cb(db);
  };

  function resolve() {
    var t = _table;
    var w = _where;
    if (t === 'users') {
      return [{ id: w.id || 'user-001', timezone: 'America/New_York' }];
    }
    if (t === 'user_config') {
      return [{ config_key: 'preferences', config_value: JSON.stringify({ splitDefault: false }) }];
    }
    if (t === 'projects' || t === 'task_masters' || t === 'sync_locks') { return []; }
    if (t === 'tasks_v' || t === 'tasks_with_sync_v') {
      var id  = w.id;
      var uid = w.user_id;
      if (!id && uid) {
        return Object.values(taskStore).filter(function(r) { return r.user_id === uid; });
      }
      var row = id ? taskStore[id] : null;
      if (!row) return [];
      if (uid !== undefined && row.user_id !== uid) return [];
      return [row];
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
  db.then = function(res, rej) { return Promise.resolve(resolve()).then(res, rej); };

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
    updateTaskById: function(_db, id, row) {
      mockWriteCalls.push({ id: id, row: Object.assign({}, row) });
      return Promise.resolve();
    },
    deleteTaskById: function() { return Promise.resolve(); }
  };
});

jest.mock('../src/scheduler/scheduleQueue', function() {
  return { enqueueScheduleRun: jest.fn() };
});

jest.mock('../src/lib/task-write-queue', function() {
  // Inline splitFields — mirrors the production NON_SCHEDULING_FIELDS set exactly.
  // (Cannot use jest.requireActual here because task-write-queue requires @raike/lib-logger
  // which is not available in the test environment without the full logger mock chain.)
  var NON_SCHEDULING = new Set(['text', 'notes', 'project', 'section',
    'gcal_event_id', 'msft_event_id', 'tz', 'updated_at']);
  function splitFields(row) {
    var scheduling = {};
    var nonScheduling = {};
    Object.keys(row).forEach(function(k) {
      if (NON_SCHEDULING.has(k)) { nonScheduling[k] = row[k]; }
      else { scheduling[k] = row[k]; }
    });
    return { schedulingFields: scheduling, nonSchedulingFields: nonScheduling };
  }
  return {
    isLocked: function() { return Promise.resolve(mockIsLockedValue); },
    enqueueWrite: function(userId, taskId, op, fields, src) {
      mockEnqueueCalls.push({ userId: userId, taskId: taskId, op: op, fields: fields, src: src });
      return Promise.resolve();
    },
    splitFields: splitFields
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseResult(result) {
  if (!result || !result.content || !result.content[0]) return null;
  try { return JSON.parse(result.content[0].text); } catch (e) { return result.content[0].text; }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(function() {
  resetStore();
  resetCaptures();
});

// =============================================================================
// 1. create_task — locked path
// =============================================================================

describe('create_task — locked path (isLocked=true)', function() {

  test('enqueueWrite is called with op=create and src=mcp:create_task', async function() {
    var result = await captureHandlers()['create_task']({ text: 'New locked task' });
    expect(result.isError).toBeFalsy();
    expect(mockEnqueueCalls.length).toBe(1);
    expect(mockEnqueueCalls[0].op).toBe('create');
    expect(mockEnqueueCalls[0].src).toBe('mcp:create_task');
    expect(mockEnqueueCalls[0].userId).toBe('user-001');
  });

  test('insertTask is NOT called when locked', async function() {
    await captureHandlers()['create_task']({ text: 'Locked — no insert' });
    expect(mockInsertCalls.length).toBe(0);
  });

  test('response has queued:true', async function() {
    var result = await captureHandlers()['create_task']({ text: 'Queued task' });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.queued).toBe(true);
  });

  test('enqueueWrite fields include user_id', async function() {
    await captureHandlers()['create_task']({ text: 'User id check' });
    var call = mockEnqueueCalls[0];
    expect(call).toBeDefined();
    expect(call.fields.user_id).toBe('user-001');
  });

  test('enqueueWrite receives a non-empty taskId (auto-generated uuid)', async function() {
    await captureHandlers()['create_task']({ text: 'UUID task' });
    var call = mockEnqueueCalls[0];
    expect(call).toBeDefined();
    expect(typeof call.taskId).toBe('string');
    expect(call.taskId.length).toBeGreaterThan(0);
  });

  test('explicit id passed to create_task → that id is used in enqueueWrite', async function() {
    await captureHandlers()['create_task']({ id: 'explicit-id-001', text: 'Explicit id task' });
    var call = mockEnqueueCalls[0];
    expect(call).toBeDefined();
    expect(call.taskId).toBe('explicit-id-001');
  });

  test('enqueueScheduleRun is still called when locked', async function() {
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();
    await captureHandlers()['create_task']({ text: 'Schedule run on locked create' });
    expect(enqueueScheduleRun).toHaveBeenCalledWith(
      'user-001',
      'mcp:create_task',
      expect.arrayContaining([expect.any(String)])
    );
  });

  test('db.transaction is NOT invoked when locked', async function() {
    // create_task uses insertTask directly (not inside a transaction),
    // so transaction count stays 0 in both locked and unlocked paths.
    // We verify it is not called in the locked path regardless.
    await captureHandlers()['create_task']({ text: 'No transaction' });
    expect(mockTransactionCalls).toBe(0);
  });
});

// =============================================================================
// 2. update_task — locked path (scheduling fields → enqueueWrite)
// =============================================================================

describe('update_task — locked path, scheduling fields', function() {

  test('scheduling field (dur) → enqueueWrite called, not a direct write', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', dur: 60 });
    expect(result.isError).toBeFalsy();
    // dur is a scheduling field → must appear in enqueue, not in direct write
    var eq = mockEnqueueCalls.find(function(e) { return e.taskId === 'task-001'; });
    expect(eq).toBeDefined();
    expect(eq.op).toBe('update');
    expect(eq.src).toBe('mcp:update_task');
    expect(eq.fields.dur).toBe(60);
    // ZOE-JUG-023-W2: taskToRow unconditionally sets updated_at (non-scheduling).
    // splitFields always produces a non-empty nonSchedulingFields for the timestamp,
    // so updateTaskById IS called exactly once — but only with { updated_at }.
    // dur must NOT appear in the direct write.
    expect(mockWriteCalls.length).toBe(1);
    expect(mockWriteCalls[0].row.dur).toBeUndefined();
  });

  test('scheduling field update → response has queued:true', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', dur: 45 });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.queued).toBe(true);
  });

  test('scheduling field (placement_mode via placementMode) → enqueued with correct value', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'time_window' });
    var eq = mockEnqueueCalls.find(function(e) { return e.taskId === 'task-001'; });
    expect(eq).toBeDefined();
    expect(eq.fields.placement_mode).toBe('time_window');
  });

  test('enqueueScheduleRun is still called in locked update path', async function() {
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();
    await captureHandlers()['update_task']({ id: 'task-001', dur: 30 });
    expect(enqueueScheduleRun).toHaveBeenCalledWith('user-001', 'mcp:update_task', ['task-001']);
  });
});

// =============================================================================
// 3. update_task — locked path, non-scheduling fields → direct write, not queued
// =============================================================================

describe('update_task — locked path, non-scheduling fields', function() {

  test('text (non-scheduling) → direct updateTaskById called, enqueueWrite NOT called at all', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', text: 'Only text change' });
    // text must appear in a direct write
    var directWrite = mockWriteCalls.find(function(c) { return c.id === 'task-001' && c.row.text === 'Only text change'; });
    expect(directWrite).toBeDefined();
    // text-only update → splitFields produces empty schedulingFields → enqueueWrite is skipped entirely
    expect(mockEnqueueCalls.length).toBe(0);
  });

  test('notes (non-scheduling) → direct write, response still has queued:true', async function() {
    // The handler always returns queued:true on the locked path, even if only
    // non-scheduling fields were provided (enqueueScheduleRun still fired).
    var result = await captureHandlers()['update_task']({ id: 'task-001', notes: 'A note' });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.queued).toBe(true);
    var directWrite = mockWriteCalls.find(function(c) { return c.id === 'task-001' && c.row.notes === 'A note'; });
    expect(directWrite).toBeDefined();
  });

  test('task not found → isError even when locked', async function() {
    var result = await captureHandlers()['update_task']({ id: 'ghost-999', text: 'Ghost' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found/i);
    expect(mockEnqueueCalls.length).toBe(0);
  });
});

// =============================================================================
// 4. batch_update_tasks — locked path
// =============================================================================

describe('batch_update_tasks — locked path (isLocked=true)', function() {

  beforeEach(function() {
    // Populate task store with additional tasks for batch tests
    taskStore['task-002'] = makeTask({ id: 'task-002', user_id: 'user-001', text: 'Task two' });
    taskStore['task-003'] = makeTask({ id: 'task-003', user_id: 'user-001', text: 'Task three' });
  });

  test('scheduling fields → enqueueWrite called once per task, db.transaction NOT called', async function() {
    var result = await captureHandlers()['batch_update_tasks']({
      updates: [
        { id: 'task-001', dur: 45 },
        { id: 'task-002', dur: 60 }
      ]
    });
    expect(result.isError).toBeFalsy();
    // enqueueWrite called for each task (scheduling field: dur)
    var enqueuedIds = mockEnqueueCalls.map(function(e) { return e.taskId; });
    expect(enqueuedIds).toContain('task-001');
    expect(enqueuedIds).toContain('task-002');
    expect(mockEnqueueCalls.length).toBe(2);
    // db.transaction must NOT have been called — locked path bypasses it
    expect(mockTransactionCalls).toBe(0);
  });

  test('all enqueue calls have op=update and src=mcp:batch_update_tasks', async function() {
    await captureHandlers()['batch_update_tasks']({
      updates: [
        { id: 'task-001', dur: 30 },
        { id: 'task-002', pri: 'P1' }
      ]
    });
    mockEnqueueCalls.forEach(function(call) {
      expect(call.op).toBe('update');
      expect(call.src).toBe('mcp:batch_update_tasks');
    });
  });

  test('response contains queued count for scheduling fields', async function() {
    var result = await captureHandlers()['batch_update_tasks']({
      updates: [
        { id: 'task-001', dur: 45 },
        { id: 'task-002', dur: 60 },
        { id: 'task-003', dur: 75 }
      ]
    });
    expect(result.isError).toBeFalsy();
    var parsed = parseResult(result);
    expect(parsed.queued).toBe(3);
  });

  test('non-scheduling fields in batch → direct write per task, no enqueue for those fields', async function() {
    var result = await captureHandlers()['batch_update_tasks']({
      updates: [
        { id: 'task-001', text: 'Updated text only' },
        { id: 'task-002', notes: 'A batch note' }
      ]
    });
    expect(result.isError).toBeFalsy();
    // Direct writes must have happened for non-scheduling fields
    var textWrite = mockWriteCalls.find(function(c) { return c.id === 'task-001' && c.row.text === 'Updated text only'; });
    expect(textWrite).toBeDefined();
    var notesWrite = mockWriteCalls.find(function(c) { return c.id === 'task-002' && c.row.notes === 'A batch note'; });
    expect(notesWrite).toBeDefined();
    // enqueueWrite must NOT have been called (text and notes are non-scheduling)
    expect(mockEnqueueCalls.length).toBe(0);
    // Still no transaction
    expect(mockTransactionCalls).toBe(0);
  });

  test('mixed batch: scheduling + non-scheduling fields → both paths fire correctly', async function() {
    var result = await captureHandlers()['batch_update_tasks']({
      updates: [
        { id: 'task-001', text: 'Text change', dur: 90 }
      ]
    });
    expect(result.isError).toBeFalsy();
    // Non-scheduling (text) → direct write
    var textWrite = mockWriteCalls.find(function(c) { return c.id === 'task-001' && c.row.text === 'Text change'; });
    expect(textWrite).toBeDefined();
    // Scheduling (dur) → enqueueWrite
    var eq = mockEnqueueCalls.find(function(e) { return e.taskId === 'task-001'; });
    expect(eq).toBeDefined();
    expect(eq.fields.dur).toBe(90);
    // Transaction still not called
    expect(mockTransactionCalls).toBe(0);
  });

  test('enqueueScheduleRun is called for all task ids in the locked batch path', async function() {
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();

    await captureHandlers()['batch_update_tasks']({
      updates: [
        { id: 'task-001', dur: 30 },
        { id: 'task-002', dur: 45 }
      ]
    });
    expect(enqueueScheduleRun).toHaveBeenCalledWith(
      'user-001',
      'mcp:batch_update_tasks',
      expect.arrayContaining(['task-001', 'task-002'])
    );
  });

  test('unknown task id in batch → skipped (existById guard), no enqueue for missing id', async function() {
    var result = await captureHandlers()['batch_update_tasks']({
      updates: [
        { id: 'task-001', dur: 30 },
        { id: 'does-not-exist', dur: 45 }
      ]
    });
    expect(result.isError).toBeFalsy();
    // Only task-001 should have been enqueued
    var enqueueIds = mockEnqueueCalls.map(function(e) { return e.taskId; });
    expect(enqueueIds).toContain('task-001');
    expect(enqueueIds).not.toContain('does-not-exist');
  });
});

// =============================================================================
// 5. Mock isolation — assertions do not bleed across tests
// =============================================================================

describe('mock isolation — resets between tests', function() {

  test('first test: one create_task locked call → one enqueue', async function() {
    await captureHandlers()['create_task']({ text: 'Isolation test A' });
    expect(mockEnqueueCalls.length).toBe(1);
    expect(mockInsertCalls.length).toBe(0);
  });

  test('second test: captures are clean (no bleed from prior test)', async function() {
    // beforeEach calls resetCaptures() so these start at 0
    expect(mockEnqueueCalls.length).toBe(0);
    expect(mockInsertCalls.length).toBe(0);
    expect(mockWriteCalls.length).toBe(0);
    expect(mockTransactionCalls).toBe(0);
  });

  test('third test: update_task enqueue count is exactly 1 per call', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', dur: 45 });
    // One scheduling field → one enqueue call
    expect(mockEnqueueCalls.length).toBe(1);
  });
});
