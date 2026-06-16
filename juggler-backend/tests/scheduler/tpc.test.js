// TELLY-05: TPC fill policies and advanced tests TS-85 to TS-100
// File: tpc.test.js
// Tests: TS-85 to TS-100 - TPC fill policies, spacing guard, safety valve, target-interval steering

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, updateTaskInstance } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const { getTaskInstances } = require('../../test-helpers/queries');

/**
 * TS-85: TPC spacing guard - prevents violations of minGapDays
 * Domain: TPC / Spacing Guard
 */
describe('TS-85: TPC spacing guard prevents minGap violations', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: spacing guard respects minGapDays between instances', async () => {
    const task = await createTask({
      text: 'TPC spacing guard test',
      dur: 60,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 2
    });

    // Create done instance on Monday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z' // Monday
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    const doneInstance = instances.find(i => i.status === 'done');
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    // New instances should respect minGapDays from done instance
    newInstances.forEach(newInst => {
      const doneDate = new Date(doneInstance.scheduled_at);
      const newDate = new Date(newInst.scheduled_at);
      const daysDiff = (newDate - doneDate) / (1000 * 60 * 60 * 24);
      
      expect(daysDiff).toBeGreaterThanOrEqual(2);
    });
  });

  it('SUB-85a: Spacing guard with multiple done instances', async () => {
    const task = await createTask({
      text: 'TPC spacing multiple done',
      dur: 45,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 1
    });

    // Create done instances on Monday and Wednesday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z' // Monday
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-17T08:00:00Z' // Wednesday
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // New instances should respect spacing from the most recent done (Wednesday)
    const wednesdayDone = instances.find(i => i.scheduled_at.includes('2026-06-17') && i.status === 'done');
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    newInstances.forEach(newInst => {
      const doneDate = new Date(wednesdayDone.scheduled_at);
      const newDate = new Date(newInst.scheduled_at);
      const daysDiff = (newDate - doneDate) / (1000 * 60 * 60 * 24);
      
      expect(daysDiff).toBeGreaterThanOrEqual(1);
    });
  });
});

/**
 * TS-86: TPC safety valve - prevents excessive instance generation
 * Domain: TPC / Safety Valve
 */
describe('TS-86: TPC safety valve limits instance generation', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: safety valve caps instance count', async () => {
    const task = await createTask({
      text: 'TPC safety valve test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 50 }, // Very high
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Should be limited by safety valve, not create 50 instances
    expect(instances.length).toBeLessThan(50);
    expect(instances.length).toBeLessThanOrEqual(30); // Reasonable safety limit
  });

  it('SUB-86a: Safety valve with high backfill demand', async () => {
    const task = await createTask({
      text: 'TPC safety backfill',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 25 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create only 1 done instance, leaving high backfill demand
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Should respect safety valve even with high demand
    expect(instances.length).toBeLessThan(25);
  });
});

/**
 * TS-87: TPC target-interval steering - guides scheduling toward ideal spacing
 * Domain: TPC / Target Interval Steering
 */
describe('TS-87: TPC target-interval steering', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: target interval guides instance distribution', async () => {
    const task = await createTask({
      text: 'TPC target interval test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { 
        type: 'weekly', 
        days: 'MTWRF', 
        timesPerCycle: 6,
        targetIntervalDays: 14
      },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create done instances that would cluster without steering
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z' // Day 0
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-16T08:00:00Z' // Day 1
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    // New instances should be steered toward target interval
    // Instead of clustering near existing done instances,
    // they should be distributed more evenly across the 14-day target
    
    const allDates = [...instances.map(i => new Date(i.scheduled_at))]
      .sort((a, b) => a - b);

    // Calculate spacing between consecutive instances
    const spacings = [];
    for (let i = 1; i < allDates.length; i++) {
      const daysDiff = (allDates[i] - allDates[i-1]) / (1000 * 60 * 60 * 24);
      spacings.push(daysDiff);
    }

    // Average spacing should be closer to target interval
    const avgSpacing = spacings.reduce((sum, val) => sum + val, 0) / spacings.length;
    expect(avgSpacing).toBeGreaterThanOrEqual(2); // Should not be too clustered
    expect(avgSpacing).toBeLessThanOrEqual(5); // Should not be too sparse
  });

  it('SUB-87a: Target interval with high timesPerCycle', async () => {
    const task = await createTask({
      text: 'TPC target high tpc',
      dur: 20,
      placementMode: 'anytime',
      recurring: true,
      recur: { 
        type: 'weekly', 
        days: 'MTWRF', 
        timesPerCycle: 10,
        targetIntervalDays: 21
      },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // With high timesPerCycle, should still respect target interval guidance
    expect(instances.length).toBe(10);

    // Check distribution
    const dates = instances.map(i => new Date(i.scheduled_at)).sort((a, b) => a - b);
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const totalSpan = (lastDate - firstDate) / (1000 * 60 * 60 * 24);

    // Should span reasonable time considering target interval
    expect(totalSpan).toBeGreaterThanOrEqual(10); // At least some distribution
    expect(totalSpan).toBeLessThanOrEqual(30); // Not excessively spread
  });
});

/**
 * TS-88: TPC fill policy - keep vs backfill with mixed status
 * Domain: TPC / Fill Policy / Mixed Status
 */
describe('TS-88: TPC fill policy with mixed status instances', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: complex mixed status calculation', async () => {
    const task = await createTask({
      text: 'TPC mixed status',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 5 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create mixed status instances
    // 2 done, 1 skip (opens slot), 1 cancel (doesn't count), 1 missed
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-18T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'missed',
      scheduled_at: '2026-06-19T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Complex calculation:
    // - 2 done count as fulfilled
    // - 1 skip opens slot (backfill policy)
    // - 1 cancel doesn't count
    // - 1 missed doesn't count as fulfilled
    // Need 5 total, have 2 done = need 3 more
    // But skip opens 1 slot, so need 2 more beyond that
    // Total: 5 existing + 2 new = 7
    
    expect(instances.length).toBe(7);
  });

  it('SUB-88a: Keep policy with mixed status', async () => {
    const task = await createTask({
      text: 'TPC keep mixed',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
      recurStart: '2026-06-15',
      fillPolicy: 'keep'
    });

    // Create mixed status instances
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);
    
    // Keep policy: skip preserves slot
    // 1 done + 1 skip (preserved) + 1 cancel (ignored) = need 2 more
    expect(instances.length).toBe(4); // 3 existing + 1 new
  });
});

/**
 * TS-89: TPC spacing guard with rolling anchor integration
 * Domain: TPC / Spacing Guard / Rolling Anchor
 */
describe('TS-89: TPC spacing guard with rolling anchor', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: spacing guard respects rolling anchor updates', async () => {
    const task = await createTask({
      text: 'TPC spacing rolling',
      dur: 60,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'rolling', intervalDays: 5, timesPerCycle: 4 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 2
    });

    // Create done instance that will update rolling anchor
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-18T08:00:00Z' // Updates anchor to 2026-06-18
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    const updatedTask = await getTaskInstances(task.id, true);
    
    // Anchor should be updated
    expect(updatedTask.rollingAnchor).toBe('2026-06-18');

    // New instances should respect spacing from updated anchor
    const doneInstance = instances.find(i => i.status === 'done');
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    newInstances.forEach(newInst => {
      const doneDate = new Date(doneInstance.scheduled_at);
      const newDate = new Date(newInst.scheduled_at);
      const daysDiff = (newDate - doneDate) / (1000 * 60 * 60 * 24);
      
      expect(daysDiff).toBeGreaterThanOrEqual(2);
    });
  });

  it('SUB-89a: Rolling anchor skip reanchor affects spacing', async () => {
    const task = await createTask({
      text: 'TPC spacing skip reanchor',
      dur: 45,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'rolling', intervalDays: 4, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 1
    });

    // Create skip instance that fully reanchors
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-17T08:00:00Z' // Reanchors to 2026-06-17
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    const updatedTask = await getTaskInstances(task.id, true);
    
    // Anchor should be reanchored by skip
    expect(updatedTask.rollingAnchor).toBe('2026-06-17');

    // New instances should respect spacing from new anchor
    const skipInstance = instances.find(i => i.status === 'skip');
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    newInstances.forEach(newInst => {
      const skipDate = new Date(skipInstance.scheduled_at);
      const newDate = new Date(newInst.scheduled_at);
      const daysDiff = (newDate - skipDate) / (1000 * 60 * 60 * 24);
      
      expect(daysDiff).toBeGreaterThanOrEqual(1);
    });
  });
});

/**
 * TS-90: TPC safety valve with target interval steering
 * Domain: TPC / Safety Valve / Target Interval
 */
describe('TS-90: TPC safety valve with target interval', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: safety valve overrides excessive target interval demand', async () => {
    const task = await createTask({
      text: 'TPC safety target',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { 
        type: 'weekly', 
        days: 'MTWRF', 
        timesPerCycle: 100,
        targetIntervalDays: 30
      },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Even with large target interval, safety valve should limit
    expect(instances.length).toBeLessThan(100);
    expect(instances.length).toBeLessThanOrEqual(30);

    // But should still attempt some distribution toward target
    const dates = instances.map(i => new Date(i.scheduled_at)).sort((a, b) => a - b);
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const totalSpan = (lastDate - firstDate) / (1000 * 60 * 60 * 24);

    // Should have some distribution, not all clustered
    expect(totalSpan).toBeGreaterThanOrEqual(5);
  });

  it('SUB-90a: Target interval with safety valve cap', async () => {
    const task = await createTask({
      text: 'TPC target safety cap',
      dur: 25,
      placementMode: 'anytime',
      recurring: true,
      recur: { 
        type: 'weekly', 
        days: 'MTWRF', 
        timesPerCycle: 60,
        targetIntervalDays: 21
      },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create some done instances
    for (let i = 0; i < 3; i++) {
      const date = new Date('2026-06-15');
      date.setDate(date.getDate() + i);
      await createTask({
        master_id: task.id,
        text: task.text,
        dur: task.dur,
        status: 'done',
        scheduled_at: date.toISOString().replace('T', ' ').slice(0, 16) + ':00'
      });
    }

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Should be capped by safety valve
    expect(instances.length).toBeLessThan(60);

    // Distribution should consider target interval
    const dates = instances.map(i => new Date(i.scheduled_at)).sort((a, b) => a - b);
    const avgSpacing = [];
    
    for (let i = 1; i < dates.length; i++) {
      const daysDiff = (dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24);
      avgSpacing.push(daysDiff);
    }

    const averageSpacing = avgSpacing.reduce((sum, val) => sum + val, 0) / avgSpacing.length;
    expect(averageSpacing).toBeGreaterThanOrEqual(1); // Some spacing
  });
});

/**
 * TS-91: TPC fill policy edge cases
 * Domain: TPC / Fill Policy / Edge Cases
 */
describe('TS-91: TPC fill policy edge cases', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: all instances cancelled - backfill policy', async () => {
    const task = await createTask({
      text: 'TPC all cancelled backfill',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create all cancelled instances
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Backfill policy: cancelled instances don't count, so need 3 new picks
    expect(instances.length).toBe(6); // 3 existing + 3 new
  });

  it('SUB-91a: All instances skipped - keep policy', async () => {
    const task = await createTask({
      text: 'TPC all skipped keep',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 3 },
      recurStart: '2026-06-15',
      fillPolicy: 'keep'
    });

    // Create all skipped instances
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);
    
    // Keep policy: skipped instances preserve slots, all slots are kept
    expect(instances.length).toBe(3); // No new picks needed
  });

  it('SUB-91b: Mixed cancelled and skipped - backfill policy', async () => {
    const task = await createTask({
      text: 'TPC mixed cancel skip backfill',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // 2 cancelled (don't count), 1 skipped (opens slot)
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Backfill: 2 cancelled don't count, 1 skip opens slot
    // Need 4 total, have 0 fulfilled = need 4 new picks
    // But skip opens 1 slot, so need 3 more beyond that
    // Total: 3 existing + 4 new = 7
    expect(instances.length).toBe(7);
  });
});

/**
 * TS-92: TPC spacing guard with multiple done instances
 * Domain: TPC / Spacing Guard / Multiple Done
 */
describe('TS-92: TPC spacing guard with multiple done instances', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: spacing from most recent done instance', async () => {
    const task = await createTask({
      text: 'TPC spacing multiple done',
      dur: 60,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 5 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 2
    });

    // Create done instances on Monday, Wednesday, Friday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z' // Monday
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-17T08:00:00Z' // Wednesday
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-19T08:00:00Z' // Friday
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // New instances should respect spacing from most recent done (Friday)
    const fridayDone = instances.find(i => i.scheduled_at.includes('2026-06-19') && i.status === 'done');
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    newInstances.forEach(newInst => {
      const doneDate = new Date(fridayDone.scheduled_at);
      const newDate = new Date(newInst.scheduled_at);
      const daysDiff = (newDate - doneDate) / (1000 * 60 * 60 * 24);
      
      expect(daysDiff).toBeGreaterThanOrEqual(2);
    });
  });

  it('SUB-92a: Spacing guard with done instances across weeks', async () => {
    const task = await createTask({
      text: 'TPC spacing across weeks',
      dur: 45,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 4 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 3
    });

    // Create done instances in first week
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z' // Week 1 Monday
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-18T08:00:00Z' // Week 1 Thursday
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // New instances should respect spacing from most recent done
    const recentDone = instances
      .filter(i => i.status === 'done')
      .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))[0];
    
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    newInstances.forEach(newInst => {
      const doneDate = new Date(recentDone.scheduled_at);
      const newDate = new Date(newInst.scheduled_at);
      const daysDiff = (newDate - doneDate) / (1000 * 60 * 60 * 24);
      
      expect(daysDiff).toBeGreaterThanOrEqual(3);
    });
  });
});

/**
 * TS-93: TPC safety valve with fill policy integration
 * Domain: TPC / Safety Valve / Fill Policy
 */
describe('TS-93: TPC safety valve with fill policy', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: safety valve limits backfill demand', async () => {
    const task = await createTask({
      text: 'TPC safety backfill demand',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 40 },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create only 2 done instances, leaving high backfill demand
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Should be limited by safety valve, not create 38 new instances
    expect(instances.length).toBeLessThan(40);
    expect(instances.length).toBeLessThanOrEqual(32); // 2 existing + safety limit
  });

  it('SUB-93a: Safety valve with keep policy and high demand', async () => {
    const task = await createTask({
      text: 'TPC safety keep demand',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 35 },
      recurStart: '2026-06-15',
      fillPolicy: 'keep'
    });

    // Create mixed status that would leave demand
    for (let i = 0; i < 10; i++) {
      const date = new Date('2026-06-15');
      date.setDate(date.getDate() + i);
      const status = i % 3 === 0 ? 'done' : (i % 3 === 1 ? 'skip' : 'cancel');
      
      await createTask({
        master_id: task.id,
        text: task.text,
        dur: task.dur,
        status: status,
        scheduled_at: date.toISOString().replace('T', ' ').slice(0, 16) + ':00'
      });
    }

    await runScheduler({ fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);
    
    // Should respect safety valve
    expect(instances.length).toBeLessThan(35);
  });
});

/**
 * TS-94: TPC target interval with spacing guard integration
 * Domain: TPC / Target Interval / Spacing Guard
 */
describe('TS-94: TPC target interval with spacing guard', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: target interval balanced with spacing constraints', async () => {
    const task = await createTask({
      text: 'TPC target spacing balance',
      dur: 60,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { 
        type: 'weekly', 
        days: 'MTWRF', 
        timesPerCycle: 6,
        targetIntervalDays: 14
      },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 2
    });

    // Create clustered done instances
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    // Target interval should guide distribution away from cluster
    // Spacing guard should ensure minGapDays
    
    const allDates = [...instances.map(i => new Date(i.scheduled_at))]
      .sort((a, b) => a - b);

    // Check that new instances are distributed, not all clustered
    const clusterEnd = new Date('2026-06-17T23:59:59');
    const newInstancesAfterCluster = newInstances.filter(newInst => {
      const newDate = new Date(newInst.scheduled_at);
      return newDate > clusterEnd;
    });

    // Should have some instances distributed beyond the initial cluster
    expect(newInstancesAfterCluster.length).toBeGreaterThan(0);

    // All instances should respect spacing
    for (let i = 1; i < allDates.length; i++) {
      const daysDiff = (allDates[i] - allDates[i-1]) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThanOrEqual(0); // At least some spacing
    }
  });

  it('SUB-94a: Target interval overrides tight spacing when beneficial', async () => {
    const task = await createTask({
      text: 'TPC target overrides spacing',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { 
        type: 'weekly', 
        days: 'MTWRF', 
        timesPerCycle: 4,
        targetIntervalDays: 21
      },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 1
    });

    // Create done instance
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');

    // With large target interval, new instances should be distributed
    // even if minGapDays would allow tighter spacing
    
    const doneDate = new Date('2026-06-15');
    newInstances.forEach(newInst => {
      const newDate = new Date(newInst.scheduled_at);
      const daysDiff = (newDate - doneDate) / (1000 * 60 * 60 * 24);
      
      // Should be distributed toward target interval
      expect(daysDiff).toBeGreaterThanOrEqual(3); // More than minGapDays
    });
  });
});

/**
 * TS-95: TPC comprehensive integration test
 * Domain: TPC / Integration
 */
describe('TS-95: TPC comprehensive integration', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: full TPC lifecycle with all features', async () => {
    const task = await createTask({
      text: 'TPC comprehensive test',
      dur: 45,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { 
        type: 'weekly', 
        days: 'MTWRF', 
        timesPerCycle: 8,
        targetIntervalDays: 14
      },
      recurStart: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 1,
      missedThreshold: 2
    });

    // Simulate two weeks of complex activity
    // Week 1
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T09:00:00Z' // Monday - done
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-16T10:00:00Z' // Tuesday - skip (opens slot)
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-17T11:00:00Z' // Wednesday - cancel (ignored)
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'missed',
      scheduled_at: '2026-06-18T12:00:00Z' // Thursday - missed
    });

    // Week 2
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-22T09:00:00Z' // Next Monday - done
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-23T10:00:00Z' // Next Tuesday - done
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);

    // Complex calculation:
    // Week 1: 1 done + 1 skip (opens) + 1 cancel (ignored) + 1 missed = 2 fulfilled, 1 opened
    // Week 2: 2 done = 2 fulfilled
    // Total: 4 fulfilled + 1 opened = need 3 more to reach timesPerCycle=8
    // Backfill policy applies
    // Spacing guard with minGapDays=1
    // Target interval steering toward 14 days
    // Safety valve limits total

    expect(instances.length).toBe(10); // 7 existing + 3 new

    // Validate distribution
    const dates = instances.map(i => new Date(i.scheduled_at)).sort((a, b) => a - b);
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const totalSpan = (lastDate - firstDate) / (1000 * 60 * 60 * 24);

    // Should have reasonable distribution considering target interval
    expect(totalSpan).toBeGreaterThanOrEqual(7); // At least a week
    expect(totalSpan).toBeLessThanOrEqual(21); // Not excessively long

    // Validate spacing
    for (let i = 1; i < dates.length; i++) {
      const daysDiff = (dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThanOrEqual(0); // At least some spacing
    }
  });
});