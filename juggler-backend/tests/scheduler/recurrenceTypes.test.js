// TELLY-04: Recurrence type tests TS-72 to TS-84
// File: tests/scheduler/recurrenceTypes.test.js
// Tests: TS-72, TS-73, TS-74, TS-75, TS-76, TS-77, TS-78, TS-79, TS-80, TS-81, TS-82, TS-83, TS-84

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask, createRecurringTask } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');
const { timeControl } = require('../../test-helpers/time-control');

/**
 * TS-72: Daily recurrence generates correct instances
 * Domain: Recurrence / Instance Generation
 */
describe('TS-72: Daily recurrence instance generation', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Daily task creates one instance per day', async () => {
    const tc = timeControl('4/3/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    // Create a daily recurring task
    await createRecurringTask({
      text: 'Daily standup',
      dur: 30,
      pri: 'P2',
      when: 'morning',
      recur: {
        type: 'daily',
        every: 1
      },
      recur_start: '2026-04-03',
      recur_end: '2026-04-09'
    });

    // Run scheduler for 7 days
    const results = [];
    for (let i = 0; i < 7; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    // Should have daily instances
    const dailyInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Daily standup');
    
    expect(dailyInstances.length).toBe(7);
    expect(dailyInstances[0].date).toBe('4/3/2026');
    expect(dailyInstances[6].date).toBe('4/9/2026');
  });

  it('SUB-72a: Daily every 2 days creates instances every other day', async () => {
    const tc = timeControl('4/3/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Bi-daily review',
      dur: 45,
      pri: 'P3',
      when: 'afternoon',
      recur: {
        type: 'daily',
        every: 2
      },
      recur_start: '2026-04-03',
      recur_end: '2026-04-11'
    });

    const results = [];
    for (let i = 0; i < 9; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const biDailyInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Bi-daily review');
    
    expect(biDailyInstances.length).toBe(5); // Days 3, 5, 7, 9, 11
    expect(biDailyInstances[0].date).toBe('4/3/2026');
    expect(biDailyInstances[1].date).toBe('4/5/2026');
    expect(biDailyInstances[4].date).toBe('4/11/2026');
  });
});

/**
 * TS-73: Weekly recurrence generates correct instances
 * Domain: Recurrence / Instance Generation
 */
describe('TS-73: Weekly recurrence instance generation', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Weekly task on specific days creates instances', async () => {
    const tc = timeControl('4/3/2026', 'America/New_York'); // Friday
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Weekly team meeting',
      dur: 60,
      pri: 'P1',
      when: 'morning',
      recur: {
        type: 'weekly',
        every: 1,
        days: ['Mon', 'Wed', 'Fri']
      },
      recur_start: '2026-04-03',
      recur_end: '2026-04-17'
    });

    const results = [];
    for (let i = 0; i < 15; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const weeklyInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Weekly team meeting');
    
    expect(weeklyInstances.length).toBe(9); // 3 days/week * 3 weeks
    const days = weeklyInstances.map(i => i.day);
    expect(days.every(d => ['Mon', 'Wed', 'Fri'].includes(d))).toBe(true);
  });

  it('SUB-73a: Weekly every 2 weeks creates instances biweekly', async () => {
    const tc = timeControl('4/3/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Biweekly planning',
      dur: 90,
      pri: 'P2',
      when: 'afternoon',
      recur: {
        type: 'weekly',
        every: 2,
        days: ['Tue']
      },
      recur_start: '2026-04-03',
      recur_end: '2026-05-01'
    });

    const results = [];
    for (let i = 0; i < 29; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const biweeklyInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Biweekly planning');
    
    expect(biweeklyInstances.length).toBe(4); // Every 2 weeks
    expect(biweeklyInstances[0].date).toBe('4/7/2026'); // First Tuesday after start
    expect(biweeklyInstances[1].date).toBe('4/21/2026');
  });
});

/**
 * TS-74: Monthly recurrence generates correct instances
 * Domain: Recurrence / Instance Generation
 */
describe('TS-74: Monthly recurrence instance generation', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Monthly task on specific day creates instances', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Monthly report',
      dur: 120,
      pri: 'P1',
      when: 'morning',
      recur: {
        type: 'monthly',
        every: 1,
        day: 15
      },
      recur_start: '2026-04-01',
      recur_end: '2026-09-01'
    });

    const results = [];
    for (let i = 0; i < 182; i++) { // ~6 months
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const monthlyInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Monthly report');
    
    expect(monthlyInstances.length).toBe(6); // April through September
    expect(monthlyInstances[0].date).toBe('4/15/2026');
    expect(monthlyInstances[5].date).toBe('9/15/2026');
  });

  it('SUB-74a: Monthly on last day handles month-end correctly', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Month-end review',
      dur: 60,
      pri: 'P2',
      when: 'afternoon',
      recur: {
        type: 'monthly',
        every: 1,
        day: 'last'
      },
      recur_start: '2026-04-01',
      recur_end: '2026-06-01'
    });

    const results = [];
    for (let i = 0; i < 92; i++) { // ~3 months
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const monthEndInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Month-end review');
    
    expect(monthEndInstances.length).toBe(3);
    // April has 30 days, May has 31, June has 30
    expect(monthEndInstances[0].date).toBe('4/30/2026');
    expect(monthEndInstances[1].date).toBe('5/31/2026');
    expect(monthEndInstances[2].date).toBe('6/30/2026');
  });
});

/**
 * TS-75: Interval recurrence (custom patterns) generates correct instances
 * Domain: Recurrence / Instance Generation
 */
describe('TS-75: Interval recurrence instance generation', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Every 3 days creates instances every 3 days', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Every 3 days check-in',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: {
        type: 'custom',
        pattern: 'interval',
        every: 3
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-16'
    });

    const results = [];
    for (let i = 0; i < 16; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const intervalInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Every 3 days check-in');
    
    expect(intervalInstances.length).toBe(6); // Days 1, 4, 7, 10, 13, 16
    expect(intervalInstances[0].date).toBe('4/1/2026');
    expect(intervalInstances[1].date).toBe('4/4/2026');
    expect(intervalInstances[5].date).toBe('4/16/2026');
  });
});

/**
 * TS-76: Rolling recurrence respects horizon and generates instances within window
 * Domain: Recurrence / Instance Generation
 */
describe('TS-76: Rolling recurrence with horizon', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Rolling weekly respects 30-day horizon', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Rolling weekly review',
      dur: 45,
      pri: 'P2',
      when: 'morning',
      recur: {
        type: 'rolling',
        every: 7,
        horizon: 30
      },
      recur_start: '2026-04-01'
    });

    const results = [];
    for (let i = 0; i < 30; i++) { // 30 days
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const rollingInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Rolling weekly review');
    
    expect(rollingInstances.length).toBeGreaterThanOrEqual(4); // At least 4 instances in 30 days
    expect(rollingInstances.length).toBeLessThanOrEqual(5); // At most 5 instances
    
    // All instances should be within the 30-day horizon
    const startDate = new Date('2026-04-01');
    const endDate = new Date('2026-04-30');
    rollingInstances.forEach(instance => {
      const instanceDate = new Date(instance.scheduled_at);
      expect(instanceDate >= startDate && instanceDate <= endDate).toBe(true);
    });
  });
});

/**
 * TS-77: Recurrence end date stops instance generation
 * Domain: Recurrence / Instance Generation
 */
describe('TS-77: Recurrence end date enforcement', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Daily task stops at recur_end', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Limited daily task',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: {
        type: 'daily',
        every: 1
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-05'
    });

    const results = [];
    for (let i = 0; i < 10; i++) { // Run for 10 days, but should stop after day 5
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const limitedInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Limited daily task');
    
    expect(limitedInstances.length).toBe(5); // Only days 1-5
    expect(limitedInstances[4].date).toBe('4/5/2026');
    
    // No instances after end date
    const afterEndInstances = limitedInstances.filter(i => i.date > '4/5/2026');
    expect(afterEndInstances.length).toBe(0);
  });

  it('SUB-77a: Weekly task stops at recur_end', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Limited weekly task',
      dur: 60,
      pri: 'P2',
      when: 'afternoon',
      recur: {
        type: 'weekly',
        every: 1,
        days: ['Wed']
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-15'
    });

    const results = [];
    for (let i = 0; i < 21; i++) { // 3 weeks
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const weeklyLimitedInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Limited weekly task');
    
    expect(weeklyLimitedInstances.length).toBe(3); // April 1, 8, 15
    expect(weeklyLimitedInstances[2].date).toBe('4/15/2026');
  });
});

/**
 * TS-78: Recurrence start date delays instance generation
 * Domain: Recurrence / Instance Generation
 */
describe('TS-78: Recurrence start date enforcement', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Daily task starts at recur_start', async () => {
    const tc = timeControl('3/28/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Delayed daily task',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: {
        type: 'daily',
        every: 1
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-05'
    });

    const results = [];
    for (let i = 0; i < 10; i++) { // March 28 - April 6
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const delayedInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Delayed daily task');
    
    expect(delayedInstances.length).toBe(5); // Only April 1-5
    expect(delayedInstances[0].date).toBe('4/1/2026');
    
    // No instances before start date
    const beforeStartInstances = delayedInstances.filter(i => i.date < '4/1/2026');
    expect(beforeStartInstances.length).toBe(0);
  });
});

/**
 * TS-79: Paused recurrence temporarily stops instance generation
 * Domain: Recurrence / Instance Generation
 */
describe('TS-79: Paused recurrence behavior', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Paused daily task generates no instances', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    const task = await createRecurringTask({
      text: 'Paused daily task',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: {
        type: 'daily',
        every: 1
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-05',
      disabled_at: new Date('2026-04-01T00:00:00Z'),
      disabled_reason: 'user_paused'
    });

    const results = [];
    for (let i = 0; i < 5; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const pausedInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Paused daily task');
    
    expect(pausedInstances.length).toBe(0); // No instances when paused
  });

  it('SUB-79a: Resumed task generates instances after pause', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    // Create task that starts paused, then resume it
    const task = await createRecurringTask({
      text: 'Resumed daily task',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: {
        type: 'daily',
        every: 1
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-05'
    });

    // Run for 2 days - should generate instances
    let results = [];
    for (let i = 0; i < 2; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    let activeInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Resumed daily task');
    
    expect(activeInstances.length).toBe(2); // Days 1-2

    // Pause the task
    await db('task_masters').where('id', task.id).update({
      disabled_at: new Date('2026-04-03T00:00:00Z'),
      disabled_reason: 'user_paused'
    });

    // Run for 1 day - should generate no instance
    const pausedResult = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
    const pausedInstances = pausedResult.scheduledTasks
      .filter(t => t.text === 'Resumed daily task');
    
    expect(pausedInstances.length).toBe(0);

    // Resume the task
    await db('task_masters').where('id', task.id).update({
      disabled_at: null,
      disabled_reason: null
    });

    // Run for 2 more days - should generate instances again
    results = [];
    for (let i = 0; i < 2; i++) {
      tc.advanceDay('8:00 AM');
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
    }

    const resumedInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Resumed daily task');
    
    expect(resumedInstances.length).toBe(2); // Days 4-5
  });
});

/**
 * TS-80: Disabled recurrence permanently stops instance generation
 * Domain: Recurrence / Instance Generation
 */
describe('TS-80: Disabled recurrence behavior', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Disabled daily task generates no instances', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Disabled daily task',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: {
        type: 'daily',
        every: 1
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-05',
      disabled_at: new Date('2026-04-01T00:00:00Z'),
      disabled_reason: 'user_disabled'
    });

    const results = [];
    for (let i = 0; i < 5; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const disabledInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Disabled daily task');
    
    expect(disabledInstances.length).toBe(0); // No instances when disabled
  });
});

/**
 * TS-81: Horizon limit caps future instance generation
 * Domain: Recurrence / Instance Generation
 */
describe('TS-81: Horizon limit enforcement', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: 30-day horizon limits daily instances', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Horizon-limited daily',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: {
        type: 'daily',
        every: 1
      },
      recur_start: '2026-04-01',
      horizon: 30 // 30 days from today
    });

    const results = [];
    for (let i = 0; i < 40; i++) { // Try to run for 40 days
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const horizonInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Horizon-limited daily');
    
    expect(horizonInstances.length).toBeLessThanOrEqual(30); // Should not exceed horizon
    
    // All instances should be within 30 days from start
    const startDate = new Date('2026-04-01');
    const horizonEnd = new Date('2026-04-30');
    horizonInstances.forEach(instance => {
      const instanceDate = new Date(instance.scheduled_at);
      expect(instanceDate <= horizonEnd).toBe(true);
    });
  });
});

/**
 * TS-82: Grandfather clause preserves existing instances when recurrence changes
 * Domain: Recurrence / Instance Generation
 */
describe('TS-82: Grandfather clause preservation', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Existing instances preserved when recurrence rule changes', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    // Create initial daily task
    const task = await createRecurringTask({
      text: 'Grandfathered daily task',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      recur: {
        type: 'daily',
        every: 1
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-10'
    });

    // Run scheduler to generate initial instances
    const initialResults = [];
    for (let i = 0; i < 5; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      initialResults.push(result);
      tc.advanceDay('8:00 AM');
    }

    const initialInstances = initialResults.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Grandfathered daily task');
    
    expect(initialInstances.length).toBe(5);

    // Change recurrence rule to weekly
    await db('task_masters').where('id', task.id).update({
      recur: {
        type: 'weekly',
        every: 1,
        days: ['Mon']
      },
      updated_at: new Date()
    });

    // Run scheduler again - should preserve existing instances
    const postChangeResults = [];
    for (let i = 0; i < 5; i++) {
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      postChangeResults.push(result);
      tc.advanceDay('8:00 AM');
    }

    const postChangeInstances = postChangeResults.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Grandfathered daily task');
    
    // Should still have the original 5 instances plus new weekly ones
    expect(postChangeInstances.length).toBeGreaterThanOrEqual(5);
    
    // Original instances should still exist
    const originalInstanceIds = initialInstances.map(i => i.id);
    const preservedInstances = postChangeInstances.filter(i => originalInstanceIds.includes(i.id));
    expect(preservedInstances.length).toBe(5);
  });
});

/**
 * TS-83: Biweekly recurrence generates instances every other week
 * Domain: Recurrence / Instance Generation
 */
describe('TS-83: Biweekly recurrence instance generation', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Biweekly task creates instances every 2 weeks', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Biweekly sync',
      dur: 60,
      pri: 'P2',
      when: 'afternoon',
      recur: {
        type: 'biweekly',
        every: 2,
        days: ['Wed']
      },
      recur_start: '2026-04-01',
      recur_end: '2026-06-01'
    });

    const results = [];
    for (let i = 0; i < 60; i++) { // ~2 months
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const biweeklyInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Biweekly sync');
    
    expect(biweeklyInstances.length).toBe(5); // Every 2 weeks: April 1, 15, 29; May 13, 27
    expect(biweeklyInstances[0].date).toBe('4/1/2026'); // First Wednesday in April
    expect(biweeklyInstances[1].date).toBe('4/15/2026');
    expect(biweeklyInstances[2].date).toBe('4/29/2026');
  });
});

/**
 * TS-84: Rolling recurrence with complex patterns respects all constraints
 * Domain: Recurrence / Instance Generation
 */
describe('TS-84: Rolling recurrence with complex constraints', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Rolling weekly with horizon and day constraints', async () => {
    const tc = timeControl('4/1/2026', 'America/New_York');
    tc.setTime('8:00 AM');

    await createRecurringTask({
      text: 'Complex rolling task',
      dur: 45,
      pri: 'P2',
      when: 'morning',
      day_req: 'weekday',
      recur: {
        type: 'rolling',
        every: 7,
        horizon: 14,
        days: ['Mon', 'Wed', 'Fri']
      },
      recur_start: '2026-04-01',
      recur_end: '2026-04-30'
    });

    const results = [];
    for (let i = 0; i < 14; i++) { // 2 weeks (horizon)
      const result = await runScheduler([], [], tc.todayKey, tc.nowMins, {});
      results.push(result);
      tc.advanceDay('8:00 AM');
    }

    const complexInstances = results.flatMap(r => r.scheduledTasks)
      .filter(t => t.text === 'Complex rolling task');
    
    expect(complexInstances.length).toBeGreaterThanOrEqual(4);
    expect(complexInstances.length).toBeLessThanOrEqual(6);
    
    // All instances should be on weekdays only
    const weekdayDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    complexInstances.forEach(instance => {
      expect(weekdayDays.includes(instance.day)).toBe(true);
    });
    
    // All instances should be within the 14-day horizon
    const startDate = new Date('2026-04-01');
    const horizonEnd = new Date('2026-04-14');
    complexInstances.forEach(instance => {
      const instanceDate = new Date(instance.scheduled_at);
      expect(instanceDate >= startDate && instanceDate <= horizonEnd).toBe(true);
    });
  });
});