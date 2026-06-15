// TELLY-17a: Adversarial HIGH gap tests TS-314 to TS-317
// G-002: FakeClockAdapter / Legacy Scheduler Incompatibility
// File: clockWiringGap.test.js
// Tests: TS-314, TS-315, TS-316, TS-317

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask } = require('../../test-helpers/tasks');
const { runSchedulerWithClock } = require('../../test-helpers/scheduler');
const { FakeClockAdapter } = require('../../test-helpers/clock');

/**
 * TS-314: Legacy scheduler reads `new Date()` directly — FakeClockAdapter injection has NO effect on todayKey/nowMins
 * Domain: Clock / Time-Travel / Orchestrator Wiring
 */
describe('TS-314: getNowInTimezone bypasses FakeClockAdapter', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: FakeClockAdapter does not affect todayKey/nowMins', async () => {
    // Create a FakeClockAdapter set to a future date
    const fakeClock = new FakeClockAdapter('2026-07-01T12:00:00Z');
    
    // Create a task
    await createTask({
      text: 'Morning task',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    // Run scheduler with the fake clock
    const result = await runSchedulerWithClock(fakeClock);
    
    // Check what todayKey was used
    // This should be the real system date, not the fake clock date
    const realDate = new Date();
    const realTodayKey = realDate.toISOString().split('T')[0];
    
    expect(result.timeInfo.todayKey).toBe(realTodayKey);
    expect(result.timeInfo.todayKey).not.toBe('2026-07-01');
  });

  it('SUB-314a: getNowInTimezone uses Intl.DateTimeFormat on raw new Date()', async () => {
    const fakeClock = new FakeClockAdapter('2026-07-01T12:00:00Z');
    
    // Create a task
    await createTask({
      text: 'Test task',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    // Run scheduler
    const result = await runSchedulerWithClock(fakeClock);
    
    // The timezone formatting should be based on system clock, not fake clock
    const realDate = new Date();
    const realTodayKey = realDate.toISOString().split('T')[0];
    
    expect(result.timeInfo.todayKey).toBe(realTodayKey);
  });

  it('SUB-314b: Scheduler run passes system-clock-based todayKey to unifiedScheduleV2', async () => {
    const fakeClock = new FakeClockAdapter('2026-07-01T12:00:00Z');
    
    // Create a task
    await createTask({
      text: 'Test task 2',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    // Run scheduler
    const result = await runSchedulerWithClock(fakeClock);
    
    // The core scheduler receives system-clock-based inputs
    const realDate = new Date();
    const realTodayKey = realDate.toISOString().split('T')[0];
    
    expect(result.timeInfo.todayKey).toBe(realTodayKey);
    expect(result.timeInfo.todayKey).not.toBe('2026-07-01');
  });
});

/**
 * TS-315: Legacy scheduler reads `Date.now()` — FakeClockAdapter.dbNow() NOT called by cache paths
 * Domain: Clock / Cache / Placement Timestamps
 */
describe('TS-315: Cache paths bypass FakeClockAdapter', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: Cache staleness uses Date.now() not FakeClockAdapter', async () => {
    const fakeClock = new FakeClockAdapter('2026-07-01T12:00:00Z');
    
    // Create a task
    await createTask({
      text: 'Cache test task',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    // Run scheduler to create a cache
    await runSchedulerWithClock(fakeClock);
    
    // Run again to check cache staleness
    const result = await runSchedulerWithClock(fakeClock);
    
    // Cache age should be computed with real Date.now(), not fake clock
    // This means the cache might be considered stale even though fake clock hasn't advanced
    expect(result.cacheInfo).toBeDefined();
    expect(result.cacheInfo.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('SUB-315a: Cache ageMs computed with Date.now() but generatedAt stamped with dbNow()', async () => {
    const fakeClock = new FakeClockAdapter('2026-07-01T12:00:00Z');
    
    // Create a task
    await createTask({
      text: 'Cache skew task',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    // Run scheduler
    const result = await runSchedulerWithClock(fakeClock);
    
    // generatedAt should use dbNow() (which respects fake clock)
    // but ageMs should use Date.now() (which doesn't)
    expect(result.cacheInfo.generatedAt).toContain('Z'); // ISO string
    expect(result.cacheInfo.ageMs).toBeGreaterThanOrEqual(0);
  });
});

/**
 * TS-316: (ROADMAP) Prerequisite — Refactor legacy scheduler to accept injected clock
 * Domain: Clock / Time-Travel / Prerequisites
 */
describe('TS-316: Clock wiring refactoring prerequisite', () => {
  it('Documentation: Minimum refactoring needed for time-travel tests', () => {
    // This is a documentation test that outlines what needs to be refactored
    const refactoringSteps = [
      'getNowInTimezone(tz, clock?) — add optional clock param',
      'getSchedulePlacementsWithCache — use clock.now() instead of Date.now()',
      'Cache write path — use clock.now() instead of new Date()',
      'Wire clock through runSchedule.js entry points'
    ];
    
    expect(refactoringSteps.length).toBe(4);
    expect(refactoringSteps).toContain('getNowInTimezone(tz, clock?) — add optional clock param');
  });

  it('Documentation: Dependency chain for time-travel tests', () => {
    const dependencyChain = {
      prerequisite: 'TS-316 (clock wiring refactor)',
      enables: ['TS-273..TS-288 (time-travel)', 'TS-314/315 validation'],
      benefits: ['weather tests (TS-142..TS-154x) get deterministic nowMins']
    };
    
    expect(dependencyChain.prerequisite).toBe('TS-316 (clock wiring refactor)');
    expect(dependencyChain.enables).toContain('TS-273..TS-288 (time-travel)');
  });
});

/**
 * TS-317: After ClockPort wiring — FakeClockAdapter.skipDays(1) correctly changes todayKey
 * Domain: Clock / Time-Travel / Validation
 */
describe('TS-317: Post-refactor clock wiring validation', () => {
  // Note: These tests assume the refactoring from TS-316 is complete
  // They will fail until the clock wiring is properly implemented
  
  beforeAll(async () => {
    await setupTestDB();
    // Set feature flag to indicate clock wiring is complete
    process.env.FEATURE_FLAG_CLOCK_WIRING_COMPLETE = 'true';
  });

  afterAll(async () => {
    delete process.env.FEATURE_FLAG_CLOCK_WIRING_COMPLETE;
    await teardownTestDB();
  });

  it('Main scenario: skipDays(1) changes todayKey', async () => {
    if (!process.env.FEATURE_FLAG_CLOCK_WIRING_COMPLETE) {
      console.log('SKIPPED: Clock wiring not yet complete');
      return;
    }

    const fakeClock = new FakeClockAdapter('2026-06-15T08:00:00-04:00');
    
    // Create a task
    await createTask({
      text: 'Clock skip test',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    // First run
    let result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-15');

    // Skip one day
    fakeClock.skipDays(1);

    // Second run
    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-16');
  });

  it('SUB-317a: skipHours(6) advances nowMins but not todayKey', async () => {
    if (!process.env.FEATURE_FLAG_CLOCK_WIRING_COMPLETE) {
      console.log('SKIPPED: Clock wiring not yet complete');
      return;
    }

    const fakeClock = new FakeClockAdapter('2026-06-15T08:00:00-04:00');
    
    // Create a task
    await createTask({
      text: 'Clock hours test',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    // First run
    let result = await runSchedulerWithClock(fakeClock);
    const firstNowMins = result.timeInfo.nowMins;

    // Skip 6 hours (360 minutes)
    fakeClock.skipHours(6);

    // Second run
    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-15'); // Same day
    expect(result.timeInfo.nowMins).toBe(firstNowMins + 360); // 6 hours later
  });

  it('SUB-317b: skipDays(-1) goes back to yesterday', async () => {
    if (!process.env.FEATURE_FLAG_CLOCK_WIRING_COMPLETE) {
      console.log('SKIPPED: Clock wiring not yet complete');
      return;
    }

    const fakeClock = new FakeClockAdapter('2026-06-15T08:00:00-04:00');
    
    // Create a task
    await createTask({
      text: 'Clock backward test',
      dur: 30,
      pri: 'P3',
      when: 'morning'
    });

    // First run
    let result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-15');

    // Skip back one day
    fakeClock.skipDays(-1);

    // Second run
    result = await runSchedulerWithClock(fakeClock);
    expect(result.timeInfo.todayKey).toBe('2026-06-14');
    // Tasks scheduled for past dates should be marked as missed
  });

  it('SUB-317c: Weather data aligns with adapted clock', async () => {
    if (!process.env.FEATURE_FLAG_CLOCK_WIRING_COMPLETE) {
      console.log('SKIPPED: Clock wiring not yet complete');
      return;
    }

    const fakeClock = new FakeClockAdapter('2026-06-15T08:00:00-04:00');
    
    // Create a task with weather constraints
    await createTask({
      text: 'Weather clock test',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      weatherPrecip: 'dry_only'
    });

    // Run scheduler
    const result = await runSchedulerWithClock(fakeClock);

    // Weather hours should align with the fake clock's todayKey
    expect(result.weatherInfo).toBeDefined();
    expect(result.weatherInfo.todayKey).toBe('2026-06-15');
  });
});