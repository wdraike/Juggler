/**
 * Timezone-aware date helpers for StriveRS frontend.
 *
 * Uses the browser-detected timezone (or manual override) for
 * "today", "now", and UTC ↔ local conversions.
 */

import { formatDateKey } from '../scheduler/dateHelpers';

/**
 * Detect the browser's IANA timezone.
 * @returns {string|null} e.g. 'America/New_York', or null if detection fails
 */
export function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (e) {
    return null;
  }
}

/**
 * Convert a UTC ISO string to local date/time in a target timezone.
 * Used by the "View in..." dropdown for task-level timezone conversion.
 *
 * @param {string} isoString - UTC ISO datetime (e.g. '2026-03-23T18:00:00Z')
 * @param {string} timezone - IANA timezone to display in
 * @returns {{ date: string, time: string, day: string }} local representation
 */
export function convertTimeForDisplay(isoString, timezone) {
  if (!isoString || !timezone) return { date: null, time: null, day: null };
  var d = new Date(isoString);
  if (isNaN(d.getTime())) return { date: null, time: null, day: null };
  var parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(d).forEach(function(p) { parts[p.type] = p.value; });
  var h = parseInt(parts.hour) % 24;
  var m = parseInt(parts.minute);
  var ampm = h >= 12 ? 'PM' : 'AM';
  var dh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return {
    date: parseInt(parts.month) + '/' + parseInt(parts.day),
    time: dh + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm,
    day: parts.weekday
  };
}

/**
 * Get a short timezone abbreviation for display (e.g., 'ET', 'CT', 'PT').
 * @param {string} timezone - IANA timezone
 * @returns {string} abbreviation
 */
export function getTimezoneAbbr(timezone) {
  if (!timezone) return '';
  try {
    var now = new Date();
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, timeZoneName: 'short'
    }).formatToParts(now);
    var tzPart = parts.find(function(p) { return p.type === 'timeZoneName'; });
    return tzPart ? tzPart.value : timezone;
  } catch (e) {
    return timezone;
  }
}

/**
 * Get the current UTC offset for a timezone as a string like "UTC-5" or "UTC+5:30".
 * @param {string} timezone - IANA timezone
 * @returns {string} e.g. "UTC-5", "UTC+0", "UTC+5:30"
 */
export function getUtcOffset(timezone) {
  if (!timezone) return '';
  try {
    var now = new Date();
    // Get local time in the target timezone
    var inTz = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(now).forEach(function(p) { inTz[p.type] = parseInt(p.value, 10); });
    // Get UTC time
    var utcH = now.getUTCHours();
    var utcM = now.getUTCMinutes();
    var utcDay = now.getUTCDate();
    var tzH = inTz.hour % 24;
    var tzM = inTz.minute;
    var tzDay = inTz.day;
    // Compute offset in minutes
    var offsetMins = (tzH * 60 + tzM) - (utcH * 60 + utcM);
    if (tzDay > utcDay) offsetMins += 1440;
    else if (tzDay < utcDay) offsetMins -= 1440;
    // Format
    var sign = offsetMins >= 0 ? '+' : '-';
    var absH = Math.floor(Math.abs(offsetMins) / 60);
    var absM = Math.abs(offsetMins) % 60;
    if (absM > 0) return 'UTC' + sign + absH + ':' + (absM < 10 ? '0' : '') + absM;
    return 'UTC' + sign + absH;
  } catch (e) {
    return '';
  }
}

/**
 * Hydrate local date/time/day fields on tasks from their UTC scheduledAt.
 * Called after loading tasks from the API so display components can read
 * task.date, task.time, task.day without knowing about timezones.
 *
 * @param {Array} tasks - Array of task objects with scheduledAt (UTC ISO string)
 * @param {string} timezone - IANA timezone for local conversion
 * @returns {Array} Same tasks array with date/time/day fields populated
 */
export function hydrateTaskTimezones(tasks, timezone) {
  if (!tasks || !timezone) return tasks;
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (t.scheduledAt) {
      var local = convertTimeForDisplay(t.scheduledAt, timezone);
      if (local.date) {
        t.date = local.date;
        t.time = local.time;
        t.day = local.day;
      }
    }
  }
  return tasks;
}

/**
 * Get "today" and "now" in the given timezone.
 * Falls back to browser local time if timezone is null/undefined.
 *
 * @param {string|null} timezone - IANA timezone (e.g. 'America/New_York')
 * @returns {{ todayKey: string, todayDate: Date, nowMins: number }}
 */
export function getNowInTimezone(timezone) {
  var now = new Date();

  if (!timezone) {
    return {
      todayKey: formatDateKey(now),
      todayDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      nowMins: now.getHours() * 60 + now.getMinutes()
    };
  }

  var parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(now).forEach(function(p) { parts[p.type] = parseInt(p.value, 10); });

  var month = parts.month;
  var day = parts.day;
  var year = parts.year;
  var hour = parts.hour % 24;
  var minute = parts.minute;

  return {
    todayKey: year + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day,
    todayDate: new Date(year, month - 1, day),
    nowMins: hour * 60 + minute
  };
}
