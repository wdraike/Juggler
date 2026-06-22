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

// NOTE: the `runScheduleAndPersist: cache` block was removed in the W3/W4
// DB-single-source refactor. The separate `user_config` schedule_cache blob is
// gone — placement views are now DERIVED on read from the /tasks read model via
// deriveSchedulePlacements(). See src/slices/scheduler/README.md (W3/W4).

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
    // Terminal statuses (skip/cancel) require non-null scheduled_at per
    // chk_task_instances_terminal_scheduled (migration 20260527213906).
    // Use a past timestamp — the scheduler property being tested is that these
    // terminal rows are NOT re-placed (scheduled_at stays unchanged).
    await seedTask({ id: 'skip-t', text: 'Skipped', status: 'skip', scheduled_at: '2026-04-01 10:00:00', dur: 30 });
    await seedTask({ id: 'cancel-t', text: 'Cancelled', status: 'cancel', scheduled_at: '2026-04-01 10:00:00', dur: 30 });
    var result = await runScheduleAndPersist(USER_ID);
    expect(result.updated).toBe(0);
  });

  // Previously skipped pending 999.816 (RC3): the stale chk_task_masters_status_enum
  // omitted 'pause'. Fixed in migration 20260624000000_fix_stale_status_enum_constraints.js.
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

// ═══════════════════════════════════════════════════════════════
// BUG-700 regression: PATH B must never write overdue=1 for floating
// (no-deadline) tasks.
//
// Policy 999.671: floating tasks (deadline=null) are NEVER past-due / NEVER
// overdue=1. PATH B in runSchedule.js result.unplaced.forEach (~lines 1485-1588)
// has two holes that violate this policy:
//
//   HOLE 1 -- non-anytime placement modes (time_window / time_blocks):
//     The no-deadline guard at ~line 1521 fires ONLY for
//     placementMode==='anytime'. A floating task in time_window or time_blocks
//     mode skips the guard entirely and falls to Case B -> overdue=1.
//
//   HOLE 2 -- anytime-in-past:
//     The guard fires for anytime, but only returns early when !_aInPast AND
//     !_aDeadlinePassed. If the task was placed on a prior day (_aInPast=true),
//     the guard does NOT return early -> Case B -> overdue=1.
//
// Traceability: .planning/kermit/jug-pathb-floating-overdue/TRACEABILITY.md BUG-700
//
// AC1 (RED on current code):
//   Floating task, non-anytime placement mode (time_window / time_blocks),
//   previously placed in past, unplaceable this run -> overdue MUST be 0 in DB.
// AC2 (RED on current code):
//   Floating task already has overdue=1 in DB from prior bad run -> the fix
//   must WRITE overdue=0 (clearing it), not leave it as 1.
// AC3 (GREEN guard -- must stay GREEN before AND after fix):
//   Deadline-bearing task (time_blocks), deadline passed, unplaceable -> overdue=1.
// AC4 (GREEN guard -- must stay GREEN before AND after fix):
//   Deadline-bearing ANYTIME task, never placed -> Case C (unscheduled=1), no overdue.
//
// METHODOLOGY for making tasks genuinely unplaceable:
//
//   Strategy A (time_blocks / anytime): when='_invalid_window_'.
//     No time block has this tag -> scheduler cannot find a slot -> result.unplaced.
//     Same technique as BUG-671 tests above.
//
//   Strategy B (time_window): time_flex=0 degrades time_window mode.
//     unifiedScheduleV2.js: `if (flex > 0 && flex <= 480)` -- with flex=0 this
//     is FALSE -> isWindowMode=false -> scheduler falls back to when-tag placement.
//     Then when='_invalid_window_' makes it unplaceable via Strategy A.
//     Without this, a time_window task with a valid preferred_time_mins ignores
//     the `when` tag and is placed (not unplaced), so PATH B never fires.
// ═══════════════════════════════════════════════════════════════

describe('BUG-700 regression: PATH B must never write overdue=1 for floating tasks', () => {
  var STALE_DATE_UTC = '2026-06-08 14:00:00'; // always-past UTC datetime

  // ─────────────────────────────────────────────────────────────
  // AC1-HOLE1a -- RED pre-fix: time_window floating task, past+unplaceable
  //
  // Pre-fix failure path (runSchedule.js ~1521):
  //   Guard `if (original.placementMode === PLACEMENT_MODES.ANYTIME)` is FALSE
  //   for time_window -> guard body skipped -> Case B -> overdue=1.
  //
  // Strategy B: time_flex=0 -> isWindowMode=false -> falls back to when tags
  // -> when='_invalid_window_' -> unplaceable -> PATH B fires -> Case B -> overdue=1.
  // ─────────────────────────────────────────────────────────────

  test('AC1-HOLE1a (RED): floating time_window task, past+unplaceable, must NOT get overdue=1', async () => {
    if (!available) return;

    await db('task_masters').insert({
      id: 'b700-tw-master',
      user_id: USER_ID,
      text: 'BUG-700 time_window floating',
      dur: 30,
      status: '',
      placement_mode: 'time_window',
      preferred_time_mins: 540,  // 9 AM -- irrelevant once flex=0 degrades mode
      time_flex: 0,              // Strategy B: flex=0 -> isWindowMode=false -> uses when tags
      when: '_invalid_window_',  // Strategy A: unplaceable after fallback to when-tag placement
      deadline: null,            // FLOATING -- the key condition
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b700-tw-inst',
      master_id: 'b700-tw-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // prior placement on past date -> hasScheduledAt=true -> Case B
      overdue: 0,
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (RED pre-fix): PATH B writes overdue=1 for time_window floating task.
    // Post-fix: the fix must apply the no-deadline guard to ALL placement modes.
    var row = await db('task_instances').where('id', 'b700-tw-inst').first();
    expect(row).toBeTruthy();
    // task_instances.overdue is tinyint NOT NULL DEFAULT 0 — never null. toBe(0) is exact.
    expect(row.overdue).toBe(0); // FAILS pre-fix: overdue=1 written by Case B (HOLE 1)
  });

  // ─────────────────────────────────────────────────────────────
  // AC1-HOLE1b -- RED pre-fix: time_blocks floating task, past+unplaceable
  //
  // Strategy A: time_blocks respects when-tags -> when='_invalid_window_' -> unplaceable.
  // ─────────────────────────────────────────────────────────────

  test('AC1-HOLE1b (RED): floating time_blocks task, past+unplaceable, must NOT get overdue=1', async () => {
    if (!available) return;

    await db('task_masters').insert({
      id: 'b700-tb-master',
      user_id: USER_ID,
      text: 'BUG-700 time_blocks floating',
      dur: 30,
      status: '',
      placement_mode: 'time_blocks',
      when: '_invalid_window_',  // Strategy A: no matching time block -> unplaceable
      deadline: null,            // FLOATING
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b700-tb-inst',
      master_id: 'b700-tb-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // prior placement -> hasScheduledAt=true -> Case B
      overdue: 0,
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    var row = await db('task_instances').where('id', 'b700-tb-inst').first();
    expect(row).toBeTruthy();
    // task_instances.overdue is tinyint NOT NULL DEFAULT 0 — never null. toBe(0) is exact.
    expect(row.overdue).toBe(0); // FAILS pre-fix: HOLE 1 -- guard skipped for time_blocks -> Case B -> overdue=1
  });

  // ─────────────────────────────────────────────────────────────
  // AC1-HOLE2 -- RED pre-fix: anytime floating task placed in past
  //
  // HOLE 2: placementMode===ANYTIME, _aInPast=true (STALE date < todayKey).
  // Guard at ~line 1525 requires BOTH !_aInPast AND !_aDeadlinePassed.
  // _aInPast=true -> guard does NOT return early -> Case B -> overdue=1.
  // Strategy A: when='_invalid_window_' forces result.unplaced for anytime mode.
  // ─────────────────────────────────────────────────────────────

  test('AC1-HOLE2 (RED): floating anytime task placed in past, unplaceable now, must NOT get overdue=1', async () => {
    if (!available) return;

    await db('task_masters').insert({
      id: 'b700-any-past-master',
      user_id: USER_ID,
      text: 'BUG-700 anytime floating in-past',
      dur: 30,
      status: '',
      placement_mode: 'anytime',
      when: '_invalid_window_',  // Strategy A: unplaceable
      deadline: null,            // FLOATING -- no deadline
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b700-any-past-inst',
      master_id: 'b700-any-past-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // PAST date -> original.date < todayKey -> _aInPast=true
      overdue: 0,
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (RED pre-fix): HOLE 2 -- _aInPast=true causes the ANYTIME guard to
    // skip the early return -> Case B fires -> overdue=1.
    var row = await db('task_instances').where('id', 'b700-any-past-inst').first();
    expect(row).toBeTruthy();
    // task_instances.overdue is tinyint NOT NULL DEFAULT 0 — never null. toBe(0) is exact.
    expect(row.overdue).toBe(0); // FAILS pre-fix: overdue=1 written by Case B
  });

  // ─────────────────────────────────────────────────────────────
  // AC2 -- RED pre-fix: stale overdue=1 on floating task is CLEARED
  //
  // Pre-fix: wasAlreadyOverdue=true + unscheduled=0 -> "Already in final state"
  //   branch (runSchedule.js ~1544) -> only slack_mins checked -> overdue=1 remains.
  // Post-fix: the no-deadline guard must actively write overdue=0.
  //
  // Strategy B (time_flex=0) ensures the task is genuinely unplaceable, not
  // placed and auto-cleared by the normal placement update path.
  // ─────────────────────────────────────────────────────────────

  test('AC2 (RED): floating task already overdue=1 in DB -- run must write overdue=0', async () => {
    if (!available) return;

    await db('task_masters').insert({
      id: 'b700-clear-master',
      user_id: USER_ID,
      text: 'BUG-700 clear stale overdue',
      dur: 30,
      status: '',
      placement_mode: 'time_window',
      preferred_time_mins: 540,
      time_flex: 0,              // Strategy B: degrade time_window -> falls back to when tags
      when: '_invalid_window_',  // Strategy A: unplaceable
      deadline: null,            // FLOATING
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b700-clear-inst',
      master_id: 'b700-clear-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC,
      overdue: 1,      // STALE overdue flag from a prior bad run
      unscheduled: 0,  // Case B state: pinned to calendar position
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (RED pre-fix): stale overdue=1 must be cleared to 0.
    // Pre-fix: "already final state" branch fires -> overdue=1 remains unchanged.
    // Post-fix: the floating-task guard writes overdue=0 explicitly.
    var row = await db('task_instances').where('id', 'b700-clear-inst').first();
    expect(row).toBeTruthy();
    expect(row.overdue).toBe(0); // FAILS pre-fix: overdue stays 1
  });

  // ─────────────────────────────────────────────────────────────
  // AC3 -- GREEN guard: deadline-bearing task STILL gets overdue=1
  //
  // Verifies the fix does not over-suppress deadline-bearing tasks.
  // Uses time_blocks + Strategy A (genuinely unplaceable via when tag).
  // If the fix naively makes all non-ANYTIME tasks "floating-exempt", AC3 fails.
  // ─────────────────────────────────────────────────────────────

  test('AC3 (guard, GREEN): deadline-bearing time_blocks task, past deadline, unplaceable -- gets overdue=1', async () => {
    if (!available) return;

    await db('task_masters').insert({
      id: 'b700-dl-master',
      user_id: USER_ID,
      text: 'BUG-700 deadline task guard',
      dur: 30,
      status: '',
      placement_mode: 'time_blocks',  // HOLE 1 mode; no ANYTIME guard
      when: '_invalid_window_',       // Strategy A: unplaceable
      deadline: '2025-01-01 23:59:59', // clearly past deadline (not floating)
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b700-dl-inst',
      master_id: 'b700-dl-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // prior placement -> hasScheduledAt=true -> Case B
      overdue: 0,
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (GREEN guard): deadline-bearing, past-deadline, unplaceable task
    // MUST still get overdue=1 after the fix.
    var row = await db('task_instances').where('id', 'b700-dl-inst').first();
    expect(row).toBeTruthy();
    expect(row.overdue).toBe(1); // must be GREEN before fix AND after fix
  });

  // ─────────────────────────────────────────────────────────────
  // AC4 -- GREEN guard: never-placed task goes to Case C, not Case B
  //
  // A deadline-bearing ANYTIME task that was NEVER placed (no scheduled_at)
  // and cannot be placed this run -> goes to Case C (unscheduled=1), not Case B.
  // Case C never writes overdue=1. Ensures the fix doesn't accidentally inject
  // overdue writes into Case C.
  // ─────────────────────────────────────────────────────────────

  test('AC4 (guard, GREEN): deadline-bearing anytime task, never placed -- Case C: unscheduled=1, no overdue', async () => {
    if (!available) return;

    await db('task_masters').insert({
      id: 'b700-ac4-master',
      user_id: USER_ID,
      text: 'BUG-700 AC4 never-placed deadline guard',
      dur: 30,
      status: '',
      placement_mode: 'anytime',
      when: '_invalid_window_',         // unplaceable -> result.unplaced
      deadline: '2099-12-31 23:59:59', // has a deadline (NOT floating)
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b700-ac4-inst',
      master_id: 'b700-ac4-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      // No scheduled_at: never placed -> hasScheduledAt=false -> Case C (not Case B)
      overdue: 0,
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (GREEN guard): Case C path -> unscheduled=1, no overdue=1 written.
    // Both before and after the fix (Case C never writes overdue).
    var row = await db('task_instances').where('id', 'b700-ac4-inst').first();
    expect(row).toBeTruthy();
    expect(row.overdue).toBeFalsy(); // Case C: no overdue -- must stay GREEN
    expect(row.unscheduled).toBe(1); // Case C: moves to unscheduled lane
  });

  // ─────────────────────────────────────────────────────────────
  // AC1-HOLE-CHAIN — GREEN guard (zoe WARN#1 resolution):
  // Floating CHAIN-MEMBER task (depends_on non-empty, no deadline, previously
  // placed, unplaceable this run) MUST NOT get overdue=1 via PATH B Case B.
  //
  // Code path: runSchedule.js:1511 comment "One-off / chain-member task."
  //   Chain members (task_type='task' with depends_on) are NOT filtered by the
  //   recurring_template / FIXED / marker / recurring_instance guards above.
  //   They fall through to the hasScheduledAt Case B block at line 1514.
  //   The mode-agnostic `!original.deadline` guard at line 1520 protects them
  //   (same guard that protects one-offs). This test pins that protection.
  //
  // Strategy: seed a "blocker" task also with when='_invalid_window_' so the
  //   scheduler cannot place it. The chain-member depends on the blocker — the
  //   scheduler leaves the chain-member in result.unplaced (dep unsatisfied +
  //   when-tag unplaceable). The chain-member has a past scheduled_at
  //   (hasScheduledAt=true) → PATH B Case B fires. With deadline=null, the
  //   `!original.deadline` guard returns early → no overdue=1 written.
  //
  // Pre-fix equivalent: if the guard were mode-restricted to ANYTIME only (the
  //   pre-BUG-700 state), time_blocks chain-members would bypass it → Case B →
  //   overdue=1. This test would fail on that pre-fix code and pins the guard's
  //   chain-member coverage for regression.
  // ─────────────────────────────────────────────────────────────

  test('AC1-HOLE-CHAIN: floating chain-member (depends_on, no deadline), past+unplaceable, must NOT get overdue=1', async () => {
    if (!available) return;

    // Blocker task: unplaceable, no deadline (its own overdue state is not under test)
    await db('task_masters').insert({
      id: 'b700-chain-blocker-master',
      user_id: USER_ID,
      text: 'BUG-700 chain blocker',
      dur: 30,
      status: '',
      placement_mode: 'time_blocks',
      when: '_invalid_window_',  // unplaceable -> stays in result.unplaced
      deadline: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b700-chain-blocker-inst',
      master_id: 'b700-chain-blocker-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      // No scheduled_at: never placed -> Case C (unscheduled=1), not Case B
      overdue: 0,
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Chain member: depends on blocker, has a prior past placement, no deadline.
    // depends_on stored as JSON array in task_masters.
    await db('task_masters').insert({
      id: 'b700-chain-member-master',
      user_id: USER_ID,
      text: 'BUG-700 chain member floating',
      dur: 30,
      status: '',
      placement_mode: 'time_blocks',
      when: '_invalid_window_',         // Strategy A: unplaceable even if blocker were placed
      deadline: null,                   // FLOATING -- the key condition
      depends_on: JSON.stringify(['b700-chain-blocker-inst']), // chain member
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b700-chain-member-inst',
      master_id: 'b700-chain-member-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // prior placement -> hasScheduledAt=true -> PATH B Case B
      overdue: 0,
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION: The `!original.deadline` guard at runSchedule.js:1520 must protect
    // the chain-member (task_type='task', dependsOn non-empty) the same way it
    // protects one-off tasks. overdue MUST remain 0 after the run.
    // task_instances.overdue is tinyint NOT NULL DEFAULT 0 — never null. toBe(0) is exact.
    var row = await db('task_instances').where('id', 'b700-chain-member-inst').first();
    expect(row).toBeTruthy();
    expect(row.overdue).toBe(0); // must stay 0: !original.deadline guard at :1520 covers chain-members
  });
});

// ═══════════════════════════════════════════════════════════════
// BUG-142 characterization / RED tests
//
// Traceability: .planning/kermit/jug-recur-instances-stuck/TRACEABILITY.md BUG-142
//
// DECIDED BEHAVIOR (user decision 2026-06-16, brain #72164):
//   AC1: A RECURRING instance for a day that has already passed, never placed
//        (unscheduled=1, scheduled_at=NULL, status=''), OUTSIDE its timeFlex window
//        → after a scheduler run its status becomes 'missed' (with non-null
//        scheduled_at/completed_at, satisfying the DB CHECK constraint).
//
//   AC2: A RECURRING instance for TODAY or a FUTURE day, currently unplaceable
//        → stays status='' + unscheduled=1; NOT 'missed'. The scheduler must NOT
//        prematurely auto-miss a not-yet-past instance.
//
//   AC3: The presence of a stuck/missed past recurring instance does NOT prevent
//        OTHER placeable tasks from being scheduled in the same run.
//
//   AC4: Non-recurring past-dated tasks still roll forward to today (existing
//        behavior); recurring instances are NOT rolled forward (no roll-forward,
//        per SCHEDULER.md). This pins existing correct behavior around AC1.
//
// ROOT CAUSE ANALYSIS (two code-traced paths, both produce the same failure):
//
//   PATH A — reconcile deletion (primary failure for date=NULL instances):
//     runSchedule.js:844-852 — `toDeleteIds` includes any existingPendingId
//     whose id is NOT in desiredIds AND whose row.date is not beyond expandEnd.
//     A never-placed instance has row.date=NULL → the `rowDate > expandEnd` guard
//     (line 847-850) does not fire → instance is in toDeleteIds → DELETED before
//     Plan C runs. The instance is removed from the DB; status never becomes 'missed'.
//     Evidence: buildExistingGroups(:78) only includes groups with `g.dateObj`;
//     date=NULL → g.dateObj=null → excluded from `remaining` → no match possible →
//     falls through to toDeleteIds.
//
//   PATH B — rowToTask date=null skip (for date-set instances that survive PATH A):
//     A never-placed instance with scheduled_at=NULL → rowToTask (taskMappers.js:188)
//     only sets `date` from `utcToLocal(row.scheduled_at, tz)` — when scheduled_at
//     is NULL, date stays null. Plan C guard (runSchedule.js:1642):
//       `if (!t.date || t.date === 'TBD') return;`
//     This returns early, skipping the auto-miss logic entirely.
//
//   PATH C — unplacedIds skip (for instances the scheduler tries to place but fails):
//     If the scheduler does reach the instance and puts it in result.unplaced
//     (runSchedule.js:1603-1604), the guard at line 1648:
//       `if (unplacedIds[t.id]) return;`
//     also skips Plan C for that instance.
//
// STATUS BEFORE FIX:
//   AC1: RED — never-placed past recurring instance is deleted (PATH A) or
//              skipped (PATH B/C) — never auto-missed.
//   AC2: GREEN — today/future instances with unscheduled=1 stay pending.
//   AC3: GREEN — other tasks are placed independently.
//   AC4: GREEN — non-recurring tasks roll forward; pinned here to guard regression.
//
// WHAT BERT MUST FIX (to make AC1 GREEN):
//   The fix must intercept BEFORE the reconcile deletion (PATH A) or add a
//   parallel sweep: when a pending recurring instance's `date` is in the past
//   and outside timeFlex, mark it 'missed' (with scheduled_at fallback to
//   midnight of that date) BEFORE the reconcile deletes it. Alternatively,
//   the reconcile `toDeleteIds` filter must exclude past instances that should
//   be auto-missed rather than silently deleted.
//   Plan C in runSchedule.js:1642 also needs: fall back to `row.date` from the
//   DB when `t.date` is null (scheduled_at=NULL) to avoid the PATH B skip.
//
// ═══════════════════════════════════════════════════════════════

describe('BUG-142 regression: past recurring instance auto-miss (Plan C)', () => {
  // A fixed past date used across all BUG-142 tests.
  // Must be far enough in the past that timeFlex=0 is clearly outside the window.
  var PAST_DATE_KEY = '2026-06-01';       // local-tz calendar key (YYYY-MM-DD)
  var PAST_DATE_UTC = '2026-06-01 00:00:00'; // midnight UTC approximation for scheduled_at

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-142-AC1 (ACCEPTED LEGACY CLEANUP — Oscar ruling 2026-06-16):
  //
  // A RECURRING instance with `date=NULL` and `scheduled_at=NULL` is an
  // ANOMALOUS / LEGACY state. Modern Phase 1 pre-insert (expandRecurring)
  // always writes a non-null occurrence date; date=NULL rows only arise from
  // old code that pre-dates that invariant.
  //
  // The reconciler's toDeleteIds path (runSchedule.js:844-852) DELETES these
  // rows because:
  //   row.date=NULL → the `if (row && row.date)` grandfather guard is falsy
  //   → no match in `desiredIds` → toDeleteIds includes the id → DELETE.
  //
  // Oscar ruling: this deletion is ACCEPTABLE orphan cleanup, NOT the
  // 999.142 bug. The bug (PATH B) is a date-SET instance that survived the
  // reconciler but was skipped by Plan C — fixed by bert's rawRowPast
  // date-fallback (Plan C now uses rawRowPast.date when scheduled_at=NULL).
  //
  // This test PINS the accepted behavior: a date=NULL recurring instance is
  // deleted by the reconciler after a scheduler run. It must NOT be treated
  // as a test failure — deletion here is the correct/expected outcome.
  //
  // NOTE: if a future leg wants to rescue date=NULL orphans (e.g. by writing
  // them to 'missed' rather than deleting them), that is a new backlog item,
  // not a fix to 999.142. Oscar should backlog that if desired.
  // ─────────────────────────────────────────────────────────────────────────
  test('AC1 (ACCEPTED LEGACY): date=NULL recurring instance is cleaned up (deleted) by the reconciler — not the 999.142 bug', async () => {
    if (!available) return;

    // Template with recur_end in the past → expandRecurring generates NO future
    // desired occurrences → the instance has no match in desiredIds.
    await db('task_masters').insert({
      id: 'b142-tmpl-ac1',
      user_id: USER_ID,
      text: 'BUG-142 AC1 legacy date=NULL recurring',
      dur: 30,
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: '2026-06-01',   // anchored in past
      recur_end: '2026-06-01',     // ended in past → no future desired occurrences
      time_flex: 0,
      when: 'morning',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // LEGACY/ANOMALOUS state: date=NULL + scheduled_at=NULL.
    // Modern expandRecurring always writes a non-null date; this state only
    // arises from old code. The reconciler treats this as an unmatched orphan.
    await db('task_instances').insert({
      id: 'b142-inst-ac1',
      master_id: 'b142-tmpl-ac1',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: null,    // never placed
      date: null,            // LEGACY: no date column value
      status: '',
      unscheduled: 1,
      overdue: 0,
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (AC1 — ACCEPTED LEGACY CLEANUP):
    // The reconciler deletes a date=NULL pending recurring instance because
    // it cannot be matched to any desired occurrence (the grandfather guard
    // at runSchedule.js:847 requires row.date to be non-null). This is
    // correct orphan cleanup behavior — Oscar ruling 2026-06-16.
    //
    // Assert the row is GONE (deletion is the expected outcome here):
    var row = await db('task_instances').where('id', 'b142-inst-ac1').first();
    expect(row).toBeUndefined(); // reconciler deleted the orphan — correct
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-142-AC1b (RED on current code — PATH B variant):
  //
  // Same scenario as AC1 but with `date` set on the instance row (simulating
  // a partial-init state where reconcileOccurrences wrote the date column but
  // the scheduler still failed to find a slot). This instance COULD survive the
  // reconciler's toDeleteIds filter (since g.dateObj is non-null from row.date)
  // but then gets moved to a future date via occurrenceMove. Even if it survives,
  // Plan C skips it because rowToTask returns t.date=null (scheduled_at=NULL
  // causes taskMappers.js:188 to leave date=null, ignoring row.date).
  //
  // This test pins the PATH B / reconcile-move sub-case.
  // ─────────────────────────────────────────────────────────────────────────
  test('AC1b (RED): never-placed past recurring instance with date set (scheduled_at=NULL) becomes status=missed', async () => {
    if (!available) return;

    // Template with a broader recur window so the reconciler CAN generate
    // desired occurrences and may try to MOVE the past instance to a future date.
    // This exercises the reconcile-move path (PATH B + occurrenceMove).
    // The template recurs daily but started in the past; the instance should
    // still become 'missed' even if the reconciler tries to reuse it for the future.
    await db('task_masters').insert({
      id: 'b142-tmpl-ac1b',
      user_id: USER_ID,
      text: 'BUG-142 AC1b date-set never-placed',
      dur: 30,
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: PAST_DATE_KEY,
      // No recur_end → generates future desired occurrences; reconciler may move instance
      time_flex: 0,
      when: 'morning',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Instance has `date` set to the past but `scheduled_at=NULL` (never placed).
    // buildExistingGroups will see g.dateObj from row.date → includes in `remaining`.
    // matchOccurrences may match this to a future desired date → occurrenceMove.
    // In-memory: t.date gets set to future date → Plan C td >= today → skips.
    // OR if not matched: toDeleteIds → deleted.
    // Either way: AC1 behavior (status='missed') is not achieved.
    await db('task_instances').insert({
      id: 'b142-inst-ac1b',
      master_id: 'b142-tmpl-ac1b',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: null,          // NEVER PLACED
      date: PAST_DATE_KEY,         // date IS set — the partial-init state
      status: '',
      unscheduled: 1,
      overdue: 0,
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (AC1b — RED pre-fix):
    // Either the instance was deleted (PATH A after reconcile moved another one),
    // or the reconciler moved it to a future date and it's still pending,
    // or Plan C skipped it (PATH B). None produce status='missed'.
    //
    // Post-fix: the past recurring instance with date < today and scheduled_at=NULL
    // must be status='missed' with non-null scheduled_at.
    var row = await db('task_instances').where('id', 'b142-inst-ac1b').first();

    if (!row) {
      // PATH A / reconcile-deletion variant: instance was deleted
      throw new Error(
        '[BUG-142-AC1b] FAIL: instance b142-inst-ac1b was DELETED (reconcile moved ' +
        'it to a future desired slot, then another path removed it, or it went ' +
        'directly to toDeleteIds). Must be preserved as status=\'missed\'.'
      );
    }

    // If the reconciler moved it to a future date → status='', date=future.
    // If Plan C skipped it → status='' still.
    // Post-fix: must be 'missed'.
    expect(row.status).toBe('missed'); // FAILS pre-fix: '' or row moved/deleted
    expect(row.scheduled_at).not.toBeNull();
    expect(row.completed_at).not.toBeNull();
    // WARN-1 pin (bert fix): Plan C must also clear the unscheduled flag so the
    // terminal missed row is {status:'missed', unscheduled:null/0, scheduled_at:non-null}.
    // Pre-bert-WARN-1: unscheduled was left as 1 — the row retained its "never-placed"
    // flag even after becoming terminal. DB null (JS null) or 0 are both falsy.
    expect(row.unscheduled).toBeFalsy(); // FAILS if WARN-1 fix is reverted
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-142-AC2 (GREEN — must stay GREEN before AND after fix):
  //
  // A RECURRING instance for TODAY or a FUTURE day, currently unplaceable
  // (unscheduled=1), must NOT be auto-missed. The scheduler must leave it
  // as status='' (pending) so a later run can place it when a slot opens.
  //
  // This test pins the "don't prematurely miss future/today instances" constraint.
  // If the fix over-suppresses (marks all unscheduled recurring instances as
  // missed regardless of date), this test FAILS.
  // ─────────────────────────────────────────────────────────────────────────
  test('AC2 (GREEN guard): today/future unplaceable recurring instance stays pending (NOT missed)', async () => {
    if (!available) return;

    // Compute tomorrow's date key (YYYY-MM-DD) from the real clock so this
    // test remains correct as the repo ages.
    var tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    var y = tomorrow.getUTCFullYear(), m = tomorrow.getUTCMonth() + 1, d = tomorrow.getUTCDate();
    var tomorrowKey = y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;

    await db('task_masters').insert({
      id: 'b142-tmpl-ac2',
      user_id: USER_ID,
      text: 'BUG-142 AC2 future unplaceable',
      dur: 30,
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: tomorrowKey,
      // No recur_end — template is ongoing
      time_flex: 0,
      when: '_invalid_window_',   // Strategy A: unplaceable (no matching time block)
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // Instance for TOMORROW — not yet past. The scheduler must NOT mark it missed.
    await db('task_instances').insert({
      id: 'b142-inst-ac2',
      master_id: 'b142-tmpl-ac2',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: null,
      date: tomorrowKey,     // future date — NOT past
      status: '',
      unscheduled: 1,
      overdue: 0,
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (AC2 GREEN guard): future/today instance must NOT be auto-missed.
    // The Plan C guard `if (!td || td >= today) return;` (runSchedule.js:1644)
    // must protect future instances — this must stay GREEN before AND after the fix.
    var row = await db('task_instances').where('id', 'b142-inst-ac2').first();
    // Row may or may not exist (reconciler may have replaced with a desired instance)
    // but if it exists, status must NOT be 'missed'.
    if (row) {
      expect(row.status).not.toBe('missed'); // GREEN guard: future instance is never auto-missed
    }
    // If the reconciler moved/deleted this instance and replaced with another:
    // assert NO missed recurring instances exist for this template.
    var missedForTemplate = await db('task_instances')
      .where({ user_id: USER_ID, master_id: 'b142-tmpl-ac2', status: 'missed' });
    expect(missedForTemplate.length).toBe(0); // no instance for this future template should be 'missed'
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-142-AC3 (GREEN guard — must stay GREEN before AND after fix):
  //
  // The presence of a stuck/missed past recurring instance does NOT prevent
  // OTHER placeable tasks from being scheduled in the same scheduler run.
  // Tests that Plan C / the fix do not cascade and block placement.
  // ─────────────────────────────────────────────────────────────────────────
  test('AC3 (GREEN guard): stuck past recurring instance does NOT block other tasks from being placed', async () => {
    if (!available) return;

    // Stuck past recurring instance (same setup as AC1)
    await db('task_masters').insert({
      id: 'b142-tmpl-ac3-stuck',
      user_id: USER_ID,
      text: 'BUG-142 AC3 stuck recurring',
      dur: 30,
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: PAST_DATE_KEY,
      recur_end: PAST_DATE_KEY,  // past-ended → no desired occurrences
      time_flex: 0,
      when: 'morning',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('task_instances').insert({
      id: 'b142-inst-ac3-stuck',
      master_id: 'b142-tmpl-ac3-stuck',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: null,
      date: null,
      status: '',
      unscheduled: 1,
      overdue: 0,
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // A separate, placeable non-recurring task in the same run.
    await seedTask({
      id: 'b142-placeable-ac3',
      text: 'BUG-142 AC3 placeable task',
      dur: 30,
      when: 'morning',
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (AC3 GREEN guard): the stuck instance must NOT block the placeable task.
    var placeableRow = await db('tasks_v').where('id', 'b142-placeable-ac3').first();
    expect(placeableRow).toBeTruthy();
    expect(placeableRow.scheduled_at).toBeTruthy(); // placed — stuck instance did not block it
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-142-AC4 (GREEN guard — must stay GREEN before AND after fix):
  //
  // Non-recurring past-dated tasks still roll forward to today (existing behavior).
  // Recurring instances are NOT rolled forward — no roll-forward per SCHEDULER.md.
  // This pins the roll-forward behavior for non-recurring tasks alongside the
  // recurring auto-miss fix so the fix cannot accidentally break it.
  // ─────────────────────────────────────────────────────────────────────────
  test('AC4 (GREEN guard): non-recurring past-dated task rolls forward to today; NOT a recurring instance', async () => {
    if (!available) return;

    // Non-recurring task with a past scheduled_at — the scheduler should
    // roll its scheduled_at forward to today (Plan C non-recurring branch,
    // runSchedule.js:1689-1697: sets scheduled_at = todayMidnight).
    // WARN-2 note: bert gated the rawRowPast.date fallback (effectiveDate assignment
    // at runSchedule.js:1660) on `t.recurring` — so the non-recurring path here is
    // unchanged; effectiveDate derives from t.date (from scheduled_at) as before.
    // AC4 already exercises the non-recurring path cleanly; no additional assertion needed.
    await seedTask({
      id: 'b142-nonrecur-ac4',
      text: 'BUG-142 AC4 non-recurring past roll-forward',
      dur: 30,
      when: 'morning',
      scheduled_at: PAST_DATE_UTC,  // placed in the past
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (AC4 GREEN guard): non-recurring past task is re-placed (date moves forward).
    // The scheduler's Plan C non-recurring branch sets scheduled_at = todayMidnight.
    // A subsequent placement pass then assigns a real slot.
    var row = await db('tasks_v').where('id', 'b142-nonrecur-ac4').first();
    expect(row).toBeTruthy();
    // After the run, scheduled_at must be >= today (rolled forward)
    var today = new Date();
    var y2 = today.getUTCFullYear(), m2 = today.getUTCMonth() + 1, d2 = today.getUTCDate();
    var todayKey = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (d2 < 10 ? '0' : '') + d2;
    var scheduledDate = (row.scheduled_at || '').slice(0, 10);
    expect(scheduledDate >= todayKey).toBe(true); // rolled forward to today or later
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BUG-142-AC5 (WARN-3 MUTANT KILL — within-timeFlex → NOT missed):
  //
  // A RECURRING instance for a PAST day that was never placed (scheduled_at=NULL,
  // unscheduled=1) BUT with timeFlex large enough that the day is STILL WITHIN
  // the placement window must NOT be auto-missed by Plan C.
  //
  // The guard at runSchedule.js:~1691:
  //   `if (flex >= daysPast * 1440) return;  // still within window, don't mark`
  // is the surviving mutant that zoe's mutation analysis flagged — deleting this
  // line left all existing BUG-142 tests GREEN because every existing test uses
  // timeFlex=0 (always outside the window). This test closes that gap.
  //
  // Setup:
  //   - PAST_DATE_KEY (2026-06-01) is daysPast days ago (≥1 day, typically ≥15).
  //   - time_flex = daysPast_actual * 1440 + 1440 (at least 1 extra day of flex)
  //     so that flex >= daysPast * 1440 evaluates TRUE → early return → NOT missed.
  //   - After the scheduler run: instance status must remain '' (pending).
  //
  // MUTANT CATCH VERIFICATION:
  //   If the guard `if (flex >= daysPast * 1440) return;` is deleted/replaced with
  //   `if (false) return;`, the instance falls through to the 'missed' write.
  //   This test then FAILS (status='missed' instead of ''). Thus the test genuinely
  //   catches that mutant — it is not a vacuous green.
  //
  // WARN-2 note: the effectiveDate fallback is gated on `t.recurring` (line 1660)
  // so the non-recurring path is not affected by this test (AC4 covers that).
  // ─────────────────────────────────────────────────────────────────────────
  test('AC5 (WARN-3 mutant kill): within-timeFlex past recurring instance is NOT auto-missed', async () => {
    if (!available) return;

    // DESIGN: This test must survive reconcile so Plan C actually evaluates the timeFlex guard.
    // Using no recur_end (like AC1b) causes the reconciler to match the past instance to a new
    // desired future date (occurrenceMove). Bert's rawRowPast.date fix (WARN-2, line 1660)
    // means Plan C uses rawRowPast.date=PAST_DATE_KEY as effectiveDate regardless of the
    // in-memory t.date being updated to a future slot. Plan C thus sees this instance as
    // "past" and evaluates the timeFlex guard. With large timeFlex → guard fires → NOT missed.
    // Without no recur_end (using recur_end=PAST_DATE_KEY), the reconciler deletes the instance
    // via toDeleteIds before Plan C runs → test vacuously passes (no instance, no 'missed').

    // Compute how many days PAST_DATE_KEY is from today (real clock).
    var todayDate = new Date();
    var pastDate = new Date(PAST_DATE_KEY + 'T00:00:00Z');
    var daysPast = Math.max(1, Math.round((todayDate.getTime() - pastDate.getTime()) / 86400000));
    // Set flex to daysPast days expressed in minutes, plus 1440 extra (one buffer day).
    // This guarantees: flex >= daysPast * 1440  → guard fires → early return → NOT missed.
    var timeFlex = daysPast * 1440 + 1440;

    await db('task_masters').insert({
      id: 'b142-tmpl-ac5',
      user_id: USER_ID,
      text: 'BUG-142 AC5 within-timeFlex should NOT be missed',
      dur: 30,
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
      recur_start: PAST_DATE_KEY,
      // No recur_end — generates future desired occurrences so the reconciler
      // moves (rather than deletes) the past instance, keeping it in scope for Plan C.
      time_flex: timeFlex,       // large flex → still within window → must NOT miss
      when: '_invalid_window_',  // unplaceable (no matching time block)
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('task_instances').insert({
      id: 'b142-inst-ac5',
      master_id: 'b142-tmpl-ac5',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: null,          // never placed — triggers rawRowPast.date fallback
      date: PAST_DATE_KEY,         // past date, but within timeFlex window
      status: '',
      unscheduled: 1,
      overdue: 0,
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (AC5 — WARN-3 mutant kill):
    // Plan C uses rawRowPast.date=PAST_DATE_KEY as effectiveDate (bert's WARN-2 fallback).
    // The timeFlex guard at runSchedule.js:~1691 evaluates: flex >= daysPast * 1440 → TRUE
    // → returns early → instance is NOT marked 'missed'.
    //
    // MUTANT CATCH: deleting `if (flex >= daysPast * 1440) return;` causes the instance
    // to fall through to the missed write → status='missed' → this assertion FAILS RED.
    // The test verified RED-on-mutant during telly authoring (see TEST-CATALOG.md § AC5
    // mutant-catch verification).
    var missedRows = await db('task_instances')
      .where({ user_id: USER_ID, master_id: 'b142-tmpl-ac5', status: 'missed' });
    expect(missedRows.length).toBe(0); // FAILS if timeFlex guard is removed (mutant kill)
  });
});
