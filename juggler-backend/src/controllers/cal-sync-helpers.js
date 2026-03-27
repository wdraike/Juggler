/**
 * Shared helpers for unified calendar sync engine.
 * Extracted from gcal.controller.js — pure functions, no DB dependency.
 */

var crypto = require('crypto');

var DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Convert Juggler task date "M/D" + time "H:MM AM/PM" to ISO datetime string (local, no Z).
 * If no time provided, defaults to 9:00 AM.
 */
function jugglerDateToISO(date, time, year) {
  if (!date) return null;
  var parts = date.split('/');
  var month = parseInt(parts[0], 10);
  var day = parseInt(parts[1], 10);
  var y = year || new Date().getFullYear();

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
 * Convert ISO datetime to { date: "M/D", time: "H:MM AM/PM" }
 */
function isoToJugglerDate(isoString, timezone) {
  if (!isoString) return { date: null, time: null };
  var tz = timezone || DEFAULT_TIMEZONE;

  if (/^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
    var parts = isoString.split('-');
    return {
      date: parseInt(parts[1], 10) + '/' + parseInt(parts[2], 10),
      time: null
    };
  }

  var d = new Date(isoString);
  try {
    var dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, month: 'numeric', day: 'numeric'
    }).formatToParts(d);
    var timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
    }).formatToParts(d);

    var month = dateParts.find(function(p) { return p.type === 'month'; }).value;
    var day = dateParts.find(function(p) { return p.type === 'day'; }).value;
    var hour = timeParts.find(function(p) { return p.type === 'hour'; }).value;
    var minute = timeParts.find(function(p) { return p.type === 'minute'; }).value;
    var dayPeriod = timeParts.find(function(p) { return p.type === 'dayPeriod'; }).value.toUpperCase();

    return {
      date: month + '/' + day,
      time: hour + ':' + minute + ' ' + dayPeriod
    };
  } catch (e) {
    var mo = d.getMonth() + 1;
    var da = d.getDate();
    var h = d.getHours();
    var mi = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return {
      date: mo + '/' + da,
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

/**
 * Hash the task fields we sync to calendars.
 */
function taskHash(task) {
  var str = [
    task.text || '',
    task.date || '',
    task.time || '',
    String(task.dur || 0),
    task.status || '',
    task.when || '',
    task.project || ''
  ].join('|');
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Convert an ISO 8601 string (e.g. from Microsoft Graph) to a Date object
 * that Knex/mysql2 can serialize. Raw ISO strings with 'Z' or microseconds
 * cause ER_TRUNCATED_WRONG_VALUE in MySQL DATETIME columns.
 */
function toMySQLDate(isoString) {
  if (!isoString) return null;
  var d = new Date(isoString);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = {
  DEFAULT_TIMEZONE,
  jugglerDateToISO,
  isoToJugglerDate,
  computeDurationMinutes,
  taskHash,
  toMySQLDate
};
