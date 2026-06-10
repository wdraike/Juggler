---
type: explanation
status: active
version: leg/juggler-hex-h1-weather @ 2026-06-09
Last-updated: 2026-06-09
---

# Weather Slice

Hexagonal (ports-and-adapters) vertical slice for all weather domain
functionality. Phase H1 of the juggler hex migration — the second real domain
slice, and the smallest self-contained one.

External code must import only `slices/weather/facade` (or `slices/weather`).
Imports of slice internals (adapters, ports, entities, value-objects) from
outside the slice are forbidden by the active ESLint boundary rule
(`npm run lint:boundaries`).

---

## Structure

```
slices/weather/
├── domain/
│   ├── entities/
│   │   └── WeatherConstraint.js        # Domain entity — hourly forecast carrier
│   ├── ports/
│   │   ├── WeatherProviderPort.js      # Driven-port: fetch forecast from upstream
│   │   ├── GeocodePort.js              # Driven-port: forward + reverse geocoding
│   │   └── WeatherCacheRepositoryPort.js # Driven-port: forecast + reverse-geocode cache
│   └── value-objects/
│       └── GeoPoint.js                 # Immutable lat/lon VO with 0.1°-grid keying
├── adapters/
│   ├── OpenMeteoWeatherAdapter.js      # WeatherProviderPort backed by Open-Meteo API
│   ├── NominatimGeocodeAdapter.js      # GeocodePort backed by Open-Meteo geocode + Nominatim
│   ├── MockWeatherProvider.js          # Test double for WeatherProviderPort
│   ├── KnexWeatherCacheRepository.js   # WeatherCacheRepositoryPort backed by weather_cache table + Redis
│   ├── fetchWithTimeout.js             # AbortController wrapper (B6 resilience) — 8 s budget
│   └── constants.js                    # Upstream URLs, TTLs, timeout budget
├── facade.js                           # Public API — wires adapters + exposes operations
└── index.js                            # Re-exports facade + `{ weather: facade }` namespace
```

---

## Ports

### WeatherProviderPort

Single method: `fetchForecast(point: GeoPoint) → Promise<WeatherConstraint>`.

Fetches a 14-day hourly forecast (Fahrenheit, `forecast_days=14`,
`timezone=auto`) for the grid point. Implementations must preserve the
Fahrenheit contract — all cached forecasts are stored in Fahrenheit and the
scheduler assumes it.

Contract methods: `['fetchForecast']`

### GeocodePort

Two methods:

| Method | Description |
|--------|-------------|
| `forwardGeocode(query)` | Resolve a place name to `{ lat, lon, displayName }`. Throws with `.code === 'NOT_FOUND'` on empty results. |
| `reverseGeocode(point)` | Resolve coordinates to a display-name string (city, state). Un-cached upstream lookup — caching is `WeatherCacheRepositoryPort`'s concern. |

Contract methods: `['forwardGeocode', 'reverseGeocode']`

### WeatherCacheRepositoryPort

Six methods covering two distinct caches:

**Forecast cache** (`weather_cache` table, keyed by 0.1°-grid lat/lon):

| Method | Description |
|--------|-------------|
| `getFreshForecast(point, now)` | API read path — returns latest row only if `expires_at > now`; null on miss/stale. |
| `getForecastForScheduler(point)` | Scheduler read path — returns latest row **regardless of expiry** (invariant W-2: stale rows are intentionally returned to avoid silent fail-open). |
| `putForecast(point, forecast, fetchedAt, expiresAt)` | Insert a forecast row. `fetchedAt`/`expiresAt` must be JS `Date` objects (invariant W-1). |
| `deleteStaleForecasts(point, olderThan)` | Delete rows where `expires_at <= olderThan`. Fire-and-forget; must not throw. |

**Reverse-geocode cache** (Redis 24h TTL, key `rgeo:<latGrid>:<lonGrid>`, in-memory fallback):

| Method | Description |
|--------|-------------|
| `getReverseGeocode(point)` | Read cached display name; null on miss. Checks Redis then in-memory. |
| `putReverseGeocode(point, displayName, ttlSeconds)` | Cache display name. Writes Redis; falls back to in-memory on Redis failure. Must not throw. |

Contract methods: `['getFreshForecast', 'getForecastForScheduler', 'putForecast', 'deleteStaleForecasts', 'getReverseGeocode', 'putReverseGeocode']`

**Binding invariants:**

- **W-1 (timestamps via `new Date()`, never `db.fn.now()`):** All timestamp columns must be written with JS `Date` values. A `db.fn.now()` Knex builder embedded in a row object fails circular-JSON serialization when `forecast_json` is later stringified (surfaced as a hard cache-write failure 2026-05-12).
- **W-2 (no expiry filter on scheduler read path):** `getForecastForScheduler` must not filter on `expires_at`. Filtering would return an empty map when the cache is stale, causing weather-constrained tasks to silently fail open to "unscheduled". Do not "fix" this asymmetry.

---

## Adapters

### OpenMeteoWeatherAdapter

Implements `WeatherProviderPort`. Calls the Open-Meteo forecast API at
`https://api.open-meteo.com/v1/forecast` for a 14-day hourly Fahrenheit
forecast. All outbound HTTP calls go through `fetchWithTimeout` (8 s
AbortController budget — B6 resilience).

### NominatimGeocodeAdapter

Implements `GeocodePort`. Forward geocode uses the Open-Meteo geocoding API
(`https://geocoding-api.open-meteo.com/v1/search`). Reverse geocode uses
Nominatim (`https://nominatim.openstreetmap.org/reverse`) with the required
`User-Agent: Juggler/1.0 (task-scheduling-app)` header. Both calls go through
`fetchWithTimeout` (8 s budget).

### MockWeatherProvider

Implements `WeatherProviderPort`. Returns a configurable in-memory forecast
for tests. Not in the default facade wiring — import directly in tests.

### KnexWeatherCacheRepository

Implements `WeatherCacheRepositoryPort`. Forecast operations use the
`weather_cache` table via `lib/db`. Reverse-geocode operations use Redis
(`lib/redis.js`) with an in-memory fallback map for when Redis is unavailable.

### fetchWithTimeout

Utility used by `OpenMeteoWeatherAdapter` and `NominatimGeocodeAdapter`. Wraps
a `fetch` call with an `AbortController` that fires after
`EXTERNAL_CALL_TIMEOUT_MS` (8 s). Both the abort signal and a racing timer
rejection are used so that a `fetch` implementation that ignores the signal
still produces a deterministic `ETIMEDOUT` rejection within the budget.
The `fetchImpl` and `timerImpl` dependencies are injectable for unit tests.

---

## Facade

`slices/weather/facade.js` is the single public API the controller imports.
It wires the three default production adapters (`OpenMeteoWeatherAdapter`,
`NominatimGeocodeAdapter`, `KnexWeatherCacheRepository`) and exposes:

| Export | Description |
|--------|-------------|
| `getForecast(lat, lon, opts?)` | Cache lookup (fresh only); on miss fetches from Open-Meteo, inserts, fire-and-forget stale cleanup. Returns `{ hourly, hourly_units, cachedAt, expiresAt, refreshed? }` or `{ miss: true }` for `cacheOnly` misses. |
| `ingest(body)` | Store a client-supplied forecast. Validation stays in the controller. Returns `{ cachedAt, expiresAt }`. |
| `geocode(query)` | Forward geocode — returns `{ lat, lon, displayName }`. Throws with `.code === 'NOT_FOUND'` on empty results. |
| `reverseGeocode(lat, lon)` | Cached reverse geocode — returns `{ displayName }`. |
| `reverseGeocodeDisplayName(lat, lon)` | Same as `reverseGeocode` but returns the string directly (used by `config.controller.js`). |
| `roundCoord` / `gridValue` | `GeoPoint.gridValue` re-export — bit-identical to the legacy `roundCoord` in `weather.controller.js`. Drives cache keys and the scheduler weather-match. |
| `GeoPoint`, `WeatherConstraint`, `WeatherProviderPort`, `GeocodePort`, `WeatherCacheRepositoryPort` | Named domain exports for test wiring. |
| `OpenMeteoWeatherAdapter`, `NominatimGeocodeAdapter`, `MockWeatherProvider`, `KnexWeatherCacheRepository` | Named adapter exports (mirror calendar facade). |

The `weather.controller.js` has zero DB-access call sites and zero outbound-fetch
call sites — all I/O lives in the slice adapters (pinned by H1 B7 AFTER
assertions).

`roundCoord` and `reverseGeocodeDisplayName` are re-exported by the controller
(by reference) so cross-module consumers (`scheduler/runSchedule.js`,
`routes/health.routes.js`, `controllers/config.controller.js`) keep resolving
without change.

---

## Architecture Boundary

The ESLint boundary rule (`eslint.boundaries.config.js`, run via
`npm run lint:boundaries`) enforces that external code imports only the facade,
never slice internals. Direct imports of `slices/weather/adapters/*`,
`slices/weather/domain/ports/*`, `slices/weather/domain/entities/*`, or
`slices/weather/domain/value-objects/*` from outside the slice are a lint
error.

The weather boundary rule covers value-objects (unlike the calendar slice's
known gap). External code needing `GeoPoint` or `roundCoord/gridValue` must
import from `slices/weather/facade` or `slices/weather`.

---

## Usage

### Importing the facade

```javascript
// Namespaced (matches index.js `{ weather: facade }` export)
const { weather } = require('./slices/weather');
const result = await weather.getForecast(lat, lon);

// Direct
const weather = require('./slices/weather/facade');
const result = await weather.getForecast(lat, lon);
```

### Forecast lookup

```javascript
const { weather } = require('./slices/weather');

// Cache + refresh
const result = await weather.getForecast(40.7, -74.0);
// { hourly, hourly_units, cachedAt, expiresAt } or { ...refreshed: true }

// Cache-only (no upstream fetch)
const cached = await weather.getForecast(40.7, -74.0, { cacheOnly: true });
// { miss: true } on cache miss
```

### Geocoding

```javascript
const { weather } = require('./slices/weather');

// Forward geocode
const place = await weather.geocode('Austin, TX');
// { lat: 30.2672, lon: -97.7431, displayName: 'Austin, Texas, United States' }

// Reverse geocode
const name = await weather.reverseGeocodeDisplayName(30.2672, -97.7431);
// 'Austin, Texas'
```

### Using MockWeatherProvider in tests

```javascript
const { MockWeatherProvider } = require('./slices/weather');

const mock = new MockWeatherProvider({ hourly: { time: [...], temperature_2m: [...] } });
// inject mock as provider in the unit under test
```

---

## Testing

Run via test-bed:

```bash
cd test-bed && make test-juggler
```

The weather suite covers:

- Contract tests asserting every adapter satisfies its port's method list
- `KnexWeatherCacheRepository` — `getFreshForecast` vs `getForecastForScheduler` asymmetry (W-2); W-1 timestamp invariant
- `fetchWithTimeout` — timeout fires on a hung fetch; happy path returns response unchanged
- Behavior characterization (B5/B7): controller is 0-DB / 0-fetch after H1; cache behavior bit-identical to the legacy controller

---

## Dependencies

The slice adapters delegate to:

- `lib/db` — Knex DB access (`KnexWeatherCacheRepository`)
- `lib/redis.js` — Redis client for reverse-geocode cache (`KnexWeatherCacheRepository`)
- `@raike/lib-logger` — structured logging (`facade.js`)
- External upstream APIs: Open-Meteo (forecast + geocode), Nominatim (reverse geocode)
