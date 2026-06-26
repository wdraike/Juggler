/**
 * Regression tests — BUG-867 + BUG-875: fixed+recurring XOR enforcement
 *
 * THE INVARIANT: a task may be FIXED (placementMode='fixed') OR RECURRING
 * (recurring=true) but NEVER both. Partial PATCHes that omit one side of the
 * XOR while the OTHER side comes from the existing DB row must still be caught.
 *
 * Pre-fix expected outcomes (confirm RED/GREEN before any fix is applied):
 *   BUG-867a — validateTaskInput guards same-request combo  → GREEN (already exists)
 *   BUG-867b — HTTP update_task recurring→fixed flip         → RED  (not caught)
 *   BUG-867c — HTTP update_task fixed→recurring flip         → RED  (not caught)
 *   BUG-867d — data import inserts fixed+recurring task      → RED  (no validation)
 *   BUG-875a — MCP update_task recurring→fixed flip          → RED  (not caught)
 *   BUG-875b — MCP update_task fixed→recurring flip          → RED  (not caught)
 *   OK-legal-* — legal combos must NOT be over-rejected      → GREEN (no regression)
 *
 * Traceability: .planning/kermit/999.867/TRACEABILITY.md
 */

'use strict';

// ── Mock DB task store (must be declared before jest.mock factories) ──────────
// Variables referenced inside jest.mock() factories MUST start with "mock".

var mockTaskStore = {};
var mockWriteCalls = [];
var mockIsLockedResult = false;

function resetMockTaskStore(overrides) {
  mockTaskStore = {};
  mockTaskStore['task-001'] = makeBaseTaskRow(Object.assign({
    id: 'task-001',
    user_id: 'user-001',
  }, overrides || {}));
}

// Forward declaration — defined below after jest mocks are set up.
function makeBaseTaskRow(overrides) {
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
    start_after_at: null,
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
    project: null,
    section: null,
    cal_sync_origin: null,
    rigid: 0,
    recur_start: null,
    recur_end: null,
    disabled_at: null,
    disabled_reason: null,
    prev_when: null,
    date_pinned: 0,
    preferred_time_mins: null,
    unscheduled: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  }, overrides);
}

// ── In-memory mock DB (same pattern as mcp-update-task.test.js) ───────────────

var mockDb = (function () {
  var _table = null;
  var _where = {};

  function db(tableName) {
    _table = tableName;
    _where = {};
    return db;
  }

  db.fn = { now: function () { return 'MOCK_NOW'; } };
  db.raw = function () { return Promise.resolve([[], []]); };
  db.where = function (condOrField, val) {
    if (typeof condOrField === 'object' && condOrField !== null) {
      Object.assign(_where, condOrField);
    } else if (typeof condOrField === 'function') {
      // complex builder — ignored
    } else if (typeof condOrField === 'string' && val !== undefined) {
      _where[condOrField] = val;
    }
    return db;
  };
  db.whereIn    = function () { return db; };
  db.whereRaw   = function () { return db; };
  db.whereNot   = function () { return db; };
  db.whereNull  = function () { return db; };
  db.orWhere    = function () { return db; };
  db.orWhereNull = function () { return db; };
  db.orderBy    = function () { return db; };
  db.orderByRaw = function () { return db; };
  db.limit      = function () { return db; };
  db.insert     = function () { return Promise.resolve([1]); };
  db.update     = function () { return Promise.resolve(1); };
  db.del        = function () { return Promise.resolve(1); };
  db.catch      = function (fn) { return Promise.resolve([]).catch(fn); };
  db.transaction = function (cb) { return cb(db); };

  function resolve() {
    var t = _table;
    var w = _where;
    if (t === 'users') {
      return [{ id: 'user-001', timezone: 'America/New_York' }];
    }
    if (t === 'user_config') {
      return [{ config_key: 'preferences', config_value: JSON.stringify({ splitDefault: false }) }];
    }
    if (t === 'projects' || t === 'task_masters' || t === 'sync_locks') { return []; }
    // cal_sync_ledger: task is "calendar-born" when it has an external event id
    if (t === 'cal_sync_ledger') {
      var ledgerTaskId = w.task_id;
      var ledgerTask = ledgerTaskId ? mockTaskStore[ledgerTaskId] : null;
      if (ledgerTask && (ledgerTask.gcal_event_id || ledgerTask.msft_event_id || ledgerTask.apple_event_id)) {
        var origin = ledgerTask.gcal_event_id ? 'gcal' : (ledgerTask.msft_event_id ? 'msft' : 'apple');
        return [{ task_id: ledgerTaskId, origin: origin, status: 'active' }];
      }
      return [];
    }
    if (t === 'tasks_v' || t === 'tasks_with_sync_v') {
      var id = w.id;
      var uid = w.user_id;
      if (!id && uid) {
        return Object.values(mockTaskStore).filter(function (r) { return r.user_id === uid; });
      }
      var row = id ? mockTaskStore[id] : null;
      if (!row) return [];
      if (uid !== undefined && row.user_id !== uid) return [];
      return [row];
    }
    return [];
  }

  db.first = function () {
    var rows = resolve();
    return Promise.resolve(rows.length > 0 ? rows[0] : null);
  };
  db.distinct = function () {
    return Promise.resolve(resolve().map(function (r) { return { task_id: r.task_id }; }));
  };
  db.select = function () {
    var rows = resolve();
    var p = Promise.resolve(rows);
    p.first = function () { return Promise.resolve(rows.length > 0 ? rows[0] : null); };
    return p;
  };
  db.then = function (res, rej) { return Promise.resolve(resolve()).then(res, rej); };

  return db;
})();

// ── Jest mocks (must be top-level, before any require of the mocked modules) ──

jest.mock('../src/db', function () { return mockDb; });

jest.mock('../src/lib/tasks-write', function () {
  return {
    insertTask: function () { return Promise.resolve(); },
    updateTaskById: function (_db, id, row) {
      mockWriteCalls.push({ id: id, row: row });
      return Promise.resolve();
    },
    deleteTaskById: function () { return Promise.resolve(); },
  };
});

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn() };
});

jest.mock('../src/lib/task-write-queue', function () {
  // Inline splitFields — mirrors production NON_SCHEDULING_FIELDS set.
  var NON_SCHEDULING = new Set(['text', 'notes', 'project', 'section',
    'gcal_event_id', 'msft_event_id', 'tz', 'updated_at']);
  function splitFields(row) {
    var scheduling = {};
    var nonScheduling = {};
    Object.keys(row).forEach(function (k) {
      if (NON_SCHEDULING.has(k)) { nonScheduling[k] = row[k]; }
      else { scheduling[k] = row[k]; }
    });
    return { schedulingFields: scheduling, nonSchedulingFields: nonScheduling };
  }
  return {
    isLocked: function () { return Promise.resolve(mockIsLockedResult); },
    enqueueWrite: function () { return Promise.resolve(); },
    splitFields: splitFields,
  };
});

jest.mock('../src/lib/sse-emitter', function () {
  return { emitTasksChanged: jest.fn() };
});

// ── Imports (after mocks are declared) ────────────────────────────────────────

var validation = require('../src/slices/task/domain/validation/taskValidation');
var validateTaskInput = validation.validateTaskInput;
var realMappers = require('../src/slices/task/domain/mappers/taskMappers');
var realValidation = validation;
var UpdateTask = require('../src/slices/task/application/commands/UpdateTask');
var ImportData = require('../src/slices/user-config/application/commands/ImportData');
var PLACEMENT_MODES = require('../src/lib/placementModes').PLACEMENT_MODES;
var registerTaskTools = require('../src/mcp/tools/tasks').registerTaskTools;

// ── Test doubles ──────────────────────────────────────────────────────────────

/**
 * Build a minimal UpdateTask deps object with all collaborators mocked.
 * Uses the REAL domain validation and mappers so validation code is exercised.
 */
function makeUpdateTaskDeps(existingTask) {
  return {
    repo: {
      fetchTaskWithEventIds: jest.fn().mockResolvedValue(existingTask),
      fetchTaskRecurring: jest.fn().mockResolvedValue(existingTask),
      updateTaskById: jest.fn().mockResolvedValue(1),
      getRecurringTemplateRows: jest.fn().mockResolvedValue([]),
      expandToAllInstanceIds: jest.fn().mockResolvedValue([existingTask.id]),
      fetchOneShottedInstanceId: jest.fn().mockResolvedValue(null),
      getUserSplitPreference: jest.fn().mockResolvedValue(null),
      runInTransaction: jest.fn().mockImplementation(async function (cb) {
        var trxRepo = { updateTaskById: jest.fn().mockResolvedValue(1) };
        return cb(trxRepo);
      }),
    },
    cache: { invalidateTasks: jest.fn().mockResolvedValue() },
    events: { publishTaskUpdated: jest.fn(), publishTaskCreated: jest.fn() },
    enqueueScheduleRun: jest.fn(),
    mappers: realMappers,
    validation: realValidation,
    validateReferences: jest.fn().mockResolvedValue([]),
    hasSchedulingFields: jest.fn().mockReturnValue(false),
    splitFieldsLib: {
      splitFields: jest.fn().mockReturnValue({ schedulingFields: {}, nonSchedulingFields: {} }),
    },
    projects: { ensureProject: jest.fn().mockResolvedValue() },
    isLocked: jest.fn().mockResolvedValue(false),
    enqueueWrite: jest.fn().mockResolvedValue(),
    safeTimezone: jest.fn().mockReturnValue('America/New_York'),
    dateHelpers: {
      utcToLocal: jest.fn().mockReturnValue(null),
      localToUtc: jest.fn().mockReturnValue(null),
    },
    placementModes: PLACEMENT_MODES,
    recurCleanup: jest.fn().mockResolvedValue(),
  };
}

/** Capture all tool handlers from registerTaskTools using a fake server. */
function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = {
    tool: function (name, _description, _schema, handler) {
      handlers[name] = handler;
    },
  };
  registerTaskTools(fakeServer, userId || 'user-001');
  return handlers;
}

// ── Global setup ──────────────────────────────────────────────────────────────

beforeEach(function () {
  resetMockTaskStore();
  mockWriteCalls = [];
  mockIsLockedResult = false;
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-867a — create_task: same-request fixed+recurring body → REJECTED
// Expected: GREEN on current code (validateTaskInput already has this guard).
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-867a — create_task combined fixed+recurring in one body', function () {

  test('BUG-867a: validateTaskInput({placementMode:"fixed", recurring:true}) returns ["invalid_combination"]', function () {
    var errors = validateTaskInput({
      text: 'Test task',
      placementMode: 'fixed',
      date: '2026-07-01',
      time: '9:00 AM',
      recurring: true,
    });
    expect(errors).toEqual(['invalid_combination']);
  });

  test('BUG-867a: error is the SOLE element (not appended after other errors)', function () {
    // The 999.867 guard does `return ['invalid_combination']` (early return),
    // so no other validation errors are appended. Confirm the array length is exactly 1.
    var errors = validateTaskInput({
      text: 'Task',
      placementMode: 'fixed',
      date: '2026-07-01',
      time: '9:00 AM',
      recurring: true,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('invalid_combination');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-867b — HTTP update_task: existing RECURRING task + PATCH {placementMode:'fixed'}
// recurring field OMITTED from body → must be REJECTED.
// Expected: RED on current code (partial PATCH bypasses the body-only XOR guard).
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-867b — HTTP update_task: recurring→fixed flip (recurring omitted)', function () {

  test('BUG-867b: UpdateTask.execute on RECURRING task with {placementMode:"fixed", date, time} body (no "recurring" key) → status 400', async function () {
    var existingRecurring = makeBaseTaskRow({
      id: 'task-recur-1',
      task_type: 'recurring_template',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
    });
    var deps = makeUpdateTaskDeps(existingRecurring);
    var cmd = new UpdateTask(deps);

    // PATCH body: placementMode='fixed' + scheduling info, but NO 'recurring' key.
    // The existing row IS recurring. After the fix, merged state = fixed+recurring → rejected.
    // On current code: body.recurring is undefined → body-only XOR check doesn't fire → 200 returned.
    var result = await cmd.execute({
      id: 'task-recur-1',
      userId: 'user-001',
      body: { placementMode: 'fixed', date: '2026-07-01', time: '9:00 AM' },
    });

    // This assertion FAILS on current (unfixed) code → RED.
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid_combination|cannot.*fixed.*recurring|recurring.*fixed/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-867c — HTTP update_task: existing FIXED task + PATCH {recurring:true, recur:{...}}
// placementMode field OMITTED from body → must be REJECTED.
// Expected: RED on current code (partial PATCH bypasses the body-only XOR guard).
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-867c — HTTP update_task: fixed→recurring flip (placementMode omitted)', function () {

  test('BUG-867c: UpdateTask.execute on FIXED task with {recurring:true, recur:{...}} body (no "placementMode" key) → status 400', async function () {
    var existingFixed = makeBaseTaskRow({
      id: 'task-fixed-1',
      task_type: 'task',
      recurring: 0,
      placement_mode: 'fixed',
      scheduled_at: new Date('2026-07-01T13:00:00Z'),
    });
    var deps = makeUpdateTaskDeps(existingFixed);
    var cmd = new UpdateTask(deps);

    // PATCH body: recurring=true + recur config, but NO 'placementMode' key.
    // The existing row IS fixed. After the fix, merged state = fixed+recurring → rejected.
    // On current code: body.placementMode is undefined → body-only XOR check doesn't fire → 200 returned.
    var result = await cmd.execute({
      id: 'task-fixed-1',
      userId: 'user-001',
      body: { recurring: true, recur: { type: 'daily' } },
    });

    // This assertion FAILS on current (unfixed) code → RED.
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid_combination|cannot.*fixed.*recurring|recurring.*fixed/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-867d — data import: task with BOTH placementMode:'fixed' AND recurring:true
// Expected: RED on current code (ImportData.execute has NO validateTaskInput call).
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-867d — data import inserts fixed+recurring task without validation', function () {

  test('BUG-867d: import with {placementMode:"fixed", recurring:true} task → task must NOT be inserted', async function () {
    var capturedInserts = [];

    // buildTaskRow maps the v7 import shape to a DB row (simplified mock).
    var mockBuildTaskRow = function (t) {
      return {
        id: t.id || 'gen-001',
        user_id: 'user-001',
        text: t.text || '',
        task_type: 'task',
        placement_mode: t.placementMode || null,
        recurring: t.recurring ? 1 : 0,
        recur: t.recur ? JSON.stringify(t.recur) : null,
      };
    };

    var mockInsertTask = jest.fn(function (_trxRepo, row) {
      capturedInserts.push(row);
      return Promise.resolve();
    });

    var mockRepo = {
      runInTransaction: async function (cb) {
        return cb({
          clearUserConfigTables: jest.fn().mockResolvedValue(),
          insertLocations: jest.fn().mockResolvedValue(),
          insertTools: jest.fn().mockResolvedValue(),
          insertProjects: jest.fn().mockResolvedValue(),
          insertConfigRows: jest.fn().mockResolvedValue(),
        });
      },
    };

    var cmd = new ImportData({
      repo: mockRepo,
      wipeTasks: jest.fn().mockResolvedValue(),
      insertTask: mockInsertTask,
      buildTaskRow: mockBuildTaskRow,
    });

    await cmd.execute({
      userId: 'user-001',
      confirm: 'delete_all',
      data: {
        extraTasks: [
          {
            id: 'task-bad-1',
            text: 'Fixed recurring conflict',
            placementMode: 'fixed',
            date: '2026-07-01',
            time: '9:00 AM',
            recurring: true,
            recur: { type: 'daily' },
          },
        ],
      },
    });

    // After the fix: the invalid task is rejected before insertTask is called.
    // On current code: insertTask IS called with placement_mode='fixed', recurring=1 → assertion fails → RED.
    var badInserts = capturedInserts.filter(function (r) {
      return r.placement_mode === 'fixed' && r.recurring === 1;
    });
    expect(badInserts).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-875a — MCP update_task: existing RECURRING task + PATCH {placementMode:'fixed'}
// recurring field OMITTED from body → must return isError.
// Expected: RED on current code (incoming-only validateTaskInput misses the flip).
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-875a — MCP update_task: recurring→fixed flip (recurring omitted in body)', function () {

  test('BUG-875a: mcp update_task on RECURRING task with {placementMode:"fixed", date, time} (no "recurring" key) → isError', async function () {
    // Seed a recurring template in the mock task store.
    resetMockTaskStore({
      task_type: 'recurring_template',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      placement_mode: null,
    });

    // Invoke MCP update_task handler. The PATCH body has placementMode='fixed' with
    // scheduling info but NO 'recurring' key. On current code, validateTaskInput(fields)
    // sees body.recurring===undefined and does NOT fire the XOR guard → proceeds to write.
    var result = await captureHandlers()['update_task']({
      id: 'task-001',
      placementMode: 'fixed',
      date: '2026-07-01',
      time: '9:00 AM',
    });

    // This assertion FAILS on current (unfixed) code → RED.
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/invalid_combination|cannot.*fixed.*recurring|recurring.*fixed/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-875b — MCP update_task: existing FIXED task + PATCH {recurring:true, recur:{...}}
// placementMode field OMITTED from body → must return isError.
// Expected: RED on current code (incoming-only validateTaskInput misses the flip).
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-875b — MCP update_task: fixed→recurring flip (placementMode omitted in body)', function () {

  test('BUG-875b: mcp update_task on FIXED task with {recurring:true, recur:{...}} (no "placementMode" key) → isError', async function () {
    // Seed a fixed (non-recurring) task in the mock task store.
    resetMockTaskStore({
      task_type: 'task',
      recurring: 0,
      placement_mode: 'fixed',
      scheduled_at: new Date('2026-07-01T13:00:00Z'),
    });

    // Invoke MCP update_task handler. The PATCH body has recurring=true + recur config but
    // NO 'placementMode' key. On current code, validateTaskInput(fields) sees body.placementMode
    // ===undefined and does NOT fire the XOR guard → proceeds to write.
    var result = await captureHandlers()['update_task']({
      id: 'task-001',
      recurring: true,
      recur: { type: 'daily' },
    });

    // This assertion FAILS on current (unfixed) code → RED.
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/invalid_combination|cannot.*fixed.*recurring|recurring.*fixed/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// OK-legal — over-rejection guard: legal combinations MUST NOT be rejected.
// Expected: GREEN both BEFORE and AFTER the fix.
// ─────────────────────────────────────────────────────────────────────────────

describe('OK-legal — legal fixed-only / recurring-only / non-conflicting updates are accepted', function () {

  test('OK-legal-1: validateTaskInput({placementMode:"fixed", date, time}) with no recurring → no errors', function () {
    var errors = validateTaskInput({
      text: 'Fixed task',
      placementMode: 'fixed',
      date: '2026-07-01',
      time: '9:00 AM',
    });
    expect(errors).toHaveLength(0);
  });

  test('OK-legal-2: validateTaskInput({recurring:true, recur:{type:"daily"}}) with no fixed placementMode → no errors', function () {
    var errors = validateTaskInput({
      text: 'Recurring task',
      recurring: true,
      recur: { type: 'daily' },
    });
    expect(errors).toHaveLength(0);
  });

  test('OK-legal-3: update of NON-recurring task setting {placementMode:"fixed"} → passes (not over-rejected)', async function () {
    var nonRecurring = makeBaseTaskRow({
      id: 'task-nonrecur-1',
      task_type: 'task',
      recurring: 0,
      placement_mode: null,
    });
    var deps = makeUpdateTaskDeps(nonRecurring);
    var cmd = new UpdateTask(deps);

    var result = await cmd.execute({
      id: 'task-nonrecur-1',
      userId: 'user-001',
      // PATCH: set fixed mode. Existing task is NOT recurring → no XOR conflict.
      body: { placementMode: 'fixed', date: '2026-07-01', time: '9:00 AM' },
    });

    // Must be 200 both before and after the fix.
    expect(result.status).toBe(200);
    // Strengthen: the optimistic response must reflect the patched field (zoe WARN guard).
    // A silent no-op regression would return 200 without actually applying the patch.
    expect(result.body.task).toBeDefined();
    expect(result.body.task.placementMode).toBe('fixed');
    // WARN-A pin (zoe re-review): assert the write ACTUALLY reached the repo.
    // result.body.task is an optimistic echo built from the request body — a silent
    // no-op in updateTaskById (e.g. the call removed) still echoes the correct
    // placementMode. This spy assertion proves the field reached the persistence call.
    expect(deps.repo.updateTaskById).toHaveBeenCalledWith(
      'task-nonrecur-1',
      expect.objectContaining({ placement_mode: 'fixed' }),
      'user-001'
    );
  });

  test('OK-legal-4: update of RECURRING task changing dur (no placementMode change) → passes', async function () {
    var recurring = makeBaseTaskRow({
      id: 'task-recur-2',
      task_type: 'recurring_template',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
    });
    var deps = makeUpdateTaskDeps(recurring);
    var cmd = new UpdateTask(deps);

    var result = await cmd.execute({
      id: 'task-recur-2',
      userId: 'user-001',
      // PATCH: only duration change — no placement flip.
      body: { dur: 60 },
    });

    // Must be 200 both before and after the fix.
    expect(result.status).toBe(200);
    // Strengthen: the optimistic response must reflect the patched field (zoe WARN guard).
    // A silent no-op regression would return 200 without actually applying the patch.
    expect(result.body.task).toBeDefined();
    expect(result.body.task.dur).toBe(60);
    // WARN-A pin (zoe re-review): assert the write ACTUALLY reached the repo.
    // result.body.task is an optimistic echo — a silent no-op in updateTaskById
    // still echoes dur:60. This spy assertion proves the field reached persistence.
    expect(deps.repo.updateTaskById).toHaveBeenCalledWith(
      'task-recur-2',
      expect.objectContaining({ dur: 60 }),
      'user-001'
    );
  });

  // ── OK-legal-5 (locks BLOCK-1 over-rejection) ────────────────────────────
  // Atomic convert: EXISTING RECURRING task → fixed one-off via a body that
  // includes BOTH placementMode AND recurring (both keys present → XOR check
  // skipped; recurring:false → no conflict). This legal path was BLOCKED on
  // pre-fix code because the presence-based guard had not been applied.

  test('OK-legal-5: UpdateTask on RECURRING task with {placementMode:"fixed", recurring:false, date, time} (atomic convert) → status 200, persisted as fixed+non-recurring', async function () {
    var existingRecurring = makeBaseTaskRow({
      id: 'task-recur-legal-5',
      task_type: 'recurring_template',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      placement_mode: null,
    });
    // Simulated post-write read-back: what the DB returns after the write succeeds.
    var convertedFixed = makeBaseTaskRow({
      id: 'task-recur-legal-5',
      task_type: 'task',
      recurring: 0,
      recur: null,
      placement_mode: 'fixed',
      scheduled_at: new Date('2026-07-01T13:00:00Z'),
    });
    var deps = makeUpdateTaskDeps(existingRecurring);
    // 1st fetchTaskWithEventIds call (complex path line ~204): existing state.
    // 2nd call (complex path line ~292): re-read after write.
    deps.repo.fetchTaskWithEventIds
      .mockResolvedValueOnce(existingRecurring)
      .mockResolvedValueOnce(convertedFixed);
    var cmd = new UpdateTask(deps);

    var result = await cmd.execute({
      id: 'task-recur-legal-5',
      userId: 'user-001',
      // Both keys present → XOR check skipped. recurring:false → no conflict.
      body: { placementMode: 'fixed', date: '2026-07-01', time: '9:00 AM', recurring: false },
    });

    // Must NOT be over-rejected with 400 invalid_combination.
    expect(result.status).toBe(200);
    expect(result.body.error).toBeUndefined();
    // Persisted state: fixed + non-recurring (read back from mock re-read).
    expect(result.body.task).toBeDefined();
    expect(result.body.task.placementMode).toBe('fixed');
    expect(result.body.task.recurring).toBe(false);
  });

  // ── OK-legal-6 (locks BLOCK-1 symmetric) ─────────────────────────────────
  // Atomic convert: EXISTING FIXED task → recurring via body with BOTH
  // placementMode:'anytime' (explicitly off fixed) AND recurring:true.
  // Both keys present → XOR check skipped. 'anytime' + recurring is valid.

  test('OK-legal-6: UpdateTask on FIXED task with {recurring:true, recur:{...}, placementMode:"anytime"} (atomic convert off fixed) → status 200, persisted as recurring+non-fixed', async function () {
    var existingFixed = makeBaseTaskRow({
      id: 'task-fixed-legal-6',
      task_type: 'task',
      recurring: 0,
      placement_mode: 'fixed',
      scheduled_at: new Date('2026-07-01T13:00:00Z'),
    });
    // Simulated post-write read-back.
    var convertedRecurring = makeBaseTaskRow({
      id: 'task-fixed-legal-6',
      task_type: 'recurring_template',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      placement_mode: 'anytime',
      scheduled_at: null,
    });
    var deps = makeUpdateTaskDeps(existingFixed);
    deps.repo.fetchTaskWithEventIds
      .mockResolvedValueOnce(existingFixed)
      .mockResolvedValueOnce(convertedRecurring);
    var cmd = new UpdateTask(deps);

    var result = await cmd.execute({
      id: 'task-fixed-legal-6',
      userId: 'user-001',
      // Both keys present → XOR check skipped. placementMode:'anytime' ≠ 'fixed' → no conflict.
      body: { recurring: true, recur: { type: 'daily' }, placementMode: 'anytime' },
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBeUndefined();
    // Persisted state: recurring, off fixed mode.
    expect(result.body.task).toBeDefined();
    expect(result.body.task.placementMode).toBe('anytime');
    expect(result.body.task.recurring).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-867c-fastpath — BLOCK-2 fast-path hole: BARE {recurring:true} with no
// recur key takes the FAST path (needsComplexPath=false), but the XOR check
// fires first and must read placement_mode from fetchTaskRecurring.
// Pre-fix: KnexTaskRepository.fetchTaskRecurring omitted placement_mode from
// SELECT → _xorRow.placement_mode = undefined → isFixedRecurringConflict returned
// false → forbidden combo silently accepted.
// The existing BUG-867c uses {recurring:true, recur:{...}} → complex path.
// This test pins the FAST-PATH route specifically.
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-867c-fastpath — HTTP update_task FAST PATH: bare {recurring:true} on FIXED task → REJECTED', function () {

  test('BUG-867c-fastpath: UpdateTask on FIXED task with bare {recurring:true} (no recur → fast path) → status 400 invalid_combination', async function () {
    // LOCKS BLOCK-2: fetchTaskRecurring now SELECTs placement_mode (Knex + InMemory adapters).
    // body has no recur key → needsComplexPath = false (fast path).
    // XOR check: _hasPM=false, _hasRec=true → fetches existing row via fetchTaskRecurring
    // and reads placement_mode from it. Without the fix, placement_mode was missing →
    // _effPM=undefined → no conflict detected → 200 returned (bug).
    var existingFixed = makeBaseTaskRow({
      id: 'task-fixed-fp',
      task_type: 'task',
      recurring: 0,
      placement_mode: 'fixed',
      scheduled_at: new Date('2026-07-01T13:00:00Z'),
    });
    var deps = makeUpdateTaskDeps(existingFixed);
    // fetchTaskRecurring returns the full existing row including placement_mode='fixed'
    // (simulates post-BLOCK-2 Knex + InMemory adapter behaviour).
    var cmd = new UpdateTask(deps);

    var result = await cmd.execute({
      id: 'task-fixed-fp',
      userId: 'user-001',
      // NO recur object → needsComplexPath = false (fast path).
      body: { recurring: true },
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid_combination/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-867d-truthy — WARN-1: isFixedRecurringConflict used strict ===true, so
// numeric recurring:1 (common in serialised JSON exports/imports) bypassed the
// fixed+recurring XOR check. Fixed by changing to !!opts.recurring.
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-867d-truthy — data import: numeric recurring:1 + fixed placementMode → REJECTED', function () {

  test('BUG-867d-truthy: import with {placementMode:"fixed", recurring:1} (numeric truthy) → status 400, insertTask not called', async function () {
    // LOCKS WARN-1: isFixedRecurringConflict now uses !!opts.recurring so numeric 1
    // (not === true) is caught. Pre-fix: 1 === true → false → task was silently inserted.
    var mockInsertTask = jest.fn().mockResolvedValue();

    var mockRepo = {
      runInTransaction: async function (cb) {
        return cb({
          clearUserConfigTables: jest.fn().mockResolvedValue(),
          insertLocations: jest.fn().mockResolvedValue(),
          insertTools: jest.fn().mockResolvedValue(),
          insertProjects: jest.fn().mockResolvedValue(),
          insertConfigRows: jest.fn().mockResolvedValue(),
        });
      },
    };

    var cmd = new ImportData({
      repo: mockRepo,
      wipeTasks: jest.fn().mockResolvedValue(),
      insertTask: mockInsertTask,
      buildTaskRow: function (t) { return t; },
    });

    var result = await cmd.execute({
      userId: 'user-001',
      confirm: 'delete_all',
      data: {
        extraTasks: [
          {
            id: 'task-numeric-truthy',
            text: 'Numeric recurring truthy',
            placementMode: 'fixed',
            date: '2026-07-01',
            time: '9:00 AM',
            recurring: 1,  // numeric 1, not boolean true — the WARN-1 pre-fix hole
          },
        ],
      },
    });

    // After WARN-1 fix: rejected before the destructive transaction.
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/invalid_combination/i);
    // insertTask must NOT have been called (validation fires before the transaction).
    expect(mockInsertTask).not.toHaveBeenCalled();
  });

});
