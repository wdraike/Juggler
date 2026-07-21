/**
 * Time block helpers — shared between frontend and backend
 */

var DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;

function cloneBlocks(blocks) {
  return blocks.map(function(b) {
    return Object.assign({}, b, { id: b.id + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5) });
  });
}

// 999.2146 harrison finding 2: getBlocksForDate is called PER-RENDER by
// CalendarGrid.jsx/HorizontalTimeline.jsx (through this shared module) as
// well as once per scheduler run per date — an un-deduped warn for a
// dangling override ref would fire on every render/date, flooding logs.
// Module-level, keyed by templateId only (not date) — "warn once per
// dangling id per process" is the requested granularity; a Set survives for
// the life of the process/module instance (matches the "log warning", not
// "log every occurrence", intent of SUB-207a).
var _warnedDanglingTemplateIds = new Set();

// Look up a templateId in scheduleTemplates. Known id -> its blocks (`[]` is
// a legitimate zero-capacity-day answer, TS-207 — NOT the same as "unknown").
// Unknown/dangling id -> warn once per id per process (SUB-207a) and return
// null so the caller falls through to the NEXT resolution tier instead of a
// spuriously empty day.
function _resolveTemplateBlocks(templateId, scheduleTemplates, dateStr, contextLabel) {
  if (!templateId) return null;
  if (scheduleTemplates[templateId]) {
    return scheduleTemplates[templateId].blocks || [];
  }
  if (!_warnedDanglingTemplateIds.has(templateId)) {
    _warnedDanglingTemplateIds.add(templateId);
    console.warn(
      '[timeBlockHelpers.getBlocksForDate] ' + contextLabel + ' for ' + dateStr +
      ' references unknown templateId "' + templateId +
      '" — falling back (SUB-207a)'
    );
  }
  return null;
}

// Resolution order (999.2161; juggler CLAUDE.md "Schedule-Template Storage" +
// TS-207/208, docs/TEST-SPECS-USER-CONFIG-TEMPLATE-TASK.md):
//   1. cfg.templateOverrides[dateStr]     — canonical date-specific override
//      (999.2146 trio member #2; previously never assembled into scheduler
//      cfg at all, 999.2161).
//   2. cfg.locScheduleOverrides[dateStr]  — legacy override field, kept for
//      back-compat with any writer that only dual-writes the legacy key
//      (pre-existing behavior, unchanged).
//   3. cfg.templateDefaults[dayName]      — canonical day-of-week assignment
//      (999.2146 trio member #1; previously the scheduler only ever saw this
//      indirectly, via the frontend pre-resolving it into the legacy
//      `time_blocks` row on every Templates-tab save).
//   4. blocksMap[dayName]                 — legacy per-weekday time_blocks
//      map (unchanged final fallback).
// Each tier's dangling-id case falls through to the NEXT tier (not straight
// to blocksMap) so an unknown canonical ref never masks a still-valid legacy
// value at a lower tier.
function getBlocksForDate(dateStr, blocksMap, cfg) {
  var d = parseDate(dateStr);
  if (!d) return blocksMap.Mon || [];
  var dayName = DAY_NAMES[d.getDay()];

  if (cfg && cfg.scheduleTemplates) {
    if (cfg.templateOverrides && cfg.templateOverrides[dateStr]) {
      var fromOverride = _resolveTemplateBlocks(
        cfg.templateOverrides[dateStr], cfg.scheduleTemplates, dateStr, 'template_overrides override'
      );
      if (fromOverride) return fromOverride;
    }
    if (cfg.locScheduleOverrides && cfg.locScheduleOverrides[dateStr]) {
      var fromLegacyOverride = _resolveTemplateBlocks(
        cfg.locScheduleOverrides[dateStr], cfg.scheduleTemplates, dateStr, 'override'
      );
      if (fromLegacyOverride) return fromLegacyOverride;
    }
    if (cfg.templateDefaults && cfg.templateDefaults[dayName]) {
      var fromDefault = _resolveTemplateBlocks(
        cfg.templateDefaults[dayName], cfg.scheduleTemplates, dateStr, 'template_defaults default'
      );
      if (fromDefault) return fromDefault;
    }
  }
  return blocksMap[dayName] || [];
}

function getBlocksForDay(dayName, blocksMap) {
  return blocksMap[dayName] || [];
}

function buildWindowsFromBlocks(blocks) {
  var windows = {};
  blocks.forEach(function(b) {
    var s = Math.max(0, Math.min(b.start || 0, 1440));
    var e = Math.max(s, Math.min(b.end || 0, 1440));
    if (!windows[b.tag]) windows[b.tag] = [];
    windows[b.tag].push([s, e]);
    // Alias: "biz" blocks starting at or after noon (720) also match "afternoon"
    if (b.tag === 'biz' && s >= 720) {
      if (!windows.afternoon) windows.afternoon = [];
      windows.afternoon.push([s, e]);
    }
  });
  // Build anytime from the original blocks (not from tag windows, which may
  // contain aliases/duplicates like biz→afternoon). Sort by start so the
  // anytime search visits earlier slots before later ones regardless of
  // DB block-definition order.
  var allWins = blocks.map(function(b) {
    var s = Math.max(0, Math.min(b.start || 0, 1440));
    var e = Math.max(s, Math.min(b.end || 0, 1440));
    return [s, e];
  });
  allWins.sort(function(a, b) { return a[0] - b[0]; });
  if (allWins.length === 0) allWins = [[360, 1380]];
  windows.anytime = allWins;
  return windows;
}

function getUniqueTags(blocks) {
  var seen = {};
  var result = [];
  blocks.forEach(function(b) {
    if (!seen[b.tag]) {
      seen[b.tag] = true;
      result.push({ tag: b.tag, name: b.name, icon: b.icon, color: b.color });
    }
  });
  return result;
}

function getBlockAtMinute(blocks, minute) {
  for (var i = 0; i < blocks.length; i++) {
    if (minute >= blocks[i].start && minute < blocks[i].end) return blocks[i];
  }
  return null;
}

function isBizHour(blocks, hour) {
  var min = hour * 60;
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].tag === "biz" && min >= blocks[i].start && min < blocks[i].end) return true;
  }
  return false;
}

function parseWhen(val) {
  if (!val || val === "anytime") return ["anytime"];
  return val.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
}

function hasWhen(val, check) {
  return parseWhen(val).indexOf(check) !== -1;
}

function getWhenWindows(whenVal, windowsMap, fallback) {
  var parts = parseWhen(whenVal);
  var result = [];
  var seen = {};
  var isExplicit = parts.length > 0 && parts[0] !== "anytime";
  parts.forEach(function(p) {
    if (windowsMap[p]) {
      windowsMap[p].forEach(function(w) {
        var s = Math.max(0, Math.min(w[0] || 0, 1440));
        var e = Math.max(s, Math.min(w[1] || 0, 1440));
        var key = s + "-" + e;
        if (!seen[key] && e > s) { seen[key] = true; result.push([s, e]); }
      });
    }
  });
  if (result.length > 0) return result;
  // If the day has no tagged blocks (only anytime), fall back to anytime
  // even for explicit when-tags.  Returning [] would skip the day entirely,
  // causing priority inversions when only some tasks have when-tags.
  if (isExplicit) {
    var hasTaggedBlocks = false;
    for (var k in windowsMap) { if (k !== 'anytime') { hasTaggedBlocks = true; break; } }
    if (hasTaggedBlocks) return [];
    // fall through to anytime
  }
  var all = windowsMap.anytime || windowsMap[fallback || "anytime"] || [];
  if (all.length > 0) {
    return all.map(function(w) {
      var s = Math.max(0, Math.min(w[0] || 0, 1440));
      var e = Math.max(s, Math.min(w[1] || 0, 1440));
      return [s, e];
    }).filter(function(w) { return w[1] > w[0]; });
  }
  return [[360, 1260]];
}

module.exports = {
  cloneBlocks,
  getBlocksForDate,
  getBlocksForDay,
  buildWindowsFromBlocks,
  getUniqueTags,
  getBlockAtMinute,
  isBizHour,
  parseWhen,
  hasWhen,
  getWhenWindows
};
