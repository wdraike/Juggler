/**
 * WeatherConstraint — plain domain entity carrying a normalized hourly forecast
 * for one grid cell, the data the weather controller currently passes around.
 *
 * The legacy controller moves an Open-Meteo (or ingested) forecast payload of
 * the shape `{ hourly, hourly_units }` between the provider/cache and the HTTP
 * response, and the scheduler consumes per-hour `temperature_2m` (Fahrenheit) to
 * weather-match tasks. This entity models that payload as a pure data carrier so
 * the W2/W3 layers can pass a typed object instead of a raw JSON blob.
 *
 * BEHAVIOR-PRESERVING (W1): construction is tolerant and non-throwing for every
 * shape the controller already handles. It does NOT validate the array contents
 * (that is `validateIngest`'s job in the controller and stays there) and it does
 * NOT convert temperature units — all cached forecasts are stored in Fahrenheit
 * and this entity preserves that contract (see migration
 * 20260509000400_normalize_weather_temp_to_fahrenheit.js). Missing fields default
 * the same way the controller does:
 *   - `hourly_units` missing → `{}` (matches `req.body.hourly_units || {}` on ingest)
 *   - `hourly` missing → `null` (carrier holds whatever it was given)
 *
 * The optional cache-envelope fields (`fetchedAt` / `expiresAt`) mirror the
 * `cachedAt` / `expiresAt` the controller attaches to a cache row; they are
 * carried when present so the cache/response layers lose no information.
 */

/**
 * @param {Object} [props]
 * @param {?Object} [props.hourly]
 *   The hourly forecast object: parallel arrays keyed `time`, `temperature_2m`,
 *   `precipitation_probability`, `precipitation`, `cloudcover`, `weathercode`,
 *   `relativehumidity_2m`. Shape is preserved verbatim — not copied or reshaped.
 * @param {?Object} [props.hourlyUnits]
 *   Unit labels for the hourly arrays (e.g. `{ temperature_2m: '°F' }`).
 * @param {?(Date|string)} [props.fetchedAt]
 *   When the forecast was fetched/cached (the cache row's `fetched_at`). Optional.
 * @param {?(Date|string)} [props.expiresAt]
 *   Cache expiry (`expires_at`). Optional — note the scheduler load path
 *   deliberately ignores expiry (stale rows are still usable).
 */
function WeatherConstraint(props) {
  var p = props || {};
  this.hourly = p.hourly != null ? p.hourly : null;
  // Mirrors `req.body.hourly_units || {}` on the ingest path.
  this.hourlyUnits = p.hourlyUnits != null ? p.hourlyUnits : {};
  this.fetchedAt = p.fetchedAt != null ? p.fetchedAt : null;
  this.expiresAt = p.expiresAt != null ? p.expiresAt : null;
}

/**
 * The Fahrenheit temperature at hour index `i`, or null when absent.
 * Non-throwing — returns null rather than indexing into a missing array, so the
 * scheduler's per-hour read is preserved without introducing a crash path.
 * @param {number} i Hour index into the parallel `hourly` arrays.
 * @returns {?number}
 */
WeatherConstraint.prototype.temperatureAt = function temperatureAt(i) {
  if (!this.hourly || !Array.isArray(this.hourly.temperature_2m)) return null;
  var v = this.hourly.temperature_2m[i];
  return typeof v === 'number' ? v : null;
};

/**
 * Number of hours in the forecast (length of the `time` array), or 0 when no
 * hourly data is present.
 * @returns {number}
 */
WeatherConstraint.prototype.hourCount = function hourCount() {
  if (!this.hourly || !Array.isArray(this.hourly.time)) return 0;
  return this.hourly.time.length;
};

/**
 * Serialize back to the `{ hourly, hourly_units }` shape the controller and the
 * cache store/read paths use. Bit-for-bit the payload the legacy code persists
 * as `forecast_json` and returns from the HTTP layer.
 * @returns {{hourly: ?Object, hourly_units: Object}}
 */
WeatherConstraint.prototype.toForecastJson = function toForecastJson() {
  return { hourly: this.hourly, hourly_units: this.hourlyUnits };
};

/**
 * Build a WeatherConstraint from a stored/fetched forecast payload of the shape
 * `{ hourly, hourly_units }` (the legacy `forecast_json` / Open-Meteo shape).
 * @param {{hourly?: ?Object, hourly_units?: ?Object}} forecast
 * @param {{fetchedAt?: ?(Date|string), expiresAt?: ?(Date|string)}} [envelope]
 * @returns {WeatherConstraint}
 */
WeatherConstraint.fromForecastJson = function fromForecastJson(forecast, envelope) {
  var f = forecast || {};
  var e = envelope || {};
  return new WeatherConstraint({
    hourly: f.hourly != null ? f.hourly : null,
    hourlyUnits: f.hourly_units != null ? f.hourly_units : {},
    fetchedAt: e.fetchedAt != null ? e.fetchedAt : null,
    expiresAt: e.expiresAt != null ? e.expiresAt : null
  });
};

/**
 * Factory. Returns the input unchanged if it is already a WeatherConstraint.
 * @param {Object} props
 * @returns {WeatherConstraint}
 */
WeatherConstraint.from = function from(props) {
  if (props instanceof WeatherConstraint) return props;
  return new WeatherConstraint(props);
};

module.exports = WeatherConstraint;
