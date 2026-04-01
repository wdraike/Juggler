/**
 * Check if a given date matches a recurrence rule.
 * Replicates the matching logic from expandRecurring.js for a single date.
 *
 * @param {string} dateStr - Date to check (M/D format, e.g. "3/31")
 * @param {object} recur - Recurrence config { type, days, every, unit, monthDays }
 * @param {string} srcDateStr - Source/anchor date for interval calculations (M/D format)
 * @param {function} parseDate - Date parser function
 * @returns {boolean} true if the date matches the recurrence pattern
 */
function dateMatchesRecurrence(dateStr, recur, srcDateStr, parseDate) {
  if (!recur || !recur.type || recur.type === 'none') return false;
  if (!dateStr) return false;

  var cursor = parseDate(dateStr);
  if (!cursor) return false;
  var srcDate = srcDateStr ? parseDate(srcDateStr) : null;
  if (!srcDate) return false;
  if (cursor < srcDate) return false;

  var dow = cursor.getDay();
  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };

  if (recur.type === 'daily') return true;

  if (recur.type === 'weekly' || recur.type === 'biweekly') {
    var days = recur.days || 'MTWRF';
    var found = false;
    for (var i = 0; i < days.length; i++) {
      if (dayMap[days[i]] === dow) { found = true; break; }
    }
    if (!found) return false;
    if (recur.type === 'biweekly') {
      var daysDiff = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
      if (Math.floor(daysDiff / 7) % 2 !== 0) return false;
    }
    return true;
  }

  if (recur.type === 'monthly') {
    var md = recur.monthDays || [1, 15];
    var dom = cursor.getDate();
    var lastDom = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    for (var mi = 0; mi < md.length; mi++) {
      var v = md[mi];
      if (v === 'first' && dom === 1) return true;
      if (v === 'last' && dom === lastDom) return true;
      if (Number(v) === dom) return true;
    }
    return false;
  }

  if (recur.type === 'interval') {
    var every = recur.every || 2;
    var unit = recur.unit || 'days';
    if (unit === 'days') {
      var between = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
      return between > 0 && between % every === 0;
    } else if (unit === 'weeks') {
      var betweenD = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
      return betweenD > 0 && betweenD % (every * 7) === 0;
    } else if (unit === 'months') {
      if (cursor.getDate() !== srcDate.getDate()) return false;
      var monthDiff = (cursor.getFullYear() - srcDate.getFullYear()) * 12 + (cursor.getMonth() - srcDate.getMonth());
      return monthDiff > 0 && monthDiff % every === 0;
    } else if (unit === 'years') {
      if (cursor.getMonth() !== srcDate.getMonth() || cursor.getDate() !== srcDate.getDate()) return false;
      var yearDiff = cursor.getFullYear() - srcDate.getFullYear();
      return yearDiff > 0 && yearDiff % every === 0;
    }
  }

  return false;
}

module.exports = { dateMatchesRecurrence: dateMatchesRecurrence };
