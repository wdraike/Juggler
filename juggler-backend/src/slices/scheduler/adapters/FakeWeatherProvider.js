/**
 * FakeWeatherProvider — a deterministic, scriptable test double that implements
 * WeatherProviderPort for the scheduler slice. It serves the same purpose as
 * MockWeatherProvider in the weather slice, but exposes a simpler surface
 * tailored to scheduler tests: setHour, setRange, setEmpty, setNoData.
 *
 * Construction:
 *   new FakeWeatherProvider() → returns an empty forecast map.
 *
 * Usage patterns:
 *   weather.setHour('2026-06-15', 9, { temp: 95, precipProb: 0, cloudcover: 0, humidity: 20 });
 *   weather.setRange('2026-06-15', 7, (dk, h) => ({ temp: 72, precipProb: h >= 14 ? 80 : 5 }));
 *   weather.setEmpty(); // fail-open: scheduler treats missing weather as OK
 *   weather.setNoData(); // same as setEmpty (no location with coords)
 *
 * Fail-open invariant: loadWeatherForHorizon returns {} when no data is set,
 * matching the scheduler's legacy behavior (no coords → {}; no cache row → {}).
 */

'use strict';

var WEATHER_PROVIDER_PORT_METHODS = require('../domain/ports/WeatherProviderPort').WEATHER_PROVIDER_PORT_METHODS;

/**
 * @constructor
 */
function FakeWeatherProvider() {
  this._weatherMap = {}; // { [dateKey]: { [hour]: { temp, precipProb, cloudcover, humidity } } }
}

/**
 * Build `weatherByDateHour` from the internal map.
 * Returns {} (fail-open) when no weather has been set.
 *
 * @param {Object[]} _locations ignored (FakeWeatherProvider uses its internal map)
 * @param {Function} [_db] ignored
 * @returns {Promise<Object>} weatherByDateHour map
 */
FakeWeatherProvider.prototype.loadWeatherForHorizon = async function loadWeatherForHorizon(_locations, _db) {
  return this._weatherMap;
};

/**
 * Set weather for a specific (dateKey, hour).
 * @param {string} dateKey  "2026-06-15"
 * @param {number} hour     0-23
 * @param {Object} data     { temp, precipProb, cloudcover, humidity }
 */
FakeWeatherProvider.prototype.setHour = function setHour(dateKey, hour, data) {
  if (!this._weatherMap[dateKey]) this._weatherMap[dateKey] = {};
  this._weatherMap[dateKey][hour] = data;
};

/**
 * Set all hours in a date range to the same weather pattern.
 * @param {string} startDate  "2026-06-15"
 * @param {number} days       Number of days
 * @param {Function} pattern  (dateKey, hour) => { temp, precipProb, cloudcover, humidity }
 */
FakeWeatherProvider.prototype.setRange = function setRange(startDate, days, pattern) {
  var d = new Date(startDate);
  for (var i = 0; i < days; i++) {
    var dk = d.toISOString().slice(0, 10);
    for (var h = 0; h < 24; h++) {
      this.setHour(dk, h, pattern(dk, h));
    }
    d.setDate(d.getDate() + 1);
  }
};

/** Return empty map → triggers fail-open behavior in scheduler. */
FakeWeatherProvider.prototype.setEmpty = function setEmpty() {
  this._weatherMap = {};
};

/** Return null → simulates no location with coords → fail-open. */
FakeWeatherProvider.prototype.setNoData = function setNoData() {
  // loadWeatherForHorizon returns {} when no location has coords
  this._weatherMap = {};
};

module.exports = FakeWeatherProvider;
module.exports.FakeWeatherProvider = FakeWeatherProvider;
module.exports.WEATHER_PROVIDER_PORT_METHODS = WEATHER_PROVIDER_PORT_METHODS;