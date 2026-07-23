'use strict';

/**
 * 999.2355 — CONFIRMED BUG, BANKED (skipped). UNSKIP to drive the fix.
 *
 * A weather-constrained ROLLING recurring task that is overdue (stranded
 * past-due instance) forward-rolls its instance date to TODAY correctly, but
 * the weather gate then REJECTS placement even when the forecast for today IS
 * within constraints — leaving unplaced_reason='weather', scheduled_at=null.
 *
 * PROVEN (this test, run 2026-07-23 against test-bed 3407):
 *   post-run instance = { date:'2026-07-23'(TODAY), scheduled_at:null,
 *                         status:'', unplaced_reason:'weather' }
 *   with injected GOOD weather for TODAY (precipProb 0, temp 70, humidity 40).
 *   weatherOk(task, TODAY, 780, goodMap) === true (unit-verified) — so the good
 *   data is valid; it is simply not being consulted for the rolled instance.
 *
 * ROOT-CAUSE HYPOTHESIS: the placement weather check for a forward-rolled
 * overdue instance evaluates the STALE pre-roll date (the past date, which has
 * no forecast → weatherOk fail-closes, unifiedScheduleV2.js:1073) instead of the
 * forward-rolled date (today, where good weather exists). The forward-roll IIFE
 * (runSchedule.js:78) moves the instance's date, but the weather-check dateKey
 * lags. FIX = point the weather gate at the forward-rolled date.
 *
 * Diagnostic origin: the production "Cut Grass" master (rolling every 7 days,
 * weather dry_only/50-86F/humidity<=65) whose July-22 occurrence sat
 * unplaced_reason='weather'. Fabricated-weather diagnostic (David's idea)
 * distinguished this scheduler bug from a mere weather-data-freshness issue.
 *
 * SKIPPED so CI stays green; the assertion below is RED against current code.
 * Un-skip when implementing the 999.2355 fix — it must go GREEN.
 */

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const db = require('../../test-helpers/test-db');
const { createTask } = require('../../test-helpers/tasks');
const { runSchedulerWithWeather } = require('../../test-helpers/scheduler');
const { getNowInTimezone } = require('../../../shared/scheduler/getNowInTimezone');

const TZ = 'America/New_York';
const { todayKey: TODAY } = getNowInTimezone(TZ);

// UTC-safe date arithmetic (juggler-datestrings-newdate-misparse-trap).
function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const PAST_3 = addDays(TODAY, -3);   // stranded past-due date (cycle every:7 NOT ended)
const ANCHOR = addDays(TODAY, -30);  // rolling anchor, old enough that no in-horizon occ is emitted

// Good weather within Cut Grass constraints (dry, 70F, 40% humidity, near-clear),
// every hour, for today + the whole current cycle window.
function goodWeatherFor(dateKeys) {
  const hours = {};
  for (let h = 0; h < 24; h++) hours[h] = { precipProb: 0, cloudcover: 10, temp: 70, humidity: 40 };
  const map = {};
  dateKeys.forEach((dk) => { map[dk] = hours; });
  return map;
}

// SKIPPED: banked confirmed-bug repro (RED against current code). Un-skip to drive the 999.2355 fix.
describe.skip('999.2355 — weather-constrained rolling past-due: forward-roll + placement under GOOD weather', () => {
  let master, instance;

  beforeAll(async () => {
    await setupTestDB();
    master = await createTask({
      text: 'Cut Grass',
      dur: 30,
      pri: 'P2',
      recurring: true,
      recur: { type: 'rolling', unit: 'days', every: 7, timesPerCycle: 1 },
      recurStart: ANCHOR,
      nextStart: ANCHOR,
      placementMode: 'anytime',
      dayReq: 'any'
    });
    // Apply the real Cut Grass weather constraints directly (robust regardless of
    // whether createTask maps weather_* fields).
    await db('task_masters').where({ id: master.id }).update({
      weather_precip: 'dry_only',
      weather_cloud: 'any',
      weather_temp_min: 50,
      weather_temp_max: 86,
      weather_humidity_max: 65
    });
    // Stranded past-due active instance (has scheduled_at so the persist-loop guard fires).
    instance = await createTask({
      master_id: master.id,
      date: PAST_3,
      scheduled_at: PAST_3 + 'T17:00:00Z',
      status: ''
    });
    const weather = goodWeatherFor([
      TODAY, addDays(TODAY, 1), addDays(TODAY, 2), addDays(TODAY, 3), addDays(TODAY, 4)
    ]);
    await runSchedulerWithWeather(weather, { timezone: TZ });
  });
  afterAll(teardownTestDB);

  it('forward-rolls the stranded instance to today or later', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy();
    expect(inst.date >= TODAY).toBe(true);
  });

  it('PLACES it under good weather (scheduled_at at the rolled date, not unplaced-weather)', async () => {
    const inst = await db('task_instances').where({ id: instance.id }).first();
    expect(inst).toBeTruthy();
    // Core diagnostic: good weather → must NOT be weather-rejected.
    expect(inst.unplaced_reason == null || inst.unplaced_reason === '').toBe(true);
    // And it should carry a real placement at the rolled (today+) date.
    expect(inst.scheduled_at).toBeTruthy();
    expect(String(inst.scheduled_at).slice(0, 10) >= TODAY).toBe(true);
  });
});
