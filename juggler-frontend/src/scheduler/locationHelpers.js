/**
 * Location resolution helpers extracted from task_tracker_v7_28 lines 198-305
 */

import { parseDate } from './dateHelpers';
import { getBlocksForDate, buildWindowsFromBlocks, hasWhen, getWhenWindows } from './timeBlockHelpers';

export function migrateTask(t) {
  var tIsFixed = hasWhen(t.when, "fixed");
  if (t.location !== undefined) {
    if (!t.location || t.location === "anywhere") {
      if (t.where === "errand" && !tIsFixed) return Object.assign({}, t, { location: ["home"], tools: t.tools || [] });
      return Object.assign({}, t, { location: [], tools: t.tools || [] });
    }
    if (typeof t.location === "string") {
      if (t.location === "") {
        if (t.where === "errand" && !tIsFixed) return Object.assign({}, t, { location: ["home"], tools: t.tools || [] });
        return Object.assign({}, t, { location: [], tools: t.tools || [] });
      }
      return Object.assign({}, t, { location: [t.location], tools: t.tools || [] });
    }
    if (!Array.isArray(t.location)) return Object.assign({}, t, { location: [], tools: t.tools || [] });
    if (t.location.length === 0 && t.where === "errand" && !tIsFixed) return Object.assign({}, t, { location: ["home"], tools: t.tools || [] });
    return Object.assign({}, t, { tools: t.tools || [] });
  }
  var locs = [], tools = [];
  if (t.where === "home") locs = ["home"];
  else if (t.where === "work") locs = ["work"];
  else if (t.where === "phone") { locs = []; tools = ["phone"]; }
  else if (t.where === "errand") locs = tIsFixed ? [] : ["home"];
  else if (t.where === "anywhere" || !t.where) locs = [];
  else locs = [t.where];
  return Object.assign({}, t, { location: locs, tools: tools });
}

export function resolveLocationId(dateStr, hourOrMin, cfg, blocks) {
  var hour = hourOrMin < 24 ? hourOrMin : Math.floor(hourOrMin / 60);
  var minute = hourOrMin < 24 ? hourOrMin * 60 : hourOrMin;
  var minSlot = Math.floor(minute / 15) * 15;
  var hourOv = cfg.hourLocationOverrides;
  if (hourOv && hourOv[dateStr] && hourOv[dateStr][hour] !== undefined) {
    return hourOv[dateStr][hour];
  }
  var templateId = null;
  if (cfg.locScheduleOverrides && cfg.locScheduleOverrides[dateStr]) {
    templateId = cfg.locScheduleOverrides[dateStr];
  } else if (cfg.locScheduleDefaults) {
    var d2 = parseDate(dateStr);
    if (d2) {
      var dn = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d2.getDay()];
      templateId = cfg.locScheduleDefaults[dn];
    }
  }
  if (templateId && cfg.locSchedules && cfg.locSchedules[templateId]) {
    var tmpl = cfg.locSchedules[templateId];
    if (tmpl.hours) {
      if (tmpl.hours[minSlot] !== undefined) return tmpl.hours[minSlot];
      if (tmpl.hours[hour] !== undefined) return tmpl.hours[hour];
    }
  }
  return "home";
}

export function getLocObj(locId, locationsList) {
  if (!locationsList) return { id: locId, name: locId, icon: "\uD83D\uDCCD" };
  var found = null;
  for (var i = 0; i < locationsList.length; i++) {
    if (locationsList[i].id === locId) { found = locationsList[i]; break; }
  }
  return found || { id: locId, name: locId, icon: "\uD83D\uDCCD" };
}

export function resolveDayLocation(dateStr, cfg, blocks) {
  var counts = {};
  for (var m = 360; m < 1380; m += 15) {
    var lid = resolveLocationId(dateStr, m, cfg, blocks);
    if (lid !== "transit") counts[lid] = (counts[lid] || 0) + 1;
  }
  var best = "home", bestN = 0;
  Object.keys(counts).forEach(function(k) { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
  return { id: best, name: best.charAt(0).toUpperCase() + best.slice(1), icon: best === "home" ? "\uD83C\uDFE0" : "\uD83C\uDFE2", note: "" };
}

export function canTaskRun(task, dayLocId, toolMatrix) {
  var t = migrateTask(task);
  if (t.location.length > 0 && t.location.indexOf(dayLocId) === -1) return false;
  if (t.tools && t.tools.length > 0) {
    var available = (toolMatrix && toolMatrix[dayLocId]) || [];
    for (var i = 0; i < t.tools.length; i++) {
      if (available.indexOf(t.tools[i]) === -1) return false;
    }
  }
  return true;
}

export function canTaskRunAtMin(task, dateStr, minute, cfg, toolMatrix, blocks) {
  var locId = resolveLocationId(dateStr, minute, cfg, blocks);
  return canTaskRun(task, locId, toolMatrix);
}

export function getLocationForDatePure(dateStr, cfg) {
  var blocks = getBlocksForDate(dateStr, cfg.timeBlocks);
  return resolveDayLocation(dateStr, cfg, blocks);
}

export function getLocationForHourPure(dateStr, hour, cfg) {
  var blocks = getBlocksForDate(dateStr, cfg.timeBlocks);
  return resolveLocationId(dateStr, hour, cfg, blocks);
}

export function isTaskBlockedPure(task, dateStr, cfg) {
  if (hasWhen(task.when, "fixed")) return false;
  var blocks = getBlocksForDate(dateStr, cfg.timeBlocks);
  var dateWindows = buildWindowsFromBlocks(blocks);
  var taskWins = getWhenWindows(task.when, dateWindows);
  if (taskWins.length === 0) return true;
  for (var wi = 0; wi < taskWins.length; wi++) {
    var wS = taskWins[wi][0], wE = taskWins[wi][1];
    for (var h = Math.floor(wS / 60); h < Math.ceil(wE / 60); h++) {
      var hLocId = resolveLocationId(dateStr, h, cfg, blocks);
      if (canTaskRun(task, hLocId, cfg.toolMatrix)) return false;
    }
  }
  return true;
}
