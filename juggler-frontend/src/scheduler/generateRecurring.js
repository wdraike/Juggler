/**
 * Recurring task generator extracted from task_tracker_v7_28 lines 514-590
 */

import { DAY_NAMES } from '../state/constants';
import { applyDefaults } from '../state/constants';
import { parseDate, formatDateKey } from './dateHelpers';

export function generateRecurringPure(taskList, startDate, endDate) {
  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  var newTasks = [];
  var existingIds = {};
  taskList.forEach(function(t) { existingIds[t.id] = true; });

  var sources = taskList.filter(function(t) { return t.recur && t.recur.type !== "none"; });
  if (sources.length === 0) return [];

  var cursor = new Date(startDate); cursor.setHours(0, 0, 0, 0);
  var end = new Date(endDate); end.setHours(23, 59, 59, 999);
  var maxIter = 400;

  while (cursor <= end && maxIter-- > 0) {
    var dateStr = formatDateKey(cursor);
    var dow = cursor.getDay();
    var dayName = DAY_NAMES[dow];

    sources.forEach(function(src) {
      var r = src.recur;
      var srcDate = parseDate(src.date);
      // Habits with TBD/missing date: treat as always active (generate from startDate)
      if (!srcDate) srcDate = new Date(startDate);
      if (cursor < srcDate) return;
      if (dateStr === src.date) return;

      var match = false;
      if (r.type === "daily") {
        match = true;
      } else if (r.type === "weekly" || r.type === "biweekly") {
        var days = r.days || "MTWRF";
        var found = false;
        for (var i = 0; i < days.length; i++) {
          if (dayMap[days[i]] === dow) { found = true; break; }
        }
        if (!found) return;
        if (r.type === "biweekly") {
          var daysDiff = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
          var weeksDiff = Math.floor(daysDiff / 7);
          if (weeksDiff % 2 !== 0) return;
        }
        match = true;
      } else if (r.type === "interval") {
        var daysBetween = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
        if (daysBetween > 0 && daysBetween % (r.every || 2) === 0) match = true;
      }

      if (!match) return;

      var id = "rc_" + src.id + "_" + dateStr.replace(/\//g, "");
      if (existingIds[id]) return;
      var oldId = "gh_" + src.id.replace("ht_", "") + "_" + dateStr.replace(/\//g, "");
      if (existingIds[oldId]) return;
      var hasDupe = taskList.some(function(et) { return et.date === dateStr && et.text === src.text && et.id !== src.id; });
      if (hasDupe) return;
      existingIds[id] = true;
      newTasks.push(applyDefaults({
        id: id, date: dateStr, day: dayName, project: src.project, text: src.text,
        pri: src.pri, habit: src.habit || false, rigid: src.rigid || false,
        time: src.time, dur: src.dur, where: src.where, when: src.when,
        location: src.location, tools: src.tools,
        dayReq: src.dayReq || "any", section: "", notes: "",
        taskType: 'generated', sourceId: src.id, generated: true,
      }));
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return newTasks;
}
