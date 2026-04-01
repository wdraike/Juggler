/**
 * Date/time helper functions — shared between frontend and backend
 */

var DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function inferYear(month, timezone) {
  var now = new Date();
  var currentMonth, year;
  if (timezone) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'numeric', year: 'numeric' })
      .formatToParts(now).forEach(function(p) { parts[p.type] = parseInt(p.value, 10); });
    currentMonth = parts.month;
    year = parts.year;
  } else {
    currentMonth = now.getMonth() + 1;
    year = now.getFullYear();
  }
  if (month < currentMonth - 6) return year + 1;
  return year;
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === "TBD") return null;
  var parts = dateStr.split("/").map(Number);
  return new Date(inferYear(parts[0]), parts[0] - 1, parts[1]);
}

function formatDateKey(d) {
  return (d.getMonth() + 1) + "/" + d.getDate();
}

function getWeekStart(d) {
  var dt = new Date(d);
  var day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  var s = timeStr.trim();
  var m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a|p)/i);
  if (m12) {
    var h = parseInt(m12[1]), min = parseInt(m12[2]), ap = m12[3].toLowerCase();
    if ((ap === "pm" || ap === "p") && h !== 12) h += 12;
    if ((ap === "am" || ap === "a") && h === 12) h = 0;
    return h * 60 + min;
  }
  var mR = s.match(/^(\d{1,2}):(\d{2})\s*-/);
  if (mR) {
    var rh = parseInt(mR[1]), rm = parseInt(mR[2]);
    if (rh >= 1 && rh <= 5) rh += 12;
    return rh * 60 + rm;
  }
  return null;
}

function toTime24(t12) {
  if (!t12) return "";
  var m = t12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a|p)/i);
  if (!m) return "";
  var h = parseInt(m[1]), min = m[2], ap = (m[3] || "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  return (h < 10 ? "0" : "") + h + ":" + min;
}

function fromTime24(t24) {
  if (!t24) return "";
  var parts = t24.split(":");
  var h = parseInt(parts[0]), min = parts[1];
  var ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return h + ":" + min + " " + ap;
}

function toDateISO(md) {
  if (!md) return "";
  var parts = md.split("/");
  if (parts.length < 2) return "";
  var mon = parseInt(parts[0]), day = parseInt(parts[1]);
  var year = inferYear(mon);
  return year + "-" + (mon < 10 ? "0" : "") + mon + "-" + (day < 10 ? "0" : "") + day;
}

function fromDateISO(iso) {
  if (!iso) return "";
  var parts = iso.split("-");
  return parseInt(parts[1]) + "/" + parseInt(parts[2]);
}

function formatHour(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return h + " AM";
  if (h === 12) return "12 PM";
  return (h - 12) + " PM";
}

function getDayName(dateStr) {
  var d = parseDate(dateStr);
  if (!d) return "";
  return DAY_NAMES[d.getDay()];
}

/**
 * Convert local date+time strings to a UTC Date.
 * dateStr: "M/D" (no year — inferred), timeStr: "H:MM AM/PM", timezone: IANA string
 * Returns a Date in UTC, or null if inputs are insufficient.
 */
function localToUtc(dateStr, timeStr, timezone) {
  if (!dateStr) return null;
  var d = parseDate(dateStr);
  if (!d) return null;
  var year = d.getFullYear(), month = d.getMonth(), day = d.getDate();
  var hours = 0, mins = 0;
  if (timeStr) {
    var totalMins = parseTimeToMinutes(timeStr);
    if (totalMins != null) {
      hours = Math.floor(totalMins / 60);
      mins = totalMins % 60;
    }
  }
  // Build an ISO string representing the local time, then use timezone offset
  // to find the UTC equivalent
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var localISO = year + '-' + pad(month + 1) + '-' + pad(day) + 'T' + pad(hours) + ':' + pad(mins) + ':00';
  // Use Intl to find the UTC offset for this local time in the given timezone
  var tempDate = new Date(localISO + 'Z'); // treat as UTC temporarily
  var formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
  });
  // Binary search for offset: find UTC time that displays as our target local time
  // Start with a rough estimate using the current offset
  var testParts = {};
  formatter.formatToParts(tempDate).forEach(function(p) { testParts[p.type] = parseInt(p.value, 10); });
  var testLocalH = testParts.hour % 24;
  var testLocalM = testParts.minute;
  var testLocalDay = testParts.day;
  var testLocalMonth = testParts.month;
  // Offset in minutes = (localTime - utcTime)
  var diffMins = ((testLocalH * 60 + testLocalM) - (hours * 60 + mins));
  // Handle day boundary — compare full dates, not just day numbers, to handle month rollovers
  if (testLocalDay !== day || testLocalMonth !== month + 1) {
    var targetDate = new Date(year, month, day);
    var testDate = new Date(testParts.year || year, testLocalMonth - 1, testLocalDay);
    diffMins += (testDate > targetDate) ? 1440 : -1440;
  }
  var utcMs = tempDate.getTime() - diffMins * 60000;
  var result = new Date(utcMs);
  // Verify and adjust if DST boundary caused off-by-one
  var verifyParts = {};
  formatter.formatToParts(result).forEach(function(p) { verifyParts[p.type] = parseInt(p.value, 10); });
  if (verifyParts.hour % 24 !== hours || verifyParts.minute !== mins) {
    var diff2 = ((verifyParts.hour % 24) * 60 + verifyParts.minute) - (hours * 60 + mins);
    result = new Date(result.getTime() - diff2 * 60000);
  }
  return result;
}

/**
 * Convert a UTC Date to local date/time/day strings.
 * Returns { date: "M/D", time: "H:MM AM/PM", day: "Mon" } or null fields if utcDate is null.
 */
function utcToLocal(utcDate, timezone) {
  if (!utcDate) return { date: null, time: null, day: null };
  var d;
  if (utcDate instanceof Date) {
    d = utcDate;
  } else if (typeof utcDate === 'string') {
    // MySQL returns "YYYY-MM-DD HH:MM:SS" — ensure UTC interpretation
    d = new Date(utcDate.replace(' ', 'T') + 'Z');
  } else {
    d = new Date(utcDate);
  }
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

module.exports = {
  inferYear,
  parseDate,
  formatDateKey,
  getWeekStart,
  isSameDay,
  parseTimeToMinutes,
  toTime24,
  fromTime24,
  toDateISO,
  fromDateISO,
  formatHour,
  getDayName,
  localToUtc,
  utcToLocal
};
