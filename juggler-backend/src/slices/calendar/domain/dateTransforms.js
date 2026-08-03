/**
 * dateTransforms.js — pure Juggler↔ISO date transforms for the calendar slice.
 *
 * 999.1192 (JUG-HEX-SLICES-CALL-CONTROLLERS): moved VERBATIM from
 * controllers/cal-sync-helpers.js so the calendar slice adapters
 * (Google/Apple/Microsoft) stop requiring an HTTP-layer controllers/* module
 * for pure date math. controllers/cal-sync-helpers.js re-exports these under
 * the same names (back-compat shim for cal-sync.controller + the
 * 20260402200000 migration), so every existing importer keeps working.
 *
 * Pure functions — no DB, no HTTP. External deps are the shared timezone
 * helpers and the scheduler's DEFAULT_TIMEZONE constant only.
 */

var { safeTimezone, parseDbUtc } = require('juggler-shared/scheduler/dateHelpers');

var DEFAULT_TIMEZONE = require('../../../scheduler/constants').DEFAULT_TIMEZONE;

/**
 * Convert Juggler task date "M/D" + time "H:MM AM/PM" to ISO datetime string (local, no Z).
 * If no time provided, defaults to 9:00 AM.
 */
function jugglerDateToISO(date, time, year) {
  if (!date) return null;
  var month, day, y;
  var s = String(date);
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    y = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else {
    var parts = s.split('/');
    month = parseInt(parts[0], 10);
    day = parseInt(parts[1], 10);
    y = year || new Date().getFullYear();
  }

  var hours = 9, minutes = 0;
  if (time) {
    var parsed = false;

    var namedTimes = {
      'morning': [9, 0], 'evening': [18, 0], 'afternoon': [13, 0],
      'night': [20, 0], 'noon': [12, 0], 'lunch': [12, 0]
    };
    var lower = time.trim().toLowerCase();
    if (namedTimes[lower]) {
      hours = namedTimes[lower][0];
      minutes = namedTimes[lower][1];
      parsed = true;
    }

    if (!parsed) {
      var match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (match) {
        hours = parseInt(match[1], 10);
        minutes = parseInt(match[2], 10);
        var ampm = match[3].toUpperCase();
        if (ampm === 'PM' && hours !== 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        parsed = true;
      }
    }

    if (!parsed) {
      var rangeMatch = time.match(/^(\d{1,2}):(\d{2})\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)$/i);
      if (rangeMatch) {
        hours = parseInt(rangeMatch[1], 10);
        minutes = parseInt(rangeMatch[2], 10);
        var ampm2 = rangeMatch[3].toUpperCase();
        if (ampm2 === 'PM' && hours !== 12) hours += 12;
        if (ampm2 === 'AM' && hours === 12) hours = 0;
        parsed = true;
      }
    }

    if (!parsed) {
      var bareRange = time.match(/^(\d{1,2}):(\d{2})\s*-\s*\d{1,2}:\d{2}$/);
      if (bareRange) {
        hours = parseInt(bareRange[1], 10);
        minutes = parseInt(bareRange[2], 10);
      }
    }
  }

  var dateStr = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') +
    'T' + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':00';
  return dateStr;
}

/**
 * Convert ISO datetime to { date: "YYYY-MM-DD", time: "H:MM AM/PM" }
 */
function isoToJugglerDate(isoString, timezone) {
  if (!isoString) return { date: null, time: null };
  var tz = safeTimezone(timezone, DEFAULT_TIMEZONE);

  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
    return { date: isoString, time: null };
  }

  // An offset-less T-separated datetime carries no instant — it is a WALL CLOCK
  // already expressed in the provider's calendar timezone, i.e. in `tz`. Handing
  // it to native `new Date()` parses it as SERVER-LOCAL (ECMA-262: date-time
  // forms without an offset are local time), and re-formatting that into `tz`
  // then shifts it by (server offset − tz offset).
  //
  // CONFIRMED SOURCE: Apple CalDAV *floating* times. RFC 5545 defines a floating
  // time as the observer's local time, so `tz` is exactly the zone to read it in.
  // src/lib/apple-cal-api.js emits formatICALDateTime() with no 'Z' when
  // dtstart.zone.tzid === 'floating'; tests/apple-cal-parse.test.js pins that
  // shape ('2026-05-15T10:00:00').
  //
  // NOT the MSFT pull path, despite the shape looking Graph-ish: Graph defaults
  // to start.timeZone === 'UTC' and MicrosoftCalendarAdapter.js appends the 'Z'
  // itself before calling here, so those strings never reach this branch. MSFT
  // can only land here when start.timeZone is non-UTC, via the eventTz arm of
  // MicrosoftCalendarAdapter.applyEventToTaskFields.
  //
  // On a UTC host (Cloud Run) the old behaviour shifted every floating Apple
  // event by the full user offset, and applyEventToTaskFields() then read the
  // phantom time change as a real reschedule, promoting flexible tasks to
  // placement_mode=fixed.
  //
  // The wall clock is already correct for `tz`, so read the components straight
  // through — no Date round-trip to shift them. Restricted to the T-separated
  // form on purpose: the space-separated 'YYYY-MM-DD HH:MM:SS' MySQL shape must
  // keep its 999.1186 UTC pinning below, and anything carrying an offset or 'Z'
  // is a real instant that must still convert.
  var floating = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\.\d+)?$/.exec(isoString);
  if (floating) {
    // The regex is looser than Date parsing on day-in-month: it accepts
    // 2026-02-30 / 2026-06-31. V8 does NOT reject those — it rolls them over
    // (2026-02-30 → 2026-03-02), which is what this function has always
    // returned for them. Reading such a date straight through would newly
    // surface the impossible date VERBATIM ('2026-02-30'), a behaviour change
    // this tz fix has no business making. So: validate, and on failure fall
    // through to the unchanged path below, which keeps the historical rollover.
    // No provider emits these, but jugglerDateToISO() builds YYYY-MM-DD from
    // unvalidated task fields, so the shape is reachable.
    var fy = parseInt(floating[1], 10);
    var fmo = parseInt(floating[2], 10);
    var fd = parseInt(floating[3], 10);
    var probe = new Date(Date.UTC(fy, fmo - 1, fd));
    if (probe.getUTCFullYear() === fy && probe.getUTCMonth() === fmo - 1 && probe.getUTCDate() === fd) {
      var fh = parseInt(floating[4], 10);
      var fh12 = fh % 12;
      if (fh12 === 0) fh12 = 12;
      return {
        date: floating[1] + '-' + floating[2] + '-' + floating[3],
        time: fh12 + ':' + floating[5] + ' ' + (fh < 12 ? 'AM' : 'PM')
      };
    }
  }

  // 999.1186: parse via the shared DB-timestamp normalizer. A MySQL
  // dateStrings 'YYYY-MM-DD HH:MM:SS' input is pinned to UTC instead of
  // misparsing as server-local (+4h class of bug); calendar-provider ISO
  // strings carrying an offset or 'Z' keep native parsing unchanged.
  var d = parseDbUtc(isoString);
  if (!d) return { date: null, time: null };
  try {
    var dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(d);
    var timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
    }).formatToParts(d);

    var year = dateParts.find(function(p) { return p.type === 'year'; }).value;
    var month = parseInt(dateParts.find(function(p) { return p.type === 'month'; }).value, 10);
    var day = parseInt(dateParts.find(function(p) { return p.type === 'day'; }).value, 10);
    var hour = timeParts.find(function(p) { return p.type === 'hour'; }).value;
    var minute = timeParts.find(function(p) { return p.type === 'minute'; }).value;
    var dayPeriod = timeParts.find(function(p) { return p.type === 'dayPeriod'; }).value.toUpperCase();

    return {
      date: year + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day,
      time: hour + ':' + minute + ' ' + dayPeriod
    };
  } catch (_e) {
    var mo = d.getMonth() + 1;
    var da = d.getDate();
    var h = d.getHours();
    var mi = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return {
      date: d.getFullYear() + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da,
      time: h + ':' + String(mi).padStart(2, '0') + ' ' + ap
    };
  }
}

/**
 * Compute duration in minutes between two ISO datetime strings.
 *
 * 999.5027: offset-less T-separated datetimes (Apple CalDAV floating times)
 * are wall-clock times in the event's timezone. new Date() parses them as
 * SERVER-LOCAL, so the difference is correct EXCEPT across a server-TZ DST
 * transition where the server changes clocks but the event's wall clock
 * does not. Fix: for floating times, read the components directly so the
 * duration is always the wall-clock difference.
 */
function computeDurationMinutes(start, end) {
  if (!start || !end) return 30;
  // 999.5027: floating times — compute wall-clock duration directly.
  var floatingStart = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/.exec(start);
  var floatingEnd   = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/.exec(end);
  if (floatingStart && floatingEnd) {
    // Both floating — compute wall-clock minutes directly from components.
    var sTotal = (parseInt(floatingStart[1], 10) * 525600 +
                  parseInt(floatingStart[2], 10) * 43200 +
                  parseInt(floatingStart[3], 10) * 1440 +
                  parseInt(floatingStart[4], 10) * 60 +
                  parseInt(floatingStart[5], 10));
    var eTotal = (parseInt(floatingEnd[1], 10) * 525600 +
                  parseInt(floatingEnd[2], 10) * 43200 +
                  parseInt(floatingEnd[3], 10) * 1440 +
                  parseInt(floatingEnd[4], 10) * 60 +
                  parseInt(floatingEnd[5], 10));
    var diff = eTotal - sTotal;
    return diff > 0 ? diff : 30;
  }
  var s = new Date(start);
  var e = new Date(end);
  var diff = Math.round((e - s) / 60000);
  return diff > 0 ? diff : 30;
}

module.exports = {
  jugglerDateToISO,
  isoToJugglerDate,
  computeDurationMinutes
};
