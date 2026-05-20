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
 * Requires: juggler_test DB running (docker compose -f docker-compose.test.yml up -d)
 * Falls back cleanly via `if (!available) return;` when DB is not reachable.
 */

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');

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

// ═══════════════════════════════════════════════════════════════
// MCP create_task: overdue regression (Phase 19)
// ═══════════════════════════════════════════════════════════════

describe('MCP create_task: overdue regression (Phase 19)', () => {

  test('date-only task with placement_mode=all_day is never marked overdue', async () => {
    if (!available) return;
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
    var row = await db('task_instances').where('id', t.id).first();
    expect(Number(row.overdue)).toBe(0);
  });

  test('date-only task seeded as ANYTIME (pre-fix MCP behavior) IS marked overdue', async () => {
    if (!available) return;
    // PHASE 19 — documents the scheduler-side invariant: an ANYTIME task with past scheduled_at
    // WILL be marked overdue by Case B. The MCP-layer fix in Plan 02 ensures MCP never produces
    // ANYTIME for date-only intent — this test guards that the scheduler behavior itself remains
    // intentional. Test A is the authoritative post-fix assertion for the MCP code path.
    var t = await seedTask({
      id: 'mcp-19-anytime-' + Math.random().toString(36).slice(2, 8),
      text: 'Phase 19 pre-fix anytime test task',
      scheduled_at: '2026-05-19 16:00:00', // UTC noon ET on an unambiguously past date
      date_pinned: 0,
      placement_mode: 'anytime',
      dur: 30
    });
    await runScheduleAndPersist(USER_ID);
    var row = await db('task_instances').where('id', t.id).first();
    expect(Number(row.overdue)).toBe(1);
  });

  test('past FIXED deadline IS marked overdue — D-08 regression guard', async () => {
    if (!available) return;
    // PHASE 19 — regression guard for D-08: tasks with a hard deadline in the past
    // must still become overdue=1 after the Plan 02 fix lands.
    // The fix does NOT touch the scheduler's slack<0 / Case B overdue path — it only
    // adds placement_mode inference at the MCP boundary. This test confirms the
    // legitimate overdue path is unbroken.
    var t = await seedTask({
      id: 'mcp-19-fixed-' + Math.random().toString(36).slice(2, 8),
      text: 'Phase 19 past fixed task',
      scheduled_at: '2026-05-18 18:00:00', // UTC 2pm ET — unambiguously past date + time
      date_pinned: 1,
      placement_mode: 'fixed',
      dur: 30
    });
    await runScheduleAndPersist(USER_ID);
    var row = await db('task_instances').where('id', t.id).first();
    expect(Number(row.overdue)).toBe(1);
  });

});
