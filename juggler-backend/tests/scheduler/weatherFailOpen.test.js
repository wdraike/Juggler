// TELLY-17a → updated for R38 CC6 (999.546): Weather per-hour FAIL-CLOSED.
// File: weatherFailOpen.test.js
// Tests: TS-318, TS-319
//
// HISTORY: these were adversarial tests written to DOCUMENT a hour-level
// partial FAIL-OPEN vulnerability (G-003) — a weather-constrained task could be
// silently placed in an hour whose forecast was MISSING. That hole was CLOSED:
// `unifiedScheduleV2.weatherOk` now FAILS CLOSED per the documented rule
// (R38 CC6 / 999.546, unifiedScheduleV2.js): a weather-constrained task MUST NOT
// be placed when the weather data needed to satisfy its constraint is absent —
// neither when the whole DATE is missing, nor when the specific HOUR record is
// missing. These tests now PIN that fail-closed contract (was: asserted the
// fail-open vulnerability). The full empty-cache fail-open case (BUG-2) is
// covered elsewhere; here we assert the per-hour boundary.
//
// Deterministic by construction: we drive the in-memory scheduler
// (unifiedScheduleV2) with an explicit todayKey/nowMins and a date-matched
// weatherByDateHour map (the same pattern schedulerSupplyDemand uses), and we
// unit-test `weatherOk` directly. No reliance on the wall clock.

const { describe, it, expect } = require('@jest/globals');
const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

const weatherOk = unifiedSchedule._testOnly.weatherOk;

const DATE = '2026-06-15';
const baseCfg = {
  timeBlocks: DEFAULT_TIME_BLOCKS,
  toolMatrix: DEFAULT_TOOL_MATRIX,
  timezone: 'America/New_York',
};

function makeWeatherTask(over) {
  return Object.assign(
    { id: 't1', user_id: 1, text: 'weather task', dur: 30, pri: 'P1', when: 'biz', date: DATE, recurring: false },
    over
  );
}

// Run the in-memory scheduler with date-matched weather. nowMins=0 keeps the
// whole day in the future so placement is governed purely by weather eligibility.
function runWithWeather(task, weatherByDateHour, nowMins) {
  const cfg = Object.assign({}, baseCfg, { weatherByDateHour: weatherByDateHour });
  const result = unifiedSchedule([task], { [task.id]: '' }, DATE, nowMins == null ? 0 : nowMins, cfg);
  let placed = null;
  for (const dk in result.dayPlacements) {
    for (const p of result.dayPlacements[dk]) {
      if (p.task && p.task.id === task.id) { placed = { dateKey: dk, start: p.start, hour: Math.floor(p.start / 60) }; }
    }
  }
  return { placed: placed, unplaced: result.unplaced };
}

/**
 * TS-318: weatherByDateHour[dateKey] exists but [dateKey][hour] is missing for
 * some hours → the missing hour is FAIL-CLOSED (ineligible), not fail-open.
 */
describe('TS-318: Partial hour data — missing hours FAIL CLOSED (per-hour, R38 CC6)', () => {
  it('Main scenario: a dry_only task is NEVER placed in a missing-data hour', () => {
    // Hours 8-11 wet (90%), 12 dry, 13 MISSING, 14 dry.
    const weatherData = {
      [DATE]: {
        8:  { precipProb: 90 }, 9: { precipProb: 90 }, 10: { precipProb: 90 }, 11: { precipProb: 90 },
        12: { precipProb: 5 },
        // hour 13 intentionally absent
        14: { precipProb: 5 },
      },
    };
    const task = makeWeatherTask({ when: 'biz', dur: 30, weatherPrecip: 'dry_only' });

    const { placed } = runWithWeather(task, weatherData);

    // It must land somewhere with satisfying data — and ONLY in a dry hour.
    expect(placed).not.toBeNull();
    // NEVER in a wet hour (fail-closed on constraint) ...
    expect([8, 9, 10, 11]).not.toContain(placed.hour);
    // ... and NEVER in the missing-data hour (fail-CLOSED on absence).
    expect(placed.hour).not.toBe(13);
    // The only eligible hours are 12 and 14.
    expect([12, 14]).toContain(placed.hour);
  });

  it('SUB-318a: weatherOk() returns false for a constrained task when the hour record is missing', () => {
    const weatherData = { [DATE]: { 8: { precipProb: 5 }, /* 9 missing */ 10: { precipProb: 5 } } };
    const task = makeWeatherTask({ weatherPrecip: 'dry_only' });

    expect(weatherOk(task, DATE, 8 * 60, weatherData)).toBe(true);   // dry, present
    expect(weatherOk(task, DATE, 9 * 60, weatherData)).toBe(false);  // MISSING hour → fail-closed
    expect(weatherOk(task, DATE, 10 * 60, weatherData)).toBe(true);  // dry, present
  });

  it('SUB-318b: when the only dry hour goes missing on a re-run, the task moves to the next dry hour', () => {
    const task = makeWeatherTask({ when: 'biz', dur: 30, weatherPrecip: 'dry_only' });

    // Run 1: hours 8-14 wet, 15 MISSING, 16 dry → must pick 16 (15 is fail-closed, not chosen).
    // (Hours kept within the biz block 480-1020 so a 30-min slot actually fits.)
    const wx1 = {
      [DATE]: {
        8: { precipProb: 90 }, 9: { precipProb: 90 }, 10: { precipProb: 90 }, 11: { precipProb: 90 },
        12: { precipProb: 90 }, 13: { precipProb: 90 }, 14: { precipProb: 90 },
        // hour 15 missing
        16: { precipProb: 5 },
      },
    };
    const r1 = runWithWeather(task, wx1);
    expect(r1.placed).not.toBeNull();
    expect(r1.placed.hour).not.toBe(15); // missing hour is fail-closed, never chosen
    expect(r1.placed.hour).toBe(16);

    // Run 2: complete data, 15 now wet, 16 still dry → stays at 16.
    const wx2 = {
      [DATE]: {
        8: { precipProb: 90 }, 9: { precipProb: 90 }, 10: { precipProb: 90 }, 11: { precipProb: 90 },
        12: { precipProb: 90 }, 13: { precipProb: 90 }, 14: { precipProb: 90 },
        15: { precipProb: 100 }, 16: { precipProb: 5 },
      },
    };
    const r2 = runWithWeather(task, wx2);
    expect(r2.placed).not.toBeNull();
    expect(r2.placed.hour).toBe(16);
  });

  it('SUB-318c: a present hour with a null SUB-field (temp) skips only that sub-constraint (not whole-hour fail-closed)', () => {
    // weatherOk fails CLOSED only when the whole hour record is absent. When the
    // record EXISTS but a single field (temp) is null, the temp sub-check is
    // skipped (`if (temp != null)`) — the hour is still eligible on its other
    // satisfied constraints. This is the documented field-vs-record distinction.
    const weatherData = {
      [DATE]: {
        8:  { precipProb: 90, temp: 72 },     // wet → ineligible
        9:  { precipProb: 5,  temp: null },   // dry, temp unknown → temp check skipped → eligible
      },
    };
    const task = makeWeatherTask({ when: 'biz', dur: 30, weatherPrecip: 'dry_only', weatherTempMin: 70, weatherTempMax: 75 });

    // Record present, temp null → only the precip constraint binds → true.
    expect(weatherOk(task, DATE, 9 * 60, weatherData)).toBe(true);
    // Record present, wet → precip constraint fails → false.
    expect(weatherOk(task, DATE, 8 * 60, weatherData)).toBe(false);
    // Whole record absent → fail-closed regardless of fields.
    expect(weatherOk(task, DATE, 10 * 60, weatherData)).toBe(false);
  });
});

/**
 * TS-319: When the forecast for the whole scheduling DATE is absent, a
 * weather-constrained task cannot be placed at all (fail-closed) — it is
 * surfaced as unplaced, never silently dropped into an unknown-weather slot.
 */
describe('TS-319: Whole-date absence FAILS CLOSED — constrained task stays visible, never silently placed', () => {
  it('Main scenario: no forecast for the date → task is unplaced (not placed in an unknown hour)', () => {
    const task = makeWeatherTask({ when: 'biz', dur: 30, weatherPrecip: 'dry_only' });
    // Weather map has data only for an UNRELATED date — the scheduling date is absent.
    const weatherData = { '2099-01-01': { 8: { precipProb: 5 } } };

    const { placed, unplaced } = runWithWeather(task, weatherData);

    // Fail-closed: no satisfying hour exists, so it is NOT placed anywhere.
    expect(placed).toBeNull();
    // It stays VISIBLE as unplaced (never-missing) rather than silently placed.
    const u = unplaced.find((t) => t.id === task.id);
    expect(u).toBeDefined();
  });

  it('SUB-319a: weatherOk() fails closed when the whole date is missing', () => {
    const task = makeWeatherTask({ weatherPrecip: 'dry_only' });
    const weatherData = { '2099-01-01': { 8: { precipProb: 5 } } };
    expect(weatherOk(task, DATE, 8 * 60, weatherData)).toBe(false);
    // Also when the map is entirely empty / undefined.
    expect(weatherOk(task, DATE, 8 * 60, {})).toBe(false);
    expect(weatherOk(task, DATE, 8 * 60, undefined)).toBe(false);
  });

  it('SUB-319b: an unconstrained task is unaffected by missing weather (no constraint → always ok)', () => {
    const task = makeWeatherTask({ when: 'biz', dur: 30, weatherPrecip: 'any' });
    // No weather data at all.
    expect(weatherOk(task, DATE, 8 * 60, {})).toBe(true);
    const { placed } = runWithWeather(task, {});
    expect(placed).not.toBeNull(); // placed normally — weather gate is a no-op
  });

  it('SUB-319c: cloud-cover constraint also fails closed on a missing hour record', () => {
    const weatherData = {
      [DATE]: {
        8:  { precipProb: 5, cloudcover: 100 }, // overcast → ineligible for clear
        // hour 9 missing
        10: { precipProb: 5, cloudcover: 10 },  // clear → eligible
      },
    };
    const task = makeWeatherTask({ weatherCloud: 'clear' });
    expect(weatherOk(task, DATE, 8 * 60, weatherData)).toBe(false);  // overcast
    expect(weatherOk(task, DATE, 9 * 60, weatherData)).toBe(false);  // MISSING → fail-closed
    expect(weatherOk(task, DATE, 10 * 60, weatherData)).toBe(true);  // clear
  });
});
