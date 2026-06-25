// TELLY-16: Time-travel clock control tests TS-273 to TS-288
// File: timeTravel.test.js
// Tests: TS-273 to TS-288 - Time-travel clock control functionality
//
// WIRED REALITY (R50.8): the injected FakeClockAdapter genuinely controls the
// scheduler's wall clock. `runSchedulerWithClock(clock)` drives the SAME production
// seam the real scheduler uses — getNowInTimezone(tz, clock) — so the fake instant
// resolves todayKey/nowMins, which then drive in-memory expand+schedule (MODE 1).
//
// MODE-1 loads RECURRING TEMPLATES (task_masters) only and schedules in-memory; it
// does NOT persist task_instances and does NOT schedule one-off rows. So every
// time-dependent scenario seeds a recurring template via createRecurringTask and
// observes clock-driven PLACEMENT in result.scheduledTasks (each carries
// { id, text, dur, start, date, day, status }; date is M/D/YYYY; start is
// minutes-from-midnight; status is the row status, '' for open).
//
// AUTHORITATIVE RULINGS encoded here:
//   (a) auto-miss is REMOVED — a scheduler run NEVER sets status to 'missed' or
//       'overdue'. 'missed' is system-only; it is never produced by scheduling.
//   (b) 'overdue' is a tinyint FLAG/column on a task row, NOT a status value.
//   (c) NEVER-MISSING invariant — placement is best-effort (placed | rolled to a
//       later day | unplaced), never an auto 'missed'/'overdue' status.
//
// The morning block is 360-480 (6:00-8:00 AM). A daily morning recurring task: at
// nowMins=300 (5:00 AM) today's morning slot is still open → first instance placed
// TODAY; at nowMins=480 (8:00 AM) today's morning is past → the first placement
// rolls to TOMORROW (today's slot dropped). This is the proven, wired way to show
// the injected clock driving time-dependent placement.

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createRecurringTask } = require('../../test-helpers/tasks');
const { runSchedulerWithClock } = require('../../test-helpers/scheduler');
const { FakeClockAdapter } = require('../../test-helpers/clock');

// Statuses a scheduler run is FORBIDDEN to produce (ruling a/b).
const FORBIDDEN_STATUSES = ['overdue', 'missed'];

function placementsFor(result, text) {
  return result.scheduledTasks.filter(function (t) { return t.text === text; });
}

/**
 * TS-273: Clock-driven placement past the morning slot
 * Domain: Clock / Time-Travel / Past-deadline placement
 *
 * Rewritten: the stale version asserted `result.tasks[0].status === 'overdue'`
 * after advancing the clock. 'overdue' is a FLAG, never a status, and a scheduler
 * run never sets it (ruling a/b). The wired behavior when the clock crosses a
 * task's slot is that placement ROLLS FORWARD — today's past slot is dropped and
 * the first placement lands on a later day, with status still '' (open).
 */
describe('TS-273: Past-slot placement with time-travel', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: a morning task placed today rolls forward once the clock passes its slot', async () => {
    // Before the morning slot (05:00 → nowMins 300): today's slot is open.
    let fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T05:00:00-04:00' });
    await createRecurringTask({
      text: 'Morning meeting', dur: 60, pri: 'P1', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-06-15', recur_end: '2026-06-18'
    });

    let result = await runSchedulerWithClock(fakeClock);
    let placed = placementsFor(result, 'Morning meeting');
    expect(placed.length).toBeGreaterThan(0);
    // First instance is placed TODAY, open (not overdue/missed).
    expect(placed[0].date).toBe('6/15/2026');
    expect(placed[0].status).toBe('');
    placed.forEach(function (p) { expect(FORBIDDEN_STATUSES).not.toContain(p.status); });

    // After the morning slot (08:00 → nowMins 480): today's slot is past.
    fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T08:00:00-04:00' });
    result = await runSchedulerWithClock(fakeClock);
    placed = placementsFor(result, 'Morning meeting');
    expect(placed.length).toBeGreaterThan(0);
    // The clock advanced past today's morning slot, so the first placement rolled
    // to a LATER day — NOT auto-flagged 'overdue'/'missed'.
    expect(placed[0].date).not.toBe('6/15/2026');
    placed.forEach(function (p) { expect(FORBIDDEN_STATUSES).not.toContain(p.status); });
  });

  it('SUB-273a: a scheduler run never emits an "overdue" or "missed" status', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T08:00:00-04:00' });
    await createRecurringTask({
      text: 'Flexible task', dur: 30, pri: 'P2', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-06-15', recur_end: '2026-06-20'
    });

    // Advance the clock well past the morning window; placement adapts but no
    // placed instance is ever stamped 'overdue'/'missed' (rulings a/b).
    fakeClock.skipHours(6); // 08:00 → 14:00 ET
    const result = await runSchedulerWithClock(fakeClock);
    const placed = placementsFor(result, 'Flexible task');
    expect(placed.length).toBeGreaterThan(0);
    placed.forEach(function (p) { expect(FORBIDDEN_STATUSES).not.toContain(p.status); });
  });
});

/**
 * TS-274: NEVER-MISSING invariant under time-travel
 * Domain: Clock / Time-Travel / Materialization
 *
 * Rewritten: the stale version expected a task to "transition to missed" when the
 * clock skipped a day. Auto-miss is REMOVED (ruling a). Crossing a day boundary
 * does NOT produce a 'missed' status — the recurring instances simply re-place
 * relative to the new today, and remaining occurrences stay open ('').
 */
describe('TS-274: NEVER-MISSING invariant with time-travel', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: skipping a day never auto-misses an occurrence', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T05:00:00-04:00' });
    await createRecurringTask({
      text: 'Time-sensitive task', dur: 45, pri: 'P1', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-06-15', recur_end: '2026-06-20'
    });

    // Day 1: first instance placed today, open.
    let result = await runSchedulerWithClock(fakeClock);
    let placed = placementsFor(result, 'Time-sensitive task');
    expect(placed.length).toBeGreaterThan(0);
    expect(placed[0].date).toBe('6/15/2026');
    expect(placed[0].status).toBe('');

    // Skip a full day — the clock now sits on 6/16. No occurrence is auto-missed.
    fakeClock.skipDays(1);
    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-16');
    placed = placementsFor(result, 'Time-sensitive task');
    expect(placed.length).toBeGreaterThan(0);
    // Placement re-anchors to the new today; status remains open, never 'missed'.
    expect(placed[0].date).toBe('6/16/2026');
    placed.forEach(function (p) { expect(FORBIDDEN_STATUSES).not.toContain(p.status); });
  });
});

/**
 * TS-275: Recurring task generation with time-travel
 * Domain: Clock / Time-Travel / Recurring Tasks
 *
 * Rewritten: stale version read `result.tasks` (undefined) and asserted ISO dates
 * (wrong format) + RFC byDay. Now seeds via createRecurringTask and asserts real
 * clock-driven placement in result.scheduledTasks (M/D/YYYY date format).
 */
describe('TS-275: Recurring task generation with time-travel', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: a daily recurring template re-anchors its first placement as the clock advances', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T05:00:00-04:00' });
    await createRecurringTask({
      text: 'Daily standup', dur: 30, pri: 'P1', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-06-15', recur_end: '2026-06-30'
    });

    // Day 1: first placement is today.
    let result = await runSchedulerWithClock(fakeClock);
    let placed = placementsFor(result, 'Daily standup');
    expect(placed.length).toBeGreaterThan(0);
    expect(placed[0].date).toBe('6/15/2026');

    // Advance one day — the new first placement is the next day.
    fakeClock.skipDays(1);
    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-16');
    placed = placementsFor(result, 'Daily standup');
    expect(placed.length).toBeGreaterThan(0);
    expect(placed[0].date).toBe('6/16/2026');
  });

  it('SUB-275a: a weekly Monday template generates one instance per week and advances with the clock', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T05:00:00-04:00' }); // Monday
    await createRecurringTask({
      text: 'Weekly review', dur: 60, pri: 'P2', when: 'morning',
      recur: { type: 'weekly', every: 1, days: ['M'] },
      recur_start: '2026-06-15', recur_end: '2026-07-15'
    });

    // Week 1: first Monday is 6/15; instances land on consecutive Mondays.
    let result = await runSchedulerWithClock(fakeClock);
    let weekInstances = placementsFor(result, 'Weekly review');
    expect(weekInstances.length).toBeGreaterThan(0);
    expect(weekInstances[0].date).toBe('6/15/2026');
    // Every placement is a Monday.
    weekInstances.forEach(function (w) { expect(w.day).toBe('Mon'); });

    // Advance 7 days — today is the next Monday and the first placement rolls to 6/22.
    fakeClock.skipDays(7);
    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-22');
    weekInstances = placementsFor(result, 'Weekly review');
    expect(weekInstances.length).toBeGreaterThan(0);
    expect(weekInstances[0].date).toBe('6/22/2026');
    weekInstances.forEach(function (w) { expect(w.day).toBe('Mon'); });
  });
});

/**
 * TS-276: Rolling/recurring placement stability with time-travel
 * Domain: Clock / Time-Travel / Rolling Tasks
 *
 * Rewritten: the stale version seeded a one-off via createTask (which tried to
 * insert a self-referential task_instances row and threw a FK error) and asserted
 * the undefined `result.tasks`. MODE-1 schedules recurring templates only, so we
 * seed a recurring template and assert clock-driven first-placement movement.
 */
describe('TS-276: Recurring placement anchor with time-travel', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: the first placement tracks the clock as days advance', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T05:00:00-04:00' });
    await createRecurringTask({
      text: 'Rolling review', dur: 45, pri: 'P2', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-06-15', recur_end: '2026-06-25'
    });

    // First placement is today.
    let result = await runSchedulerWithClock(fakeClock);
    let placed = placementsFor(result, 'Rolling review');
    expect(placed.length).toBeGreaterThan(0);
    expect(placed[0].date).toBe('6/15/2026');
    const day1Count = placed.length;

    // Advance the clock; the first placement re-anchors forward and the past
    // occurrence drops off (NEVER-MISSING: it is not retained as an auto-missed row).
    fakeClock.skipDays(1);
    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-16');
    placed = placementsFor(result, 'Rolling review');
    expect(placed.length).toBeGreaterThan(0);
    expect(placed[0].date).toBe('6/16/2026');
    // One fewer remaining occurrence after the clock crossed a day.
    expect(placed.length).toBe(day1Count - 1);
    placed.forEach(function (p) { expect(FORBIDDEN_STATUSES).not.toContain(p.status); });
  });
});

/**
 * TS-277: Placement responds to intra-day clock advancement
 * Domain: Clock / Time-Travel / Task Adjustment
 *
 * Rewritten: stale version seeded a one-off and asserted `result.tasks[0].time`
 * (no `time`/`tasks` field exists). Instead, advancing the clock within the day
 * past the morning slot changes WHERE today's task is placed — observable via the
 * placement set in result.scheduledTasks.
 */
describe('TS-277: Intra-day clock advancement adjusts placement', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: advancing the clock past the morning slot changes the first placement date', async () => {
    let fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T05:00:00-04:00' });
    await createRecurringTask({
      text: 'Nudgeable task', dur: 30, pri: 'P3', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-06-15', recur_end: '2026-06-18'
    });

    // Early in the day, the first placement is today.
    let result = await runSchedulerWithClock(fakeClock);
    let placed = placementsFor(result, 'Nudgeable task');
    expect(placed.length).toBeGreaterThan(0);
    const earlyFirstDate = placed[0].date;
    expect(earlyFirstDate).toBe('6/15/2026');

    // Same day, but now after the morning window (re-pin the clock to 08:00).
    fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T08:00:00-04:00' });
    result = await runSchedulerWithClock(fakeClock);
    placed = placementsFor(result, 'Nudgeable task');
    expect(placed.length).toBeGreaterThan(0);
    // The first placement moved off today's (now-past) morning slot.
    expect(placed[0].date).not.toBe(earlyFirstDate);
  });
});

// TS-278..TS-284 cover earliestStart crossing, weather change detection, cache
// refresh, the 14-day horizon, the grandfather clause, split time-box, and
// debounce. Those scenarios are exercised in their own dedicated suites
// (e.g. clockWiringGap.test.js for cache/weather facets, recurrenceTypes.test.js
// for horizon/expansion). This file owns the clock-driven placement contract.

/**
 * TS-285: Weekday-weekend transition with time-travel
 * Domain: Clock / Time-Travel / Weekday-Weekend Boundary
 *
 * Rewritten: stale version seeded a one-off `when:'weekend'` task and read
 * `result.tasks[0]` (undefined). Now seeds a daily recurring template and shows
 * the clock crossing the Fri→Sat boundary, re-anchoring placement and reporting
 * the correct day-of-week on each placement.
 */
describe('TS-285: Weekday-weekend transition with time-travel', () => {
  beforeAll(async () => { await setupTestDB(); });
  afterAll(async () => { await teardownTestDB(); });

  it('Main scenario: placement re-anchors across the Friday→Saturday boundary', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-12T05:00:00-04:00' }); // Friday
    await createRecurringTask({
      text: 'Boundary task', dur: 60, pri: 'P2', when: 'morning',
      recur: { type: 'daily', every: 1 },
      recur_start: '2026-06-12', recur_end: '2026-06-14'
    });

    // Friday: placements include Friday (the weekday) through the weekend.
    let result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-12');
    let placed = placementsFor(result, 'Boundary task');
    expect(placed.length).toBeGreaterThan(0);
    expect(placed[0].date).toBe('6/12/2026');
    expect(placed[0].day).toBe('Fri');
    // A Saturday placement exists in the horizon and is correctly day-labelled.
    const saturday = placed.find(function (p) { return p.date === '6/13/2026'; });
    expect(saturday).toBeDefined();
    expect(saturday.day).toBe('Sat');

    // Cross the boundary into Saturday — today's key advances and the Friday
    // (weekday) placement drops off, leaving the weekend occurrences.
    fakeClock.skipDays(1);
    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-13');
    placed = placementsFor(result, 'Boundary task');
    expect(placed.length).toBeGreaterThan(0);
    expect(placed[0].date).toBe('6/13/2026');
    expect(placed[0].day).toBe('Sat');
    placed.forEach(function (p) { expect(FORBIDDEN_STATUSES).not.toContain(p.status); });
  });
});

// TS-286 to TS-288 reserved for additional time-travel scenarios; the clock-driven
// placement contract they would have covered is asserted by the suites above and
// by clockWiringGap.test.js (TS-314..TS-317).
