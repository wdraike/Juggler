/**
 * MCP Task Config Tests
 *
 * Tests placement_mode and date_pinned inference in the create_task MCP tool.
 * Uses jest.doMock to intercept DB and task-write dependencies.
 */

// ── Mocks ──

var capturedInsertRow = null;
var capturedUpdateRow = null;

jest.mock('../src/db', function() {
  var fn = { now: function() { return 'MOCK_NOW'; } };
  var mock = function(tableName) {
    // Allow per-table first() resolution for user_config / projects
    mock._table = tableName;
    return mock;
  };
  mock.fn = fn;
  mock.where = function() { return mock; };
  mock.whereIn = function() { return mock; };
  mock.select = function() {
    var arr = mock._table === 'tasks_with_sync_v' ? (mock._tasksWithSyncRows || []) : [];
    var p = Promise.resolve(arr);
    p.first = function() {
      if (mock._table === 'users') return Promise.resolve({ timezone: 'America/New_York' });
      if (mock._table === 'user_config') return Promise.resolve({ config_value: JSON.stringify({ splitDefault: false }) });
      if (mock._table === 'projects') return Promise.resolve(null);
      if (mock._table === 'tasks_with_sync_v') return Promise.resolve(mock._tasksWithSyncFirst || { id: 'mock-uuid-007', text: 'synced' });
      return Promise.resolve(null);
    };
    return p;
  };
  mock.first = function() {
    if (mock._table === 'users') return Promise.resolve({ timezone: 'America/New_York' });
    if (mock._table === 'user_config') return Promise.resolve({ config_value: JSON.stringify({ splitDefault: false }) });
    if (mock._table === 'projects') return Promise.resolve(null); // project not found → insert will be called
    if (mock._table === 'tasks_with_sync_v') return Promise.resolve(mock._tasksWithSyncFirst || { id: 'mock-uuid-007', text: 'synced' });
    return Promise.resolve(null);
  };
  mock.insert = function() { return Promise.resolve([1]); };
  mock.update = function() { return Promise.resolve(0); };
  mock.transaction = function(cb) { return cb(mock); };
  return mock;
});

jest.mock('../src/lib/tasks-write', function() {
  return {
    insertTask: function(_db, row) {
      capturedInsertRow = row;
      return Promise.resolve();
    },
    updateTaskById: function(_db, _id, row) {
      capturedUpdateRow = row;
      return Promise.resolve();
    }
  };
});

jest.mock('../src/scheduler/scheduleQueue', function() {
  return {
    enqueueScheduleRun: function() {}
  };
});

jest.mock('../src/lib/task-write-queue', function() {
  return {
    isLocked: function() { return Promise.resolve(false); },
    enqueueWrite: function() { return Promise.resolve(); },
    splitFields: function() { return {}; }
  };
});

jest.mock('../src/lib/sse-emitter', function() {
  return {
    emitTasksChanged: function() {}
  };
});

jest.mock('uuid', function() {
  return { v7: function() { return 'mock-uuid-007'; } };
});

var { registerTaskTools } = require('../src/mcp/tools/tasks');

// Helper to capture the create_task tool handler by name
function getCreateTaskHandler() {
  var handlers = {};
  var mockServer = {
    tool: function(name, _desc, _schema, h) {
      handlers[name] = h;
    }
  };
  registerTaskTools(mockServer, 'test-user-001');
  if (!handlers['create_task']) throw new Error('create_task handler not captured');
  return handlers['create_task'];
}

function getBatchUpdateTaskHandler() {
  var handlers = {};
  var mockServer = {
    tool: function(name, _desc, _schema, h) {
      handlers[name] = h;
    }
  };
  registerTaskTools(mockServer, 'test-user-001');
  if (!handlers['batch_update_tasks']) throw new Error('batch_update_tasks handler not captured');
  return handlers['batch_update_tasks'];
}

// ── Tests ──

describe('create_task placement_mode and date_pinned inference', function() {
  var handler;

  beforeEach(function() {
    capturedInsertRow = null;
    handler = getCreateTaskHandler();
  });

  test('explicit placementMode time_window + date + time → row.placement_mode = time_window, date_pinned auto-set (date+time triggers pin)', async function() {
    await handler({
      text: 'Explicit time_window',
      placementMode: 'time_window',
      date: '2026-05-20',
      time: '2:00 PM'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('time_window');
    // datePinned was omitted, so auto-pin should fire because date+time provided
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('explicit datePinned:false + date → row.date_pinned = 0, placement_mode = all_day (inferred)', async function() {
    await handler({
      text: 'Unpinned date-only',
      datePinned: false,
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.date_pinned).toBe(0);
    expect(capturedInsertRow.placement_mode).toBe('all_day');
  });

  test('no placementMode, no datePinned, date only → row.placement_mode = all_day, date_pinned = 1 (default)', async function() {
    await handler({
      text: 'Date only defaults',
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('all_day');
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('no placementMode, time + date → row.placement_mode = fixed, date_pinned = 1 (default)', async function() {
    await handler({
      text: 'Date and time defaults',
      date: '2026-05-20',
      time: '3:30 PM'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('fixed');
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('placementMode:anytime + date → row.placement_mode = anytime, date_pinned = 1 (date triggers pin unless caller set datePinned:false)', async function() {
    await handler({
      text: 'Anytime with date',
      placementMode: 'anytime',
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('anytime');
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('placementMode:anytime + date + explicit datePinned:false → row.placement_mode = anytime, date_pinned = 0', async function() {
    await handler({
      text: 'Anytime unpinned',
      placementMode: 'anytime',
      date: '2026-05-20',
      datePinned: false
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('anytime');
    expect(capturedInsertRow.date_pinned).toBe(0);
  });

  test('scheduledAt only (no date/time) → row.placement_mode = fixed, date_pinned = 1', async function() {
    await handler({
      text: 'UTC scheduled',
      scheduledAt: '2026-05-20T18:00:00Z'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('fixed');
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('no date, no time, no scheduledAt → placement_mode not set (DB default anytime), date_pinned undefined', async function() {
    await handler({
      text: 'No scheduling info'
    });
    expect(capturedInsertRow).toBeDefined();
    // MCP create_task does not backstop placement_mode to 'anytime' when no scheduling fields are given;
    // the DB default handles it.
    expect(capturedInsertRow.placement_mode).toBeUndefined();
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('explicit placementMode:fixed + date → row.placement_mode = fixed, date_pinned = 1 (auto-pin)', async function() {
    await handler({
      text: 'Explicit fixed',
      placementMode: 'fixed',
      date: '2026-05-20',
      time: '10:00 AM'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('fixed');
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('explicit placementMode:all_day + date → row.placement_mode = all_day, date_pinned = 1 (auto-pin)', async function() {
    await handler({
      text: 'Explicit all_day',
      placementMode: 'all_day',
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('all_day');
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('explicit placementMode:time_blocks + date → row.placement_mode = time_blocks, date_pinned = 1 (auto-pin)', async function() {
    await handler({
      text: 'Explicit time_blocks',
      placementMode: 'time_blocks',
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('time_blocks');
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('datePinned:true without date/time still sets date_pinned (caller intent flows through)', async function() {
    await handler({
      text: 'Pinned but no date',
      datePinned: true
    });
    expect(capturedInsertRow).toBeDefined();
    // auto-pin rule only fires when date || time || scheduledAt present AND datePinned === undefined
    // taskToRow will set date_pinned because task.datePinned === true
    expect(capturedInsertRow.date_pinned).toBe(1);
  });

  test('placementMode:fixed without date/time/scheduledAt → validation error', async function() {
    var result = await handler({
      text: 'Fixed no date',
      placementMode: 'fixed'
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode "fixed" requires a date, time, or scheduledAt/i);
  });

  test('placementMode:invalid_value → falls back to anytime', async function() {
    await handler({
      text: 'Invalid placement mode',
      placementMode: 'invalid_value'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('anytime');
  });
});

describe('batch_update_tasks calendar-sync guard', function() {
  var handler;
  var mockDb;

  beforeEach(function() {
    handler = getBatchUpdateTaskHandler();
    mockDb = require('../src/db');
    mockDb._tasksWithSyncRows = [];
    capturedUpdateRow = null;
  });

  test('calendar-synced task with blocked fields → error', async function() {
    mockDb._tasksWithSyncRows = [{ id: 'task-1', gcal_event_id: 'gcal-1' }];
    var result = await handler({
      updates: [{ id: 'task-1', datePinned: true }]
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/synced from an external calendar/i);
    expect(result.content[0].text).toMatch(/Blocked fields: datePinned/i);
  });

  test('calendar-synced task with only status and notes → allowed', async function() {
    mockDb._tasksWithSyncRows = [{ id: 'task-1', gcal_event_id: 'gcal-1' }];
    mockDb._tasksWithSyncFirst = { id: 'task-1', text: 'Synced task', task_type: 'task', scheduled_at: null };
    var result = await handler({
      updates: [{ id: 'task-1', status: 'done', notes: 'Updated note' }]
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/updated/i);
  });
});
