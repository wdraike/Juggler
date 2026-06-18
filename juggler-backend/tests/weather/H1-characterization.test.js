/**
 * H1 Characterization — Weather Slice Pre-Refactor Golden Master
 *
 * Safety oracle for juggler-hex-h1-weather. Pins CURRENT behavior before any
 * structural change so the refactor can prove behavior is bit-identical after.
 *
 * Behaviors pinned:
 *   B1  — getForecast: cache HIT path + MISS path; response shape; roundCoord grid key.
 *   B2  — geocode (forward): output shape { lat, lon, displayName }; displayName assembly.
 *   B3  — reverseGeocode + reverseGeocodeDisplayName: cache key format, output shape.
 *   B4  — roundCoord: unit test bit-identical output over sample incl. negatives and
 *          rounding boundaries. This helper is consumed by runSchedule.js:263-264
 *          and health.routes.js:223 — any drift breaks both cache keys AND scheduler
 *          weather-match.
 *   B5  — Staleness behavior: B5-1 source-pins that loadWeatherForHorizon in
 *          runSchedule.js has NO expires_at filter (stale rows ARE returned);
 *          B5-2 source-pins that the API cache-read path DOES filter by
 *          expires_at > now (fresh rows only to API callers); B5-3 characterizes
 *          that a dry_only task is placed when dry weather data is present in
 *          weatherByDateHour (feeds data directly to unifiedScheduleV2 — does
 *          NOT call loadWeatherForHorizon or test the stale-cache read path).
 *   B7  — Baseline call counts: weather.controller.js contains exactly 5 getDb()
 *          call sites and 3 fetch() call sites (measured 2026-06-09). The
 *          post-refactor thin-controller assertion target is 0/0.
 *
 * All tests are pure-unit (no DB, no network). External I/O is mocked via
 * jest.mock / globalThis.fetch override.
 *
 * Traceability: TRACEABILITY-juggler-hex-h1-weather.md B1–B5, B7.
 */

'use strict';

process.env.NODE_ENV = 'test';

const { createMockChainDb } = require('../helpers/mockChainDb');
const { mockDb, resolveQueue } = createMockChainDb();
mockDb.delete = mockDb.del;

jest.mock('../../src/db', () => mockDb);

// W5 (juggler-hex-h2): KnexWeatherCacheRepository now default-wires from
// lib/db.getDefaultDb() (the single pool src/db re-exports), so the golden
// master must feed the same mockDb through lib/db too. Keep createKnex/
// withTransaction/etc. as-is so unrelated consumers behave normally.
jest.mock('../../src/lib/db', () => {
  const actual = jest.requireActual('../../src/lib/db');
  return Object.assign({}, actual, { getDefaultDb: () => mockDb });
});

jest.mock('../../src/middleware/jwt-auth', () => ({
  loadJWTSecrets: jest.fn(),
  authenticateJWT: (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
      return res.status(401).json({ error: 'Authentication required' });
    req.user = { id: 'user-123', email: 'test@test.com', name: 'Test', timezone: 'America/New_York' };
    req.auth = { plans: {}, apps: ['juggler'] };
    next();
  },
  verifyToken: jest.fn()
}));

jest.mock('../../src/middleware/plan-features.middleware', () => ({
  resolvePlanFeatures: (req, res, next) => { req.planId = 'enterprise'; req.planFeatures = {}; next(); },
  PRODUCT_ID: 'juggler',
  refreshPlanFeatures: jest.fn(),
  getCachedPlanFeatures: jest.fn()
}));

jest.mock('../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn(),
  getLastError: jest.fn(() => null),
  enqueue: jest.fn()
}));

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: jest.fn(),
  addClient: jest.fn()
}));

jest.mock('../../src/lib/sync-lock', () => ({
  withSyncLock: (fn) => fn,
  acquireLock: jest.fn(() => Promise.resolve(true)),
  releaseLock: jest.fn(() => Promise.resolve()),
  refreshLock: jest.fn(() => Promise.resolve())
}));

jest.mock('../../src/lib/tasks-write', () => ({
  insertTask: jest.fn(() => Promise.resolve()),
  updateTask: jest.fn(() => Promise.resolve()),
  deleteTasksWhere: jest.fn(() => Promise.resolve())
}));

// Redis mock: default to cache miss (null) so reverse-geocode falls through to fetch.
// Individual tests override mockRedisImpl.get / mockRedisImpl.set as needed.
// Uses an object reference (not a let binding) so jest.mock hoisting works correctly.
const mockRedisImpl = {
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true))
};
jest.mock('../../src/lib/redis', () => ({
  getClient: jest.fn(() => null),
  invalidateTasks: jest.fn(() => Promise.resolve()),
  invalidateConfig: jest.fn(() => Promise.resolve()),
  get: (...args) => mockRedisImpl.get(...args),
  set: (...args) => mockRedisImpl.set(...args),
  del: jest.fn(() => Promise.resolve())
}));

// Fetch mock — all external HTTP goes through globalThis.fetch
let mockFetch;
beforeEach(() => {
  resolveQueue.length = 0;
  jest.clearAllMocks();
  mockFetch = jest.fn();
  global.fetch = mockFetch;
  // reset redis impl to defaults (cache miss)
  mockRedisImpl.get = jest.fn(() => Promise.resolve(null));
  mockRedisImpl.set = jest.fn(() => Promise.resolve(true));
});

const request = require('supertest');
const VALID_TOKEN = 'Bearer test-token';
let app;

beforeAll(() => {
  app = require('../../src/app');
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — roundCoord unit tests (pure function, no mocks needed)
// These run FIRST so any import failure is immediately visible.
// ─────────────────────────────────────────────────────────────────────────────

describe('B4: roundCoord — bit-identical grid keying', () => {
  // Import the real production function — any post-refactor shim must alias
  // or re-export the same function so these values are identical.
  const { roundCoord } = require('../../src/controllers/weather.controller');

  // Golden values captured 2026-06-09 from Math.round(parseFloat(v) * 10) / 10
  const cases = [
    // [input, expected]
    [37.77,    37.8],   // standard positive
    [-122.42, -122.4],  // negative longitude
    [0,        0],      // zero
    [-0,       0],      // negative zero normalizes to 0
    [37.75,   37.8],    // exact .75 rounds UP (Math.round ties-to-even: 0.75 → 0.8)
    [37.74,   37.7],    // .74 rounds DOWN
    [37.749,  37.7],    // below .75 boundary
    [37.751,  37.8],    // above .75 boundary
    [90,       90],     // lat max
    [-90,      -90],    // lat min
    [180,      180],    // lon max
    [-180,     -180],   // lon min
    [37.05,   37.1],    // small fractional
    [37.04,   37.0],    // just below .05
    [-0.05,   -0],      // GOLDEN: Math.round(-0.5) = 0 (ties round toward +inf in JS); -0 / 10 preserves IEEE-754 negative zero
    ['37.77',  37.8],   // string input (parseFloat coercion)
    ['-122.4', -122.4], // string negative
  ];

  it.each(cases)('roundCoord(%s) === %s', (input, expected) => {
    expect(roundCoord(input)).toBe(expected);
  });

  it('B4: roundCoord produces same grid key as runSchedule.js:263-264 (cross-module compat)', () => {
    // runSchedule.js imports roundCoord from weather.controller.js and passes
    // location.lat/lon (numbers) through it. Any drift here breaks the cache key.
    const lat = 37.6;
    const lon = -77.6;
    const latGrid = roundCoord(lat);
    const lonGrid = roundCoord(lon);
    expect(latGrid).toBe(37.6);
    expect(lonGrid).toBe(-77.6);
    // Verify the key format used in health.routes.js weather cache lookup is stable:
    // health.routes.js:223-225 calls roundCoord(userLoc.lat)/roundCoord(userLoc.lon)
    // and then queries .where('lat_grid', latGrid).where('lon_grid', lonGrid)
    expect(typeof latGrid).toBe('number');
    expect(typeof lonGrid).toBe('number');
  });

  it('B4: string vs number input produces identical grid key (DB stores numbers)', () => {
    const { roundCoord: rc } = require('../../src/controllers/weather.controller');
    expect(rc('37.6')).toBe(rc(37.6));
    expect(rc('-77.6')).toBe(rc(-77.6));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B1 — getForecast: cache HIT + MISS + response shape
// ─────────────────────────────────────────────────────────────────────────────

const GOLDEN_FORECAST = {
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

describe('B1: getForecast cache HIT path — golden response shape', () => {
  it('B1-HIT: cache hit returns { hourly, hourly_units, cachedAt, expiresAt } with no refreshed flag', async () => {
    const cachedAt = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const expiresAt = new Date(cachedAt.getTime() + 60 * 60 * 1000); // 1h TTL
    const cachedRow = {
      fetched_at: cachedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      forecast_json: JSON.stringify(GOLDEN_FORECAST)
    };
    resolveQueue.push(cachedRow); // first() → cachedRow

    const res = await request(app)
      .get('/api/weather?lat=37.77&lon=-122.42')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);

    // Golden shape: must have hourly + hourly_units + cachedAt + expiresAt
    expect(res.body).toHaveProperty('hourly');
    expect(res.body).toHaveProperty('hourly_units');
    expect(res.body).toHaveProperty('cachedAt');
    expect(res.body).toHaveProperty('expiresAt');

    // Golden invariant: no 'refreshed' flag on cache HIT
    expect(res.body.refreshed).toBeUndefined();

    // Golden data: hourly arrays are passed through unchanged
    expect(res.body.hourly.temperature_2m).toEqual([72, 71]);
    expect(res.body.hourly_units.temperature_2m).toBe('°F');

    // No fetch call on cache HIT
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('B1-HIT: grid key bucketing — lat=37.77 and lat=37.8 map to the same grid cell', () => {
    // roundCoord(37.77) = 37.8, roundCoord(37.8) = 37.8 — same key
    const { roundCoord } = require('../../src/controllers/weather.controller');
    expect(roundCoord(37.77)).toBe(37.8);
    expect(roundCoord(37.8)).toBe(37.8);
    // Different raw coords within the same 0.1° cell hit the SAME cache row
    expect(roundCoord(37.75)).toBe(37.8);
    expect(roundCoord(37.74)).toBe(37.7); // just outside the cell
  });
});

describe('B1: getForecast cache MISS path — fetches from Open-Meteo', () => {
  it('B1-MISS: cache miss → fetches from Open-Meteo → returns { hourly, hourly_units, cachedAt, expiresAt, refreshed: true }', async () => {
    // DB cache lookup: first() → null (cache miss)
    resolveQueue.push(null);
    // Open-Meteo response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(GOLDEN_FORECAST)
    });

    const res = await request(app)
      .get('/api/weather?lat=37.7&lon=-122.4')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);

    // Golden shape on MISS: must include refreshed: true
    expect(res.body).toHaveProperty('hourly');
    expect(res.body).toHaveProperty('hourly_units');
    expect(res.body).toHaveProperty('cachedAt');
    expect(res.body).toHaveProperty('expiresAt');
    expect(res.body.refreshed).toBe(true);  // GOLDEN: MISS path always sets refreshed

    // Golden data passthrough
    expect(res.body.hourly.temperature_2m).toEqual([72, 71]);

    // Exactly one fetch call on cache MISS
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchUrl = mockFetch.mock.calls[0][0];
    // Golden: Open-Meteo URL contains lat/lon grid values
    expect(fetchUrl).toContain('latitude=37.7');
    expect(fetchUrl).toContain('longitude=-122.4');
    // Golden: always requests Fahrenheit
    expect(fetchUrl).toContain('temperature_unit=fahrenheit');
    // Golden: always 14-day forecast
    expect(fetchUrl).toContain('forecast_days=14');
  });

  it('B1-MISS: cacheOnly=1 returns { miss: true } without fetching from Open-Meteo', async () => {
    resolveQueue.push(null); // cache miss

    const res = await request(app)
      .get('/api/weather?lat=37.7&lon=-122.4&cacheOnly=1')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ miss: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('B1: returns 400 when lat/lon are absent', async () => {
    const res = await request(app)
      .get('/api/weather')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lon/);
  });

  it('B1: returns 400 for non-numeric lat/lon', async () => {
    const res = await request(app)
      .get('/api/weather?lat=foo&lon=bar')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 — geocode (forward) output shape
// ─────────────────────────────────────────────────────────────────────────────

describe('B2: geocode — forward geocode output shape', () => {
  it('B2-1: returns { lat, lon, displayName } with correct displayName assembly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        results: [{
          latitude: 37.7749, longitude: -122.4194,
          name: 'San Francisco', admin1: 'California', country: 'United States'
        }]
      })
    });

    const res = await request(app)
      .get('/api/weather/geocode?q=San+Francisco')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);

    // Golden shape
    expect(Object.keys(res.body)).toEqual(expect.arrayContaining(['lat', 'lon', 'displayName']));
    expect(res.body.lat).toBe(37.7749);
    expect(res.body.lon).toBe(-122.4194);

    // Golden displayName assembly: [name, admin1, country].filter(Boolean).join(', ')
    expect(res.body.displayName).toBe('San Francisco, California, United States');
  });

  it('B2-2: displayName omits null/undefined fields (filter(Boolean))', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        results: [{ latitude: 51.5, longitude: -0.12, name: 'London', admin1: null, country: 'United Kingdom' }]
      })
    });

    const res = await request(app)
      .get('/api/weather/geocode?q=London')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    // Golden: null admin1 is filtered → "London, United Kingdom" (no double comma)
    expect(res.body.displayName).toBe('London, United Kingdom');
  });

  it('B2-3: returns 404 when geocoding API returns empty results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ results: [] })
    });
    const res = await request(app)
      .get('/api/weather/geocode?q=zzzunknown')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('B2-4: returns 400 for empty query param', async () => {
    const res = await request(app)
      .get('/api/weather/geocode?q=')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/q is required/);
  });

  it('B2-5: Open-Meteo geocode URL uses encodeURIComponent and count=1', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        results: [{ latitude: 40.71, longitude: -74.01, name: 'New York City', admin1: 'New York', country: 'US' }]
      })
    });

    await request(app)
      .get('/api/weather/geocode?q=New+York+City')
      .set('Authorization', VALID_TOKEN);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0];
    // Golden: URL contains count=1, language=en, format=json
    expect(url).toContain('count=1');
    expect(url).toContain('language=en');
    expect(url).toContain('format=json');
    expect(url).toContain('New%20York%20City');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3 — reverseGeocode + reverseGeocodeDisplayName
// ─────────────────────────────────────────────────────────────────────────────

describe('B3: reverseGeocode — endpoint shape + cache key format', () => {
  it('B3-1: returns { displayName } from Nominatim city+state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        address: { city: 'San Francisco', state: 'California' },
        display_name: 'San Francisco, California, US'
      })
    });

    const res = await request(app)
      .get('/api/weather/reverse-geocode?lat=37.77&lon=-122.42')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('displayName');
    // Golden: city + state, comma-joined
    expect(res.body.displayName).toBe('San Francisco, California');
  });

  it('B3-2: falls back to data.display_name when city/state are absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        address: {},
        display_name: 'Somewhere, Remote, Country'
      })
    });

    const res = await request(app)
      .get('/api/weather/reverse-geocode?lat=10&lon=10')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Somewhere, Remote, Country');
  });

  it('B3-3: cache key is "rgeo:<roundCoord(lat)>:<roundCoord(lon)>"', async () => {
    // The cache key format is critical — post-refactor Redis adapter must use same key.
    // Redis miss forces a Nominatim fetch so we can observe the key Redis was asked for.
    const redisCalls = [];
    mockRedisImpl.get = jest.fn((key) => { redisCalls.push(key); return Promise.resolve(null); });
    mockRedisImpl.set = jest.fn(() => Promise.resolve(true));

    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        address: { city: 'Richmond', state: 'Virginia' },
        display_name: 'Richmond, Virginia, US'
      })
    });

    await request(app)
      .get('/api/weather/reverse-geocode?lat=37.55&lon=-77.46')
      .set('Authorization', VALID_TOKEN);

    // Golden cache key: rgeo:<0.1-rounded-lat>:<0.1-rounded-lon>
    // roundCoord(37.55) = 37.6, roundCoord(-77.46) = -77.5
    expect(redisCalls[0]).toBe('rgeo:37.6:-77.5');
  });

  it('B3-4: Redis cache HIT returns cached displayName without calling fetch', async () => {
    mockRedisImpl.get = jest.fn(() => Promise.resolve({ displayName: 'Cached City, Cached State' }));

    const res = await request(app)
      .get('/api/weather/reverse-geocode?lat=37.77&lon=-122.42')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Cached City, Cached State');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('B3-5: Nominatim request includes User-Agent header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ address: { city: 'Test', state: 'State' }, display_name: 'Test' })
    });

    await request(app)
      .get('/api/weather/reverse-geocode?lat=37&lon=-77')
      .set('Authorization', VALID_TOKEN);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    // Golden: Nominatim URL
    expect(url).toContain('nominatim.openstreetmap.org/reverse');
    expect(url).toContain('lat=37');
    expect(url).toContain('zoom=10');
    // Golden: User-Agent header present (Nominatim usage policy requires it)
    expect(opts.headers['User-Agent']).toBeDefined();
    expect(opts.headers['User-Agent']).toContain('Juggler');
  });

  it('B3-6: reverseGeocodeDisplayName is exported directly (not just via HTTP layer)', () => {
    const { reverseGeocodeDisplayName } = require('../../src/controllers/weather.controller');
    expect(typeof reverseGeocodeDisplayName).toBe('function');
  });

  it('B3-7: returns 400 when lat/lon are missing', async () => {
    const res = await request(app)
      .get('/api/weather/reverse-geocode')
      .set('Authorization', VALID_TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lon/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B5 — Cache staleness: scheduler path does NOT filter by expires_at
// ─────────────────────────────────────────────────────────────────────────────

describe('B5: cache staleness — stale rows returned by scheduler, filtered by API', () => {
  /**
   * Pins the shipped fix (commit 8a130b4): the scheduler's loadWeatherForHorizon
   * in runSchedule.js queries weather_cache WITHOUT an expires_at filter.
   * This means a stale cache row IS returned and the scheduler uses it instead
   * of failing open (which was the original bug: empty map → task unscheduled).
   *
   * The HTTP getForecast endpoint DOES filter (expires_at > now) — it only returns
   * fresh rows to API callers. But the scheduler skips this filter deliberately.
   *
   * We pin:
   *   (a) runSchedule.js source must NOT have an expires_at filter in the
   *       weather cache query (source-inspection characterization) — B5-1.
   *   (b) getForecast's own query DOES include expires_at > now (API freshness
   *       filter is in the cache repo) — B5-2.
   *   (c) A dry_only task is placed when dry weather data is present in
   *       weatherByDateHour (placement behavior characterization) — B5-3.
   *       Note: B5-3 feeds weather data directly to unifiedScheduleV2; it does
   *       NOT call loadWeatherForHorizon or exercise the stale-cache read path.
   *       Stale-row coverage is handled by B5-1 (source pin) and the W-2
   *       repo unit test (knex-weather-cache-repository.unit.test.js).
   */

  it('B5-1: runSchedule.js loadWeatherForHorizon query has NO expires_at filter (source pin)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../../src/scheduler/runSchedule.js'), 'utf8');

    // Find the loadWeatherForHorizon function block
    const fnStart = src.indexOf('async function loadWeatherForHorizon');
    expect(fnStart).toBeGreaterThan(-1);
    // Delimit to next function/end (crude but sufficient: grab ~50 lines past fnStart)
    const fnBody = src.slice(fnStart, fnStart + 2000);

    // Golden pin: NO expires_at filter in the scheduler weather query
    // (the intent is to return ANY cached row, even stale ones)
    expect(fnBody).not.toMatch(/expires_at/);

    // Golden pin: query IS present (not accidentally removed)
    expect(fnBody).toMatch(/weather_cache/);
    expect(fnBody).toMatch(/orderBy.*fetched_at.*desc/);
  });

  it('B5-2: API forecast read path DOES filter by expires_at (only fresh rows) — now in the cache repo', () => {
    // W3: the API freshness filter moved out of the controller and into the
    // slice cache repository (getFreshForecast). The SAME invariant is pinned at
    // its new home: the API read path filters `expires_at > now`, while the
    // scheduler read path (getForecastForScheduler) deliberately does NOT (W-2).
    const fs = require('fs');
    const repoSrc = fs.readFileSync(
      require.resolve('../../src/slices/weather/adapters/KnexWeatherCacheRepository.js'), 'utf8'
    );

    // getFreshForecast (API path) contains the expires_at > now filter.
    const freshFn = repoSrc.slice(
      repoSrc.indexOf('getFreshForecast = function'),
      repoSrc.indexOf('getForecastForScheduler = function')
    );
    expect(freshFn).toMatch(/expires_at.*>.*now/);

    // getForecastForScheduler (scheduler path) must NOT apply an expires_at
    // query filter. The doc comment intentionally MENTIONS expires_at to explain
    // the W-2 invariant, so we strip `//` line comments before asserting there is
    // no actual `.where('expires_at', ...)` call in the executable code.
    const schedFnRaw = repoSrc.slice(
      repoSrc.indexOf('getForecastForScheduler = function'),
      repoSrc.indexOf('putForecast = function')
    );
    const schedFnCode = schedFnRaw.replace(/\/\/[^\n]*/g, '');
    expect(schedFnCode).not.toMatch(/\.where\(\s*['"]expires_at['"]/);

    // And the controller's getForecast now delegates to the facade (thin).
    const ctrlSrc = fs.readFileSync(
      require.resolve('../../src/controllers/weather.controller.js'), 'utf8'
    );
    const forecastFn = ctrlSrc.slice(ctrlSrc.indexOf('exports.getForecast'), ctrlSrc.indexOf('exports.ingest'));
    expect(forecastFn).toMatch(/weather\.getForecast/);
  });

  it('B5-3: dry-constrained task is placed when dry weather data is present in weatherByDateHour', () => {
    /**
     * Causation pin: unifiedScheduleV2 weather-gate drives placement.
     *
     * This test asserts BOTH directions of the weather constraint:
     *   DRY case  — precipProb=5 for all hours → dry_only task IS placed
     *               (found in dayPlacements, absent from unplaced).
     *   WET case  — precipProb=95 for all hours → weatherOk() returns false
     *               for every candidate slot on TODAY → task is NOT placed in
     *               any slot (absent from dayPlacements, present in unplaced
     *               with _unplacedReason='weather').
     *
     * The scheduler code path (unifiedScheduleV2.js):
     *   - weatherOk(): precipProb > 20 with dry_only → false (line 804)
     *   - fail-open guard at line 797 only applies when the dateKey has NO
     *     entry in weatherByDateHour. Both cases here populate all 24 hours
     *     for TODAY so the fail-open never fires.
     *   - An ANYTIME non-recurring task with no deadline uses canExtend to
     *     search future days (line 915). Without a deadline it would roam to
     *     a future day whose weather is unknown (fail-open). To isolate TODAY's
     *     weather gate, we add deadline: TODAY — the scheduler cannot extend
     *     beyond the deadline date, so the WET constraint is decisive.
     *   - unplaced items with weather constraints get _unplacedReason='weather'
     *     (line 1544).
     * nowMins=0 so all of today's morning/afternoon slots are accessible
     * (nowMins=480 would block hours 0-7, which is most of the morning window).
     *
     * What this test does NOT assert:
     *   - It does NOT call loadWeatherForHorizon or touch the cache layer.
     *   - Staleness / fail-open coverage lives in B5-1 (source pin) and the
     *     repo-level W-2 unit test (knex-weather-cache-repository.unit.test.js).
     */
    const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
    const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

    const TODAY = '2026-06-09';

    function makeCfg(precipProb) {
      const byHour = {};
      for (let h = 0; h < 24; h++) {
        byHour[h] = { temp: 72, precipProb, cloudcover: 10, humidity: 40 };
      }
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
        weatherByDateHour: { [TODAY]: byHour }
      };
    }

    // deadline: TODAY prevents the scheduler from roaming to future days where
    // weather data is absent (which would trigger the per-date fail-open at
    // line 797 and place the task regardless of precipitation).
    const task = {
      id: 'b53_weather_task',
      text: 'Outdoor Work',
      date: TODAY,
      deadline: TODAY,
      dur: 60,
      pri: 'P2',
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
      weatherPrecip: 'dry_only',
      weatherCloud: 'any',
      weatherTempMin: 50,
      weatherTempMax: 90,
      weatherHumidityMin: null,
      weatherHumidityMax: 60
    };

    // nowMins=0: no past-slots blocked so morning window (from ~6am=360) is reachable.
    // ── DRY case: precipProb=5 (well below the dry_only threshold of 20) ──
    const dryResult = unifiedSchedule(
      [{ ...task }], { b53_weather_task: '' }, TODAY, 0, makeCfg(5)
    );
    const dryPlacements = Object.values(dryResult.dayPlacements).flat();
    const dryPlaced = dryPlacements.find(p => p.task && p.task.id === 'b53_weather_task');
    // DRY → task must appear in dayPlacements (placed at morning start = 360 min)
    expect(dryPlaced).toBeDefined();
    expect(dryPlaced.start).toBe(360); // morning block begins at 6am
    // DRY → task must NOT be in unplaced
    const dryUnplaced = (dryResult.unplaced || []).find(t => t && t.id === 'b53_weather_task');
    expect(dryUnplaced).toBeUndefined();

    // ── WET case: precipProb=95 (far above the dry_only threshold of 20) ──
    // weatherOk() returns false for every minute of every hour on TODAY.
    // deadline=TODAY prevents extension to future dates → task is left unscheduled.
    const wetResult = unifiedSchedule(
      [{ ...task }], { b53_weather_task: '' }, TODAY, 0, makeCfg(95)
    );
    const wetPlacements = Object.values(wetResult.dayPlacements).flat();
    const wetPlaced = wetPlacements.find(p => p.task && p.task.id === 'b53_weather_task');
    // WET → task must NOT appear in any placement slot
    expect(wetPlaced).toBeUndefined();
    // WET → task must appear in unplaced with reason 'weather'
    const wetUnplaced = (wetResult.unplaced || []).find(t => t && t.id === 'b53_weather_task');
    expect(wetUnplaced).toBeDefined();
    expect(wetUnplaced._unplacedReason).toBe('weather');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B7 — Baseline: current call counts in weather.controller.js
// ─────────────────────────────────────────────────────────────────────────────

describe('B7: thin-controller call-count — weather.controller.js AFTER W3 refactor', () => {
  /**
   * W3 thin-controller target (REFACTOR mode, no behavior change): all weather
   * domain orchestration + external I/O moved into src/slices/weather/. The
   * controller now delegates to the facade, so it contains ZERO getDb()/knex/db(
   * and ZERO fetch() call sites.
   *
   * BEFORE baseline (measured 2026-06-09, pre-W3): 5 getDb() + 3 fetch().
   * AFTER (this leg): 0 / 0 — the facade owns the DB cache; the adapters own the
   * Open-Meteo/Nominatim fetches. These source-inspection pins enforce the
   * thinness goal and would fail loudly if I/O leaked back into the controller.
   *
   * The observable HTTP behavior goldens (B1–B5) above remain byte-identical.
   */
  it('B7-1: weather.controller.js has 0 getDb()/db(/knex call sites (thin controller)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require.resolve('../../src/controllers/weather.controller.js'), 'utf8'
    );
    expect((src.match(/getDb\(/g) || []).length).toBe(0);
    expect((src.match(/\bdb\(/g) || []).length).toBe(0);
    expect((src.match(/\bknex\b/g) || []).length).toBe(0);
  });

  it('B7-2: weather.controller.js has 0 fetch() call sites (thin controller)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require.resolve('../../src/controllers/weather.controller.js'), 'utf8'
    );
    // Count `fetch(` (not `mockFetch(`) — the global fetch call
    const matches = src.match(/\bfetch\(/g) || [];
    // AFTER: all outbound fetches live in the slice adapters
    expect(matches.length).toBe(0);
  });

  it('B7-3: exported symbols from weather.controller.js match expected set (export surface preserved)', () => {
    const controller = require('../../src/controllers/weather.controller');
    const exported = Object.keys(controller).sort();
    // GOLDEN: exactly these exports before refactor
    expect(exported).toEqual([
      'geocode',
      'getForecast',
      'ingest',
      'reverseGeocode',
      'reverseGeocodeDisplayName',
      'roundCoord'
    ]);
  });

  it('B7-4: roundCoord is imported by both runSchedule.js and health.routes.js (cross-module dep pin)', () => {
    const fs = require('fs');
    const runScheduleSrc = fs.readFileSync(
      require.resolve('../../src/scheduler/runSchedule.js'), 'utf8'
    );
    const healthSrc = fs.readFileSync(
      require.resolve('../../src/routes/health.routes.js'), 'utf8'
    );

    // Golden: both files import roundCoord from weather.controller
    expect(runScheduleSrc).toContain("require('../controllers/weather.controller')");
    expect(runScheduleSrc).toContain('roundCoord');
    expect(healthSrc).toContain("require('../controllers/weather.controller')");
    expect(healthSrc).toContain('roundCoord');
  });
});
