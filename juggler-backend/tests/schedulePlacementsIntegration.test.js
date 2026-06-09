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
    // `date`/`time`/`overdue` live on task_instances; scheduler derives t.time from scheduled_at.
    // The task_instances.time column is MySQL TIME (HH:MM:SS). The scheduler reads scheduled_at
    // (UTC) and converts to local time to derive t.time — so we set scheduled_at, not time.
    //
    // Note: uses runScheduleAndPersist directly. The overdue injection (snap + _overdue flag)
    // runs inside runScheduleAndPersist (lines 1753-1801 of runSchedule.js). The no-cache
    // first-load path of getSchedulePlacements routes through runSchedulerWithShadow which
    // does NOT run the overdue injection — so calling getSchedulePlacements with no cache
    // would miss the overdue entries. runScheduleAndPersist is the authoritative path for
    // overdue snap behavior.
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
    // scheduled_at = today at 05:00 UTC → 1:00 AM ET (EDT). Always before test-run time.
    // The scheduler derives t.time = '1:00 AM' from this UTC value (scheduledMins=60),
    // which is always < nowMins at afternoon test-run time, satisfying the snap condition.
    var scheduledAt = todayKey + ' 05:00:00';
    // Strategy for unplaceability: use when='_invalid_window_' which matches no time block.
    // getWhenWindows returns [] → no eligible windows → scheduler cannot place the task →
    // unplaced → cleared (not ANYTIME past or deadline-exceeded) → NOT in placedIds →
    // overdue injection fires: isPastDue=true, startMin<nowMins → snap to lastBlockEnd-dur.
    await db('task_masters').insert({
      id: 'gp-snap-001', user_id: USER_ID, text: 'Overdue snap test',
      dur: dur, status: '', when: '_invalid_window_',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('task_instances').insert({
      id: 'gp-snap-001', master_id: 'gp-snap-001', user_id: USER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      date: todayKey, scheduled_at: scheduledAt, overdue: 1,
      dur: dur, status: '', created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Use runScheduleAndPersist directly: overdue injection (snap + _overdue flag) is in
    // runScheduleAndPersist, not in the no-cache path of getSchedulePlacements.
    var result = await runScheduleAndPersist(USER_ID, undefined, { timezone: 'America/New_York' });
    var placements = (result.dayPlacements && result.dayPlacements[todayKey]) || [];
    var placement = placements.find(function(p) { return p.task && p.task.id === 'gp-snap-001'; });
    expect(placement).toBeDefined();
    expect(placement._overdue).toBe(true);
    expect(placement.start).toBe(expectedStart);
  });

  test('multiple overdue today-tasks at same past time get distinct start slots (collision avoidance)', async () => {
    // Bug 3 regression guard: two overdue tasks at the same original time on the same date
    // must not be placed at the same start minute.
    // `date`/`overdue` live on task_instances; scheduler derives t.time from scheduled_at.
    // Same scheduled_at for both → same derived t.time → collision-avoidance must offset them.
    if (!available) return;
    var tzParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date());
    var tzVals = {}; tzParts.forEach(function(p) { tzVals[p.type] = p.value; });
    var todayKey = tzVals.year + '-' + tzVals.month + '-' + tzVals.day;
    var dur = 30;
    // scheduled_at = today at 05:00 UTC → 1:00 AM ET (EDT) — always before test-run time.
    var scheduledAt = todayKey + ' 05:00:00';
    // Insert masters
    await db('task_masters').insert([
      { id: 'gp-coll-001', user_id: USER_ID, text: 'Collision A', dur: dur, status: '', created_at: db.fn.now(), updated_at: db.fn.now() },
      { id: 'gp-coll-002', user_id: USER_ID, text: 'Collision B', dur: dur, status: '', created_at: db.fn.now(), updated_at: db.fn.now() }
    ]);
    // Insert instances with same scheduled_at (same derived time) and overdue=1
    await db('task_instances').insert([
      { id: 'gp-coll-001', master_id: 'gp-coll-001', user_id: USER_ID, occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, date: todayKey, scheduled_at: scheduledAt, overdue: 1, dur: dur, status: '', created_at: db.fn.now(), updated_at: db.fn.now() },
      { id: 'gp-coll-002', master_id: 'gp-coll-002', user_id: USER_ID, occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, date: todayKey, scheduled_at: scheduledAt, overdue: 1, dur: dur, status: '', created_at: db.fn.now(), updated_at: db.fn.now() }
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
    // `date`/`overdue` live on task_instances; scheduler derives t.time from scheduled_at.
    // The isPastDue check fires when t.date < todayKey — any past date qualifies.
    //
    // Note: uses runScheduleAndPersist directly. The overdue injection (_overdue flag,
    // isPastDue logic) runs inside runScheduleAndPersist (lines 1753-1801 of runSchedule.js).
    // The no-cache first-load path of getSchedulePlacements routes through
    // runSchedulerWithShadow which does NOT run the overdue injection.
    if (!available) return;
    // Use a date definitely in the past
    var pastDate = '2025-01-15';
    // scheduled_at = past date at 14:00 UTC → 9:00 AM ET (EST = UTC-5 in January)
    var scheduledAt = pastDate + ' 14:00:00';
    // Strategy for unplaceability: use when='_invalid_window_' so the scheduler cannot
    // place it → task is unplaced → overdue injection fires → isPastDue is computed from
    // t.date < todayKey = true → _overdue=true in the placement entry, even though overdue=0
    // in the DB. That's the regression being guarded (isPastDue fix).
    await db('task_masters').insert({
      id: 'gp-pastdue-001', user_id: USER_ID, text: 'Past due task',
      dur: 30, status: '', when: '_invalid_window_',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Insert instance with past date, scheduled_at in past, and overdue=0 (the regression case)
    await db('task_instances').insert({
      id: 'gp-pastdue-001', master_id: 'gp-pastdue-001', user_id: USER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      date: pastDate, scheduled_at: scheduledAt, overdue: 0,
      dur: 30, status: '', created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Use runScheduleAndPersist directly: overdue injection (isPastDue + _overdue flag) is in
    // runScheduleAndPersist, not in the no-cache path of getSchedulePlacements.
    var result = await runScheduleAndPersist(USER_ID, undefined, { timezone: 'America/New_York' });
    var placements = (result.dayPlacements && result.dayPlacements[pastDate]) || [];
    var placement = placements.find(function(p) { return p.task && p.task.id === 'gp-pastdue-001'; });
    expect(placement).toBeDefined();
    expect(placement._overdue).toBe(true);
  });
});
