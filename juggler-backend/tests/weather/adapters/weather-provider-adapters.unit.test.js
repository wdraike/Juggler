/**
 * Weather slice — provider + geocode adapter unit/contract tests (Wave 2 / W2).
 *
 * Pure unit: no DB, no live network. `fetch` is an injected fake, so these run
 * with NO test-bed services. Asserts:
 *   1. OpenMeteoWeatherAdapter / NominatimGeocodeAdapter / MockWeatherProvider
 *      each conform to their port's *_PORT_METHODS frozen contract.
 *   2. Each reproduces the captured H1 goldens (reused from
 *      H1-characterization.test.js — Open-Meteo URL params, displayName
 *      assembly, Nominatim User-Agent + URL, payload passthrough).
 *   3. B6 (NEW BEHAVIOR): a simulated hanging fetch causes the adapter to abort
 *      and reject WITHIN the timeout budget. RED→GREEN proven in the leg report
 *      (a legacy bare-fetch never rejects on a hang; the AbortController makes it
 *      reject). Here we pin the GREEN behavior + that the happy path is unchanged.
 *
 * Traceability: TRACEABILITY-juggler-hex-h1-weather.md B1, B2, B3, B6.
 */

'use strict';

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', '..', 'src', 'slices', 'weather');
var ADAPT = path.join(SLICE, 'adapters');

var GeoPoint = require(path.join(SLICE, 'domain', 'value-objects', 'GeoPoint'));
var WeatherConstraint = require(path.join(SLICE, 'domain', 'entities', 'WeatherConstraint'));
var WeatherProviderPort = require(path.join(SLICE, 'domain', 'ports', 'WeatherProviderPort'));
var GeocodePort = require(path.join(SLICE, 'domain', 'ports', 'GeocodePort'));

var OpenMeteoWeatherAdapter = require(path.join(ADAPT, 'OpenMeteoWeatherAdapter'));
var NominatimGeocodeAdapter = require(path.join(ADAPT, 'NominatimGeocodeAdapter'));
var MockWeatherProvider = require(path.join(ADAPT, 'MockWeatherProvider'));
var constants = require(path.join(ADAPT, 'constants'));

// Golden forecast payload — reused verbatim from H1-characterization.test.js.
var GOLDEN_FORECAST = {
  hourly: {
    time: ['2026-05-15T00:00', '2026-05-15T01:00'],
    temperature_2m: [72, 71],
    precipitation_probability: [10, 12],
    precipitation: [0, 0],
    cloudcover: [30, 35],
    weathercode: [1, 1],
    relativehumidity_2m: [60, 62]
  },
  hourly_units: { temperature_2m: '°F' }
};

function okResponse(body) {
  return { ok: true, status: 200, json: function () { return Promise.resolve(body); } };
}

// ── Port conformance ─────────────────────────────────────────────────────────

describe('weather adapters — port conformance', function () {
  test('OpenMeteoWeatherAdapter implements WEATHER_PROVIDER_PORT_METHODS', function () {
    var adapter = new OpenMeteoWeatherAdapter();
    WeatherProviderPort.WEATHER_PROVIDER_PORT_METHODS.forEach(function (m) {
      expect(typeof adapter[m]).toBe('function');
    });
  });

  test('NominatimGeocodeAdapter implements GEOCODE_PORT_METHODS', function () {
    var adapter = new NominatimGeocodeAdapter();
    GeocodePort.GEOCODE_PORT_METHODS.forEach(function (m) {
      expect(typeof adapter[m]).toBe('function');
    });
  });

  test('MockWeatherProvider implements WEATHER_PROVIDER_PORT_METHODS + GEOCODE_PORT_METHODS', function () {
    var mock = new MockWeatherProvider();
    WeatherProviderPort.WEATHER_PROVIDER_PORT_METHODS.forEach(function (m) {
      expect(typeof mock[m]).toBe('function');
    });
    GeocodePort.GEOCODE_PORT_METHODS.forEach(function (m) {
      expect(typeof mock[m]).toBe('function');
    });
  });
});

// ── OpenMeteoWeatherAdapter — golden forecast ────────────────────────────────

describe('OpenMeteoWeatherAdapter — golden forecast (B1)', function () {
  test('fetches Fahrenheit 14-day forecast and returns a WeatherConstraint with the verbatim payload', async function () {
    var calls = [];
    var fetchImpl = function (url) { calls.push(url); return Promise.resolve(okResponse(GOLDEN_FORECAST)); };
    var adapter = new OpenMeteoWeatherAdapter({ fetchImpl: fetchImpl });

    var result = await adapter.fetchForecast(new GeoPoint(37.77, -122.42));

    // Golden URL params (matching B1-MISS goldens).
    expect(calls).toHaveLength(1);
    var url = calls[0];
    // roundCoord(37.77)=37.8, roundCoord(-122.42)=-122.4 — grid coords in URL.
    expect(url).toContain('latitude=37.8');
    expect(url).toContain('longitude=-122.4');
    expect(url).toContain('temperature_unit=fahrenheit');
    expect(url).toContain('forecast_days=14');
    expect(url).toContain('timezone=auto');
    expect(url).toContain('hourly=temperature_2m,precipitation_probability,precipitation,cloudcover,weathercode,relativehumidity_2m');

    // Payload is carried verbatim into the domain entity.
    expect(result).toBeInstanceOf(WeatherConstraint);
    expect(result.toForecastJson()).toEqual({
      hourly: GOLDEN_FORECAST.hourly,
      hourly_units: GOLDEN_FORECAST.hourly_units
    });
    expect(result.temperatureAt(0)).toBe(72);
    expect(result.hourCount()).toBe(2);
  });

  test('throws "Open-Meteo returned <status>" on a non-OK response (verbatim legacy)', async function () {
    var fetchImpl = function () { return Promise.resolve({ ok: false, status: 503 }); };
    var adapter = new OpenMeteoWeatherAdapter({ fetchImpl: fetchImpl });
    await expect(adapter.fetchForecast(new GeoPoint(1, 2))).rejects.toThrow('Open-Meteo returned 503');
  });

  test('buildForecastUrl is a static helper producing the legacy URL', function () {
    var url = OpenMeteoWeatherAdapter.buildForecastUrl(37.8, -122.4);
    expect(url.indexOf(constants.OPEN_METEO_FORECAST_URL)).toBe(0);
    expect(url).toContain('latitude=37.8');
  });
});

// ── B6 — external-call timeout (NEW BEHAVIOR) ────────────────────────────────

describe('OpenMeteoWeatherAdapter — B6 external-call timeout (NEW BEHAVIOR)', function () {
  /**
   * RED→GREEN evidence (captured in the leg report): a legacy bare `await
   * fetch(url)` on a hanging upstream NEVER settles, so a "rejects within budget"
   * assertion FAILS (outcome stays null). The W2 adapter wraps the fetch in an
   * AbortController (fetchWithTimeout) that aborts + rejects within the budget.
   * These tests pin the GREEN behavior.
   */

  test('B6: a hanging fetch is aborted and the adapter rejects within the timeout budget', async function () {
    // A fetch that NEVER settles and IGNORES the abort signal — the worst case.
    var hanging = function () { return new Promise(function () {}); };
    var adapter = new OpenMeteoWeatherAdapter({ fetchImpl: hanging, timeoutMs: 50 });

    var start = Date.now();
    var rejection = null;
    await adapter.fetchForecast(new GeoPoint(37.77, -122.42)).catch(function (e) { rejection = e; });
    var elapsed = Date.now() - start;

    expect(rejection).not.toBeNull();
    expect(rejection.code).toBe('ETIMEDOUT');
    expect(rejection.message).toMatch(/timed out/i);
    // Rejected within a small multiple of the 50ms budget (not hanging forever).
    expect(elapsed).toBeLessThan(1000);
  });

  test('B6: a fetch that HONORS the abort signal also rejects as a timeout', async function () {
    // Simulate a real fetch that rejects with an AbortError when its signal fires.
    var fetchImpl = function (url, opts) {
      return new Promise(function (_resolve, reject) {
        opts.signal.addEventListener('abort', function () {
          var err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    };
    var adapter = new OpenMeteoWeatherAdapter({ fetchImpl: fetchImpl, timeoutMs: 50 });
    await expect(adapter.fetchForecast(new GeoPoint(1, 2))).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });

  test('B6: happy path is UNAFFECTED by the timeout wrapper (output byte-identical)', async function () {
    // A fetch that resolves immediately — the timer must be cleared and the
    // original payload returned unchanged.
    var fetchImpl = function () { return Promise.resolve(okResponse(GOLDEN_FORECAST)); };
    var adapter = new OpenMeteoWeatherAdapter({ fetchImpl: fetchImpl, timeoutMs: 50 });
    var result = await adapter.fetchForecast(new GeoPoint(37.77, -122.42));
    expect(result.toForecastJson()).toEqual({
      hourly: GOLDEN_FORECAST.hourly,
      hourly_units: GOLDEN_FORECAST.hourly_units
    });
  });

  test('B6: timeout budget is a named slice constant (no magic number)', function () {
    expect(typeof constants.EXTERNAL_CALL_TIMEOUT_MS).toBe('number');
    expect(constants.EXTERNAL_CALL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

// ── NominatimGeocodeAdapter — forward (B2) ───────────────────────────────────

describe('NominatimGeocodeAdapter — forward geocode (B2)', function () {
  test('returns { lat, lon, displayName } with [name, admin1, country] assembly', async function () {
    var calls = [];
    var fetchImpl = function (url) {
      calls.push(url);
      return Promise.resolve(okResponse({
        results: [{
          latitude: 37.7749, longitude: -122.4194,
          name: 'San Francisco', admin1: 'California', country: 'United States'
        }]
      }));
    };
    var adapter = new NominatimGeocodeAdapter({ fetchImpl: fetchImpl });
    var out = await adapter.forwardGeocode('San Francisco');

    expect(out).toEqual({ lat: 37.7749, lon: -122.4194, displayName: 'San Francisco, California, United States' });
    // Golden URL: count=1, language=en, format=json, encoded query.
    expect(calls[0]).toContain('count=1');
    expect(calls[0]).toContain('language=en');
    expect(calls[0]).toContain('format=json');
    expect(calls[0]).toContain('San%20Francisco');
  });

  test('filter(Boolean) drops a null admin1 (no double comma)', async function () {
    var fetchImpl = function () {
      return Promise.resolve(okResponse({
        results: [{ latitude: 51.5, longitude: -0.12, name: 'London', admin1: null, country: 'United Kingdom' }]
      }));
    };
    var adapter = new NominatimGeocodeAdapter({ fetchImpl: fetchImpl });
    var out = await adapter.forwardGeocode('London');
    expect(out.displayName).toBe('London, United Kingdom');
  });

  test('rejects NOT_FOUND when the upstream returns empty results', async function () {
    var fetchImpl = function () { return Promise.resolve(okResponse({ results: [] })); };
    var adapter = new NominatimGeocodeAdapter({ fetchImpl: fetchImpl });
    await expect(adapter.forwardGeocode('zzz')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('throws "Geocoding API returned <status>" on non-OK', async function () {
    var fetchImpl = function () { return Promise.resolve({ ok: false, status: 500 }); };
    var adapter = new NominatimGeocodeAdapter({ fetchImpl: fetchImpl });
    await expect(adapter.forwardGeocode('x')).rejects.toThrow('Geocoding API returned 500');
  });
});

// ── NominatimGeocodeAdapter — reverse (B3) ───────────────────────────────────

describe('NominatimGeocodeAdapter — reverse geocode (B3)', function () {
  test('assembles [city, state] and sends the Nominatim User-Agent header', async function () {
    var calls = [];
    var fetchImpl = function (url, opts) {
      calls.push({ url: url, opts: opts });
      return Promise.resolve(okResponse({
        address: { city: 'San Francisco', state: 'California' },
        display_name: 'San Francisco, California, US'
      }));
    };
    var adapter = new NominatimGeocodeAdapter({ fetchImpl: fetchImpl });
    var name = await adapter.reverseGeocode(new GeoPoint(37.77, -122.42));

    expect(name).toBe('San Francisco, California');
    // Golden: Nominatim URL + zoom=10 + raw lat/lon (not grid-rounded in URL).
    expect(calls[0].url).toContain('nominatim.openstreetmap.org/reverse');
    expect(calls[0].url).toContain('lat=37.77');
    expect(calls[0].url).toContain('zoom=10');
    // Golden: User-Agent header (Nominatim usage policy requires it).
    expect(calls[0].opts.headers['User-Agent']).toBe(constants.NOMINATIM_USER_AGENT);
    expect(calls[0].opts.headers['User-Agent']).toContain('Juggler');
  });

  test('falls back to data.display_name when city/state are absent (verbatim legacy chain)', async function () {
    var fetchImpl = function () {
      return Promise.resolve(okResponse({ address: {}, display_name: 'Somewhere, Remote, Country' }));
    };
    var adapter = new NominatimGeocodeAdapter({ fetchImpl: fetchImpl });
    var name = await adapter.reverseGeocode(new GeoPoint(10, 10));
    expect(name).toBe('Somewhere, Remote, Country');
  });

  test('B6: reverse geocode also aborts + rejects on a hanging upstream', async function () {
    var hanging = function () { return new Promise(function () {}); };
    var adapter = new NominatimGeocodeAdapter({ fetchImpl: hanging, timeoutMs: 50 });
    await expect(adapter.reverseGeocode(new GeoPoint(1, 2))).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });

  test('B6: forward geocode also aborts + rejects on a hanging upstream', async function () {
    var hanging = function () { return new Promise(function () {}); };
    var adapter = new NominatimGeocodeAdapter({ fetchImpl: hanging, timeoutMs: 50 });
    await expect(adapter.forwardGeocode('x')).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });
});

// ── MockWeatherProvider — deterministic double ───────────────────────────────

describe('MockWeatherProvider — deterministic test double', function () {
  test('returns a fixed forecast as a WeatherConstraint and records the grid point', async function () {
    var mock = new MockWeatherProvider({ forecast: GOLDEN_FORECAST });
    var result = await mock.fetchForecast(new GeoPoint(37.77, -122.42));
    expect(result).toBeInstanceOf(WeatherConstraint);
    expect(result.temperatureAt(1)).toBe(71);
    expect(mock.calls.fetchForecast).toHaveLength(1);
    expect(mock.calls.fetchForecast[0].latGrid()).toBe(37.8);
  });

  test('forecastFor resolves per grid cell', async function () {
    var mock = new MockWeatherProvider({
      forecastFor: function (p) {
        return p.latGrid() === 37.8 ? GOLDEN_FORECAST : { hourly: null, hourly_units: {} };
      }
    });
    var hit = await mock.fetchForecast(new GeoPoint(37.77, -122.42));
    var miss = await mock.fetchForecast(new GeoPoint(0, 0));
    expect(hit.hourCount()).toBe(2);
    expect(miss.hourCount()).toBe(0);
  });

  test('forwardGeocode resolves from the injected map; misses reject NOT_FOUND', async function () {
    var mock = new MockWeatherProvider({
      forwardMap: { 'SF': { lat: 37.77, lon: -122.42, displayName: 'San Francisco, California' } }
    });
    await expect(mock.forwardGeocode('SF')).resolves.toEqual({ lat: 37.77, lon: -122.42, displayName: 'San Francisco, California' });
    await expect(mock.forwardGeocode('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('reverseGeocode resolves from the injected map keyed by reverseGeocodeCacheKey', async function () {
    var key = new GeoPoint(37.77, -122.42).reverseGeocodeCacheKey();
    var map = {}; map[key] = 'San Francisco, California';
    var mock = new MockWeatherProvider({ reverseMap: map });
    await expect(mock.reverseGeocode(new GeoPoint(37.77, -122.42))).resolves.toBe('San Francisco, California');
    // Unmapped point returns '' (deterministic empty, not undefined).
    await expect(mock.reverseGeocode(new GeoPoint(0, 0))).resolves.toBe('');
  });
});
