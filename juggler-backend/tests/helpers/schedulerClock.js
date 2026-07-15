'use strict';

/**
 * 999.1632 — fixture clock anchored to the PRODUCT's own calendar.
 *
 * The scheduler's notion of "today" is process-TZ independent: it comes from
 * shared/scheduler/getNowInTimezone(options.timezone || 'America/New_York')
 * (Intl-based, not `new Date()` local getters). Fixtures that instead compute
 * "today"/"yesterday"/"tomorrow" with process-local `new Date()` getters (or
 * raw `toISOString()` UTC slicing) disagree with the product's calendar
 * whenever the process runs under a different TZ (CI containers run UTC) OR
 * during the daily window where the process's own calendar day has already
 * rolled over but America/New_York's hasn't (00:00–04:00/05:00 UTC).
 *
 * This helper is the SINGLE source of truth for fixture date math: it derives
 * every key from the real production `getNowInTimezone` (no reimplementation)
 * and does the +/- N day arithmetic in UTC-epoch space so the arithmetic
 * itself never depends on process TZ — only the anchor ("today") does, and
 * that anchor is the product's own.
 */

var getNowInTimezone = require('../../../shared/scheduler/getNowInTimezone').getNowInTimezone;

var DEFAULT_TIMEZONE = 'America/New_York';
var MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function parseDateKey(dateKey) {
  var parts = dateKey.split('-');
  return { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10), day: parseInt(parts[2], 10) };
}

function formatDateKey(year, month, day) {
  return year + '-' + pad(month) + '-' + pad(day);
}

/**
 * The product's calendar day, `n` days from "today" (n may be 0/negative/
 * positive), as a 'YYYY-MM-DD' key. "Today" is the product's own
 * getNowInTimezone(timezone).todayKey — the SAME seam runSchedule.js drives
 * scheduling off of. Day arithmetic runs in UTC-epoch space so it can never
 * disagree with itself across process TZs; only the anchor is TZ-aware.
 *
 * @param {number} n days offset from today (0 = today, -1 = yesterday, 1 = tomorrow)
 * @param {string} [timezone] IANA tz string, defaults to 'America/New_York'
 * @returns {string} 'YYYY-MM-DD'
 */
function dateFromToday(n, timezone) {
  var tz = timezone || DEFAULT_TIMEZONE;
  var today = getNowInTimezone(tz).todayKey;
  var p = parseDateKey(today);
  var utcMs = Date.UTC(p.year, p.month - 1, p.day) + n * MS_PER_DAY;
  var d = new Date(utcMs);
  return formatDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function todayKey(timezone) { return dateFromToday(0, timezone); }
function yesterdayKey(timezone) { return dateFromToday(-1, timezone); }
function tomorrowKey(timezone) { return dateFromToday(1, timezone); }

module.exports = {
  dateFromToday: dateFromToday,
  todayKey: todayKey,
  yesterdayKey: yesterdayKey,
  tomorrowKey: tomorrowKey,
  DEFAULT_TIMEZONE: DEFAULT_TIMEZONE
};
