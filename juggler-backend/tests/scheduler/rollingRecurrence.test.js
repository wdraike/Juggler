// TELLY-05: Rolling recurrence tests TS-85 to TS-100
// File: rollingRecurrence.test.js
// Tests: TS-85 to TS-100 - Rolling anchor behavior, backfill, materialization, stale guard

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, updateTaskInstance } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const { getTaskInstances } = require('../../test-helpers/queries');

/**
 * TS-85: Rolling anchor - done updates anchor to instance date
 * Domain: Rolling Recurrence / Anchor Update / Done
 */
describe('TS-85: Rolling anchor - done updates anchor', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: done instance updates rolling anchor', async () => {
    const task = await createTask({
      text: 'Rolling done test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create done instance on 2026-06-17
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    // Run scheduler
    await runScheduler();

    // Check that rolling anchor was updated to 2026-06-17
    const updatedTask = await getTaskInstances(task.id, true); // true = include master
    expect(updatedTask.rollingAnchor).toBe('2026-06-17');
  });

  it('SUB-85a: Multiple done instances - last one wins', async () => {
    const task = await createTask({
      text: 'Rolling multiple done',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create done instances on different dates
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
      scheduled_at: '2026-06-18T08:00:00Z'
    });

    await runScheduler();

    // Rolling anchor should be updated to the latest done date
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-18');
  });
});

/**
 * TS-86: Rolling anchor - skip fully reanchors (no forward shift)
 * Domain: Rolling Recurrence / Anchor Update / Skip
 */
describe('TS-86: Rolling anchor - skip fully reanchors', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: skip instance fully reanchors', async () => {
    const task = await createTask({
      text: 'Rolling skip test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create skip instance on 2026-06-17
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler();

    // Rolling anchor should be updated to skip date (full reanchor)
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-17');
  });

  it('SUB-86a: Skip vs done - skip takes precedence for reanchor', async () => {
    const task = await createTask({
      text: 'Rolling skip precedence',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create both skip and done instances
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
      status: 'done',
      scheduled_at: '2026-06-18T08:00:00Z'
    });

    await runScheduler();

    // Skip should take precedence - rolling anchor should be skip date
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-17');
  });
});

/**
 * TS-87: Rolling anchor - missed shifts anchor forward by 1 day
 * Domain: Rolling Recurrence / Anchor Update / Missed
 */
describe('TS-87: Rolling anchor - missed shifts forward by 1 day', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: missed instance shifts anchor forward', async () => {
    const task = await createTask({
      text: 'Rolling missed test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create missed instance on 2026-06-17
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'missed',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler();

    // Rolling anchor should be shifted forward by 1 day from missed date
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-18');
  });

  it('SUB-87a: Missed on anchor date shifts to next day', async () => {
    const task = await createTask({
      text: 'Rolling missed on anchor',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create missed instance on anchor date
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'missed',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await runScheduler();

    // Should shift to next day
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-16');
  });
});

/**
 * TS-88: Rolling anchor - cancel does not update anchor
 * Domain: Rolling Recurrence / Anchor Update / Cancel
 */
describe('TS-88: Rolling anchor - cancel does not update anchor', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: cancel instance does not change anchor', async () => {
    const task = await createTask({
      text: 'Rolling cancel test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create cancel instance on 2026-06-17
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler();

    // Rolling anchor should remain unchanged
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-15');
  });

  it('SUB-88a: Cancel with done - done updates anchor', async () => {
    const task = await createTask({
      text: 'Rolling cancel with done',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create both cancel and done instances
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-18T08:00:00Z'
    });

    await runScheduler();

    // Done should update anchor, cancel should be ignored
    const updatedTask = await getTaskInstances(task.id, true);
    expect(updatedTask.rollingAnchor).toBe('2026-06-18');
  });
});

/**
 * TS-89: Rolling recurrence backfill - generates instances from anchor forward
 * Domain: Rolling Recurrence / Backfill
 */
describe('TS-89: Rolling recurrence backfill', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: backfill generates instances from current anchor', async () => {
    const task = await createTask({
      text: 'Rolling backfill test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 3, timesPerCycle: 4 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create one done instance
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T08:00:00Z'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Should have 1 existing + 3 new picks = 4 total (timesPerCycle)
    expect(instances.length).toBe(4);
    
    // New instances should be scheduled from anchor forward at intervalDays spacing
    const scheduledDates = instances
      .filter(i => i.status === '' || i.status === 'pending')
      .map(i => i.scheduled_at)
      .sort();
    
    expect(scheduledDates.length).toBe(3);
    expect(scheduledDates[0]).toContain('2026-06-18'); // anchor + 3 days
    expect(scheduledDates[1]).toContain('2026-06-21'); // anchor + 6 days
    expect(scheduledDates[2]).toContain('2026-06-24'); // anchor + 9 days
  });

  it('SUB-89a: Backfill respects timesPerCycle limit', async () => {
    const task = await createTask({
      text: 'Rolling backfill limit',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 2, timesPerCycle: 2 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // No existing instances
    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Should generate exactly timesPerCycle instances
    expect(instances.length).toBe(2);
  });
});

/**
 * TS-90: Rolling recurrence materialization - creates concrete instances
 * Domain: Rolling Recurrence / Materialization
 */
describe('TS-90: Rolling recurrence materialization', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: materialization creates scheduled instances', async () => {
    const task = await createTask({
      text: 'Rolling materialization test',
      dur: 30,
      placementMode: 'time_blocks',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // Should create concrete instances with scheduled_at times
    expect(instances.length).toBeGreaterThan(0);
    
    instances.forEach(instance => {
      expect(instance.scheduled_at).toBeDefined();
      expect(instance.scheduled_at).not.toBeNull();
      expect(instance.scheduled_at).not.toBe('');
    });
  });

  it('SUB-90a: Materialization respects placement mode', async () => {
    const task = await createTask({
      text: 'Rolling materialization placement',
      dur: 60,
      placementMode: 'time_blocks',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 2 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // Instances should be placed in valid time blocks
    instances.forEach(instance => {
      const hour = new Date(instance.scheduled_at).getHours();
      // Time blocks are typically 8-12, 13-17, etc. - this is a basic check
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(18);
    });
  });
});

/**
 * TS-91: Rolling recurrence stale guard - prevents old anchor usage
 * Domain: Rolling Recurrence / Stale Guard
 */
describe('TS-91: Rolling recurrence stale guard', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: stale guard prevents scheduling from old anchor', async () => {
    // Create task with old anchor (30 days ago)
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 30);
    const oldAnchor = pastDate.toISOString().split('T')[0];

    const task = await createTask({
      text: 'Rolling stale guard test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-01-15',
      rollingAnchor: oldAnchor
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // Should not create instances from stale anchor
    expect(instances.length).toBe(0);
  });

  it('SUB-91a: Recent anchor allows scheduling', async () => {
    // Create task with recent anchor (within stale threshold)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 2);
    const recentAnchor = recentDate.toISOString().split('T')[0];

    const task = await createTask({
      text: 'Rolling recent anchor test',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-13',
      rollingAnchor: recentAnchor
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // Should create instances from recent anchor
    expect(instances.length).toBeGreaterThan(0);
  });
});

/**
 * TS-92: Rolling recurrence with TPC fill policy integration
 * Domain: Rolling Recurrence / TPC Integration
 */
describe('TS-92: Rolling recurrence with TPC fill policy', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: rolling + backfill policy', async () => {
    const task = await createTask({
      text: 'Rolling TPC backfill',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 5, timesPerCycle: 4 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      fillPolicy: 'backfill'
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

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    
    // Should backfill based on rolling anchor and TPC rules
    // 1 done + 1 skip (opens slot) = need 3 more to reach timesPerCycle=4
    expect(instances.length).toBe(5); // 2 existing + 3 new
  });

  it('SUB-92a: Rolling + keep policy', async () => {
    const task = await createTask({
      text: 'Rolling TPC keep',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 4, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
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

    await runScheduler({ fillPolicy: 'keep' });

    const instances = await getTaskInstances(task.id);
    
    // Keep policy: skip preserves slot, so only need 1 more to reach timesPerCycle=3
    expect(instances.length).toBe(3); // 2 existing + 1 new
  });
});

/**
 * TS-93: Rolling recurrence spacing guard integration
 * Domain: Rolling Recurrence / Spacing Guard
 */
describe('TS-93: Rolling recurrence spacing guard', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: spacing guard respects rolling anchor updates', async () => {
    const task = await createTask({
      text: 'Rolling spacing guard',
      dur: 60,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { type: 'rolling', intervalDays: 3, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      minGapDays: 1
    });

    // Create done instance that will update anchor
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // New instances should respect spacing from the updated anchor (2026-06-17)
    const doneInstance = instances.find(i => i.status === 'done');
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');
    
    newInstances.forEach(newInst => {
      const doneDate = new Date(doneInstance.scheduled_at);
      const newDate = new Date(newInst.scheduled_at);
      const daysDiff = (newDate - doneDate) / (1000 * 60 * 60 * 24);
      
      // Should respect minGapDays
      expect(daysDiff).toBeGreaterThanOrEqual(1);
    });
  });
});

/**
 * TS-94: Rolling recurrence target interval steering
 * Domain: Rolling Recurrence / Target Interval
 */
describe('TS-94: Rolling recurrence target interval steering', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: target interval guides rolling anchor progression', async () => {
    const task = await createTask({
      text: 'Rolling target interval',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 4, targetIntervalDays: 21 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    // Create done instances that would normally advance anchor beyond target
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
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    const updatedTask = await getTaskInstances(task.id, true);
    
    // Anchor should be steered toward target interval
    const anchorDate = new Date(updatedTask.rollingAnchor);
    const startDate = new Date('2026-06-15');
    const daysFromStart = (anchorDate - startDate) / (1000 * 60 * 60 * 24);
    
    // Should be close to target interval
    expect(daysFromStart).toBeLessThanOrEqual(21);
    expect(daysFromStart).toBeGreaterThanOrEqual(14); // Some progression but not exceeding target
  });
});

/**
 * TS-95: Rolling recurrence safety valve - prevents excessive scheduling
 * Domain: Rolling Recurrence / Safety Valve
 */
describe('TS-95: Rolling recurrence safety valve', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: safety valve limits instance generation', async () => {
    const task = await createTask({
      text: 'Rolling safety valve',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 1, timesPerCycle: 100 }, // Very high
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // Should be limited by safety valve, not create 100 instances
    expect(instances.length).toBeLessThan(100);
    expect(instances.length).toBeLessThanOrEqual(30); // Reasonable safety limit
  });

  it('SUB-95a: Safety valve with backfill policy', async () => {
    const task = await createTask({
      text: 'Rolling safety backfill',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 1, timesPerCycle: 50 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create some done instances
    for (let i = 0; i < 5; i++) {
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
    
    // Even with backfill, should respect safety valve
    expect(instances.length).toBeLessThan(50);
  });
});

/**
 * TS-96: Rolling recurrence missed threshold handling
 * Domain: Rolling Recurrence / Missed Threshold
 */
describe('TS-96: Rolling recurrence missed threshold', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: missed instances trigger reanchor after threshold', async () => {
    const task = await createTask({
      text: 'Rolling missed threshold',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      missedThreshold: 2
    });

    // Create multiple missed instances
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'missed',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'missed',
      scheduled_at: '2026-06-19T08:00:00Z'
    });

    await runScheduler();

    const updatedTask = await getTaskInstances(task.id, true);
    
    // After threshold, should trigger reanchor
    expect(updatedTask.rollingAnchor).not.toBe('2026-06-15');
    // Should be shifted forward from last missed
    expect(updatedTask.rollingAnchor).toBe('2026-06-20'); // last missed + 1 day
  });

  it('SUB-96a: Below threshold - no reanchor', async () => {
    const task = await createTask({
      text: 'Rolling below threshold',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      missedThreshold: 3
    });

    // Create only 1 missed instance (below threshold)
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'missed',
      scheduled_at: '2026-06-17T08:00:00Z'
    });

    await runScheduler();

    const updatedTask = await getTaskInstances(task.id, true);
    
    // Should not reanchor below threshold
    expect(updatedTask.rollingAnchor).toBe('2026-06-15');
  });
});

/**
 * TS-97: Rolling recurrence backfill with mixed status instances
 * Domain: Rolling Recurrence / Backfill / Mixed Status
 */
describe('TS-97: Rolling recurrence backfill with mixed status', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: complex mixed status backfill calculation', async () => {
    const task = await createTask({
      text: 'Rolling mixed backfill',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 5, timesPerCycle: 5 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      fillPolicy: 'backfill'
    });

    // Create mixed status instances
    // 2 done, 1 skip (opens slot), 1 cancel (doesn't count), 1 missed (shifts anchor)
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
    const updatedTask = await getTaskInstances(task.id, true);
    
    // Complex calculation:
    // - 2 done count as fulfilled
    // - 1 skip opens slot (backfill policy)
    // - 1 cancel doesn't count
    // - 1 missed shifts anchor to 2026-06-20
    // Need 5 total, have 2 done + 1 skip-opened = need 2 more
    // But anchor shifted, so new picks from new anchor
    
    expect(instances.length).toBe(7); // 5 existing + 2 new
    expect(updatedTask.rollingAnchor).toBe('2026-06-20'); // shifted by missed
  });
});

/**
 * TS-98: Rolling recurrence materialization edge cases
 * Domain: Rolling Recurrence / Materialization / Edge Cases
 */
describe('TS-98: Rolling recurrence materialization edge cases', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: materialization at day boundaries', async () => {
    const task = await createTask({
      text: 'Rolling day boundary',
      dur: 60,
      placementMode: 'time_blocks',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 2 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // Instances should be properly placed at day boundaries
    instances.forEach(instance => {
      const date = new Date(instance.scheduled_at);
      const minutes = date.getMinutes();
      
      // Should be at reasonable time block boundaries
      expect(minutes).toBeLessThan(60);
      expect(minutes).toBeGreaterThanOrEqual(0);
    });
  });

  it('SUB-98a: Materialization with very short intervals', async () => {
    const task = await createTask({
      text: 'Rolling short interval',
      dur: 15,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 1, timesPerCycle: 3 },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15'
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    
    // Should handle short intervals properly
    expect(instances.length).toBe(3);
    
    // Check that instances are properly spaced
    for (let i = 1; i < instances.length; i++) {
      const prevDate = new Date(instances[i-1].scheduled_at);
      const currDate = new Date(instances[i].scheduled_at);
      const daysDiff = (currDate - prevDate) / (1000 * 60 * 60 * 24);
      
      expect(daysDiff).toBeGreaterThanOrEqual(1);
    }
  });
});

/**
 * TS-99: Rolling recurrence stale guard with anchor updates
 * Domain: Rolling Recurrence / Stale Guard / Anchor Updates
 */
describe('TS-99: Rolling recurrence stale guard with anchor updates', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: stale guard allows recent anchor updates', async () => {
    const task = await createTask({
      text: 'Rolling stale with updates',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 3 },
      recurStart: '2026-06-10',
      rollingAnchor: '2026-06-10'
    });

    // Create recent done instance that updates anchor
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-14T08:00:00Z' // Within stale threshold
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    const updatedTask = await getTaskInstances(task.id, true);
    
    // Should allow scheduling from updated anchor
    expect(instances.length).toBeGreaterThan(0);
    expect(updatedTask.rollingAnchor).toBe('2026-06-14');
  });

  it('SUB-99a: Stale original anchor but recent update allowed', async () => {
    const task = await createTask({
      text: 'Rolling stale original recent update',
      dur: 30,
      placementMode: 'anytime',
      recurring: true,
      recur: { type: 'rolling', intervalDays: 7, timesPerCycle: 2 },
      recurStart: '2026-05-15', // Old start date
      rollingAnchor: '2026-05-15' // Stale anchor
    });

    // Create very recent done instance
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 1);
    const recentDateStr = recentDate.toISOString().split('T')[0];

    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: `${recentDateStr}T08:00:00Z`
    });

    await runScheduler();

    const instances = await getTaskInstances(task.id);
    const updatedTask = await getTaskInstances(task.id, true);
    
    // Should use recent update, not stale original anchor
    expect(instances.length).toBeGreaterThan(0);
    expect(updatedTask.rollingAnchor).toBe(recentDateStr);
  });
});

/**
 * TS-100: Rolling recurrence comprehensive integration test
 * Domain: Rolling Recurrence / Integration
 */
describe('TS-100: Rolling recurrence comprehensive integration', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: full rolling recurrence lifecycle', async () => {
    const task = await createTask({
      text: 'Rolling comprehensive test',
      dur: 45,
      placementMode: 'time_blocks',
      isFlexibleTpc: true,
      recurring: true,
      recur: { 
        type: 'rolling', 
        intervalDays: 3, 
        timesPerCycle: 4,
        targetIntervalDays: 12
      },
      recurStart: '2026-06-15',
      rollingAnchor: '2026-06-15',
      fillPolicy: 'backfill',
      minGapDays: 1,
      missedThreshold: 2
    });

    // Simulate a week of activity
    // Monday: done (updates anchor)
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'done',
      scheduled_at: '2026-06-15T09:00:00Z'
    });

    // Tuesday: skip (opens slot, full reanchor)
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'skip',
      scheduled_at: '2026-06-16T10:00:00Z'
    });

    // Wednesday: missed (shifts anchor forward)
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'missed',
      scheduled_at: '2026-06-17T11:00:00Z'
    });

    // Thursday: cancel (doesn't affect anchor or count)
    await createTask({
      master_id: task.id,
      text: task.text,
      dur: task.dur,
      status: 'cancel',
      scheduled_at: '2026-06-18T12:00:00Z'
    });

    await runScheduler({ fillPolicy: 'backfill' });

    const instances = await getTaskInstances(task.id);
    const updatedTask = await getTaskInstances(task.id, true);

    // Complex validation:
    // - Anchor should be updated by skip (full reanchor) to 2026-06-16
    // - Then shifted by missed to 2026-06-18
    // - TPC: 1 done + 1 skip (opens) + 1 missed + 1 cancel (ignored) = need 2 more to reach 4
    // - Backfill policy applies
    // - Spacing guard with minGapDays=1
    // - Target interval steering toward 12 days

    expect(updatedTask.rollingAnchor).toBe('2026-06-18'); // skip reanchor + missed shift
    expect(instances.length).toBe(6); // 4 existing + 2 new

    // Validate spacing for new instances
    const newInstances = instances.filter(i => i.status === '' || i.status === 'pending');
    newInstances.forEach(newInst => {
      const anchorDate = new Date('2026-06-18');
      const newDate = new Date(newInst.scheduled_at);
      const daysFromAnchor = (newDate - anchorDate) / (1000 * 60 * 60 * 24);
      
      // Should be at reasonable intervals considering target steering
      expect(daysFromAnchor).toBeGreaterThanOrEqual(0);
      expect(daysFromAnchor).toBeLessThanOrEqual(15); // Within reasonable bounds
    });
  });
});