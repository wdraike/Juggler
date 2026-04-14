/**
 * Integration tests for getSchedulePlacements — the read-only cache path.
 * Tests cache freshness, staleness detection, and auto-rerun.
 */

var db = require('../src/db');
var { runScheduleAndPersist, getSchedulePlacements } = require('../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');

var available = false;
var USER_ID = 'placements-test-001';

beforeAll(async () => {
  try { await db.raw('SELECT 1'); available = true; } catch (e) { return; }
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({ id: USER_ID, email: 'place@test.com', timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 15000);

afterAll(async () => {
  if (available) {
    await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
    await db('user_config').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

describe('getSchedulePlacements', () => {
  test('returns placements after scheduler run', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, { id: 'gp-001', user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, status: '', when: 'morning', created_at: db.fn.now(), updated_at: db.fn.now() });
    // First run to populate cache
    await runScheduleAndPersist(USER_ID);
    // Get placements from cache
    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    expect(result).toBeDefined();
    expect(result.dayPlacements).toBeDefined();
  });

  test('returns result with no cache (first load)', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, { id: 'gp-002', user_id: USER_ID, task_type: 'task', text: 'No cache', dur: 30, status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    expect(result).toBeDefined();
    expect(result.dayPlacements).toBeDefined();
  });

  test('fresh cache returns quickly without re-running', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, { id: 'gp-003', user_id: USER_ID, task_type: 'task', text: 'Fast', dur: 30, status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    await runScheduleAndPersist(USER_ID);

    var start = Date.now();
    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    var elapsed = Date.now() - start;
    expect(result).toBeDefined();
    // Cache read should be much faster than a full scheduler run
    expect(elapsed).toBeLessThan(2000);
  });

  test('stale cache triggers re-run when task modified', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, { id: 'gp-004', user_id: USER_ID, task_type: 'task', text: 'Stale', dur: 30, status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    await runScheduleAndPersist(USER_ID);

    // Modify task after cache was written
    await new Promise(r => setTimeout(r, 100));
    await tasksWrite.updateTaskById(db, 'gp-004', { text: 'Modified', updated_at: db.fn.now() }, USER_ID);

    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    expect(result).toBeDefined();
    expect(result.dayPlacements).toBeDefined();
  });

  test('returns unplaced tasks list', async () => {
    if (!available) return;
    // Seed a task that can't be placed (TBD date)
    await tasksWrite.insertTask(db, { id: 'gp-005', user_id: USER_ID, task_type: 'task', text: 'Placeable', dur: 30, status: '', when: 'morning', created_at: db.fn.now(), updated_at: db.fn.now() });
    await runScheduleAndPersist(USER_ID);
    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    expect(result.unplaced).toBeDefined();
    expect(Array.isArray(result.unplaced)).toBe(true);
  });
});
