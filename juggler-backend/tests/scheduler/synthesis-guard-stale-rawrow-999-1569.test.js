/**
 * 999.1569 — synthesis-loop guard reads a stale pre-Phase-1 rawRowById snapshot,
 * missing THIS RUN's Phase 8 Case B write (movable past-due -> unscheduled=1).
 *
 * Root cause (runSchedule.js):
 *   - rawRowById is built once from `taskRows` (loaded BEFORE Phase 1/8 run) —
 *     see the `var rawRowById = {}; taskRows.forEach(...)` block early in
 *     runScheduleAndPersist.
 *   - Phase 8 Case B ("was previously placed — movable past-due tasks go to
 *     unscheduled") pushes `{ unscheduled: 1, scheduled_at: null, ... }` into
 *     `pendingUpdates` for a movable (non-fixed) task whose own scheduled time
 *     today has already passed (computeIsPastDue===true). This write IS
 *     persisted to the DB correctly (persistDelta runs before the synthesis
 *     loop) — the DB is right after this run.
 *   - The synthesis loop's "skip if unscheduled" guard
 *     (`var _rawT = rawRowById[t.id]; if (_rawT && _rawT.unscheduled) return;`)
 *     only ever consults the STALE pre-Phase-1 snapshot, never this run's
 *     pendingUpdates. For a task that was unscheduled=0 before this run and
 *     JUST got flagged unscheduled=1 by Case B, the guard reads stale
 *     unscheduled=0 and falls through to the day-end "overdue today" cram
 *     (startMin = lastBlockEnd - dur) — exactly the 'appear at the latest
 *     slot' behavior David's 2026-07-12 ruling outlaws. The bug is RESPONSE-
 *     ONLY: the DB is correct; the SAME run's returned `dayPlacements` grid
 *     shows a bogus day-end entry that vanishes on the next run (self-heals).
 *
 * Fixture: a one-off, non-fixed, deadline-bearing task (`placement_mode:
 * 'time_blocks'`) scheduled TODAY at 8:00 AM (in the past relative to the
 * frozen clock at 2:00 PM) with `when: '_invalid_window_'` so it is genuinely
 * unplaceable this run (no time block matches that tag) -> lands in
 * result.unplaced -> Phase 8 Case B fires (computeIsPastDue: date===today &&
 * scheduledMins(480) < nowMins(840), hasHardCommitment via deadline).
 *
 * Requires test-bed MySQL on 3407 (NODE_ENV=test).
 */
'use strict';

var db = require('../../src/db');
var { runScheduleAndPersist, _setClock } = require('../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');
var tasksWrite = require('../../src/lib/tasks-write');
var { assertDbAvailable } = require('../helpers/requireDB');
var { FakeClockAdapter } = require('../helpers/clock');
var { localToUtc } = require('../../src/scheduler/dateHelpers');

var available = false;
var USER_ID = 'synth-guard-1569-test-001';
var TZ = 'America/New_York';
var FROZEN_DAY = '2026-07-20'; // a Monday — weekday layout (night block ends 1380 = 23:00)

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  await cleanup();
  await db('users').insert({
    id: USER_ID, email: 'synthguard1569@test.com', timezone: TZ,
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
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
});

function seedTask(overrides) {
  var task = Object.assign({
    id: 'sg1569-' + Math.random().toString(36).slice(2, 10),
    user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, pri: 'P3',
    status: '', recurring: 0, created_at: db.fn.now(), updated_at: db.fn.now()
  }, overrides);
  return tasksWrite.insertTask(db, task).then(function() { return task; });
}

function utcDbString(dateObj) {
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  return dateObj.getUTCFullYear() + '-' +
    pad(dateObj.getUTCMonth() + 1) + '-' +
    pad(dateObj.getUTCDate()) + ' ' +
    pad(dateObj.getUTCHours()) + ':' +
    pad(dateObj.getUTCMinutes()) + ':' +
    pad(dateObj.getUTCSeconds());
}

function findInPlacements(dayPlacements, taskId) {
  for (var dk in dayPlacements) {
    var entries = dayPlacements[dk] || [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].task && entries[i].task.id === taskId) return { dateKey: dk, entry: entries[i] };
    }
  }
  return null;
}

describe('999.1569 — synthesis-loop guard must see THIS RUN\'s pending unscheduled write, not just the pre-Phase-1 snapshot', () => {
  test('movable past-due task flagged unscheduled=1 by Phase 8 Case B this run must NOT appear day-end-crammed in the same run\'s dayPlacements response', async () => {
    if (!available) return;

    var prevClock = _setClock(new FakeClockAdapter({ startTime: FROZEN_DAY + 'T14:00:00-04:00' })); // 2:00 PM EDT
    var taskId;
    try {
      var scheduledAtUtc = localToUtc(FROZEN_DAY, '8:00 AM', TZ); // in the past relative to frozen 2:00 PM
      if (!scheduledAtUtc) throw new Error('localToUtc returned null for fixture setup');

      var seeded = await seedTask({
        text: 'Movable past-due today, unplaceable this run',
        placement_mode: 'time_blocks',
        when: '_invalid_window_',   // no time block matches -> genuinely unplaceable this run
        // Deadline's OWN date must equal FROZEN_DAY: unifiedScheduleV2's D-A
        // pinning pass (stillUnplaced.forEach, "task.date = u.deadlineDate")
        // overwrites a genuinely-unplaced one-off task's in-memory `date` to
        // its deadline's date-key, discarding the stale scheduled_at-derived
        // date. A future deadline would pin `date` away from today, making
        // computeIsPastDue's same-day branch (t.date === todayKey) unreachable.
        deadline: FROZEN_DAY + ' 23:59:59', // truthy deadline -> hasHardCommitment, same-day as scheduled_at
        dur: 30,
        scheduled_at: utcDbString(scheduledAtUtc), // today at 8:00 AM local — already past 2:00 PM "now"
      });
      taskId = seeded.id;

      var result = await runScheduleAndPersist(USER_ID);

      // DB check: Case B's write is unaffected by this bug — DB is already
      // correct (unscheduled=1, scheduled_at cleared) after this run.
      var row = await db('task_instances').where('id', taskId).first();
      expect(row).toBeTruthy();
      expect(row.unscheduled).toBe(1);
      expect(row.scheduled_at).toBeNull();

      // RESPONSE check (the actual bug): the SAME run's dayPlacements must NOT
      // synthesize a day-end cram entry for this task. Pre-fix: the guard reads
      // the stale pre-Phase-1 rawRowById snapshot (unscheduled was 0 before this
      // run) and falls through to the "overdue today" cram, landing the task at
      // lastBlockEnd-dur (1380-30=1350, 22:30) on FROZEN_DAY.
      var found = findInPlacements(result.dayPlacements, taskId);
      expect(found).toBeNull(); // FAILS pre-fix: found at { dateKey: FROZEN_DAY, entry.start: 1350 }

      // Must appear in the unplaced/unscheduled list instead (NEVER-MISSING).
      var inUnplaced = (result.unplaced || []).some(function(u) {
        var id = u && (u.id || (u.task && u.task.id));
        return id === taskId;
      });
      expect(inUnplaced).toBe(true);
    } finally {
      _setClock(prevClock);
    }
  });
});

// Direct pins on the ROUTING GATE itself (harrison 999.1568 W3): the two
// integration rewrites above/alongside read `overdue` through taskMappers'
// computeOverdueForRow — an INDEPENDENT mirror of this gate — so they cannot
// catch an over-suppressed (`false &&`) computeIsPastDue. These unit pins can:
// they call the exported gate directly. Pure — no DB needed.
describe('computeIsPastDue routing-gate pins (999.671 floating exclusion / R50.0 hard commitments)', function() {
  var { computeIsPastDue } = require('../../src/scheduler/runSchedule');
  var { PLACEMENT_MODES } = require('../../src/lib/placementModes');
  var timeInfo = { todayKey: '2026-07-14', nowMins: 840 }; // 2:00 PM

  test('deadline-bearing past task IS past due (the AC3 guard property)', function() {
    expect(computeIsPastDue(
      { deadline: '2026-07-10', overdue: 0, date: '2026-07-01', placementMode: PLACEMENT_MODES.TIME_BLOCKS },
      480, timeInfo)).toBe(true);
  });

  test('floating task (no deadline, overdue=0, movable) on a stale past date is NOT past due (999.671 roll-forward)', function() {
    expect(computeIsPastDue(
      { deadline: null, overdue: 0, date: '2026-07-01', placementMode: PLACEMENT_MODES.TIME_BLOCKS },
      480, timeInfo)).toBe(false);
  });

  test('overdue-flagged past task IS past due even without a deadline', function() {
    expect(computeIsPastDue(
      { deadline: null, overdue: 1, date: '2026-07-01', placementMode: PLACEMENT_MODES.TIME_BLOCKS },
      480, timeInfo)).toBe(true);
  });

  test('FIXED past task IS past due (R50.0: scheduled_at is its hard commitment)', function() {
    expect(computeIsPastDue(
      { deadline: null, overdue: 0, date: '2026-07-14', placementMode: PLACEMENT_MODES.FIXED },
      480, timeInfo)).toBe(true);
  });

  test('earlier-today with time still ahead of now is NOT past due', function() {
    expect(computeIsPastDue(
      { deadline: '2026-07-20', overdue: 0, date: '2026-07-14', placementMode: PLACEMENT_MODES.TIME_BLOCKS },
      900, timeInfo)).toBe(false);
  });
});
