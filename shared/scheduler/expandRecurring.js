/**
 * Recurring task expansion — shared between frontend, backend, and validator.
 * Generates per-day instances from recurring task templates.
 */

var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function expandRecurring(allTasks, startDate, endDate, opts) {
  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  var existingIds = {};
  allTasks.forEach(function(t) { existingIds[t.id] = true; });
  var existingByDateText = {};
  allTasks.forEach(function(t) {
    if (t.date && t.text) existingByDateText[t.date + '|' + t.text] = true;
  });

  var sources = allTasks.filter(function(t) {
    if (!t.recur || t.recur.type === 'none') return false;
    if (t.taskType === 'habit_instance') return false;
    return true;
  });
  if (sources.length === 0) return [];

  var newTasks = [];
  var cursor = new Date(startDate); cursor.setHours(0, 0, 0, 0);
  var end = new Date(endDate); end.setHours(23, 59, 59, 999);
  var maxIter = opts && opts.maxIter ? opts.maxIter : 0; // 0 = unlimited

  var iter = 0;
  while (cursor <= end && (maxIter === 0 || iter < maxIter)) {
    iter++;
    var dateStr = formatDateKey(cursor);
    var dow = cursor.getDay();
    var dayName = DAY_NAMES[dow];

    sources.forEach(function(src) {
      var r = src.recur;
      var srcDate = parseDate(src.date);
      if (!srcDate) srcDate = new Date(startDate);
      if (cursor < srcDate) return;
      if (dateStr === src.date) return;
      // Respect habit date range — don't generate outside start/end bounds
      if (src.habitStart) {
        var hs = parseDate(src.habitStart);
        if (hs && cursor < hs) return;
      }
      if (src.habitEnd) {
        var he = parseDate(src.habitEnd);
        if (he && cursor > he) return;
      }

      var match = false;
      if (r.type === 'daily') {
        match = true;
      } else if (r.type === 'weekly' || r.type === 'biweekly') {
        var days = r.days || 'MTWRF';
        var found = false;
        for (var i = 0; i < days.length; i++) {
          if (dayMap[days[i]] === dow) { found = true; break; }
        }
        if (!found) return;
        if (r.type === 'biweekly') {
          var daysDiff = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
          if (Math.floor(daysDiff / 7) % 2 !== 0) return;
        }
        match = true;
      } else if (r.type === 'monthly') {
        var md = r.monthDays || [1, 15];
        var dom = cursor.getDate();
        var lastDom = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        for (var mi = 0; mi < md.length; mi++) {
          var v = md[mi];
          if (v === 'first' && dom === 1) { match = true; break; }
          if (v === 'last' && dom === lastDom) { match = true; break; }
          if (Number(v) === dom) { match = true; break; }
        }
      } else if (r.type === 'interval') {
        var every = r.every || 2;
        var unit = r.unit || 'days';
        if (unit === 'days') {
          var between = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
          if (between > 0 && between % every === 0) match = true;
        } else if (unit === 'weeks') {
          var betweenD = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
          if (betweenD > 0 && betweenD % (every * 7) === 0) match = true;
        } else if (unit === 'months') {
          if (cursor.getDate() === srcDate.getDate()) {
            var monthDiff = (cursor.getFullYear() - srcDate.getFullYear()) * 12 + (cursor.getMonth() - srcDate.getMonth());
            if (monthDiff > 0 && monthDiff % every === 0) match = true;
          }
        } else if (unit === 'years') {
          if (cursor.getMonth() === srcDate.getMonth() && cursor.getDate() === srcDate.getDate()) {
            var yearDiff = cursor.getFullYear() - srcDate.getFullYear();
            if (yearDiff > 0 && yearDiff % every === 0) match = true;
          }
        }
      }
      if (!match) return;

      // Respect day_req: skip days that don't match the constraint
      var dr = src.dayReq;
      if (dr && dr !== 'any') {
        var isWeekday = dow >= 1 && dow <= 5;
        if (dr === 'weekday' && !isWeekday) return;
        if (dr === 'weekend' && isWeekday) return;
        var drMap = { M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, Su: 0, S: 6 };
        var drParts = dr.split(',');
        if (drParts.length > 1 || drMap[drParts[0]] !== undefined) {
          var drMatch = drParts.some(function(p) { return drMap[p] !== undefined && drMap[p] === dow; });
          if (!drMatch) return;
        }
      }

      var id = 'rc_' + src.id + '_' + dateStr.replace(/\//g, '');
      if (existingIds[id]) return;
      // Legacy ID check (frontend only uses this)
      if (opts && opts.checkLegacyIds) {
        var oldId = 'gh_' + src.id.replace('ht_', '') + '_' + dateStr.replace(/\//g, '');
        if (existingIds[oldId]) return;
      }
      if (existingByDateText[dateStr + '|' + src.text]) return;
      // Additional dupe check (frontend uses taskList.some)
      if (opts && opts.checkDupes) {
        var hasDupe = allTasks.some(function(et) { return et.date === dateStr && et.text === src.text && et.id !== src.id; });
        if (hasDupe) return;
      }
      existingIds[id] = true;
      existingByDateText[dateStr + '|' + src.text] = true;
      newTasks.push({
        id: id, date: dateStr, day: dayName, project: src.project, text: src.text,
        pri: src.pri, habit: src.habit || false, rigid: src.rigid || false,
        time: src.time, dur: src.dur, where: src.where, when: src.when,
        location: src.location, tools: src.tools, split: src.split, splitMin: src.splitMin,
        timeFlex: src.timeFlex, marker: src.marker, flexWhen: src.flexWhen,
        dayReq: src.dayReq || 'any', section: '', notes: src.notes || '',
        taskType: 'generated', sourceId: src.id, generated: true
      });
    });

    cursor.setDate(cursor.getDate() + 1);
  }
  return newTasks;
}

module.exports = { expandRecurring: expandRecurring };
