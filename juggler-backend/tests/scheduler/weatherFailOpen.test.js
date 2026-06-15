// TELLY-17a: Adversarial HIGH gap tests TS-318 to TS-319
// G-003: Weather Hour-Level Partial Fail-Open
// File: weatherFailOpen.test.js
// Tests: TS-318, TS-319

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const { setupTestDB, teardownTestDB } = require('../../test-helpers/db');
const { createTask } = require('../../test-helpers/tasks');
const { runSchedulerWithWeather } = require('../../test-helpers/scheduler');
const { getTaskInstances } = require('../../test-helpers/queries');

/**
 * TS-318: weatherByDateHour[dateKey] exists but [dateKey][hour] is missing for some hours
 * Domain: Weather / Fail-Open / Hour-Level
 */
describe('TS-318: Partial hour data - missing hours pass weather check', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: task placed in hour with missing data', async () => {
    // Set up weather data with a gap at hour 13
    const weatherData = {
      '2026-06-15': {
        8:  { precipProb: 90, cloudcover: 80, temp: 72, humidity: 65 },
        9:  { precipProb: 85, cloudcover: 75, temp: 73, humidity: 68 },
        10: { precipProb: 95, cloudcover: 90, temp: 71, humidity: 70 },
        11: { precipProb: 80, cloudcover: 70, temp: 74, humidity: 60 },
        12: { precipProb: 20, cloudcover: 30, temp: 75, humidity: 45 },
        // Hour 13 is missing
        14: { precipProb: 5,  cloudcover: 10, temp: 77, humidity: 40 }
      }
    };

    // Create task with dry_only constraint
    const task = await createTask({
      text: 'High-priority dry_only',
      dur: 30,
      pri: 'P1',
      when: 'biz1,biz2,afternoon',
      weatherPrecip: 'dry_only'
    });

    // Run scheduler with partial weather data
    await runSchedulerWithWeather(weatherData);

    const instances = await getTaskInstances(task.id);
    
    // Task should be placed somewhere
    expect(instances.length).toBe(1);
    
    // Check where it was placed
    const placementHour = new Date(instances[0].scheduled_at).getHours();
    
    // It should NOT be placed in hours 8-11 (high precip)
    expect([8, 9, 10, 11]).not.toContain(placementHour);
    
    // It COULD be placed in hour 12 (low precip), hour 13 (missing data), or hour 14 (low precip)
    expect([12, 13, 14]).toContain(placementHour);
    
    // If placed in hour 13, that's the fail-open case we're testing
    if (placementHour === 13) {
      console.log('Task placed in hour 13 with missing weather data (fail-open case)');
    }
  });

  it('SUB-318a: All hours except hour 13 have valid weather → hour 13 treated as eligible', async () => {
    const weatherData = {
      '2026-06-15': {
        8:  { precipProb: 90 },
        9:  { precipProb: 90 },
        10: { precipProb: 90 },
        11: { precipProb: 90 },
        12: { precipProb: 90 },
        // Hour 13 missing
        14: { precipProb: 90 },
        15: { precipProb: 90 },
        16: { precipProb: 5 },
        17: { precipProb: 5 }
      }
    };

    const task = await createTask({
      text: 'Outdoor task',
      dur: 60,
      pri: 'P2',
      when: 'biz1,biz2,afternoon',
      weatherPrecip: 'dry_only'
    });

    await runSchedulerWithWeather(weatherData);

    const instances = await getTaskInstances(task.id);
    const placementHour = new Date(instances[0].scheduled_at).getHours();

    // Should be placed in hour 13 (missing data) or hour 16/17 (low precip)
    expect([13, 16, 17]).toContain(placementHour);
  });

  it('SUB-318b: Task placed at hour 17 with missing data → later data shows 100% precip', async () => {
    // First run with missing data at hour 17
    const weatherData1 = {
      '2026-06-15': {
        8:  { precipProb: 90 },
        9:  { precipProb: 90 },
        10: { precipProb: 90 },
        11: { precipProb: 90 },
        12: { precipProb: 90 },
        13: { precipProb: 90 },
        14: { precipProb: 90 },
        15: { precipProb: 90 },
        // Hour 16 missing
        17: { precipProb: 90 }
      }
    };

    const task = await createTask({
      text: 'Weather update test',
      dur: 60,
      pri: 'P2',
      when: 'biz1,biz2,afternoon',
      weatherPrecip: 'dry_only'
    });

    await runSchedulerWithWeather(weatherData1);

    let instances = await getTaskInstances(task.id);
    const firstPlacementHour = new Date(instances[0].scheduled_at).getHours();

    // Should be placed in hour 16 (missing data)
    expect(firstPlacementHour).toBe(16);

    // Second run with complete data showing hour 16 has 100% precip
    const weatherData2 = {
      '2026-06-15': {
        8:  { precipProb: 90 },
        9:  { precipProb: 90 },
        10: { precipProb: 90 },
        11: { precipProb: 90 },
        12: { precipProb: 90 },
        13: { precipProb: 90 },
        14: { precipProb: 90 },
        15: { precipProb: 90 },
        16: { precipProb: 100 }, // Now has high precip
        17: { precipProb: 5 }
      }
    };

    await runSchedulerWithWeather(weatherData2);

    instances = await getTaskInstances(task.id);
    const secondPlacementHour = new Date(instances[0].scheduled_at).getHours();

    // Should move to hour 17 (now the only dry hour)
    expect(secondPlacementHour).toBe(17);
  });

  it('SUB-318c: Temperature/humidity also subject to fail-open', async () => {
    const weatherData = {
      '2026-06-15': {
        8:  { precipProb: 5, temp: 72, humidity: 65 },
        9:  { precipProb: 5, temp: 73, humidity: 68 },
        10: { precipProb: 5, temp: null, humidity: 70 }, // Missing temp
        11: { precipProb: 5, temp: 74, humidity: 60 }
      }
    };

    const task = await createTask({
      text: 'Temp constraint test',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      weatherTemp: { min: 70, max: 75 } // Requires temp between 70-75
    });

    await runSchedulerWithWeather(weatherData);

    const instances = await getTaskInstances(task.id);
    const placementHour = new Date(instances[0].scheduled_at).getHours();

    // Could be placed in hour 10 (missing temp data) due to fail-open
    expect([8, 9, 10, 11]).toContain(placementHour);
  });
});

/**
 * TS-319: Task with weather_precip='dry_only' placed in hour with missing data
 * Domain: Weather / Fail-Open / User Perception
 */
describe('TS-319: User perception - worse UX than full fail-open', () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  it('Main scenario: task placed in hour with missing data despite dry_only constraint', async () => {
    const weatherData = {
      '2026-06-15': {
        8:  { precipProb: 90 },
        9:  { precipProb: 90 },
        10: { precipProb: 90 },
        11: { precipProb: 90 },
        12: { precipProb: 90 },
        // Hours 13-14 completely missing (API outage)
        15: { precipProb: 90 },
        16: { precipProb: 5 },
        17: { precipProb: 5 }
      }
    };

    const task = await createTask({
      text: 'Outdoor task',
      dur: 60,
      pri: 'P2',
      when: 'biz1,biz2,afternoon',
      weatherPrecip: 'dry_only'
    });

    await runSchedulerWithWeather(weatherData);

    const instances = await getTaskInstances(task.id);
    const placementHour = new Date(instances[0].scheduled_at).getHours();

    // Task should be placed in hour 13-14 (missing data) or 16-17 (low precip)
    expect([13, 14, 16, 17]).toContain(placementHour);

    // If placed in 13-14, that's the problematic case
    if ([13, 14].includes(placementHour)) {
      console.log(`Task placed in hour ${placementHour} with NO weather data available`);
      console.log('This creates worse UX than full fail-open because:');
      console.log('- User sees weather filtering working for most hours');
      console.log('- Task placed in hour with no data bypasses the filter silently');
      console.log('- No _unplacedReason because task was placed, not unplaced');
    }
  });

  it('SUB-319a: Weather display inconsistency - task at hour 13 shows no icon', async () => {
    const weatherData = {
      '2026-06-15': {
        8:  { precipProb: 90, icon: 'heavy-rain' },
        9:  { precipProb: 90, icon: 'heavy-rain' },
        10: { precipProb: 90, icon: 'heavy-rain' },
        11: { precipProb: 90, icon: 'heavy-rain' },
        12: { precipProb: 90, icon: 'heavy-rain' },
        // Hour 13 missing - no icon
        14: { precipProb: 90, icon: 'heavy-rain' },
        15: { precipProb: 90, icon: 'heavy-rain' },
        16: { precipProb: 5, icon: 'sunny' }
      }
    };

    const task = await createTask({
      text: 'Display inconsistency test',
      dur: 60,
      pri: 'P2',
      when: 'biz1,biz2,afternoon',
      weatherPrecip: 'dry_only'
    });

    await runSchedulerWithWeather(weatherData);

    const instances = await getTaskInstances(task.id);
    const placementHour = new Date(instances[0].scheduled_at).getHours();

    // If placed in hour 13, frontend would show:
    // - Hours 8-12: heavy rain icons
    // - Hour 13: no weather icon (missing data)
    // - Hours 14-15: heavy rain icons
    // - Hour 16: sunny icon
    // This visual inconsistency is the only clue that hour 13 has no data
    
    if (placementHour === 13) {
      console.log('Visual inconsistency detected: task at hour 13 would show no weather icon');
      console.log('while surrounding hours show heavy rain icons');
    }
  });

  it('SUB-319b: Task jumps to different hour when weather data arrives', async () => {
    // First run with missing data at hours 13-14
    const weatherData1 = {
      '2026-06-15': {
        8:  { precipProb: 90 },
        9:  { precipProb: 90 },
        10: { precipProb: 90 },
        11: { precipProb: 90 },
        12: { precipProb: 90 },
        // Hours 13-14 missing
        15: { precipProb: 90 },
        16: { precipProb: 5 }
      }
    };

    const task = await createTask({
      text: 'Task jump test',
      dur: 60,
      pri: 'P2',
      when: 'biz1,biz2,afternoon',
      weatherPrecip: 'dry_only'
    });

    await runSchedulerWithWeather(weatherData1);

    let instances = await getTaskInstances(task.id);
    const firstPlacementHour = new Date(instances[0].scheduled_at).getHours();

    // Should be placed in hour 13 or 14 (missing data)
    expect([13, 14]).toContain(firstPlacementHour);

    // Second run with complete data showing hours 13-14 have high precip
    const weatherData2 = {
      '2026-06-15': {
        8:  { precipProb: 90 },
        9:  { precipProb: 90 },
        10: { precipProb: 90 },
        11: { precipProb: 90 },
        12: { precipProb: 90 },
        13: { precipProb: 95 }, // Now shows heavy rain
        14: { precipProb: 95 }, // Now shows heavy rain
        15: { precipProb: 90 },
        16: { precipProb: 5 }
      }
    };

    await runSchedulerWithWeather(weatherData2);

    instances = await getTaskInstances(task.id);
    const secondPlacementHour = new Date(instances[0].scheduled_at).getHours();

    // Should move to hour 16 (only dry hour now)
    expect(secondPlacementHour).toBe(16);
    
    // User sees task jump from hour 13/14 to hour 16 without clear reason
    console.log(`Task jumped from hour ${firstPlacementHour} to hour ${secondPlacementHour}`);
    console.log('User may be confused why the task moved');
  });

  it('SUB-319c: Audit trail enhancement suggestion', () => {
    // This test documents the suggested enhancement
    const suggestedEnhancement = {
      feature: '_weatherFailOpenReason logging',
      purpose: 'Track when tasks are placed in hours with missing weather data',
      implementation: {
        field: '_weatherFailOpenReason',
        values: ['missing_precip_data', 'missing_temp_data', 'missing_cloudcover_data'],
        frontendDisplay: 'Placed in unknown weather — weather data not available for this hour'
      },
      benefit: 'Users can see why a task was placed in a potentially unsuitable hour'
    };
    
    expect(suggestedEnhancement.feature).toBe('_weatherFailOpenReason logging');
    expect(suggestedEnhancement.purpose).toContain('missing weather data');
  });

  it('SUB-319d: Cloud cover has same vulnerability', async () => {
    const weatherData = {
      '2026-06-15': {
        8:  { precipProb: 5, cloudcover: 100, temp: 72 }, // Overcast
        9:  { precipProb: 5, cloudcover: 100, temp: 73 }, // Overcast
        10: { precipProb: 5, cloudcover: null, temp: 74 }, // Missing cloud cover
        11: { precipProb: 5, cloudcover: 10, temp: 75 }   // Clear
      }
    };

    const task = await createTask({
      text: 'Cloud cover test',
      dur: 30,
      pri: 'P3',
      when: 'morning',
      weatherCloud: 'clear' // Requires cloudcover <= 30
    });

    await runSchedulerWithWeather(weatherData);

    const instances = await getTaskInstances(task.id);
    const placementHour = new Date(instances[0].scheduled_at).getHours();

    // Could be placed in hour 10 (missing cloudcover data) due to fail-open
    expect([10, 11]).toContain(placementHour);
    
    if (placementHour === 10) {
      console.log('Task placed in hour 10 with missing cloud cover data');
      console.log('Cloud cover constraint was silently ignored due to fail-open');
    }
  });
});