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

  // 999.1186: parse via the shared DB-timestamp normalizer. A MySQL
  // dateStrings 'YYYY-MM-DD HH:MM:SS' input is pinned to UTC instead of
  // misparsing as server-local (+4h class of bug); calendar-provider ISO
  // strings (T-separated, offset, Z) keep native parsing unchanged.
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
 */
function computeDurationMinutes(start, end) {
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
