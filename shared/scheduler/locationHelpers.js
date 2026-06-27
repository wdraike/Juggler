/**
 * Location resolution helpers — shared between frontend and backend
 */

var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var timeBlockHelpers = require('./timeBlockHelpers');
var getBlocksForDate = timeBlockHelpers.getBlocksForDate;
var getBlockAtMinute = timeBlockHelpers.getBlockAtMinute;
var buildWindowsFromBlocks = timeBlockHelpers.buildWindowsFromBlocks;
var hasWhen = timeBlockHelpers.hasWhen;
var getWhenWindows = timeBlockHelpers.getWhenWindows;

function migrateTask(t) {
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

function resolveLocationId(dateStr, hourOrMin, cfg, blocks) {
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
  // Fall back to time block's loc field
  if (blocks && blocks.length > 0) {
    var block = getBlockAtMinute(blocks, minute);
    if (block && block.loc) return block.loc;
  }
  return "home";
}

function getLocObj(locId, locationsList) {
  if (!locationsList) return { id: locId, name: locId, icon: "\uD83D\uDCCD" };
  var found = null;
  for (var i = 0; i < locationsList.length; i++) {
    if (locationsList[i].id === locId) { found = locationsList[i]; break; }
  }
  return found || { id: locId, name: locId, icon: "\uD83D\uDCCD" };
}

function resolveDayLocation(dateStr, cfg, blocks) {
  var counts = {};
  for (var m = 360; m < 1380; m += 15) {
    var lid = resolveLocationId(dateStr, m, cfg, blocks);
    if (lid !== "transit") counts[lid] = (counts[lid] || 0) + 1;
  }
  var best = "home", bestN = 0;
  Object.keys(counts).forEach(function(k) { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
  return { id: best, name: best.charAt(0).toUpperCase() + best.slice(1), icon: best === "home" ? "\uD83C\uDFE0" : "\uD83C\uDFE2", note: "" };
}

function canTaskRun(task, dayLocId, toolMatrix) {
  var t = migrateTask(task);
  if (t.location.length > 0 && t.location.map(function(l) { return l.toLowerCase(); }).indexOf((dayLocId || '').toLowerCase()) === -1) return false;
  if (t.tools && t.tools.length > 0) {
    var available = (toolMatrix && toolMatrix[dayLocId]) || [];
    for (var i = 0; i < t.tools.length; i++) {
      if (available.indexOf(t.tools[i]) === -1) return false;
    }
  }
  return true;
}

// FR1 / AC1.1 — structured-diagnostic counterpart of canTaskRun. Same predicate,
// but instead of a bare boolean it returns WHY a task can't run at a resolved
// location so the scheduler can attribute a specific _unplacedReason/_unplacedDetail.
//
// SPEC open-decision #2 RESOLVED: parallel helper — canTaskRun keeps its bare-boolean
// contract verbatim (every existing caller — canTaskRunAtMin, canTaskRunAtMinCached,
// isTaskBlockedPure — relies on truthy-on-success / falsy-on-fail, and the A-002
// golden master pins it). This PARALLEL helper is the lower-blast-radius path: it
// adds the structured cause without touching any boolean call site.
//
// Returns:
//   { ok: true }                                 — task can run (no cause)
//   { ok: false, cause: 'location_mismatch', detail }  — required location not the day's location
//   { ok: false, cause: 'tool_conflict',    detail }   — a required tool isn't available here
// Location is checked first (mirrors canTaskRun's guard order) so a task failing
// BOTH location and tool reports 'location_mismatch' (AC1.1-g).
function whyCannotRun(task, dayLocId, toolMatrix) {
  var t = migrateTask(task);
  if (t.location.length > 0 && t.location.map(function(l) { return l.toLowerCase(); }).indexOf((dayLocId || '').toLowerCase()) === -1) {
    return {
      ok: false,
      cause: 'location_mismatch',
      detail: 'Needs location ' + t.location.join(' or ') +
        '; resolved location is ' + dayLocId
    };
  }
  if (t.tools && t.tools.length > 0) {
    var available = (toolMatrix && toolMatrix[dayLocId]) || [];
    for (var i = 0; i < t.tools.length; i++) {
      if (available.indexOf(t.tools[i]) === -1) {
        return {
          ok: false,
          cause: 'tool_conflict',
          detail: 'Needs ' + t.tools[i] + '; not available at ' + dayLocId
        };
      }
    }
  }
  return { ok: true };
}

function canTaskRunAtMin(task, dateStr, minute, cfg, toolMatrix, blocks) {
  var locId = resolveLocationId(dateStr, minute, cfg, blocks);
  return canTaskRun(task, locId, toolMatrix);
}

// A-002 perf: cached variant of canTaskRunAtMin (jcr-h-performance hotspot — location
// checking was ~12.4% of scheduling). The location resolved at a given (dateStr, minute)
// is task-INDEPENDENT and, within a single schedule run, a pure function of (dateStr,
// minute): cfg is fixed and `blocks` is dayBlocks[dateStr] (stable per date). Memoizing
// locId by "dateStr|minute" therefore returns the IDENTICAL value resolveLocationId would
// compute, while collapsing the per-candidate-slot recompute from O(tasks×slots) to
// O(distinct day-slots) per run. `cache` is a per-run plain map; when absent, this falls
// back to the uncached path (byte-identical). The task-specific canTaskRun stays per-call
// (it depends on the task's location/tools, which the cache never folds in).
function canTaskRunAtMinCached(task, dateStr, minute, cfg, toolMatrix, blocks, cache) {
  if (!cache) return canTaskRunAtMin(task, dateStr, minute, cfg, toolMatrix, blocks);
  var key = dateStr + "|" + minute;
  var locId;
  if (key in cache) {
    locId = cache[key];
  } else {
    locId = resolveLocationId(dateStr, minute, cfg, blocks);
    cache[key] = locId;
  }
  return canTaskRun(task, locId, toolMatrix);
}

function getLocationForDatePure(dateStr, cfg) {
  var blocks = getBlocksForDate(dateStr, cfg.timeBlocks, cfg);
  return resolveDayLocation(dateStr, cfg, blocks);
}

function getLocationForHourPure(dateStr, hour, cfg) {
  var blocks = getBlocksForDate(dateStr, cfg.timeBlocks, cfg);
  return resolveLocationId(dateStr, hour, cfg, blocks);
}

function isTaskBlockedPure(task, dateStr, cfg) {
  if (hasWhen(task.when, "fixed")) return false;
  var blocks = getBlocksForDate(dateStr, cfg.timeBlocks, cfg);
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

module.exports = {
  migrateTask,
  resolveLocationId,
  getLocObj,
  resolveDayLocation,
  canTaskRun,
  whyCannotRun,
  canTaskRunAtMin,
  canTaskRunAtMinCached,
  getLocationForDatePure,
  getLocationForHourPure,
  isTaskBlockedPure
};
