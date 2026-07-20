// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
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
// 999.1632: anchor fixture "today"/"today+/-N" to the PRODUCT's own clock
// (getNowInTimezone) instead of process-local `new Date()` getters / raw
// `toISOString()` UTC slicing — the process TZ (UTC in CI) and America/
// New_York's calendar day disagree during a daily window regardless of TZ.
var schedClock = require('./helpers/schedulerClock');

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
  await db('users').insert(__stampFixture({
    id: USER_ID, email: 'runsched@test.com', timezone: TZ,
    created_at: db.fn.now(), updated_at: db.fn.now()
  }));
  // Seed default config so scheduler can run
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) }));
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) }));
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
// 999.1410 regression: empty-when tasks must be eligible for the
// weekday "biz" work blocks (biz1 8am-12pm, biz2 1pm-5pm), not just
// morning/lunch/evening/night. The prior ALL_WINDOWS default
// ('morning,lunch,afternoon,evening,night') predated the biz1/biz2
// split and never included the 'biz' tag — biz1 (starts before noon)
// never even got buildWindowsFromBlocks' biz→afternoon alias, so an
// empty-when task could NEVER land in the 8am-12pm block, no matter
// how early the scheduler ran or how open that block was.
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: empty-when eligible for biz1 (999.1410)', () => {
  // 999.1427: the original version of this test derived a future dateKey from
  // the REAL wall clock and assumed the anytime task would stay on that day.
  // But a one-off `date` is a deadline, not a pin — the scheduler pulls the
  // anytime task forward to TODAY at the now-slot, so the asserted time simply
  // tracked the test run's wall clock (ceil(now/15)*15) and the test only
  // passed when run between 08:00 and 12:00 local (it was committed at 09:50).
  // Fix: freeze the scheduler clock (test-only _setClock seam) at 05:00 on a
  // FIXED weekday and seed everything on that same day — fully deterministic,
  // and it still exercises the 999.1410 window-eligibility fix: with morning
  // (360-480) and lunch (720-780) full, the earliest slot an empty-when task
  // can take is biz1 (480-720) — which pre-fix was structurally ineligible.
  var FROZEN_DAY = '2026-07-20'; // a Monday — weekday layout incl. biz1/biz2

  test('lands in biz1 (8am-12pm) when morning + lunch are already full and when is unset', async () => {
    if (!available) return;
    var { _setClock } = require('../src/scheduler/runSchedule');
    var { FakeClockAdapter } = require('./helpers/clock');
    // 05:00 EDT — before the 06:00 grid start, so the now-slot gate blocks
    // nothing and the morning block can be filled completely.
    var prevClock = _setClock(new FakeClockAdapter({ startTime: FROZEN_DAY + 'T05:00:00-04:00' }));
    try {
      // Fill morning (360-480, 120min) and lunch (720-780, 60min) completely.
      await seedTask({ id: 'fill-morning', text: 'Fills morning', when: 'morning', dur: 120, date: FROZEN_DAY });
      await seedTask({ id: 'fill-lunch', text: 'Fills lunch', when: 'lunch', dur: 60, date: FROZEN_DAY });
      // Target: no `when` set at all — production default for a plain task.
      await seedTask({ id: 'no-when-task', text: 'Anytime task', dur: 60, date: FROZEN_DAY, placement_mode: 'anytime' });

      await runScheduleAndPersist(USER_ID);
    } finally {
      _setClock(prevClock);
    }

    var row = await db('tasks_v').where('id', 'no-when-task').first();
    expect(row.scheduled_at).toBeTruthy();
    // scheduled_at is stored tz-less local time (dateStrings:true) — read the
    // raw column directly to avoid the documented dateStrings misparse trap.
    var rawRow = await db('task_instances').where('id', 'no-when-task').first();
    expect(String(rawRow.date)).toBe(FROZEN_DAY); // stayed on the frozen "today"
    var timeStr = String(rawRow.time); // 'HH:MM:SS'
    var parts = timeStr.split(':');
    var mins = Number(parts[0]) * 60 + Number(parts[1]);
    expect(mins).toBeGreaterThanOrEqual(480); // biz1 start
    expect(mins).toBeLessThan(720);           // biz1 end (lunch start)
  });
});

// ═══════════════════════════════════════════════════════════════
// Recurring instance handling
// ═══════════════════════════════════════════════════════════════

describe('runScheduleAndPersist: recurring instances', () => {
  // Same wall-clock trap the 999.1427 comment above documents: these two tests
  // ran the scheduler on the REAL clock and asserted today's instance got
  // PLACED (scheduled_at truthy / not unscheduled). Late in the evening
  // (observed 23:15 EDT, vinatieri pool gate 2026-07-15) today genuinely has
  // no remaining capacity, so the instance is correctly unscheduled per
  // NEVER-MISSING — the assertion, not the product, was time-of-day-flaky.
  // Freeze the scheduler clock at 05:00 on a fixed weekday (full empty day)
  // like the biz1 test above.
  var RECUR_FROZEN_DAY = '2026-07-20'; // Monday

  function withFrozenClock(fn) {
    var { _setClock } = require('../src/scheduler/runSchedule');
    var { FakeClockAdapter } = require('./helpers/clock');
    var prevClock = _setClock(new FakeClockAdapter({ startTime: RECUR_FROZEN_DAY + 'T05:00:00-04:00' }));
    return Promise.resolve()
      .then(fn)
      .finally(function() { _setClock(prevClock); });
  }

  test('expands recurring templates into instances', async () => {
    if (!available) return;
    await withFrozenClock(async function() {
      await seedTemplate({ id: 'tmpl-expand', text: 'Daily task', dur: 20 });
      await runScheduleAndPersist(USER_ID);
    });

    var instances = await db('tasks_v')
      .where({ user_id: USER_ID, source_id: 'tmpl-expand', task_type: 'recurring_instance' });
    expect(instances.length).toBeGreaterThan(0);
    instances.forEach(function(inst) {
      expect(inst.scheduled_at).toBeTruthy(); // expanded with a date
    });
  });

  test('recurring instances are NOT marked as unscheduled', async () => {
    if (!available) return;
    await withFrozenClock(async function() {
      await seedTemplate({ id: 'tmpl-nouns', text: 'No unscheduled', dur: 20 });
      await runScheduleAndPersist(USER_ID);
    });

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
//
// 999.1217 (W4, SCHEDULER-SPEC.md D6): runScheduleAndPersist used to write a
// placement snapshot into user_config as schedule_cache purely so
// cal-sync.controller.js could read split-part placements + duration
// corrections back out of it. cal-sync no longer reads schedule_cache
// (task_instances is authoritative for placements incl. split parts, 999.841)
// and GET /placements already moved off it earlier (W3,
// deriveSchedulePlacements.js) — nothing reads schedule_cache anymore, so the
// write + this describe block asserting it are removed.

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
    await db('task_instances').insert(__stampFixture({
      id: 'inst-no-sched', master_id: 'tmpl-test', user_id: USER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      status: '', dur: 30, created_at: db.fn.now(), updated_at: db.fn.now()
    }));

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

  // Helper: get today's key from the real clock. 999.1632: must be the SAME
  // "today" runScheduleAndPersist uses (getNowInTimezone(TZ)) — a raw UTC
  // calendar day disagrees with America/New_York's for a ~4-5h daily window
  // (NY midnight is 04:00/05:00 UTC), which flaked `scheduledDate >= today`
  // below regardless of process TZ. Tests run against the real scheduler
  // clock; we can't freeze it here.
  function todayKey() {
    return schedClock.todayKey(TZ);
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
    await db('task_masters').insert(__stampFixture({
      id: 'floating-red-master',
      user_id: USER_ID,
      text: 'Floating RED test task',
      dur: 30,
      status: '',
      when: '_invalid_window_',    // unplaceable: no time block matches this tag
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));
    // Insert instance with stale past date and a non-null scheduled_at
    // (simulating a prior scheduler run that placed it at 9 AM on STALE_DATE_KEY)
    await db('task_instances').insert(__stampFixture({
      id: 'floating-red-001',
      master_id: 'floating-red-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      date: STALE_DATE_KEY,                    // stale past date
      scheduled_at: STALE_DATE_KEY + ' 14:00:00', // 9 AM ET (UTC-5 Jan = UTC-4 June → 13:00, but 14:00 also past)
      dur: 30,
      status: '',                               // non-recurring, non-terminal
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

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
  // (forced via when='_invalid_window_') must be treated as genuinely overdue —
  // NEVER silently exempted the way a floating (no-deadline) task is (BUG-700).
  //
  // STRENGTHENED (999.671 zoe BLOCK): original AC3 used a PLACED task, so the
  // synthesis loop was never reached — the test stayed green even under a
  // universal `false &&` suppression. Using when='_invalid_window_' forces the
  // task through the same synthesis/isPastDue path the floating task uses.
  //
  // REVISED (999.1569): this fixture (hasScheduledAt=true, real deadline,
  // unifiedScheduleV2's D-A pinning pass rewrites in-memory `task.date` to the
  // deadline's OWN date-key for any genuinely-stillUnplaced one-off task) makes
  // computeIsPastDue's `t.date < todayKey` branch true regardless of placement
  // mode — Phase 8 Case B (runSchedule.js ~2059-2094) therefore always routes
  // this task through `isMovablePastDue` → unscheduled=1/scheduled_at=null, the
  // SAME branch 999.1569's fixture exercises, not the "pinned in place, still
  // shown overdue on the grid" branch the original assertion assumed. The
  // original assertion (`found` in `dayPlacements`) was unknowingly pinned to
  // 999.1569's bug: pre-fix, the synthesis-loop guard read a stale pre-Phase-1
  // rawRowById snapshot and synthesized a bogus grid entry for this
  // already-unscheduled-this-run task; post-fix (999.1569), the guard correctly
  // sees Case B's own-run write and excludes it from dayPlacements entirely —
  // exactly the "movable overdue tasks ... must appear only in the Issues
  // Unscheduled section" invariant already documented at runSchedule.js
  // (Synthesize placements comment, ~2537-2538). Updated to assert the CORRECT
  // invariant instead: the task lands in result.unplaced (not the grid), NOT
  // silently dropped (a real unplaced_reason is set), and its persisted state
  // still reads genuinely overdue (never exempted the way a floating/no-deadline
  // task would be per BUG-700) — preserving AC3's original guard intent.
  test('AC3 (guard): deadline-bearing UNPLACEABLE task past its deadline is genuinely overdue — routed to unplaced (999.1569), never silently exempted like a floating task', async () => {
    if (!available) return;

    await db('task_masters').insert(__stampFixture({
      id: 'deadline-past-unplaceable',
      user_id: USER_ID,
      text: 'Past deadline unplaceable task',
      dur: 30,
      status: '',
      when: '_invalid_window_',       // unplaceable: forces synthesis loop
      deadline: '2025-06-01 23:59:59', // clearly past deadline
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'deadline-past-unplaceable',
      master_id: 'deadline-past-unplaceable',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      date: STALE_DATE_KEY,                         // stale past date
      scheduled_at: STALE_DATE_KEY + ' 14:00:00',  // non-null time → scheduledMins non-null
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    var result = await runScheduleAndPersist(USER_ID);

    // NEVER-MISSING (999.1569): must NOT appear on the calendar grid (it is
    // unscheduled=1 this run) — the day-end-cram / stale-guard bug is fixed.
    var found = findInPlacements(result.dayPlacements, 'deadline-past-unplaceable');
    expect(found).toBeNull();

    // Must be in the unplaced/unscheduled list instead, with a real reason —
    // not silently dropped (which would also, wrongly, satisfy "not in dayPlacements").
    var unplacedEntry = (result.unplaced || []).find(function(u) {
      return (u.id || (u.task && u.task.id)) === 'deadline-past-unplaceable';
    });
    expect(unplacedEntry).toBeTruthy();
    var unplacedTask = unplacedEntry.task || unplacedEntry;
    expect(unplacedTask._unplacedReason).toBeTruthy();

    // AC3's original guard intent preserved: a deadline-bearing task must read
    // genuinely overdue (never silently exempted the way BUG-700 exempts a
    // floating/no-deadline task) via the computed read model.
    var row = await db('tasks_v').where('id', 'deadline-past-unplaceable').first();
    expect(row).toBeTruthy();
    var t = rowToTask(row, TZ, null, null);
    expect(t.overdue).toBe(true);
  });

  // BUG-671-AC4 — GUARD TEST (must remain GREEN before and after fix).
  // A past-incomplete recurring instance that the scheduler has already
  // flagged overdue MUST NOT be rolled forward or have its overdue/status
  // touched by a subsequent scheduler run.
  //
  // 999.1038: rewritten. status='missed' was retired by migration
  // 20260628100000_remove_missed_from_status_constraints.js (David,
  // 2026-06-24: "there should not be any auto-miss feature") — the DB CHECK
  // constraint on task_instances.status no longer accepts 'missed' at all, so
  // this test's original fixture-seed step (`update({status:'missed', ...})`)
  // now THROWS on a fresh test-bed (confirmed via SHOW CREATE TABLE
  // task_instances: chk_task_instances_status only allows '', done, cancel,
  // skip, pause, disabled, archived, restored, cancelled). Per
  // runSchedule.js:2258-2278 ("Leg D — AUTO-MISS REMOVED"), the equivalent
  // terminal-ish state for "past, incomplete, already flagged" is now
  // status='' + overdue=1 (scheduled_at stays set, pinned on its day) — the
  // `if (!rawRowPast.overdue) { ...update... }` guard there is a no-op once
  // overdue is already 1, which is exactly the "not altered" behavior this
  // test asserts. Same intent as the original (a settled past-due instance is
  // not perpetually re-touched), expressed in the current status vocabulary.
  //
  // Implementation note: the reconciler deletes "stale" pending recurring
  // instances that don't match the template's expected ID scheme. We therefore
  // test an instance that is ALREADY overdue=1 (a state the reconciler
  // respects and leaves intact) and verify a second scheduler run does not
  // alter it.
  test('AC4 (guard): already-overdue past recurring instance is NOT altered by a subsequent scheduler run', async () => {
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
      dur: 30,
    });

    // First run: verify the scheduler doesn't touch or roll the already-past instance.
    var result1 = await runScheduleAndPersist(USER_ID); // eslint-disable-line no-unused-vars

    // The seeded instance is our concrete past-due instance. W3 (sched-drop-
    // overdue-column, M-5, 2026-07-03): there is no longer a stored overdue
    // flag to set — a placed DAILY recurring instance (seedTemplate's default
    // recur) whose scheduled_at is in the past ALREADY reads overdue:true via
    // the computed FIXED/isPlacedRecurringInstance branch (taskMappers.js
    // computeOverdueForRow), with zero write needed. status stays '' —
    // 'missed' is no longer a valid value.
    var todayInst = await db('task_instances').where('id', 'ac4-inst-seeded').first();
    expect(todayInst).toBeTruthy(); // seeded instance MUST exist — not vacuous

    var OVERDUE_SCHED = STALE_DATE_UTC; // scheduled_at stays pinned in the past
    await db('task_instances').where('id', todayInst.id).update({
      status: '',
      scheduled_at: OVERDUE_SCHED,
      completed_at: null, // incomplete — not done, never was
      updated_at: db.fn.now(),
    });

    // zoe (999.1037/1038/1035 audit, 2026-07-01): captured via real mutation
    // testing — deleting runSchedule.js's Phase 9 guard entirely still passed
    // the ORIGINAL version of this assertion set, because the guard's own
    // update payload was idempotent on status/scheduled_at when the row was
    // already in its final state. The one field a redundant write WOULD still
    // touch is `updated_at`. Capture the seeded updated_at now and assert it
    // is BYTE-IDENTICAL after run 2 — this is guard-specific: it only stays
    // unchanged when no write fires at all, catching the exact false-pass
    // zoe demonstrated. W3 deletes the Phase 9 overdue-pin write outright (no
    // computed-equivalent needed — see runSchedule.js), so this instance now
    // gets ZERO writes on a stable second run rather than an idempotent one.
    var seededRow = await db('task_instances').where('id', todayInst.id).first();
    var seededUpdatedAt = seededRow.updated_at;

    // Second scheduler run
    await runScheduleAndPersist(USER_ID);

    // The overdue instance must NOT have been altered — still '', still overdue,
    // still at its past date.
    var row = await db('task_instances').where('id', todayInst.id).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('');

    // scheduled_at must not have been rolled to today or later
    var scheduledDate = (row.scheduled_at || '').slice(0, 10);
    var today = todayKey();
    expect(scheduledDate < today).toBe(true); // not rolled forward

    // Must still compute overdue:true — the read-time computed predicate
    // (taskMappers.js computeOverdueForRow), not a raw stored column. A
    // regression that rolls the instance forward or clears its hard-commitment
    // signal (deadline/implied_deadline/scheduled_at) would flip this.
    var viewRow = await db('tasks_v').where('id', todayInst.id).first();
    var task = rowToTask(viewRow, TZ, null, null);
    expect(task.overdue).toBe(true);

    // GUARD-SPECIFIC assertion (zoe mutation-test fix): updated_at must be
    // UNCHANGED — a redundant write stamps a fresh updated_at even when every
    // other field happens to end up at the same values, so this catches
    // exactly the false-pass zoe demonstrated.
    expect(String(row.updated_at)).toBe(String(seededUpdatedAt));
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

    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'b700-tw-inst',
      master_id: 'b700-tw-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // prior placement on past date -> hasScheduledAt=true -> Case B
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // W3 (sched-drop-overdue-column, M-5, 2026-07-03): `task_instances.overdue`
    // is no longer written or stored — assert the computed/API value instead
    // (a floating no-deadline task always reads overdue:false, matching the
    // guard's original intent with zero stored-column dependency).
    var row = await db('tasks_v').where('id', 'b700-tw-inst').first();
    expect(row).toBeTruthy();
    var task = rowToTask(row, TZ, null, null);
    expect(task.overdue).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────
  // AC1-HOLE1b -- RED pre-fix: time_blocks floating task, past+unplaceable
  //
  // Strategy A: time_blocks respects when-tags -> when='_invalid_window_' -> unplaceable.
  // ─────────────────────────────────────────────────────────────

  test('AC1-HOLE1b (RED): floating time_blocks task, past+unplaceable, must NOT get overdue=1', async () => {
    if (!available) return;

    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'b700-tb-inst',
      master_id: 'b700-tb-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // prior placement -> hasScheduledAt=true -> Case B
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // W3 (sched-drop-overdue-column, M-5, 2026-07-03): assert the computed/API
    // value — see AC1-HOLE1a above for rationale.
    var row = await db('tasks_v').where('id', 'b700-tb-inst').first();
    expect(row).toBeTruthy();
    var task = rowToTask(row, TZ, null, null);
    expect(task.overdue).toBe(false);
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

    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'b700-any-past-inst',
      master_id: 'b700-any-past-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // PAST date -> original.date < todayKey -> _aInPast=true
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // W3 (sched-drop-overdue-column, M-5, 2026-07-03): assert the computed/API
    // value — see AC1-HOLE1a above for rationale.
    var row = await db('tasks_v').where('id', 'b700-any-past-inst').first();
    expect(row).toBeTruthy();
    var task = rowToTask(row, TZ, null, null);
    expect(task.overdue).toBe(false);
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

    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'b700-clear-inst',
      master_id: 'b700-clear-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC,
      unscheduled: 0,  // Case B state: pinned to calendar position
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // W3 (sched-drop-overdue-column, M-5, 2026-07-03): `task_instances.overdue`
    // is no longer written by any scheduler path — this assertion previously
    // checked the RAW stored column post-run; that write is deleted outright
    // (SPEC.md "Design — write-side sites that become dead"), so the seeded
    // stale `overdue: 1` above is simply never touched by this run (the row
    // stays exactly as seeded). The PRODUCTION-VISIBLE value is the computed
    // read (rowToTask/computeOverdueForRow), which correctly reads false for
    // this floating (no-deadline) task per 999.671 regardless of any stored
    // value — asserted via the real read mapper, matching the established
    // pattern elsewhere in this file (z-3 D-A test above).
    var row = await db('tasks_v').where('id', 'b700-clear-inst').first();
    expect(row).toBeTruthy();
    // No nowInfo injected — STALE_DATE_UTC (2026-06-08) is unambiguously past
    // relative to real wall-clock "now" at test-run time; real now-context is fine.
    var t = rowToTask(row, TZ, null, null);
    expect(t.overdue).toBe(false);
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

    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'b700-dl-inst',
      master_id: 'b700-dl-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // prior placement -> hasScheduledAt=true -> Case B
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // W3 (sched-drop-overdue-column, M-5, 2026-07-03): `task_instances.overdue`
    // is no longer written (see AC2 above for the same rationale) — the
    // PRODUCTION-VISIBLE assertion is the computed read (rowToTask), which
    // reads true for this deadline-bearing, past-deadline task via the
    // `deadline` hasHardCommitment branch, independent of any stored write.
    var row = await db('tasks_v').where('id', 'b700-dl-inst').first();
    expect(row).toBeTruthy();
    // No nowInfo injected — deadline (2025-01-01) is unambiguously past
    // relative to real wall-clock "now" at test-run time.
    var t = rowToTask(row, TZ, null, null);
    expect(t.overdue).toBe(true); // must be GREEN before fix AND after fix
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

    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'b700-ac4-inst',
      master_id: 'b700-ac4-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      // No scheduled_at: never placed -> hasScheduledAt=false -> Case C (not Case B)
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (GREEN guard): Case C path -> unscheduled=1, no overdue write.
    // Both before and after the fix (Case C never writes overdue). W3
    // (sched-drop-overdue-column): `overdue` is no longer a stored column at
    // all, so `row.overdue` is intentionally omitted here (there is nothing to
    // read) — `unscheduled` is the sole outcome this guard checks.
    var row = await db('task_instances').where('id', 'b700-ac4-inst').first();
    expect(row).toBeTruthy();
    expect(row.unscheduled).toBe(1); // Case C: moves to unscheduled lane
  });

  // ─────────────────────────────────────────────────────────────
  // z-3 (leg sched-audit, DADC-ZOE-REVIEW.md finding #3) — the Case C
  // DATE-PERSIST hunk itself (runSchedule.js:2122-2124):
  //
  //   if (original.deadline && original.date) {
  //     unplacedDbUpdate.date = original.date;
  //   }
  //
  // AC4 above (2099 deadline) only proves overdue/unscheduled for Case C — it
  // never asserts the persisted `date` column, so the D-A ruling's DB half
  // ("pinned to its own DEADLINE date, never left at the stale prior date")
  // was executed-but-unasserted (zoe: coverage theater). This test uses a
  // PAST deadline (not 2099) so the pin's effect on `date` is actually
  // observable, and seeds a stale prior `date` DIFFERENT from the deadline so
  // an unwritten/no-op hunk would be caught red-handed.
  //
  // Non-tautology proof (RED-genuineness, TEST-AUTHORING §Regression-test
  // self-verification): /tmp-backed-up runSchedule.js, commented out the
  // `if (original.deadline && original.date) { unplacedDbUpdate.date = ...; }`
  // block (lines 2122-2124) -> re-ran this test -> RED (row.date stayed at
  // the stale prior value, Z3_STALE_DATE_KEY, never became the deadline) ->
  // restored the file from the /tmp backup -> shasum verified byte-identical
  // -> re-ran -> GREEN. See DA-TEST-REVIEW.md iteration 3 proof-of-work.
  // ─────────────────────────────────────────────────────────────

  test('z-3 (DB persist coverage): deadline-bearing anytime one-off, PAST deadline, never placed -- Case C persists row.date == deadline (not the stale prior date), unscheduled=1, scheduled_at NULL, reads overdue via rowToTask', async () => {
    if (!available) return;

    var Z3_PAST_DEADLINE_KEY = '2026-06-15'; // fixed always-past deadline day
    var Z3_STALE_DATE_KEY = '2026-06-20';    // stale prior `date`, DIFFERENT from the deadline

    await db('task_masters').insert(__stampFixture({
      id: 'z3-persist-master',
      user_id: USER_ID,
      text: 'z-3 Case C date-persist coverage (past deadline)',
      dur: 30,
      status: '',
      placement_mode: 'anytime',
      when: '_invalid_window_',                      // unplaceable -> result.unplaced (never placed)
      deadline: Z3_PAST_DEADLINE_KEY + ' 23:59:59',   // PAST deadline (NOT 2099 like AC4 above)
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'z3-persist-inst',
      master_id: 'z3-persist-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      date: Z3_STALE_DATE_KEY,   // stale prior date -- must be overwritten to the deadline
      // No scheduled_at: never placed -> hasScheduledAt=false -> Case C (not Case B)
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // Read via tasks_v (the real unified template+instance read model — same
    // view rowToTask/the API consume) so `deadline` (stored on task_masters)
    // is present on the row, not just the task_instances columns.
    var row = await db('tasks_v').where('id', 'z3-persist-inst').first();
    expect(row).toBeTruthy();

    // THE CORE ASSERTION (runSchedule.js:2122-2124 Case C date-persist hunk):
    // persisted row.date is the DEADLINE date, never the stale prior date.
    expect(String(row.date).slice(0, 10)).toBe(Z3_PAST_DEADLINE_KEY);
    expect(String(row.date).slice(0, 10)).not.toBe(Z3_STALE_DATE_KEY);
    expect(row.unscheduled).toBe(1);
    expect(row.scheduled_at).toBeNull();

    // Production-visible overdue: the REAL read mapper (rowToTask), not a
    // hand-rolled re-derivation, against a fixed now-context well after the
    // fixed past deadline. (rowToTask's `date` field is intentionally out of
    // scope here — its row.date->task.date fallback is gated to
    // task_type==='recurring_instance' [taskMappers.js:254, "Bug A"], a
    // separate non-recurring-scoped design decision; z-3 is specifically the
    // D-A one-off persisted-column + computed-overdue contract, asserted on
    // the raw persisted row above.)
    var nowInfo = { todayKey: '2026-07-02', nowMins: 720 };
    var t = rowToTask(row, TZ, null, null, nowInfo);
    expect(t.overdue).toBe(true);
    expect(t.unscheduled).toBe(true);
  }, 30000);

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
    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'b700-chain-blocker-inst',
      master_id: 'b700-chain-blocker-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      // No scheduled_at: never placed -> Case C (unscheduled=1), not Case B
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    // Chain member: depends on blocker, has a prior past placement, no deadline.
    // depends_on stored as JSON array in task_masters.
    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
      id: 'b700-chain-member-inst',
      master_id: 'b700-chain-member-master',
      user_id: USER_ID,
      occurrence_ordinal: 1,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: STALE_DATE_UTC, // prior placement -> hasScheduledAt=true -> PATH B Case B
      dur: 30,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // ASSERTION: The `!original.deadline` guard at runSchedule.js:1520 must protect
    // the chain-member (task_type='task', dependsOn non-empty) the same way it
    // protects one-off tasks. W3 (sched-drop-overdue-column, M-5, 2026-07-03):
    // assert the computed/API value (rowToTask) — `overdue` is no longer a
    // stored column.
    var row = await db('tasks_v').where('id', 'b700-chain-member-inst').first();
    expect(row).toBeTruthy();
    var task = rowToTask(row, TZ, null, null);
    expect(task.overdue).toBe(false); // !original.deadline guard at :1520 covers chain-members
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
  // BUG-142-AC1 (NEVER-MISSING — supersedes the 2026-06-16 delete ruling):
  //
  // A RECURRING instance with `date=NULL` and `scheduled_at=NULL` is an
  // ANOMALOUS / LEGACY state. Modern Phase 1 pre-insert (expandRecurring)
  // always writes a non-null occurrence date; date=NULL rows only arise from
  // old code that pre-dates that invariant.
  //
  // SUPERSEDED RULING: the original 2026-06-16 Oscar ruling held that the
  // reconciler DELETING such an orphan was "acceptable cleanup". That ruling
  // was overturned by the NEVER-MISSING invariant (David, 2026-06-24): no task
  // is ever absent — every row is always materialized and surfaced as placed |
  // overdue | unscheduled. The "never hard-delete a past incomplete recurring
  // instance" fix (runSchedule.js commit 4dfca2d) + auto-miss removal (7b9e0f6)
  // mean the reconciler now SPARES this orphan instead of deleting it. The row
  // survives, stays open (status=''), and is flagged `unscheduled` so it remains
  // visible in the Unplaced view — never silently dropped.
  // ─────────────────────────────────────────────────────────────────────────
  test('AC1 (NEVER-MISSING): date=NULL recurring orphan SURVIVES and stays visible (unscheduled) — not deleted', async () => {
    if (!available) return;

    // Template with recur_end in the past → expandRecurring generates NO future
    // desired occurrences → the instance has no match in desiredIds.
    await db('task_masters').insert(__stampFixture({
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
    }));

    // LEGACY/ANOMALOUS state: date=NULL + scheduled_at=NULL.
    // Modern expandRecurring always writes a non-null date; this state only
    // arises from old code. The reconciler treats this as an unmatched orphan.
    await db('task_instances').insert(__stampFixture({
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
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

    await runScheduleAndPersist(USER_ID);

    // ASSERTION (AC1 — NEVER-MISSING):
    // The reconciler must NOT hard-delete this orphan (commit 4dfca2d). The row
    // survives, stays open (not auto-missed — auto-miss retired, 7b9e0f6), and
    // is surfaced as unscheduled so it stays visible. Never silently dropped.
    var row = await db('task_instances').where('id', 'b142-inst-ac1').first();
    expect(row).toBeDefined();          // never-missing: the row must still exist
    expect(row.status).toBe('');        // not auto-marked terminal 'missed'
    expect(row.unscheduled).toBe(1);    // surfaced as unscheduled → stays visible
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
  test('AC1b: never-placed past recurring instance (scheduled_at=NULL) → unscheduled (visible), never missed [Leg D]', async () => {
    if (!available) return;

    // Template with a broader recur window so the reconciler CAN generate
    // desired occurrences and may try to MOVE the past instance to a future date.
    // This exercises the reconcile-move path (PATH B + occurrenceMove).
    // The template recurs daily but started in the past; the instance should
    // still become 'missed' even if the reconciler tries to reuse it for the future.
    await db('task_masters').insert(__stampFixture({
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
    }));

    // Instance has `date` set to the past but `scheduled_at=NULL` (never placed).
    // buildExistingGroups will see g.dateObj from row.date → includes in `remaining`.
    // matchOccurrences may match this to a future desired date → occurrenceMove.
    // In-memory: t.date gets set to future date → Plan C td >= today → skips.
    // OR if not matched: toDeleteIds → deleted.
    // Either way: AC1 behavior (status='missed') is not achieved.
    await db('task_instances').insert(__stampFixture({
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
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

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

    // UPDATED for Leg D (scheduler-recurring-rework §4 — auto-miss REMOVED, David 2026-06-24).
    // A never-placed past recurring instance is NO LONGER auto-marked terminal 'missed'.
    // Per the never-missing invariant it must remain VISIBLE: status stays non-terminal and
    // it is surfaced in the Unplaced list (unscheduled=1), never deleted, never missed.
    expect(row.status).not.toBe('missed');
    expect(['']).toContain(row.status || '');
    expect(!!row.unscheduled).toBe(true); // visible in Unplaced (never absent)
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

    await db('task_masters').insert(__stampFixture({
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
    }));

    // Instance for TOMORROW — not yet past. The scheduler must NOT mark it missed.
    await db('task_instances').insert(__stampFixture({
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
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

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
    await db('task_masters').insert(__stampFixture({
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
    }));
    await db('task_instances').insert(__stampFixture({
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
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

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
    // After the run, scheduled_at must be >= today (rolled forward). 999.1632:
    // must be the SAME "today" runScheduleAndPersist uses (getNowInTimezone(TZ))
    // — a raw UTC calendar day disagrees with America/New_York's for a ~4-5h
    // daily window (NY midnight is 04:00/05:00 UTC).
    var todayKey = schedClock.todayKey(TZ);
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

    await db('task_masters').insert(__stampFixture({
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
    }));

    await db('task_instances').insert(__stampFixture({
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
      dur: 30,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    }));

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

// ═══════════════════════════════════════════════════════════════
// §8 preserve-path — juggler-overdue-reschedule bugfix
//
// runSchedule.js:1576-1586 (§8): recurring instances with a DB-stored
// scheduled_at hit `if (hasScheduledAt) return` and are skipped in the
// pendingUpdates loop. Before the unifiedScheduleV2 forward-roll fix
// (bert Round 1), this caused a flexible-TPC instance to be silently
// kept at its past dead slot — the scheduler placed it on a future day
// in memory but never wrote the new slot back to the DB because §8
// short-circuited on `rawRec.scheduled_at !== null`.
//
// After the fix: the forward-rolled placement must be persisted.
// This test seeds a flexible-TPC instance with a past scheduled_at and
// confirms that after runScheduleAndPersist the DB row has a future
// scheduled_at (or at least a different/cleared one — not the old dead slot).
//
// Traceability: .planning/kermit/juggler-overdue-reschedule/TRACEABILITY.md — AC1
// REFER source: BERT-LOG.md Round-1 "REFER→telly: runSchedule.js:1576-1586"
// ═══════════════════════════════════════════════════════════════

describe('§8 preserve-path: flexible-TPC past scheduled_at → forward-rolled on DB persist', () => {
  test('flexible-TPC instance with past DB scheduled_at gets updated to future slot after runScheduleAndPersist', async () => {
    if (!available) return;

    // Seed a recurring template: weekly, timesPerCycle=1 (flexible-TPC), 7 days.
    // placement_mode: time_blocks (non-ANYTIME so it flows through the
    // pastAnchoredPreQueue routing path rather than the buildItems:274 ANYTIME drop-filter).
    // Use seedTemplate/seedInstance helpers so tasksWrite handles the master/instance split.
    var tmplId = 'sec8-tmpl-001';
    await seedTemplate({
      id: tmplId,
      text: 'Call Mom (sec8 test)',
      dur: 30,
      placement_mode: 'time_blocks',
      flex_when: 1,
      recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 1 }
    });

    // Use today-3 as the dead anchor so the recurrence period end (anchor+7 = today+4)
    // is still in the future — the instance is within-period and eligible for forward-roll.
    // 999.1632: anchored to the PRODUCT's today (getNowInTimezone(TZ)), not
    // process-local `new Date()` + toISOString() UTC slicing — the previous
    // form mixed a process-TZ day-arithmetic step with a UTC-formatted result,
    // disagreeing with America/New_York's calendar day under TZ=UTC.
    var pastDateKey = schedClock.dateFromToday(-3, TZ);          // YYYY-MM-DD
    var pastScheduledAt = pastDateKey + ' 14:00:00';            // 2pm UTC on dead day

    var instId = tmplId + '-' + pastDateKey.replace(/-/g, '');
    // seedInstance inserts into task_masters + task_instances correctly.
    await seedInstance(tmplId, {
      id: instId,
      placement_mode: 'time_blocks',
      flex_when: 1,
      recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 1 },
      date: pastDateKey,             // dead anchor date (in the past)
      scheduled_at: pastScheduledAt, // past DB scheduled_at — triggers §8 hasScheduledAt=true
      occurrence_ordinal: 1
    });

    // Verify the row exists with the past scheduled_at before the run.
    // tasks_v joins master + instance; scheduled_at comes from task_instances.
    var before = await db('task_instances').where('id', instId).first();
    expect(before.scheduled_at).toBe(pastScheduledAt);

    // Run the full scheduler pipeline.
    await runScheduleAndPersist(USER_ID);

    // ASSERTION (§8 forward-roll): the flexible-TPC instance must NOT keep its
    // dead past scheduled_at. The scheduler forward-rolled it in memory; the §8
    // path must NOT short-circuit on `hasScheduledAt=true` for roamable instances
    // — the new slot must be written back to the DB.
    //
    // Acceptable outcomes post-fix:
    //   (a) scheduled_at updated to a future date (ideal — forward-rolled and persisted).
    //   (b) scheduled_at cleared to null (no slot found in cycle, but dead slot released).
    //
    // NOT acceptable: scheduled_at === pastScheduledAt (§8 short-circuited; dead slot kept).
    //
    // MUTANT CATCH: if the §8 path still returns early for flexible-TPC instances,
    // scheduled_at stays === pastScheduledAt and this assertion FAILS RED.
    var after = await db('task_instances').where('id', instId).first();
    expect(after.scheduled_at).not.toBe(pastScheduledAt);
  });
});
