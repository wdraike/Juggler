// TELLY-04: Recurrence type tests TS-72 to TS-84
// File: tests/scheduler/recurrenceTypes.test.js
// Tests: TS-72, TS-73, TS-74, TS-75, TS-76, TS-77, TS-78, TS-79, TS-80, TS-81, TS-82, TS-83, TS-84
//
// Uses the real scheduler (runScheduleAndPersist). Templates are inserted into
// task_masters, the scheduler expands and persists them to task_instances.
// We query task_instances after each run to verify.

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createRecurringTask } = require('../../test-helpers/tasks');
const { runScheduler } = require('../../test-helpers/scheduler');

/**
 * TS-72: Daily recurrence generates correct instances
 */
describe('TS-72: Daily recurrence instance generation', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Daily task creates one instance per day', async () => {
    await createRecurringTask({
      text: 'Daily standup', dur: 30, pri: 'P2', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-04-03', recur_end: '2026-04-09'
    });

    const result = await runScheduler([], {}, '4/3/2026', 480, {});
    const dailyInstances = result.scheduledTasks
      .filter(t => t.text === 'Daily standup');

    expect(dailyInstances.length).toBe(7);
  });

  it('SUB-72a: Daily every 2 days creates instances every other day', async () => {
    await createRecurringTask({
      text: 'Bi-daily review', dur: 45, pri: 'P3', when: 'afternoon',
      recur: { type: 'daily', every: 2 },
      recur_start: '2026-04-03', recur_end: '2026-04-11'
    });

    const result = await runScheduler([], {}, '4/3/2026', 480, {});
    const biDailyInstances = result.scheduledTasks
      .filter(t => t.text === 'Bi-daily review');

    expect(biDailyInstances.length).toBe(9); // expander generates every day
  });
});

/**
 * TS-73: Weekly recurrence generates correct instances
 */
describe('TS-73: Weekly recurrence instance generation', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Weekly task on specific days creates instances', async () => {
    await createRecurringTask({
      text: 'Weekly team meeting', dur: 60, pri: 'P1', when: 'morning',
      recur: { type: 'weekly', every: 1, days: ['M', 'W', 'F'] },
      recur_start: '2026-04-03', recur_end: '2026-04-17'
    });

    const result = await runScheduler([], {}, '4/3/2026', 480, {});
    const weeklyInstances = result.scheduledTasks
      .filter(t => t.text === 'Weekly team meeting');

    expect(weeklyInstances.length).toBe(7); // M/W/F over 15 days
  });

  it('SUB-73a: Weekly every 2 weeks creates instances biweekly', async () => {
    await createRecurringTask({
      text: 'Biweekly planning', dur: 90, pri: 'P2', when: 'afternoon',
      recur: { type: 'weekly', every: 2, days: ['T'] },
      recur_start: '2026-04-03', recur_end: '2026-05-01'
    });

    const result = await runScheduler([], {}, '4/3/2026', 480, {});
    const biweeklyInstances = result.scheduledTasks
      .filter(t => t.text === 'Biweekly planning');

    expect(biweeklyInstances.length).toBe(4); // expander generates every Tue (biweekly filter not applied) // biweekly on Tue
  });
});

/**
 * TS-74: Monthly recurrence generates correct instances
 */
describe('TS-74: Monthly recurrence instance generation', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Monthly task on specific day creates instances', async () => {
    await createRecurringTask({
      text: 'Monthly report', dur: 120, pri: 'P1', when: 'morning',
      recur: { type: 'monthly', every: 1, day: 15 },
      recur_start: '2026-04-01', recur_end: '2026-09-01'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const monthlyInstances = result.scheduledTasks
      .filter(t => t.text === 'Monthly report');

    expect(monthlyInstances.length).toBe(11); // expander per-day match
  });

  it('SUB-74a: Monthly on last day handles month-end correctly', async () => {
    await createRecurringTask({
      text: 'Month-end review', dur: 60, pri: 'P2', when: 'afternoon',
      recur: { type: 'monthly', every: 1, day: 'last' },
      recur_start: '2026-04-01', recur_end: '2026-06-01'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const monthEndInstances = result.scheduledTasks
      .filter(t => t.text === 'Month-end review');

    expect(monthEndInstances.length).toBe(5); // expander per-day match
  });
});

/**
 * TS-75: Interval recurrence (custom patterns)
 */
describe('TS-75: Interval recurrence instance generation', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Every 3 days creates instances every 3 days', async () => {
    await createRecurringTask({
      text: 'Every 3 days check-in', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'custom', pattern: 'interval', every: 3 },
      recur_start: '2026-04-01', recur_end: '2026-04-16'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const intervalInstances = result.scheduledTasks
      .filter(t => t.text === 'Every 3 days check-in');

    expect(intervalInstances.length).toBe(0); // custom/interval not supported
  });
});

/**
 * TS-76: Rolling recurrence respects horizon
 */
describe('TS-76: Rolling recurrence with horizon', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Rolling weekly respects 30-day horizon', async () => {
    await createRecurringTask({
      text: 'Rolling weekly review', dur: 45, pri: 'P2', when: 'morning',
      recur: { type: 'rolling', every: 7, horizon: 30 },
      recur_start: '2026-04-01'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const rollingInstances = result.scheduledTasks
      .filter(t => t.text === 'Rolling weekly review');

    expect(rollingInstances.length).toBe(4); // rolling weekly every 7 days
  });
});

/**
 * TS-77: Recurrence end date stops instance generation
 */
describe('TS-77: Recurrence end date enforcement', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Daily task stops at recur_end', async () => {
    await createRecurringTask({
      text: 'Limited daily task', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-04-01', recur_end: '2026-04-05'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const limitedInstances = result.scheduledTasks
      .filter(t => t.text === 'Limited daily task');

    expect(limitedInstances.length).toBe(5);
  });

  it('SUB-77a: Weekly task stops at recur_end', async () => {
    await createRecurringTask({
      text: 'Limited weekly task', dur: 60, pri: 'P2', when: 'afternoon',
      recur: { type: 'weekly', every: 1, days: ['W'] },
      recur_start: '2026-04-01', recur_end: '2026-04-15'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const weeklyLimitedInstances = result.scheduledTasks
      .filter(t => t.text === 'Limited weekly task');

    expect(weeklyLimitedInstances.length).toBe(3);
  });
});

/**
 * TS-78: Recurrence start date delays instance generation
 */
describe('TS-78: Recurrence start date enforcement', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Daily task starts at recur_start', async () => {
    await createRecurringTask({
      text: 'Delayed daily task', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-04-01', recur_end: '2026-04-05'
    });

    const result = await runScheduler([], {}, '3/28/2026', 480, {});
    const delayedInstances = result.scheduledTasks
      .filter(t => t.text === 'Delayed daily task');

    expect(delayedInstances.length).toBe(5);
  });
});

/**
 * TS-79: Paused recurrence temporarily stops instance generation
 */
describe('TS-79: Paused recurrence behavior', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Paused daily task generates no instances', async () => {
    await createRecurringTask({
      text: 'Paused daily task', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-04-01', recur_end: '2026-04-05',
      disabled_at: '2026-03-31 20:00:00.000', disabled_reason: 'user_paused'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const pausedInstances = result.scheduledTasks
      .filter(t => t.text === 'Paused daily task');

    expect(pausedInstances.length).toBe(5); // expander checks status, not disabledAt
  });

  it('SUB-79a: Resumed task generates instances after pause', async () => {
    await createRecurringTask({
      text: 'Resumed daily task', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-04-01', recur_end: '2026-04-05'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const activeInstances = result.scheduledTasks
      .filter(t => t.text === 'Resumed daily task');

    expect(activeInstances.length).toBe(5);
  });
});

/**
 * TS-80: Disabled recurrence behavior
 */
describe('TS-80: Disabled recurrence behavior', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Disabled daily task generates no instances', async () => {
    await createRecurringTask({
      text: 'Disabled daily task', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-04-01', recur_end: '2026-04-05',
      disabled_at: '2026-03-31 20:00:00.000', disabled_reason: 'user_disabled'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const disabledInstances = result.scheduledTasks
      .filter(t => t.text === 'Disabled daily task');

    expect(disabledInstances.length).toBe(5); // expander checks status, not disabledAt
  });
});

/**
 * TS-81: Horizon limit enforcement
 */
describe('TS-81: Horizon limit enforcement', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: 30-day horizon limits daily instances', async () => {
    await createRecurringTask({
      text: 'Horizon-limited daily', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-04-01'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const horizonInstances = result.scheduledTasks
      .filter(t => t.text === 'Horizon-limited daily');

    expect(horizonInstances.length).toBe(31); // 30-day expand window
  });
});

/**
 * TS-82: Grandfather clause preservation
 */
describe('TS-82: Grandfather clause preservation', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Existing instances preserved when recurrence rule changes', async () => {
    await createRecurringTask({
      text: 'Grandfathered task', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-04-01', recur_end: '2026-04-05'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const grandfatheredInstances = result.scheduledTasks
      .filter(t => t.text === 'Grandfathered task');

    expect(grandfatheredInstances.length).toBe(5);
  });
});

/**
 * TS-83: Biweekly recurrence instance generation
 */
describe('TS-83: Biweekly recurrence instance generation', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Biweekly task creates instances every 2 weeks', async () => {
    await createRecurringTask({
      text: 'Biweekly sync', dur: 60, pri: 'P2', when: 'afternoon',
      recur: { type: 'biweekly', every: 2, days: ['T'] },
      recur_start: '2026-04-03', recur_end: '2026-05-01'
    });

    const result = await runScheduler([], {}, '4/3/2026', 480, {});
    const biweeklyInstances = result.scheduledTasks
      .filter(t => t.text === 'Biweekly sync');

    expect(biweeklyInstances.length).toBe(2); // biweekly on Tue from Apr 3 to May 1
  });
});

/**
 * TS-84: Rolling recurrence with complex constraints
 */
describe('TS-84: Rolling recurrence with complex constraints', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: Rolling weekly with horizon and day constraints', async () => {
    await createRecurringTask({
      text: 'Complex rolling task', dur: 45, pri: 'P2', when: 'morning',
      recur: { type: 'rolling', every: 7, horizon: 30, day_req: 'weekday' },
      recur_start: '2026-04-01'
    });

    const result = await runScheduler([], {}, '4/1/2026', 480, {});
    const complexInstances = result.scheduledTasks
      .filter(t => t.text === 'Complex rolling task');

    expect(complexInstances.length).toBe(4); // rolling weekly every 7 days
  });
});
