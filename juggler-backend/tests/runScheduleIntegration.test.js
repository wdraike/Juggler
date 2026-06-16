/**
 * Integration tests for runScheduleAndPersist — the full scheduler pipeline.
 * Uses real test DB via NODE_ENV=test.
 * Requires: cd test-bed && make up
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'run-sched-test-001';
var TZ = 'America/New_York';

beforeAll(async () => {
  await assertDbAvailable();
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
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  // Keep user_config (time_blocks, tool_matrix) but clear schedule_cache
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

function seedTask(overrides) {
  var task = Object.assign({
    id: 'rt-' + Math.random().toString(36).slice(2, 10),
    user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, pri: 'P3',
    status: '', recurring: 0, created_at: db.fn.now(), updated_at: db.fn.now()
  }, overrides);
  return tasksWrite.insertTask(db, task).then(function() { return task; });
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
    var row = await db('tasks_v').where('id', t.id).first();
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
    var after1 = await db('tasks_v').where('id', 'nodiff').first();
    var ts1 = after1.updated_at;

    // Run again
    await runScheduleAndPersist(USER_ID);
    var after2 = await db('tasks_v').where('id', 'nodiff').first();
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
    var row = await db('tasks_v').where('id', 'fixed-t').first();
    expect(row.scheduled_at).toBe(fixedTime);
  });

  test('marker tasks are not moved', async () => {
    if (!available) return;
    // Use a far-future date so the marker is never in the scheduling window.
    // `marker` column was dropped; placement_mode='reminder' is the current equivalent.
    var markerTime = '2026-12-01 20:00:00';
    await seedTask({ id: 'marker-t', text: 'Reminder', placement_mode: 'reminder', scheduled_at: markerTime, dur: 0 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks_v').where('id', 'marker-t').first();
    expect(row.scheduled_at).toBe(markerTime);
  });

  test('recurring templates are never written to', async () => {
    if (!available) return;
    await seedTemplate({ id: 'tmpl-immut', text: 'Template', preferred_time_mins: 720 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks_v').where('id', 'tmpl-immut').first();
    expect(row.scheduled_at).toBeNull(); // scheduler never sets this on templates
  });

  test('fixed-mode tasks keep their scheduled_at', async () => {
    // `date_pinned` column was dropped in migration 20260526000000.
    // The current equivalent is placement_mode='fixed', which prevents the scheduler
    // from overwriting scheduled_at.
    if (!available) return;
    var pinnedTime = '2026-04-15 14:00:00';
    await seedTask({ id: 'pinned-t', text: 'Pinned', placement_mode: 'fixed', scheduled_at: pinnedTime, dur: 30 });
    await runScheduleAndPersist(USER_ID);
    var row = await db('tasks_v').where('id', 'pinned-t').first();
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

    var instances = await db('tasks_v')
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

    var unscheduled = await db('tasks_v')
      .where({ user_id: USER_ID, source_id: 'tmpl-nouns', unscheduled: 1 });
    expect(unscheduled.length).toBe(0);
  });

  test('completed instances are not re-expanded', async () => {
    if (!available) return;
    await seedTemplate({ id: 'tmpl-done', text: 'Done instances', dur: 20 });
    await seedInstance('tmpl-done', { id: 'inst-done', status: 'done', scheduled_at: '2026-04-06 12:00:00' });
    await runScheduleAndPersist(USER_ID);

    var doneInst = await db('tasks_v').where('id', 'inst-done').first();
    expect(doneInst.status).toBe('done'); // unchanged
  });

  test('skipped instances (soft-deleted) are not re-expanded', async () => {
    // Regression: physically-deleted recurring instances regenerate by id;
    // soft-delete via status='skip' must persist past scheduler runs.
    if (!available) return;
    await seedTemplate({ id: 'tmpl-skip-test', text: 'Skip test', dur: 20, recur: { type: 'daily' } });
    var date = '2026-04-10';
    var skipDigits = '20260410';
    var skipId = 'tmpl-skip-test-' + skipDigits;
    await seedInstance('tmpl-skip-test', {
      id: skipId, status: 'skip', scheduled_at: date + ' 12:00:00'
    });
    await runScheduleAndPersist(USER_ID);
    // The skip row stays; no duplicate insert happened
    var rows = await db('tasks_v')
      .where({ user_id: USER_ID, source_id: 'tmpl-skip-test' })
      .where('scheduled_at', 'like', date + '%');
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('skip');
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
    var row = await db('tasks_v').where('id', 'done-t').first();
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
// Wave C: scheduled_at-required guard
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: scheduled_at validation', () => {
  test('pending recurring instance without scheduled_at does not throw (scheduler assigns it)', async () => {
    // validateScheduledAt() explicitly skips recurring_instance validation:
    // "Throwing here blocks the scheduler from ever running on new instances
    //  (chicken-and-egg). Post-run validation is the right place."
    // Instances created without scheduled_at are assigned one on first placement.
    if (!available) return;

    // Create a recurring template first
    await seedTemplate({ id: 'tmpl-test', text: 'Test template', dur: 30 });

    // Manually insert a recurring instance without scheduled_at (bypassing normal flow)
    await db('task_instances').insert({
      id: 'inst-no-sched', master_id: 'tmpl-test', user_id: USER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      status: '', dur: 30, created_at: db.fn.now(), updated_at: db.fn.now()
    });

    // Should NOT throw — the scheduler assigns scheduled_at during placement
    var result = await runScheduleAndPersist(USER_ID);
    expect(result).toHaveProperty('updated');
  });

  test('allows regular tasks without scheduled_at (new tasks)', async () => {
    if (!available) return;
    
    // Insert a regular task without scheduled_at (this is normal for new tasks)
    await seedTask({ id: 'new-task', text: 'New task', dur: 30, when: 'morning' });
    
    // Should not throw - new tasks are allowed to lack scheduled_at
    var result = await runScheduleAndPersist(USER_ID);
    expect(result).toHaveProperty('updated');
    
    // Verify the task now has scheduled_at after scheduling
    var taskRow = await db('tasks_v').where('id', 'new-task').first();
    expect(taskRow.scheduled_at).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// BUG-671 regression: floating tasks must never be shown as overdue
//
// Root cause (two paths):
//
// PATH A — display synthesis (primary / user-visible):
//   runSchedule.js:1821-1823 (runScheduleAndPersist) and :2194-2196
//   (getSchedulePlacements cache path). Both compute:
//     isPastDue = scheduledMins!=null && t.date < todayKey
//   with NO exclusion for floating tasks (no deadline, no concept of past-due).
//   A floating task with a stale past t.date and a t.time from a prior run
//   satisfies isPastDue → appears in dayPlacements with _overdue=true on the
//   OLD past date, even though it was re-placed on a future date this run.
//   This is the PRIMARY user-visible bug: the task appears on the old date
//   with a "past scheduled date" indicator.
//
// PATH B — DB overdue flag (Phase 8 ANYTIME guard):
//   runSchedule.js:1516-1526. When a floating ANYTIME task appears in
//   result.unplaced AND original.date < todayKey (_aInPast=true), the guard
//   at line 1520 does NOT return early → falls through to Case B → writes
//   overdue=1 to the DB and preserves the stale past scheduled_at.
//   This path requires the task to be genuinely unplaceable (result.unplaced).
//
// Desired behavior (behavior_contract):
//   - Floating task NEVER receives overdue=1 from Phase 8 (regardless of date)
//   - Floating task with stale past scheduled_at MUST be placed today/forward,
//     NOT shown on the old date with _overdue=true
//   - display isPastDue synthesis MUST exclude floating tasks (no deadline)
//   - Hard-deadline tasks past their deadline MUST still show as overdue (AC3)
//   - Recurring missed instances MUST NOT roll forward (AC4)
//
// Traceability: .planning/kermit/jug-floating-past-due/TRACEABILITY.md BUG-671
// ═══════════════════════════════════════════════════════════════

describe('BUG-671 regression: floating tasks must never be flagged overdue', () => {
  // Fixed past date — always in the past as the repo ages.
  var STALE_DATE_UTC = '2026-06-10 00:00:00'; // 6+ days before leg authoring date
  var STALE_DATE_KEY = '2026-06-10';           // YYYY-MM-DD form used by scheduler

  // Helper: get today's key from the real clock (YYYY-MM-DD in UTC).
  // Tests run against the real scheduler clock; we can't freeze it here.
  function todayKey() {
    var d = new Date();
    var m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  // Helper: find a task's entry in dayPlacements (searches all date keys)
  function findInPlacements(dayPlacements, taskId) {
    for (var dk in dayPlacements) {
      var entries = dayPlacements[dk] || [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].task && entries[i].task.id === taskId) return { dateKey: dk, entry: entries[i] };
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────
  // BUG-671-AC1 — PRIMARY RED TEST (Path A: display synthesis)
  //
  // Root cause (code-traced):
  //   runSchedule.js:1821-1823 (runScheduleAndPersist synthesis loop):
  //     var isPastDue = scheduledMins != null && t.date != null && t.date !== 'TBD' &&
  //       (t.date < timeInfo.todayKey || ...);
  //     var isOverdueTask = !!t.overdue || isPastDue;
  //
  //   For a floating task (no deadline, non-recurring) with stale t.date < todayKey
  //   and non-null t.time: isPastDue=true → isOverdueTask=true → the synthesis
  //   creates a placement entry on the OLD past date with _overdue=true. This is
  //   WRONG — a floating task has no commitment; a past date just means the
  //   scheduler previously placed it there.
  //
  // How to trigger the synthesis loop (line 1815-1828):
  //   The synthesis loop runs for tasks NOT in placedIds. To force the floating
  //   task into this path, use when='_invalid_window_' — the scheduler cannot
  //   find any time block for this when-tag, so the task enters result.unplaced
  //   and is excluded from placedIds. The synthesis loop then fires at line 1815.
  //   (Same technique used in schedulePlacementsIntegration.test.js:234-236.)
  //
  // PRE-FIX FAILURE:
  //   isPastDue=true (t.date=STALE_DATE_KEY < todayKey, t.time non-null from prior run)
  //   → isOverdueTask=true → task appears on STALE_DATE_KEY with _overdue=true
  //   → foundOnStaleDate=true, found.entry._overdue=true
  //   Both assertions below FAIL on pre-fix code.
  // ─────────────────────────────────────────────────────────────────

  // BUG-671-AC1 (PRIMARY RED TEST — display synthesis):
  // A floating task (anytime, no deadline, non-recurring) that cannot be placed
  // (forced via when='_invalid_window_') and has a stale past date+time MUST NOT
  // appear in dayPlacements on the old past date with _overdue=true.
  //
  // FAILS on pre-fix code: isPastDue fires at runSchedule.js:1821-1823 with no
  // exclusion for floating (deadline=null) tasks.
  // PASSES after fix: the fix adds `&& (t.deadline || t.overdue)` (or equivalent)
  // to gate isPastDue so floating tasks are exempt from overdue synthesis.
  test('AC1 (RED): floating task with stale past date is NOT flagged overdue in dayPlacements when unplaceable', async () => {
    if (!available) return;

    // when='_invalid_window_' forces the task into result.unplaced (no matching
    // time block exists), triggering the synthesis loop at runSchedule.js:1815.
    await db('task_masters').insert({
      id: 'floating-red-master',
      user_id: USER_ID,
      text: 'Floating RED test task',
      dur: 30,
      status: '',
      when: '_invalid_window_',    // unplaceable: no time block matches this tag
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    // Insert instance with stale past date and a non-null scheduled_at
    // (simulating a prior scheduler run that placed it at 9 AM on STALE_DATE_KEY)
    await db('task_instances').insert({
      id: 'floating-red-001',
      master_id: 'floating-red-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      date: STALE_DATE_KEY,                    // stale past date
      scheduled_at: STALE_DATE_KEY + ' 14:00:00', // 9 AM ET (UTC-5 Jan = UTC-4 June → 13:00, but 14:00 also past)
      overdue: 0,                               // not yet flagged (DB reset)
      dur: 30,
      status: '',                               // non-recurring, non-terminal
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    var result = await runScheduleAndPersist(USER_ID);

    // ASSERTION 1 (RED): The floating task must NOT appear on the stale past date
    // with _overdue=true. Pre-fix: isPastDue=true → appears here with _overdue=true.
    var staleDateEntries = result.dayPlacements[STALE_DATE_KEY] || [];
    var foundOnStaleDate = staleDateEntries.some(function(e) {
      return e.task && e.task.id === 'floating-red-001';
    });
    expect(foundOnStaleDate).toBe(false); // FAILS pre-fix

    // ASSERTION 2 (RED): If the task appears anywhere in dayPlacements, it must
    // NOT carry _overdue=true. The fix excludes deadline=null tasks from isPastDue.
    var found = findInPlacements(result.dayPlacements, 'floating-red-001');
    if (found) {
      expect(found.entry._overdue).toBeFalsy(); // FAILS pre-fix
    }
  });

  // BUG-671-AC2: After scheduler run, floating task with a NORMAL when-tag
  // (placeable) gets its scheduled_at rolled forward to today or later.
  // This is a GREEN guard — verifies the roll-forward path works correctly.
  test('AC2 (guard): placeable floating task with stale past date rolls forward to today or later', async () => {
    if (!available) return;

    await seedTask({
      id: 'floating-roll',
      text: 'Floating roll forward',
      placement_mode: 'anytime',
      deadline: null,
      recurring: 0,
      dur: 30,
      when: '',
      scheduled_at: STALE_DATE_UTC,
    });

    await runScheduleAndPersist(USER_ID);

    var row = await db('tasks_v').where('id', 'floating-roll').first();
    expect(row.scheduled_at).toBeTruthy();
    var scheduledDate = row.scheduled_at.slice(0, 10);
    var today = todayKey();
    expect(scheduledDate >= today).toBe(true);
    expect(row.overdue).toBeFalsy(); // must stay 0
  });

  // BUG-671-AC3 — GUARD TEST (must remain GREEN before and after fix).
  // A deadline-bearing task whose deadline has passed AND that is UNPLACEABLE
  // (forced via when='_invalid_window_') MUST appear in dayPlacements with
  // _overdue=true via the synthesis/isPastDue path.
  //
  // STRENGTHENED (999.671 zoe BLOCK): original AC3 used a PLACED task, so the
  // synthesis loop at runSchedule.js:1815 was never reached — the test stayed
  // green even under a universal `false &&` suppression. The new version uses
  // when='_invalid_window_' to force the task through the same synthesis/isPastDue
  // path the floating task uses. This makes AC3 a real guard: if the fix
  // over-suppresses (hides deadline overdue), AC3 flips RED.
  //
  // Proof of real guard: replacing bert's `(t.deadline || t.overdue) &&` with
  // `false &&` at runSchedule.js:1825 causes isPastDue=false for this task →
  // isOverdueTask=false → synthesis skips it → found===null → AC3 FAILS.
  test('AC3 (guard): deadline-bearing UNPLACEABLE task past its deadline IS _overdue via synthesis path', async () => {
    if (!available) return;

    // when='_invalid_window_' → no matching time block → scheduler cannot place it
    // → task goes to result.unplaced → NOT in placedIds → synthesis loop at :1815 fires
    // → t.deadline is truthy → isPastDue=true → _overdue=true in placement entry.
    await db('task_masters').insert({
      id: 'deadline-past-unplaceable',
      user_id: USER_ID,
      text: 'Past deadline unplaceable task',
      dur: 30,
      status: '',
      when: '_invalid_window_',       // unplaceable: forces synthesis loop
      deadline: '2025-06-01 23:59:59', // clearly past deadline
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'deadline-past-unplaceable',
      master_id: 'deadline-past-unplaceable',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      date: STALE_DATE_KEY,                         // stale past date
      scheduled_at: STALE_DATE_KEY + ' 14:00:00',  // non-null time → scheduledMins non-null
      overdue: 0,
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    var result = await runScheduleAndPersist(USER_ID);

    // ASSERTION (AC3 real guard): deadline-bearing unplaceable past task MUST appear
    // with _overdue=true. If the gate over-suppresses (false &&), this fails.
    var found = findInPlacements(result.dayPlacements, 'deadline-past-unplaceable');
    expect(found).not.toBeNull();
    expect(found.entry._overdue).toBe(true);
  });

  // BUG-671-AC4 — GUARD TEST (must remain GREEN before and after fix).
  // A recurring instance that has already been marked missed MUST NOT be
  // rolled forward or have its status changed by a subsequent scheduler run.
  // Per SCHEDULER.md §8 Rule 2, missed recurring instances keep their status
  // and are not perpetually rescheduled.
  //
  // Implementation note: the reconciler deletes "stale" pending recurring
  // instances that don't match the template's expected ID scheme. We therefore
  // test an instance that is ALREADY in status='missed' (a terminal state the
  // reconciler respects and leaves intact) and verify a second scheduler run
  // does not alter it.
  test('AC4 (guard): already-missed recurring instance is NOT altered by a subsequent scheduler run', async () => {
    if (!available) return;

    await seedTemplate({ id: 'tmpl-ac4', text: 'AC4 recurring', dur: 30 });

    // Seed an explicit recurring instance directly so this test CANNOT vacuously
    // skip (zoe AC4 refer: the original `if (!todayInst) return;` was a silent
    // pass escape when the template didn't expand). We insert the instance with
    // status='' (pending) into the past so the scheduler sees it as a past instance.
    // The seedInstance helper creates a task_masters + task_instances row.
    await seedInstance('tmpl-ac4', {
      id: 'ac4-inst-seeded',
      source_id: 'tmpl-ac4',
      date: '2026-01-15',
      scheduled_at: '2026-01-15 10:00:00',
      status: '',
      overdue: 0,
      dur: 30,
    });

    // First run: verify the scheduler doesn't touch or roll the already-past instance.
    var result1 = await runScheduleAndPersist(USER_ID); // eslint-disable-line no-unused-vars

    // The seeded instance is our concrete missed instance — mark it missed to
    // simulate a day passing without completion.
    var todayInst = await db('task_instances').where('id', 'ac4-inst-seeded').first();
    expect(todayInst).toBeTruthy(); // seeded instance MUST exist — not vacuous

    var MISSED_SCHED = STALE_DATE_UTC; // force scheduled_at into past
    await db('task_instances').where('id', todayInst.id).update({
      status: 'missed',
      scheduled_at: MISSED_SCHED,
      completed_at: MISSED_SCHED,
      updated_at: db.fn.now(),
    });

    // Second scheduler run
    await runScheduleAndPersist(USER_ID);

    // The missed instance must NOT have been altered — still missed, still at past date
    var row = await db('task_instances').where('id', todayInst.id).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('missed');

    // scheduled_at must not have been rolled to today or later
    var scheduledDate = (row.scheduled_at || '').slice(0, 10);
    var today = todayKey();
    expect(scheduledDate < today).toBe(true); // not rolled forward

    // Must NOT have overdue=1 (missed instances use status='missed', not the overdue DB flag)
    expect(row.overdue).toBeFalsy();
  });
});
