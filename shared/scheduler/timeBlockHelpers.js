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

function getBlocksForDate(dateStr, blocksMap, cfg) {
  var d = parseDate(dateStr);
  if (!d) return blocksMap.Mon || [];
  if (cfg && cfg.scheduleTemplates) {
    var templateId = null;
    if (cfg.locScheduleOverrides && cfg.locScheduleOverrides[dateStr]) {
      templateId = cfg.locScheduleOverrides[dateStr];
    }
    if (templateId) {
      if (cfg.scheduleTemplates[templateId]) {
        return cfg.scheduleTemplates[templateId].blocks || [];
      }
      // SUB-207a: a dated override referencing a templateId that no longer
      // exists in scheduleTemplates (a dangling ref — a pre-existing bad row
      // from before the 999.2144 write-side guard, or a since-deleted
      // non-system custom template; system templates cannot be deleted,
      // 999.2146) must NOT produce a zero-capacity day — fall through to the
      // day-of-week blocksMap below, same as "no override for this date".
      // Warn (once per dangling id) so it's visible in logs instead of
      // silently degrading placement.
      if (!_warnedDanglingTemplateIds.has(templateId)) {
        _warnedDanglingTemplateIds.add(templateId);
        console.warn(
          '[timeBlockHelpers.getBlocksForDate] override for ' + dateStr +
          ' references unknown templateId "' + templateId +
          '" — falling back to day-of-week blocks (SUB-207a)'
        );
      }
    }
  }
  var dayName = DAY_NAMES[d.getDay()];
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
