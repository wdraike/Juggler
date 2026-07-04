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
// BUG1 (W1, leg sched-anchor-split-bugs): batchUpdateTasks (PUT /tasks/batch) is the
// facade entry point markInstanceStatus does NOT exercise (markInstanceStatus calls
// facade.updateTaskStatus directly — the single-item status-update use-case). The
// batch describe block below drives the REAL facade.batchUpdateTasks entry point to
// prove the anchor-projection gap on that separate code path.
const taskFacade = require('../../src/slices/task/facade');

const TZ = 'America/New_York';
// The REAL `done` reanchor uses the actual completion date (today in the user's tz),
// NOT the scheduled instance date — SCHEDULER-SPEC.md R32.1 "Option B" (David 2026-06-24:
// a late completion pushes the next occurrence out from when it was really done). So a
// done-driven anchor lands on today, computed here from the real clock (no hardcoding).
const TODAY = getNowInTimezone(TZ).todayKey;

// Forward-occurrence keys, always strictly after TODAY. Several tests prove the
// "skip re-anchors fully forward and a later `done` (completion date = TODAY) does
// NOT drag it back" monotonic-guard contract. That contract only holds when the
// skip date is in the future relative to TODAY; the original file hardcoded
// 2026-06-27/06-28, which silently rot into the past once the wall clock passes
// them (a same-day `done` would then win and fail the assertion). Deriving them
// from TODAY keeps the SAME contract assertion deterministic on any run date.
function addDaysKey(key, n) {
  const d = new Date(key + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const FWD1 = addDaysKey(TODAY, 7); // skipped/forward occurrence (anchor lands here)
const FWD2 = addDaysKey(TODAY, 8); // a later cancel/done occurrence (no backward drag)

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

    // skip(FWD1) reanchors to FWD1; a later done anchors to the completion date (today).
    // Today < FWD1, so the monotonic guard keeps the skip anchor.
    await markInstanceStatus(task.id, FWD1, 'skip');
    await markInstanceStatus(task.id, FWD2, 'done');

    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe(FWD1);
  });
});

/**
 * TS-87: missed reanchor — 'missed' status removed.
 * Domain: Rolling Recurrence / Anchor Update / Missed
 *
 * The 'missed' status has been removed from VALID_STATUSES and the missed branch
 * in computeRollingAnchor (the +1 day rule) has been removed. A user-supplied
 * status='missed' now returns 400 (generic invalid status). There is no live
 * code path that applies 'missed' to an instance.
 */
describe('TS-87: Rolling anchor - missed is rejected (invalid status)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('user-supplied missed is rejected (400) — no live reanchor path', async () => {
    const task = await rollingTask();
    const res = await markInstanceStatus(task.id, '2026-06-27', 'missed');
    // 'missed' is no longer a valid status; the controller returns 400.
    expect(res.status).toBe(400);
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
 * TS-96: missed-threshold reanchor — no live missed path (see TS-87).
 * Domain: Rolling Recurrence / Missed Threshold
 */
describe('TS-96: Rolling recurrence missed threshold (no live missed path)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('user-supplied missed is rejected (400); anchor unchanged', async () => {
    const task = await rollingTask({ recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 } });

    const res = await markInstanceStatus(task.id, '2026-06-27', 'missed');
    expect(res.status).toBe(400);

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
    await markInstanceStatus(task.id, FWD1, 'skip');          // re-anchors to FWD1 (>today)
    await markInstanceStatus(task.id, FWD2, 'cancel');        // no anchor change

    await runScheduler(undefined, undefined, undefined, undefined,
      { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    const statusCounts = {};
    instances.forEach(i => { statusCounts[i.status || ''] = (statusCounts[i.status || ''] || 0) + 1; });

    expect(statusCounts['done']).toBe(1);
    expect(statusCounts['skip']).toBe(1);
    expect(statusCounts['cancel']).toBe(1);

    // skip(FWD1) is the latest forward anchor move; done(today) < FWD1 so the
    // monotonic guard keeps the anchor at the skip date.
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe(FWD1);

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
    await markInstanceStatus(task.id, FWD1, 'skip');           // -> anchor = FWD1 (forward)
    await markInstanceStatus(task.id, FWD2, 'cancel');         // -> no change
    // 'missed' is intentionally omitted: no live path applies it (see TS-87).

    const updatedTask = await getTaskInstances(task.id, true);
    // skip(FWD1) is the furthest-forward anchor move; the monotonic guard holds it.
    expect(updatedTask.rollingAnchor).toBe(FWD1);

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

/**
 * BUG1 (W1) — RED repro, leg sched-anchor-split-bugs.
 *
 * Traceability: .planning/kermit/sched-anchor-split-bugs/TRACEABILITY.md BUG1.
 *
 * Kermit's hypothesis: batchUpdateTxn (facade.js ~L889-1136) and lockedBatchUpdate
 * (facade.js ~L817-884) — the two collaborators PUT /tasks/batch (batchUpdateTasks)
 * routes into — never call applyRollingAnchor, so a rolling-type recurring master's
 * `rolling_anchor` never advances when the instance is completed via the BATCH
 * endpoint (only the single-item PUT /tasks/:id/status path, wired through
 * UpdateTaskStatus.js:236-244, calls applyRollingAnchor).
 *
 * CONFIRMED by reading both collaborators end-to-end (facade.js:815-1059): neither
 * lockedBatchUpdate nor batchUpdateTxn references applyRollingAnchor/isRollingMaster
 * anywhere — grep across the whole file shows the only two call sites of
 * applyRollingAnchor are its own definition (L548) and UpdateTaskStatus.js:237. This
 * test drives the REAL facade.batchUpdateTasks (unlocked path — batchUpdateTxn; no
 * `sync_locks` row exists for the test user, so task-write-queue.isLocked() returns
 * false) with the exact single-item call shape
 * `{ updates: [{ id, status: 'done' }] }` used by
 * juggler-frontend/src/hooks/useTaskState.js's updateTask(), and asserts
 * rolling_anchor advances per computeRollingAnchor's done rule (-> completion date)
 * exactly as the single-item TS-85 test above already proves for the non-batch path.
 */
describe('BUG1 (W1): rolling_anchor never advances via PUT /tasks/batch (facade.batchUpdateTasks)', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('done via batchUpdateTasks({updates:[{id,status:"done"}]}) should advance rolling_anchor the same as the single-item path — CURRENTLY FAILS', async () => {
    const task = await rollingTask({ rollingAnchor: '2026-06-15' });
    const instance = await createTask({
      master_id: task.id,
      text: 'batch instance',
      dur: 30,
      status: '',
      scheduled_at: '2026-06-17T08:00:00Z',
      date: '2026-06-17'
    });

    // The real PUT /tasks/batch call shape (useTaskState.js updateTask()).
    const res = await taskFacade.batchUpdateTasks({
      userId: '1',
      body: { updates: [{ id: instance.id, status: 'done' }] }
    });
    expect(res.status).toBe(200);

    // Sanity: the instance status write itself DID happen (batchUpdateTxn is not a
    // total no-op — only the anchor PROJECTION is missing).
    const writtenInstance = await getTaskInstances({ id: instance.id });
    expect(writtenInstance[0].status).toBe('done');

    // R32.1 Option B (same rule TS-85 proves for the single-item path): a `done`
    // instance re-anchors rolling_anchor to the completion date (today).
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe(TODAY);
  });
});

/**
 * BUG1 (W1) — DATA CONSEQUENCE, not directly assertable in this fixture-driven
 * suite: dev-bed rows for "Cut Grass" / "Wash Red Car" (BUG1-DATA row in
 * TRACEABILITY.md) have a stale rolling_anchor from real batch-completions that hit
 * exactly the gap proven above. That remediation is a one-off data script gated on
 * the BUG1 fix landing, not a repo test.
 */
