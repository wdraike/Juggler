/**
 * GeoPoint — value object wrapping a latitude/longitude pair.
 *
 * The forecast cache, the reverse-geocode cache, and the scheduler weather-match
 * all key on a 0.1°-rounded "grid" coordinate so that nearby requests collapse to
 * the same cache cell. That grid-keying logic lives today in
 * `src/controllers/weather.controller.js` as:
 *
 *     function roundCoord(v) { return Math.round(parseFloat(v) * 10) / 10; }
 *
 * GeoPoint folds in that EXACT logic via {@link GeoPoint.gridValue}. The behavior
 * is bit-identical to the legacy `roundCoord`, including:
 *   - string coercion: `gridValue('1.23')` parses via parseFloat exactly as the
 *     legacy code does (so a DB/query string and its numeric form key the same).
 *   - the IEEE-754 negative-zero edge: `gridValue(-0.05) === -0`. Math.round(-0.5)
 *     is 0 (ties round toward +Infinity in JS), and `0 / 10` would be +0, but
 *     `Math.round(-0.05 * 10)` is `Math.round(-0.5)` = `-0`... see note below.
 *
 * NEGATIVE-ZERO NOTE: `roundCoord(-0.05)` evaluates `Math.round(-0.05 * 10) / 10`
 *   = `Math.round(-0.5) / 10`. In JS `Math.round(-0.5)` returns `-0` (it rounds
 *   half toward +Infinity, and for the -0.5 → 0 case preserves the sign as -0),
 *   and `-0 / 10` is `-0`. So the golden output is `-0` (which `===` 0 but is
 *   distinguishable via Object.is). GeoPoint must reproduce this exactly — which
 *   it does by performing the identical arithmetic with no normalization.
 *
 * Construction stores the raw lat/lon as given (numbers or strings the caller
 * passed). It does NOT eagerly coerce or round — grid values are derived on
 * demand so the VO can also be constructed from already-numeric API coordinates
 * without altering them. Mirrors the EventId / ProviderType VO style.
 */

/**
 * Behavior-identical fold of `weather.controller.js`'s `roundCoord`.
 *
 * IMPORTANT: this must remain a verbatim copy of the legacy arithmetic
 * (`Math.round(parseFloat(v) * 10) / 10`). Any change — including a guard, a
 * `+ 0` normalization, or a `Number()` swap for `parseFloat` — would alter the
 * grid key for some input and silently desync the forecast cache, the
 * reverse-geocode cache key, and the scheduler weather-match. Do not "clean it up".
 *
 * @param {(number|string)} v Latitude or longitude (numeric, or a string the
 *   legacy code accepted via parseFloat — e.g. a query-string param).
 * @returns {number} The 0.1°-rounded grid coordinate. May be `-0` for inputs
 *   like `-0.05` (golden behavior — see file header).
 */
function gridValue(v) {
  return Math.round(parseFloat(v) * 10) / 10;
}

/**
 * @param {(number|string)} lat Latitude (raw — not rounded on construction).
 * @param {(number|string)} lon Longitude (raw — not rounded on construction).
 */
function GeoPoint(lat, lon) {
  this.lat = lat;
  this.lon = lon;
  Object.freeze(this);
}

/**
 * Behavior-identical fold of `roundCoord` (see file header). Exposed as a static
 * so callers can grid-key a raw coordinate without constructing a GeoPoint.
 * @type {(v: (number|string)) => number}
 */
GeoPoint.gridValue = gridValue;

/**
 * Grid latitude — 0.1°-rounded via {@link GeoPoint.gridValue}.
 * @returns {number}
 */
GeoPoint.prototype.latGrid = function latGrid() {
  return GeoPoint.gridValue(this.lat);
};

/**
 * Grid longitude — 0.1°-rounded via {@link GeoPoint.gridValue}.
 * @returns {number}
 */
GeoPoint.prototype.lonGrid = function lonGrid() {
  return GeoPoint.gridValue(this.lon);
};

/**
 * The reverse-geocode cache key — `rgeo:<latGrid>:<lonGrid>` — matching the
 * legacy `'rgeo:' + roundCoord(lat) + ':' + roundCoord(lon)` exactly (including
 * how `-0` string-coerces, since `String(-0)` is `'0'`).
 * @returns {string}
 */
GeoPoint.prototype.reverseGeocodeCacheKey = function reverseGeocodeCacheKey() {
  return 'rgeo:' + this.latGrid() + ':' + this.lonGrid();
};

/**
 * Value equality on grid coordinates (two points in the same 0.1° cell are
 * equal). Uses grid values so callers comparing cache cells get the intended
 * bucketing.
 * @param {*} other
 * @returns {boolean}
 */
GeoPoint.prototype.equals = function equals(other) {
  return other instanceof GeoPoint &&
    other.latGrid() === this.latGrid() &&
    other.lonGrid() === this.lonGrid();
};

/**
 * Factory. Returns the input unchanged if it is already a GeoPoint.
 * @param {(GeoPoint|{lat:(number|string), lon:(number|string)})} value
 * @returns {GeoPoint}
 */
GeoPoint.from = function from(value) {
  if (value instanceof GeoPoint) return value;
  return new GeoPoint(value.lat, value.lon);
};

module.exports = GeoPoint;
