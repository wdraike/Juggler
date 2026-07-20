// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
/**
 * 999.1568 (David ruling 2026-07-12 part 2) — defense-in-depth collision guard,
 * INTEGRATION-level wiring check via the real DB persist path
 * (runScheduleAndPersist).
 *
 * The guard's actual removal/retention/tie-break LOGIC (resolvePlacementCollisions)
 * is exhaustively covered at the unit layer:
 *   tests/unit/scheduler/resolve-placement-collisions-999-1568.test.js
 * (two-movable tie-break, FIXED-vs-movable, FIXED-vs-FIXED D-C carve-out,
 * reminder exemption, 3-way chain de-dup, multi-day isolation).
 *
 * A natural end-to-end reproduction of a same-run collision through the FULL
 * multi-day runScheduleAndPersist pipeline was investigated using the exact
 * a3-02 fixture from sched-audit-dc-rigid.test.js (a FIXED task force-placed
 * through unifiedScheduleV2's occupancy hole, verified there to collide with a
 * scheduler-placed ANYTIME task in a SINGLE-DAY, direct unifiedScheduleV2
 * call). Empirically, routed through the full multi-day runScheduleAndPersist
 * pipeline instead, the ANYTIME task's own deadline-relaxed rescue pass
 * correctly avoided the FIXED task's force-placed slot (searching forward
 * across the whole scheduling horizon for a genuinely free day) rather than
 * colliding with it — i.e. the a3-02 hole observed at the pure
 * unifiedScheduleV2 layer did not reproduce via this path. That is a
 * DISCREPANCY worth flagging for whoever next investigates a3-02 (out of
 * scope for 999.1568/999.1569), not a defect in the guard itself: the guard's
 * PURPOSE is to catch same-run collisions from WHATEVER upstream mechanism
 * eventually produces one — the pure-function unit tests above exercise that
 * contract directly and deterministically, independent of which specific
 * scheduler code path a future collision arrives from.
 *
 * This file's job is narrower: prove the WIRING (early dayPlacements mutation
 * before placementByTaskId/pendingUpdates are derived from it, the dedicated
 * pendingUpdates push, the response `unplaced` concat) does not disturb
 * ORDINARY, non-colliding scheduling through the real DB persist path.
 *
 * Requires test-bed MySQL on 3407 (NODE_ENV=test).
 */
'use strict';

var db = require('../../src/db');
var { runScheduleAndPersist, _setClock } = require('../../src/scheduler/runSchedule');
var tasksWrite = require('../../src/lib/tasks-write');
var { assertDbAvailable } = require('../helpers/requireDB');
var { FakeClockAdapter } = require('../helpers/clock');
var { REASON_CODES } = require('juggler-shared/scheduler/reasonCodes');

var available = false;
var USER_ID = 'collision-guard-1568-test-001';
var TZ = 'America/New_York';
var TODAY = '2026-07-20'; // a Monday

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  await cleanup();
  await db('users').insert(__stampFixture({
    id: USER_ID, email: 'collguard1568@test.com', timezone: TZ,
    created_at: db.fn.now(), updated_at: db.fn.now()
  }));
  var narrowBlock = { id: 'narrow_blk', tag: 'narrow', name: 'Narrow', start: 840, end: 870, color: '#000', loc: 'home' };
  var blocks = {
    Mon: [narrowBlock], Tue: [narrowBlock], Wed: [narrowBlock], Thu: [narrowBlock],
    Fri: [narrowBlock], Sat: [narrowBlock], Sun: [narrowBlock],
  };
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(blocks) }));
  await db('user_config').insert(__stampFixture({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify({}) }));
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
    id: 'cg1568-' + Math.random().toString(36).slice(2, 10),
    user_id: USER_ID, task_type: 'task', text: 'Test', dur: 30, pri: 'P3',
    status: '', recurring: 0, created_at: db.fn.now(), updated_at: db.fn.now()
  }, overrides);
  return tasksWrite.insertTask(db, task).then(function() { return task; });
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

describe('999.1568 — collision guard wiring does not disturb ordinary scheduling via runScheduleAndPersist', () => {
  test('two genuinely non-colliding tasks in the same run are both placed normally, neither touched by the guard', async () => {
    if (!available) return;

    var prevClock = _setClock(new FakeClockAdapter({ startTime: TODAY + 'T05:00:00-04:00' }));
    try {
      var taskA = await seedTask({ text: 'Task A', when: 'narrow', dur: 30, date: TODAY });
      var taskB = await seedTask({ text: 'Task B', placement_mode: 'anytime', dur: 30, date: TODAY });

      var result = await runScheduleAndPersist(USER_ID);

      var aFound = findInPlacements(result.dayPlacements, taskA.id);
      var bFound = findInPlacements(result.dayPlacements, taskB.id);
      expect(aFound).toBeTruthy();
      expect(bFound).toBeTruthy();
      // Genuinely distinct slots — the ordinary occupancy path, not the guard,
      // is what kept these apart.
      expect(aFound.entry.start === bFound.entry.start && aFound.dateKey === bFound.dateKey).toBe(false);

      var rowA = await db('task_instances').where('id', taskA.id).first();
      var rowB = await db('task_instances').where('id', taskB.id).first();
      expect(rowA.unplaced_reason).not.toBe(REASON_CODES.SCHED_COLLISION);
      expect(rowB.unplaced_reason).not.toBe(REASON_CODES.SCHED_COLLISION);
    } finally {
      _setClock(prevClock);
    }
  });

  test('a genuinely unplaceable task (no matching window anywhere, no collision) still resolves via the ordinary no_slot path — the collision guard does not misfire on ordinary unplaced tasks', async () => {
    if (!available) return;

    var prevClock = _setClock(new FakeClockAdapter({ startTime: TODAY + 'T05:00:00-04:00' }));
    try {
      // '_invalid_window_' matches no configured block on any day (the same
      // reliable unplaceable-fixture technique used throughout
      // runScheduleIntegration.test.js's BUG-671/BUG-700 suites) — genuinely
      // never placed, not a same-slot collision with anything.
      var taskB = await seedTask({ text: 'Never placeable', when: '_invalid_window_', dur: 30, date: TODAY });

      var result = await runScheduleAndPersist(USER_ID);

      var bFound = findInPlacements(result.dayPlacements, taskB.id);
      expect(bFound).toBeNull();

      var rowB = await db('task_instances').where('id', taskB.id).first();
      expect(rowB.unscheduled).toBe(1);
      // Ordinary no-matching-window unplaced reason, NOT the collision guard's.
      expect(rowB.unplaced_reason).not.toBe(REASON_CODES.SCHED_COLLISION);
    } finally {
      _setClock(prevClock);
    }
  });
});
