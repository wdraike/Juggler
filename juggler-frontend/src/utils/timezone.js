/**
 * Timezone-aware date helpers for StriveRS frontend.
 *
 * Uses the user's profile timezone (from AuthContext) instead of
 * the browser's local timezone for "today" and "now" calculations.
 */

import { formatDateKey } from '../scheduler/dateHelpers';

/**
 * Get "today" and "now" in the user's profile timezone.
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
    todayKey: month + '/' + day,
    todayDate: new Date(year, month - 1, day),
    nowMins: hour * 60 + minute
  };
}
