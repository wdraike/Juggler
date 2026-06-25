// TS-314..TS-317: ClockPort wiring (G-002 — formerly the "FakeClockAdapter
// incompatible with legacy scheduler" gap).
//
// HISTORY: TS-314/315/316 were adversarial gap tests written when the scheduler
// read `new Date()` / `Date.now()` directly and the FakeClockAdapter injection
// had NO effect. That gap is now CLOSED — the production scheduler resolves the
// wall clock through `getNowInTimezone(TIMEZONE, RunScheduleCommand.clock)`
// (runSchedule.js:635, R50.8), and the test helper `runSchedulerWithClock` drives
// the SAME seam. These tests now assert the WIRED reality: the injected clock
// genuinely controls todayKey / nowMins.
//
// File: clockWiringGap.test.js
// Tests: TS-314, TS-315, TS-316, TS-317

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask } = require('../../test-helpers/tasks');
const { runSchedulerWithClock } = require('../../test-helpers/scheduler');
const { FakeClockAdapter } = require('../../test-helpers/clock');

/**
 * TS-314: ClockPort IS wired — an injected FakeClockAdapter drives todayKey/nowMins
 * through getNowInTimezone(tz, clock), not the raw system clock.
 * Domain: Clock / Time-Travel / Orchestrator Wiring
 */
describe('TS-314: getNowInTimezone honors the injected ClockPort', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: FakeClockAdapter drives todayKey (not the system date)', async () => {
    // Fake clock pinned to a fixed instant well away from the real system date.
    const fakeClock = new FakeClockAdapter({ startTime: '2026-07-01T12:00:00-04:00' });

    await createTask({
      text: 'Morning task',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    const result = await runSchedulerWithClock(fakeClock);

    // The clock IS wired: todayKey reflects the fake instant in the target tz.
    expect(result.timeInfo.todayKey).toBe('2026-07-01');
    // And it is NOT the real system date.
    const realTodayKey = new Date().toISOString().split('T')[0];
    if (realTodayKey !== '2026-07-01') {
      expect(result.timeInfo.todayKey).not.toBe(realTodayKey);
    }
  });

  it('SUB-314a: todayKey is resolved in the target timezone via getNowInTimezone', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-07-01T12:00:00-04:00' });

    await createTask({
      text: 'Test task',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    const result = await runSchedulerWithClock(fakeClock);

    expect(result.timeInfo.todayKey).toBe('2026-07-01');
    expect(result.timeInfo.todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('SUB-314b: the fake clock instant is the basis of nowMins passed to the scheduler', async () => {
    // 12:00 noon ET → 12*60 = 720 minutes.
    const fakeClock = new FakeClockAdapter({ startTime: '2026-07-01T12:00:00-04:00' });

    await createTask({
      text: 'Test task 2',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    const result = await runSchedulerWithClock(fakeClock);

    expect(result.timeInfo.todayKey).toBe('2026-07-01');
    expect(result.timeInfo.nowMins).toBe(12 * 60);
  });
});

/**
 * TS-315: Cache/timestamp facets are stamped from the injected clock's instant.
 * Domain: Clock / Cache / Placement Timestamps
 */
describe('TS-315: Cache timestamps honor the injected ClockPort', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: cache info is present and well-formed under an injected clock', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-07-01T12:00:00-04:00' });

    await createTask({
      text: 'Cache test task',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    await runSchedulerWithClock(fakeClock);
    const result = await runSchedulerWithClock(fakeClock);

    expect(result.cacheInfo).toBeDefined();
    expect(result.cacheInfo.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('SUB-315a: generatedAt is an ISO instant stamped from the fake clock', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-07-01T12:00:00-04:00' });

    await createTask({
      text: 'Cache skew task',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    const result = await runSchedulerWithClock(fakeClock);

    expect(result.cacheInfo.generatedAt).toContain('Z'); // ISO string
    // generatedAt reflects the fake clock instant (2026-07-01), not real "now".
    expect(result.cacheInfo.generatedAt).toContain('2026-07-01');
  });
});

/**
 * TS-316: The clock-wiring refactor described here is DONE. Kept as a living
 * contract record: getNowInTimezone takes an optional clock, the run command
 * carries it, and the test helper exercises the same seam.
 * Domain: Clock / Time-Travel / Contract
 */
describe('TS-316: Clock wiring contract (refactor complete)', () => {
  it('Contract: the production seam threads an injected clock', () => {
    const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');
    const fixed = new FakeClockAdapter({ startTime: '2026-07-01T12:00:00-04:00' });

    const real = getNowInTimezone('America/New_York', null);
    const faked = getNowInTimezone('America/New_York', fixed);

    // The seam accepts a clock and the clock changes the result.
    expect(faked.todayKey).toBe('2026-07-01');
    expect(typeof real.todayKey).toBe('string');
  });

  it('Contract: getNowInTimezone resolves nowMins in the target timezone', () => {
    const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');
    const fixed = new FakeClockAdapter({ startTime: '2026-07-01T12:00:00-04:00' });

    const faked = getNowInTimezone('America/New_York', fixed);
    expect(faked.nowMins).toBe(12 * 60);
  });
});

/**
 * TS-317: Time-travel validation — advancing the injected clock changes todayKey.
 * Domain: Clock / Time-Travel / Validation
 */
describe('TS-317: Time-travel via the wired clock', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: skipDays(1) changes todayKey', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T08:00:00-04:00' });

    await createTask({
      text: 'Clock skip test',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    let result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-15');

    fakeClock.skipDays(1);

    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-16');
  });

  it('SUB-317a: skipHours(6) advances nowMins but not todayKey', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T08:00:00-04:00' });

    await createTask({
      text: 'Clock hours test',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    let result = await runSchedulerWithClock(fakeClock);
    const firstNowMins = result.timeInfo.nowMins;

    fakeClock.skipHours(6);

    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-15'); // Same day (08:00 → 14:00)
    expect(result.timeInfo.nowMins).toBe(firstNowMins + 360); // 6 hours later
  });

  it('SUB-317b: skipDays(-1) goes back to yesterday', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T08:00:00-04:00' });

    await createTask({
      text: 'Clock backward test',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    let result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-15');

    fakeClock.skipDays(-1);

    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-14');
  });

  it('SUB-317c: weather facet aligns with the adapted clock todayKey', async () => {
    const fakeClock = new FakeClockAdapter({ startTime: '2026-06-15T08:00:00-04:00' });

    await createTask({
      text: 'Weather clock test',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      weatherPrecip: 'dry_only'
    });

    const result = await runSchedulerWithClock(fakeClock);

    expect(result.weatherInfo).toBeDefined();
    expect(result.weatherInfo.todayKey).toBe('2026-06-15');
  });
});
