'use strict';

/**
 * Shared getNowInTimezone contract — single source of truth for both backend
 * (runSchedule.js) and any read-time consumer (rowToTask computed-overdue path).
 *
 * Returns {todayKey, nowMins, todayDate} for the given IANA timezone, using an
 * optional injected clock so callers can test with a fixed instant.
 *
 * Contract (R50.8):
 *   - todayKey: "YYYY-MM-DD" in the target timezone (h23 calendar day)
 *   - nowMins:  hour*60+minute in the target timezone (0–1439, h23)
 *   - todayDate: Date object for midnight local time (year/month/day in tz)
 *   - Default timezone: 'America/New_York'
 *   - Optional clock: object with .now() → Date (injectable for tests)
 *   - h23 formatting — no AM/PM, 24-hour arithmetic; hour%24 guards the rare
 *     Intl midnight-rollover edge (some engines report hour=24 for 00:00).
 *
 * This module is required by both juggler-backend (CommonJS) and is the
 * logical spec the frontend juggler-frontend/src/utils/timezone.js mirrors
 * (frontend keeps its own ESM copy; no backend require from CRA build).
 *
 * @param {string|null|undefined} timezone - IANA tz string, e.g. 'America/New_York'
 * @param {{ now: () => Date }|null|undefined} clock - optional injected clock
 * @returns {{ todayKey: string, nowMins: number, todayDate: Date }}
 */
var DEFAULT_TIMEZONE = 'America/New_York';

function getNowInTimezone(timezone, clock) {
  var tz = timezone || DEFAULT_TIMEZONE;
  var now = clock ? clock.now() : new Date();

  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(now);

  var vals = {};
  parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });

  var month = vals.month;
  var day = vals.day;
  var year = vals.year;
  var hour = vals.hour % 24;
  var minute = vals.minute;

  var todayKey = year + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
  return {
    todayKey: todayKey,
    nowMins: hour * 60 + minute,
    todayDate: new Date(year, month - 1, day)
  };
}

module.exports = { getNowInTimezone: getNowInTimezone, DEFAULT_TIMEZONE: DEFAULT_TIMEZONE };
