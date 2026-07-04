/**
 * Integration tests for MCP create_task overdue regression (Phase 19).
 *
 * Reproduces the bug confirmed by D-04: MCP create_task omits placement_mode inference,
 * causing date-only tasks to land as 'anytime'. The scheduler then tries to time-grid-place
 * them, fails (no time set / past date), and triggers overdue=1 via Case B
 * (runSchedule.js:1319-1352).
 *
 * Fix target: juggler/juggler-backend/src/mcp/tools/tasks.js — placement_mode inference
 * added in Plan 02 mirrors task.controller.js:794-800.
 *
 * Tests:
 *   A — date-only task with placement_mode=all_day is never marked overdue (post-fix shape)
 *   B — date-only task seeded as ANYTIME (pre-fix shape) IS marked overdue (scheduler invariant)
 *   C — past FIXED deadline IS marked overdue (D-08 regression guard)
 *
 * Requires: juggler_test DB running (cd test-bed && make up)
 * Requires test-bed MySQL @3407 (TEST-FR-001: throws loud on no-DB).
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var USER_ID = 'run-sched-test-001';
var TZ = 'America/New_York';

beforeAll(async () => {
  await assertDbAvailable();
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
  await cleanup();
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

// ═══════════════════════════════════════════════════════════════
// MCP create_task: overdue regression (Phase 19)
// ═══════════════════════════════════════════════════════════════

describe('MCP create_task: overdue regression (Phase 19)', () => {

  test('date-only task with placement_mode=all_day is never marked overdue', async () => {

    // PHASE 19 — guards unifiedScheduleV2 ALL_DAY skip guard (unifiedScheduleV2.js:299)
    //
    // Seeds a task with the shape MCP create_task produces AFTER the Plan 02 fix:
    // date is set, no time, placement_mode='all_day', date_pinned=1.
    // The scheduler skips ALL_DAY tasks entirely — they never receive overdue=1.
    //
    // This test locks in the post-fix behavior so a future regression in the
    // ALL_DAY skip guard cannot silently reintroduce the D-04 bug.
    var t = await seedTask({
      id: 'mcp-19-allday-' + Math.random().toString(36).slice(2, 8),
      text: 'Phase 19 all-day test task',
      scheduled_at: '2026-05-19 16:00:00', // UTC noon ET on an unambiguously past date
      date_pinned: 1,
      placement_mode: 'all_day',
      dur: 30
    });
    await runScheduleAndPersist(USER_ID);
    // W3 (sched-drop-overdue-column, M-5, 2026-07-03): `task_instances.overdue`
    // no longer exists (W4 migration applied) — assert the computed/API value
    // (rowToTask) instead of a raw stored column, matching the pattern used
    // for the other tests in this file.
    var viewRow = await db('tasks_v').where('id', t.id).first();
    var task = rowToTask(viewRow, TZ, null, null);
    expect(task.overdue).toBe(false);
  });

  test('date-only task seeded as ANYTIME (pre-fix MCP behavior) is floated to today, not marked overdue', async () => {

    // PHASE 19 — Scheduler behavior update (commit 66f068):
    // ANYTIME tasks are never marked overdue when the calendar is full or the task is
    // simply past — they float forward to today. Case B in §8 (runSchedule.js) only
    // fires the overdue path when the task is a NON-ANYTIME mode with a past date and
    // couldn't be re-placed. For ANYTIME tasks with a past scheduled_at, the scheduler
    // places them on today (§9 moves past non-recurring tasks forward), so they land
    // as placed with overdue=0. Test A is the authoritative post-fix assertion for MCP.
    var t = await seedTask({
      id: 'mcp-19-anytime-' + Math.random().toString(36).slice(2, 8),
      text: 'Phase 19 pre-fix anytime test task',
      scheduled_at: '2026-05-19 16:00:00', // UTC noon ET on an unambiguously past date
      placement_mode: 'anytime',
      dur: 30
    });
    await runScheduleAndPersist(USER_ID);
    // W3 (sched-drop-overdue-column, M-5, 2026-07-03): assert the computed/API
    // value (rowToTask) — `task_instances.overdue` no longer exists.
    var viewRow = await db('tasks_v').where('id', t.id).first();
    var task = rowToTask(viewRow, TZ, null, null);
    // ANYTIME past task is floated to today by the scheduler (not marked overdue).
    expect(task.overdue).toBe(false);
  });

  test('past FIXED task remains anchored at its position AND is flagged overdue — R50.1/R50.2 (D-08 guard)', async () => {

    // R50.1/R50.2 (999.796) — past-due FIXED events stay pinned past-due.
    // FIXED tasks are user-anchored: the §8 unplaced loop and the §9 past-task
    // mover both skip them, so the scheduler never MOVES a past FIXED task off
    // its scheduled_at. But block 8.5 (runSchedule.js:1729-1756) explicitly
    // PERSISTS overdue=1 for a past-due, non-terminal, non-recurring FIXED event
    // (computeIsPastDue treats a fixed event's scheduled_at as its hard due date)
    // so the frontend shows it on its day flagged overdue rather than dropping it
    // into the Unscheduled lane. This test guards that a FIXED past task keeps its
    // original scheduled_at intact (anchored) AND lands overdue=1.
    var t = await seedTask({
      id: 'mcp-19-fixed-' + Math.random().toString(36).slice(2, 8),
      text: 'Phase 19 past fixed task',
      scheduled_at: '2026-05-18 18:00:00', // UTC 2pm ET — unambiguously past date + time
      placement_mode: 'fixed',
      dur: 30
    });
    await runScheduleAndPersist(USER_ID);
    var row = await db('task_instances').where('id', t.id).first();
    // Anchored: scheduler never moved the FIXED task off its original position.
    expect(row.scheduled_at).toBe('2026-05-18 18:00:00');
    // W3 (sched-drop-overdue-column, M-5, 2026-07-03): `task_instances.overdue`
    // is no longer written by block 8.5 (that write is deleted outright, SPEC.md
    // "Design — write-side sites that become dead") — the PRODUCTION-VISIBLE
    // assertion is the computed read (rowToTask), which reads true for a
    // past-due FIXED event via the FIXED-mode dueKey-from-scheduled_at branch,
    // independent of any stored write. Read via tasks_v for placement_mode
    // (lives on task_masters, not task_instances).
    var viewRow = await db('tasks_v').where('id', t.id).first();
    var task = rowToTask(viewRow, TZ, null, null);
    expect(task.overdue).toBe(true);
  });

});
