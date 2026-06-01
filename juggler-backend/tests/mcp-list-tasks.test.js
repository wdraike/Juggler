/**
 * ZOE-JUG-027 — MCP list_tasks Unit Tests
 *
 * Tests for the list_tasks MCP handler covering:
 *   1. Default: done tasks excluded (status != 'done', NULL included)
 *   2. includeDone=true: all tasks returned (no done-exclusion filter)
 *   3. Explicit status filter overrides done-exclusion (status="done")
 *   4. filter by project_id/project name
 *   5. limit respected (with and without date filter)
 *   6. rowToTask mapping — returned objects have expected fields
 *   7. buildSourceMap — recurring instance inherits template text
 *   8. NULL-status rows included by default (MySQL three-value-logic)
 *
 * Uses a fully in-memory mock DB — no real DB connection required.
 * Variable naming: variables accessed inside jest.mock() factories must start
 * with "mock" (case-insensitive) per Jest's module factory scoping rule.
 */

'use strict';

// ── Shared mock state ─────────────────────────────────────────────────────────

var mockRows = []; // populated per-test

// ── DB mock ───────────────────────────────────────────────────────────────────
// list_tasks queries: users (timezone), tasks_v (the task list).
// We simulate the chainable Knex query builder with a simple in-memory filter.

var mockDb = (function() {
  var _table = null;
  var _filters = []; // each element is a function(row) -> boolean

  function db(tableName) {
    _table = tableName;
    _filters = [];
    return db;
  }

  db.fn  = { now: function() { return 'MOCK_NOW'; } };
  db.raw = function() { return Promise.resolve([[], []]); };

  db.where = function(fieldOrFn, val) {
    if (typeof fieldOrFn === 'function') {
      // Complex builder — record as a sub-filter group.
      var groupFilters = [];
      var subBuilder = {
        whereNot: function(field, v) {
          groupFilters.push(function(row) { return row[field] !== v; });
          return subBuilder;
        },
        orWhereNull: function(field) {
          groupFilters.push(function(row) { return row[field] == null; });
          return subBuilder;
        }
      };
      fieldOrFn.call(subBuilder);
      // The group is an OR of all group filters
      _filters.push(function(row) {
        return groupFilters.some(function(f) { return f(row); });
      });
    } else if (typeof fieldOrFn === 'string' && val !== undefined) {
      var f = fieldOrFn;
      var v = val;
      _filters.push(function(row) { return row[f] === v; });
    }
    return db;
  };

  db.whereNot = function(field, val) {
    var f = field; var v = val;
    _filters.push(function(row) { return row[f] !== v; });
    return db;
  };
  db.whereNull  = function() { return db; };
  db.whereIn    = function() { return db; };
  db.whereRaw   = function() { return db; };
  db.orWhere    = function() { return db; };
  db.orWhereNull = function() { return db; };
  db.orderBy    = function() { return db; };
  db.orderByRaw = function() { return db; };

  var _limit = null;
  db.limit = function(n) { _limit = n; return db; };

  db.insert  = function() { return Promise.resolve([1]); };
  db.update  = function() { return Promise.resolve(1); };
  db.del     = function() { return Promise.resolve(1); };
  db.catch   = function(fn) { return Promise.resolve([]).catch(fn); };
  db.transaction = function(cb) { return cb(db); };
  db.select  = function() { return db; };
  db.max     = function() { return db; };
  db.groupBy = function() { return db; };
  db.pluck   = function() { return Promise.resolve([]); };

  function resolve() {
    if (_table === 'users') {
      return [{ id: 'user-001', timezone: 'America/New_York' }];
    }
    if (_table === 'tasks_v') {
      var filtered = mockRows.filter(function(row) {
        return _filters.every(function(f) { return f(row); });
      });
      if (_limit !== null) {
        filtered = filtered.slice(0, _limit);
        _limit = null;
      }
      return filtered;
    }
    return [];
  }

  db.first = function() {
    var rows = resolve();
    return Promise.resolve(rows.length > 0 ? rows[0] : null);
  };
  db.then = function(res, rej) {
    return Promise.resolve(resolve()).then(res, rej);
  };

  return db;
})();

// ── Jest module mocks ─────────────────────────────────────────────────────────

jest.mock('../src/db', function() { return mockDb; });

jest.mock('../src/lib/tasks-write', function() {
  return {
    insertTask: function() { return Promise.resolve(); },
    updateTaskById: function() { return Promise.resolve(); },
    deleteTaskById: function() { return Promise.resolve(); }
  };
});

jest.mock('../src/scheduler/scheduleQueue', function() {
  return { enqueueScheduleRun: jest.fn() };
});

jest.mock('../src/lib/task-write-queue', function() {
  return {
    isLocked: function() { return Promise.resolve(false); },
    enqueueWrite: function() { return Promise.resolve(); },
    splitFields: function(row) { return { schedulingFields: row, nonSchedulingFields: {} }; }
  };
});

jest.mock('../src/lib/sse-emitter', function() {
  return { emitTasksChanged: jest.fn() };
});

// ── Handler capture ───────────────────────────────────────────────────────────

var { registerTaskTools } = require('../src/mcp/tools/tasks');

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = { tool: function(name, _desc, _schema, handler) { handlers[name] = handler; } };
  registerTaskTools(fakeServer, userId || 'user-001');
  return handlers;
}

// ── Row factory ───────────────────────────────────────────────────────────────

function makeRow(overrides) {
  return Object.assign({
    id: 'task-' + Math.random().toString(36).slice(2),
    user_id: 'user-001',
    text: 'Test task',
    status: '',
    task_type: 'task',
    project: null,
    scheduled_at: null,
    created_at: new Date('2026-01-01T12:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T12:00:00Z').toISOString(),
    source_id: null,
    recurring: 0,
    dur: 30,
    pri: 'P3',
    notes: null,
    url: null,
    location: '[]',
    tools: '[]',
    depends_on: '[]',
    when: null,
    day_req: null,
    split: null,
    split_min: null,
    recur: null,
    generated: 0,
    marker: 0,
    placement_mode: null,
    flex_when: 0,
    travel_before: null,
    travel_after: null,
    weather_precip: 'any',
    weather_cloud: 'any',
    weather_temp_min: null,
    weather_temp_max: null,
    weather_temp_unit: null,
    weather_humidity_min: null,
    weather_humidity_max: null,
    preferred_time_mins: null,
    desired_at: null,
    unscheduled: 0,
    overdue: 0,
    slack_mins: null,
    deadline: null,
    start_after_at: null,
    time_remaining: null,
    gcal_event_id: null,
    msft_event_id: null,
    apple_event_id: null,
    apple_calendar_name: null,
    cal_sync_origin: null,
    cal_event_url: null,
    section: null,
    tz: null,
    end_date: null,
    rolling_anchor: null,
    disabled_at: null,
    completed_at: null,
    split_total: null,
    recur_start: null,
    recur_end: null,
    master_id: null,
    time_flex: null
  }, overrides);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('list_tasks MCP handler', function() {
  var handlers;

  beforeEach(function() {
    mockRows = [];
    handlers = captureHandlers('user-001');
  });

  // ── 1. Default done-exclusion ─────────────────────────────────────────────

  it('excludes done tasks by default', async function() {
    mockRows = [
      makeRow({ id: 'active-1', text: 'Active task', status: '' }),
      makeRow({ id: 'wip-1',    text: 'WIP task',    status: 'wip' }),
      makeRow({ id: 'done-1',   text: 'Done task',   status: 'done' })
    ];

    var result = await handlers.list_tasks({});
    var tasks = JSON.parse(result.content[0].text);

    var ids = tasks.map(function(t) { return t.id; });
    expect(ids).toContain('active-1');
    expect(ids).toContain('wip-1');
    expect(ids).not.toContain('done-1');
  });

  // ── 2. NULL-status rows included by default (MySQL three-valued logic) ────

  it('includes null-status tasks in the default list', async function() {
    mockRows = [
      makeRow({ id: 'null-status', text: 'Null status task', status: null }),
      makeRow({ id: 'done-1',      text: 'Done task',        status: 'done' })
    ];

    var result = await handlers.list_tasks({});
    var tasks = JSON.parse(result.content[0].text);
    var ids = tasks.map(function(t) { return t.id; });

    expect(ids).toContain('null-status');
    expect(ids).not.toContain('done-1');
  });

  // ── 3. includeDone=true returns all tasks ─────────────────────────────────

  it('returns done tasks when includeDone=true', async function() {
    mockRows = [
      makeRow({ id: 'active-1', text: 'Active task', status: '' }),
      makeRow({ id: 'done-1',   text: 'Done task',   status: 'done' })
    ];

    var result = await handlers.list_tasks({ includeDone: true });
    var tasks = JSON.parse(result.content[0].text);
    var ids = tasks.map(function(t) { return t.id; });

    expect(ids).toContain('active-1');
    expect(ids).toContain('done-1');
  });

  // ── 4. Explicit status filter overrides done-exclusion ────────────────────

  it('filters to only done tasks when status="done"', async function() {
    mockRows = [
      makeRow({ id: 'active-1', text: 'Active task', status: '' }),
      makeRow({ id: 'done-1',   text: 'Done task',   status: 'done' }),
      makeRow({ id: 'done-2',   text: 'Done task 2', status: 'done' })
    ];

    var result = await handlers.list_tasks({ status: 'done' });
    var tasks = JSON.parse(result.content[0].text);
    var ids = tasks.map(function(t) { return t.id; });

    expect(ids).not.toContain('active-1');
    expect(ids).toContain('done-1');
    expect(ids).toContain('done-2');
  });

  it('filters to wip tasks when status="wip"', async function() {
    mockRows = [
      makeRow({ id: 'active-1', text: 'Active', status: '' }),
      makeRow({ id: 'wip-1',    text: 'WIP',    status: 'wip' }),
      makeRow({ id: 'done-1',   text: 'Done',   status: 'done' })
    ];

    var result = await handlers.list_tasks({ status: 'wip' });
    var tasks = JSON.parse(result.content[0].text);
    var ids = tasks.map(function(t) { return t.id; });

    expect(ids).toEqual(['wip-1']);
  });

  // ── 5. Project filter ─────────────────────────────────────────────────────

  it('filters by project name', async function() {
    mockRows = [
      makeRow({ id: 'proj-a-1', text: 'Task A1', status: '', project: 'Alpha' }),
      makeRow({ id: 'proj-b-1', text: 'Task B1', status: '', project: 'Beta' }),
      makeRow({ id: 'proj-a-2', text: 'Task A2', status: '', project: 'Alpha' })
    ];

    var result = await handlers.list_tasks({ project: 'Alpha' });
    var tasks = JSON.parse(result.content[0].text);
    var ids = tasks.map(function(t) { return t.id; });

    expect(ids).toContain('proj-a-1');
    expect(ids).toContain('proj-a-2');
    expect(ids).not.toContain('proj-b-1');
  });

  // ── 6. Limit respected ────────────────────────────────────────────────────

  it('limits results when limit is provided without date', async function() {
    for (var i = 0; i < 5; i++) {
      mockRows.push(makeRow({ id: 'task-' + i, text: 'Task ' + i, status: '' }));
    }

    var result = await handlers.list_tasks({ limit: 2 });
    var tasks = JSON.parse(result.content[0].text);

    expect(tasks.length).toBe(2);
  });

  it('limits results with date filter applied post-fetch', async function() {
    // When date is provided, limit is applied AFTER date-filtering (slice)
    // scheduled_at uses MySQL format ("YYYY-MM-DD HH:MM:SS") so utcToLocal
    // appends "Z" correctly without double-Z corruption.
    // 2026-06-15 16:00:00 UTC = noon Eastern (UTC-4) → ISO date "2026-06-15"
    mockRows = [
      makeRow({ id: 'june-1', text: 'June task 1', status: '', scheduled_at: '2026-06-15 16:00:00', placement_mode: 'all_day' }),
      makeRow({ id: 'june-2', text: 'June task 2', status: '', scheduled_at: '2026-06-15 16:00:00', placement_mode: 'all_day' }),
      makeRow({ id: 'june-3', text: 'June task 3', status: '', scheduled_at: '2026-06-15 16:00:00', placement_mode: 'all_day' }),
      makeRow({ id: 'other',  text: 'Other task',  status: '', scheduled_at: '2026-07-01 16:00:00', placement_mode: 'all_day' })
    ];

    var result = await handlers.list_tasks({ date: '2026-06-15', limit: 2 });
    var tasks = JSON.parse(result.content[0].text);

    // Should return at most 2 (slice applied after date filter)
    expect(tasks.length).toBeLessThanOrEqual(2);
    expect(tasks.length).toBeGreaterThan(0);
    // All returned tasks should match the date
    tasks.forEach(function(t) { expect(t.date).toBe('2026-06-15'); });
  });

  // ── 7. rowToTask mapping — expected fields present ────────────────────────

  it('maps DB row to task object with expected fields', async function() {
    mockRows = [
      makeRow({
        id: 'mapped-1',
        text: 'Mapped task',
        status: 'wip',
        project: 'MyProject',
        dur: 45,
        pri: 'P1',
        notes: 'Some notes',
        url: 'https://example.com',
        when: 'morning',
        day_req: 'weekday',
        recurring: 0,
        split: 0,
        split_min: null,
        depends_on: '["dep-1"]',
        marker: 0
      })
    ];

    var result = await handlers.list_tasks({});
    var tasks = JSON.parse(result.content[0].text);
    expect(tasks.length).toBe(1);

    var t = tasks[0];
    expect(t.id).toBe('mapped-1');
    expect(t.text).toBe('Mapped task');
    expect(t.status).toBe('wip');
    expect(t.project).toBe('MyProject');
    expect(t.dur).toBe(45);
    expect(t.pri).toBe('P1');
    expect(t.notes).toBe('Some notes');
    expect(t.url).toBe('https://example.com');
    expect(t.when).toBe('morning');
    expect(t.dayReq).toBe('weekday');
    expect(t.recurring).toBe(false);
    expect(t.split).toBe(false);
    expect(t.dependsOn).toEqual(['dep-1']);
    expect(t.marker).toBe(false);
    expect(t.taskType).toBe('task');

    // rowToTask always emits these keys (even when null/undefined)
    expect(t).toHaveProperty('scheduledAt');
    expect(t).toHaveProperty('date');
    expect(t).toHaveProperty('time');
    expect(t).toHaveProperty('day');
    expect(t).toHaveProperty('deadline');
    expect(t).toHaveProperty('placementMode');
    expect(t).toHaveProperty('location');
    expect(t).toHaveProperty('tools');
    expect(t).toHaveProperty('sourceId');
    expect(t).toHaveProperty('gcalEventId');
    expect(t).toHaveProperty('msftEventId');
    expect(t).toHaveProperty('appleEventId');
  });

  // ── 8. buildSourceMap — recurring instance inherits template text ──────────

  it('inherits template text in recurring instance via buildSourceMap', async function() {
    var templateId = 'tmpl-001';
    var instanceId = 'inst-001';

    // Template row
    var templateRow = makeRow({
      id: templateId,
      text: 'Template text from template',
      status: '',
      task_type: 'recurring_template',
      recurring: 1,
      source_id: null,
      project: 'RecurProject'
    });

    // Instance row — text is empty; should inherit from template via buildSourceMap
    var instanceRow = makeRow({
      id: instanceId,
      text: 'Instance own text (overridden)',  // will be replaced by template text
      status: '',
      task_type: 'recurring_instance',
      recurring: 0,
      source_id: templateId,
      project: null
    });

    mockRows = [templateRow, instanceRow];

    var result = await handlers.list_tasks({});
    var tasks = JSON.parse(result.content[0].text);

    var instance = tasks.find(function(t) { return t.id === instanceId; });
    expect(instance).toBeDefined();
    // rowToTask merges TEMPLATE_FIELDS from source; 'text' is a template field
    expect(instance.text).toBe('Template text from template');
    expect(instance.project).toBe('RecurProject');
    expect(instance.sourceId).toBe(templateId);
  });

  // ── 9. Empty result returns empty array ───────────────────────────────────

  it('returns empty array when no tasks match', async function() {
    mockRows = [
      makeRow({ id: 'done-1', text: 'Done task', status: 'done' })
    ];

    var result = await handlers.list_tasks({});
    var tasks = JSON.parse(result.content[0].text);

    expect(tasks).toEqual([]);
  });

  // ── 10. Response shape — content array with type text ─────────────────────

  it('returns content array with type=text', async function() {
    mockRows = [makeRow({ id: 'shape-1', text: 'Shape task', status: '' })];

    var result = await handlers.list_tasks({});

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(typeof result.content[0].text).toBe('string');
  });

  // ── 11. skip/cancel/pause/disabled tasks included by default ─────────────

  it('includes skip, cancel, pause, and disabled tasks by default', async function() {
    mockRows = [
      makeRow({ id: 'skip-1',     status: 'skip' }),
      makeRow({ id: 'cancel-1',   status: 'cancel' }),
      makeRow({ id: 'pause-1',    status: 'pause' }),
      makeRow({ id: 'disabled-1', status: 'disabled' }),
      makeRow({ id: 'done-1',     status: 'done' })
    ];

    var result = await handlers.list_tasks({});
    var tasks = JSON.parse(result.content[0].text);
    var ids = tasks.map(function(t) { return t.id; });

    expect(ids).toContain('skip-1');
    expect(ids).toContain('cancel-1');
    expect(ids).toContain('pause-1');
    expect(ids).toContain('disabled-1');
    expect(ids).not.toContain('done-1');
  });

  // ── 12. ZOE-JUG-027-W1: date-only filter (no limit) ─────────────────────
  //
  // utcToLocal returns canonical ISO dates ("YYYY-MM-DD"). list_tasks matches
  // t.date === date, so the date argument must be in the same canonical ISO
  // format. This test uses "2026-06-15" (ISO) — which is what rowToTask
  // emits for 2026-06-15T16:00:00Z in the America/New_York timezone.

  it('filters by date without limit returns all matching tasks', async function() {
    // 2026-06-15T16:00:00Z = noon Eastern (UTC-4) → rowToTask date "2026-06-15"
    // 2026-06-16T16:00:00Z = noon Eastern         → rowToTask date "2026-06-16"
    mockRows = [
      makeRow({ id: 'june15-1', text: 'June 15 task 1', status: '', scheduled_at: '2026-06-15 16:00:00', placement_mode: 'all_day' }),
      makeRow({ id: 'june15-2', text: 'June 15 task 2', status: '', scheduled_at: '2026-06-15 16:00:00', placement_mode: 'all_day' }),
      makeRow({ id: 'june16-1', text: 'June 16 task',   status: '', scheduled_at: '2026-06-16 16:00:00', placement_mode: 'all_day' })
    ];

    var result = await handlers.list_tasks({ date: '2026-06-15' });
    var tasks = JSON.parse(result.content[0].text);
    var ids = tasks.map(function(t) { return t.id; });

    expect(ids).toContain('june15-1');
    expect(ids).toContain('june15-2');
    expect(ids).not.toContain('june16-1');
    // No limit applied — both June-15 tasks returned
    expect(tasks.length).toBe(2);
  });

  // ── 13. ZOE-JUG-027-W2: combined status + project filter ─────────────────

  it('filters by status and project simultaneously', async function() {
    mockRows = [
      makeRow({ id: 'wip-alpha',   text: 'WIP Alpha',   status: 'wip',  project: 'Alpha' }),
      makeRow({ id: 'wip-beta',    text: 'WIP Beta',    status: 'wip',  project: 'Beta'  }),
      makeRow({ id: 'done-alpha',  text: 'Done Alpha',  status: 'done', project: 'Alpha' }),
      makeRow({ id: 'empty-alpha', text: 'Empty Alpha', status: '',     project: 'Alpha' })
    ];

    var result = await handlers.list_tasks({ status: 'wip', project: 'Alpha' });
    var tasks = JSON.parse(result.content[0].text);
    var ids = tasks.map(function(t) { return t.id; });

    expect(ids).toEqual(['wip-alpha']);
    expect(ids).not.toContain('wip-beta');
    expect(ids).not.toContain('done-alpha');
    expect(ids).not.toContain('empty-alpha');
  });
});
