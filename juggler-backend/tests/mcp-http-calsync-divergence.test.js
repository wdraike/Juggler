/**
 * ZOE-JUG-025 — MCP vs HTTP cal-sync guard divergence lock-down tests
 *
 * PURPOSE: Lock down the deliberate behavioral divergence between the MCP
 * update_task cal-sync guard and the HTTP PUT /api/tasks/:id guard so that
 * future regressions are caught immediately.
 *
 * DIVERGENCE DOCUMENTED HERE:
 *
 *   MCP guard  (src/mcp/tools/tasks.js ~L247):
 *     - Triggers when: task has ANY calendar event id (gcal, msft, apple)
 *     - Allowed fields: status, notes
 *     - _allowUnfix: NOT allowed (blocked by guard)
 *
 *   HTTP guard (src/controllers/task.controller.js checkCalSyncEditGuard ~L73):
 *     - Triggers when: cal_sync_origin is non-null AND not 'juggler'
 *     - Allowed fields: status, notes, _allowUnfix
 *     - juggler-originated tasks (cal_sync_origin='juggler') bypass guard entirely
 *
 * KEY DIFFERENCES:
 *   1. _allowUnfix — HTTP allows it; MCP rejects it as a blocked field
 *   2. Origin-awareness — HTTP exempts juggler-origin tasks even when synced;
 *      MCP blocks any task that has an event id regardless of origin
 *   3. Non-allowed scheduling fields — both reject (placement_mode change)
 *
 * Uses an in-memory mock DB identical in structure to mcp-update-task.test.js.
 */

'use strict';

// ── Captured call state ───────────────────────────────────────────────────────

var mockIsLockedValue = false;

function resetCaptures() {
  mockIsLockedValue = false;
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
    master_id: null,
    generated: 0,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    cal_sync_origin: null,
    cal_event_url: null,
    apple_calendar_name: null,
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
  var _whereNot = {};

  function db(tableName) {
    _table = tableName;
    _where = {};
    _whereNot = {};
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
  db.whereNot   = function(field, val) {
    if (typeof field === 'string' && val !== undefined) { _whereNot[field] = val; }
    return db;
  };
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
    if (t === 'projects' || t === 'task_masters' || t === 'sync_locks') { return []; }
    // cal_sync_ledger — the cal-sync guard queries:
    //   db('cal_sync_ledger').where({user_id, task_id, status:'active'}).whereNot('origin','juggler').first()
    // A task is "calendar-born" when it has an active non-juggler ledger row. The
    // fixtures signal this by setting an external event id on the stored task row.
    if (t === 'cal_sync_ledger') {
      var ledgerTaskId = w.task_id;
      var ledgerTask = ledgerTaskId ? taskStore[ledgerTaskId] : null;
      if (ledgerTask && (ledgerTask.gcal_event_id || ledgerTask.msft_event_id || ledgerTask.apple_event_id)) {
        var origin = ledgerTask.cal_sync_origin || (ledgerTask.gcal_event_id ? 'gcal' : (ledgerTask.msft_event_id ? 'msft' : 'apple'));
        // Honor the guard's .whereNot('origin','juggler'): juggler-origin ledger rows
        // (tasks Juggler pushed outward) are NOT calendar-born and must not be returned.
        if (_whereNot.origin !== undefined && origin === _whereNot.origin) return [];
        return [{ task_id: ledgerTaskId, origin: origin, status: 'active' }];
      }
      return [];
    }
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
  db.distinct = function() {
    return Promise.resolve(resolve().map(function(r) { return { task_id: r.task_id }; }));
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
    insertTask:     function() { return Promise.resolve(); },
    // 999.1398: batchUpdateTxn reads the affected-row counts off the result
    updateTaskById: function() { return Promise.resolve({ masterUpdated: 1, instanceUpdated: 0 }); },
    deleteTaskById: function() { return Promise.resolve(); }
  };
});

jest.mock('../src/scheduler/scheduleQueue', function() {
  return { enqueueScheduleRun: jest.fn() };
});

jest.mock('../src/lib/task-write-queue', function() {
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
    enqueueWrite: function() { return Promise.resolve(); },
    splitFields: splitFields,
    flushQueue: function() { return Promise.resolve(); }
  };
});

jest.mock('../src/lib/sse-emitter', function() {
  return { emit: jest.fn(), emitTasksChanged: jest.fn() };
});

// ── MCP handler capture ───────────────────────────────────────────────────────

var { registerTaskTools } = require('../src/mcp/tools/tasks');

function captureMcpHandlers(userId) {
  var handlers = {};
  var fakeServer = { tool: function(name, _d, _s, h) { handlers[name] = h; } };
  registerTaskTools(fakeServer, userId || 'user-001');
  return handlers;
}

// ── HTTP handler (checkCalSyncEditGuard) ──────────────────────────────────────

var { checkCalSyncEditGuard } = require('../src/controllers/task.controller');

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(function() {
  resetStore();
  resetCaptures();
});

// =============================================================================
// 1. MCP: synced tasks with disallowed fields → rejected
// =============================================================================

describe('ZOE-JUG-025 — MCP: calendar-synced task rejects disallowed fields', function() {

  test('(a) MCP update_task on synced task with placement_mode field → isError', async function() {
    // Any field outside [status, notes] is blocked by the MCP guard
    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'gcal' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', placementMode: 'anytime'
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
  });

  test('(b) MCP update_task on synced task with _allowUnfix → allowed (999.1395: MCP now shares the HTTP guard)', async function() {
    // Pre-facade the MCP adapter had its own guard that rejected _allowUnfix.
    // Since jug-mcp-facade, update_task routes through the shared facade
    // UpdateTask use-case and the ONE checkCalSyncEditGuard — whose allowed
    // list includes '_allowUnfix' (taskValidation.js:66). The MCP-only
    // divergence is retired; a bare _allowUnfix passes on both paths.
    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'gcal' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', _allowUnfix: true
    });
    expect(result.isError).toBeFalsy();
  });

  test('(c) MCP update_task on synced task with text → isError', async function() {
    resetStore({ msft_event_id: 'msft-evt-001', cal_sync_origin: 'msft' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', text: 'New title'
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
  });

  test('(d) MCP update_task on synced task with status only → allowed', async function() {
    // status is in the MCP allowed list
    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'gcal', scheduled_at: '2026-12-01 15:00:00' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', status: 'done'
    });
    expect(result.isError).toBeFalsy();
  });

  test('(e) MCP update_task on synced task with notes only → allowed', async function() {
    // notes is in the MCP allowed list
    resetStore({ apple_event_id: 'apple-evt-001', cal_sync_origin: 'apple' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', notes: 'A meeting note'
    });
    expect(result.isError).toBeFalsy();
  });

  test('MCP update_task on synced task with status + notes → allowed', async function() {
    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'gcal' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', status: 'wip', notes: 'In progress'
    });
    expect(result.isError).toBeFalsy();
  });

  test('MCP guard is origin-aware — juggler-origin tasks with event id stay editable', async function() {
    // The MCP guard reads cal_sync_ledger and only blocks tasks whose active ledger
    // row has a NON-juggler origin (.whereNot('origin','juggler')). A juggler-origin
    // task that Juggler synced outward (has event id, origin=juggler) is NOT
    // calendar-born, so the guard does not fire and any field may be edited.
    // (origin-aware guard, juggler dc5a2a6 — converges MCP with HTTP on origin.)
    resetStore({
      gcal_event_id: 'gcal-evt-juggler-sync',
      cal_sync_origin: 'juggler'   // juggler-originated, synced outward
    });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', text: 'Change title'
    });
    expect(result.isError).toBeFalsy();
  });
});

// =============================================================================
// 2. HTTP (checkCalSyncEditGuard): confirms the divergent allow list
// =============================================================================

describe('ZOE-JUG-025 — HTTP checkCalSyncEditGuard: allow list diverges from MCP', function() {

  test('(f) HTTP guard: _allowUnfix on ingested task → allowed (no guard error)', function() {
    // The HTTP guard explicitly lists _allowUnfix in its allowed set.
    // This is the primary divergence: MCP blocks it, HTTP permits it.
    var existing = makeTask({ cal_sync_origin: 'gcal' });
    var guard = checkCalSyncEditGuard(existing, { _allowUnfix: true });
    expect(guard).toBeNull();
  });

  test('(g) HTTP guard: placement_mode change on ingested task → blocked', function() {
    // Non-allowed fields (e.g. placement_mode) are still blocked by the HTTP guard
    var existing = makeTask({ cal_sync_origin: 'gcal' });
    var guard = checkCalSyncEditGuard(existing, { placementMode: 'anytime' });
    expect(guard).not.toBeNull();
    expect(guard.code).toBe('CAL_SYNCED_READONLY');
    expect(guard.blockedFields).toContain('placementMode');
  });

  test('(h) HTTP guard: status only → allowed', function() {
    var existing = makeTask({ cal_sync_origin: 'msft' });
    var guard = checkCalSyncEditGuard(existing, { status: 'done' });
    expect(guard).toBeNull();
  });

  test('(i) HTTP guard: notes only → allowed', function() {
    var existing = makeTask({ cal_sync_origin: 'apple' });
    var guard = checkCalSyncEditGuard(existing, { notes: 'A note' });
    expect(guard).toBeNull();
  });

  test('HTTP guard: status + notes + _allowUnfix together → all allowed', function() {
    var existing = makeTask({ cal_sync_origin: 'gcal' });
    var guard = checkCalSyncEditGuard(existing, {
      status: 'done', notes: 'Done it', _allowUnfix: true
    });
    expect(guard).toBeNull();
  });

  test('HTTP guard: juggler-origin task bypasses guard entirely (no cal_sync_origin check)', function() {
    // When cal_sync_origin is 'juggler', the HTTP guard treats the task as
    // juggler-owned even if it has an event id — any field is allowed.
    // This is the second major divergence from MCP (which checks event id presence).
    var existing = makeTask({ cal_sync_origin: 'juggler', gcal_event_id: 'gcal-evt-001' });
    var guard = checkCalSyncEditGuard(existing, { text: 'New title', placementMode: 'anytime' });
    expect(guard).toBeNull();
  });

  test('HTTP guard: null cal_sync_origin → guard does not fire (task not ingested)', function() {
    // Task has no cal_sync_origin → guard is a no-op (returns null)
    var existing = makeTask({ cal_sync_origin: null });
    var guard = checkCalSyncEditGuard(existing, { text: 'Whatever', placementMode: 'fixed' });
    expect(guard).toBeNull();
  });

  test('HTTP guard: text change on ingested task → blocked', function() {
    var existing = makeTask({ cal_sync_origin: 'gcal' });
    var guard = checkCalSyncEditGuard(existing, { text: 'New title' });
    expect(guard).not.toBeNull();
    expect(guard.code).toBe('CAL_SYNCED_READONLY');
    expect(guard.blockedFields).toContain('text');
  });

  test('HTTP guard: id field is excluded from blocked-field check', function() {
    // The id field is stripped from blocked-field calculation per the guard implementation
    var existing = makeTask({ cal_sync_origin: 'gcal' });
    var guard = checkCalSyncEditGuard(existing, { id: 'task-001', status: 'done' });
    expect(guard).toBeNull();
  });
});

// =============================================================================
// 3. Structural divergence contract: _allowUnfix behavior side-by-side
// =============================================================================

describe('ZOE-JUG-025 — Divergence contract: _allowUnfix on synced task', function() {

  test('_allowUnfix: HTTP guard returns null (allowed); MCP CONVERGES (999.1395: shared facade guard)', async function() {
    // HTTP side: null = no error
    var existing = makeTask({
      gcal_event_id: 'gcal-evt-001',
      cal_sync_origin: 'gcal'
    });
    var httpGuard = checkCalSyncEditGuard(existing, { _allowUnfix: true });
    expect(httpGuard).toBeNull(); // HTTP: permitted

    // MCP side: since jug-mcp-facade, update_task routes through the same
    // facade guard — the pre-facade MCP-only _allowUnfix block is retired,
    // so both paths permit a bare _allowUnfix (divergence → convergence).
    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'gcal' });
    var mcpResult = await captureMcpHandlers()['update_task']({
      id: 'task-001', _allowUnfix: true
    });
    expect(mcpResult.isError).toBeFalsy(); // MCP: also permitted
  });

  test('origin-awareness: juggler-origin task — both HTTP and MCP allow any field', async function() {
    // Both guards are now origin-aware and CONVERGE for juggler-origin tasks:
    // a task Juggler synced outward (origin='juggler') is not calendar-born, so
    // neither path blocks it. (MCP origin-awareness landed in juggler dc5a2a6 —
    // its active-ledger query filters .whereNot('origin','juggler').)
    // HTTP: juggler-origin bypasses the guard → allowed
    var existing = makeTask({
      gcal_event_id: 'gcal-evt-001',
      cal_sync_origin: 'juggler'
    });
    var httpGuard = checkCalSyncEditGuard(existing, { text: 'New text' });
    expect(httpGuard).toBeNull(); // HTTP: bypassed because origin is 'juggler'

    // MCP: ledger origin is 'juggler' → not calendar-born → allowed
    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'juggler' });
    var mcpResult = await captureMcpHandlers()['update_task']({
      id: 'task-001', text: 'New text'
    });
    expect(mcpResult.isError).toBeFalsy(); // MCP: not blocked (origin is juggler)
  });
});

// =============================================================================
// 4. Non-allowed field rejection — both paths agree
// =============================================================================

describe('ZOE-JUG-025 — Both paths agree: non-allowed fields are always rejected', function() {

  test('placement_mode change: HTTP guard blocks it on ingested task', function() {
    var existing = makeTask({ cal_sync_origin: 'gcal' });
    var guard = checkCalSyncEditGuard(existing, { placementMode: 'anytime' });
    expect(guard).not.toBeNull();
    expect(guard.error).toMatch(/synced from an external calendar/i);
    expect(guard.blockedFields).toContain('placementMode');
  });

  test('placement_mode change: MCP guard blocks it on synced task', async function() {
    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'gcal' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', placementMode: 'anytime'
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
  });

  test('dur change: HTTP guard blocks it on ingested task', function() {
    var existing = makeTask({ cal_sync_origin: 'msft' });
    var guard = checkCalSyncEditGuard(existing, { dur: 90 });
    expect(guard).not.toBeNull();
    expect(guard.blockedFields).toContain('dur');
  });

  test('dur change: MCP guard blocks it on synced task', async function() {
    resetStore({ msft_event_id: 'msft-evt-001', cal_sync_origin: 'msft' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', dur: 90
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
  });

  // 999.2028 (David ruling 2026-07-17): priority edits are allowed on every
  // task regardless of origin. Both paths must AGREE on the allowance — the
  // divergence contract this suite pins now covers pri as an allowed field.
  test('pri change: HTTP guard allows it on ingested task (999.2028)', function() {
    var existing = makeTask({ cal_sync_origin: 'gcal' });
    var guard = checkCalSyncEditGuard(existing, { pri: 'P1' });
    expect(guard).toBeNull();
  });

  test('pri change: MCP guard allows it on synced task (999.2028)', async function() {
    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'gcal' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', pri: 'P1'
    });
    expect(result.isError).not.toBe(true);
  });

  test('text change: both guards still block it on synced tasks', async function() {
    var existing = makeTask({ cal_sync_origin: 'gcal' });
    var guard = checkCalSyncEditGuard(existing, { text: 'New title' });
    expect(guard).not.toBeNull();
    expect(guard.blockedFields).toContain('text');

    resetStore({ gcal_event_id: 'gcal-evt-001', cal_sync_origin: 'gcal' });
    var result = await captureMcpHandlers()['update_task']({
      id: 'task-001', text: 'New title'
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
  });
});
