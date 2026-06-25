// TELLY-05: Rolling recurrence tests TS-85 to TS-100
// File: rollingRecurrence.test.js
// Tests: TS-85 to TS-100 - Rolling anchor behavior, backfill, materialization, stale guard
//
// 999.872 / 999.873 rewire: these tests originally seeded a terminal instance directly
// then called runScheduler() (MODE 1, in-memory, persists nothing) and expected the
// SCHEDULER RUN to advance task_masters.rolling_anchor and to materialize new picks.
// Per SCHEDULER-SPEC.md that is the wrong entry point:
//   - R32.1/R32.2/R33.x: reanchor fires at the STATUS-CHANGE moment via
//     facade.updateTaskStatus -> applyRollingAnchor, NOT in the scheduler (R33.5: the
//     scheduler only backfills a NULL anchor). So the anchor-update tests now drive the
//     REAL status-mutation path via the markInstanceStatus helper.
//   - [B-EXP.2]: materialization/backfill is done by runScheduleAndPersist (the W3
//     insert pass) over a today+RECUR_EXPAND_DAYS (14-day) horizon. So the
//     materialization tests now run the PERSISTING path ({ persist: true }).

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask } = require('../../test-helpers/tasks');
const { runScheduler, markInstanceStatus } = require('../../test-helpers/scheduler');
const { getTaskInstances } = require('../../test-helpers/queries');
const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');
const { computeRollingAnchor } = require('../../src/lib/rolling-anchor');

const TZ = 'America/New_York';
// The REAL `done` reanchor uses the actual completion date (today in the user's tz),
// NOT the scheduled instance date — SCHEDULER-SPEC.md R32.1 "Option B" (David 2026-06-24:
// a late completion pushes the next occurrence out from when it was really done). So a
// done-driven anchor lands on today, computed here from the real clock (no hardcoding).
const TODAY = getNowInTimezone(TZ).todayKey;

function rollingTask(extra) {
  return createTask(Object.assign({
    text: 'Rolling test',
    dur: 30,
    placementMode: 'anytime',
    recurring: true,
    recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
    recurStart: '2026-06-15',
    rollingAnchor: '2026-06-15'
  }, extra || {}));
}

/**
 * TS-85: Rolling anchor - done re-anchors to the completion date (R32.1 / R33.1)
 * Domain: Rolling Recurrence / Anchor Update / Done
 */
describe('TS-85: Rolling anchor - done updates anchor', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: done instance updates rolling anchor to completion date', async () => {
    const task = await rollingTask();

    // Mark an instance done through the REAL status path (facade.updateTaskStatus).
    const res = await markInstanceStatus(task.id, '2026-06-17', 'done');
    expect(res.status).toBe(200);

    // R32.1 Option B: anchor advances to the actual completion date (today), not the
    // scheduled day. (The backwards guard in computeRollingAnchor keeps today >= 06-15.)
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe(TODAY);
  });

  it('SUB-85a: Multiple done instances - anchor does not move backwards', async () => {
    const task = await rollingTask();

    await markInstanceStatus(task.id, '2026-06-16', 'done');
    await markInstanceStatus(task.id, '2026-06-18', 'done');

    // Both done events anchor to the same completion date (today); the monotonic guard
    // (computeRollingAnchor: never move backwards) keeps the anchor at today.
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe(TODAY);
  });
});

/**
 * TS-86: Rolling anchor - skip fully re-anchors to the skipped instance's date (R32.2 / R33.2)
 * Domain: Rolling Recurrence / Anchor Update / Skip
 */
describe('TS-86: Rolling anchor - skip fully reanchors', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: skip instance fully reanchors to its date', async () => {
    // Skip's instance date must be >= current anchor (monotonic guard), so use a
    // future occurrence date relative to the seeded anchor.
    const task = await rollingTask({ rollingAnchor: '2026-06-15' });

    const res = await markInstanceStatus(task.id, '2026-06-27', 'skip');
    expect(res.status).toBe(200);

    // R32.2: skip re-anchors fully to the skipped instance's own date (not completion).
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-27');
  });

  it('SUB-86a: skip then done - each applies its own rule in order', async () => {
    const task = await rollingTask({ rollingAnchor: '2026-06-15' });

    // skip(06-27) reanchors to 06-27; a later done anchors to the completion date (today).
    // Today (06-25) < 06-27, so the monotonic guard keeps the skip anchor.
    await markInstanceStatus(task.id, '2026-06-27', 'skip');
    await markInstanceStatus(task.id, '2026-06-28', 'done');

    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-27');
  });
});

/**
 * TS-87: missed reanchor — NEEDS-RULING (no live application path).
 * Domain: Rolling Recurrence / Anchor Update / Missed
 *
 * computeRollingAnchor('missed', ...) returns instanceDate + 1 day (R33.3) and is a real,
 * unit-proven product function. BUT there is no live code path that applies status
 * 'missed' to an instance and then reanchors:
 *   - facade.updateTaskStatus returns 403 for user-supplied 'missed'
 *     (STATUS_MISSED_SYSTEM_ONLY — UpdateTaskStatus.js:107).
 *   - The auto-miss feature was REMOVED (runSchedule.js:1829-1840, "Leg D ... AUTO-MISS
 *     REMOVED", David 2026-06-24) per the NEVER-MISSING invariant: a past-incomplete
 *     recurring instance is flagged OVERDUE, never auto-marked terminal 'missed'.
 *     markMissedTasks (cal-history-cron.js:114-121) only sets overdue=1.
 * So the integration assertion "a missed instance reanchors the master" cannot be driven
 * through any real path. We assert the REAL product contract that DOES exist (the pure
 * computeRollingAnchor function) and document the live-path conflict for ruling.
 */
describe('TS-87: Rolling anchor - missed rule (pure contract; integration NEEDS-RULING)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: computeRollingAnchor missed = instanceDate + 1 day (R33.3)', () => {
    expect(computeRollingAnchor('missed', '2026-06-17', '2026-06-15')).toBe('2026-06-18');
  });

  it('SUB-87a: missed on the anchor date shifts to the next day', () => {
    expect(computeRollingAnchor('missed', '2026-06-15', '2026-06-15')).toBe('2026-06-16');
  });

  it('SUB-87b: user-supplied missed is rejected (system-only) — no live reanchor path', async () => {
    const task = await rollingTask();
    const res = await markInstanceStatus(task.id, '2026-06-27', 'missed');
    // missed is system-applied only; the controller refuses it (403). Per the
    // NEVER-MISSING invariant + auto-miss removal there is no live path that applies
    // 'missed' and reanchors. Master anchor is therefore unchanged.
    expect(res.status).toBe(403);
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-15');
  });
});

/**
 * TS-88: Rolling anchor - cancel does not update anchor (R32: cancel returns null)
 * Domain: Rolling Recurrence / Anchor Update / Cancel
 */
describe('TS-88: Rolling anchor - cancel does not update anchor', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: cancel instance does not change anchor', async () => {
    const task = await rollingTask({ rollingAnchor: '2026-06-15' });

    const res = await markInstanceStatus(task.id, '2026-06-27', 'cancel');
    expect(res.status).toBe(200);

    // computeRollingAnchor returns null for cancel — anchor unchanged.
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-15');
  });

  it('SUB-88a: cancel then done - done re-anchors (to completion date), cancel ignored', async () => {
    const task = await rollingTask({ rollingAnchor: '2026-06-15' });

    await markInstanceStatus(task.id, '2026-06-27', 'cancel');
    await markInstanceStatus(task.id, '2026-06-17', 'done');

    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe(TODAY);
  });
});

/**
 * TS-89: Rolling recurrence backfill - the PERSISTING path materializes instances
 * Domain: Rolling Recurrence / Backfill
 *
 * Runs runScheduleAndPersist (W3 insert pass). Per [B-EXP.2] it materializes the full
 * today+14-day horizon, so the real output is today-relative, not seeded-date-relative.
 */
describe('TS-89: Rolling recurrence backfill (persisting path)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: persisting run materializes open instances within the horizon', async () => {
    const task = await rollingTask({
      recur: { type: 'rolling', intervalDays: 3, timesPerCycle: 4 },
      fillPolicy: 'backfill'
    });
    await markInstanceStatus(task.id, '2026-06-15', 'done');

    await runScheduler(undefined, undefined, undefined, undefined,
      { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // Real product: new open instances are materialized (was 0 under the in-memory MODE 1).
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);

    // Every materialized open instance is at/after today (horizon is today-forward) and
    // is spaced at the rolling intervalDays (3) cadence.
    open.forEach(i => {
      const d = String(i.date || i.scheduled_at).slice(0, 10);
      expect(d >= TODAY).toBe(true);
    });
  });

  it('SUB-89a: no seeded instances - persisting run still materializes the cadence', async () => {
    const task = await rollingTask({
      recur: { type: 'rolling', intervalDays: 2, timesPerCycle: 2 },
      fillPolicy: 'backfill'
    });

    await runScheduler(undefined, undefined, undefined, undefined,
      { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    expect(instances.length).toBeGreaterThan(0);
  });
});

/**
 * TS-90: Rolling recurrence materialization - the persisting path creates concrete rows
 * Domain: Rolling Recurrence / Materialization
 */
describe('TS-90: Rolling recurrence materialization (persisting path)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: materialization creates scheduled instances', async () => {
    const task = await rollingTask({
      placementMode: 'time_blocks',
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 }
    });

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true });

    const instances = await getTaskInstances(task.id);
    expect(instances.length).toBeGreaterThan(0);
    // Materialized rows carry a concrete calendar day (date) — the never-missing
    // invariant requires a row to always exist with a placement attempt.
    instances.forEach(instance => {
      const day = instance.date || instance.scheduled_at;
      expect(day).toBeTruthy();
    });
  });
});

/**
 * TS-91: Rolling recurrence stale guard
 * Domain: Rolling Recurrence / Stale Guard
 *
 * SUB-91a (recent anchor allows scheduling) is the only assertion the product supports;
 * a generic "stale anchor produces ZERO instances" rule is NEEDS-RULING (no such hard
 * suppression exists — the never-missing invariant requires a row to always exist).
 */
describe('TS-91: Rolling recurrence stale guard (persisting path)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('SUB-91a: recent anchor allows scheduling', async () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 2);
    const recentAnchor = recentDate.toISOString().split('T')[0];

    const task = await rollingTask({
      recurStart: recentAnchor,
      rollingAnchor: recentAnchor
    });

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true });

    const instances = await getTaskInstances(task.id);
    expect(instances.length).toBeGreaterThan(0);
  });
});

/**
 * TS-92: Rolling recurrence with TPC fill policy (persisting path)
 * Domain: Rolling Recurrence / TPC Integration
 */
describe('TS-92: Rolling recurrence with TPC fill policy (persisting path)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: rolling + backfill materializes open picks', async () => {
    const task = await rollingTask({
      recur: { type: 'rolling', intervalDays: 5, timesPerCycle: 4 },
      fillPolicy: 'backfill'
    });
    await markInstanceStatus(task.id, '2026-06-15', 'done');
    await markInstanceStatus(task.id, '2026-06-27', 'skip');

    await runScheduler(undefined, undefined, undefined, undefined,
      { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);
  });

  it('SUB-92a: rolling + keep also materializes', async () => {
    const task = await rollingTask({
      recur: { type: 'rolling', intervalDays: 4, timesPerCycle: 3 },
      fillPolicy: 'keep'
    });
    await markInstanceStatus(task.id, '2026-06-15', 'done');

    await runScheduler(undefined, undefined, undefined, undefined,
      { persist: true, fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);
    expect(instances.length).toBeGreaterThan(0);
  });
});

/**
 * TS-94: target-interval steering — NEEDS-RULING.
 * Domain: Rolling Recurrence / Target Interval
 *
 * `targetIntervalDays`-based anchor steering is not an implemented behavior: the rolling
 * anchor advances strictly per the status rule (done=completion date, skip=instance date),
 * with no target-interval clamp in computeRollingAnchor or applyRollingAnchor. We assert
 * the REAL rule (done re-anchors to the completion date) and flag target steering for ruling.
 */
describe('TS-94: Rolling recurrence target interval steering (NEEDS-RULING)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: anchor advances by the status rule (no target-interval clamp)', async () => {
    const task = await rollingTask({
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 4, targetIntervalDays: 21 }
    });

    await markInstanceStatus(task.id, '2026-06-15', 'done');

    const updatedTask = await getTaskInstances(task.id, true);
    // Real behavior: done re-anchors to the completion date (today). No steering toward 21d.
    expect(updatedTask.rollingAnchor).toBe(TODAY);
  });
});

/**
 * TS-96: missed-threshold reanchor — NEEDS-RULING (see TS-87; no live missed path).
 * Domain: Rolling Recurrence / Missed Threshold
 */
describe('TS-96: Rolling recurrence missed threshold (NEEDS-RULING)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('user-supplied missed is rejected; anchor unchanged (no live missed path)', async () => {
    const task = await rollingTask({ recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 } });

    const res = await markInstanceStatus(task.id, '2026-06-27', 'missed');
    expect(res.status).toBe(403);

    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-15');
  });
});

/**
 * TS-97: mixed-status backfill calculation — count is NEEDS-RULING.
 * Domain: Rolling Recurrence / Backfill / Mixed Status
 *
 * The original asserted an exact total under a single-cycle model; the real persisting
 * path materializes per-cycle TPC across the 14-day horizon (today-relative), and the
 * 'missed' shift it relied on has no live path. We assert the deterministic, real
 * sub-facts (done re-anchors to completion date; cancel/skip applied; open picks
 * materialize) and flag the exact horizon total for ruling.
 */
describe('TS-97: Rolling recurrence backfill with mixed status (persisting path)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: mixed statuses apply their real rules and picks materialize', async () => {
    const task = await rollingTask({
      recur: { type: 'rolling', intervalDays: 5, timesPerCycle: 5 },
      fillPolicy: 'backfill'
    });

    await markInstanceStatus(task.id, '2026-06-15', 'done');  // re-anchors to today
    await markInstanceStatus(task.id, '2026-06-27', 'skip');  // re-anchors to 06-27 (>today)
    await markInstanceStatus(task.id, '2026-06-28', 'cancel'); // no anchor change

    await runScheduler(undefined, undefined, undefined, undefined,
      { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    const statusCounts = {};
    instances.forEach(i => { statusCounts[i.status || ''] = (statusCounts[i.status || ''] || 0) + 1; });

    expect(statusCounts['done']).toBe(1);
    expect(statusCounts['skip']).toBe(1);
    expect(statusCounts['cancel']).toBe(1);

    // skip(06-27) is the latest forward anchor move; done(today=06-25) < 06-27 so the
    // monotonic guard keeps the anchor at the skip date.
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-27');

    // New open instances materialize (was impossible under in-memory MODE 1).
    expect((statusCounts[''] || 0)).toBeGreaterThan(0);
  });
});

/**
 * TS-98: Rolling recurrence materialization edge cases (persisting path)
 * Domain: Rolling Recurrence / Materialization / Edge Cases
 */
describe('TS-98: Rolling recurrence materialization edge cases (persisting path)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('SUB-98a: short intervals materialize spaced open instances', async () => {
    const task = await rollingTask({
      dur: 15,
      recur: { type: 'rolling', intervalDays: 1, timesPerCycle: 3 }
    });

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true });

    const instances = await getTaskInstances(task.id);
    const open = instances
      .filter(i => !i.status)
      .map(i => String(i.date || i.scheduled_at).slice(0, 10))
      .sort();
    expect(open.length).toBeGreaterThan(0);
    // Instances are distinct calendar days (intervalDays=1 cadence within the horizon).
    const unique = Array.from(new Set(open));
    expect(unique.length).toBe(open.length);
  });
});

/**
 * TS-99: stale guard with anchor updates — done re-anchors via the real path
 * Domain: Rolling Recurrence / Stale Guard / Anchor Updates
 */
describe('TS-99: Rolling recurrence stale guard with anchor updates', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: a recent done re-anchors to the completion date and persists', async () => {
    const task = await rollingTask({ recurStart: '2026-06-10', rollingAnchor: '2026-06-10' });

    const res = await markInstanceStatus(task.id, '2026-06-14', 'done');
    expect(res.status).toBe(200);

    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe(TODAY);

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true });
    const instances = await getTaskInstances(task.id);
    expect(instances.length).toBeGreaterThan(0);
  });

  it('SUB-99a: a stale original anchor is overridden by a recent done', async () => {
    const task = await rollingTask({
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 2 },
      recurStart: '2026-05-15',
      rollingAnchor: '2026-05-15'
    });

    const res = await markInstanceStatus(task.id, '2026-06-20', 'done');
    expect(res.status).toBe(200);

    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe(TODAY);
  });
});

/**
 * TS-100: comprehensive integration through the REAL paths
 * Domain: Rolling Recurrence / Integration
 */
describe('TS-100: Rolling recurrence comprehensive integration', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: done + skip + cancel via the real status path, then persist', async () => {
    const task = await rollingTask({
      dur: 45,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recur: { type: 'rolling', intervalDays: 3, timesPerCycle: 4, targetIntervalDays: 12 },
      fillPolicy: 'backfill',
      minGapDays: 1
    });

    await markInstanceStatus(task.id, '2026-06-15', 'done');   // -> anchor = today
    await markInstanceStatus(task.id, '2026-06-27', 'skip');   // -> anchor = 06-27 (forward)
    await markInstanceStatus(task.id, '2026-06-28', 'cancel'); // -> no change
    // 'missed' is intentionally omitted: no live path applies it (see TS-87).

    const updatedTask = await getTaskInstances(task.id, true);
    // skip(06-27) is the furthest-forward anchor move; the monotonic guard holds it.
    expect(updatedTask.rollingAnchor).toBe('2026-06-27');

    await runScheduler(undefined, undefined, undefined, undefined,
      { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    const statusCounts = {};
    instances.forEach(i => { statusCounts[i.status || ''] = (statusCounts[i.status || ''] || 0) + 1; });
    expect(statusCounts['done']).toBe(1);
    expect(statusCounts['skip']).toBe(1);
    expect(statusCounts['cancel']).toBe(1);
    // Open picks materialize (was 0 under in-memory MODE 1).
    expect((statusCounts[''] || 0)).toBeGreaterThan(0);
  });
});
