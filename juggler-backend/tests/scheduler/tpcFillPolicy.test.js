// TELLY-17a: Adversarial HIGH gap tests TS-305 to TS-308
// G-001: TPC fill policy - cancel/skip discrepancy
// File: tpcFillPolicy.test.js
// Tests: TS-305, TS-306, TS-307, TS-308

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, updateTaskInstance } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
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
    const cancelledInstance = await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    const doneInstance = await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    // Run scheduler with backfill
    await runScheduler({ fillPolicy: 'backfill' });

    // Get all instances for this task
    const instances = await getTaskInstances(task.id);
    
    // Should have: 2 existing (cancel + done) + 2 new picks = 4 total
    // But tpc=3, so we need 3 total - 1 done = 2 needed
    // Cancel doesn't count as fulfilled, so we need 2 new picks
    expect(instances.length).toBe(4); // 2 existing + 2 new
    
    // Count statuses
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });
    
    expect(statusCounts['cancel']).toBe(1);
    expect(statusCounts['done']).toBe(1);
    // The other 2 should be pending (new picks)
    expect(statusCounts[''] || 0 + statusCounts['pending'] || 0).toBe(2);
  });

  it('SUB-305a: Backfill: 2 cancel + 1 done → 3 slots to fill', async () => {
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
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'cancel', scheduled_at: '2026-06-15T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'cancel', scheduled_at: '2026-06-16T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'done', scheduled_at: '2026-06-17T08:00:00Z' });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // 3 existing + 3 new picks = 6 total
    expect(instances.length).toBe(6);
  });

  it('SUB-305b: Backfill: 3 cancel + 0 done → 3 slots to fill', async () => {
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
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'cancel', scheduled_at: '2026-06-15T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'cancel', scheduled_at: '2026-06-16T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'cancel', scheduled_at: '2026-06-17T08:00:00Z' });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // 3 existing + 3 new picks = 6 total
    expect(instances.length).toBe(6);
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

    // Create cancelled instance on Monday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-15T08:00:00Z' // Monday
    });

    // Create done instance on Wednesday (lastByMaster should be Wednesday)
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-17T08:00:00Z' // Wednesday
    });

    // Run scheduler
    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // Should have 2 existing + new picks
    // The new pick should respect spacing from Wednesday (lastByMaster)
    // but can be placed on Monday (the cancelled date) since cancel doesn't update spacing
    
    const mondayInstances = instances.filter(i => i.scheduled_at.includes('2026-06-15'));
    const wednesdayInstances = instances.filter(i => i.scheduled_at.includes('2026-06-17'));
    
    // Monday should have the cancelled instance
    expect(mondayInstances.some(i => i.status === 'cancel')).toBe(true);
    
    // Wednesday should have the done instance
    expect(wednesdayInstances.some(i => i.status === 'done')).toBe(true);
    
    // There should be new picks that respect spacing from Wednesday
    const newPicks = instances.filter(i => i.status === '' || i.status === 'pending');
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

    // Cancel on Monday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-15T08:00:00Z' // Monday
    });

    // Done on Tuesday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-16T08:00:00Z' // Tuesday
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // New pick can be placed on Monday (cancelled date) even though it's adjacent to Tuesday done
    // because spacing guard only checks forward from last done
    const mondayNewPicks = instances.filter(i => 
      i.scheduled_at.includes('2026-06-15') && (i.status === '' || i.status === 'pending')
    );
    
    // Should be allowed to place on Monday
    expect(mondayNewPicks.length).toBeGreaterThan(0);
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

    // Create skipped instance on Monday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    // Create done instance on Tuesday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-16T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);
    
    // Should have: 2 existing (skip + done) + 1 new pick = 3 total
    // Keep policy: skip preserves the slot, so only 1 new pick for the third slot
    expect(instances.length).toBe(3);
    
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });
    
    expect(statusCounts['skip']).toBe(1);
    expect(statusCounts['done']).toBe(1);
    expect(statusCounts[''] || 0 + statusCounts['pending'] || 0).toBe(1);
  });

  it('SUB-307a: Keep: 2 skip + 1 done → 0 new picks', async () => {
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
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'skip', scheduled_at: '2026-06-15T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'skip', scheduled_at: '2026-06-16T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'done', scheduled_at: '2026-06-17T08:00:00Z' });

    await runScheduler({ fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);
    // All 3 slots are kept/fulfilled, no new picks needed
    expect(instances.length).toBe(3);
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

    // Create skipped instance on Monday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-15T08:00:00Z' // Monday
    });

    // Create done instance on Tuesday
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-16T08:00:00Z' // Tuesday
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Should have: 2 existing (skip + done) + 2 new picks = 4 total
    // Backfill policy: skip opens slot, so we need 2 new picks (one for skip-opened slot, one for third slot)
    expect(instances.length).toBe(4);
    
    const statusCounts = {};
    instances.forEach(instance => {
      statusCounts[instance.status] = (statusCounts[instance.status] || 0) + 1;
    });
    
    expect(statusCounts['skip']).toBe(1);
    expect(statusCounts['done']).toBe(1);
    expect(statusCounts[''] || 0 + statusCounts['pending'] || 0).toBe(2);
  });

  it('SUB-308a: Backfill: 3 skip → 3 new picks generated', async () => {
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
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'skip', scheduled_at: '2026-06-15T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'skip', scheduled_at: '2026-06-16T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'skip', scheduled_at: '2026-06-17T08:00:00Z' });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // 3 existing + 3 new picks = 6 total
    expect(instances.length).toBe(6);
  });

  it('SUB-308b: Backfill: 1 skip + 2 done → 1 new pick', async () => {
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
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'skip', scheduled_at: '2026-06-15T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'done', scheduled_at: '2026-06-16T08:00:00Z' });
    await createTask({ master_id: task.id, text: task.text, dur: task.dur, status: 'done', scheduled_at: '2026-06-17T08:00:00Z' });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    // 3 existing + 1 new pick = 4 total
    // tpc=3, 2 done = 1 needed, skip opens slot but we only need 1 total
    expect(instances.length).toBe(4);
  });
});