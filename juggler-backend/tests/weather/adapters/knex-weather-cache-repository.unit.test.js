/**
 * KnexWeatherCacheRepository unit tests (Wave 2 / W2).
 *
 * Pure unit — a hand-rolled stub Knex builder + stub redis, so NO live DB/Redis.
 * Asserts:
 *   1. Conforms to WEATHER_CACHE_REPOSITORY_PORT_METHODS.
 *   2. INVARIANT W-1: putForecast writes JS `new Date()` timestamps, never a
 *      db.fn.now() raw (proven via a stub that exposes a sentinel db.fn.now()).
 *   3. INVARIANT W-2: getForecastForScheduler returns the latest row WITHOUT an
 *      expires_at filter — a STALE row is returned (no fail-open).
 *      getFreshForecast DOES apply the expires_at > now filter.
 *   4. Reverse-geocode cache: Redis hit/miss + in-memory fallback on Redis-down.
 *
 * Traceability: TRACEABILITY-juggler-hex-h1-weather.md B1, B3, B5 (W-1/W-2).
 */

'use strict';

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', '..', 'src', 'slices', 'weather');
var GeoPoint = require(path.join(SLICE, 'domain', 'value-objects', 'GeoPoint'));
var WeatherConstraint = require(path.join(SLICE, 'domain', 'entities', 'WeatherConstraint'));
var WeatherCacheRepositoryPort = require(path.join(SLICE, 'domain', 'ports', 'WeatherCacheRepositoryPort'));
var KnexWeatherCacheRepository = require(path.join(SLICE, 'adapters', 'KnexWeatherCacheRepository'));

var GOLDEN_FORECAST = {
  hourly: { time: ['2026-05-15T00:00'], temperature_2m: [72] },
  hourly_units: { temperature_2m: '°F' }
};

/**
 * Stub Knex builder. Records the where-clauses, insert payload, and terminal op,
 * and exposes a SENTINEL db.fn.now() so a test can prove it was NOT used.
 *
 * @param {Object} [opts]
 * @param {?Object} [opts.firstRow] value resolved by `.first()`.
 */
function makeKnexStub(opts) {
  var o = opts || {};
  var calls = { table: null, wheres: [], insertPayload: null, deleted: false };

  function builder() {
    return {
      where: function (col, opOrVal, maybeVal) {
        // Supports both .where(col, val) and .where(col, op, val).
        if (arguments.length === 3) calls.wheres.push({ col: col, op: opOrVal, val: maybeVal });
        else calls.wheres.push({ col: col, op: '=', val: opOrVal });
        return this;
      },
      orderBy: function () { return this; },
      first: function () {
        return Promise.resolve(Object.prototype.hasOwnProperty.call(o, 'firstRow') ? o.firstRow : null);
      },
      insert: function (payload) { calls.insertPayload = payload; return Promise.resolve([1]); },
      delete: function () { calls.deleted = true; return Promise.resolve(1); }
    };
  }

  function db(table) { calls.table = table; return builder(); }
  db.fn = { now: function () { return { __knexRawNow: true }; } };

  return { db: db, calls: calls };
}

function makeRedisStub(impl) {
  var i = impl || {};
  return {
    get: i.get || function () { return Promise.resolve(null); },
    set: i.set || function () { return Promise.resolve(true); }
  };
}

function rowFor(forecast, fetchedAt, expiresAt) {
  return {
    fetched_at: fetchedAt,
    expires_at: expiresAt,
    forecast_json: JSON.stringify(forecast)
  };
}

// ── Port conformance ─────────────────────────────────────────────────────────

describe('KnexWeatherCacheRepository — port conformance', function () {
  beforeEach(() => {
    // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
    installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('implements every WEATHER_CACHE_REPOSITORY_PORT_METHODS member', function () {
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: makeRedisStub() });
    WeatherCacheRepositoryPort.WEATHER_CACHE_REPOSITORY_PORT_METHODS.forEach(function (m) {
      expect(typeof repo[m]).toBe('function');
    });
  });
});

// ── INVARIANT W-1: new Date(), never db.fn.now() ─────────────────────────────

describe('KnexWeatherCacheRepository — putForecast (INVARIANT W-1)', function () {
  test('writes JS Date timestamps, NOT a db.fn.now() raw', async function () {
    var stub = makeKnexStub();
    var repo = new KnexWeatherCacheRepository({ db: stub.db, redis: makeRedisStub() });
    var fetchedAt = new Date('2026-05-15T00:00:00Z');
    var expiresAt = new Date('2026-05-15T01:00:00Z');

    await repo.putForecast(
      new GeoPoint(37.77, -122.42),
      WeatherConstraint.fromForecastJson(GOLDEN_FORECAST),
      fetchedAt, expiresAt
    );

    var payload = stub.calls.insertPayload;
    // W-1 core assertions: Dates, identical to what was passed, NOT a raw NOW().
    expect(payload.fetched_at).toBeInstanceOf(Date);
    expect(payload.expires_at).toBeInstanceOf(Date);
    expect(payload.fetched_at).toBe(fetchedAt);
    expect(payload.expires_at).toBe(expiresAt);
    expect(payload.fetched_at.__knexRawNow).toBeUndefined();
    expect(payload.expires_at.__knexRawNow).toBeUndefined();
    expect(payload.fetched_at).not.toEqual(stub.db.fn.now());

    // Grid keys + forecast_json round-trip.
    expect(payload.lat_grid).toBe(37.8);
    expect(payload.lon_grid).toBe(-122.4);
    expect(JSON.parse(payload.forecast_json)).toEqual({
      hourly: GOLDEN_FORECAST.hourly,
      hourly_units: GOLDEN_FORECAST.hourly_units
    });
  });

  test('rejects a non-Date timestamp (guards against a stray raw / string)', function () {
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: makeRedisStub() });
    // The guard throws synchronously (W-1 fail-loud) before any DB call.
    expect(function () {
      repo.putForecast(new GeoPoint(1, 2), WeatherConstraint.fromForecastJson(GOLDEN_FORECAST), 'not-a-date', new Date());
    }).toThrow(/INVARIANT W-1/);
  });
});

// ── INVARIANT W-2: scheduler path returns stale rows ─────────────────────────

describe('KnexWeatherCacheRepository — read paths (INVARIANT W-2)', function () {
  test('getForecastForScheduler returns a STALE row (no expires_at filter)', async function () {
    var pastExpiry = new Date(Date.now() - 60 * 60 * 1000); // expired 1h ago
    var fetchedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    var stub = makeKnexStub({ firstRow: rowFor(GOLDEN_FORECAST, fetchedAt, pastExpiry) });
    var repo = new KnexWeatherCacheRepository({ db: stub.db, redis: makeRedisStub() });

    var result = await repo.getForecastForScheduler(new GeoPoint(37.77, -122.42));

    // W-2: the stale row IS returned (scheduler does not fail open).
    expect(result).toBeInstanceOf(WeatherConstraint);
    expect(result.temperatureAt(0)).toBe(72);

    // W-2 structural pin: NO expires_at where-clause on the scheduler query.
    var expiresWheres = stub.calls.wheres.filter(function (w) { return w.col === 'expires_at'; });
    expect(expiresWheres).toHaveLength(0);
    // Grid keys ARE filtered.
    expect(stub.calls.wheres.some(function (w) { return w.col === 'lat_grid' && w.val === 37.8; })).toBe(true);
    expect(stub.calls.wheres.some(function (w) { return w.col === 'lon_grid' && w.val === -122.4; })).toBe(true);
  });

  test('getForecastForScheduler returns null only when no row exists', async function () {
    var stub = makeKnexStub({ firstRow: null });
    var repo = new KnexWeatherCacheRepository({ db: stub.db, redis: makeRedisStub() });
    var result = await repo.getForecastForScheduler(new GeoPoint(1, 2));
    expect(result).toBeNull();
  });

  test('getFreshForecast DOES apply the expires_at > now filter (API path)', async function () {
    var now = new Date('2026-05-15T00:30:00Z');
    var fetchedAt = new Date('2026-05-15T00:00:00Z');
    var expiresAt = new Date('2026-05-15T01:00:00Z');
    var stub = makeKnexStub({ firstRow: rowFor(GOLDEN_FORECAST, fetchedAt, expiresAt) });
    var repo = new KnexWeatherCacheRepository({ db: stub.db, redis: makeRedisStub() });

    var result = await repo.getFreshForecast(new GeoPoint(37.77, -122.42), now);

    expect(result).toBeInstanceOf(WeatherConstraint);
    // The API path DOES include an expires_at > now where-clause.
    var expiresWhere = stub.calls.wheres.find(function (w) { return w.col === 'expires_at'; });
    expect(expiresWhere).toBeDefined();
    expect(expiresWhere.op).toBe('>');
    expect(expiresWhere.val).toBe(now);
  });

  test('getFreshForecast resolves null on a cache miss', async function () {
    var stub = makeKnexStub({ firstRow: null });
    var repo = new KnexWeatherCacheRepository({ db: stub.db, redis: makeRedisStub() });
    var result = await repo.getFreshForecast(new GeoPoint(1, 2), new Date());
    expect(result).toBeNull();
  });
});

// ── deleteStaleForecasts ─────────────────────────────────────────────────────

describe('KnexWeatherCacheRepository — deleteStaleForecasts', function () {
  test('deletes rows for the grid cell whose expires_at <= olderThan', async function () {
    var stub = makeKnexStub();
    var repo = new KnexWeatherCacheRepository({ db: stub.db, redis: makeRedisStub() });
    var olderThan = new Date('2026-05-15T00:00:00Z');
    await repo.deleteStaleForecasts(new GeoPoint(37.77, -122.42), olderThan);
    expect(stub.calls.deleted).toBe(true);
    var w = stub.calls.wheres.find(function (x) { return x.col === 'expires_at'; });
    expect(w.op).toBe('<=');
    expect(w.val).toBe(olderThan);
  });
});

// ── Reverse-geocode cache ────────────────────────────────────────────────────

describe('KnexWeatherCacheRepository — reverse-geocode cache (B3)', function () {
  test('getReverseGeocode returns the Redis-cached displayName', async function () {
    var redis = makeRedisStub({ get: function () { return Promise.resolve({ displayName: 'Cached City, Cached State' }); } });
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: redis });
    var name = await repo.getReverseGeocode(new GeoPoint(37.77, -122.42));
    expect(name).toBe('Cached City, Cached State');
  });

  test('getReverseGeocode uses the rgeo:<latGrid>:<lonGrid> key', async function () {
    var seenKey = null;
    var redis = makeRedisStub({ get: function (k) { seenKey = k; return Promise.resolve(null); } });
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: redis });
    await repo.getReverseGeocode(new GeoPoint(37.55, -77.46));
    // roundCoord(37.55)=37.6, roundCoord(-77.46)=-77.5.
    expect(seenKey).toBe('rgeo:37.6:-77.5');
  });

  test('getReverseGeocode falls through to the in-memory cache on a Redis miss', async function () {
    var key = new GeoPoint(37.77, -122.42).reverseGeocodeCacheKey();
    var mem = {}; mem[key] = { value: 'Mem City, Mem State', expiresAt: Date.now() + 60000 };
    var redis = makeRedisStub({ get: function () { return Promise.resolve(null); } });
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: redis, memCache: mem });
    var name = await repo.getReverseGeocode(new GeoPoint(37.77, -122.42));
    expect(name).toBe('Mem City, Mem State');
  });

  test('getReverseGeocode returns null on a full miss', async function () {
    var redis = makeRedisStub({ get: function () { return Promise.resolve(null); } });
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: redis, memCache: {} });
    var name = await repo.getReverseGeocode(new GeoPoint(1, 2));
    expect(name).toBeNull();
  });

  test('putReverseGeocode writes Redis with the TTL when Redis is up', async function () {
    var setArgs = null;
    var redis = makeRedisStub({ set: function (k, v, ttl) { setArgs = { k: k, v: v, ttl: ttl }; return Promise.resolve(true); } });
    var mem = {};
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: redis, memCache: mem });
    await repo.putReverseGeocode(new GeoPoint(37.77, -122.42), 'San Francisco, California', 86400);
    expect(setArgs.k).toBe('rgeo:37.8:-122.4');
    expect(setArgs.v).toEqual({ displayName: 'San Francisco, California' });
    expect(setArgs.ttl).toBe(86400);
    // Redis succeeded → no in-memory fallback written.
    expect(Object.keys(mem)).toHaveLength(0);
  });

  test('putReverseGeocode falls back to in-memory when Redis returns falsy', async function () {
    var redis = makeRedisStub({ set: function () { return Promise.resolve(false); } });
    var mem = {};
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: redis, memCache: mem });
    await repo.putReverseGeocode(new GeoPoint(37.77, -122.42), 'SF, CA', 86400);
    var key = new GeoPoint(37.77, -122.42).reverseGeocodeCacheKey();
    expect(mem[key].value).toBe('SF, CA');
    expect(mem[key].expiresAt).toBeGreaterThan(Date.now());
  });

  test('putReverseGeocode does NOT throw when Redis rejects (falls back to memory)', async function () {
    var redis = makeRedisStub({ set: function () { return Promise.reject(new Error('redis down')); } });
    var mem = {};
    var repo = new KnexWeatherCacheRepository({ db: makeKnexStub().db, redis: redis, memCache: mem });
    await expect(repo.putReverseGeocode(new GeoPoint(1, 2), 'X', 100)).resolves.toBeUndefined();
    var key = new GeoPoint(1, 2).reverseGeocodeCacheKey();
    expect(mem[key].value).toBe('X');
  });
});
