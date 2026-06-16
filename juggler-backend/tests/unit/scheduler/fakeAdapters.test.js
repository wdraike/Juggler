/**
 * TELLY-00: Unit tests for FakeClockAdapter + FakeWeatherProvider
 *
 * Comprehensive test suite for the FakeClockAdapter and FakeWeatherProvider
 * test doubles used in scheduler testing.
 */

'use strict';

var FakeClockAdapter = require('../../../src/slices/scheduler/adapters/FakeClockAdapter');
var FakeWeatherProvider = require('../../../src/slices/scheduler/adapters/FakeWeatherProvider');

describe('FakeClockAdapter', function () {
  var clock;

  beforeEach(function () {
    clock = new FakeClockAdapter();
  });

  describe('construction', function () {
    test('defaults to real time when no startTime provided', function () {
      var realNow = new Date();
      var clock = new FakeClockAdapter();
      var clockNow = clock.now();
      
      // Should be close to real time (within a few milliseconds)
      expect(clockNow.getTime()).toBeGreaterThanOrEqual(realNow.getTime() - 10);
      expect(clockNow.getTime()).toBeLessThanOrEqual(realNow.getTime() + 10);
    });

    test('uses provided startTime when specified', function () {
      var startTime = new Date('2026-01-01T00:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      var clockNow = clock.now();
      
      expect(clockNow.getTime()).toBe(startTime.getTime());
    });
  });

  describe('now()', function () {
    test('returns current fake time', function () {
      var startTime = new Date('2026-01-01T12:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      var now = clock.now();
      
      expect(now.getTime()).toBe(startTime.getTime());
    });

    test('returns a new Date object each time', function () {
      var clock = new FakeClockAdapter({ startTime: new Date('2026-01-01T12:00:00Z') });
      var now1 = clock.now();
      var now2 = clock.now();
      
      expect(now1).not.toBe(now2); // Different objects
      expect(now1.getTime()).toBe(now2.getTime()); // Same time
    });
  });

  describe('dbNow()', function () {
    test('returns same fake time as now()', async function () {
      var startTime = new Date('2026-01-01T12:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      
      var now = clock.now();
      var dbNow = await clock.dbNow();
      
      expect(dbNow.getTime()).toBe(now.getTime());
    });

    test('returns a new Date object', async function () {
      var clock = new FakeClockAdapter({ startTime: new Date('2026-01-01T12:00:00Z') });
      var dbNow1 = await clock.dbNow();
      var dbNow2 = await clock.dbNow();
      
      expect(dbNow1).not.toBe(dbNow2);
      expect(dbNow1.getTime()).toBe(dbNow2.getTime());
    });
  });

  describe('advance()', function () {
    test('advances time by specified milliseconds', function () {
      var startTime = new Date('2026-01-01T12:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      
      clock.advance(3600000); // 1 hour
      var now = clock.now();
      
      expect(now.getTime()).toBe(startTime.getTime() + 3600000);
    });

    test('returns this for chaining', function () {
      var clock = new FakeClockAdapter();
      var result = clock.advance(1000);
      
      expect(result).toBe(clock);
    });

    test('can advance multiple times', function () {
      var startTime = new Date('2026-01-01T12:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      
      clock.advance(3600000); // 1 hour
      clock.advance(1800000); // 30 minutes
      var now = clock.now();
      
      expect(now.getTime()).toBe(startTime.getTime() + 3600000 + 1800000);
    });
  });

  describe('tick()', function () {
    test('advances time by 1 minute (60000ms)', function () {
      var startTime = new Date('2026-01-01T12:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      
      clock.tick();
      var now = clock.now();
      
      expect(now.getTime()).toBe(startTime.getTime() + 60000);
    });

    test('returns this for chaining', function () {
      var clock = new FakeClockAdapter();
      var result = clock.tick();
      
      expect(result).toBe(clock);
    });
  });

  describe('skipDays()', function () {
    test('advances time by specified number of days', function () {
      var startTime = new Date('2026-01-01T12:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      
      clock.skipDays(1);
      var now = clock.now();
      
      var expectedTime = startTime.getTime() + (24 * 60 * 60 * 1000);
      expect(now.getTime()).toBe(expectedTime);
    });

    test('returns this for chaining', function () {
      var clock = new FakeClockAdapter();
      var result = clock.skipDays(1);
      
      expect(result).toBe(clock);
    });

    test('can skip multiple days', function () {
      var startTime = new Date('2026-01-01T12:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      
      clock.skipDays(3);
      var now = clock.now();
      
      var expectedTime = startTime.getTime() + (3 * 24 * 60 * 60 * 1000);
      expect(now.getTime()).toBe(expectedTime);
    });
  });

  describe('setTime()', function () {
    test('sets clock to specific date', function () {
      var clock = new FakeClockAdapter();
      var newTime = new Date('2026-06-15T14:30:00Z');
      
      clock.setTime(newTime);
      var now = clock.now();
      
      expect(now.getTime()).toBe(newTime.getTime());
    });

    test('returns this for chaining', function () {
      var clock = new FakeClockAdapter();
      var result = clock.setTime(new Date('2026-06-15T14:30:00Z'));
      
      expect(result).toBe(clock);
    });
  });

  describe('reset()', function () {
    test('resets clock to real time on first call', function () {
      var startTime = new Date('2026-01-01T12:00:00Z');
      var clock = new FakeClockAdapter({ startTime: startTime });
      
      // Advance the clock
      clock.advance(3600000);
      var advancedTime = clock.now();
      
      // Reset should return to real time
      clock.reset();
      var realNow = new Date();
      var resetTime = clock.now();
      
      expect(resetTime.getTime()).toBeGreaterThanOrEqual(realNow.getTime() - 10);
      expect(resetTime.getTime()).toBeLessThanOrEqual(realNow.getTime() + 10);
      expect(resetTime.getTime()).not.toBe(advancedTime.getTime());
    });

    test('resets to the same real time on subsequent calls', function () {
      var clock = new FakeClockAdapter();
      
      // First reset captures real time
      clock.reset();
      var firstResetTime = clock.now();
      
      // Advance and reset again
      clock.advance(1000);
      clock.reset();
      var secondResetTime = clock.now();
      
      // Should be the same captured real time
      expect(secondResetTime.getTime()).toBe(firstResetTime.getTime());
    });

    test('returns this for chaining', function () {
      var clock = new FakeClockAdapter();
      var result = clock.reset();
      
      expect(result).toBe(clock);
    });
  });
});

describe('FakeWeatherProvider', function () {
  var weather;

  beforeEach(function () {
    weather = new FakeWeatherProvider();
  });

  describe('construction', function () {
    test('starts with empty weather map', function () {
      expect(weather._weatherMap).toEqual({});
    });
  });

  describe('loadWeatherForHorizon()', function () {
    test('returns empty object when no weather set (fail-open)', async function () {
      var result = await weather.loadWeatherForHorizon([], null);
      expect(result).toEqual({});
    });

    test('returns the internal weather map', async function () {
      weather._weatherMap = { '2026-06-15': { 9: { temp: 95, precipProb: 0 } } };
      var result = await weather.loadWeatherForHorizon([], null);
      
      expect(result).toBe(weather._weatherMap);
    });

    test('ignores location and db parameters', async function () {
      weather._weatherMap = { '2026-06-15': { 9: { temp: 95, precipProb: 0 } } };
      
      var locations = [{ lat: 123, lng: 456 }];
      var db = { query: jest.fn() };
      var result = await weather.loadWeatherForHorizon(locations, db);
      
      expect(result).toBe(weather._weatherMap);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('setHour()', function () {
    test('sets weather for specific date and hour', function () {
      var dateKey = '2026-06-15';
      var hour = 9;
      var data = { temp: 95, precipProb: 0, cloudcover: 0, humidity: 20 };
      
      weather.setHour(dateKey, hour, data);
      
      expect(weather._weatherMap[dateKey][hour]).toEqual(data);
    });

    test('creates date key entry if it does not exist', function () {
      var dateKey = '2026-06-15';
      var hour = 9;
      var data = { temp: 95, precipProb: 0 };
      
      weather.setHour(dateKey, hour, data);
      
      expect(weather._weatherMap).toHaveProperty(dateKey);
      expect(weather._weatherMap[dateKey]).toHaveProperty('' + hour);
    });

    test('overwrites existing data for same date and hour', function () {
      var dateKey = '2026-06-15';
      var hour = 9;
      var data1 = { temp: 95, precipProb: 0 };
      var data2 = { temp: 72, precipProb: 5 };
      
      weather.setHour(dateKey, hour, data1);
      weather.setHour(dateKey, hour, data2);
      
      expect(weather._weatherMap[dateKey][hour]).toEqual(data2);
    });
  });

  describe('setRange()', function () {
    test('sets weather for all hours in date range', function () {
      var startDate = '2026-06-15';
      var days = 2;
      var pattern = function (dateKey, hour) {
        return { temp: 72, precipProb: hour >= 14 ? 80 : 5 };
      };
      
      weather.setRange(startDate, days, pattern);
      
      // Should have data for 2 days
      expect(weather._weatherMap).toHaveProperty('2026-06-15');
      expect(weather._weatherMap).toHaveProperty('2026-06-16');
      
      // Each day should have 24 hours
      expect(Object.keys(weather._weatherMap['2026-06-15'])).toHaveLength(24);
      expect(Object.keys(weather._weatherMap['2026-06-16'])).toHaveLength(24);
    });

    test('uses pattern function to generate weather data', function () {
      var startDate = '2026-06-15';
      var days = 1;
      var pattern = function (dateKey, hour) {
        return { temp: 72, precipProb: hour >= 14 ? 80 : 5 };
      };
      
      weather.setRange(startDate, days, pattern);
      
      // Morning hours should have low precipProb
      expect(weather._weatherMap['2026-06-15'][9].precipProb).toBe(5);
      
      // Afternoon hours should have high precipProb
      expect(weather._weatherMap['2026-06-15'][14].precipProb).toBe(80);
    });

    test('handles single day range', function () {
      var startDate = '2026-06-15';
      var days = 1;
      var pattern = function (dateKey, hour) {
        return { temp: 72, precipProb: 0 };
      };
      
      weather.setRange(startDate, days, pattern);
      
      expect(weather._weatherMap).toHaveProperty('2026-06-15');
      expect(Object.keys(weather._weatherMap)).toHaveLength(1);
    });

    test('handles multi-day range', function () {
      var startDate = '2026-06-15';
      var days = 5;
      var pattern = function (dateKey, hour) {
        return { temp: 72, precipProb: 0 };
      };
      
      weather.setRange(startDate, days, pattern);
      
      expect(Object.keys(weather._weatherMap)).toHaveLength(5);
      expect(weather._weatherMap).toHaveProperty('2026-06-15');
      expect(weather._weatherMap).toHaveProperty('2026-06-16');
      expect(weather._weatherMap).toHaveProperty('2026-06-17');
      expect(weather._weatherMap).toHaveProperty('2026-06-18');
      expect(weather._weatherMap).toHaveProperty('2026-06-19');
    });
  });

  describe('setEmpty()', function () {
    test('clears all weather data', function () {
      // Set some data first
      weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0 });
      weather.setHour('2026-06-16', 10, { temp: 72, precipProb: 5 });
      
      expect(Object.keys(weather._weatherMap)).toHaveLength(2);
      
      weather.setEmpty();
      
      expect(weather._weatherMap).toEqual({});
    });

    test('results in fail-open behavior', async function () {
      weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0 });
      weather.setEmpty();
      
      var result = await weather.loadWeatherForHorizon([], null);
      expect(result).toEqual({});
    });
  });

  describe('setNoData()', function () {
    test('clears all weather data (same as setEmpty)', function () {
      // Set some data first
      weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0 });
      
      weather.setNoData();
      
      expect(weather._weatherMap).toEqual({});
    });

    test('results in fail-open behavior', async function () {
      weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0 });
      weather.setNoData();
      
      var result = await weather.loadWeatherForHorizon([], null);
      expect(result).toEqual({});
    });
  });
});

describe('FakeClockAdapter + FakeWeatherProvider interaction', function () {
  var clock, weather;

  beforeEach(function () {
    clock = new FakeClockAdapter({ startTime: new Date('2026-06-15T09:00:00Z') });
    weather = new FakeWeatherProvider();
  });

  test('clock advance does not affect weather provider', function () {
    // Set weather for a specific time
    weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0 });
    
    // Advance clock
    clock.advance(3600000); // 1 hour
    
    // Weather should remain unchanged
    expect(weather._weatherMap['2026-06-15'][9]).toEqual({ temp: 95, precipProb: 0 });
  });

  test('weather changes do not affect clock', function () {
    var initialTime = clock.now();
    
    // Change weather
    weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0 });
    
    // Clock should remain unchanged
    expect(clock.now().getTime()).toBe(initialTime.getTime());
  });

  test('both adapters can be used independently', async function () {
    // Set up clock - use UTC time to avoid timezone issues
    clock.setTime(new Date('2026-06-15T09:00:00Z'));
    
    // Set up weather
    weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0 });
    
    // Advance clock by 1 hour (3600000ms)
    clock.advance(3600000); // 1 hour to 10:00 UTC
    
    // Set weather for new hour
    weather.setHour('2026-06-15', 10, { temp: 98, precipProb: 10 });
    
    // Verify both are working independently
    // Use getUTCHours() to avoid timezone issues
    expect(clock.now().getUTCHours()).toBe(10);
    expect(weather._weatherMap['2026-06-15'][10]).toEqual({ temp: 98, precipProb: 10 });
    
    // Weather load should return the map
    var weatherData = await weather.loadWeatherForHorizon([], null);
    expect(weatherData).toBe(weather._weatherMap);
  });

  test('clock reset does not affect weather provider', function () {
    // Set weather
    weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0 });
    
    // Reset clock
    clock.reset();
    
    // Weather should remain unchanged
    expect(weather._weatherMap['2026-06-15'][9]).toEqual({ temp: 95, precipProb: 0 });
  });
});