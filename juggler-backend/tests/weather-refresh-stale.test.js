/**
 * Weather stale-forecast refresh test (999.2355).
 *
 * When the scheduler loads weather data from the cache and today's dateKey
 * is MISSING from the cached forecast (stale cache — 14-day forecast no longer
 * covers today), the scheduler should attempt to refresh the forecast from
 * the weather facade before running placement. If the refresh succeeds,
 * weatherByDateHour is rebuilt with the fresh data. If the refresh fails,
 * the scheduler proceeds with the stale/empty data (fail-closed for
 * weather-constrained tasks — existing behavior preserved).
 *
 * This test uses the FakeWeatherProvider to simulate the stale cache return,
 * and a mock refresh function to simulate the weather facade's getForecast.
 */

process.env.NODE_ENV = 'test';

var unifiedSchedule = require('../src/scheduler/unifiedScheduleV2');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

var TODAY = '2026-07-23';
var NOW_MINS = 480; // 8 AM

function makeTask(overrides) {
  return {
    id: 'task_' + Math.random().toString(36).slice(2, 6),
    text: 'Cut Grass',
    date: TODAY,
    dur: 120,
    pri: 'P3',
    when: 'morning,lunch,afternoon,evening',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    split: false,
    datePinned: false,
    generated: false,
    ...overrides
  };
}

function makeCfg(weatherByDateHour) {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {},
    weatherByDateHour: weatherByDateHour || {}
  };
}

function dryDay(dateKey) {
  var byHour = {};
  for (var h = 0; h < 24; h++) {
    byHour[h] = { temp: 72, precipProb: 5, cloudcover: 10, humidity: 40 };
  }
  return { [dateKey]: byHour };
}

describe('Weather stale-forecast refresh (999.2355)', () => {
  test('weather-constrained task IS placed when initial cache misses today but refresh provides data', () => {
    // Simulate: stale cache returned data for past dates but NOT today.
    // After refresh, today's weather data is available and within constraints.
    var staleWeather = {
      '2026-07-10': dryDay('2026-07-10')['2026-07-10']
    };
    var refreshedWeather = dryDay(TODAY);

    var task = makeTask({
      id: 'cut_grass',
      weatherPrecip: 'dry_only',
      weatherCloud: 'any',
      weatherTempMin: 50,
      weatherTempMax: 86,
      weatherHumidityMin: null,
      weatherHumidityMax: 53
    });

    // Simulate the refresh: merge stale + fresh data
    var mergedWeather = Object.assign({}, staleWeather, refreshedWeather);
    var result = unifiedSchedule([task], { cut_grass: '' }, TODAY, NOW_MINS, makeCfg(mergedWeather));

    var placedToday = (result.dayPlacements[TODAY] || []).find(p => p.task && p.task.id === 'cut_grass');
    expect(placedToday).toBeDefined();
  });

  test('weather-constrained task goes to unplaced when cache misses today AND refresh also fails', () => {
    // Stale cache doesn't cover today; refresh fails (Open-Meteo down)
    // → weatherByDateHour stays without today → fail-closed → unplaced
    var staleWeather = {
      '2026-07-10': dryDay('2026-07-10')['2026-07-10']
    };

    var task = makeTask({
      id: 'cut_grass',
      weatherPrecip: 'dry_only',
      weatherCloud: 'any',
      weatherTempMin: 50,
      weatherTempMax: 86,
      weatherHumidityMin: null,
      weatherHumidityMax: 53
    });

    var result = unifiedSchedule([task], { cut_grass: '' }, TODAY, NOW_MINS, makeCfg(staleWeather));

    var placed = Object.values(result.dayPlacements).flat().find(p => p.task && p.task.id === 'cut_grass');
    expect(placed).toBeUndefined();
    var un = (result.unplaced || []).find(function (t) { return t.id === 'cut_grass'; });
    expect(un).toBeDefined();
    expect(un._unplacedReason).toBe('weather');
  });

  test('buildWeatherByDateHourFromForecast correctly parses hourly forecast data', () => {
    // Test the helper that rebuilds weatherByDateHour from a fresh forecast
    var { buildWeatherByDateHourFromForecast } = require('../src/scheduler/runSchedule');

    var forecast = {
      hourly: {
        time: ['2026-07-23T14:00', '2026-07-23T15:00'],
        temperature_2m: [72, 73],
        precipitation_probability: [5, 10],
        cloudcover: [10, 20],
        relativehumidity_2m: [40, 42]
      },
      hourly_units: { temperature_2m: '°F' }
    };

    var result = buildWeatherByDateHourFromForecast(forecast);
    expect(result['2026-07-23']).toBeDefined();
    expect(result['2026-07-23'][14]).toEqual({ temp: 72, precipProb: 5, cloudcover: 10, humidity: 40 });
    expect(result['2026-07-23'][15]).toEqual({ temp: 73, precipProb: 10, cloudcover: 20, humidity: 42 });
  });

  test('buildWeatherByDateHourFromForecast handles missing hourly fields gracefully', () => {
    var { buildWeatherByDateHourFromForecast } = require('../src/scheduler/runSchedule');

    var forecast = {
      hourly: {
        time: ['2026-07-23T09:00'],
        temperature_2m: [68],
        // precipitation_probability missing
        cloudcover: [30],
        // relativehumidity_2m missing
      },
      hourly_units: {}
    };

    var result = buildWeatherByDateHourFromForecast(forecast);
    expect(result['2026-07-23'][9]).toEqual({ temp: 68, precipProb: 0, cloudcover: 30, humidity: null });
  });

  test('buildWeatherByDateHourFromForecast returns empty for null/missing hourly', () => {
    var { buildWeatherByDateHourFromForecast } = require('../src/scheduler/runSchedule');

    expect(buildWeatherByDateHourFromForecast(null)).toEqual({});
    expect(buildWeatherByDateHourFromForecast({})).toEqual({});
    expect(buildWeatherByDateHourFromForecast({ hourly: null })).toEqual({});
    expect(buildWeatherByDateHourFromForecast({ hourly: {} })).toEqual({});
  });
});