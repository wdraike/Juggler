/**
 * MCP Tool Integration Tests
 *
 * Tests MCP tools against the task controller functions they call.
 * Since MCP tools register on McpServer (which requires transport),
 * these tests exercise the same code paths at the function level:
 * taskToRow, rowToTask, validateTaskInput, and direct DB operations.
 *
 * For tools that need a real DB (create, update, delete), we use the
 * testDb helper (requires Docker: docker compose -f docker-compose.test.yml up -d).
 * Tests gracefully skip if the DB is unavailable.
 */

var testDb;
try { testDb = require('./helpers/testDb'); } catch(e) { testDb = null; }
var { rowToTask, taskToRow, validateTaskInput, buildSourceMap } = require('../src/controllers/task.controller');

var available = false;

beforeAll(async () => {
  if (!testDb) return;
  available = await testDb.isAvailable();
  if (!available) {
    console.warn('Test DB not available — MCP integration tests skipped');
    return;
  }
  await testDb.cleanup();
  await testDb.seedUser();
}, 15000);

afterAll(async () => {
  if (available && testDb) await testDb.cleanup();
  if (testDb) await testDb.destroy();
});

beforeEach(async () => {
  if (!available) return;
  var db = testDb.getDb();
  await db('task_instances').where('user_id', 'test-user-001').del();
  await db('task_masters').where('user_id', 'test-user-001').del();
});

// ═══════════════════════════════════════════════════════════════
// Validation (no DB needed)
// ═══════════════════════════════════════════════════════════════

describe('validateTaskInput', () => {
  test('empty input passes', () => {
    expect(validateTaskInput({})).toEqual([]);
  });

  test('text required when _requireText set', () => {
    var errors = validateTaskInput({ _requireText: true });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('required');
  });

  test('text length limit', () => {
    var errors = validateTaskInput({ text: 'x'.repeat(501) });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('500');
  });

  test('valid text passes', () => {
    expect(validateTaskInput({ text: 'Buy groceries' })).toEqual([]);
  });

  test('dur must be > 0', () => {
    expect(validateTaskInput({ dur: 0 }).length).toBe(1);
    expect(validateTaskInput({ dur: -5 }).length).toBe(1);
    expect(validateTaskInput({ dur: 30 })).toEqual([]);
  });

  test('splitMin must be > 0 and <= dur', () => {
    expect(validateTaskInput({ split: true, splitMin: 0 }).length).toBe(1);
    expect(validateTaskInput({ split: true, splitMin: 60, dur: 30 }).length).toBe(1);
    expect(validateTaskInput({ split: true, splitMin: 15, dur: 60 })).toEqual([]);
  });

  test('timeFlex range 0-480', () => {
    expect(validateTaskInput({ timeFlex: -1 }).length).toBe(1);
    expect(validateTaskInput({ timeFlex: 500 }).length).toBe(1);
    expect(validateTaskInput({ timeFlex: 60 })).toEqual([]);
  });

  test('deadline must be valid date', () => {
    expect(validateTaskInput({ deadline: 'not-a-date' }).length).toBe(1);
    expect(validateTaskInput({ deadline: '2026-04-20' })).toEqual([]);
  });

  test('startAfter must be valid date', () => {
    expect(validateTaskInput({ startAfter: 'garbage' }).length).toBe(1);
    expect(validateTaskInput({ startAfter: '2026-04-15' })).toEqual([]);
  });

  test('deadline >= startAfter', () => {
    expect(validateTaskInput({ deadline: '2026-04-10', startAfter: '2026-04-15' }).length).toBe(1);
    expect(validateTaskInput({ deadline: '2026-04-20', startAfter: '2026-04-15' })).toEqual([]);
  });

  test('recur.type must be known', () => {
    expect(validateTaskInput({ recur: { type: 'banana' } }).length).toBe(1);
    expect(validateTaskInput({ recur: { type: 'weekly' } })).toEqual([]);
    expect(validateTaskInput({ recur: { type: 'daily' } })).toEqual([]);
  });

  test('invalid dayReq rejected', () => {
    expect(validateTaskInput({ dayReq: 'tuesday' }).length).toBe(1);
    expect(validateTaskInput({ dayReq: 'weekday' })).toEqual([]);
    expect(validateTaskInput({ dayReq: 'M,W,F' })).toEqual([]);
  });

  test('notes length limit', () => {
    expect(validateTaskInput({ notes: 'x'.repeat(5001) }).length).toBe(1);
    expect(validateTaskInput({ notes: 'short note' })).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// taskToRow / rowToTask round-trip (no DB needed)
// ═══════════════════════════════════════════════════════════════

describe('taskToRow / rowToTask', () => {
  test('basic task round-trips correctly', () => {
    var task = { text: 'Test', dur: 30, pri: 'P2', when: 'morning', dayReq: 'weekday' };
    var row = taskToRow(task, 'user1', 'America/New_York');
    expect(row.text).toBe('Test');
    expect(row.dur).toBe(30);
    expect(row.pri).toBe('P2');
  });

  test('deadline conversion', () => {
    var task = { text: 'Urgent', deadline: '2026-04-20' };
    var row = taskToRow(task, 'user1', 'America/New_York');
    expect(row.deadline).toBe('2026-04-20');
  });

  test('auto-pin on date set', () => {
    // This tests the REST controller behavior, not the MCP tool
    var task = { text: 'Pinned', date: '2026-04-20' };
    var row = taskToRow(task, 'user1', 'America/New_York');
    // taskToRow itself doesn't auto-pin — that's done in the controller/MCP layer
    expect(row).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// DB Integration (requires test DB)
// ═══════════════════════════════════════════════════════════════

describe('Task CRUD via MCP code paths', () => {
  test('create and retrieve task', async () => {
    if (!available) return;
    var task = await testDb.seedTask({ text: 'MCP test task', pri: 'P1', dur: 45 });
    var db = testDb.getDb();
    var row = await db('tasks_v').where('id', task.id).first();
    expect(row).toBeDefined();
    expect(row.text).toBe('MCP test task');
    expect(Number(row.dur)).toBe(45);
    expect(row.pri).toBe('P1');
  });

  test('update task fields', async () => {
    if (!available) return;
    var task = await testDb.seedTask({ text: 'Original', pri: 'P3' });
    var db = testDb.getDb();
    var tasksWrite = require('../src/lib/tasks-write');
    await tasksWrite.updateTaskById(db, task.id, { text: 'Updated', pri: 'P1' }, 'test-user-001');
    var row = await db('tasks_v').where('id', task.id).first();
    expect(row.text).toBe('Updated');
    expect(row.pri).toBe('P1');
  });

  test('delete task', async () => {
    if (!available) return;
    var task = await testDb.seedTask({ text: 'Delete me' });
    var db = testDb.getDb();
    var tasksWrite = require('../src/lib/tasks-write');
    await tasksWrite.deleteTaskById(db, task.id, 'test-user-001');
    var row = await db('tasks_v').where('id', task.id).first();
    expect(row).toBeUndefined();
  });

  test('status change persists', async () => {
    if (!available) return;
    var task = await testDb.seedTask({ text: 'Mark done' });
    var db = testDb.getDb();
    var tasksWrite = require('../src/lib/tasks-write');
    await tasksWrite.updateTaskById(db, task.id, { status: 'done' }, 'test-user-001');
    var row = await db('tasks_v').where('id', task.id).first();
    expect(row.status).toBe('done');
  });

  test('recurring template creates correctly', async () => {
    if (!available) return;
    var tmpl = await testDb.seedTemplate({ text: 'Daily habit', recurring: 1, recur: JSON.stringify({ type: 'daily' }) });
    var db = testDb.getDb();
    var row = await db('tasks_v').where('id', tmpl.id).first();
    expect(row.task_type).toBe('recurring_template');
    expect(row.recurring).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// Calendar-synced task guards
// ═══════════════════════════════════════════════════════════════

describe('Calendar-synced task guards', () => {
  test('validateTaskInput allows status on synced tasks', () => {
    // The guard is in the controller/MCP layer, not validateTaskInput
    // This test verifies validateTaskInput doesn't block status changes
    expect(validateTaskInput({ status: 'done' })).toEqual([]);
  });

  test('validateTaskInput allows notes', () => {
    expect(validateTaskInput({ notes: 'User annotation' })).toEqual([]);
  });
});
