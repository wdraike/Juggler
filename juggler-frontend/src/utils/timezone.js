/**
 * Timezone-aware date helpers for StriveRS frontend.
 *
 * Uses the browser-detected timezone (or manual override) for
 * "today", "now", and UTC ↔ local conversions.
 *
 * 999.1426 (frontend halves of 999.1185/999.1186): the validation and parsing
 * primitives — isValidTimezone/safeTimezone, parseDbUtc, getNowInTimezone,
 * DEFAULT_TIMEZONE — are the SHARED implementations required from
 * juggler-shared (the backend SSOT, fixed in juggler ae41e05d), not local
 * copies. The old "CRA cannot require shared" justification is stale:
 * src/scheduler/*.js shims have required juggler-shared for months.
 */
const sharedDateHelpers = require('juggler-shared/scheduler/dateHelpers');
const sharedNowInTimezone = require('juggler-shared/scheduler/getNowInTimezone');

// parseDbUtc — the single normalizer for DB-origin timestamps (999.1186):
// mysql2 dateStrings:true emits 'YYYY-MM-DD HH:MM:SS' with NO zone marker,
// which a bare `new Date()` misparses as LOCAL time. Re-exported so frontend
// callers (CalSyncPanel, etc.) share the backend implementation.
export const parseDbUtc = sharedDateHelpers.parseDbUtc;

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
 * Validate a timezone string; fall back to America/New_York if invalid.
 * Shared implementation (cached-Set isValidTimezone) — 999.1426 removed the
 * local uncached copy that had drifted from shared/scheduler/dateHelpers.js.
 * @param {string|null|undefined} tz - IANA timezone to validate
 * @param {string} [fallback='America/New_York'] - fallback on invalid
 * @returns {string} validated IANA timezone
 */
export const safeTimezone = sharedDateHelpers.safeTimezone;

/**
 * Convert a UTC datetime to local date/time in a target timezone.
 * Used by the "View in..." dropdown for task-level timezone conversion.
 *
 * Input parsing delegates to shared parseDbUtc (999.1426/999.1186): a MySQL
 * dateStrings-shaped input ('YYYY-MM-DD HH:MM:SS') is pinned to UTC instead of
 * being misparsed as browser-local time; ISO strings with explicit zone info
 * behave exactly as before.
 *
 * @param {string} isoString - UTC datetime (ISO or MySQL dateStrings shape)
 * @param {string} timezone - IANA timezone to display in
 * @returns {{ date: string, time: string, day: string }} local representation
 */
export function convertTimeForDisplay(isoString, timezone) {
  if (!isoString || !timezone) return { date: null, time: null, day: null };
  var d = parseDbUtc(isoString);
  if (!d) return { date: null, time: null, day: null };
  var tz = safeTimezone(timezone);
  var parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(d).forEach(function(p) { parts[p.type] = p.value; });
  var h = parseInt(parts.hour) % 24;
  var m = parseInt(parts.minute);
  var ampm = h >= 12 ? 'PM' : 'AM';
  var dh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  var yr = parseInt(parts.year);
  var mo = parseInt(parts.month);
  var dy = parseInt(parts.day);
  return {
    date: yr + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dy < 10 ? '0' : '') + dy,
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
  var tz = safeTimezone(timezone, '');
  if (!tz) return timezone;
  try {
    var now = new Date();
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'short'
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
  var tz = safeTimezone(timezone, '');
  if (!tz) return '';
  try {
    var now = new Date();
    // Get local time in the target timezone
    var inTz = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
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
 * Build the serverClock object used by AppLayout to apply server-time offset.
 * Extracted here so both AppLayout and its AC3 tests import the real function —
 * keeping them in sync and eliminating copy-drift (AC3 zoe W1 fix).
 *
 * AC3 (999.809): offset = serverEpochMs - capturedNow; clock.now() returns a
 * server-corrected Date. Degraded mode: when serverEpochMs is not a number,
 * returns a clock with offset=0 (real client clock — approved fallback, AC3).
 *
 * @param {number|any} serverEpochMs - value from /api/now res.data.epochMs
 * @param {number} [capturedNow=Date.now()] - Date.now() captured at fetch time (injectable for tests)
 * @returns {{ now: () => Date }}
 */
export function buildServerClock(serverEpochMs, capturedNow) {
  var t = capturedNow !== undefined ? capturedNow : Date.now();
  if (typeof serverEpochMs !== 'number') {
    // degraded mode: offset = 0, use real client clock
    return { now: function() { return new Date(); } };
  }
  var offset = serverEpochMs - t;
  return { now: function() { return new Date(Date.now() + offset); } };
}

// Default timezone — THE shared backend contract value (999.1426: imported
// from shared/scheduler/getNowInTimezone.js instead of a re-stated literal) so
// null/undefined tz produces identical todayKey/nowMins on both sides (R50.8).
var DEFAULT_TIMEZONE = sharedNowInTimezone.DEFAULT_TIMEZONE;

/**
 * Resolve the timezone to DISPLAY task times in. The user's configured timezone
 * (users.timezone, surfaced as config.userTimezone) is authoritative over the
 * browser's — fixes A1, where a 12:00-UTC task rendered 9:00 PM for a NY user on
 * a +9-offset browser because hydration fell back to getBrowserTimezone().
 * Contract TZ-DISPLAY-1 / R31.3.
 *
 * Order: explicit per-user override → configured user timezone →
 * America/New_York default. Per TZ-DISPLAY-3, an unset user displays in
 * America/New_York (NOT the browser tz — the browser is never authoritative
 * for display). users.timezone carries a non-null NY DB default, so a real
 * unset user resolves to NY here anyway.
 *
 * @param {{override?:?string, userTimezone?:?string}} opts
 * @returns {string} IANA timezone
 */
export function resolveDisplayTimezone(opts) {
  var o = opts || {};
  return o.override || o.userTimezone || DEFAULT_TIMEZONE;
}

/**
 * Get "today" and "now" in the given timezone.
 * When timezone is null/undefined, defaults to America/New_York to match the shared
 * backend contract (shared/scheduler/getNowInTimezone.js) — R50.8 parity requirement.
 *
 * AC2 (999.809): mirrors shared/scheduler/getNowInTimezone.js signature exactly.
 * When clock is provided, uses clock.now() instead of new Date() so the FE overdue
 * computation can run against canonical server time (AC3 serverClock). Single-arg
 * callers are unchanged — clock defaults to undefined → real new Date().
 *
 * 999.1426 (999.1185(b)): this is now the SHARED implementation itself, not an
 * ESM copy. The copy had validation drift — shared validates via safeTimezone
 * (invalid IANA → NY fallback) while the copy did a bare `timezone ||
 * DEFAULT_TIMEZONE`, so a corrupt tz string THREW in the browser while the
 * server silently fell back, breaking the todayKey parity this doc promises.
 *
 * @param {string|null} timezone - IANA timezone (e.g. 'America/New_York')
 * @param {{ now: () => Date }|null|undefined} clock - optional injected clock
 * @returns {{ todayKey: string, todayDate: Date, nowMins: number }}
 */
export const getNowInTimezone = sharedNowInTimezone.getNowInTimezone;
