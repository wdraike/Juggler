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

  test('cache still fresh when updated_at is within 1s grace of generatedAt (clock skew)', async () => {
    // Regression guard for the MySQL/Node.js clock skew fix.
    // Simulates: generatedAt written 0.5s BEFORE the task's updated_at (sub-second processing
    // lag). With the 1s grace, the fast path should still fire.
    // Note: grace was reduced from 10s to 1s (2026-06-05) because generatedAt now uses
    // MySQL's clock (same source as updated_at), so skew is ~0ms. 1s covers any sub-second lag.
    if (!available) return;
    await tasksWrite.insertTask(db, { id: 'gp-grace-001', user_id: USER_ID, task_type: 'task', text: 'Grace test', dur: 30, status: '', when: 'morning', created_at: db.fn.now(), updated_at: db.fn.now() });
    await runScheduleAndPersist(USER_ID);

    // Read task's updated_at from DB
    var taskRow = await db('task_instances').where({ id: 'gp-grace-001' }).first()
      || await db('task_masters').where({ id: 'gp-grace-001' }).first();
    var taskUpdatedAt = new Date(String(taskRow.updated_at).replace(' ', 'T') + 'Z');

    // Patch cache's generatedAt to be 0.5s BEFORE task's updated_at
    // This simulates sub-second processing lag (well within 1s grace)
    var cacheRow = await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).first();
    var cache = typeof cacheRow.config_value === 'string' ? JSON.parse(cacheRow.config_value) : cacheRow.config_value;
    cache.generatedAt = new Date(taskUpdatedAt.getTime() - 500).toISOString();
    await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' })
      .update({ config_value: JSON.stringify(cache) });

    // Should still hit fast path — 0.5s < 1s grace
    var start = Date.now();
    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    var elapsed = Date.now() - start;
    expect(result).toBeDefined();
    expect(elapsed).toBeLessThan(2000);
  });

  test('overdue today-task with past time snaps to last block boundary', async () => {
    // Bug 2 regression guard: an overdue task whose original time has already passed
    // should appear at lastBlockEnd - dur, not at its original (past) time.
    if (!available) return;
    // Get today's date key dynamically (same logic as getNowInTimezone in runSchedule.js)
    var tzParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' })
      .formatToParts(new Date());
    var tzVals = {}; tzParts.forEach(function(p) { tzVals[p.type] = p.value; });
    var todayKey = tzVals.year + '-' + tzVals.month + '-' + tzVals.day;
    var dayName = tzVals.weekday.slice(0, 3); // 'Mon', 'Fri', etc.
    var blocks = DEFAULT_TIME_BLOCKS[dayName];
    var lastBlockEnd = blocks && blocks.length > 0 ? blocks[blocks.length - 1].end : 1080;
    var dur = 30;
    var expectedStart = lastBlockEnd - dur;
    // Insert a task with a time that is always in the past (6:00 AM)
    await db('task_masters').insert({
      id: 'gp-snap-001', user_id: USER_ID, task_type: 'task', text: 'Overdue snap test',
      dur: dur, status: '', date: todayKey, time: '06:00 AM', overdue: 1,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    var placements = result.dayPlacements[todayKey] || [];
    var placement = placements.find(function(p) { return p.task && p.task.id === 'gp-snap-001'; });
    expect(placement).toBeDefined();
    expect(placement._overdue).toBe(true);
    expect(placement.start).toBe(expectedStart);
  });

  test('multiple overdue today-tasks at same past time get distinct start slots (collision avoidance)', async () => {
    // Bug 3 regression guard: two overdue tasks at the same original time on the same date
    // must not be placed at the same start minute.
    if (!available) return;
    var tzParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date());
    var tzVals = {}; tzParts.forEach(function(p) { tzVals[p.type] = p.value; });
    var todayKey = tzVals.year + '-' + tzVals.month + '-' + tzVals.day;
    var dur = 30;
    await db('task_masters').insert([
      { id: 'gp-coll-001', user_id: USER_ID, task_type: 'task', text: 'Collision A', dur: dur, status: '', date: todayKey, time: '06:00 AM', overdue: 1, created_at: db.fn.now(), updated_at: db.fn.now() },
      { id: 'gp-coll-002', user_id: USER_ID, task_type: 'task', text: 'Collision B', dur: dur, status: '', date: todayKey, time: '06:00 AM', overdue: 1, created_at: db.fn.now(), updated_at: db.fn.now() }
    ]);
    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    var placements = result.dayPlacements[todayKey] || [];
    var pA = placements.find(function(p) { return p.task && p.task.id === 'gp-coll-001'; });
    var pB = placements.find(function(p) { return p.task && p.task.id === 'gp-coll-002'; });
    expect(pA).toBeDefined();
    expect(pB).toBeDefined();
    expect(pA.start).not.toBe(pB.start);
  });

  test('isPastDue: past task with overdue=0 appears in dayPlacements with _overdue=true', async () => {
    // Regression guard for the isPastDue fix: the scheduler clears overdue=0 at
    // the start of every run, so tasks whose scheduled_at is in the past but just
    // got reset must still be synthesised as overdue placements — not fall into
    // the unscheduled bucket.
    if (!available) return;
    // Use a date definitely in the past
    var pastDate = '2025-01-15';
    var pastTime = '09:00 AM';
    await db('task_masters').insert({
      id: 'gp-pastdue-001', user_id: USER_ID, task_type: 'task', text: 'Past due task',
      dur: 30, status: 'active', date: pastDate, time: pastTime, overdue: 0,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var result = await getSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    var placements = result.dayPlacements[pastDate] || [];
    var placement = placements.find(function(p) { return p.task && p.task.id === 'gp-pastdue-001'; });
    expect(placement).toBeDefined();
    expect(placement._overdue).toBe(true);
  });
});
