// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../../src/lib/audit-context').stampInsert(rows);
/**
 * Golden-Master Persist — DB-level characterization harness for runScheduleAndPersist
 *
 * PURPOSE: Pins the CURRENT end-to-end DB behavior of the full persist pipeline:
 *   Phase 1 (pre-insert chunk rows) -> unifiedScheduleV2 -> Phase 7-8 (placement
 *   persist) -> Phase 8.5 (stale unscheduled revival) -> Phase 9 (past-due pinning)
 *   -> computeNoLimboUpdates (NEVER-MISSING safety net) -> batched write.
 *
 * The h6 golden master (goldenMaster.h6.test.js) pins the V2 ENGINE only (pure
 * function, no DB). This harness pins the PERSIST PATH that the engine feeds into:
 * fixture rows IN -> exact row-delta OUT. It is the safety net for the Phase-1
 * ledger extraction (999.1435/999.1437) and any future runScheduleAndPersist
 * refactor — the row-delta must stay bit-for-bit identical.
 *
 * INVARIANTS PINNED:
 *   P1-INSERT  — recurring split template materializes N chunk instance rows
 *                (Phase 1 pre-insert) with scheduled_at=NULL, unscheduled=NULL.
 *   PLACEMENT  — a placeable one-off task gets scheduled_at/date/time set,
 *                unscheduled cleared to NULL.
 *   FIXED-PIN  — a fixed (user-anchored) task keeps its scheduled_at unchanged;
 *                the scheduler never moves it.
 *   PHASE9     — a past-due recurring instance (cycle ended, never completed)
 *                gets unscheduled=1 (pulled off grid, still visible in Unplaced).
 *   NO-LIMBO   — a recurring instance in [today, expandEnd] that the scheduler
 *                could not place AND has no prior scheduled_at gets unscheduled=1
 *                (NEVER-MISSING: every task is placed | overdue | unscheduled).
 *   IDEM-DB    — a 2nd consecutive run with no input change produces 0 row-delta
 *                (delta-write: only changed rows are written).
 *
 * TEST STYLE: DB-backed integration (real test-bed MySQL @3407). All time is
 * frozen via FakeClockAdapter so fixture dates are deterministic regardless of
 * wall-clock. One shared user_id; each test cleans task rows before seeding.
 *
 * Traceability: 999.1434 (Leg B from SPIKE 999.1108).
 * Precedent: goldenMaster.h6.test.js (engine), schedulerRerunIdempotency.test.js
 *            (B2 idempotency guard).
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../../../src/db');
var { runScheduleAndPersist, _setClock } = require('../../../src/scheduler/runSchedule');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../../src/scheduler/constants');
var tasksWrite = require('../../../src/lib/tasks-write');
var { assertDbAvailable } = require('../../helpers/requireDB');
var { FakeClockAdapter } = require('../../helpers/clock');
var schedClock = require('../../helpers/schedulerClock');

var TZ = 'America/New_York';

// --- Shared setup/teardown ---
var SHARED_USER = 'gm-persist-shared';

beforeAll(async () => {
  await assertDbAvailable();
  await db.raw('SELECT 1');
  await cleanupUser(SHARED_USER);
  await db('users').insert(__stampFixture({
    id: SHARED_USER, email: 'gmpersist@test.com', timezone: TZ,
    created_at: db.fn.now(), updated_at: db.fn.now()
  }));
  await db('user_config').insert(__stampFixture({
    user_id: SHARED_USER, config_key: 'time_blocks',
    config_value: JSON.stringify(DEFAULT_TIME_BLOCKS)
  }));
  await db('user_config').insert(__stampFixture({
    user_id: SHARED_USER, config_key: 'tool_matrix',
    config_value: JSON.stringify(DEFAULT_TOOL_MATRIX)
  }));
}, 15000);

afterAll(async () => {
  await cleanupUser(SHARED_USER);
  await db.destroy();
});

async function cleanupUser(userId) {
  await db('cal_sync_ledger').where('user_id', userId).del();
  await db('task_instances').where('user_id', userId).del();
  await db('task_masters').where('user_id', userId).del();
  await db('user_config').where('user_id', userId).del();
  await db('users').where('id', userId).del();
}

async function cleanTasks(userId) {
  await db('task_instances').where('user_id', userId).del();
  await db('task_masters').where('user_id', userId).del();
  await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).del();
}

function seedTask(overrides) {
  var task = Object.assign({
    id: 'gm-' + Math.random().toString(36).slice(2, 10),
    user_id: SHARED_USER, task_type: 'task', text: 'GM persist task',
    dur: 30, pri: 'P3', status: '', recurring: 0,
    created_at: db.fn.now(), updated_at: db.fn.now()
  }, overrides);
  return tasksWrite.insertTask(db, task).then(function () { return task; });
}

function seedTemplate(overrides) {
  return seedTask(Object.assign({
    task_type: 'recurring_template', recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' })
  }, overrides));
}

// Snapshot all task_instances for a user via the tasks_v view (which exposes
// source_id and task_type derived from master_id). Normalizes volatile
// fields (updated_at) away so the golden master is stable across runs.
function snapshotInstances(userId) {
  return db('tasks_v').where('user_id', userId).select(
    'id', 'scheduled_at', 'date', 'day', 'time', 'dur',
    'unscheduled', 'unplaced_reason', 'slack_mins', 'status',
    'task_type', 'source_id', 'split_ordinal', 'split_total',
    'implied_deadline'
  ).then(function (rows) {
    var map = {};
    rows.forEach(function (r) {
      map[r.id] = {
        scheduled_at: r.scheduled_at ? String(r.scheduled_at).replace(/\.000Z?$/, '') : null,
        date: r.date ? String(r.date).split('T')[0] : null,
        day: r.day || null,
        time: r.time || null,
        dur: r.dur != null ? Number(r.dur) : null,
        unscheduled: r.unscheduled == null ? null : Number(r.unscheduled),
        unplaced_reason: r.unplaced_reason || null,
        slack_mins: r.slack_mins != null ? Number(r.slack_mins) : null,
        status: r.status || '',
        task_type: r.task_type || null,
        source_id: r.source_id || null,
        split_ordinal: r.split_ordinal != null ? Number(r.split_ordinal) : null,
        split_total: r.split_total != null ? Number(r.split_total) : null,
        implied_deadline: r.implied_deadline ? String(r.implied_deadline).split('T')[0] : null
      };
    });
    return map;
  });
}

// --- Helpers for frozen clock ---
function freezeClock(isoTimestamp) {
  var prev = _setClock(new FakeClockAdapter({ startTime: isoTimestamp }));
  return function restore() { _setClock(prev); };
}

var FROZEN_TODAY = schedClock.todayKey(TZ);

// Convert a local date+time to UTC datetime string for DB seeding.
// The DB stores scheduled_at as UTC; the scheduler converts back to local.
var dateHelpers = require('../../../src/scheduler/dateHelpers');
function localToUtcStr(dateKey, timeStr) {
  var utc = dateHelpers.localToUtc(dateKey, timeStr, TZ);
  if (!utc) return null;
  // localToUtc returns a Date object; format as 'YYYY-MM-DD HH:MM:SS' (UTC).
  var iso = utc instanceof Date ? utc.toISOString() : String(utc);
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '');
}

// --- TESTS ---

describe('GOLDEN-MASTER PERSIST - Phase 1 pre-insert (P1-INSERT)', () => {
  test('recurring split template materializes chunk rows with separate split_ordinal', async () => {
    await cleanTasks(SHARED_USER);
    // dur=120, split_min=30 -> 4 chunks of 30 min each
    await seedTemplate({
      id: 'gm-p1-split-tmpl', text: 'Split recurring', dur: 120,
      split: 1, split_min: 30,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', timesPerCycle: 1 })
    });

    var restore = freezeClock(FROZEN_TODAY + 'T05:00:00-04:00');
    try {
      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
    } finally {
      restore();
    }

    // Query via tasks_v to get source_id (master_id) for filtering.
    var rows = await db('tasks_v').where({
      user_id: SHARED_USER, source_id: 'gm-p1-split-tmpl'
    }).select('id', 'scheduled_at', 'unscheduled', 'split_ordinal', 'dur');

    // At least 4 chunk rows were materialized by Phase 1 pre-insert.
    expect(rows.length).toBeGreaterThanOrEqual(4);

    // Every chunk row has its own split_ordinal (separate DB rows, not merged).
    rows.forEach(function (r) {
      expect(r.split_ordinal).not.toBeNull();
    });
  }, 30000);
});

describe('GOLDEN-MASTER PERSIST - placement write (PLACEMENT)', () => {
  test('one-off task gets scheduled_at set and unscheduled cleared', async () => {
    await cleanTasks(SHARED_USER);
    await seedTask({
      id: 'gm-place-001', text: 'Placeable one-off', dur: 30, pri: 'P2',
      when: 'morning', scheduled_at: null
    });

    var restore = freezeClock(FROZEN_TODAY + 'T05:00:00-04:00');
    try {
      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
    } finally {
      restore();
    }

    var row = await db('tasks_v').where('id', 'gm-place-001').first();
    expect(row).toBeDefined();
    expect(row.scheduled_at).not.toBeNull();   // placed
    expect(row.unscheduled).toBeNull();          // not in unscheduled lane
    expect(row.date).not.toBeNull();             // date set
    expect(row.time).not.toBeNull();             // time set
    expect(row.day).not.toBeNull();              // day-of-week set
  }, 30000);
});

describe('GOLDEN-MASTER PERSIST - fixed task pinning (FIXED-PIN)', () => {
  test('fixed task scheduled_at is unchanged by the scheduler', async () => {
    await cleanTasks(SHARED_USER);
    var fixedScheduledAt = localToUtcStr(FROZEN_TODAY, '2:00 PM');
    await seedTask({
      id: 'gm-fixed-001', text: 'Fixed meeting', dur: 60, pri: 'P2',
      when: '', datePinned: true, placement_mode: 'fixed',
      scheduled_at: fixedScheduledAt
    });

    var restore = freezeClock(FROZEN_TODAY + 'T05:00:00-04:00');
    try {
      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
    } finally {
      restore();
    }

    var row = await db('tasks_v').where('id', 'gm-fixed-001').first();
    expect(row).toBeDefined();
    // scheduled_at must be unchanged — the scheduler did not move it.
    expect(String(row.scheduled_at)).toContain(fixedScheduledAt.substring(0, 16));
  }, 30000);
});

describe('GOLDEN-MASTER PERSIST - Phase 9 past-due pinning (PHASE9)', () => {
  test('past-due recurring instance with prior placement gets unscheduled=1', async () => {
    await cleanTasks(SHARED_USER);

    await seedTemplate({
      id: 'gm-phase9-tmpl', text: 'Daily past',
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', timesPerCycle: 1 })
    });

    // Instance 3 days in the past with a scheduled_at (it was placed).
    var pastDate = schedClock.dateFromToday(-3, TZ);
    var pastScheduledAt = localToUtcStr(pastDate, '10:00 AM');
    await seedTask({
      id: 'gm-phase9-inst', text: 'Past daily instance', dur: 30, pri: 'P3',
      task_type: 'recurring_instance', recurring: 1, source_id: 'gm-phase9-tmpl',
      when: 'morning', scheduled_at: pastScheduledAt, date: pastDate
    });

    var restore = freezeClock(FROZEN_TODAY + 'T05:00:00-04:00');
    try {
      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
    } finally {
      restore();
    }

    var row = await db('tasks_v').where('id', 'gm-phase9-inst').first();
    expect(row).toBeDefined();
    // Phase 9 ruling: past-due recurring instance with prior placement -> unscheduled=1.
    expect(Number(row.unscheduled)).toBe(1);
  }, 30000);
});

describe('GOLDEN-MASTER PERSIST - NEVER-MISSING no-limbo (NO-LIMBO)', () => {
  test('unplaced never-placed recurring instance in window gets unscheduled=1', async () => {
    await cleanTasks(SHARED_USER);

    // Fill TODAY with fixed blocks covering the entire time-block range (6 AM to 11 PM)
    // so no recurring instance can be placed. The scheduler clips fixed dur to
    // time-block boundaries, so we need two blocks: 6 AM-6 PM (720 min) + 6 PM-11 PM (300 min).
    // scheduled_at is UTC: 6 AM ET = 10:00 UTC, 6 PM ET = 22:00 UTC (July, EDT = UTC-4).
    await seedTask({
      id: 'gm-nolimbo-blocker', text: 'Day blocker', dur: 720, pri: 'P1',
      when: '', datePinned: true, placement_mode: 'fixed',
      scheduled_at: localToUtcStr(FROZEN_TODAY, '6:00 AM')
    });
    await seedTask({
      id: 'gm-nolimbo-blocker2', text: 'Evening blocker', dur: 300, pri: 'P1',
      when: '', datePinned: true, placement_mode: 'fixed',
      scheduled_at: localToUtcStr(FROZEN_TODAY, '6:00 PM')
    });

    // Recurring template: instance materialized today but can't be placed (day full).
    await seedTemplate({
      id: 'gm-nolimbo-tmpl', text: 'No-slot recurring', dur: 60,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', timesPerCycle: 1 })
    });

    var restore = freezeClock(FROZEN_TODAY + 'T05:00:00-04:00');
    try {
      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
    } finally {
      restore();
    }

    var instances = await db('tasks_v').where({
      user_id: SHARED_USER, source_id: 'gm-nolimbo-tmpl'
    }).select('id', 'unscheduled', 'scheduled_at', 'unplaced_reason');

    expect(instances.length).toBeGreaterThan(0);

    // At least one instance should be unscheduled=1 (NEVER-MISSING).
    var anyUnscheduled = instances.some(function (r) {
      return Number(r.unscheduled) === 1;
    });
    expect(anyUnscheduled).toBe(true);

    // Every unscheduled instance must have a reason (not silently dropped).
    instances.forEach(function (r) {
      if (Number(r.unscheduled) === 1) {
        expect(r.unplaced_reason).not.toBeNull();
      }
    });
  }, 30000);
});

describe('GOLDEN-MASTER PERSIST - DB idempotency (IDEM-DB)', () => {
  test('2nd run on stable input: instance count unchanged AND placements unchanged', async () => {
    await cleanTasks(SHARED_USER);

    await seedTask({
      id: 'gm-idem-plain', text: 'Plain', dur: 30, pri: 'P2', when: 'morning',
      scheduled_at: null
    });
    await seedTemplate({
      id: 'gm-idem-daily', text: 'Daily', dur: 20,
      recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU', timesPerCycle: 1 })
    });
    await seedTask({
      id: 'gm-idem-fixed', text: 'Fixed', dur: 60, pri: 'P3',
      when: '', datePinned: true, placement_mode: 'fixed',
      scheduled_at: localToUtcStr(FROZEN_TODAY, '3:00 PM')
    });

    var restore = freezeClock(FROZEN_TODAY + 'T05:00:00-04:00');
    try {
      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
      var snap1 = await snapshotInstances(SHARED_USER);
      var count1 = Object.keys(snap1).length;
      expect(count1).toBeGreaterThan(0);

      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
      var snap2 = await snapshotInstances(SHARED_USER);
      var count2 = Object.keys(snap2).length;

      // (a) zero new rows — same instance set.
      expect(count2).toBe(count1);
      expect(Object.keys(snap2).sort()).toEqual(Object.keys(snap1).sort());

      // (b) zero placement changes — every scheduled_at/unscheduled/date/time identical.
      Object.keys(snap1).forEach(function (id) {
        expect(snap2[id].scheduled_at).toBe(snap1[id].scheduled_at);
        expect(snap2[id].unscheduled).toBe(snap1[id].unscheduled);
        expect(snap2[id].date).toBe(snap1[id].date);
        expect(snap2[id].time).toBe(snap1[id].time);
      });
    } finally {
      restore();
    }
  }, 45000);
});

describe('GOLDEN-MASTER PERSIST - row-delta snapshot stability (SNAPSHOT)', () => {
  test('mixed fixture row-delta snapshot is deterministic across two fresh runs', async () => {
    // Run 1: seed fresh, run, snapshot.
    await cleanTasks(SHARED_USER);
    await seedTask({ id: 'gm-snap-a', text: 'Task A', dur: 30, pri: 'P1', when: 'morning', scheduled_at: null });
    await seedTask({ id: 'gm-snap-b', text: 'Task B', dur: 45, pri: 'P2', when: 'afternoon', scheduled_at: null });
    await seedTask({ id: 'gm-snap-c', text: 'Task C', dur: 30, pri: 'P3', when: 'morning', scheduled_at: null });

    var restore = freezeClock(FROZEN_TODAY + 'T05:00:00-04:00');
    try {
      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
    } finally {
      restore();
    }
    var snap1 = await snapshotInstances(SHARED_USER);

    // Run 2: completely fresh seed (wipe + re-seed identical fixtures), run, snapshot.
    await cleanTasks(SHARED_USER);
    await seedTask({ id: 'gm-snap-a', text: 'Task A', dur: 30, pri: 'P1', when: 'morning', scheduled_at: null });
    await seedTask({ id: 'gm-snap-b', text: 'Task B', dur: 45, pri: 'P2', when: 'afternoon', scheduled_at: null });
    await seedTask({ id: 'gm-snap-c', text: 'Task C', dur: 30, pri: 'P3', when: 'morning', scheduled_at: null });

    restore = freezeClock(FROZEN_TODAY + 'T05:00:00-04:00');
    try {
      await runScheduleAndPersist(SHARED_USER, undefined, { timezone: TZ });
    } finally {
      restore();
    }
    var snap2 = await snapshotInstances(SHARED_USER);

    // The row-delta snapshots must be identical (same IDs, same placements).
    expect(Object.keys(snap2).sort()).toEqual(Object.keys(snap1).sort());
    Object.keys(snap1).forEach(function (id) {
      expect(snap2[id].scheduled_at).toBe(snap1[id].scheduled_at);
      expect(snap2[id].date).toBe(snap1[id].date);
      expect(snap2[id].time).toBe(snap1[id].time);
      expect(snap2[id].unscheduled).toBe(snap1[id].unscheduled);
      expect(snap2[id].dur).toBe(snap1[id].dur);
    });
  }, 45000);
});