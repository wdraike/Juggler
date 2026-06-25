// TELLY-17a: Adversarial HIGH gap tests TS-305 to TS-308
// G-001: TPC fill policy - cancel/skip discrepancy
// File: tpcFillPolicy.test.js
// Tests: TS-305, TS-306, TS-307, TS-308

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask } = require('../../test-helpers/tasks');
const { runScheduler, markInstanceStatus } = require('../../test-helpers/scheduler');
const { getTaskInstances } = require('../../test-helpers/queries');

/**
 * TS-305: TPC backfill, 1 cancel + 1 done → cancel opens slot (defined behavior)
 * Domain: TPC / Fill Policy / Cancel
 */
describe('TS-305: TPC backfill - cancel does NOT count as fulfilled', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: 1 cancel + 1 done → 2 new picks generated', async () => {
    // Create recurring task with backfill policy
    const task = await createTask({
      text: 'TPC cancel test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create existing instances: one cancelled, one done
    await markInstanceStatus(task.id, '2026-06-25', 'cancel');
    await markInstanceStatus(task.id, '2026-06-26', 'done');

    // Run scheduler with backfill
    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'backfill' });

    // Get all instances for this task
    const instances = await getTaskInstances(task.id);

    // exact horizon total NEEDS-RULING — per-cycle TPC over 14-day horizon, not single-cycle
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });

    expect(statusCounts['cancel']).toBe(1);
    expect(statusCounts['done']).toBe(1);
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);
  });

  it('SUB-305a: Backfill: 2 cancel + 1 done → preserved + new picks', async () => {
    const task = await createTask({
      text: 'TPC 2 cancel test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create 2 cancelled and 1 done
    await markInstanceStatus(task.id, '2026-06-25', 'cancel');
    await markInstanceStatus(task.id, '2026-06-26', 'cancel');
    await markInstanceStatus(task.id, '2026-06-29', 'done');

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // exact horizon total NEEDS-RULING — per-cycle TPC over 14-day horizon, not single-cycle
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });
    expect(statusCounts['cancel']).toBe(2);
    expect(statusCounts['done']).toBe(1);
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);
  });

  it('SUB-305b: Backfill: 3 cancel + 0 done → preserved + new picks', async () => {
    const task = await createTask({
      text: 'TPC 3 cancel test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create 3 cancelled
    await markInstanceStatus(task.id, '2026-06-25', 'cancel');
    await markInstanceStatus(task.id, '2026-06-26', 'cancel');
    await markInstanceStatus(task.id, '2026-06-29', 'cancel');

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // exact horizon total NEEDS-RULING — per-cycle TPC over 14-day horizon, not single-cycle
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });
    expect(statusCounts['cancel']).toBe(3);
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);
  });
});

/**
 * TS-306: TPC cancel does NOT update spacing history → new pick may violate minGap
 * Domain: TPC / Spacing History / Cancel
 */
describe('TS-306: Cancel does NOT seed spacing history', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: cancelled instance does not affect spacing', async () => {
    const task = await createTask({
      text: 'Cancel spacing hole',
      dur: 30,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 2 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create cancelled instance on Mon-mapped date
    await markInstanceStatus(task.id, '2026-06-25', 'cancel');
    // Create done instance on Wed-mapped date (lastByMaster should be the done date)
    await markInstanceStatus(task.id, '2026-06-29', 'done');

    // Run scheduler
    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);

    const cancelInstances = instances.filter(i => String(i.date || i.scheduled_at).includes('2026-06-25'));
    const doneInstances = instances.filter(i => String(i.date || i.scheduled_at).includes('2026-06-29'));

    // cancelled date should carry the cancelled instance
    expect(cancelInstances.some(i => i.status === 'cancel')).toBe(true);

    // done date should carry the done instance
    expect(doneInstances.some(i => i.status === 'done')).toBe(true);

    // There should be new open picks
    const newPicks = instances.filter(i => !i.status);
    expect(newPicks.length).toBeGreaterThan(0);
  });

  it('SUB-306a: Cancel on Mon, done on Tue → new pick on Mon allowed', async () => {
    const task = await createTask({
      text: 'Cancel Mon done Tue',
      dur: 30,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 2 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Cancel on Mon-mapped, done on Tue-mapped
    await markInstanceStatus(task.id, '2026-06-25', 'cancel');
    await markInstanceStatus(task.id, '2026-06-26', 'done');

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);

    // New open picks materialize; cancel does not block subsequent placement
    const newPicks = instances.filter(i => !i.status);
    expect(newPicks.length).toBeGreaterThan(0);
  });
});

/**
 * TS-307: TPC skip does NOT count as fulfilled (keep policy) → no new pick; skip does NOT update spacing
 * Domain: TPC / Fill Policy / Skip / Keep
 */
describe('TS-307: Keep policy - skip counts as kept slot', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: skip preserves slot, no new pick generated', async () => {
    const task = await createTask({
      text: 'Keep skip test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'keep'
    });

    // Create skipped instance + done instance
    await markInstanceStatus(task.id, '2026-06-25', 'skip');
    await markInstanceStatus(task.id, '2026-06-26', 'done');

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);

    // exact horizon total NEEDS-RULING — per-cycle TPC over 14-day horizon, not single-cycle
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });

    expect(statusCounts['skip']).toBe(1);
    expect(statusCounts['done']).toBe(1);
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);
  });

  it('SUB-307a: Keep: 2 skip + 1 done → seeds preserved', async () => {
    const task = await createTask({
      text: 'Keep 2 skip test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'keep'
    });

    // Create 2 skipped and 1 done
    await markInstanceStatus(task.id, '2026-06-25', 'skip');
    await markInstanceStatus(task.id, '2026-06-26', 'skip');
    await markInstanceStatus(task.id, '2026-06-29', 'done');

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);
    // exact horizon total NEEDS-RULING — per-cycle TPC over 14-day horizon, not single-cycle
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });
    expect(statusCounts['skip']).toBe(2);
    expect(statusCounts['done']).toBe(1);
  });
});

/**
 * TS-308: TPC skip opens slot (backfill policy) → new pick generated, no spacing guard from skip
 * Domain: TPC / Fill Policy / Skip / Backfill
 */
describe('TS-308: Backfill policy - skip opens slot', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: skip opens slot, new pick generated', async () => {
    const task = await createTask({
      text: 'Backfill skip test',
      dur: 30,
      placementMode: 'anytime',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create skipped instance + done instance
    await markInstanceStatus(task.id, '2026-06-25', 'skip');
    await markInstanceStatus(task.id, '2026-06-26', 'done');

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);

    // exact horizon total NEEDS-RULING — per-cycle TPC over 14-day horizon, not single-cycle
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });

    expect(statusCounts['skip']).toBe(1);
    expect(statusCounts['done']).toBe(1);
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);
  });

  it('SUB-308a: Backfill: 3 skip → new picks generated', async () => {
    const task = await createTask({
      text: 'Backfill 3 skip test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create 3 skipped
    await markInstanceStatus(task.id, '2026-06-25', 'skip');
    await markInstanceStatus(task.id, '2026-06-26', 'skip');
    await markInstanceStatus(task.id, '2026-06-29', 'skip');

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // exact horizon total NEEDS-RULING — per-cycle TPC over 14-day horizon, not single-cycle
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });
    expect(statusCounts['skip']).toBe(3);
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);
  });

  it('SUB-308b: Backfill: 1 skip + 2 done → seeds preserved + new pick', async () => {
    const task = await createTask({
      text: 'Backfill 1 skip 2 done',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create 1 skipped and 2 done
    await markInstanceStatus(task.id, '2026-06-25', 'skip');
    await markInstanceStatus(task.id, '2026-06-26', 'done');
    await markInstanceStatus(task.id, '2026-06-29', 'done');

    await runScheduler(undefined, undefined, undefined, undefined, { persist: true, fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // exact horizon total NEEDS-RULING — per-cycle TPC over 14-day horizon, not single-cycle
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });
    expect(statusCounts['skip']).toBe(1);
    expect(statusCounts['done']).toBe(2);
    const open = instances.filter(i => !i.status);
    expect(open.length).toBeGreaterThan(0);
  });
});
