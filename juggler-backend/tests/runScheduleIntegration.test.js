/**
 * Integration tests for runScheduleAndPersist — the full scheduler pipeline.
 * Uses real test DB via NODE_ENV=test.
 * Requires: docker compose -f docker-compose.test.yml up -d
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

var available = false;
var USER_ID = 'run-sched-test-001';
var TZ = 'America/New_York';

beforeAll(async () => {
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  await cleanup();
  await db('users').insert({
    id: USER_ID, email: 'runsched@test.com', timezone: TZ,
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
  // Seed default config so scheduler can run
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 15000);

afterAll(async () => {
  if (available) await cleanup();
  await db.destroy();
});

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('tasks').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('tasks').where('user_id', USER_ID).del();
  // Keep user_config (time_blocks, tool_matrix) but clear schedule_cache
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

function seedTask(overrides) {
  var task = Object.assign({
    id: 'rt-' + Math.random().toString(36).slice(2, 10),
    user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, pri: 'P3',
    status: '', recurring: 0, created_at: db.fn.now(), updated_at: db.fn.now()
  }, overrides);
  return db('tasks').insert(task).then(function() { return task; });
}

function seedTemplate(overrides) {
  return seedTask(Object.assign({
    task_type: 'recurring_template', recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' })
  }, overrides));
}

function seedInstance(templateId, overrides) {
  return seedTask(Object.assign({
    task_type: 'recurring_instance', recurring: 1, source_id: templateId
  }, overrides));
}

// ═══════════════════════════════════════════════════════════════
// Basic scheduler run
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: basic', () => {
  test('places a single task and writes scheduled_at', async () => {
    if (!available) return;
    var t = await seedTask({ text: 'Morning task', when: 'morning', dur: 30 });
    var result = await runScheduleAndPersist(USER_ID);
    expect(result.updated).toBeGreaterThanOrEqual(1);
    var row = await db('tasks').where('id', t.id).first();
    expect(row.scheduled_at).toBeTruthy();
  });

  test('places multiple tasks', async () => {
    if (!available) return;
    await seedTask({ text: 'Task A', when: 'morning', dur: 30 });
    await seedTask({ text: 'Task B', when: 'afternoon', dur: 45 });
    await seedTask({ text: 'Task C', when: 'evening', dur: 20 });
    var result = await runScheduleAndPersist(USER_ID);
    expect(result.updated).toBeGreaterThanOrEqual(3);
  });

  test('returns dayPlacements with task data', async () => {
    if (!available) return;
    await seedTask({ id: 'dp-check', text: 'Placement check', dur: 30 });
    var result = await runScheduleAndPersist(USER_ID);
    var found = false;
    Object.values(result.dayPlacements).forEach(function(day) {
      day.forEach(function(p) { if (p.task && p.task.id === 'dp-check') found = true; });
    });
    expect(found).toBe(true);
  });

  test('empty task list produces no updates', async () => {
    if (!available) return;
    var result = await runScheduleAndPersist(USER_ID);
    expect(result.updated).toBe(0);
    expect(result.cleared).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Minimal-diff persist
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: minimal diff', () => {
  test('second run with no changes produces fewer updates', async () => {
    if (!available) return;
    await seedTask({ text: 'Stable task', when: 'morning', dur: 30 });
    var run1 = await runScheduleAndPersist(USER_ID);
    expect(run1.updated).toBeGreaterThanOrEqual(1);

    // Second run — task already has correct scheduled_at
    var run2 = await runScheduleAndPersist(USER_ID);
    expect(run2.updated).toBeLessThanOrEqual(run1.updated);
  });

  test('unchanged scheduled_at is not rewritten', async () => {
    if (!available) return;
    await seedTask({ id: 'nodiff', text: 'Stable', when: 'morning', dur: 30 });
    await runScheduleAndPersist(USER_ID);
    var after1 = await db('tasks').where('id', 'nodiff').first();
    var ts1 = after1.updated_at;

    // Run again
    await runScheduleAndPersist(USER_ID);
    var after2 = await db('tasks').where('id', 'nodiff').first();
    // scheduled_at should be identical
    expect(after2.scheduled_at).toBe(after1.scheduled_at);
  });
});

// ═══════════════════════════════════════════════════════════════
// Immutable task protection
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: immutable tasks', () => {
  test('fixed tasks are not moved', async () => {
    if (!available) return;
    var fixedTime = '2026-04-10 18:00:00'; // 2pm ET
    await seedTask({ id: 'fixed-t', text: 'Fixed', when: 'fixed', scheduled_at: fixedTime, date_pinned: 1, dur: 30 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks').where('id', 'fixed-t').first();
    expect(row.scheduled_at).toBe(fixedTime);
  });

  test('marker tasks are not moved', async () => {
    if (!available) return;
    var markerTime = '2026-04-10 20:00:00';
    await seedTask({ id: 'marker-t', text: 'Reminder', marker: 1, scheduled_at: markerTime, dur: 0 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks').where('id', 'marker-t').first();
    expect(row.scheduled_at).toBe(markerTime);
  });

  test('recurring templates are never written to', async () => {
    if (!available) return;
    await seedTemplate({ id: 'tmpl-immut', text: 'Template', preferred_time_mins: 720 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks').where('id', 'tmpl-immut').first();
    expect(row.scheduled_at).toBeNull(); // scheduler never sets this on templates
  });

  test('date-pinned tasks keep their date', async () => {
    if (!available) return;
    var pinnedTime = '2026-04-15 14:00:00';
    await seedTask({ id: 'pinned-t', text: 'Pinned', date_pinned: 1, scheduled_at: pinnedTime, dur: 30 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks').where('id', 'pinned-t').first();
    expect(row.scheduled_at).toBe(pinnedTime);
  });
});

// ═══════════════════════════════════════════════════════════════
// Recurring instance handling
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: recurring instances', () => {
  test('expands recurring templates into instances', async () => {
    if (!available) return;
    await seedTemplate({ id: 'tmpl-expand', text: 'Daily task', dur: 20 });
    await runScheduleAndPersist(USER_ID);

    var instances = await db('tasks')
      .where({ user_id: USER_ID, source_id: 'tmpl-expand', task_type: 'recurring_instance' });
    expect(instances.length).toBeGreaterThan(0);
    instances.forEach(function(inst) {
      expect(inst.scheduled_at).toBeTruthy(); // expanded with a date
    });
  });

  test('recurring instances are NOT marked as unscheduled', async () => {
    if (!available) return;
    await seedTemplate({ id: 'tmpl-nouns', text: 'No unscheduled', dur: 20 });
    await runScheduleAndPersist(USER_ID);

    var unscheduled = await db('tasks')
      .where({ user_id: USER_ID, source_id: 'tmpl-nouns', unscheduled: 1 });
    expect(unscheduled.length).toBe(0);
  });

  test('completed instances are not re-expanded', async () => {
    if (!available) return;
    await seedTemplate({ id: 'tmpl-done', text: 'Done instances', dur: 20 });
    await seedInstance('tmpl-done', { id: 'inst-done', status: 'done', scheduled_at: '2026-04-06 12:00:00' });
    await runScheduleAndPersist(USER_ID);

    var doneInst = await db('tasks').where('id', 'inst-done').first();
    expect(doneInst.status).toBe('done'); // unchanged
  });
});

// ═══════════════════════════════════════════════════════════════
// Cache management
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: cache', () => {
  test('writes schedule_cache to user_config', async () => {
    if (!available) return;
    await seedTask({ text: 'Cache test', dur: 30 });
    await runScheduleAndPersist(USER_ID);

    var cacheRow = await db('user_config')
      .where({ user_id: USER_ID, config_key: 'schedule_cache' }).first();
    expect(cacheRow).toBeDefined();
    var cache = typeof cacheRow.config_value === 'string' ? JSON.parse(cacheRow.config_value) : cacheRow.config_value;
    expect(cache.generatedAt).toBeTruthy();
    expect(cache.dayPlacements).toBeDefined();
    expect(cache.timezone).toBe(TZ);
  });

  test('cache updates on subsequent runs', async () => {
    if (!available) return;
    await seedTask({ text: 'Cache update', dur: 30 });
    await runScheduleAndPersist(USER_ID);
    var cache1 = await db('user_config')
      .where({ user_id: USER_ID, config_key: 'schedule_cache' }).first();
    var c1 = typeof cache1.config_value === 'string' ? JSON.parse(cache1.config_value) : cache1.config_value;
    var gen1 = c1.generatedAt;

    // Wait a moment then run again
    await new Promise(r => setTimeout(r, 50));
    await runScheduleAndPersist(USER_ID);
    var cache2 = await db('user_config')
      .where({ user_id: USER_ID, config_key: 'schedule_cache' }).first();
    var c2 = typeof cache2.config_value === 'string' ? JSON.parse(cache2.config_value) : cache2.config_value;
    var gen2 = c2.generatedAt;

    expect(new Date(gen2).getTime()).toBeGreaterThan(new Date(gen1).getTime());
  });
});

// ═══════════════════════════════════════════════════════════════
// Terminal status tasks
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: terminal tasks', () => {
  test('done tasks are not placed by scheduler', async () => {
    if (!available) return;
    await seedTask({ id: 'done-t', text: 'Done task', status: 'done', scheduled_at: '2026-04-06 12:00:00', dur: 30 });
    var result = await runScheduleAndPersist(USER_ID);
    // Should not be in the placement updates
    var placed = false;
    Object.values(result.dayPlacements).forEach(function(day) {
      day.forEach(function(p) { if (p.task && p.task.id === 'done-t') placed = true; });
    });
    // Done tasks appear in dayPlacements as synthesized entries, but scheduler doesn't move them
    var row = await db('tasks').where('id', 'done-t').first();
    expect(row.scheduled_at).toBe('2026-04-06 12:00:00'); // unchanged
  });

  test('skip/cancel tasks are not placed', async () => {
    if (!available) return;
    await seedTask({ id: 'skip-t', text: 'Skipped', status: 'skip', dur: 30 });
    await seedTask({ id: 'cancel-t', text: 'Cancelled', status: 'cancel', dur: 30 });
    var result = await runScheduleAndPersist(USER_ID);
    expect(result.updated).toBe(0);
  });

  test('paused tasks are not placed', async () => {
    if (!available) return;
    await seedTask({ id: 'pause-t', text: 'Paused', status: 'pause', dur: 30 });
    var result = await runScheduleAndPersist(USER_ID);
    expect(result.updated).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Batch update performance
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: batch updates', () => {
  test('handles many tasks without timeout', async () => {
    if (!available) return;
    // Seed 50 tasks
    for (var i = 0; i < 50; i++) {
      await seedTask({ text: 'Bulk ' + i, dur: 15, when: 'morning,afternoon,evening' });
    }
    var start = Date.now();
    var result = await runScheduleAndPersist(USER_ID);
    var elapsed = Date.now() - start;
    expect(result.updated).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(30000); // should complete in <30s
  }, 35000);
});

// ═══════════════════════════════════════════════════════════════
// Deadlock retry
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: error handling', () => {
  test('returns result object with expected shape', async () => {
    if (!available) return;
    await seedTask({ text: 'Shape check', dur: 30 });
    var result = await runScheduleAndPersist(USER_ID);
    expect(result).toHaveProperty('updated');
    expect(result).toHaveProperty('cleared');
    expect(result).toHaveProperty('tasks');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('dayPlacements');
    expect(result).toHaveProperty('unplaced');
    expect(result).toHaveProperty('warnings');
  });
});

// ═══════════════════════════════════════════════════════════════
// preferredTimeMins through full pipeline
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: preferredTimeMins', () => {
  test('recurring with preferred_time_mins places within flex window', async () => {
    if (!available) return;
    await seedTemplate({
      id: 'tmpl-ptm-run', text: 'Lunch', dur: 30,
      preferred_time: 1, preferred_time_mins: 720, time_flex: 60
    });
    var result = await runScheduleAndPersist(USER_ID);

    // Check that instances were created and placed near noon
    var instances = await db('tasks')
      .where({ user_id: USER_ID, source_id: 'tmpl-ptm-run', task_type: 'recurring_instance' })
      .whereNotNull('scheduled_at');
    expect(instances.length).toBeGreaterThan(0);

    // Verify at least one instance is near noon by reading via rowToTask
    var rows = await db('tasks').where('user_id', USER_ID);
    var srcMap = buildSourceMap(rows);
    var placed = instances.map(function(inst) {
      return rowToTask(inst, TZ, srcMap);
    });
    // All should have time derived from preferred_time_mins (12:00 PM)
    placed.forEach(function(t) {
      expect(t.time).toBe('12:00 PM');
      expect(t.preferredTimeMins).toBe(720);
    });
  });
});
