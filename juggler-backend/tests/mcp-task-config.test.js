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

// After the datePinned/date_pinned removal, placement_mode is the sole
// immovability signal. date_pinned is no longer written by taskToRow or MCP.
describe('create_task placement_mode inference', function() {
  var handler;

  beforeEach(function() {
    capturedInsertRow = null;
    handler = getCreateTaskHandler();
  });

  test('explicit placementMode time_window + date + time → row.placement_mode = time_window', async function() {
    await handler({
      text: 'Explicit time_window',
      placementMode: 'time_window',
      date: '2026-05-20',
      time: '2:00 PM'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('time_window');
    // date_pinned no longer written by MCP/taskToRow
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('no placementMode, date only → row.placement_mode = all_day (inferred)', async function() {
    await handler({
      text: 'Date only defaults',
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('all_day');
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('no placementMode, time + date → row.placement_mode is not changed by MCP (taskToRow sets fixed when placementMode explicitly given)', async function() {
    await handler({
      text: 'Date and time no placementMode',
      date: '2026-05-20',
      time: '3:30 PM'
    });
    expect(capturedInsertRow).toBeDefined();
    // With no explicit placementMode and time set, MCP doesn't infer all_day
    // (the time-was-set guard skips the all_day inference).
    // placement_mode is left undefined — DB default (anytime) applies.
    expect(capturedInsertRow.placement_mode).toBeUndefined();
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('placementMode:anytime + date → row.placement_mode = anytime', async function() {
    await handler({
      text: 'Anytime with date',
      placementMode: 'anytime',
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('anytime');
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('scheduledAt only → row.placement_mode = fixed', async function() {
    await handler({
      text: 'UTC scheduled',
      scheduledAt: '2026-05-20T18:00:00Z',
      placementMode: 'fixed'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('fixed');
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('no date, no time, no scheduledAt → placement_mode not set (DB default anytime)', async function() {
    await handler({
      text: 'No scheduling info'
    });
    expect(capturedInsertRow).toBeDefined();
    // MCP create_task does not backstop placement_mode to 'anytime' when no scheduling fields are given;
    // the DB default handles it.
    expect(capturedInsertRow.placement_mode).toBeUndefined();
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('explicit placementMode:fixed + date + time → row.placement_mode = fixed', async function() {
    await handler({
      text: 'Explicit fixed',
      placementMode: 'fixed',
      date: '2026-05-20',
      time: '10:00 AM'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('fixed');
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('explicit placementMode:all_day + date → row.placement_mode = all_day', async function() {
    await handler({
      text: 'Explicit all_day',
      placementMode: 'all_day',
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('all_day');
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('explicit placementMode:time_blocks + date → row.placement_mode = time_blocks', async function() {
    await handler({
      text: 'Explicit time_blocks',
      placementMode: 'time_blocks',
      date: '2026-05-20'
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.placement_mode).toBe('time_blocks');
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('datePinned input field is ignored — no date_pinned written to row', async function() {
    // datePinned is no longer a recognized taskToRow field; it is silently dropped.
    await handler({
      text: 'Pinned but no date',
      datePinned: true
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.date_pinned).toBeUndefined();
  });

  test('placementMode:fixed without date/time → validation error', async function() {
    var result = await handler({
      text: 'Fixed no date',
      placementMode: 'fixed'
    });
    expect(result.isError).toBe(true);
    // validateTaskInput fires first with the cross-field check message
    expect(result.content[0].text).toMatch(/placementMode "fixed" requires a date.*time/i);
  });

  test('placementMode:invalid_value → validation error (rejected before insert)', async function() {
    var result = await handler({
      text: 'Invalid placement mode',
      placementMode: 'invalid_value'
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/placementMode.*is not valid/i);
    expect(capturedInsertRow).toBeNull();
  });
});

// ── W-W3: rigid field rejected/ignored by MCP ─────────────────────────────
//
// `rigid` is not declared in the MCP tool schema and was dropped in Phase 4.
// Sending it in create_task must not write a `rigid` column to the DB row.

describe('create_task rigid field (W-W3)', function() {
  var handler;

  beforeEach(function() {
    capturedInsertRow = null;
    handler = getCreateTaskHandler();
  });

  test('rigid:true in payload is silently ignored — not written to DB row', async function() {
    await handler({
      text: 'Task with rigid',
      date: '2026-05-20',
      rigid: true
    });
    expect(capturedInsertRow).toBeDefined();
    // rigid must not appear on the row — it was removed and is not a valid column
    expect(capturedInsertRow.rigid).toBeUndefined();
  });

  test('rigid:false in payload is silently ignored — not written to DB row', async function() {
    await handler({
      text: 'Task with rigid false',
      date: '2026-05-20',
      rigid: false
    });
    expect(capturedInsertRow).toBeDefined();
    expect(capturedInsertRow.rigid).toBeUndefined();
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
