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

function getBlocksForDate(dateStr, blocksMap, cfg) {
  var d = parseDate(dateStr);
  if (!d) return blocksMap.Mon || [];
  if (cfg && cfg.scheduleTemplates) {
    var templateId = null;
    if (cfg.locScheduleOverrides && cfg.locScheduleOverrides[dateStr]) {
      templateId = cfg.locScheduleOverrides[dateStr];
    }
    if (templateId && cfg.scheduleTemplates[templateId]) {
      return cfg.scheduleTemplates[templateId].blocks || [];
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
  });
  var allWins = [];
  Object.values(windows).forEach(function(w) {
    w.forEach(function(x) { allWins.push(x); });
  });
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
