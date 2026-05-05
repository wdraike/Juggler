/**
 * weatherMatch.js
 * Utilities for matching task weather requirements against a forecast day.
 */

/**
 * Returns true if the task has any non-default weather restriction set.
 *
 * @param {object} task
 * @param {string|undefined} task.weatherPrecip  - 'any'|'wet_ok'|'light_ok'|'dry_only'
 * @param {string|undefined} task.weatherCloud   - 'any'|'overcast_ok'|'partly_ok'|'clear'
 * @param {number|null|undefined} task.weatherTempMin
 * @param {number|null|undefined} task.weatherTempMax
 * @returns {boolean}
 */
export function hasWeatherRestrictions(task) {
  return (task.weatherPrecip && task.weatherPrecip !== 'any')
    || (task.weatherCloud && task.weatherCloud !== 'any')
    || task.weatherTempMin != null
    || task.weatherTempMax != null
    || task.weatherHumidityMin != null
    || task.weatherHumidityMax != null;
}

/**
 * Checks whether a forecast day satisfies a task's weather requirements.
 *
 * @param {object} task
 * @param {string|undefined} task.weatherPrecip
 * @param {string|undefined} task.weatherCloud
 * @param {number|null|undefined} task.weatherTempMin
 * @param {number|null|undefined} task.weatherTempMax
 *
 * @param {object|null|undefined} weatherDay
 * @param {number} weatherDay.high        - forecast high temp (°F)
 * @param {number} weatherDay.low         - forecast low temp (°F)
 * @param {number} weatherDay.precipPct   - precipitation chance 0-100
 * @param {number} weatherDay.code        - WMO weather code
 * @param {Array}  weatherDay.hourly      - hourly entries { hour, temp, precipProb, cloudcover, code }
 *
 * @returns {{ ok: boolean|null, reason: string|null }}
 *   ok: null  → no forecast available
 *   ok: true  → all conditions satisfied
 *   ok: false → first failing condition; reason contains human-readable explanation
 */
export function checkWeatherMatch(task, weatherDay) {
  if (weatherDay == null) {
    return { ok: null, reason: null };
  }

  const { precipPct, high, low, hourly = [], humidityAvg } = weatherDay;
  const { weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax, weatherHumidityMin, weatherHumidityMax } = task;

  // --- Precipitation checks ---
  if (weatherPrecip && weatherPrecip !== 'any') {
    if (weatherPrecip === 'dry_only' && precipPct >= 30) {
      return {
        ok: false,
        reason: `${Math.round(precipPct)}% rain chance — requires dry conditions`,
      };
    }
    if (weatherPrecip === 'light_ok' && precipPct >= 60) {
      return {
        ok: false,
        reason: `${Math.round(precipPct)}% rain chance — requires light rain or less`,
      };
    }
    if (weatherPrecip === 'wet_ok' && precipPct >= 90) {
      return {
        ok: false,
        reason: `${Math.round(precipPct)}% rain chance — heavy rain expected`,
      };
    }
  }

  // --- Cloud cover checks ---
  if (weatherCloud && weatherCloud !== 'any') {
    const daytimeHours = hourly.filter(h => h.hour >= 8 && h.hour <= 18);
    let cloudCoverDaytime = 0;
    if (daytimeHours.length > 0) {
      cloudCoverDaytime =
        daytimeHours.reduce((sum, h) => sum + h.cloudcover, 0) / daytimeHours.length;
    }

    if (weatherCloud === 'clear' && cloudCoverDaytime > 20) {
      return { ok: false, reason: 'Too cloudy — requires clear sky' };
    }
    if (weatherCloud === 'partly_ok' && cloudCoverDaytime > 60) {
      return { ok: false, reason: 'Too cloudy — requires partly cloudy or better' };
    }
    if (weatherCloud === 'overcast_ok' && cloudCoverDaytime > 90) {
      return { ok: false, reason: 'Fully overcast — requires overcast or better' };
    }
  }

  // --- Temperature checks ---
  if (weatherTempMin != null && low < weatherTempMin) {
    return {
      ok: false,
      reason: `Temp below minimum (${weatherTempMin}° min, forecast low ${Math.round(low)}°)`,
    };
  }
  if (weatherTempMax != null && high > weatherTempMax) {
    return {
      ok: false,
      reason: `Temp above maximum (${weatherTempMax}° max, forecast high ${Math.round(high)}°)`,
    };
  }

  // --- Humidity checks ---
  if (humidityAvg != null) {
    if (weatherHumidityMin != null && humidityAvg < weatherHumidityMin) {
      return {
        ok: false,
        reason: `Humidity below minimum (${weatherHumidityMin}% min, forecast avg ${Math.round(humidityAvg)}%)`,
      };
    }
    if (weatherHumidityMax != null && humidityAvg > weatherHumidityMax) {
      return {
        ok: false,
        reason: `Humidity above maximum (${weatherHumidityMax}% max, forecast avg ${Math.round(humidityAvg)}%)`,
      };
    }
  }

  return { ok: true, reason: null };
}
