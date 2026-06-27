/**
 * Covers: AC-881-2 — temperature ceiling honored (regression lock)
 * Layer: unit — pure function, no DB, no network, no wall-clock.
 * Leg: juggler-sweep-overdue
 *
 * Locks the weatherOk / weatherTempMax contract so a future wiring break is caught:
 *   - a slot whose forecast hour temp > task.weatherTempMax is rejected (returns false)
 *   - a slot whose forecast hour temp <= task.weatherTempMax is accepted (returns true)
 *   - a task with weatherTempMax=null has no ceiling constraint → weatherOk returns true
 *     regardless of temp (fails open / passes through — unchanged behaviour)
 *
 * weatherOk is exported under module.exports._testOnly (unifiedScheduleV2.js:2439-2445).
 * The tests are expected to be GREEN on current code (no code defect — AC-881-2 note in SPEC).
 * If a future refactor removes the _testOnly export this suite will turn RED (intended).
 *
 * Traceability: AC-881-2 row in TRACEABILITY.md
 */

'use strict';

process.env.NODE_ENV = 'test';

// weatherOk is a pure function exported under _testOnly — no side effects.
const { weatherOk } = require('../../../src/scheduler/unifiedScheduleV2')._testOnly;

// Convenience: a minimal weather-data object for dateKey '2026-06-26', hour 13 (startMin=780).
function makeWeather(temp) {
  return {
    '2026-06-26': {
      13: { temp, precipProb: 0, cloudcover: 0 }
    }
  };
}

describe('weatherOk — temperature ceiling (AC-881-2)', () => {

  const DATE_KEY  = '2026-06-26';
  const START_MIN = 780; // 13:00 local = hour 13

  // ── Ceiling enforced ────────────────────────────────────────────────────────
  // task.weatherTempMax=25, forecast temp=30 → 30 > 25 ceiling → rejected
  test('temp(30) > weatherTempMax(25) → weatherOk returns FALSE (ceiling honored)', () => {
    const task = { weatherTempMax: 25 };
    const result = weatherOk(task, DATE_KEY, START_MIN, makeWeather(30));
    expect(result).toBe(false);
  });

  // ── Ceiling not exceeded ─────────────────────────────────────────────────────
  // task.weatherTempMax=25, forecast temp=20 → 20 <= 25 → accepted
  test('temp(20) <= weatherTempMax(25) → weatherOk returns TRUE (under ceiling)', () => {
    const task = { weatherTempMax: 25 };
    const result = weatherOk(task, DATE_KEY, START_MIN, makeWeather(20));
    expect(result).toBe(true);
  });

  // ── No ceiling (null) → fails open ──────────────────────────────────────────
  // task.weatherTempMax=null → hasWeatherConstraint returns false → no check at all → true
  test('weatherTempMax=null (no ceiling) → weatherOk returns TRUE regardless of temp', () => {
    const task = { weatherTempMax: null };
    // temp=30 but no ceiling constraint → should not be rejected
    const result = weatherOk(task, DATE_KEY, START_MIN, makeWeather(30));
    expect(result).toBe(true);
  });

});
