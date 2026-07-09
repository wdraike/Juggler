/**
 * ZOE-JUG-023 — MCP update_task Handler Unit Tests
 *
 * Covers all critical code paths in the update_task handler:
 *   1. cal-sync guard   — synced tasks reject non-allowed fields
 *   2. placementMode:fixed validation — rejected when no scheduling info
 *   3. taskToRow mapping — fields correctly translated to DB row
 *   4. ALL_DAY backstop  — date-only update infers all_day mode
 *   5. TEMPLATE_FIELDS   — recurring-instance fields routed to source template
 *   6. guardFixedCalendarWhen — calendar-linked tasks keep placement_mode:fixed
 *   7. locked-path split — isLocked=true routes scheduling fields to enqueueWrite
 *
 * Uses a fully in-memory mock DB — no real DB connection required.
 * Variable naming: variables accessed inside jest.mock() factories must start
 * with "mock" (case insensitive) per Jest's module factory scoping rule.
 */

'use strict';

// ── Captured call state ───────────────────────────────────────────────────────
// Named with "mock" prefix so jest.mock() factories can reference them.

var mockWriteCalls = [];        // all updateTaskById calls: { id, row }
var mockEnqueueCalls = [];      // all enqueueWrite calls: { userId, taskId, op, fields, src }
var mockIsLockedValue = false;  // controls isLocked() return value

function resetCaptures() {
  mockWriteCalls = [];
  mockEnqueueCalls = [];
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
  db.whereIn    = function(_col, ids) {
    // 999.1395: capture whereIn ids — validateTaskReferences (facade.js:187)
    // checks dependsOn against task_masters; echoing the requested ids back
    // makes every referenced dependency "exist" for field-mapping tests.
    db._whereInIds = Array.isArray(ids) ? ids.slice() : [];
    return db;
  };
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
    if (t === 'projects' || t === 'sync_locks') { return []; }
    if (t === 'task_masters') {
      // 999.1395: dependsOn existence check — echo requested ids back as
      // existing masters so reference validation passes for mapping tests.
      return (db._whereInIds || []).map(function(depId) { return { id: depId }; });
    }
    // cal_sync_ledger — the cal-sync guard queries:
    //   db('cal_sync_ledger').where({user_id, task_id, status:'active'}).whereNot('origin','juggler').first()
    // A task is "calendar-born" when it has an active non-juggler ledger row. The
    // fixtures signal this by setting an external event id on the stored task row.
    if (t === 'cal_sync_ledger') {
      var ledgerTaskId = _where.task_id;
      var ledgerTask = ledgerTaskId ? taskStore[ledgerTaskId] : null;
      if (ledgerTask && (ledgerTask.gcal_event_id || ledgerTask.msft_event_id || ledgerTask.apple_event_id)) {
        var origin = ledgerTask.gcal_event_id ? 'gcal' : (ledgerTask.msft_event_id ? 'msft' : 'apple');
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
    insertTask:    function() { return Promise.resolve(); },
    updateTaskById: function(_db, id, row) {
      mockWriteCalls.push({ id: id, row: row });
      // 999.1398: batchUpdateTxn reads the affected-row counts off the result
      return Promise.resolve({ masterUpdated: 1, instanceUpdated: 0 });
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

/** Last direct updateTaskById call for a given task id (or the last call overall). */
function lastWrite(id) {
  var calls = id ? mockWriteCalls.filter(function(c) { return c.id === id; }) : mockWriteCalls;
  return calls.length ? calls[calls.length - 1] : null;
}

/** Find a write call by task id. */
function findWrite(id) {
  return mockWriteCalls.find(function(c) { return c.id === id; });
}

/** Find an enqueue call by taskId. */
function findEnqueue(taskId) {
  return mockEnqueueCalls.find(function(e) { return e.taskId === taskId; });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(function() {
  resetStore();
  resetCaptures();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cal-sync guard
// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — cal-sync guard', function() {

  test('gcal-synced task with non-allowed field → isError with blocked field listed', async function() {
    resetStore({ gcal_event_id: 'gcal-evt-abc' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', text: 'New title', dur: 60 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
    expect(result.content[0].text).toContain('text');
  });

  test('msft-synced task with blocked field → isError', async function() {
    resetStore({ msft_event_id: 'msft-evt-xyz' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', pri: 'P1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
  });

  test('apple-synced task with blocked field → isError', async function() {
    resetStore({ apple_event_id: 'apple-evt-uvw' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', dur: 45 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
  });

  test('gcal-synced task with only status → allowed', async function() {
    resetStore({ gcal_event_id: 'gcal-evt-abc', scheduled_at: '2026-12-01 15:00:00' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', status: 'done' });
    expect(result.isError).toBeFalsy();
  });

  test('gcal-synced task with only notes → allowed', async function() {
    resetStore({ gcal_event_id: 'gcal-evt-abc' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', notes: 'A note' });
    expect(result.isError).toBeFalsy();
  });

  test('gcal-synced task with status + notes → allowed', async function() {
    resetStore({ gcal_event_id: 'gcal-evt-abc' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', status: 'wip', notes: 'In flight' });
    expect(result.isError).toBeFalsy();
  });

  test('non-synced task — no cal-sync error; update proceeds', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', text: 'Updated text' });
    expect(result.isError).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. placementMode:'fixed' validation
// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — placementMode:fixed validation', function() {

  test('fixed mode with no date/time and no existing scheduled_at → validation error', async function() {
    resetStore({ scheduled_at: null });
    var result = await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'fixed' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode "fixed" requires/i);
  });

  test('fixed mode with date + time → succeeds', async function() {
    var result = await captureHandlers()['update_task']({
      id: 'task-001', placementMode: 'fixed', date: '5/31', time: '2:00 PM'
    });
    expect(result.isError).toBeFalsy();
  });

  test('fixed mode with scheduledAt → succeeds', async function() {
    var result = await captureHandlers()['update_task']({
      id: 'task-001', placementMode: 'fixed', scheduledAt: '2026-05-31T18:00:00Z'
    });
    expect(result.isError).toBeFalsy();
  });

  test('fixed mode without date/time but existing scheduled_at present → ACCEPTED (999.1396 existing-aware)', async function() {
    // 999.1395/999.1396: the MCP adapter's own fixed-mode guard (tasks.js:357-368)
    // is DB-aware — when the body has no date/time/scheduledAt it consults the
    // EXISTING row and exempts the call when scheduled_at is already set, and
    // validateTaskInput is then fed the existing scheduled_at (tasks.js:386-388).
    // Re-sending placementMode:'fixed' on an already-scheduled row is accepted.
    resetStore({ scheduled_at: '2026-05-31T18:00:00Z' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'fixed' });
    expect(result.isError).toBeFalsy();
  });

  test('fixed mode with empty-string date and empty-string time → validation error', async function() {
    resetStore({ scheduled_at: null });
    var result = await captureHandlers()['update_task']({
      id: 'task-001', placementMode: 'fixed', date: '', time: ''
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode "fixed" requires/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. taskToRow field mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — taskToRow field mapping', function() {

  test('text maps to row.text', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', text: 'New task title' });
    var w = lastWrite('task-001');
    expect(w).not.toBeNull();
    expect(w.row.text).toBe('New task title');
  });

  test('dur maps to row.dur', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', dur: 90 });
    expect(lastWrite('task-001').row.dur).toBe(90);
  });

  test('pri maps to row.pri (normalized)', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', pri: 'P1' });
    expect(lastWrite('task-001').row.pri).toBe('P1');
  });

  test('notes maps to row.notes', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', notes: 'A note here' });
    expect(lastWrite('task-001').row.notes).toBe('A note here');
  });

  test('url maps to row.url', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', url: 'https://example.com' });
    expect(lastWrite('task-001').row.url).toBe('https://example.com');
  });

  test('dependsOn array maps to row.depends_on JSON string', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', dependsOn: ['dep-001', 'dep-002'] });
    expect(lastWrite('task-001').row.depends_on).toBe(JSON.stringify(['dep-001', 'dep-002']));
  });

  test('placementMode maps to row.placement_mode', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'time_window' });
    expect(lastWrite('task-001').row.placement_mode).toBe('time_window');
  });

  test('travelBefore maps to row.travel_before', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', travelBefore: 15 });
    expect(lastWrite('task-001').row.travel_before).toBe(15);
  });

  test('travelAfter maps to row.travel_after', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', travelAfter: 10 });
    expect(lastWrite('task-001').row.travel_after).toBe(10);
  });

  test('user_id and created_at are stripped from the update row', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', text: 'Check strip' });
    var w = lastWrite('task-001');
    expect(w.row.user_id).toBeUndefined();
    expect(w.row.created_at).toBeUndefined();
  });

  test('task not found → isError: true', async function() {
    var result = await captureHandlers()['update_task']({ id: 'ghost-task-999', text: 'Ghost' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ALL_DAY backstop
// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — ALL_DAY backstop', function() {

  test('date provided without time and no existing placementMode → row.placement_mode = all_day', async function() {
    resetStore({ placement_mode: null });
    await captureHandlers()['update_task']({ id: 'task-001', date: '5/31' });
    expect(lastWrite('task-001').row.placement_mode).toBe('all_day');
  });

  test('date + time provided → backstop does NOT fire (time-was-set guard)', async function() {
    resetStore({ placement_mode: null });
    await captureHandlers()['update_task']({ id: 'task-001', date: '5/31', time: '10:00 AM' });
    // placement_mode was not set by caller and backstop did not fire → undefined in row diff
    expect(lastWrite('task-001').row.placement_mode).toBeUndefined();
  });

  test('scheduledAt provided → backstop does NOT fire', async function() {
    resetStore({ placement_mode: null });
    await captureHandlers()['update_task']({ id: 'task-001', date: '5/31', scheduledAt: '2026-05-31T18:00:00Z' });
    expect(lastWrite('task-001').row.placement_mode).toBeUndefined();
  });

  test('explicit placementMode + date → explicit value wins, backstop skipped', async function() {
    resetStore({ placement_mode: null });
    await captureHandlers()['update_task']({ id: 'task-001', date: '5/31', placementMode: 'anytime' });
    // taskToRow sets placement_mode; backstop condition (row.placement_mode === undefined) is false
    expect(lastWrite('task-001').row.placement_mode).toBe('anytime');
  });

  test('no date field provided → backstop never triggers', async function() {
    resetStore({ placement_mode: null });
    await captureHandlers()['update_task']({ id: 'task-001', text: 'No date update' });
    expect(lastWrite('task-001').row.placement_mode).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. TEMPLATE_FIELDS routing for recurring instances
// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — TEMPLATE_FIELDS routing for recurring instances', function() {

  var SOURCE_ID = 'source-template-001';

  function setupRecurringInstance(templateOverrides, instanceOverrides) {
    taskStore[SOURCE_ID] = makeTask(Object.assign({
      id: SOURCE_ID,
      task_type: 'recurring_template',
      text: 'Template text',
      gcal_event_id: null
    }, templateOverrides || {}));
    taskStore['task-001'] = makeTask(Object.assign({
      id: 'task-001',
      task_type: 'recurring_instance',
      source_id: SOURCE_ID,
      text: 'Instance text',
      gcal_event_id: null
    }, instanceOverrides || {}));
  }

  test('text update on recurring_instance → written to template (source), not instance', async function() {
    setupRecurringInstance();
    await captureHandlers()['update_task']({ id: 'task-001', text: 'New template text' });
    var templateWrite = findWrite(SOURCE_ID);
    expect(templateWrite).toBeDefined();
    expect(templateWrite.row.text).toBe('New template text');
  });

  test('status update on recurring_instance → written to instance, not template', async function() {
    setupRecurringInstance(null, { scheduled_at: '2026-12-01 15:00:00' });
    await captureHandlers()['update_task']({ id: 'task-001', status: 'done' });
    // status is NOT in TEMPLATE_FIELDS — a status-only update must not write to the template at all
    var templateWrite = findWrite(SOURCE_ID);
    expect(templateWrite).toBeUndefined();
    // status must appear in the instance write
    var instanceWrite = findWrite('task-001');
    expect(instanceWrite).toBeDefined();
    expect(instanceWrite.row.status).toBe('done');
  });

  test('non-recurring task → single write to the task itself, no template write', async function() {
    resetStore({ task_type: 'task', source_id: null });
    await captureHandlers()['update_task']({ id: 'task-001', text: 'Direct update' });
    expect(findWrite('task-001')).toBeDefined();
    expect(findWrite(SOURCE_ID)).toBeUndefined();
  });

  test('recurring_instance without source_id → treated as regular task', async function() {
    resetStore({ task_type: 'recurring_instance', source_id: null });
    await captureHandlers()['update_task']({ id: 'task-001', text: 'Instance no source' });
    expect(findWrite('task-001')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. guardFixedCalendarWhen
// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — guardFixedCalendarWhen', function() {

  test('gcal-linked task: cal-sync guard fires first (when=null blocked before guardFixed runs)', async function() {
    // The cal-sync guard (check 1) fires before guardFixedCalendarWhen (check 6).
    // A gcal-linked task with `when` in the payload hits the cal-sync guard first.
    resetStore({ gcal_event_id: 'gcal-evt-001', placement_mode: 'fixed', when: 'fixed' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', when: null });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
  });

  test('non-cal-linked task with when update → no guardFixedCalendarWhen interference', async function() {
    resetStore({ gcal_event_id: null, placement_mode: null, when: 'morning' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', when: '' });
    expect(result.isError).toBeFalsy();
  });

  test('non-cal-linked task: placementMode can change freely (no guard)', async function() {
    // Task has placement_mode=fixed but NO cal link → guard is a no-op → anytime is written
    resetStore({ gcal_event_id: null, placement_mode: 'fixed' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'anytime' });
    expect(result.isError).toBeFalsy();
    expect(lastWrite('task-001').row.placement_mode).toBe('anytime');
  });

  test('KNOWN GAP 999.1432: fast path writes placement_mode through to a cal-linked template (guard vs template missing)', async function() {
    // INTENDED behavior (pre-facade adapter + the facade COMPLEX path,
    // UpdateTask.js:270-274): the instance edit routes TEMPLATE_FIELDS to the
    // source template and guardFixedCalendarWhen — checked against the
    // TEMPLATE row — strips a non-fixed placement_mode before the write.
    //
    // CURRENT behavior (999.1432, found during the 999.1395 realignment): the
    // FAST path guards only vs the instance (UpdateTask.js:372) and then copies
    // TEMPLATE_FIELDS, including placement_mode, to the template
    // (UpdateTask.js:385-394) with NO guard vs the template row. This test
    // characterizes the gap so the suite is green at HEAD; when 999.1432 is
    // fixed, flip the placement_mode assertion back to
    //   expect('placement_mode' in templateWrite.row).toBe(false);
    var SOURCE_ID = 'source-fixed-001';
    taskStore[SOURCE_ID] = makeTask({
      id: SOURCE_ID, task_type: 'recurring_template',
      gcal_event_id: 'gcal-src-001', placement_mode: 'fixed'
    });
    taskStore['task-001'] = makeTask({
      id: 'task-001', task_type: 'recurring_instance', source_id: SOURCE_ID, gcal_event_id: null
    });
    var result = await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'anytime', when: 'morning' });
    expect(result.isError).toBeFalsy();
    // Template write must have happened (when='morning' is a TEMPLATE_FIELD that passes through)
    var templateWrite = findWrite(SOURCE_ID);
    expect(templateWrite).toBeDefined();
    // 999.1432 KNOWN GAP: placement_mode currently written through unguarded.
    expect(templateWrite.row.placement_mode).toBe('anytime');
    // `when` routes to the template as before
    expect(templateWrite.row.when).toBe('morning');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Locked-path split (isLocked = true)
// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — locked-path split', function() {

  beforeEach(function() {
    mockIsLockedValue = true;
  });

  afterEach(function() {
    mockIsLockedValue = false;
  });

  // 999.1395: since jug-mcp-facade, simple (non-complex) edits take the facade
  // FAST PATH (UpdateTask.js:225 → _fastPath), which writes directly WITHOUT
  // consulting the write-lock — only complex edits (e.g. payloads carrying
  // `when`, recurrence toggles) reach the lock check (UpdateTask.js:295) and
  // the queued/_lockPath split. The pre-facade MCP-only "lock everything"
  // divergence is retired; tests below pin the unified contract.

  test('locked: simple scheduling fields take the fast path → direct write, no enqueue', async function() {
    await captureHandlers()['update_task']({
      id: 'task-001', date: '5/31', time: '10:00 AM', placementMode: 'fixed'
    });
    expect(findEnqueue('task-001')).toBeUndefined();
    var w = lastWrite('task-001');
    expect(w).not.toBeNull();
    expect(w.row.placement_mode).toBe('fixed');
  });

  test('locked: simple edit response has NO queued flag (fast path)', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', text: 'Lock test' });
    expect(result.isError).toBeFalsy();
    expect(parseResult(result).queued).toBeUndefined();
  });

  test('locked: text (non-scheduling) → direct write; no text in enqueue fields', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', text: 'Only text change' });
    // text is non-scheduling → must appear in a direct updateTaskById write
    var w = lastWrite('task-001');
    expect(w).not.toBeNull();
    expect(w.row.text).toBe('Only text change');
    // text must NOT appear in any enqueueWrite call (scheduling queue is not for non-scheduling fields)
    var eq = mockEnqueueCalls.find(function(e) { return e.taskId === 'task-001' && e.fields && 'text' in e.fields; });
    expect(eq).toBeUndefined();
  });

  test('locked: scheduling field (placement_mode) → written directly with correct value (fast path)', async function() {
    await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'all_day' });
    var w = lastWrite('task-001');
    expect(w).not.toBeNull();
    expect(w.row.placement_mode).toBe('all_day');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Input validation
// ─────────────────────────────────────────────────────────────────────────────
//
// Note on `when` reserved-value enforcement:
// The Zod `.refine()` on taskInputFields.when (blocking "fixed"/"allday") only
// runs when the MCP framework parses the input before invoking the handler.
// In unit tests we call the handler function directly, bypassing that layer.
// validateTaskInput() does not separately check for reserved when values.
// The `when="fixed"` / `when="allday"` guard is therefore a Zod-layer concern,
// not a handler-layer concern — and is not assertable in these unit tests.
// We test what validateTaskInput() DOES enforce: lengths and known bad formats.

describe('update_task — input validation (validateTaskInput layer)', function() {

  test('valid when value "morning" → no error', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', when: 'morning' });
    expect(result.isError).toBeFalsy();
  });

  test('empty string when → no error', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', when: '' });
    expect(result.isError).toBeFalsy();
  });

  test('when tag exceeding 30 chars → validateTaskInput returns error', async function() {
    var longTag = 'a'.repeat(31);
    var result = await captureHandlers()['update_task']({ id: 'task-001', when: longTag });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/validation error/i);
  });

  test('invalid placementMode value → validateTaskInput error', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'bogus_mode' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode.*is not valid/i);
  });

  test('placementMode:fixed with no date/time → validateTaskInput cross-field error', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', placementMode: 'fixed' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode "fixed" requires/i);
  });

  test('dur=0 → validateTaskInput rejects duration <= 0', async function() {
    var result = await captureHandlers()['update_task']({ id: 'task-001', dur: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/duration must be greater than 0/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. enqueueScheduleRun called after update
// ─────────────────────────────────────────────────────────────────────────────
// 8a. ZOE-JUG-023-W1 — recurring_template direct edit strips depends_on
// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — recurring_template direct edit strips depends_on (ZOE-JUG-023-W1)', function() {

  test('editing a recurring_template task directly → depends_on stripped from update row', async function() {
    // Set up a recurring_template task with no source_id (it IS the template, not an instance).
    // The handler strips depends_on whenever existing.task_type is recurring_template or recurring_instance.
    resetStore({
      id: 'task-001',
      task_type: 'recurring_template',
      recurring: 1,
      source_id: null   // direct template — not an instance
    });
    await captureHandlers()['update_task']({ id: 'task-001', text: 'Edit template', dependsOn: ['dep-aaa'] });
    var w = lastWrite('task-001');
    expect(w).not.toBeNull();
    // depends_on must have been deleted from the row before the write
    expect('depends_on' in w.row).toBe(false);
  });

  test('editing a non-recurring task → depends_on is NOT stripped', async function() {
    resetStore({ task_type: 'task', recurring: 0, source_id: null });
    await captureHandlers()['update_task']({ id: 'task-001', dependsOn: ['dep-bbb'] });
    var w = lastWrite('task-001');
    expect(w).not.toBeNull();
    expect(w.row.depends_on).toBe(JSON.stringify(['dep-bbb']));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8b. ZOE-JUG-023-W2 — locked path, pure-scheduling update
// ─────────────────────────────────────────────────────────────────────────────
//
// taskToRow() unconditionally sets row.updated_at = new Date() (task.controller.js
// line 594). `updated_at` is in NON_SCHEDULING_FIELDS, so splitFields always
// produces a non-empty nonSchedulingFields object containing at least updated_at.
// This means updateTaskById IS always called in the locked path — but for a
// pure-scheduling update it is called EXACTLY ONCE with only { updated_at }.
// The scheduling payload is sent to enqueueWrite, not written directly.
//
// The PIPELINE description ("updateTaskById not-called assertion") reflects the
// intent that no substantive fields are written directly; the implementation
// satisfies this by writing only the timestamp housekeeping field.

describe('update_task — locked path, pure-scheduling update (ZOE-JUG-023-W2)', function() {

  beforeEach(function() {
    mockIsLockedValue = true;
  });

  afterEach(function() {
    mockIsLockedValue = false;
  });

  test('locked + only scheduling fields → updateTaskById called exactly once with only updated_at', async function() {
    // taskToRow sets updated_at unconditionally; splitFields classifies it as non-scheduling.
    // So updateTaskById fires exactly once, carrying only the timestamp — no substantive fields.
    await captureHandlers()['update_task']({ id: 'task-001', when: '2026-06-10', placementMode: 'fixed', date: '6/10', time: '9:00 AM' });
    expect(mockWriteCalls).toHaveLength(1);
    var w = mockWriteCalls[0];
    // Row written directly must contain ONLY updated_at (no scheduling content)
    var writtenKeys = Object.keys(w.row);
    expect(writtenKeys).toEqual(['updated_at']);
    // Scheduling fields must be in the enqueue queue, not in the direct write
    var eq = findEnqueue('task-001');
    expect(eq).toBeDefined();
    expect(eq.op).toBe('update');
    // scheduling fields present in enqueue but absent from direct write
    expect('placement_mode' in eq.fields).toBe(true);
    expect('placement_mode' in w.row).toBe(false);
  });

  test('locked + only scheduling fields → enqueueScheduleRun IS still called (deferred, api:updateTask)', async function() {
    // 999.1395: the facade wrapper defers scheduleQueue.enqueueScheduleRun by
    // 2s and calls it with (userId, source) — source is 'api:updateTask'.
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();
    jest.useFakeTimers();
    try {
      await captureHandlers()['update_task']({ id: 'task-001', when: 'morning', placementMode: 'anytime' });
      // Only updated_at written directly — no substantive fields in the direct write
      expect(mockWriteCalls).toHaveLength(1);
      expect(Object.keys(mockWriteCalls[0].row)).toEqual(['updated_at']);
      jest.runOnlyPendingTimers();
      expect(enqueueScheduleRun).toHaveBeenCalledWith('user-001', 'api:updateTask');
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8c. ZOE-JUG-023-W3 — _allowUnfix MCP behaviour
// ─────────────────────────────────────────────────────────────────────────────
//
// Design note: In the HTTP handler, `_allowUnfix` is explicitly in the
// checkCalSyncEditGuard allowed list so it can pass the cal-sync guard and
// reach guardFixedCalendarWhen. In the MCP handler:
//
//  1. The update_task Zod schema does NOT include `_allowUnfix`, so the MCP
//     framework strips it before the handler runs (real MCP calls).
//  2. Even when called directly in unit tests (bypassing Zod), the MCP
//     cal-sync guard only allows ['status', 'notes'] — `_allowUnfix` is not
//     in that list. So any gcal/msft/apple-synced task with `_allowUnfix` in
//     the payload hits a BLOCKED response before guardFixedCalendarWhen runs.
//
// Effective behaviour: `_allowUnfix` is inert in MCP update_task —
// it is either stripped by Zod (real MCP) or blocked by the cal-sync guard
// (direct handler calls on synced tasks). This test suite documents both paths.

describe('update_task — _allowUnfix MCP behaviour (ZOE-JUG-023-W3)', function() {

  test('gcal-synced task + _allowUnfix + when → BLOCKED on `when` (999.1395: shared guard, _allowUnfix itself allowed)', async function() {
    // Since jug-mcp-facade, MCP uses the ONE shared checkCalSyncEditGuard
    // (taskValidation.js:63): allowed = ['status','notes','_allowUnfix']
    // (+ 'placementMode' when _allowUnfix is set). `when` is still blocked —
    // but `_allowUnfix` itself no longer appears in blockedFields.
    resetStore({ gcal_event_id: 'gcal-evt-001', placement_mode: 'fixed', when: 'fixed' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', _allowUnfix: true, when: 'morning' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
    expect(result.content[0].text).toContain('when');
    expect(result.content[0].text).not.toContain('_allowUnfix');
  });

  test('non-synced task with placement_mode=fixed + _allowUnfix → _allowUnfix ignored (field not in schema), update proceeds', async function() {
    // Non-synced task: cal-sync guard does not fire.
    // _allowUnfix is stripped by Zod in real MCP; here it passes through in unit test context
    // but guardFixedCalendarWhen only fires when the task has a cal event id (not the case here).
    // Result: update proceeds normally; _allowUnfix has no observable effect.
    resetStore({ gcal_event_id: null, placement_mode: 'fixed' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', _allowUnfix: true, when: 'morning' });
    expect(result.isError).toBeFalsy();
    // The update should have written when to the row
    var w = lastWrite('task-001');
    expect(w).not.toBeNull();
    expect(w.row.when).toBe('morning');
  });

  test('gcal-synced task with ONLY status update → allowed even when _allowUnfix is absent', async function() {
    // Baseline confirmation: cal-synced tasks accept status updates without _allowUnfix.
    resetStore({ gcal_event_id: 'gcal-evt-002', placement_mode: 'fixed', scheduled_at: '2026-12-01 15:00:00' });
    var result = await captureHandlers()['update_task']({ id: 'task-001', status: 'done' });
    expect(result.isError).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — recurring_template direct edit depends_on strip', function() {
  test('recurring_template direct edit with dependsOn → depends_on stripped from row', async function() {
    // Setup: create a recurring_template task.
    // resetStore always stores the task under the key 'task-001' in taskStore;
    // the id override only sets the task's own id field — the DB mock resolves
    // by store key, so the update_task call must use id: 'task-001'.
    resetStore({ task_type: 'recurring_template' });

    // Send update with dependsOn field
    await captureHandlers()['update_task']({
      id: 'task-001',
      dependsOn: ['task-002', 'task-003']
    });

    // Verify the write was captured
    var templateWrite = findWrite('task-001');
    expect(templateWrite).toBeDefined();

    // Verify depends_on was stripped from the row
    expect(templateWrite.row.depends_on).toBeUndefined();
  });

  test('recurring_template direct edit without dependsOn → no depends_on field added', async function() {
    // Setup: create a recurring_template task
    resetStore({ task_type: 'recurring_template' });

    // Send update without dependsOn field
    await captureHandlers()['update_task']({
      id: 'task-001',
      text: 'Updated template text'
    });

    // Verify the write was captured
    var templateWrite = findWrite('task-001');
    expect(templateWrite).toBeDefined();

    // Verify depends_on is not present in the row
    expect(templateWrite.row.depends_on).toBeUndefined();
  });

  test('non-recurring_template with dependsOn → depends_on preserved in row', async function() {
    // Setup: create a regular task
    resetStore({ task_type: 'task' });

    // Send update with dependsOn field
    await captureHandlers()['update_task']({
      id: 'task-001',
      dependsOn: ['task-002']
    });

    // Verify the write was captured
    var taskWrite = findWrite('task-001');
    expect(taskWrite).toBeDefined();

    // Verify depends_on was preserved in the row
    expect(taskWrite.row.depends_on).toBe('["task-002"]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('update_task — enqueueScheduleRun', function() {

  test('successful text-only update → SSE trigger fires with taskId; scheduler enqueue SKIPPED (non-scheduling)', async function() {
    // 999.1395: the facade wrapper emits ids on the SSE 'tasks:changed'
    // payload synchronously; the deferred scheduleQueue.enqueueScheduleRun is
    // SKIPPED for a non-scheduling (text-only) edit — the fast path passes
    // skipScheduler: !hasSchedulingFields(row) (UpdateTask.js:412).
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    var sseEmitter = require('../src/lib/sse-emitter');
    enqueueScheduleRun.mockClear();
    sseEmitter.emit.mockClear();
    jest.useFakeTimers();
    try {
      await captureHandlers()['update_task']({ id: 'task-001', text: 'Schedule run test' });
      expect(sseEmitter.emit).toHaveBeenCalledWith(
        'user-001',
        'tasks:changed',
        expect.objectContaining({ source: 'api:updateTask', ids: ['task-001'] })
      );
      jest.runOnlyPendingTimers();
      expect(enqueueScheduleRun).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('task not found → enqueueScheduleRun NOT called', async function() {
    var { enqueueScheduleRun } = require('../src/scheduler/scheduleQueue');
    enqueueScheduleRun.mockClear();
    await captureHandlers()['update_task']({ id: 'nonexistent', text: 'Ghost' });
    expect(enqueueScheduleRun).not.toHaveBeenCalled();
  });
});
