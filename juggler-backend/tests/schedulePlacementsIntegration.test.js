/**
 * Integration tests for deriveSchedulePlacements — the W3 DB-sourced read helper.
 *
 * W3 (DB single source): getSchedulePlacements and the schedule_cache read path
 * were deleted. All placement reads now use deriveSchedulePlacements, which calls
 * taskFacade.getAllTasks (the same path as GET /api/tasks) and derives placements
 * from live DB state — no cache involved.
 *
 * Tests that formerly covered cache-path behaviour (staleness, clock-skew grace,
 * fast-path timing) are repointed or removed:
 *   - Cache staleness / fast-path tests → removed (cache is write-only now).
 *   - Placement shape + unplaced list → retained, repointed to deriveSchedulePlacements.
 *   - Overdue snap/collision tests → retained using runScheduleAndPersist directly
 *     (the overdue injection lives in runScheduleAndPersist, not in the read helper).
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { deriveSchedulePlacements } = require('../src/scheduler/deriveSchedulePlacements');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'placements-test-001';

beforeAll(async () => {
  await assertDbAvailable();
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

describe('deriveSchedulePlacements', () => {
  // ── Core shape tests ─────────────────────────────────────────────────────────

  test('returns { dayPlacements, unplaced, warnings } shape', async () => {
    if (!available) return;
    // Run scheduler first so the task has a scheduled_at (date+time) in the DB.
    await tasksWrite.insertTask(db, { id: 'gp-001', user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, status: '', when: 'morning', created_at: db.fn.now(), updated_at: db.fn.now() });
    await runScheduleAndPersist(USER_ID);
    var result = await deriveSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    expect(result).toBeDefined();
    expect(result.dayPlacements).toBeDefined();
    expect(result.unplaced).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  test('returns dayPlacements for a user with no tasks (empty state)', async () => {
    if (!available) return;
    // User exists but has no tasks — helper must return the empty shape, not throw.
    var result = await deriveSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    expect(result).toBeDefined();
    expect(typeof result.dayPlacements).toBe('object');
    expect(Array.isArray(result.unplaced)).toBe(true);
  });

  test('returns unplaced tasks list — tasks without date/time appear in unplaced', async () => {
    if (!available) return;
    // A task with no date/time set (no scheduled_at) stays in the backlog → unplaced.
    await tasksWrite.insertTask(db, { id: 'gp-005', user_id: USER_ID, task_type: 'task', text: 'Backlog task', dur: 30, status: '', created_at: db.fn.now(), updated_at: db.fn.now() });
    // Do NOT run the scheduler — task stays with no scheduled_at (no date/time).
    var result = await deriveSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    expect(result.unplaced).toBeDefined();
    expect(Array.isArray(result.unplaced)).toBe(true);
    // The task with no date/time must not appear in dayPlacements.
    var allPlacedIds = Object.values(result.dayPlacements).flat().map(function(p) {
      return p && p.task && p.task.id;
    }).filter(Boolean);
    expect(allPlacedIds).not.toContain('gp-005');
  });

  test('placed task appears in dayPlacements[date] after scheduler run', async () => {
    if (!available) return;
    await tasksWrite.insertTask(db, { id: 'gp-placed-001', user_id: USER_ID, task_type: 'task', text: 'Morning task', dur: 30, status: '', when: 'morning', created_at: db.fn.now(), updated_at: db.fn.now() });
    // Scheduler sets date + time on the task instance.
    await runScheduleAndPersist(USER_ID);
    var result = await deriveSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    // At least one day has a placement (the scheduler placed the task somewhere).
    var totalPlaced = Object.values(result.dayPlacements).reduce(function(sum, arr) { return sum + arr.length; }, 0);
    expect(totalPlaced).toBeGreaterThan(0);
  });

  test('placement entry has start and end derived from task time+dur', async () => {
    if (!available) return;
    var DUR = 45;
    await tasksWrite.insertTask(db, { id: 'gp-startend-001', user_id: USER_ID, task_type: 'task', text: 'Start/end', dur: DUR, status: '', when: 'morning', created_at: db.fn.now(), updated_at: db.fn.now() });
    await runScheduleAndPersist(USER_ID);
    var result = await deriveSchedulePlacements(USER_ID, { timezone: 'America/New_York' });
    var allEntries = Object.values(result.dayPlacements).flat();
    var entry = allEntries.find(function(p) { return p && p.task && p.task.id === 'gp-startend-001'; });
    expect(entry).toBeDefined();
    expect(typeof entry.start).toBe('number');
    expect(typeof entry.end).toBe('number');
    expect(entry.end).toBe(entry.start + DUR);
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
    // deriveSchedulePlacements is a read-only helper and does not run the overdue injection.
    // runScheduleAndPersist is the authoritative path for overdue snap behaviour.
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
    // runScheduleAndPersist, not in deriveSchedulePlacements (read-only helper).
    var result = await runScheduleAndPersist(USER_ID, undefined, { timezone: 'America/New_York' });
    var placements = (result.dayPlacements && result.dayPlacements[todayKey]) || [];
    var placement = placements.find(function(p) { return p.task && p.task.id === 'gp-snap-001'; });
    expect(placement).toBeDefined();
    expect(placement._overdue).toBe(true);
    expect(placement.start).toBe(expectedStart);
  });

  // NOTE: collision-avoidance for overdue tasks at the same start minute is an
  // overdue-injection behaviour in runScheduleAndPersist (not in deriveSchedulePlacements).
  // That concern is covered by the runScheduleIntegration suite via runScheduleAndPersist.

  test('999.671 roll-forward contract: FLOATING past+unplaceable task is NOT flagged _overdue on stale past date', async () => {
    // 999.671 USER DECISION: "roll-forward wins" — floating tasks (no deadline) must
    // NEVER be flagged past-due/_overdue, even when unplaceable (when='_invalid_window_').
    //
    // Previous test asserted _overdue=true for this scenario — that encoded the BUG.
    // Correct contract: a floating task has no firm commitment; a stale past date
    // just means the scheduler previously placed it there. With bert's fix at
    // runSchedule.js:1825 (`(t.deadline || t.overdue) &&`), isPastDue is gated so
    // that deadline=null + overdue=0 → isPastDue=false → the task never appears in
    // dayPlacements on the old date with _overdue=true.
    //
    // When='_invalid_window_' → no matching time block → task goes to result.unplaced
    // → stays out of placedIds → synthesis loop fires but isPastDue is now false →
    // task does NOT appear in dayPlacements with _overdue=true on the past date.
    //
    // Traceability: BUG-671 (.planning/kermit/jug-floating-past-due/TRACEABILITY.md)
    if (!available) return;
    var pastDate = '2025-01-15';
    var scheduledAt = pastDate + ' 14:00:00';
    await db('task_masters').insert({
      id: 'gp-pastdue-001', user_id: USER_ID, text: 'Past due floating task',
      dur: 30, status: '', when: '_invalid_window_',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('task_instances').insert({
      id: 'gp-pastdue-001', master_id: 'gp-pastdue-001', user_id: USER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      date: pastDate, scheduled_at: scheduledAt, overdue: 0,
      dur: 30, status: '', created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var result = await runScheduleAndPersist(USER_ID, undefined, { timezone: 'America/New_York' });

    // ASSERTION (roll-forward contract): floating + no-deadline task must NOT appear
    // on the stale past date with _overdue=true. isPastDue must be false for it.
    var pastDatePlacements = (result.dayPlacements && result.dayPlacements[pastDate]) || [];
    var overdueOnPastDate = pastDatePlacements.find(function(p) {
      return p.task && p.task.id === 'gp-pastdue-001' && p._overdue;
    });
    expect(overdueOnPastDate).toBeUndefined();

    // If the task appears anywhere in dayPlacements, it must not carry _overdue=true.
    if (result.dayPlacements) {
      Object.keys(result.dayPlacements).forEach(function(dk) {
        var entries = result.dayPlacements[dk] || [];
        entries.forEach(function(p) {
          if (p.task && p.task.id === 'gp-pastdue-001') {
            expect(p._overdue).toBeFalsy();
          }
        });
      });
    }

    // NOTE: Phase 8 (PATH B) may still write overdue=1 to the DB for a floating
    // task with _aInPast=true. That is a separate concern from the display synthesis
    // fix. Bert's fix (lines 1825+2202) guards the DISPLAY path: even if the DB has
    // overdue=1, the `(t.deadline || t.overdue) &&` gate at :1825 ensures the task
    // does not appear with _overdue=true on the past date via isPastDue.
    // The DB column assertion is intentionally omitted here — it belongs to a
    // separate Phase 8 fix leg, not BUG-671's display-synthesis scope.
  });

  test('999.671 deadline-bearing past+unplaceable task IS flagged _overdue (deadline contract preserved)', async () => {
    // Companion to the roll-forward test: a DEADLINE-bearing task that is past its
    // deadline AND unplaceable (when='_invalid_window_') SHOULD appear with _overdue
    // via the isPastDue path, because `(t.deadline || t.overdue)` is truthy.
    //
    // This guards bert's fix from over-suppression: if the gate were written as `false &&`
    // universally, this test would flip RED, proving the fix is wrong.
    //
    // Traceability: BUG-671
    if (!available) return;
    var pastDate = '2025-01-15';
    var scheduledAt = pastDate + ' 14:00:00';
    await db('task_masters').insert({
      id: 'gp-pastdue-deadline-001', user_id: USER_ID, text: 'Past deadline unplaceable task',
      dur: 30, status: '', when: '_invalid_window_',
      deadline: '2025-01-10 23:59:59', // deadline clearly in the past
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db('task_instances').insert({
      id: 'gp-pastdue-deadline-001', master_id: 'gp-pastdue-deadline-001', user_id: USER_ID,
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
      date: pastDate, scheduled_at: scheduledAt, overdue: 0,
      dur: 30, status: '', created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var result = await runScheduleAndPersist(USER_ID, undefined, { timezone: 'America/New_York' });

    // A deadline-bearing unplaceable task with a past date MUST appear with _overdue=true.
    // (isPastDue fires because t.deadline is truthy.)
    var found = null;
    if (result.dayPlacements) {
      Object.keys(result.dayPlacements).forEach(function(dk) {
        (result.dayPlacements[dk] || []).forEach(function(p) {
          if (p.task && p.task.id === 'gp-pastdue-deadline-001') found = p;
        });
      });
    }
    expect(found).toBeDefined();
    expect(found._overdue).toBe(true);
  });

  // NOTE (999.671 re-review 2026-06-16): the cache-path gate (runSchedule.js:2202)
  // is now pinned by the direct unit test of computeIsPastDue (tests/computeIsPastDue.test.js).
  // computeIsPastDue is the single helper called at BOTH synthesis sites (:1825 and :2202),
  // so one unit-level mutation-verified test of the helper pins both. The vacuous
  // integration-level cache-path test that previously lived here was removed because
  // zoe proved (MUT-2) that it never caused the cache synthesis loop to execute —
  // the fixture's runScheduleAndPersist call populated the cache but the test's
  // assertion block only checked if the task appeared; it could not flip RED on
  // a mutation of :2202 alone (the fixture never entered that branch).
});

