/**
 * ZOE-JUG-029 — MCP Cross-User Isolation Tests
 *
 * Verifies that MCP task tool handlers prevent horizontal privilege escalation:
 * a user authenticated as B must not access, modify, or delete tasks owned by user A.
 *
 * Architecture note: registerTaskTools(server, userId) closes over userId. All DB
 * queries include .where({ id, user_id: userId }) — a task owned by user A returns
 * nothing when queried with user B's userId, and the handler returns isError: true.
 *
 * These tests were AUTHORED against a fully in-memory mock DB (no real DB required) —
 * but that is no longer accurate for any write-mutation path (update_task, delete_task,
 * set_task_status, batch_update_tasks). Since the jug-mcp-facade migration routed these
 * tools through slices/task/facade.js's KnexTaskRepository (which requires '../../lib/db',
 * a module this file never mocks), every mutating handler now reaches a REAL DB connection
 * (test-bed 3407 in CI/local) where the in-memory `taskStore` fixture does not exist —
 * 999.1381 (tracked, declined-this-leg). get_task/list_tasks (read-only, still routed
 * through the mocked '../src/db') are UNAFFECTED and remain fully in-memory. See the
 * KNOWN-RED comment on the batch_update_tasks describe() block below for a second,
 * distinct gap discovered on top of 999.1381.
 */

'use strict';

// ── User fixtures ─────────────────────────────────────────────────────────────
var USER_A = 'user-a-owner-001';
var USER_B = 'user-b-attacker-002';
var TASK_ID = 'task-owned-by-a-001';

// ── In-memory task store (mutated by resetStore before each test) ─────────────
var taskStore = {};

function makeTaskRow(overrides) {
  return Object.assign({
    id: TASK_ID,
    user_id: USER_A,
    task_type: 'task',
    text: 'Secret task belonging to User A',
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
    date_pinned: 0,
    prev_when: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00'
  }, overrides);
}

function resetStore() {
  taskStore = {};
  taskStore[TASK_ID] = makeTaskRow();
}

// ── DB mock ───────────────────────────────────────────────────────────────────
// Mimics the pattern from mcp-task-config.test.js: a single mock object that
// acts as both the function and the fluent chain. _table and _where track the
// current query context. resolve() applies user_id scoping from taskStore.
//
// Key Knex chain shapes used by tasks.js handlers:
//   db('table').where({...}).first()
//   db('table').where({...}).select()   ← array result (thenable)
//   db('table').where(...).select(...)  ← then .first() on the promise
//   db('table').where(...).whereIn(...).select(...)  ← thenable
//   db('table').where(fn)               ← complex where (ignored for scoping)
//   db.transaction(cb)
//   db.fn.now()

var mock = (function() {
  var _table = null;
  var _where = {};

  // Store ref so we can mutate _table/_where inside resolve()
  function db(tableName) {
    _table = tableName;
    _where = {};
    return db;
  }

  db.fn = { now: function() { return 'MOCK_NOW'; } };
  db.raw = function(s) { return s; };

  // Fluent chain methods — all return db for chaining
  db.where = function(condOrField, val) {
    if (typeof condOrField === 'object' && condOrField !== null) {
      Object.assign(_where, condOrField);
    } else if (typeof condOrField === 'function') {
      // Complex where builder (e.g. orWhereNull chains) — ignored for isolation purposes
    } else if (typeof condOrField === 'string' && val !== undefined) {
      _where[condOrField] = val;
    }
    return db;
  };
  db.whereIn = function() { return db; };
  db.whereRaw = function() { return db; };
  db.whereNot = function() { return db; };
  db.whereNull = function() { return db; };
  db.orWhere = function() { return db; };
  db.orWhereNull = function() { return db; };
  db.orderBy = function() { return db; };
  db.limit = function() { return db; };
  db.insert = function() { return Promise.resolve([1]); };
  db.update = function() { return Promise.resolve(1); };
  db.del = function() { return Promise.resolve(1); };
  db.catch = function(fn) { return Promise.resolve([]).catch(fn); };
  db.transaction = function(cb) { return cb(db); };

  // resolve() — applies per-table + user_id scoping logic
  function resolve() {
    var t = _table;
    var w = _where;

    if (t === 'users') {
      return [{ id: w.id || USER_A, timezone: 'America/New_York' }];
    }
    if (t === 'user_config') {
      return [{ config_key: 'preferences', config_value: JSON.stringify({ splitDefault: false }) }];
    }
    if (t === 'projects') {
      return [];
    }
    if (t === 'task_masters' || t === 'sync_locks') {
      return [];
    }
    // tasks_v and tasks_with_sync_v — enforce user_id ownership
    if (t === 'tasks_v' || t === 'tasks_with_sync_v') {
      var id = w.id;
      var userId = w.user_id;

      // list_tasks / search_tasks: no specific id filter — return all for the user
      if (!id && userId) {
        return Object.values(taskStore).filter(function(task) {
          return task.user_id === userId;
        });
      }

      // Single-task lookup: where({ id, user_id }) — ownership enforced here
      var task = id ? taskStore[id] : null;
      if (!task) return [];
      if (userId !== undefined && task.user_id !== userId) return [];
      return [task];
    }
    return [];
  }

  // first() — returns first row or null
  db.first = function() {
    var rows = resolve();
    return Promise.resolve(rows.length > 0 ? rows[0] : null);
  };

  // distinct() — terminal for the calendar-born guard:
  //   db('cal_sync_ledger').where(...).whereIn(...).whereNot('origin','juggler').distinct('task_id')
  // resolve() returns [] for cal_sync_ledger (these fixtures use non-synced tasks),
  // so no task is treated as calendar-born and the guard does not block.
  db.distinct = function() {
    return Promise.resolve(resolve());
  };

  // select() — returns a Promise (thenable) AND exposes .first() on that promise
  // so db('t').where(...).select('col').first() works.
  db.select = function() {
    var rows = resolve();
    var p = Promise.resolve(rows);
    p.first = function() {
      return Promise.resolve(rows.length > 0 ? rows[0] : null);
    };
    return p;
  };

  // Make db directly thenable for: await db('t').where(...)  (no terminal select/first)
  db.then = function(resolve_fn, reject_fn) {
    return Promise.resolve(resolve()).then(resolve_fn, reject_fn);
  };

  return db;
})();

// ── Jest mocks ────────────────────────────────────────────────────────────────

jest.mock('../src/db', function() {
  return mock;
});

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

// 999.1398: mirror the REAL tasks-write.js updateTaskById contract — it returns
// { masterUpdated, instanceUpdated } affected-row counts, and its WHERE is
// user_id-scoped, so a foreign/nonexistent id writes 0 rows. batchUpdateTxn now
// inspects these counts before incrementing updatedCount; the mock must be
// ownership-aware for that fix to be exercised here. (Defined outside the
// jest.mock factory, mock-prefixed, per Jest's factory scoping rule.)
var mockUpdateTaskById = function(_db, id, _changes, userId) {
  var row = taskStore[id];
  var owned = !!(row && (!userId || row.user_id === userId));
  return Promise.resolve({ masterUpdated: owned ? 1 : 0, instanceUpdated: 0 });
};

// 999.1395: facade DeleteTask soft-cancels (R55 no-hard-delete) via
// tasks-write.softCancelById — ownership-aware like mockUpdateTaskById above.
// (Defined outside the jest.mock factory, mock-prefixed, per Jest's factory
// scoping rule.)
var mockSoftCancelById = function(_db, id, userId) {
  var row = taskStore[id];
  var owned = !!(row && (!userId || row.user_id === userId));
  return Promise.resolve({ instanceCancelled: owned ? 1 : 0, masterCancelled: 0 });
};

jest.mock('../src/lib/tasks-write', function() {
  return {
    insertTask: function() { return Promise.resolve(); },
    updateTaskById: function() { return mockUpdateTaskById.apply(null, arguments); },
    deleteTaskById: function() { return Promise.resolve(); },
    softCancelById: function() { return mockSoftCancelById.apply(null, arguments); }
  };
});

jest.mock('../src/scheduler/scheduleQueue', function() {
  return { enqueueScheduleRun: jest.fn() };
});

jest.mock('../src/lib/task-write-queue', function() {
  return {
    isLocked: function() { return Promise.resolve(false); },
    enqueueWrite: function() { return Promise.resolve(); },
    splitFields: function(row) {
      return { schedulingFields: {}, nonSchedulingFields: row };
    }
  };
});

jest.mock('../src/lib/sse-emitter', function() {
  // Real module (src/lib/sse-emitter.js) exports { addClient, emit, clientCount, getStats }.
  // facade.js's enqueueScheduleRun (S4/S6 mutation->schedule trigger) calls sseEmitter.emit(...)
  // directly — the facade migration surfaced this call; a mock stubbing only the legacy
  // emitTasksChanged name throws "sseEmitter.emit is not a function" and crashes every mutating
  // handler (update/delete/set_status/batch_update) before its assertions run.
  return { emitTasksChanged: function() {}, emit: function() {} };
});

// ── Tool handler capture ───────────────────────────────────────────────────────

var { registerTaskTools } = require('../src/mcp/tools/tasks');

/**
 * Register all task tools for a given userId and return a map of handlers.
 */
function captureHandlers(userId) {
  var handlers = {};
  var mockServer = {
    tool: function(name, _desc, _schema, h) {
      handlers[name] = h;
    }
  };
  registerTaskTools(mockServer, userId);
  return handlers;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseResult(result) {
  if (!result || !result.content || !result.content[0]) return null;
  try { return JSON.parse(result.content[0].text); } catch (e) { return result.content[0].text; }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(function() {
  resetStore();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MCP cross-user isolation — get_task', function() {

  test('User A can get their own task', async function() {
    var handlers = captureHandlers(USER_A);
    var result = await handlers['get_task']({ id: TASK_ID });
    expect(result.isError).toBeFalsy();
    var task = parseResult(result);
    expect(task).toBeDefined();
    expect(task.id).toBe(TASK_ID);
  });

  test('User B cannot get a task owned by User A — returns error', async function() {
    var handlers = captureHandlers(USER_B);
    var result = await handlers['get_task']({ id: TASK_ID });
    expect(result.isError).toBe(true);
    var text = result.content[0].text;
    expect(text).toMatch(/not found/i);
  });

  test('User B does not receive User A\'s task data in error response', async function() {
    var handlers = captureHandlers(USER_B);
    var result = await handlers['get_task']({ id: TASK_ID });
    var text = result.content[0].text;
    // Must not leak the task's text content
    expect(text).not.toContain('Secret task belonging to User A');
    expect(text).not.toContain(USER_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MCP cross-user isolation — update_task', function() {

  test('User A can update their own task', async function() {
    var handlers = captureHandlers(USER_A);
    var result = await handlers['update_task']({ id: TASK_ID, text: 'Updated by owner' });
    expect(result.isError).toBeFalsy();
  });

  test('User B cannot update a task owned by User A — returns error', async function() {
    var handlers = captureHandlers(USER_B);
    var result = await handlers['update_task']({ id: TASK_ID, text: 'Hijacked text' });
    expect(result.isError).toBe(true);
    var text = result.content[0].text;
    expect(text).toMatch(/not found/i);
  });

  test('update_task by User B does not leak User A task content', async function() {
    var handlers = captureHandlers(USER_B);
    var result = await handlers['update_task']({ id: TASK_ID, text: 'Hijacked text' });
    expect(result.content[0].text).not.toContain('Secret task belonging to User A');
    expect(result.content[0].text).not.toContain(USER_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MCP cross-user isolation — delete_task', function() {

  test('User A can delete their own task', async function() {
    var handlers = captureHandlers(USER_A);
    var result = await handlers['delete_task']({ id: TASK_ID });
    expect(result.isError).toBeFalsy();
    var data = parseResult(result);
    expect(data.deleted).toBe(true);
  });

  test('User B cannot delete a task owned by User A — returns error', async function() {
    var handlers = captureHandlers(USER_B);
    var result = await handlers['delete_task']({ id: TASK_ID });
    expect(result.isError).toBe(true);
    var text = result.content[0].text;
    expect(text).toMatch(/not found/i);
  });

  test('Task owned by User A still in store after failed delete by User B', async function() {
    var handlers = captureHandlers(USER_B);
    await handlers['delete_task']({ id: TASK_ID });
    // Mock deleteTaskById is never called when task not found, so store is unchanged
    expect(taskStore[TASK_ID]).toBeDefined();
    expect(taskStore[TASK_ID].user_id).toBe(USER_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MCP cross-user isolation — set_task_status', function() {

  test('User A can set status on their own task', async function() {
    taskStore[TASK_ID].scheduled_at = '2026-12-01 15:00:00';
    var handlers = captureHandlers(USER_A);
    var result = await handlers['set_task_status']({ id: TASK_ID, status: 'done' });
    expect(result.isError).toBeFalsy();
  });

  test('User B cannot set status on a task owned by User A — returns error', async function() {
    var handlers = captureHandlers(USER_B);
    var result = await handlers['set_task_status']({ id: TASK_ID, status: 'done' });
    expect(result.isError).toBe(true);
    var text = result.content[0].text;
    expect(text).toMatch(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MCP cross-user isolation — list_tasks', function() {

  test('User B list_tasks does not return tasks owned by User A', async function() {
    // list_tasks queries tasks_v with where('user_id', userId) — scoped to USER_B.
    // The mock returns [] for USER_B (no tasks in store for that user).
    var handlers = captureHandlers(USER_B);
    var result = await handlers['list_tasks']({});
    expect(result.isError).toBeFalsy();
    var tasks = parseResult(result);
    expect(Array.isArray(tasks)).toBe(true);
    // No tasks should belong to USER_A
    var crossUserTasks = tasks.filter(function(t) { return t.user_id === USER_A; });
    expect(crossUserTasks).toHaveLength(0);
    // The specific task owned by USER_A must not appear
    var leaked = tasks.find(function(t) { return t.id === TASK_ID; });
    expect(leaked).toBeUndefined();
  });

  test('User A list_tasks returns their own tasks', async function() {
    var handlers = captureHandlers(USER_A);
    var result = await handlers['list_tasks']({});
    expect(result.isError).toBeFalsy();
    var tasks = parseResult(result);
    expect(Array.isArray(tasks)).toBe(true);
    var ownTask = tasks.find(function(t) { return t.id === TASK_ID; });
    expect(ownTask).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Formerly KNOWN-RED (telly, 2026-07-08) on two stacked gaps; gap (2) is FIXED:
//  (1) 999.1381 (pre-existing, tracked): this file mocks only '../src/db', not
//      '../../lib/db' — facade.batchUpdateTasks's unlocked path preloads
//      `existing` through the REAL KnexTaskRepository (test-bed 3407), where
//      TASK_ID does not exist, so `existing` is undefined for every id. The
//      per-item WRITE, however, goes through the mocked tasks-write above,
//      which is now ownership-aware (returns real affected-row counts).
//  (2) FIXED (999.1398): batchUpdateTxn now inspects tasksWrite.updateTaskById's
//      returned {masterUpdated, instanceUpdated} affected-row counts and only
//      increments `updatedCount` for items whose writes touched rows — a
//      foreign/nonexistent id reports updated:0. With the ownership-aware
//      tasks-write mock, both assertions below exercise that fix and are GREEN.
describe('MCP cross-user isolation — batch_update_tasks', function() {

  test('User B batch_update_tasks on User A task is skipped (0 updates)', async function() {
    // The write routes through facade.batchUpdateTasks -> batchUpdateTxn, whose
    // updateTaskById write is user_id-scoped (0 rows for a foreign id) —
    // 999.1398 makes the reported count reflect that.
    var handlers = captureHandlers(USER_B);
    var result = await handlers['batch_update_tasks']({
      updates: [{ id: TASK_ID, text: 'Batch hijack' }]
    });
    expect(result.isError).toBeFalsy();
    var data = parseResult(result);
    // The foreign task was not in user B's scope — updated count is 0
    expect(data.updated).toBe(0);
  });

  test('User A batch_update_tasks on their own task succeeds', async function() {
    var handlers = captureHandlers(USER_A);
    var result = await handlers['batch_update_tasks']({
      updates: [{ id: TASK_ID, text: 'Legitimate batch update' }]
    });
    expect(result.isError).toBeFalsy();
    var data = parseResult(result);
    expect(data.updated).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MCP cross-user isolation — non-existent task ID', function() {
  // Both users get "not found" for a completely unknown task ID

  test('User A gets error for non-existent task', async function() {
    var handlers = captureHandlers(USER_A);
    var result = await handlers['get_task']({ id: 'ghost-task-999' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found/i);
  });

  test('User B gets same error for non-existent task — indistinguishable from access-denied', async function() {
    var handlers = captureHandlers(USER_B);
    var resultForA = await handlers['get_task']({ id: TASK_ID });           // exists but owned by A
    var resultGhost = await handlers['get_task']({ id: 'ghost-task-999' }); // does not exist at all

    // Both must be errors with indistinguishable not-found messages (no side-channel)
    expect(resultForA.isError).toBe(true);
    expect(resultGhost.isError).toBe(true);
    expect(resultForA.content[0].text).toMatch(/not found/i);
    expect(resultGhost.content[0].text).toMatch(/not found/i);
  });
});
