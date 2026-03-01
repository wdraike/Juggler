// Task Tracker v7.28 — fix location resolution granularity in placeEarly/placeLate — 2/28/2026 7:30 PM
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useReducer } from "react";
var $ = React.createElement; // shorthand for React.createElement

// Task field defaults — applied during seed/migration
const TASK_DEFAULTS = { where: "anywhere", when: "morning,lunch,afternoon,evening", dayReq: "any", dur: 30, notes: "", due: "", startAfter: "", section: "", dependsOn: [] };
function applyDefaults(t) { var out = Object.assign({}, TASK_DEFAULTS, t); if (!out.dependsOn) out.dependsOn = []; return out; }

// ── Error Boundary — prevents white screen on render crashes ──
class TaskTrackerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error: error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("TaskTracker crash:", error, errorInfo);
    this.setState({ errorInfo: errorInfo });
  }
  render() {
    if (this.state.hasError) {
      return $("div", { style: { padding: 40, textAlign: "center", fontFamily: "'DM Sans', system-ui", background: "#0F172A", color: "#E2E8F0", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" } },
        $("div", { style: { fontSize: 36, marginBottom: 12 } }, "\u26A0\uFE0F"),
        $("h2", { style: { margin: "0 0 8px", fontSize: 18, color: "#F87171" } }, "Task Tracker crashed"),
        $("p", { style: { fontSize: 13, color: "#94A3B8", maxWidth: 420, lineHeight: 1.5, marginBottom: 16 } },
          "An error occurred while rendering. Your data is safe in storage."
        ),
        $("pre", { style: { fontSize: 10, color: "#FB923C", background: "#1E293B", padding: "8px 12px", borderRadius: 6, maxWidth: 500, overflow: "auto", textAlign: "left", marginBottom: 16, maxHeight: 120 } },
          String(this.state.error)
        ),
        $("div", { style: { display: "flex", gap: 8 } },
          $("button", { onClick: () => this.setState({ hasError: false, error: null, errorInfo: null }), style: { padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3B82F6", color: "white", cursor: "pointer" } }, "Try Again"),
          $("button", { onClick: () => window.location.reload(), style: { padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "1px solid #475569", background: "transparent", color: "#94A3B8", cursor: "pointer" } }, "Reload Page")
        )
      );
    }
    return this.props.children;
  }
}

const PRI_COLORS = {
  P1: "#DC2626", P2: "#D97706", P3: "#2563EB", P4: "#6B7280",
};

const STATUS_OPTIONS = [
  { value: "", label: "—", bg: "#FFFFFF", color: "#9CA3AF", tip: "Open — not started" },
  { value: "done", label: "✓", bg: "#D1FAE5", color: "#065F46", tip: "Done — completed" },
  { value: "wip", label: "⏳", bg: "#FEF3C7", color: "#92400E", tip: "WIP — work in progress" },
  { value: "cancel", label: "✕", bg: "#FEE2E2", color: "#991B1B", tip: "Cancelled — won't do" },
  { value: "skip", label: "⏭", bg: "#F1F5F9", color: "#64748B", tip: "Skipped — not today" },
  { value: "other", label: "→", bg: "#EDE9FE", color: "#5B21B6", tip: "Redirected — doing something else" },
];

const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]));
const STORAGE_KEY = "task-tracker-v5b";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_NAMES_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// Location schedule: where you physically are each day
// Now driven by DEFAULT_SCHEDULE + LOCATION_OVERRIDES

// ── Default Locations ──
const DEFAULT_LOCATIONS = [
  { id: "home", name: "Home", icon: "🏠" },
  { id: "work", name: "Work", icon: "🏢" },
  { id: "transit", name: "Transit", icon: "🚗" },
  { id: "downtown", name: "Downtown", icon: "\u{1F3D9}\uFE0F" },
  { id: "gym", name: "Gym", icon: "\u{1F3CB}\uFE0F" },
];

// ── Default Tools ──
const DEFAULT_TOOLS = [
  { id: "phone", name: "Phone", icon: "\u{1F4F1}" },
  { id: "personal_pc", name: "Personal PC", icon: "\u{1F4BB}" },
  { id: "work_pc", name: "Work PC", icon: "\u{1F5A5}\uFE0F" },
  { id: "printer", name: "Printer", icon: "\u{1F5A8}\uFE0F" },
  { id: "car", name: "Car", icon: "\u{1F697}" },
];

// ── Default Tool Availability Matrix ──
const DEFAULT_TOOL_MATRIX = {
  home: ["phone", "personal_pc", "car"],
  work: ["phone", "work_pc", "printer"],
  transit: ["phone"],
  downtown: ["phone", "car"],
  gym: ["phone"],
};

// ── Default Weekly Schedule (which location each day) ──
const DEFAULT_WEEKLY_SCHEDULE = {
  Mon: "work", Tue: "work", Wed: "work", Thu: "work", Fri: "work",
  Sat: "home", Sun: "home",
};

// ── Location Overrides (travel / one-off) ──
const DEFAULT_LOCATION_OVERRIDES = {
  "2/21": { id: "home", name: "Richmond \u2192 NJ", icon: "\u2708\uFE0F", note: "Home until 5:46 PM flight" },
  "2/22": { id: "nj", name: "NJ", icon: "\u{1F3E8}", note: "Storm day — hotel" },
  "2/23": { id: "work", name: "NJ Office", icon: "🏢", note: "Berkeley Heights office" },
  "2/24": { id: "work", name: "NJ Office", icon: "🏢", note: "Berkeley Heights office" },
  "2/25": { id: "work", name: "NJ Office", icon: "🏢", note: "Berkeley Heights office" },
  "2/26": { id: "work", name: "NJ \u2192 Home", icon: "\u2708\uFE0F", note: "Work then 8:25 PM flight home" },
  "3/27": { id: "omaha", name: "Omaha", icon: "\u2708\uFE0F", note: "Fly to Omaha" },
  "3/28": { id: "omaha", name: "Omaha", icon: "\u{1F382}", note: "Birthday celebration + wedding weekend" },
  "3/29": { id: "omaha", name: "Omaha", icon: "\u{1F389}", note: "Wedding" },
  "3/30": { id: "omaha", name: "Omaha \u2192 Home", icon: "\u2708\uFE0F", note: "Fly home" },
};

// ── Default Time Blocks (per day of week, mutually exclusive, ordered) ──
const DEFAULT_WEEKDAY_BLOCKS = [
  { id: "morning", tag: "morning", name: "Morning", start: 360, end: 480, color: "#F59E0B", icon: "\u2600\uFE0F", loc: "home" },
  { id: "biz1", tag: "biz", name: "Biz", start: 480, end: 720, color: "#2563EB", icon: "\u{1F4BC}", loc: "work" },
  { id: "lunch", tag: "lunch", name: "Lunch", start: 720, end: 780, color: "#059669", icon: "\u{1F37D}\uFE0F", loc: "work" },
  { id: "biz2", tag: "biz", name: "Biz", start: 780, end: 1020, color: "#2563EB", icon: "\u{1F4BC}", loc: "work" },
  { id: "evening", tag: "evening", name: "Evening", start: 1020, end: 1260, color: "#7C3AED", icon: "\u{1F319}", loc: "home" },
  { id: "night", tag: "night", name: "Night", start: 1260, end: 1380, color: "#475569", icon: "\u{1F311}", loc: "home" },
];
const DEFAULT_WEEKEND_BLOCKS = [
  { id: "morning", tag: "morning", name: "Morning", start: 420, end: 720, color: "#F59E0B", icon: "\u2600\uFE0F", loc: "home" },
  { id: "afternoon", tag: "afternoon", name: "Afternoon", start: 720, end: 1020, color: "#F59E0B", icon: "\u{1F324}\uFE0F", loc: "home" },
  { id: "evening", tag: "evening", name: "Evening", start: 1020, end: 1260, color: "#7C3AED", icon: "\u{1F319}", loc: "home" },
  { id: "night", tag: "night", name: "Night", start: 1260, end: 1380, color: "#475569", icon: "\u{1F311}", loc: "home" },
];
const DEFAULT_TIME_BLOCKS = {
  Mon: DEFAULT_WEEKDAY_BLOCKS, Tue: DEFAULT_WEEKDAY_BLOCKS, Wed: DEFAULT_WEEKDAY_BLOCKS,
  Thu: DEFAULT_WEEKDAY_BLOCKS, Fri: DEFAULT_WEEKDAY_BLOCKS,
  Sat: DEFAULT_WEEKEND_BLOCKS, Sun: DEFAULT_WEEKEND_BLOCKS,
};

// Deep clone blocks for a day (so edits don't share references)
function cloneBlocks(blocks) {
  return blocks.map(function(b) { return Object.assign({}, b, { id: b.id + "_" + Date.now() + "_" + Math.random().toString(36).slice(2,5) }); });
}

// Get blocks for a specific date string (e.g. "2/23")
function getBlocksForDate(dateStr, blocksMap) {
  var d = parseDate(dateStr);
  if (!d) return blocksMap.Mon || [];
  var dayName = DAY_NAMES[d.getDay()];
  return blocksMap[dayName] || [];
}

// Get blocks for a day name (e.g. "Mon")
function getBlocksForDay(dayName, blocksMap) {
  return blocksMap[dayName] || [];
}

// Build windows map from time blocks: { tag: [[start,end], [start,end], ...] }
function buildWindowsFromBlocks(blocks) {
  var windows = {};
  blocks.forEach(function(b) {
    var s = Math.max(0, Math.min(b.start || 0, 1440));
    var e = Math.max(s, Math.min(b.end || 0, 1440));
    if (!windows[b.tag]) windows[b.tag] = [];
    windows[b.tag].push([s, e]);
  });
  // "anytime" = all blocks merged, with a default full-day fallback if empty
  var allWins = [];
  Object.values(windows).forEach(function(w) { w.forEach(function(x) { allWins.push(x); }); });
  if (allWins.length === 0) allWins = [[360, 1380]]; // 6 AM – 11 PM default
  windows.anytime = allWins;
  return windows;
}

// Get unique tags from blocks (for toggle buttons)
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

// Get block at a specific minute
function getBlockAtMinute(blocks, minute) {
  for (var i = 0; i < blocks.length; i++) {
    if (minute >= blocks[i].start && minute < blocks[i].end) return blocks[i];
  }
  return null;
}

// Check if an hour falls within any "biz" tagged block
function isBizHour(blocks, hour) {
  var min = hour * 60;
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].tag === "biz" && min >= blocks[i].start && min < blocks[i].end) return true;
  }
  return false;
}
// location is now an array: [] = anywhere, ["home"] = home only, ["home","work"] = either
function migrateTask(t) {
  var tIsFixed = hasWhen(t.when, "fixed");
  if (t.location !== undefined) {
    // Normalize: ensure location is always an array
    if (!t.location || t.location === "anywhere") {
      // Re-migrate: errand with empty location should be home (unless fixed — flights etc)
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
    // Re-migrate: errand with empty array should be home (unless fixed)
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

// ── Location resolution: per-hour with smart defaults ──
// Priority: hourOverrides → locScheduleOverrides → locScheduleDefaults → fallback "home"
// cfg must contain: { locSchedules, locScheduleDefaults, locScheduleOverrides, hourLocationOverrides }
function resolveLocationId(dateStr, hourOrMin, cfg, blocks) {
  var hour = hourOrMin < 24 ? hourOrMin : Math.floor(hourOrMin / 60);
  var minute = hourOrMin < 24 ? hourOrMin * 60 : hourOrMin;
  var minSlot = Math.floor(minute / 15) * 15;
  // 1. Per-hour override for specific date
  var hourOv = cfg.hourLocationOverrides;
  if (hourOv && hourOv[dateStr] && hourOv[dateStr][hour] !== undefined) {
    return hourOv[dateStr][hour];
  }
  // 2. Resolve which schedule template applies
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
  // 3. Look up minute in template
  if (templateId && cfg.locSchedules && cfg.locSchedules[templateId]) {
    var tmpl = cfg.locSchedules[templateId];
    if (tmpl.hours) {
      if (tmpl.hours[minSlot] !== undefined) return tmpl.hours[minSlot];
      if (tmpl.hours[hour] !== undefined) return tmpl.hours[hour];
    }
  }
  return "home";
}

// Get full location object from id
function getLocObj(locId, locationsList) {
  if (!locationsList) return { id: locId, name: locId, icon: "\u{1F4CD}" };
  var found = null;
  for (var i = 0; i < locationsList.length; i++) {
    if (locationsList[i].id === locId) { found = locationsList[i]; break; }
  }
  return found || { id: locId, name: locId, icon: "\u{1F4CD}" };
}

// Day-level summary: primary location for the day (most frequent hour)
function resolveDayLocation(dateStr, cfg, blocks) {
  var counts = {};
  for (var m = 360; m < 1380; m += 15) {
    var lid = resolveLocationId(dateStr, m, cfg, blocks);
    if (lid !== "transit") counts[lid] = (counts[lid] || 0) + 1;
  }
  var best = "home", bestN = 0;
  Object.keys(counts).forEach(function(k) { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
  return { id: best, name: best.charAt(0).toUpperCase() + best.slice(1), icon: best === "home" ? "🏠" : "🏢", note: "" };
}

// ── Can a task run at a given location with given tool availability? ──
function canTaskRun(task, dayLocId, toolMatrix) {
  var t = migrateTask(task);
  // Location check: empty array = anywhere, otherwise ANY must match
  if (t.location.length > 0 && t.location.indexOf(dayLocId) === -1) return false;
  // Tool check
  if (t.tools && t.tools.length > 0) {
    var available = (toolMatrix && toolMatrix[dayLocId]) || [];
    for (var i = 0; i < t.tools.length; i++) {
      if (available.indexOf(t.tools[i]) === -1) return false;
    }
  }
  return true;
}

// Check if task can run at a specific minute on a specific date
function canTaskRunAtMin(task, dateStr, minute, cfg, toolMatrix, blocks) {
  var locId = resolveLocationId(dateStr, minute, cfg, blocks);
  return canTaskRun(task, locId, toolMatrix);
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === "TBD") return null;
  const [m, d] = dateStr.split("/").map(Number);
  return new Date(2026, m - 1, d);
}

function formatDateKey(d) {
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function getWeekStart(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day);
  dt.setHours(0,0,0,0);
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


// ── Dependency helpers ──
function getTaskDeps(task) {
  var deps = task.dependsOn;
  if (!deps) return [];
  if (typeof deps === "string") return [deps];
  if (!Array.isArray(deps)) return [];
  return deps;
}

function getDepsStatus(task, allTasks, statuses) {
  var deps = getTaskDeps(task);
  if (deps.length === 0) return { satisfied: true, pending: [], done: [], missing: [] };
  var pending = [], done = [], missing = [];
  deps.forEach(function(depId) {
    var depTask = allTasks.find(function(t) { return t.id === depId; });
    if (!depTask) { missing.push(depId); return; }
    var st = statuses[depId] || "";
    if (st === "done") { done.push(depId); }
    else { pending.push(depId); }
  });
  return { satisfied: pending.length === 0 && missing.length === 0, pending: pending, done: done, missing: missing };
}

// Topological sort for dependency ordering within a task list
function topoSortTasks(tasks) {
  var taskMap = {};
  tasks.forEach(function(t) { taskMap[t.id] = t; });
  var visited = {}, result = [], temp = {};
  function visit(t) {
    if (temp[t.id]) return; // cycle protection
    if (visited[t.id]) return;
    temp[t.id] = true;
    var deps = getTaskDeps(t);
    deps.forEach(function(depId) {
      if (taskMap[depId]) visit(taskMap[depId]);
    });
    temp[t.id] = false;
    visited[t.id] = true;
    result.push(t);
  }
  tasks.forEach(function(t) { visit(t); });
  return result;
}

// Get all tasks that depend on a given task (downstream/dependents)
function getDependents(taskId, allTasks) {
  return allTasks.filter(function(t) {
    return getTaskDeps(t).indexOf(taskId) !== -1;
  });
}

// ── When multi-select helpers ──
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
  // If user explicitly chose a when-tag but it doesn't match any block on this date,
  // return empty — task is ineligible for this date. Don't silently fall back to anytime.
  if (isExplicit) return [];
  // Fallback only for "anytime" or unset: all blocks
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


// ── Time converters (pure) ──
function toTime24(t12) {
  if (!t12) return "";
  var m = t12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm|a|p)/i);
  if (!m) return "";
  var h = parseInt(m[1]), min = m[2], ap = (m[3]||"").toLowerCase();
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
  return "2026-" + (mon < 10 ? "0" : "") + mon + "-" + (day < 10 ? "0" : "") + day;
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

// ── Grid constants ──
var GRID_START = 6;  // 6 AM
var GRID_END = 23;   // 11 PM
var GRID_HOURS_COUNT = GRID_END - GRID_START + 1;

// ── Location background tints for calendar grid ──
var LOC_TINT = { home: "#3B82F6", work: "#F59E0B", transit: "#9CA3AF", downtown: "#10B981", gym: "#EF4444" };
function locBgTint(locId, alpha) { return (LOC_TINT[locId] || "#8B5CF6") + (alpha || "18"); }
function locIcon(locId) { return locId === "home" ? "🏠" : locId === "work" ? "🏢" : locId === "transit" ? "🚗" : locId === "downtown" ? "🏙️" : locId === "gym" ? "🏋️" : "📍"; }

// ── Location + blocking helpers (pure — take schedCfg) ──
function getLocationForDatePure(dateStr, cfg) {
  var blocks = getBlocksForDate(dateStr, cfg.timeBlocks);
  return resolveDayLocation(dateStr, cfg, blocks);
}
function getLocationForHourPure(dateStr, hour, cfg) {
  var blocks = getBlocksForDate(dateStr, cfg.timeBlocks);
  return resolveLocationId(dateStr, hour, cfg, blocks);
}
function isTaskBlockedPure(task, dateStr, cfg) {
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

// ── Recurring task generator (pure) ──
function generateRecurringPure(taskList, startDate, endDate) {
  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  var newTasks = [];
  var existingIds = {};
  taskList.forEach(function(t) { existingIds[t.id] = true; });

  // Find all tasks with recur rules (source tasks)
  var sources = taskList.filter(function(t) { return t.recur && t.recur.type !== "none"; });
  if (sources.length === 0) return 0;

  var cursor = new Date(startDate); cursor.setHours(0,0,0,0);
  var end = new Date(endDate); end.setHours(23,59,59,999);
  var maxIter = 400; // safety cap — max ~1 year of days

  while (cursor <= end && maxIter-- > 0) {
    var dateStr = formatDateKey(cursor);
    var dow = cursor.getDay();
    var dayName = DAY_NAMES[dow];

    sources.forEach(function(src) {
      var r = src.recur;
      var srcDate = parseDate(src.date);
      if (!srcDate) return;

      // Skip if cursor is before source date
      if (cursor < srcDate) return;
      // Skip the source's own date
      if (dateStr === src.date) return;

      var match = false;
      if (r.type === "daily") {
        match = true;
      } else if (r.type === "weekly" || r.type === "biweekly") {
        var days = r.days || "MTWRF";
        // Check if this day of week is in the days string
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
      // Also check old habit generator IDs (gh_xxx_MMD) to avoid duplicating migrated habits
      var oldId = "gh_" + src.id.replace("ht_", "") + "_" + dateStr.replace(/\//g, "");
      if (existingIds[oldId]) return;
      // Also skip if any task with same text exists on same date (catches dh* seeds)
      var hasDupe = taskList.some(function(et) { return et.date === dateStr && et.text === src.text && et.id !== src.id; });
      if (hasDupe) return;
      existingIds[id] = true;
      newTasks.push(applyDefaults({
        id: id, date: dateStr, day: dayName, project: src.project, text: src.text,
        pri: src.pri, habit: src.habit || false, rigid: src.rigid || false,
        time: src.time, dur: src.dur, where: src.where, when: src.when,
        dayReq: src.dayReq || "any", section: "", notes: "",
        sourceId: src.id, generated: true,
      }));
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return newTasks;
};

// ── Unified Scheduler ──
// ONE algorithm: day-by-day, slot-by-slot.
// 1. Habits stagger around each other
// 2. Fixed overlay on top (can overlap, reserve time)
// 3. Pool sorted by strict deadline tiers, then P1-P4
// 4. Walk 15-min slots filling from pool; splitting happens naturally
// 5. Non-splittable tasks overflow with warning if deadline forces it
//
// Returns: { dayPlacements: { dateKey: [placed items] }, taskUpdates, newStatuses, unplaced, deadlineMisses, placedCount }

function effectivePriority(task, refDate) {
  // Priority tier is PRIMARY (thousands), deadline urgency is SECONDARY (hundreds)
  // P1 with no deadline always beats P2 with urgent deadline
  var priRank = { P1: 4000, P2: 3000, P3: 2000, P4: 1000 };
  var base = priRank[task.pri] || 0;
  if (!task.due || !refDate) return base;
  var dd = parseDate(task.due);
  if (!dd) return base;
  var ref = (refDate instanceof Date) ? refDate : parseDate(refDate);
  if (!ref) return base;
  var days = Math.ceil((dd - ref) / 86400000);
  if (days < 0) return base + 600;  // overdue
  if (days === 0) return base + 500; // due today
  if (days <= 1) return base + 400;
  if (days <= 3) return base + 300;
  if (days <= 7) return base + 200;
  return base;
}

function unifiedSchedule(allTasks, statuses, effectiveTodayKey, nowMins, cfg) {
  var PERF = performance.now();
  var dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var priRank = { P1: 100, P2: 80, P3: 50, P4: 20 };
  var MIN_CHUNK = cfg.splitMinDefault || 15;
  // schedFloor removed — time blocks define the schedule
  var WALK_END = 23 * 60;
  var DAY_START = GRID_START * 60;
  var DAY_END = GRID_END * 60 + 59;
  var newSt = { ...statuses };
  var taskUpdates = {};

  // ── Build date range ──
  var dates = [];
  var localToday = parseDate(effectiveTodayKey) || new Date();
  localToday.setHours(0,0,0,0);
  var cursor = new Date(localToday);
  var endDate = new Date(cursor); endDate.setDate(endDate.getDate() + 37);
  allTasks.forEach(function(t) {
    var d = parseDate(t.date); if (d && d > endDate) { endDate = new Date(d); endDate.setDate(endDate.getDate() + 7); }
    var dd = parseDate(t.due); if (dd && dd > endDate) { endDate = new Date(dd); endDate.setDate(endDate.getDate() + 3); }
  });
  while (cursor <= endDate && dates.length < 400) {
    dates.push({
      key: formatDateKey(cursor), dow: cursor.getDay(),
      isWeekday: cursor.getDay() >= 1 && cursor.getDay() <= 5,
      isToday: formatDateKey(cursor) === effectiveTodayKey,
      date: new Date(cursor)
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  // ── Categorize tasks ──
  var habitsByDate = {};  // dateKey → [task]
  var fixedByDate = {};   // dateKey → [task]
  var pool = [];          // global pool

  allTasks.forEach(function(t) {
    var st = newSt[t.id] || "";
    if (st === "done" || st === "cancel" || st === "skip") return;
    if (!t.date || t.date === "TBD") return;
    if (t.section && (t.section.includes("PARKING") || t.section.includes("TO BE SCHEDULED"))) return;
    var td = parseDate(t.date);
    if (!td) return;
    var effectiveDur = Math.min((t.timeRemaining != null ? t.timeRemaining : t.dur) || 30, 720);
    if (effectiveDur <= 0) return;

    var sm = parseTimeToMinutes(t.time);
    var tdKey = formatDateKey(td);
    var isPast = false;
    if (tdKey === effectiveTodayKey) {
      if (sm !== null && sm + effectiveDur <= nowMins) isPast = true;
    } else if (td < localToday) {
      isPast = true;
    }

    // Fixed tasks: stay on their date, overlay
    if (hasWhen(t.when, "fixed")) {
      if (!isPast) { if (!fixedByDate[tdKey]) fixedByDate[tdKey] = []; fixedByDate[tdKey].push(t); }
      return;
    }
    // Habits: stay on their date, stagger
    if (t.habit) {
      if (!isPast) { if (!habitsByDate[tdKey]) habitsByDate[tdKey] = []; habitsByDate[tdKey].push(t); }
      return;
    }

    // Past-due tasks: reschedule freely via pool
    // Future/today tasks: pool for time-slot finding, but locked to their assigned date
    if (isPast || st === "wip" || st === "" || st === "other") {
      var earliest = null;
      var ceiling = null;
      if (t.startAfter) {
        var saDate = parseDate(t.startAfter);
        if (saDate) { saDate.setHours(0,0,0,0); earliest = earliest ? (saDate > earliest ? saDate : earliest) : saDate; }
      }
      if (!isPast && td >= localToday) {
        if (!earliest || earliest <= td) {
          earliest = td;
          // No ceiling — task flows to next available day if assigned date is full
        }
      }
      var deadline = t.due ? parseDate(t.due) : null;
      if (deadline) deadline.setHours(23,59,59,999);

      pool.push({
        task: t, remaining: effectiveDur, totalDur: effectiveDur,
        earliestDate: earliest, deadline: deadline, ceiling: ceiling,
        splittable: t.split !== undefined ? t.split : cfg.splitDefault,
        minChunk: t.splitMin || MIN_CHUNK,
        _parts: []
      });
    }
  });

  // Build lookup of pool task IDs — "dep not in pool" = done/cancelled = met
  var poolIds = {};
  pool.forEach(function(item) { poolIds[item.task.id] = true; });

  // ── Helper functions ──
  function reserve(occ, s, d) { for (var i = Math.max(0,s); i < Math.min(s+d,1440); i++) occ[i] = true; }
  function isFree(occ, s, d) { for (var i = s; i < s+d && i < 1440; i++) { if (occ[i]) return false; } return true; }
  function buildLocMask(task, dateKey, dateBlocks) {
    var mask = {};
    // Check every 15-min slot for location compatibility
    for (var m = GRID_START * 60; m < (GRID_END + 1) * 60; m += 15) {
      var locId = resolveLocationId(dateKey, m, cfg, dateBlocks);
      if (!canTaskRun(task, locId, cfg.toolMatrix)) {
        for (var mm = m; mm < m + 15; mm++) mask[mm] = true;
      }
    }
    return mask;
  }

  // ── Persistent day state ──
  var dayPlacements = {};
  var dayOcc = {};
  var dayWindows = {};
  var dayBlocks = {};
  var dayPlaced = {};
  var globalPlacedEnd = {}; // { taskId: { dateKey, endMin } }

  // ── Initialize every day: occ map, windows, blocks ──
  dates.forEach(function(d) {
    var occ = {};
    dayOcc[d.key] = occ;
    dayPlaced[d.key] = [];
    dayBlocks[d.key] = getBlocksForDate(d.key, cfg.timeBlocks);
    dayWindows[d.key] = buildWindowsFromBlocks(dayBlocks[d.key]);
    if (d.isToday) {
      var nowSlot = Math.ceil(nowMins / 15) * 15;
      for (var pm = 0; pm < nowSlot; pm++) occ[pm] = true;
    }
  });

  // ── Helper: record a placement ──
  function recordPlace(occ, placed, t, start, dur, locked, dateKey, item) {
    reserve(occ, start, dur);
    var part = { task: t, start: start, dur: dur, locked: locked, _dateKey: dateKey };
    placed.push(part);
    if (item) { item._parts.push(part); item.remaining -= dur; }
    globalPlacedEnd[t.id] = { dateKey: dateKey, endMin: start + dur };
    if (!locked && !taskUpdates[t.id]) {
      var hh = Math.floor(start / 60), mm = start % 60;
      var ampm = hh >= 12 ? "PM" : "AM";
      var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
      taskUpdates[t.id] = { date: dateKey, day: dayNames[new Date(parseDate(dateKey)).getDay()], time: dh + ":" + (mm < 10 ? "0" : "") + mm + " " + ampm };
    }
    return part;
  }

  // ── Helper: check day/when/location compatibility ──
  function canPlaceOnDate(t, d) {
    if (t.dayReq && t.dayReq !== "any") {
      if (t.dayReq === "weekday" && !d.isWeekday) return false;
      if (t.dayReq === "weekend" && d.isWeekday) return false;
      var dm = {M:1,T:2,W:3,R:4,F:5,Sa:6,Su:0,S:6};
      if (dm[t.dayReq] !== undefined && dm[t.dayReq] !== d.dow) return false;
    }
    return true;
  }

  // ── Helper: check if all deps are placed on/before a given date ──
  function depsMetByDate(t, d) {
    var ok = true;
    getTaskDeps(t).forEach(function(depId) {
      var info = globalPlacedEnd[depId];
      if (info) {
        var depDate = parseDate(info.dateKey);
        if (depDate > d.date) ok = false;
      } else if (poolIds[depId]) {
        // Dep is in pool but not yet placed — can't proceed
        ok = false;
      }
      // else: dep not in pool (done/cancelled/doesn't exist) — treat as met
    });
    return ok;
  }

  // ── EARLY PLACEMENT: scan forward for earliest slot ──
  // Returns true if anything was placed. afterMin = earliest allowed minute (for dep ordering on same day)
  function placeEarly(item, d, afterMin) {
    var t = item.task;
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var wins = getWhenWindows(t.when, dayWindows[d.key]);
    if (wins.length === 0) return false;
    var scanStart = Math.max(wins[0][0], afterMin || 0);
    var placedAny = false;

    while (item.remaining > 0 && scanStart < WALK_END) {
      if (occ[scanStart]) { scanStart++; continue; }
      var gEnd = scanStart + 1;
      while (gEnd < WALK_END && !occ[gEnd]) gEnd++;
      var gapSize = gEnd - scanStart;

      // Check we're inside a when-window
      var inWin = false, winEnd = WALK_END;
      for (var wi = 0; wi < wins.length; wi++) {
        if (scanStart >= wins[wi][0] && scanStart < wins[wi][1]) { inWin = true; winEnd = wins[wi][1]; break; }
      }
      if (!inWin) {
        var nextWinStart = WALK_END;
        for (var nwi = 0; nwi < wins.length; nwi++) {
          if (wins[nwi][0] > scanStart && wins[nwi][0] < nextWinStart) nextWinStart = wins[nwi][0];
        }
        scanStart = nextWinStart; continue;
      }

      // Location check (use minute granularity for 15-min template accuracy)
      var locId = resolveLocationId(d.key, scanStart, cfg, dayBlocks[d.key]);
      if (!canTaskRun(t, locId, cfg.toolMatrix)) { scanStart = Math.floor(scanStart / 15) * 15 + 15; continue; }

      // Splittable checks
      if (!item.splittable && gapSize < item.remaining) { scanStart = gEnd; continue; }
      if (item.splittable && gapSize < item.minChunk && item.remaining > gapSize) { scanStart = gEnd; continue; }

      // Compute how much we can place in this contiguous, same-location block
      var placeEnd = Math.min(gEnd, winEnd);
      var lEnd = scanStart;
      while (lEnd < placeEnd) {
        var lId = resolveLocationId(d.key, lEnd, cfg, dayBlocks[d.key]);
        if (!canTaskRun(t, lId, cfg.toolMatrix)) break;
        lEnd++;
      }
      var maxPlace = lEnd - scanStart;
      var placeLen = Math.min(item.remaining, maxPlace);

      // Avoid orphan remainder
      if (item.remaining - placeLen > 0 && item.remaining - placeLen < item.minChunk) {
        if (maxPlace >= item.remaining) placeLen = item.remaining;
      }
      if (placeLen <= 0) { scanStart++; continue; }

      recordPlace(occ, placed, t, scanStart, placeLen, false, d.key, item);
      placedAny = true;
      scanStart += placeLen;
    }
    return placedAny;
  }

  // ── LATE PLACEMENT: scan backward for latest slot ──
  // Used for deadline tasks — places at end of day. beforeMin = latest allowed end minute.
  function placeLate(item, d, beforeMin) {
    var t = item.task;
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var wins = getWhenWindows(t.when, dayWindows[d.key]);
    if (wins.length === 0) return false;
    var maxEnd = beforeMin || WALK_END;

    // Scan backward: find latest free gap inside when-windows
    // For non-splittable, need contiguous block of item.remaining
    // For splittable, can use multiple chunks (placed from latest to earliest)
    var chunks = []; // collect { start, len } in reverse order
    var needed = item.remaining;

    for (var wi = wins.length - 1; wi >= 0 && needed > 0; wi--) {
      var wStart = wins[wi][0];
      var wEnd = Math.min(wins[wi][1], maxEnd);
      if (wEnd <= wStart) continue;

      // Find free gaps within this window, scanning backward
      var pos = wEnd - 1;
      while (pos >= wStart && needed > 0) {
        if (occ[pos]) { pos--; continue; }
        // Found free minute — extend backward to find gap start
        var gapEnd = pos + 1; // exclusive end
        while (pos > wStart && !occ[pos - 1]) pos--;
        // pos is now the start of the free gap, gapEnd is the exclusive end
        var gapStart = pos;
        var gapSize = gapEnd - gapStart;

        // Location check across gap (use minute granularity)
        var locOk = true;
        for (var cm = gapStart; cm < gapEnd; cm++) {
          var lId = resolveLocationId(d.key, cm, cfg, dayBlocks[d.key]);
          if (!canTaskRun(t, lId, cfg.toolMatrix)) { locOk = false; break; }
        }

        if (locOk && gapSize > 0) {
          if (!item.splittable) {
            // Need the whole thing in one chunk
            if (gapSize >= needed) {
              // Place at the END of this gap (latest possible)
              var start = gapEnd - needed;
              chunks.push({ start: start, len: needed });
              needed = 0;
            }
            // If gap too small for non-splittable, skip it
          } else {
            // Splittable: take as much as we need from the end of this gap
            var take = Math.min(needed, gapSize);
            if (take < item.minChunk && needed > take) {
              // Remainder too small — skip unless it finishes the task
              pos--;
              continue;
            }
            var start = gapEnd - take;
            chunks.push({ start: start, len: take });
            needed -= take;
          }
        }
        pos = gapStart - 1;
      }
    }

    if (needed > 0 && chunks.length === 0) return false; // nothing could be placed at all

    // Place whatever chunks we found (may be partial for splittable tasks)
    chunks.forEach(function(c) {
      recordPlace(occ, placed, t, c.start, c.len, false, d.key, item);
    });
    return true;
  }

  // ── Helper: unplace a task completely ──
  function unplaceItem(item) {
    item._parts.forEach(function(part) {
      var occ = dayOcc[part._dateKey];
      if (occ) { for (var m = part.start; m < part.start + part.dur; m++) delete occ[m]; }
      var pl = dayPlaced[part._dateKey];
      if (pl) { var idx = pl.indexOf(part); if (idx !== -1) pl.splice(idx, 1); }
    });
    item.remaining = item.totalDur;
    item._parts = [];
    delete taskUpdates[item.task.id];
    delete globalPlacedEnd[item.task.id];
  }

  // ── Helper: find the date object for a dateKey ──
  function getDateObj(key) {
    for (var i = 0; i < dates.length; i++) { if (dates[i].key === key) return dates[i]; }
    return null;
  }

  // ── Helper: collect full dependency chain above a task (all ancestors) ──
  function getAncestorChain(task) {
    var chain = [];
    var visited = {};
    function walk(tid) {
      if (visited[tid]) return;
      visited[tid] = true;
      var t = null;
      for (var i = 0; i < pool.length; i++) { if (pool[i].task.id === tid) { t = pool[i]; break; } }
      if (!t) return;
      var deps = getTaskDeps(t.task);
      deps.forEach(function(depId) { walk(depId); });
      chain.push(t); // ancestors first, leaf last
    }
    walk(task.id);
    return chain;
  }

  // ── Helper: count when-window options (fewer = more constrained = place first) ──
  function whenOptionCount(task) {
    var w = task.when || "morning,lunch,afternoon,evening";
    return w.split(",").length;
  }

  // ══════════════════════════════════════════════════════
  // STEP 1: Fixed items
  // ══════════════════════════════════════════════════════
  dates.forEach(function(d) {
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var fixedTasks = fixedByDate[d.key] || [];
    fixedTasks.forEach(function(t) {
      var sm = parseTimeToMinutes(t.time);
      if (sm === null) return;
      var dur = Math.min((t.timeRemaining != null ? t.timeRemaining : t.dur) || 30, 720);
      if (dur <= 0) return;
      sm = Math.max(DAY_START, Math.min(sm, GRID_END * 60));
      reserve(occ, sm, dur);
      placed.push({ task: t, start: sm, dur: dur, locked: true, _dateKey: d.key });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur };
    });
  });

  // ══════════════════════════════════════════════════════
  // STEP 2: Rigid habits — try preferred time, stagger, then force-place
  // Placed before all pool tasks to anchor the day structure
  // ══════════════════════════════════════════════════════
  dates.forEach(function(d) {
    var habits = habitsByDate[d.key] || [];
    habits.filter(function(t) { return t.rigid; }).forEach(function(t) {
      placeHabit(t, d);
    });
  });

  // ── Helper: place a single non-rigid habit on a given day ──
  function placeHabit(t, d) {
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var dateBlocks_d = dayBlocks[d.key];
    var dateWindows_d = dayWindows[d.key];
    var dur = Math.min((t.timeRemaining != null ? t.timeRemaining : t.dur) || 30, 720);
    if (dur <= 0) return;
    var sm = parseTimeToMinutes(t.time);
    var mask = buildLocMask(t, d.key, dateBlocks_d);

    if (sm === null) {
      var hw = getWhenWindows(t.when, dateWindows_d, "morning")[0];
      sm = hw ? hw[0] : GRID_START * 60;
    } else {
      sm = Math.max(DAY_START, Math.min(sm, GRID_END * 60));
    }

    // Try preferred time first
    var locOk = true;
    for (var hm = sm; hm < sm + dur; hm++) { if (mask[hm]) { locOk = false; break; } }
    if (locOk && isFree(occ, sm, dur)) {
      reserve(occ, sm, dur);
      placed.push({ task: t, start: sm, dur: dur, locked: true, _dateKey: d.key });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur };
      return;
    }

    // Stagger: search within when-windows
    var hWins = getWhenWindows(t.when, dateWindows_d, "morning");
    if (hWins.length === 0) hWins = [[GRID_START * 60, DAY_END]];
    var found = false;
    for (var wi = 0; wi < hWins.length && !found; wi++) {
      for (var s = hWins[wi][0]; s + dur <= hWins[wi][1]; s += 15) {
        var ok = true;
        for (var cm = s; cm < s + dur; cm++) { if (occ[cm] || mask[cm]) { ok = false; break; } }
        if (ok) {
          reserve(occ, s, dur);
          placed.push({ task: t, start: s, dur: dur, locked: true, _dateKey: d.key });
          globalPlacedEnd[t.id] = { dateKey: d.key, endMin: s + dur };
          found = true; break;
        }
      }
    }
    if (!found) {
      reserve(occ, sm, dur);
      placed.push({ task: t, start: sm, dur: dur, locked: true, _dateKey: d.key, overflow: true });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur };
    }
  }

  // ══════════════════════════════════════════════════════
  // STEPS 4-6: Priority loop — habits + deadline tasks + pull forward
  // For each priority P1→P4:
  //   a) Place non-rigid habits at this priority
  //   b) Late-place deadline tasks
  //   c) Pull forward deadline tasks
  // ══════════════════════════════════════════════════════
  var PRI_LEVELS = ["P1", "P2", "P3", "P4"];

  PRI_LEVELS.forEach(function(priLevel) {
    // ── 3a. Place non-rigid habits at this priority level ──
    // Most-constrained-first: fewer when-windows get placed first
    dates.forEach(function(d) {
      var habits = habitsByDate[d.key] || [];
      habits.filter(function(t) {
        return !t.rigid && (t.pri || "P3") === priLevel && !globalPlacedEnd[t.id];
      }).sort(function(a, b) {
        var ca = whenOptionCount(a), cb = whenOptionCount(b);
        if (ca !== cb) return ca - cb;
        var ta = parseTimeToMinutes(a.time) || 0, tb = parseTimeToMinutes(b.time) || 0;
        return ta - tb;
      }).forEach(function(t) {
        placeHabit(t, d);
      });
    });

    // ── 4. Late-place deadline tasks at this priority on their due dates ──
    // Walk dependency chains: leaf (due-date task) placed last in day, prereqs placed before
    var deadlineItems = pool.filter(function(item) {
      return item.deadline && item.remaining > 0 && (item.task.pri || "P3") === priLevel;
    });
    // Sort by due date (earliest first), then most-constrained-first (fewest when-windows)
    deadlineItems.sort(function(a, b) {
      var dd = a.deadline - b.deadline;
      if (dd !== 0) return dd;
      return whenOptionCount(a.task) - whenOptionCount(b.task);
    });

    deadlineItems.forEach(function(item) {
      if (item.remaining <= 0) return; // might have been placed as part of another chain
      var chain = getAncestorChain(item.task);
      // chain is ancestors-first, leaf-last. We place leaf first (late), then work backward.
      // Reverse: place leaf at due date, then each ancestor before the next
      chain.reverse(); // now: leaf first, root last

      var nextBeforeDate = null;  // the date that the next task in chain must finish by
      var nextBeforeMin = null;   // the minute on that date

      for (var ci = 0; ci < chain.length; ci++) {
        var cItem = chain[ci];
        if (cItem.remaining <= 0) {
          // Already placed (maybe by an earlier chain) — use its placement as the constraint
          var info = globalPlacedEnd[cItem.task.id];
          if (info) {
            // The NEXT item must be placed before this one
            // Actually we need the START of this item, not end
            var earliestStart = null;
            cItem._parts.forEach(function(p) {
              if (earliestStart === null || p.start < earliestStart) earliestStart = p.start;
            });
            nextBeforeDate = parseDate(info.dateKey);
            nextBeforeMin = earliestStart || info.endMin;
          }
          continue;
        }

        // Determine the target date for this chain item
        var targetDate = null;
        if (ci === 0) {
          // Leaf: place on due date
          targetDate = cItem.deadline;
        } else {
          // Prerequisite: must be before the previously placed item
          targetDate = nextBeforeDate || cItem.deadline;
        }
        if (!targetDate) continue;

        // Try to late-place on targetDate, then scan backward through days
        var placed = false;
        var targetKey = formatDateKey(targetDate);

        for (var di = dates.length - 1; di >= 0; di--) {
          var d = dates[di];
          if (d.date > targetDate) continue;
          if (d.date < localToday) break;
          if (!canPlaceOnDate(cItem.task, d)) continue;
          var wins = getWhenWindows(cItem.task.when, dayWindows[d.key]);
          if (wins.length === 0) continue;

          // Location check (use minute granularity)
          var locId = resolveLocationId(d.key, wins[0][0], cfg, dayBlocks[d.key]);

          var beforeMin = WALK_END;
          // If placing on the same date as the dependent, must finish before dependent starts
          if (nextBeforeDate && d.date.getTime() === nextBeforeDate.getTime() && nextBeforeMin != null) {
            beforeMin = nextBeforeMin;
          }

          if (placeLate(cItem, d, beforeMin)) {
            placed = true;
            // Record this placement's start as constraint for next in chain
            var myStart = null;
            cItem._parts.forEach(function(p) {
              if (myStart === null || p.start < myStart) myStart = p.start;
            });
            nextBeforeDate = d.date;
            nextBeforeMin = myStart;
            break;
          }
        }
        // If couldn't place, leave it — it'll be unplaced
      }
    });

    // ── 5. Pull forward: soonest-due first, split across days if needed ──
    var pullItems = pool.filter(function(item) {
      return item.deadline && item._parts.length > 0 && (item.task.pri || "P3") === priLevel;
    });
    // Sort by current placement date (soonest first), then most-constrained-first
    pullItems.sort(function(a, b) {
      var aDate = parseDate(a._parts[0]._dateKey);
      var bDate = parseDate(b._parts[0]._dateKey);
      var dd = aDate - bDate;
      if (dd !== 0) return dd;
      return whenOptionCount(a.task) - whenOptionCount(b.task);
    });

    pullItems.forEach(function(item) {
      var t = item.task;
      var dueDate = item.deadline;

      // Find pull floor: today or startAfter
      var pullFloor = new Date(localToday);
      if (t.startAfter) {
        var saDate = parseDate(t.startAfter);
        if (saDate && saDate > pullFloor) pullFloor = saDate;
      }

      // Save original placement for rollback
      var savedParts = item._parts.slice();
      var savedDateKey = savedParts.length > 0 ? savedParts[0]._dateKey : null;
      unplaceItem(item);

      // Walk forward day by day from earliest through due date, placing as much as fits
      for (var di = 0; di < dates.length; di++) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (d.date < pullFloor) continue;
        if (d.date > dueDate) break; // don't go past due date
        if (!canPlaceOnDate(t, d)) continue;
        if (!depsMetByDate(t, d)) continue;

        var wins = getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) continue;

        placeEarly(item, d);
      }

      if (item.remaining > 0 && savedDateKey) {
        // Couldn't fully place — restore original late placement
        unplaceItem(item);
        var origD = getDateObj(savedDateKey);
        if (origD) placeLate(item, origD, WALK_END);
      }
    });
  });

  // ══════════════════════════════════════════════════════
  // STEPS 7-8: Non-deadline tasks — earliest available, P1→P4
  // Deps get pulled in recursively regardless of their priority
  // ══════════════════════════════════════════════════════
  var placeVisited = {}; // prevent infinite recursion

  function placeWithDeps(item) {
    if (!item || item.remaining <= 0) return;
    if (placeVisited[item.task.id]) return;
    placeVisited[item.task.id] = true;

    // First, recursively place all unplaced prerequisites
    getTaskDeps(item.task).forEach(function(depId) {
      if (globalPlacedEnd[depId]) return; // already placed
      var depItem = null;
      for (var i = 0; i < pool.length; i++) { if (pool[i].task.id === depId) { depItem = pool[i]; break; } }
      if (depItem && depItem.remaining > 0) placeWithDeps(depItem);
    });

    // Now place this task at earliest available
    var t = item.task;
    for (var di = 0; di < dates.length; di++) {
      if (item.remaining <= 0) break;
      var d = dates[di];
      if (item.earliestDate && d.date < item.earliestDate) continue;
      if (item.ceiling && d.date > item.ceiling) continue;
      if (!canPlaceOnDate(t, d)) continue;
      if (!depsMetByDate(t, d)) continue;
      var wins = getWhenWindows(t.when, dayWindows[d.key]);
      if (wins.length === 0) continue;
      placeEarly(item, d);
    }
  }

  PRI_LEVELS.forEach(function(priLevel) {
    var items = pool.filter(function(item) {
      return !item.deadline && item.remaining > 0 && (item.task.pri || "P3") === priLevel;
    });
    // Sort by assigned date (sooner first), then most-constrained-first
    items.sort(function(a, b) {
      var aDate = parseDate(a.task.date) || localToday;
      var bDate = parseDate(b.task.date) || localToday;
      var dd = aDate - bDate;
      if (dd !== 0) return dd;
      return whenOptionCount(a.task) - whenOptionCount(b.task);
    });
    items.forEach(function(item) { placeWithDeps(item); });
  });

  // ══════════════════════════════════════════════════════
  // POST-PROCESSING: Overlap columns + unique keys for all days
  // ══════════════════════════════════════════════════════
  dates.forEach(function(d) {
    var placed = dayPlaced[d.key];
    if (!placed || placed.length === 0) { dayPlacements[d.key] = []; return; }

    placed.sort(function(a, b) { return a.start - b.start; });
    placed.forEach(function(x) { x.col = 0; x.cols = 1; });
    var colDone = {};
    for (var i = 0; i < placed.length; i++) {
      if (colDone[i]) continue;
      var grp = [i], ge = placed[i].start + placed[i].dur;
      for (var j = i + 1; j < placed.length; j++) {
        if (placed[j].start < ge) { grp.push(j); ge = Math.max(ge, placed[j].start + placed[j].dur); }
        else break;
      }
      if (grp.length > 1) {
        var usedCols = [];
        grp.forEach(function(idx) {
          var x = placed[idx];
          var c = 0;
          while (usedCols[c] && usedCols[c] > x.start && c < 20) c++;
          x.col = c; usedCols[c] = x.start + x.dur;
          colDone[idx] = true;
        });
        var mc = 0;
        grp.forEach(function(idx) { if (placed[idx].col > mc) mc = placed[idx].col; });
        grp.forEach(function(idx) { placed[idx].cols = mc + 1; });
      }
      colDone[i] = true;
    }

    var idCount = {};
    placed.forEach(function(item) {
      var id = item.task.id;
      idCount[id] = (idCount[id] || 0) + 1;
      item.key = idCount[id] > 1 ? id + "_p" + idCount[id] : id;
    });

    dayPlacements[d.key] = placed;
  });

  // ── Label split parts across all days ──
  pool.forEach(function(item) {
    if (item._parts.length <= 1) return;
    for (var p = 0; p < item._parts.length; p++) {
      item._parts[p].splitPart = p + 1;
      item._parts[p].splitTotal = item._parts.length;
    }
  });

  // ── Collect unplaced with detailed diagnostics ──
  var unplaced = [];
  pool.forEach(function(item) {
    if (item.remaining > 0 && item._parts.length === 0) {
      var t = item.task;
      t._unplacedReason = item.deadline ? "deadline" : "no-capacity";
      
      // Build detailed diagnostic
      var detail = [];
      var depName = function(id) {
        var dt = allTasks.find(function(at) { return at.id === id; });
        return dt ? "\"" + dt.text + "\"" : id + " (missing)";
      };
      var deps = getTaskDeps(t);
      if (deps.length > 0) {
        var blockedDeps = [];
        deps.forEach(function(depId) {
          var info = globalPlacedEnd[depId];
          if (info) {
            // placed — ok
          } else if (poolIds[depId]) {
            blockedDeps.push(depName(depId) + " (unplaced)");
          } else {
            // not in pool — check if it exists at all in allTasks
            var found = allTasks.find(function(at) { return at.id === depId; });
            if (found) {
              var st = newSt[depId] || "";
              if (st === "done" || st === "cancel" || st === "skip") {
                // This is fine — treated as met
              } else {
                blockedDeps.push(depName(depId) + " (not scheduled — no date or PARKING?)");
              }
            } else {
              // doesn't exist at all — should be treated as met
            }
          }
        });
        if (blockedDeps.length > 0) {
          detail.push("Blocked by deps: " + blockedDeps.join(", "));
        }
      }
      
      // Check date constraints
      if (item.earliestDate) detail.push("Earliest: " + formatDateKey(item.earliestDate));
      if (item.deadline) detail.push("Deadline: " + formatDateKey(item.deadline));
      if (item.ceiling) detail.push("Ceiling: " + formatDateKey(item.ceiling));
      detail.push("Duration: " + item.totalDur + "m, splittable: " + (item.splittable ? "yes" : "no") + ", minChunk: " + item.minChunk);
      detail.push("When: " + (t.when || "any") + ", DayReq: " + (t.dayReq || "any"));
      
      // Try each date and report why it failed
      var dateTrials = [];
      var trialCount = 0;
      dates.forEach(function(d) {
        if (trialCount >= 5) return; // limit output
        if (item.earliestDate && d.date < item.earliestDate) return;
        if (item.deadline && d.date > item.deadline) return;
        if (item.ceiling && d.date > item.ceiling) return;
        var reasons = [];
        if (!canPlaceOnDate(t, d)) reasons.push("dayReq mismatch");
        if (!depsMetByDate(t, d)) reasons.push("deps not met");
        var wins = getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) reasons.push("no matching when-windows");
        else {
          var totalFree = 0;
          wins.forEach(function(w) {
            for (var m = w[0]; m < w[1]; m++) {
              if (!dayOcc[d.key][m]) totalFree++;
            }
          });
          if (totalFree < item.minChunk) reasons.push("only " + totalFree + "m free in windows (need " + item.minChunk + "m)");
          else if (totalFree < item.remaining) reasons.push(totalFree + "m free but need " + item.remaining + "m" + (item.splittable ? " (splittable)" : " (no split)"));
        }
        if (reasons.length > 0) {
          dateTrials.push(d.key + ": " + reasons.join("; "));
          trialCount++;
        }
      });
      if (dateTrials.length > 0) detail.push("Date trials: " + dateTrials.join(" | "));
      
      t._unplacedDetail = detail.join(" · ");
      unplaced.push(t);
    }
  });

  // ── Strip changes from fixed tasks ──
  allTasks.forEach(function(ft) {
    if (hasWhen(ft.when, "fixed") && taskUpdates[ft.id]) delete taskUpdates[ft.id];
  });

  var placedCount = Object.keys(taskUpdates).length;
  var deadlineMisses = unplaced.filter(function(t) { return t._unplacedReason === "deadline"; });
  console.log("[SCHED] unified: " + dates.length + " days, " + pool.length + " pool tasks, " + placedCount + " placed, " + unplaced.length + " unplaced in " + Math.round(performance.now() - PERF) + "ms");
  return { dayPlacements: dayPlacements, taskUpdates: taskUpdates, newStatuses: newSt, unplaced: unplaced, deadlineMisses: deadlineMisses, placedCount: placedCount };
}
// ── Task state reducer (single source of truth for statuses + directions + tasks) ──
var TASK_STATE_INIT = { statuses: {}, directions: {}, tasks: [] };
function taskReducer(state, action) {
  switch (action.type) {
    case 'INIT': return { statuses: action.statuses || {}, directions: action.directions || {}, tasks: action.tasks || [] };
    case 'SET_STATUS': {
      var ns = Object.assign({}, state.statuses);
      if (!action.val || action.val === "") { delete ns[action.id]; } else { ns[action.id] = action.val; }
      var nd = state.directions;
      if (action.deleteDirection) { nd = Object.assign({}, nd); delete nd[action.id]; }
      var nt = state.tasks;
      if (action.taskFields) { nt = nt.map(function(t) { return t.id === action.id ? Object.assign({}, t, action.taskFields) : t; }); }
      return { statuses: ns, directions: nd, tasks: nt };
    }
    case 'SET_DIRECTION': { var nd2 = Object.assign({}, state.directions); nd2[action.id] = action.val; return { statuses: state.statuses, directions: nd2, tasks: state.tasks }; }
    case 'UPDATE_TASK': return { statuses: state.statuses, directions: state.directions, tasks: state.tasks.map(function(t) { return t.id === action.id ? Object.assign({}, t, action.fields) : t; }) };
    case 'ADD_TASKS': return { statuses: state.statuses, directions: state.directions, tasks: state.tasks.concat(action.tasks) };
    case 'SET_ALL': return { statuses: action.statuses != null ? action.statuses : state.statuses, directions: action.directions != null ? action.directions : state.directions, tasks: action.tasks != null ? action.tasks : state.tasks };
    case 'RESTORE': return { statuses: action.statuses, directions: action.directions, tasks: action.extraTasks };
    default: return state;
  }
}

function TaskTrackerInner() {
  const [taskState, dispatch] = useReducer(taskReducer, TASK_STATE_INIT);
  var statuses = taskState.statuses;
  var directions = taskState.directions;
  var extraTasks = taskState.tasks;

  // Single ref for latest task state — used by undo, dispatchPersist, and compat wrappers
  var taskStateRef = React.useRef(taskState);
  taskStateRef.current = taskState;
  var setStatuses = useCallback(function(v) { dispatch({ type: 'SET_ALL', statuses: typeof v === 'function' ? v(taskStateRef.current.statuses) : v }); }, []);
  var setExtraTasks = useCallback(function(v) { dispatch({ type: 'SET_ALL', tasks: typeof v === 'function' ? v(taskStateRef.current.tasks) : v }); }, []);
  var setDirections = useCallback(function(v) { dispatch({ type: 'SET_ALL', directions: typeof v === 'function' ? v(taskStateRef.current.directions) : v }); }, []);

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [chainPopupId, setChainPopupId] = useState(null);
  const [chainOrder, setChainOrder] = useState(null); // visual display order
  const [chainDeps, setChainDeps] = useState({}); // { taskId: [depIds within chain] }
  const [chainDragIdx, setChainDragIdx] = useState(null);
  const chainBodyRef = React.useRef(null);
  const [chainArrows, setChainArrows] = useState([]); // [{ fromY, toY, fromIdx, toIdx, color }]
  const [chainDropIdx, setChainDropIdx] = useState(null);
  const [chainDirty, setChainDirty] = useState(false);
  const [chainAddDepFor, setChainAddDepFor] = useState(null); // taskId currently adding dep to
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [timeBlocks, setTimeBlocks] = useState(DEFAULT_TIME_BLOCKS);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [schedEditDay, setSchedEditDay] = useState("Mon");
  const [dayOffset, setDayOffset] = useState(0);
  const [expandedTask, setExpandedTask] = useState(null);
  const dayViewScrollRef = React.useRef(null);
  const expandedPanelRef = React.useRef(null);
  const [hideHabits, setHideHabits] = useState(false);
  const [showParking, setShowParking] = useState(false);
  const [viewMode, setViewMode] = useState("day"); // day or list
  const undoStackRef = React.useRef([]);
  const MAX_UNDO = 30;
  const [aiCmd, setAiCmd] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLog, setAiLog] = useState([]);
  const [showAi, setShowAi] = useState(false);
  var aiAutoHideRef = React.useRef(null);
  const taskAiRef = React.useRef(null);
  const autoRescheduleRef = React.useRef(null);
  const [pendingEdits, setPendingEdits] = useState(null);
  const [savedFlash, setSavedFlash] = useState({});
  const [toast, setToast] = useState(null); // { msg, type: "success"|"error"|"info", ts }
  const [toastHistory, setToastHistory] = useState([]); // [{ msg, type, ts }]
  const [showToastHistory, setShowToastHistory] = useState(false);
  const [gcalSyncOpen, setGcalSyncOpen] = useState(false);
  const [gcalSyncSel, setGcalSyncSel] = useState({});
  const [gcalSyncing, setGcalSyncing] = useState(false);
  const [gcalTab, setGcalTab] = useState("push"); // "push" | "pull"
  const [gcalEvents, setGcalEvents] = useState([]); // fetched from GCal
  const [gcalImportSel, setGcalImportSel] = useState({});
  const [gcalFetching, setGcalFetching] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { msg, fn, ts }
  const toastTimerRef = React.useRef(null);
  function showToast(msg, type) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    var entry = { msg: msg, type: type || "success", ts: Date.now() };
    setToast(entry);
    setToastHistory(function(prev) {
      var tenMinAgo = Date.now() - 10 * 60 * 1000;
      var pruned = prev.filter(function(t) { return t.ts > tenMinAgo; });
      return [entry].concat(pruned).slice(0, 50);
    });
    toastTimerRef.current = setTimeout(function() { setToast(null); }, 3500);
  }
  // Prune toast history every 60s — only update state if items actually expired
  useEffect(function() {
    var iv = setInterval(function() {
      setToastHistory(function(prev) {
        var tenMinAgo = Date.now() - 10 * 60 * 1000;
        var pruned = prev.filter(function(t) { return t.ts > tenMinAgo; });
        if (pruned.length === prev.length) return prev; // no change, skip re-render
        return pruned;
      });
    }, 60000);
    return function() { clearInterval(iv); };
  }, []);
  const [showStatePanel, setShowStatePanel] = useState(false);
  const [importText, setImportText] = useState("");
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS);
  const [tools, setTools] = useState(DEFAULT_TOOLS);
  const [toolMatrix, setToolMatrix] = useState(DEFAULT_TOOL_MATRIX);
  // ── Named location schedule templates ──
  const [locSchedules, setLocSchedules] = useState(function() {
    var weekdayHours = {}, weekendHours = {};
    (DEFAULT_TIME_BLOCKS["Mon"] || []).forEach(function(b) {
      for (var m = b.start; m < b.end; m += 15) weekdayHours[m] = b.loc || "home";
    });
    (DEFAULT_TIME_BLOCKS["Sat"] || []).forEach(function(b) {
      for (var m = b.start; m < b.end; m += 15) weekendHours[m] = b.loc || "home";
    });
    return {
      weekday: { name: "Weekday", icon: "\u{1F3E2}", system: true, hours: weekdayHours },
      weekend: { name: "Weekend", icon: "\u{1F3E0}", system: true, hours: weekendHours },
    };
  });
  const [locScheduleDefaults, setLocScheduleDefaults] = useState({
    Mon: "weekday", Tue: "weekday", Wed: "weekday", Thu: "weekday", Fri: "weekday",
    Sat: "weekend", Sun: "weekend",
  });
  const [locScheduleOverrides, setLocScheduleOverrides] = useState({}); // { "3/2": "nj-office", ... }
  const [hourLocationOverrides, setHourLocationOverrides] = useState({});
  const [configTab, setConfigTab] = useState("locations");
  const [priDrag, setPriDrag] = useState(null);
  const [priDragOver, setPriDragOver] = useState(null);
  const [gridZoom, setGridZoom] = useState(60);
  const [splitDefault, setSplitDefault] = useState(false); // global default: don't split unless task opts in
  const [splitMinDefault, setSplitMinDefault] = useState(15); // global min chunk in minutes
  const [projects, setProjects] = useState([]); // [{ id, name, color, icon }]
  const [schedFloor, setSchedFloor] = useState(480); // earliest minute for auto-schedule (8 AM default)
  // ── Weekly grid paint ref (drag tracking for schedule template editor) ──
  const weeklyPaintRef = React.useRef({ loc: "work", drag: null, ver: 0 });
  const [weeklyPaintVer, setWeeklyPaintVer] = useState(0);
  useEffect(function() {
    var up = function() { weeklyPaintRef.current.drag = null; };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return function() { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, []);

  // ── Derived from timeBlocks (per-day map) ──
  // All unique tags across all days (for edit form toggle buttons)
  const uniqueTags = useMemo(() => {
    var seen = {}, result = [];
    DAY_NAMES.forEach(function(dn) {
      (timeBlocks[dn] || []).forEach(function(b) {
        if (!seen[b.tag]) { seen[b.tag] = true; result.push({ tag: b.tag, name: b.name, icon: b.icon, color: b.color }); }
      });
    });
    return result;
  }, [timeBlocks]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0,0,0,0);
    return d;
  }, []);

  // Selected date for day view
  const selectedDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [today, dayOffset]);

  const selectedDateKey = useMemo(() => formatDateKey(selectedDate), [selectedDate]);

  // Per-date schedule resolution
  const selectedDayBlocks = useMemo(() => getBlocksForDate(selectedDateKey, timeBlocks), [selectedDateKey, timeBlocks]);
  const schedStart = useMemo(() => selectedDayBlocks.length > 0 ? selectedDayBlocks[0].start : 360, [selectedDayBlocks]);
  const schedEnd = useMemo(() => selectedDayBlocks.length > 0 ? selectedDayBlocks[selectedDayBlocks.length - 1].end : 1260, [selectedDayBlocks]);
  const windowsMap = useMemo(() => buildWindowsFromBlocks(selectedDayBlocks), [selectedDayBlocks]);

  // Week strip around selected date
  const weekStripDates = useMemo(() => {
    const start = getWeekStart(selectedDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  // ── Location resolution wrappers (use config state) ──

  // ── Schedule config (bundled for pure functions) ──
  var schedCfg = useMemo(function() {
    return { timeBlocks: timeBlocks, locSchedules: locSchedules, locScheduleDefaults: locScheduleDefaults, locScheduleOverrides: locScheduleOverrides, hourLocationOverrides: hourLocationOverrides, toolMatrix: toolMatrix, splitDefault: splitDefault, splitMinDefault: splitMinDefault, schedFloor: schedFloor };
  }, [timeBlocks, locSchedules, locScheduleDefaults, locScheduleOverrides, hourLocationOverrides, toolMatrix, splitDefault, splitMinDefault, schedFloor]);

  // ── Unified schedule: ONE scheduler for all days ──
  var USER_TZ_SCHED = "America/New_York";
  var schedResultRef = React.useRef({ dayPlacements: {}, taskUpdates: {}, unplaced: [], deadlineMisses: [], placedCount: 0, newStatuses: {} });
  var schedResultKeyRef = React.useRef("");

  const getLocationForDate = useCallback(function(dateStr) {
    return getLocationForDatePure(dateStr, schedCfg);
  }, [schedCfg]);
  const getLocationForHour = useCallback(function(dateStr, hour) {
    return getLocationForHourPure(dateStr, hour, schedCfg);
  }, [schedCfg]);

  const isTaskBlocked = useCallback(function(task, dateStr) {
    return isTaskBlockedPure(task, dateStr, schedCfg);
  }, [schedCfg]);

  const allTasks = useMemo(() => extraTasks, [extraTasks]);

  // ── Unified schedule computation (must be after allTasks) ──
  var schedTriggerKey = useMemo(function() {
    return allTasks.length + "_" + allTasks.map(function(t) { return t.id + (t.date||"") + (t.time||"") + (t.dur||0) + (t.pri||"") + (t.when||"") + (t.due||"") + (t.startAfter||""); }).join(",")
      + "_" + Object.keys(statuses).map(function(k) { return k + ":" + statuses[k]; }).join(",");
  }, [allTasks, statuses]);

  useMemo(function() {
    var cacheKey = schedTriggerKey + "_" + JSON.stringify([splitDefault, splitMinDefault, schedFloor]);
    if (schedResultKeyRef.current === cacheKey) return;
    schedResultKeyRef.current = cacheKey;
    var now = new Date();
    var nowMins2, todayKey2;
    try {
      var tp = new Intl.DateTimeFormat('en-US', { timeZone: USER_TZ_SCHED, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
      var h2 = parseInt(tp.find(function(p) { return p.type === 'hour'; }).value); if (h2 === 24) h2 = 0;
      var m2 = parseInt(tp.find(function(p) { return p.type === 'minute'; }).value);
      nowMins2 = h2 * 60 + m2;
      var dp2 = new Intl.DateTimeFormat('en-US', { timeZone: USER_TZ_SCHED, month: 'numeric', day: 'numeric' }).formatToParts(now);
      todayKey2 = dp2.find(function(p) { return p.type === 'month'; }).value + "/" + dp2.find(function(p) { return p.type === 'day'; }).value;
    } catch(e) { nowMins2 = now.getHours() * 60 + now.getMinutes(); todayKey2 = formatDateKey(now); }
    try {
      schedResultRef.current = unifiedSchedule(allTasks, statuses, todayKey2, nowMins2, schedCfg);
    } catch(err) {
      console.error("[SCHED] unified scheduler error:", err);
      schedResultRef.current = { dayPlacements: {}, taskUpdates: {}, unplaced: [], deadlineMisses: [], placedCount: 0, newStatuses: statuses };
    }
  }, [schedTriggerKey, schedCfg, splitDefault, splitMinDefault, schedFloor]);

  // All known project names — merged from tasks + projects registry, sorted
  const allProjectNames = useMemo(() => {
    var names = {};
    allTasks.forEach(function(t) { if (t.project) names[t.project] = true; });
    projects.forEach(function(p) { if (p.name) names[p.name] = true; });
    return Object.keys(names).sort();
  }, [allTasks, projects]);

  // Project registry lookup by name — O(1) via Map
  const projectMetaMap = useMemo(function() {
    var m = {};
    projects.forEach(function(p) { if (p.name) m[p.name] = p; });
    return m;
  }, [projects]);
  var getProjectMeta = function(name) { return projectMetaMap[name] || null; };

  // Pre-compute task counts per project — avoids O(n*p) in settings render
  const projectTaskCounts = useMemo(function() {
    var counts = {};
    allTasks.forEach(function(t) {
      if (t.project) counts[t.project] = (counts[t.project] || 0) + 1;
    });
    return counts;
  }, [allTasks]);

  // Date range bounds
  const allDates = useMemo(() => {
    const dates = [];
    allTasks.forEach(t => {
      const d = parseDate(t.date);
      if (d) dates.push(d.getTime());
    });
    dates.sort((a,b) => a - b);
    return dates;
  }, [allTasks]);

  const minDayOffset = useMemo(() => {
    if (!allDates.length) return -30;
    return Math.round((allDates[0] - today.getTime()) / 86400000);
  }, [allDates, today]);

  const maxDayOffset = useMemo(() => {
    if (!allDates.length) return 60;
    return Math.round((allDates[allDates.length - 1] - today.getTime()) / 86400000);
  }, [allDates, today]);

  // Group tasks by date key
  const tasksByDate = useMemo(() => {
    const map = {};
    allTasks.forEach(t => {
      const key = t.date || "TBD";
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return map;
  }, [allTasks]);

  // Special sections
  const parkingLot = useMemo(() => allTasks.filter(t => t.section?.includes("PARKING")), [allTasks]);

  // Pre-compute dependents map: taskId → [tasks that depend on it]
  const dependentsMap = useMemo(() => {
    var map = {};
    allTasks.forEach(function(t) {
      var deps = getTaskDeps(t);
      deps.forEach(function(depId) {
        if (!map[depId]) map[depId] = [];
        map[depId].push(t);
      });
    });
    return map;
  }, [allTasks]);
  const toBeSched = useMemo(() => allTasks.filter(t => t.section?.includes("TO BE SCHEDULED")), [allTasks]);
  const scheduledTasks = useMemo(() => allTasks.filter(t => t.date && t.date !== "TBD"), [allTasks]);

  // Load
  useEffect(() => {
    (async () => {
      try {
        // Load from personal storage
        var r = null;
        try { r = await window.storage.get(STORAGE_KEY); } catch(e) {}
        if (r && r.value) {
          const d = JSON.parse(r.value);
          var loadedExtra = d.extraTasks && d.extraTasks.length > 0 ? d.extraTasks : [];
          var loadedStatuses = d.statuses || {};
          var loadedDirections = d.directions || {};

          // Migration: pri "Habit" → habit: true + real priority
          // Migration: "Home" project tasks with empty location → home
          loadedExtra = loadedExtra.map(function(t) {
            var changed = {};
            if (t.pri === "Habit") {
              changed.habit = true;
              changed.pri = "P3";
            }
            if (t.project === "Home" && !hasWhen(t.when, "fixed") && (!t.location || (Array.isArray(t.location) && t.location.length === 0))) {
              changed.location = ["home"];
            }
            // Fix: fixed+errand tasks (flights, travel) should NOT be constrained to home
            if (hasWhen(t.when, "fixed") && t.where === "errand" && Array.isArray(t.location) && t.location.length > 0 && t.location.indexOf("home") !== -1) {
              changed.location = [];
            }
            return Object.keys(changed).length > 0 ? Object.assign({}, t, changed) : t;
          });

          // ── One-time migration: fix dependency chain date violations ──
          if (!d._patch724) {
            var dateFixes = {
              t136: { date: "3/25", day: "Wed" },   // confirm dinner AFTER booking
              t84:  { date: "3/24", day: "Tue" },   // packing list after gifts arrive
              t134: { date: "3/22", day: "Sun" },   // wrap gifts after ordering+shipping
              t137: { date: "3/28", day: "Sat" },   // actual birthday date
              t86:  { date: "3/26", day: "Thu" },   // pack day before trip
              t85:  { date: "3/25", day: "Tue" },   // confirm flights closer to departure
              t154: { day: "Mon" },                  // 3/30 is Monday not Sunday
            };
            var statusFixes = { t01: "done", t127: "done" }; // completed travel tasks
            loadedExtra = loadedExtra.map(function(t) {
              if (dateFixes[t.id]) return Object.assign({}, t, dateFixes[t.id]);
              return t;
            });
            Object.keys(statusFixes).forEach(function(id) {
              loadedStatuses[id] = statusFixes[id];
            });
            d._patch724 = true; // flag to prevent re-running
            d.splitDefault = false; // don't split tasks by default
          }

          dispatch({ type: 'INIT', statuses: loadedStatuses, directions: loadedDirections, tasks: loadedExtra });

          var loadedTimeBlocks = timeBlocks;
          if (d.timeBlocks) {
            if (Array.isArray(d.timeBlocks)) {
              var migrated = {};
              DAY_NAMES.forEach(function(dn) { migrated[dn] = d.timeBlocks.slice(); });
              loadedTimeBlocks = migrated;
            } else {
              loadedTimeBlocks = d.timeBlocks;
            }
            // ── Migration: backfill block.loc from weeklySchedule if missing ──
            var migrateWeekly = d.weeklySchedule || weeklySchedule;
            var needsMigrate = false;
            DAY_NAMES.forEach(function(dn) {
              var blocks = loadedTimeBlocks[dn];
              if (!blocks) return;
              blocks.forEach(function(b) {
                if (!b.loc) {
                  needsMigrate = true;
                  if (b.tag === "biz" || b.tag === "lunch") {
                    b.loc = migrateWeekly[dn] || "home";
                  } else {
                    b.loc = "home";
                  }
                }
              });
            });
            if (needsMigrate) console.log("[Migration] Backfilled block.loc from weeklySchedule");
            setTimeBlocks(loadedTimeBlocks);
          }
          var loadedLocs = d.locations || locations;
          var loadedTools = d.tools || tools;
          var loadedMatrix = d.toolMatrix || toolMatrix;
          var loadedHourOv = d.hourLocationOverrides || hourLocationOverrides;
          var loadedZoom = d.gridZoom || gridZoom;
          if (d.locations) setLocations(loadedLocs);
          if (d.tools) setTools(loadedTools);
          if (d.toolMatrix) setToolMatrix(loadedMatrix);
          if (d.hourLocationOverrides) setHourLocationOverrides(loadedHourOv);
          // ── Load or migrate schedule templates ──
          if (d.locSchedules) {
            // New format — load directly
            setLocSchedules(d.locSchedules);
            if (d.locScheduleDefaults) setLocScheduleDefaults(d.locScheduleDefaults);
            if (d.locScheduleOverrides) setLocScheduleOverrides(d.locScheduleOverrides);
            console.log("[Load] Loaded locSchedules (" + Object.keys(d.locSchedules).length + " templates)");
          } else if (d.weeklyHourLocs) {
            // Migrate from old weeklyHourLocs → schedule templates
            var loaded = d.weeklyHourLocs;
            // Normalize hour-keyed to minute-keyed
            var firstDay = loaded[Object.keys(loaded)[0]] || {};
            var keys = Object.keys(firstDay).map(Number).filter(function(n) { return !isNaN(n); });
            if (keys.length > 0 && Math.max.apply(null, keys) < 60) {
              var converted = {};
              DAY_NAMES.forEach(function(dn) {
                converted[dn] = {};
                var dayData = loaded[dn] || {};
                Object.keys(dayData).forEach(function(hKey) {
                  var h = parseInt(hKey);
                  for (var q = 0; q < 4; q++) converted[dn][h * 60 + q * 15] = dayData[hKey];
                });
              });
              loaded = converted;
            }
            // Build weekday template from Mon, weekend from Sat
            var migratedScheds = {
              weekday: { name: "Weekday", icon: "\u{1F3E2}", system: true, hours: loaded["Mon"] || {} },
              weekend: { name: "Weekend", icon: "\u{1F3E0}", system: true, hours: loaded["Sat"] || {} },
            };
            // Check if any weekday differs from Mon — create extra templates
            ["Tue","Wed","Thu","Fri"].forEach(function(dn) {
              var dayH = loaded[dn] || {};
              var monH = loaded["Mon"] || {};
              var same = JSON.stringify(dayH) === JSON.stringify(monH);
              if (!same) {
                var id = dn.toLowerCase();
                migratedScheds[id] = { name: dn, icon: "\u{1F4C5}", system: false, hours: dayH };
              }
            });
            if (loaded["Sun"] && JSON.stringify(loaded["Sun"]) !== JSON.stringify(loaded["Sat"])) {
              migratedScheds["sunday"] = { name: "Sunday", icon: "\u{1F3E0}", system: false, hours: loaded["Sun"] };
            }
            setLocSchedules(migratedScheds);
            // Build defaults
            var migratedDefaults = { Mon: "weekday", Sat: "weekend", Sun: migratedScheds["sunday"] ? "sunday" : "weekend" };
            ["Tue","Wed","Thu","Fri"].forEach(function(dn) { migratedDefaults[dn] = migratedScheds[dn.toLowerCase()] ? dn.toLowerCase() : "weekday"; });
            setLocScheduleDefaults(migratedDefaults);
            // Migrate locationOverrides → locScheduleOverrides (create templates for travel days)
            if (d.locationOverrides) {
              var migratedOvs = {};
              Object.keys(d.locationOverrides).forEach(function(dk) {
                var ov = d.locationOverrides[dk];
                var ovId = "ov_" + dk.replace(/\//g, "_");
                // Create a template with all hours set to the override location
                var ovHours = {};
                for (var m = 360; m < 1380; m += 15) ovHours[m] = ov.id || "home";
                migratedScheds[ovId] = { name: ov.name || ov.id, icon: ov.icon || "\u{1F4CD}", system: false, hours: ovHours };
                migratedOvs[dk] = ovId;
              });
              setLocSchedules(Object.assign({}, migratedScheds));
              setLocScheduleOverrides(migratedOvs);
            }
            console.log("[Migration] Converted weeklyHourLocs to locSchedules (" + Object.keys(migratedScheds).length + " templates)");
          } else {
            // Very old format — build from timeBlocks
            var tbScheds = { weekday: { name: "Weekday", icon: "\u{1F3E2}", system: true, hours: {} }, weekend: { name: "Weekend", icon: "\u{1F3E0}", system: true, hours: {} } };
            (loadedTimeBlocks["Mon"] || DEFAULT_WEEKDAY_BLOCKS).forEach(function(b) { for (var m = b.start; m < b.end; m += 15) tbScheds.weekday.hours[m] = b.loc || "home"; });
            (loadedTimeBlocks["Sat"] || DEFAULT_WEEKEND_BLOCKS).forEach(function(b) { for (var m = b.start; m < b.end; m += 15) tbScheds.weekend.hours[m] = b.loc || "home"; });
            setLocSchedules(tbScheds);
            console.log("[Migration] Built locSchedules from timeBlocks");
          }
          if (d.gridZoom) setGridZoom(loadedZoom);
          if (d.splitDefault !== undefined) setSplitDefault(d.splitDefault);
          if (d.splitMinDefault !== undefined) setSplitMinDefault(d.splitMinDefault);
          // Load projects registry, auto-seed from task data if empty
          var loadedProjects = d.projects || [];
          if (loadedProjects.length === 0 && loadedExtra.length > 0) {
            var projNames = {};
            loadedExtra.forEach(function(t) { if (t.project) projNames[t.project] = true; });
            var defaultColors = ["#DC2626","#D97706","#2563EB","#059669","#7C3AED","#DB2777","#0891B2","#65A30D","#C2410C","#4338CA"];
            var ci = 0;
            loadedProjects = Object.keys(projNames).sort().map(function(name) {
              return { id: "proj_" + name.toLowerCase().replace(/[^a-z0-9]/g, "_").substring(0, 20), name: name, color: defaultColors[ci++ % defaultColors.length], icon: "" };
            });
          }
          setProjects(loadedProjects);
          if (d.schedFloor !== undefined) setSchedFloor(d.schedFloor);

          console.log("Loaded:", loadedExtra.length, "tasks from storage");
        } else {
          // No stored data — start empty (user can import or create tasks)
          console.log("First run: no stored data found. Use Import or create tasks.");
        }
      } catch (e) { console.error("Load error:", e); }
      setLoading(false);
    })();
  }, []);

  // Helper: update fields on a task in extraTasks
  const updateTaskFields = useCallback((id, fields) => {
    dispatch({ type: 'UPDATE_TASK', id: id, fields: fields });
  }, []);

  const persistAll = useCallback(async (s, d, ex) => {
    var tasksToSave = ex || extraTasks;
    if (tasksToSave.length === 0) { console.warn("persistAll: refusing to save empty task list"); return; }
    setSaving(true);
    try {
      var payload = JSON.stringify({
        v7: true, statuses: s, directions: d, extraTasks: tasksToSave,
        locations: locations, tools: tools, toolMatrix: toolMatrix,
        locSchedules: locSchedules, locScheduleDefaults: locScheduleDefaults, locScheduleOverrides: locScheduleOverrides,
        hourLocationOverrides: hourLocationOverrides, gridZoom: gridZoom, splitDefault: splitDefault, splitMinDefault: splitMinDefault,
        timeBlocks: timeBlocks, projects: projects, schedFloor: schedFloor,
        _patch724: true, updated: new Date().toISOString()
      });
      await window.storage.set(STORAGE_KEY, payload);
    } catch (e) {}
    setSaving(false);
  }, [extraTasks, locations, tools, toolMatrix, locSchedules, locScheduleDefaults, locScheduleOverrides, hourLocationOverrides, gridZoom, splitDefault, splitMinDefault, timeBlocks, projects, schedFloor]);

  // Undo system — snapshots latest state via taskStateRef

  const pushUndo = useCallback((label) => {
    var s = taskStateRef.current;
    undoStackRef.current = undoStackRef.current.concat([{
      label: label || "action",
      extraTasks: JSON.parse(JSON.stringify(s.tasks)),
      statuses: Object.assign({}, s.statuses),
      directions: Object.assign({}, s.directions),
    }]);
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current = undoStackRef.current.slice(-MAX_UNDO);
  }, []);

  const popUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) { showToast("Nothing to undo", "info"); return; }
    var snap = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    dispatch({ type: 'RESTORE', statuses: snap.statuses, directions: snap.directions, extraTasks: snap.extraTasks });
    persistAll(snap.statuses, snap.directions, snap.extraTasks);
    showToast("↩ Undid: " + snap.label, "success");
  }, [persistAll]);

  // ── dispatchPersist: dispatch + persist in one call (uses reducer preview) ──
  var dispatchPersist = useCallback(function(action, undoLabel) {
    if (undoLabel) pushUndo(undoLabel);
    dispatch(action);
    var ns = taskReducer(taskStateRef.current, action);
    persistAll(ns.statuses, ns.directions, ns.tasks);
  }, [pushUndo, persistAll]);

  // Auto-persist when settings change (debounced to prevent rapid re-renders)
  var persistTimerRef = React.useRef(null);
  useEffect(() => {
    if (!loading && extraTasks.length > 0) {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(function() {
        persistAll(statuses, directions, extraTasks);
      }, 300);
    }
    return function() { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [timeBlocks, projects, schedFloor]);

  // ── Dark mode — separate storage to avoid callback cascades ──
  useEffect(() => {
    (async () => { try {
      var r = await window.storage.get("task-tracker-darkMode");
      if (r && r.value === "true") setDarkMode(true);
    } catch(e) {} })();
  }, []);
  useEffect(() => {
    (async () => { try {
      await window.storage.set("task-tracker-darkMode", darkMode ? "true" : "false");
    } catch(e) {} })();
  }, [darkMode]);

  // ── Keyboard shortcuts (refs avoid dep-triggered re-renders) ──
  var kbStateRef = React.useRef({});
  var popUndoRef = React.useRef(popUndo);
  popUndoRef.current = popUndo;
  kbStateRef.current = { selectedDate: selectedDate, tasksByDate: tasksByDate, expandedTask: expandedTask, allTasks: allTasks, statuses: statuses };
  useEffect(function() {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); popUndoRef.current(); return; }
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setDayOffset(function(d) { return d - (e.shiftKey ? 7 : 1); }); }
      if (e.key === "ArrowRight") { e.preventDefault(); setDayOffset(function(d) { return d + (e.shiftKey ? 7 : 1); }); }
      if (e.key === "Escape") { setExpandedTask(null); }
      var st = kbStateRef.current;
      if (e.key === "j" || e.key === "k") {
        var dk = formatDateKey(st.selectedDate);
        var dayT = (st.tasksByDate[dk] || []).filter(filterTask);
        if (dayT.length === 0) return;
        var curIdx = st.expandedTask ? dayT.findIndex(function(t) { return t.id === st.expandedTask; }) : -1;
        var nextIdx;
        if (e.key === "j") nextIdx = curIdx < dayT.length - 1 ? curIdx + 1 : 0;
        else nextIdx = curIdx > 0 ? curIdx - 1 : dayT.length - 1;
        setExpandedTask(dayT[nextIdx].id);
      }
      if (e.key === "s" && st.expandedTask) {
        var cycle = ["", "wip", "done"];
        var ct = st.allTasks.find(function(t) { return t.id === st.expandedTask; });
        if (ct) {
          var curSt = ct.status || (st.statuses[ct.id] || "");
          var ci = cycle.indexOf(curSt);
          changeStatus(st.expandedTask, cycle[(ci + 1) % cycle.length]);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return function() { window.removeEventListener("keydown", handleKeyDown); };
  }, []);

  const changeStatus = useCallback((id, val) => {
    // Compute taskFields for timeRemaining management
    var taskFields = null;
    if (val === "wip") {
      var task = extraTasks.find(function(t) { return t.id === id; });
      if (task && task.timeRemaining == null) taskFields = { timeRemaining: task.dur || 30 };
    } else if (val === "done") {
      taskFields = { timeRemaining: 0 };
    }
    var action = { type: 'SET_STATUS', id: id, val: val, deleteDirection: val !== "other", taskFields: taskFields };
    dispatchPersist(action, "status → " + val);
    // Auto-reschedule after state settles
    setTimeout(function() { try { if (autoRescheduleRef.current) autoRescheduleRef.current(); } catch(e) { console.error("Auto-reschedule error:", e); } }, 100);
  }, [extraTasks, dispatchPersist]);

  // ── Quick-add a blank task to a date ──
  var quickAddTask = function(dateStr) {
    var d = parseDate(dateStr);
    var dayName = d ? DAY_NAMES[d.getDay()] : "";
    var newId = "qa_" + String(Date.now()).slice(-5);
    var newTask = {
      id: newId, date: dateStr, day: dayName, text: "New task",
      project: "General", pri: "P3", time: "", dur: 30,
      where: "anywhere", when: "anytime", dayReq: "any",
      section: "", notes: "", due: "", dependsOn: [],
    };
    dispatch({ type: 'ADD_TASKS', tasks: [newTask] });
    setExpandedTask(newId);
  };

  // ── Batch set status for tasks matching a filter on a date ──
  var batchSetStatus = function(dateStr, filterFn, newStatus) {
    var newSt = Object.assign({}, statuses);
    allTasks.forEach(function(t) {
      if (t.date !== dateStr) return;
      if (!filterFn(t)) return;
      newSt[t.id] = newStatus;
    });
    dispatchPersist({ type: 'SET_ALL', statuses: newSt }, "batch " + newStatus);
  };

  // ── Generate habit instances from templates ──
  // ── Generate recurring task instances (unified — handles habits + any recurring task) ──
  var generateRecurring = function(startDate, endDate) {
    var newTasks = generateRecurringPure(allTasks, startDate, endDate);
    if (newTasks.length > 0) {
      dispatch({ type: 'ADD_TASKS', tasks: newTasks });
    }
    return newTasks.length;
  };

  const changeDirection = useCallback((id, val) => {
    dispatch({ type: 'SET_DIRECTION', id: id, val: val });
    var ns = taskReducer(taskStateRef.current, { type: 'SET_DIRECTION', id: id, val: val });
    persistAll(ns.statuses, ns.directions);
  }, [persistAll]);

  // ── Auto Reschedule ──
  // Mirrors the scheduler: habits first → fixed → tasks by priority into gaps
  // Uses minute-level occupancy. Picks up WIP tasks with timeRemaining.
  // Splits tasks across gaps if they won't fit contiguously.
  const autoReschedule = useCallback(() => {
   try {
    var now = new Date();
    console.log("RESCHEDULE FIRED", now.toString());
    pushUndo("reschedule");
    
    // Compute local time
    var USER_TZ = "America/New_York";
    var nowMins, effectiveTodayKey;
    try {
      var timeParts = new Intl.DateTimeFormat('en-US', { timeZone: USER_TZ, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
      var localHour = parseInt(timeParts.find(function(p) { return p.type === 'hour'; }).value);
      var localMin = parseInt(timeParts.find(function(p) { return p.type === 'minute'; }).value);
      if (localHour === 24) localHour = 0;
      nowMins = localHour * 60 + localMin;
      var dateParts = new Intl.DateTimeFormat('en-US', { timeZone: USER_TZ, month: 'numeric', day: 'numeric' }).formatToParts(now);
      effectiveTodayKey = dateParts.find(function(p) { return p.type === 'month'; }).value + "/" + dateParts.find(function(p) { return p.type === 'day'; }).value;
    } catch(tzErr) {
      nowMins = now.getHours() * 60 + now.getMinutes();
      effectiveTodayKey = formatDateKey(now);
    }

    var result = unifiedSchedule(allTasks, statuses, effectiveTodayKey, nowMins, schedCfg);
    // Update the cached schedule result
    schedResultRef.current = result;
    schedResultKeyRef.current = ""; // invalidate cache key to force refresh

    // Apply results via single dispatch
    var newEx = extraTasks.map(function(t) { return result.taskUpdates[t.id] ? Object.assign({}, t, result.taskUpdates[t.id]) : t; });
    dispatch({ type: 'SET_ALL', statuses: result.newStatuses, tasks: newEx });
    persistAll(result.newStatuses, directions, newEx);

    var parts = [];
    parts.push(result.placedCount + " tasks rescheduled");
    if (result.deadlineMisses.length > 0) parts.push(result.deadlineMisses.length + " can't meet deadline");
    if (result.unplaced.length > result.deadlineMisses.length) parts.push((result.unplaced.length - result.deadlineMisses.length) + " could not be placed");
    var severity = result.deadlineMisses.length > 0 ? "error" : (result.unplaced.length > 0 ? "info" : "success");
    showToast("\u{1F504} " + parts.join(" \u00B7 ") + (result.deadlineMisses.length > 0 ? " \u{1F6A8}" : result.unplaced.length > 0 ? " \u26A0" : ""), severity);
   } catch(err) {
    showToast("Reschedule error: " + err.message, "error");
   }
  }, [allTasks, statuses, directions, extraTasks, persistAll, pushUndo, schedCfg]);
  autoRescheduleRef.current = autoReschedule;

  // ── Re-run scheduler when settings change (skip initial mount) ──
  const settingsMountedRef = React.useRef(false);
  useEffect(function() {
    if (!settingsMountedRef.current) { settingsMountedRef.current = true; return; }
    var timer = setTimeout(function() {
      try { if (autoRescheduleRef.current) autoRescheduleRef.current(); } catch(e) { console.error("Settings reschedule error:", e); }
    }, 150);
    return function() { clearTimeout(timer); };
  }, [schedCfg]);

  // ── Copy Schedule (compact debug dump for sharing) ──
  const copySchedule = useCallback(function() {
    var res = schedResultRef.current;
    if (!res || !res.dayPlacements) { showToast("No schedule data", "error"); return; }
    var lines = [];
    var dayKeys = Object.keys(res.dayPlacements).sort(function(a, b) {
      var da = parseDate(a), db = parseDate(b);
      return (da || 0) - (db || 0);
    });
    // Only show days with placements, up to 14 days
    var shown = 0;
    dayKeys.forEach(function(dk) {
      var items = res.dayPlacements[dk];
      if (!items || items.length === 0) return;
      if (shown >= 14) return;
      shown++;
      var d = parseDate(dk);
      var dow = d ? ["Su","Mo","Tu","We","Th","Fr","Sa"][d.getDay()] : "??";
      lines.push("── " + dk + " " + dow + " ──");
      // Sort by start time
      var sorted = items.slice().sort(function(a, b) { return a.start - b.start; });
      sorted.forEach(function(item) {
        var t = item.task;
        var h = Math.floor(item.start / 60), m = item.start % 60;
        var ap = h >= 12 ? "p" : "a";
        var d12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        var timeStr = d12 + ":" + (m < 10 ? "0" : "") + m + ap;
        var flags = [];
        if (t.habit) flags.push("H");
        if (t.pri) flags.push(t.pri);
        if (item.locked) flags.push("fixed");
        if (item.overflow) flags.push("OVERFLOW");
        if (item.splitPart) flags.push("pt" + item.splitPart + "/" + item.splitTotal);
        if (t.due) flags.push("due:" + t.due);
        if (t.when && t.when !== "anytime") flags.push("w:" + t.when);
        var st = statuses[t.id] || "";
        if (st) flags.push(st);
        lines.push(timeStr + " " + item.dur + "m " + t.id + " " + t.text.substring(0, 40) + (flags.length ? " [" + flags.join(",") + "]" : ""));
      });
    });
    if (res.unplaced && res.unplaced.length > 0) {
      lines.push("── UNPLACED ──");
      res.unplaced.forEach(function(t) {
        lines.push(t.id + " " + t.text.substring(0, 40) + " " + (t.pri || "") + (t.due ? " due:" + t.due : ""));
      });
    }
    var text = lines.join("\n");
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("📋 Schedule copied (" + shown + " days, " + lines.length + " lines)", "success");
    } catch(e) {
      console.log(text);
      showToast("Copy failed — schedule logged to console", "info");
    }
  }, [statuses, showToast]);

  // ── AI Command Handler ──
  const handleAiCmd = useCallback(async (directCmd) => {
    var cmdText = directCmd || aiCmd;
    if (!cmdText.trim() || aiLoading) return;
    const userMsg = cmdText.trim();

    // ── Local location commands (no API needed) ──
    var locWord = null, dayWord = null, dateStr = null;
    // Pattern 1: "wfh [day]" → home
    var wfhMatch = userMsg.match(/^wfh(?:\s+(?:on\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2})))?$/i);
    if (wfhMatch) { locWord = "home"; dayWord = (wfhMatch[1] || "").toLowerCase(); dateStr = wfhMatch[2] || ""; if (!dayWord && !dateStr) dayWord = "weekdays"; }
    // Pattern 2: "in office [day]" → work
    if (!locWord) {
      var offMatch = userMsg.match(/^(?:in |at )?office(?:\s+(?:on\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2})))?$/i);
      if (offMatch) { locWord = "work"; dayWord = (offMatch[1] || "").toLowerCase(); dateStr = offMatch[2] || ""; if (!dayWord && !dateStr) dayWord = "weekdays"; }
    }
    // Pattern 3: "I'm [at] home/work on [day/date]"
    if (!locWord) {
      var locMatch = userMsg.match(/(?:i(?:'m| am| will be|'ll be) (?:going to be )?(?:at )?)(?:the )?(home|work|office|downtown|gym|transit|commute|commuting|errand)(?:\s+(?:on\s+|all\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2})))?/i);
      if (locMatch) { locWord = (locMatch[1] || "").toLowerCase(); dayWord = (locMatch[2] || "").toLowerCase(); dateStr = locMatch[3] || ""; }
    }
    // Pattern 4: "at home/work [on] [day/date]"
    if (!locWord) {
      var atMatch = userMsg.match(/^at\s+(home|work|office|downtown|gym)\s+(?:on\s+)?(?:(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays?|all week)|([\d]{1,2}\/[\d]{1,2}))/i);
      if (atMatch) { locWord = (atMatch[1] || "").toLowerCase(); dayWord = (atMatch[2] || "").toLowerCase(); dateStr = atMatch[3] || ""; }
    }
    if (locWord) {
      // Map words to location IDs
      var locId = locWord === "office" ? "work" : locWord === "commute" || locWord === "commuting" ? "transit" : locWord;
      if (!locations.find(function(l) { return l.id === locId; })) locId = "home";
      var locObj = locations.find(function(l) { return l.id === locId; });
      var locName = locObj ? locObj.name : locId;
      var locIcon = locObj ? locObj.icon : "";

      if (dateStr) {
        // Specific date → create/reuse an all-day template + set override
        var ovId = "ov_" + locId + "_" + dateStr.replace(/\//g, "_");
        var ovHours = {};
        for (var mm = 360; mm < 1380; mm += 15) ovHours[mm] = locId;
        setLocSchedules(function(prev) { var next = Object.assign({}, prev); next[ovId] = { name: locName + " (" + dateStr + ")", icon: locIcon, system: false, hours: ovHours }; return next; });
        setLocScheduleOverrides(function(prev) { var next = Object.assign({}, prev); next[dateStr] = ovId; return next; });
        setAiCmd("");
        setAiLog(function(prev) { return prev.concat([{ role: "user", text: userMsg }, { role: "ai", text: "Set " + dateStr + " location to " + locIcon + " " + locName }]); });
        showToast(dateStr + " \u2192 " + locIcon + " " + locName, "success");
        return;
      }
      if (dayWord) {
        // Day of week or "weekdays"/"all week" → update the default template for those days
        var dayMap = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
        var targetDays = [];
        if (dayWord === "weekdays" || dayWord === "weekday" || dayWord === "all week") targetDays = ["Mon","Tue","Wed","Thu","Fri"];
        else if (dayMap[dayWord]) targetDays = [dayMap[dayWord]];
        if (targetDays.length > 0) {
          // Update the templates assigned to those days
          targetDays.forEach(function(dn) {
            var tmplId = locScheduleDefaults[dn] || "weekday";
            setLocSchedules(function(prev) {
              var next = JSON.parse(JSON.stringify(prev));
              if (!next[tmplId]) next[tmplId] = { name: tmplId, icon: "\u{1F4C5}", system: false, hours: {} };
              for (var mm = 360; mm < 1380; mm += 15) next[tmplId].hours[mm] = locId;
              return next;
            });
          });
          setAiCmd("");
          var label = targetDays.length > 1 ? targetDays.join(",") : targetDays[0];
          setAiLog(function(prev) { return prev.concat([{ role: "user", text: userMsg }, { role: "ai", text: "Set " + label + " all blocks to " + locIcon + " " + locName }]); });
          showToast(label + " \u2192 " + locIcon + " " + locName, "success");
          return;
        }
      }
      // No day/date specified — default to "all week" for the location
      if (!dayWord && !dateStr) {
        setLocSchedules(function(prev) {
          var next = JSON.parse(JSON.stringify(prev));
          Object.keys(next).forEach(function(k) {
            for (var mm = 360; mm < 1380; mm += 15) next[k].hours[mm] = locId;
          });
          return next;
        });
        setAiCmd("");
        setAiLog(function(prev) { return prev.concat([{ role: "user", text: userMsg }, { role: "ai", text: "Set all days to " + locIcon + " " + locName }]); });
        showToast("All days \u2192 " + locIcon + " " + locName, "success");
        return;
      }
    }

    setAiCmd("");
    setAiLoading(true);
    setShowAi(true); // auto-show AI panel
    setAiLog(prev => [...prev, { role: "user", text: userMsg }]);
    const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    // Only send open/wip tasks + tasks mentioned by ID in user message to reduce token count
    const mentionedIds = (userMsg.match(/[td]h?\d{1,4}|ai\d{3}/gi) || []).map(s => s.toLowerCase());
    const relevantTasks = allTasks.filter(t => {
      var st = statuses[t.id] || "";
      if (mentionedIds.some(mid => t.id.toLowerCase() === mid)) return true;
      if (st === "done" || st === "cancel" || st === "skip") return false;
      return true;
    });
    const taskLines = relevantTasks.map(t => {
      var st = statuses[t.id] || "open";
      var deps = getTaskDeps(t);
      return t.id + "|" + (t.date||"TBD") + "|" + (t.time||"") + "|" + st + "|" + t.project + "|" + t.text + "|" + (t.where||"") + "|" + (t.when||"") + "|" + (t.pri||"") + (t.habit ? "|habit" : "") + "|" + (t.dur||30) + "m" + (t.due ? "|due:" + t.due : "") + (t.startAfter ? "|start:" + t.startAfter : "") + (deps.length ? "|deps:" + deps.join(",") : "");
    }).join("\n");
    // Build dynamic location schedule from overrides
    var schedTemplateStr = "Schedule templates: " + Object.keys(locSchedules).map(function(k) { var t = locSchedules[k]; return k + " (" + t.name + ")" + (t.system ? " [system]" : ""); }).join(", ");
    schedTemplateStr += ". Day defaults: " + DAY_NAMES.map(function(d) { return d + "=" + (locScheduleDefaults[d] || "weekday"); }).join(", ");
    var ovKeys = Object.keys(locScheduleOverrides);
    if (ovKeys.length > 0) schedTemplateStr += ". Overrides: " + ovKeys.map(function(dk) { return dk + "=" + locScheduleOverrides[dk]; }).join(", ");
    const sysPrompt = "You are an AI assistant embedded in a task tracker. Today is " + todayStr + ". Respond with ONLY valid JSON (no markdown).\n\nOpen tasks (id|date|time|status|project|text|where|when|pri|dur|due|start|deps):\n" + taskLines + "\n\nLocation: " + schedTemplateStr + "\n\nCurrent config:\n- Locations: " + locations.map(function(l){return l.id+"("+l.name+")"}).join(", ") + "\n- Tools: " + tools.map(function(t){return t.id+"("+t.name+")"}).join(", ") + "\n- Time blocks (per day): " + DAY_NAMES.map(function(dn){ var bl=timeBlocks[dn]||[]; return dn+": "+bl.map(function(b){return b.tag+"@"+(b.loc||"home")+"("+Math.floor(b.start/60)+"-"+Math.floor(b.end/60)+")"}).join(","); }).join("; ") + "\n\nJSON format: {\"ops\":[...],\"msg\":\"summary\"}\nTask ops:\n- {\"op\":\"status\",\"id\":\"ID\",\"value\":\"done|cancel|wip|open|\"}\n- {\"op\":\"edit\",\"id\":\"ID\",\"fields\":{\"date\":\"M/D\",\"time\":\"H:MM AM/PM\",\"dur\":60,\"due\":\"M/D\",\"startAfter\":\"M/D\",\"when\":\"morning,biz\",\"pri\":\"P1\",\"habit\":true,\"dependsOn\":[\"t01\",\"t02\"]}}\n- {\"op\":\"add\",\"task\":{\"id\":\"ai001\",\"date\":\"M/D\",\"day\":\"Mon\",\"text\":\"desc\",\"time\":\"H:MM AM/PM\",\"project\":\"X\",\"pri\":\"P2\",\"where\":\"anywhere\",\"when\":\"anytime\",\"dayReq\":\"any\",\"section\":\"\",\"notes\":\"\",\"dur\":30,\"due\":\"\",\"startAfter\":\"\",\"habit\":false,\"dependsOn\":[]}}\n- {\"op\":\"delete\",\"id\":\"ID\"}\nConfig ops:\n- {\"op\":\"set_weekly\",\"day\":\"Mon\",\"location\":\"work\"} (sets biz+lunch blocks)\n- {\"op\":\"set_block_loc\",\"day\":\"Mon\",\"blockTag\":\"morning\",\"location\":\"home\"} (set one block)\n- {\"op\":\"add_location\",\"id\":\"gym\",\"name\":\"Gym\",\"icon\":\"🏋️\"}\n- {\"op\":\"add_tool\",\"id\":\"tablet\",\"name\":\"Tablet\",\"icon\":\"📱\"}\n- {\"op\":\"set_tool_matrix\",\"location\":\"home\",\"tools\":[\"phone\",\"personal_pc\"]}\n- {\"op\":\"set_blocks\",\"day\":\"Mon\",\"blocks\":[{\"id\":\"b1\",\"tag\":\"morning\",\"name\":\"Morning\",\"start\":360,\"end\":480,\"color\":\"#F59E0B\",\"icon\":\"☀️\"}]}\n- {\"op\":\"clone_blocks\",\"from\":\"Mon\",\"to\":[\"Tue\",\"Wed\",\"Thu\",\"Fri\"]}\nDependencies: dependsOn is an array of task IDs that must be completed before this task can start. The scheduler enforces ordering on same-day tasks and shows warnings for cross-day deps.\nOnly include needed ops. dur is in minutes. Due dates are HARD deadlines. startAfter delays scheduling until that date. Keep msg short.";
    try {
      // Sanitize user input for safe JSON encoding
      var safeMsg = userMsg.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/—/g, "--").replace(/\u2013/g, "-").replace(/\u2026/g, "...");
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 8000, system: sysPrompt, messages: [{ role: "user", content: safeMsg }] })
      });
      const data = await resp.json();
      if (data.error) { throw new Error(data.error.message || "API error"); }
      const raw = (data.content || []).map(c => c.text || "").join("");
      if (!raw) { throw new Error("Empty response from API"); }
      var cleaned = raw.replace(/```json|```/g, "").trim();
      var result;
      try {
        result = JSON.parse(cleaned);
      } catch (pe) {
        // Try to extract JSON object from response text
        var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { result = JSON.parse(jsonMatch[0]); } catch(pe2) {}
        }
        if (!result) throw new Error("Bad JSON: " + cleaned.substring(0, 200));
      }
      pushUndo("AI command");
      var newSt = { ...statuses };
      var newEx = [...extraTasks];
      var taskEdits = {}; // collect edits by id
      var newLocs = null, newTools = null, newMatrix = null, newWeekly = null, newBlocks = null;
      (result.ops || []).forEach(function(op) {
        if (op.op === "status") { if (op.value === "") { delete newSt[op.id]; } else { newSt[op.id] = op.value; } }
        else if (op.op === "edit") {
          var editFields = Object.assign({}, op.fields);
          var srcTask = allTasks.find(function(tt) { return tt.id === op.id; });
          if (srcTask && hasWhen(srcTask.when, "fixed")) { delete editFields.date; delete editFields.day; delete editFields.time; }
          taskEdits[op.id] = Object.assign({}, taskEdits[op.id] || {}, editFields);
        }
        else if (op.op === "add" && op.task) { op.task.created = new Date().toISOString(); newEx.push(op.task); }
        else if (op.op === "delete") { newSt[op.id] = "cancel"; }
        // Config ops
        else if (op.op === "set_weekly" && op.day && op.location) {
          // Update the default template for this day's biz hours
          if (!newBlocks) newBlocks = JSON.parse(JSON.stringify(timeBlocks));
          // Also update block-level locations for biz/lunch blocks
          if (!newBlocks) newBlocks = JSON.parse(JSON.stringify(timeBlocks));
          (newBlocks[op.day] || []).forEach(function(b) {
            if (b.tag === "biz" || b.tag === "lunch") b.loc = op.location;
          });
        }
        else if (op.op === "set_block_loc" && op.day && op.blockTag && op.location) {
          if (!newBlocks) newBlocks = JSON.parse(JSON.stringify(timeBlocks));
          (newBlocks[op.day] || []).forEach(function(b) {
            if (b.tag === op.blockTag || b.id === op.blockId) b.loc = op.location;
          });
        }
        else if (op.op === "add_location" && op.id && op.name) {
          if (!newLocs) newLocs = locations.slice();
          if (!newLocs.some(function(l){return l.id === op.id})) {
            newLocs.push({ id: op.id, name: op.name, icon: op.icon || "\u{1F4CD}" });
          }
        }
        else if (op.op === "add_tool" && op.id && op.name) {
          if (!newTools) newTools = tools.slice();
          if (!newTools.some(function(t){return t.id === op.id})) {
            newTools.push({ id: op.id, name: op.name, icon: op.icon || "\u{1F527}" });
          }
        }
        else if (op.op === "set_tool_matrix" && op.location && op.tools) {
          if (!newMatrix) newMatrix = Object.assign({}, toolMatrix);
          newMatrix[op.location] = op.tools;
        }
        else if (op.op === "set_blocks" && op.day && op.blocks) {
          if (!newBlocks) newBlocks = Object.assign({}, timeBlocks);
          newBlocks[op.day] = op.blocks;
        }
        else if (op.op === "clone_blocks" && op.from && op.to) {
          if (!newBlocks) newBlocks = Object.assign({}, timeBlocks);
          var src = newBlocks[op.from] || timeBlocks[op.from] || [];
          op.to.forEach(function(d) { newBlocks[d] = cloneBlocks(src); });
        }
      });
      // Apply edits to tasks
      newEx = newEx.map(function(t) { return taskEdits[t.id] ? Object.assign({}, t, taskEdits[t.id]) : t; });
      dispatch({ type: 'SET_ALL', statuses: newSt, tasks: newEx });
      if (newLocs) setLocations(newLocs);
      if (newTools) setTools(newTools);
      if (newMatrix) setToolMatrix(newMatrix);
      if (newBlocks) setTimeBlocks(newBlocks);
      persistAll(newSt, directions, newEx);
      setAiLog(prev => [...prev, { role: "ai", text: result.msg || "Done.", ops: result.ops || [] }]);
    } catch (err) {
      setAiLog(prev => [...prev, { role: "ai", text: "Error: " + (err.message || "API call failed. Check console.") }]);
    }
    setAiLoading(false);
    // Auto-hide AI panel after 10 seconds
    if (aiAutoHideRef.current) clearTimeout(aiAutoHideRef.current);
    aiAutoHideRef.current = setTimeout(function() { setShowAi(false); }, 10000);
  }, [aiCmd, aiLoading, allTasks, statuses, extraTasks, directions, persistAll, pushUndo, locations, tools, toolMatrix, locSchedules, locScheduleDefaults, locScheduleOverrides, timeBlocks]);

  // Filter + search
  // Chain popup computation — builds ordered list of tasks in the dependency chain
  var chainData = useMemo(function() {
    if (!chainPopupId) return null;
    var MAX_CHAIN = 60; // safety cap
    var chainIds = {};
    chainIds[chainPopupId] = true;
    function addAnc(id, depth) {
      if (depth > 30 || Object.keys(chainIds).length > MAX_CHAIN) return;
      var tt = allTasks.find(function(x) { return x.id === id; });
      if (!tt || !tt.dependsOn) return;
      getTaskDeps(tt).forEach(function(pid) { if (!chainIds[pid]) { chainIds[pid] = true; addAnc(pid, depth + 1); } });
    }
    function addDesc(id, depth) {
      if (depth > 30 || Object.keys(chainIds).length > MAX_CHAIN) return;
      allTasks.forEach(function(tt) {
        if (tt.dependsOn && getTaskDeps(tt).indexOf(id) >= 0 && !chainIds[tt.id]) { chainIds[tt.id] = true; addDesc(tt.id, depth + 1); }
      });
    }
    addAnc(chainPopupId, 0);
    addDesc(chainPopupId, 0);
    // Collect tasks and topo-sort them
    var chainTasks = allTasks.filter(function(t) { return chainIds[t.id]; });
    var sorted = topoSortTasks(chainTasks);
    return { tasks: sorted, focusId: chainPopupId };
  }, [chainPopupId, allTasks]);

  // Sync chainOrder + chainDeps when popup opens
  useEffect(function() {
    if (chainData) {
      var ids = chainData.tasks.map(function(t) { return t.id; });
      setChainOrder(ids);
      // Build initial chainDeps: only in-chain deps
      var chainSet = {};
      ids.forEach(function(id) { chainSet[id] = true; });
      var deps = {};
      chainData.tasks.forEach(function(t) {
        var taskDeps = getTaskDeps(t);
        deps[t.id] = taskDeps.filter(function(d) { return chainSet[d]; });
      });
      setChainDeps(deps);
      setChainDirty(false);
      setChainAddDepFor(null);
    } else {
      setChainOrder(null);
      setChainDeps({});
      setChainDirty(false);
      setChainAddDepFor(null);
    }
  }, [chainData]);

  // Chain reorder helpers
  var chainReorder = useCallback(function(fromIdx, toIdx) {
    setChainOrder(function(prev) {
      if (!prev) return prev;
      var arr = prev.slice();
      var item = arr.splice(fromIdx, 1)[0];
      arr.splice(toIdx, 0, item);
      return arr;
    });
    setChainDirty(true);
  }, []);

  // Add a dependency within the chain (may pull in new tasks)
  var chainAddDep = useCallback(function(taskId, depId) {
    // If depId isn't in chainOrder yet, add it
    setChainOrder(function(prev) {
      if (!prev) return prev;
      if (prev.indexOf(depId) >= 0) return prev; // already in chain
      // Insert before taskId's position so it appears above
      var tIdx = prev.indexOf(taskId);
      var arr = prev.slice();
      arr.splice(tIdx >= 0 ? tIdx : 0, 0, depId);
      return arr;
    });
    // Initialize chainDeps for new task if needed
    setChainDeps(function(prev) {
      var next = Object.assign({}, prev);
      if (!next[depId]) {
        // New task entering chain — load its existing in-chain deps
        var dt = allTasks.find(function(x) { return x.id === depId; });
        next[depId] = dt ? getTaskDeps(dt).filter(function(d) { return (next[d] !== undefined) || (chainOrder && chainOrder.indexOf(d) >= 0); }) : [];
      }
      var cur = (next[taskId] || []).slice();
      if (cur.indexOf(depId) < 0) cur.push(depId);
      next[taskId] = cur;
      return next;
    });
    setChainDirty(true);
    setChainAddDepFor(null);
  }, [allTasks, chainOrder]);

  // Remove a dependency within the chain
  var chainRemoveDep = useCallback(function(taskId, depId) {
    setChainDeps(function(prev) {
      var cur = (prev[taskId] || []).slice();
      var idx = cur.indexOf(depId);
      if (idx >= 0) cur.splice(idx, 1);
      var next = Object.assign({}, prev);
      next[taskId] = cur;
      return next;
    });
    setChainDirty(true);
  }, []);

  var chainSave = useCallback(function() {
    if (!chainOrder || chainOrder.length === 0) return;
    var chainSet = {};
    chainOrder.forEach(function(id) { chainSet[id] = true; });
    // Apply chainDeps back to tasks
    setExtraTasks(function(prev) {
      return prev.map(function(t) {
        if (!chainSet[t.id]) return t;
        var inChainDeps = chainDeps[t.id] || [];
        // Preserve external deps (deps NOT in this chain)
        var oldDeps = getTaskDeps(t);
        var externalDeps = oldDeps.filter(function(d) { return !chainSet[d]; });
        var finalDeps = externalDeps.concat(inChainDeps);
        return Object.assign({}, t, { dependsOn: finalDeps.length > 0 ? finalDeps : undefined });
      });
    });
    setChainDirty(false);
  }, [chainOrder, chainDeps, setExtraTasks]);

  // Compute chain arrows after render
  useEffect(function() {
    if (!chainPopupId || !chainOrder || !chainBodyRef.current) {
      setChainArrows(function(prev) { return prev.length === 0 ? prev : []; }); // only update if non-empty
      return;
    }
    var raf = requestAnimationFrame(function() {
      var body = chainBodyRef.current;
      if (!body) return;
      var cards = body.querySelectorAll("[data-chain-id]");
      if (!cards.length) return;
      var bodyRect = body.getBoundingClientRect();
      var bodyScrollTop = body.scrollTop;
      var posMap = {}; // id → { top, bottom, midY }
      cards.forEach(function(el) {
        var id = el.getAttribute("data-chain-id");
        var r = el.getBoundingClientRect();
        posMap[id] = {
          top: r.top - bodyRect.top + bodyScrollTop,
          bottom: r.bottom - bodyRect.top + bodyScrollTop,
          midY: (r.top + r.bottom) / 2 - bodyRect.top + bodyScrollTop,
          height: r.height
        };
      });
      var arrows = [];
      var ARROW_COLORS = ["#3B82F6", "#7C3AED", "#059669", "#DC2626", "#D97706", "#DB2777", "#0891B2"];
      var colorIdx = 0;
      chainOrder.forEach(function(taskId, idx) {
        var deps = (chainDeps[taskId] || []).filter(function(d) { return chainOrder.indexOf(d) >= 0; });
        deps.forEach(function(depId) {
          var fromPos = posMap[taskId];
          var depIdx = chainOrder.indexOf(depId);
          var toPos = posMap[depId];
          if (!fromPos || !toPos) return;
          // Skip adjacent (idx - depIdx === 1) — the simple connector already shows this
          var distance = Math.abs(idx - depIdx);
          if (distance <= 1) return;
          arrows.push({
            fromY: fromPos.top + 18,
            toY: toPos.bottom - 10,
            fromIdx: idx,
            toIdx: depIdx,
            distance: distance,
            color: ARROW_COLORS[colorIdx++ % ARROW_COLORS.length]
          });
        });
      });
      setChainArrows(arrows);
    });
    return function() { cancelAnimationFrame(raf); };
  }, [chainPopupId, chainOrder, chainDeps]);

  // Auto-scroll expanded panel into view when task is selected
  useLayoutEffect(function() {
    if (!expandedTask || viewMode !== "day") return;
    var raf = requestAnimationFrame(function() {
      if (expandedPanelRef.current) {
        expandedPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    return function() { cancelAnimationFrame(raf); };
  }, [expandedTask, viewMode]);

  const filterTask = useCallback((t) => {
    const st = statuses[t.id] || "";
    if (filter === "open" && st && st !== "wip") return false;
    if (filter === "done" && st !== "done") return false;
    if (filter === "action" && st !== "wip" && st !== "other") return false;
    if (filter === "closed" && st !== "done" && st !== "cancel" && st !== "skip") return false;
    if (filter === "blocked") {
      if (!t.date || t.date === "TBD") return false;
      if (!isTaskBlocked(t, t.date)) return false;
    }
    if (filter === "unplaced") {
      var uIds = {};
      (schedResultRef.current.unplaced || []).forEach(function(u) { uIds[u.id] = true; });
      if (!uIds[t.id]) return false;
    }
    if (hideHabits && t.habit) return false;
    const searchLower = search.toLowerCase().trim();
    if (searchLower) {
      const hay = `${t.project} ${t.text} ${t.notes} ${t.id} ${t.section}`.toLowerCase();
      return hay.includes(searchLower);
    }
    return true;
  }, [statuses, filter, search, hideHabits]);

  // Export
  const buildExport = useCallback(() => {
    const lines = [];
    const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    lines.push("TASK TRACKER REFRESH — " + now);
    lines.push("=".repeat(50));
    const counts = { done: 0, wip: 0, cancel: 0, skip: 0, other: 0, open: 0 };
    allTasks.forEach(t => { const s = statuses[t.id] || ""; if (s && counts[s] !== undefined) counts[s]++; else counts.open++; });
    lines.push(`SUMMARY: ${counts.done} done, ${counts.wip} WIP, ${counts.cancel} cancelled, ${counts.skip} skipped, ${counts.other} redirected, ${counts.open} open (of ${allTasks.length})`);
    lines.push("");
    ["done","wip","cancel","skip","other"].forEach(st => {
      const label = { done: "✓ DONE", wip: "⏳ WIP", cancel: "✕ CANCELLED", skip: "⏭ SKIPPED", other: "→ DO SOMETHING ELSE" }[st];
      const items = allTasks.filter(t => statuses[t.id] === st);
      if (items.length) {
        lines.push(`${label} (${items.length}):`);
        items.forEach(t => {
          lines.push(`  [${t.id}] ${t.date} ${t.project}: ${t.text}`);
          if (st === "other") lines.push(`    ↳ Direction: ${directions[t.id] || "(no direction entered)"}`);
        });
        lines.push("");
      }
    });
    const open = allTasks.filter(t => !statuses[t.id]);
    if (open.length) {
      lines.push(`— OPEN (${open.length}):`);
      open.forEach(t => {
        const mt = migrateTask(t);
        const tags = [mt.location.length > 0 ? mt.location.join("+") : "", mt.tools && mt.tools.length ? mt.tools.join("+") : "", t.when, t.dayReq].filter(x => x && x !== "anytime" && x !== "any").join("/");
        const deps = getTaskDeps(t);
        const depStr = deps.length ? " →deps:" + deps.join(",") : "";
        lines.push(`  [${t.id}] ${t.date} ${t.project}: ${t.text}${tags ? " [" + tags + "]" : ""}${depStr}`);
      });
    }
    return lines.join("\n");
  }, [statuses, directions, allTasks]);

  const handleExport = useCallback(() => {
    setShowExport(prev => !prev);
  }, []);

  const buildStateExport = useCallback(() => {
    return JSON.stringify({
      v7: true, statuses, extraTasks,
      locations, tools, toolMatrix, locSchedules, locScheduleDefaults, locScheduleOverrides,
      hourLocationOverrides, gridZoom, timeBlocks, projects, schedFloor,
      exported: new Date().toISOString()
    }, null, 2);
  }, [statuses, extraTasks, locations, tools, toolMatrix, locSchedules, locScheduleDefaults, locScheduleOverrides, hourLocationOverrides, gridZoom, splitDefault, splitMinDefault, timeBlocks, projects]);

  const handleStateImport = useCallback(() => {
    try {
      const data = JSON.parse(importText);
      if (data.statuses) setStatuses(data.statuses);
      if (data.extraTasks) {
        // If old format with overrides, merge them in
        if (data.overrides && !data.v7) {
          var ov = data.overrides;
          setExtraTasks(data.extraTasks.map(function(t) { return ov[t.id] ? Object.assign({}, t, ov[t.id]) : t; }));
        } else {
          setExtraTasks(data.extraTasks);
        }
      }
      if (data.locations) setLocations(data.locations);
      if (data.tools) setTools(data.tools);
      if (data.toolMatrix) setToolMatrix(data.toolMatrix);
      if (data.hourLocationOverrides) setHourLocationOverrides(data.hourLocationOverrides);
      // Import schedule templates (new or migrated)
      if (data.locSchedules) {
        setLocSchedules(data.locSchedules);
        if (data.locScheduleDefaults) setLocScheduleDefaults(data.locScheduleDefaults);
        if (data.locScheduleOverrides) setLocScheduleOverrides(data.locScheduleOverrides);
      } else if (data.weeklyHourLocs) {
        // Migrate old format
        var impWHL = data.weeklyHourLocs;
        var fd = impWHL[Object.keys(impWHL)[0]] || {};
        var ks = Object.keys(fd).map(Number).filter(function(n) { return !isNaN(n); });
        if (ks.length > 0 && Math.max.apply(null, ks) < 60) {
          var conv = {};
          DAY_NAMES.forEach(function(dn) { conv[dn] = {}; var dd = impWHL[dn] || {}; Object.keys(dd).forEach(function(hk) { var h = parseInt(hk); for (var qq = 0; qq < 4; qq++) conv[dn][h*60+qq*15] = dd[hk]; }); });
          impWHL = conv;
        }
        setLocSchedules({
          weekday: { name: "Weekday", icon: "\u{1F3E2}", system: true, hours: impWHL["Mon"] || {} },
          weekend: { name: "Weekend", icon: "\u{1F3E0}", system: true, hours: impWHL["Sat"] || {} },
        });
      }
      if (data.gridZoom) setGridZoom(data.gridZoom);
      if (data.projects) setProjects(data.projects);
      if (data.schedFloor !== undefined) setSchedFloor(data.schedFloor);
      if (data.timeBlocks) {
        if (Array.isArray(data.timeBlocks)) {
          var mig = {};
          DAY_NAMES.forEach(function(dn) { mig[dn] = data.timeBlocks.slice(); });
          setTimeBlocks(mig);
        } else {
          setTimeBlocks(data.timeBlocks);
        }
      }
      persistAll(
        data.statuses || statuses,
        directions,
        data.extraTasks || extraTasks
      );
      setImportText("");
      setShowStatePanel(false);
    } catch (e) {
      showToast("Invalid JSON: " + e.message, "error");
    }
  }, [importText, statuses, directions, extraTasks, persistAll]);

  // Stats
  const counts = useMemo(() => {
    const c = { done: 0, wip: 0, cancel: 0, other: 0, open: 0 };
    extraTasks.forEach(t => { const s = statuses[t.id] || ""; if (s && c[s] !== undefined) c[s]++; else c.open++; });
    return c;
  }, [statuses, extraTasks]);
  const pct = Math.round((counts.done / allTasks.length) * 100);

  // Parse task time to hour (0-23), returns null if unparseable
  // Day label
  const dayLabel = useMemo(() => {
    return `${DAY_NAMES_FULL[selectedDate.getDay()]}, ${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getDate()}`;
  }, [selectedDate]);

  // Render loop guard
  var renderCountRef = React.useRef({ count: 0, ts: Date.now() });
  
  // TaskCard stable refs — declared before loading return for hooks rules
  const taskCardContextRef = React.useRef({});
  const taskCardRef = React.useRef(null);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0F172A" }}>
      <p style={{ color: "#64748B", fontFamily: "'DM Sans', system-ui" }}>Loading calendar...</p>
    </div>
  );

  // Check for render loop (after hooks, after loading) — threshold lowered to catch faster
  var rc = renderCountRef.current;
  var elapsed = Date.now() - rc.ts;
  if (elapsed < 2000) { rc.count++; } else { rc.count = 1; rc.ts = Date.now(); }
  if (rc.count === 10) console.warn("TaskTracker: 10 renders in " + elapsed + "ms — watching for loop. expandedTask=" + expandedTask + " chain=" + chainPopupId + " settings=" + showSettings + "/" + configTab);
  if (rc.count > 40) {
    console.error("RENDER LOOP detected: " + rc.count + " renders in " + elapsed + "ms. expandedTask=" + expandedTask + " chainPopupId=" + chainPopupId + " configTab=" + configTab + " showSettings=" + showSettings);
    return (<div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui", background: "#0F172A", color: "#E2E8F0", minHeight: "100vh" }}>
      <h2 style={{ color: "#F87171" }}>{"\u26A0"} Render loop detected</h2>
      <p style={{ color: "#94A3B8" }}>The app re-rendered {rc.count} times in {elapsed}ms.</p>
      <pre style={{ fontSize: 10, color: "#FB923C", background: "#1E293B", padding: 8, borderRadius: 6, textAlign: "left", maxWidth: 500, margin: "12px auto" }}>
        {"expandedTask: " + expandedTask + "\nchainPopupId: " + chainPopupId + "\nconfigTab: " + configTab + "\nshowSettings: " + showSettings + "\ntoastHistory: " + toastHistory.length + "\ntasks: " + extraTasks.length + "\nprojects: " + projects.length}
      </pre>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button onClick={() => { rc.count = 0; rc.ts = Date.now(); }} style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", background: "#3B82F6", color: "white", cursor: "pointer" }}>Try Again</button>
        <button onClick={() => window.location.reload()} style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "1px solid #475569", background: "transparent", color: "#94A3B8", cursor: "pointer" }}>Reload Page</button>
      </div>
    </div>);
  }

  // Helpers for rich date/time controls
  var _renderStart = performance.now();
  if (rc.count <= 3) console.log("[RENDER #" + rc.count + "] view=" + viewMode + " expanded=" + expandedTask + " chain=" + chainPopupId + " settings=" + showSettings + "/" + configTab + " tasks=" + extraTasks.length);
  // toTime24, fromTime24, toDateISO, fromDateISO — moved to module level

  // ── Theme (base + mode overrides) ──
  var THEME_BASE = {
    muted2: "#6B7280",
  };
  var THEME_DARK = {
    bg: "#0F172A", bgCard: "#1E293B", bgHover: "#334155", bgInput: "#1E293B",
    border: "#334155", borderLight: "#1E293B", text: "#E2E8F0", textMuted: "#94A3B8", textDim: "#64748B",
    accent: "#3B82F6", cardDone: "#064E3B", cardWip: "#422006", cardDefault: "#1E293B",
    btnBg: "#334155", btnBorder: "#475569", btnText: "#E2E8F0",
    inputBg: "#0F172A", inputBorder: "#475569", inputText: "#E2E8F0",
    panelBg: "#1E293B", overlayBg: "rgba(0,0,0,0.7)", progressBg: "#334155", progressFill: "#3B82F6",
    white: "#1E293B", headerBg: "#0F172A",
    chipBg: "#334155", chipText: "#CBD5E1",
    blueBg: "#1E3A5F", blueText: "#93C5FD", blueBorder: "#2563EB",
    greenBg: "#064E3B", greenText: "#6EE7B7", greenBorder: "#059669",
    amberBg: "#422006", amberText: "#FCD34D", amberBorder: "#D97706",
    redBg: "#450A0A", redText: "#FCA5A5", redBorder: "#DC2626",
    purpleBg: "#2E1065", purpleText: "#C4B5FD", purpleBorder: "#7C3AED",
    settingsBg: "#1E293B", settingsBorder: "#7C3AED", settingsTabBg: "#334155", settingsTabActive: "#5B21B6", settingsLabel: "#C4B5FD",
    helpBg: "#1E293B", exportBg: "#0F2818", exportBorder: "#059669",
  };
  var THEME_LIGHT = {
    bg: "#F8FAFC", bgCard: "#FFFFFF", bgHover: "#F1F5F9", bgInput: "#F8FAFC",
    border: "#E2E8F0", borderLight: "#F1F5F9", text: "#1E293B", textMuted: "#64748B", textDim: "#94A3B8",
    accent: "#2563EB", cardDone: "#ECFDF5", cardWip: "#FFFBEB", cardDefault: "#FFFFFF",
    btnBg: "#FFFFFF", btnBorder: "#CBD5E1", btnText: "#1E293B",
    inputBg: "#F8FAFC", inputBorder: "#CBD5E1", inputText: "#1E293B",
    panelBg: "#FFFFFF", overlayBg: "rgba(0,0,0,0.6)", progressBg: "#E2E8F0", progressFill: "#2563EB",
    white: "#FFFFFF", headerBg: "#F8FAFC",
    chipBg: "#EDF2F7", chipText: "#64748B",
    blueBg: "#DBEAFE", blueText: "#1E40AF", blueBorder: "#93C5FD",
    greenBg: "#D1FAE5", greenText: "#065F46", greenBorder: "#059669",
    amberBg: "#FEF3C7", amberText: "#92400E", amberBorder: "#D97706",
    redBg: "#FEE2E2", redText: "#991B1B", redBorder: "#DC2626",
    purpleBg: "#EDE9FE", purpleText: "#5B21B6", purpleBorder: "#7C3AED",
    settingsBg: "#F5F3FF", settingsBorder: "#8B5CF6", settingsTabBg: "#FFFFFF", settingsTabActive: "#DDD6FE", settingsLabel: "#5B21B6",
    helpBg: "#FFFFFF", exportBg: "#F0FDF4", exportBorder: "#4ADE80",
  };
  var TH = Object.assign({}, THEME_BASE, darkMode ? THEME_DARK : THEME_LIGHT);

  // ── UI Helper Functions (reduce repetitive createElement/style patterns) ──
  function sSection(title, desc, colorKey, children) {
    // colorKey: "green", "purple", "blue", "amber", "red"
    var bg = TH[colorKey + "Bg"], border = TH[colorKey + "Border"], text = TH[colorKey + "Text"];
    return $("div", { style: { marginBottom: 10, padding: 8, background: bg, borderRadius: 6, border: "1px solid " + border } },
      $("div", { style: { fontSize: 10, fontWeight: 700, color: text, marginBottom: 4 } }, title),
      desc && $("div", { style: { fontSize: 9, color: TH.muted2, marginBottom: 6 } }, desc),
      children
    );
  }
  function sBtn(label, onClick, opts) {
    var o = opts || {};
    return $("button", { onClick: onClick, disabled: o.disabled, title: o.title, style: Object.assign({
      fontSize: o.fs || 10, padding: o.pad || "4px 12px", borderRadius: o.br || 6, fontWeight: o.fw || 600,
      cursor: o.disabled ? "default" : "pointer", border: "1px solid " + (o.bc || TH.btnBorder),
      background: o.bg || TH.bgHover, color: o.c || TH.textMuted, opacity: o.opacity || 1,
    }, o.style || {}) }, label);
  }
  function sFlexRow(gap, children, style) {
    return $("div", { style: Object.assign({ display: "flex", gap: gap, alignItems: "center" }, style || {}) }, children);
  }
  // Editable list row for locations/tools (icon + name input + id input + icon input + delete)
  function editableListRow(item, idx, list, setList, extraCols, onDelete) {
    return $("div", { key: idx, style: { display: "flex", gap: 6, alignItems: "center", padding: "4px 0", borderBottom: "1px solid #EDE9FE" } },
      $("span", { style: { fontSize: 14 } }, item.icon),
      $("input", { value: item.name, onChange: function(e) {
        var nl = list.slice(); nl[idx] = Object.assign({}, nl[idx], { name: e.target.value }); setList(nl);
      }, style: { flex: 1, fontSize: 11, padding: "3px 6px", border: "1px solid #C4B5FD", borderRadius: 4, background: TH.white } }),
      extraCols && extraCols(item, idx),
      $("input", { value: item.icon, onChange: function(e) {
        var nl = list.slice(); nl[idx] = Object.assign({}, nl[idx], { icon: e.target.value }); setList(nl);
      }, style: { width: 28, fontSize: 14, textAlign: "center", border: "1px solid #D1D5DB", borderRadius: 3, padding: 1 } }),
      $("button", { onClick: function() { onDelete(item, idx); },
        style: { background: "none", border: "none", cursor: "pointer", color: TH.redText, fontSize: 12 } }, "\u{1F5D1}")
    );
  }

  // TaskCard must have a STABLE reference so React doesn't unmount/remount all cards on every render.
  // We store the component in a ref and update the closure vars it needs via another ref.
  // Update context ref with latest closure values (after all local vars are defined)
  taskCardContextRef.current = { statuses, expandedTask, pendingEdits, setPendingEdits, setExpandedTask, savedFlash, chainPopupId, setChainPopupId, dependentsMap, allTasks, darkMode, TH, locations, tools, allProjectNames, getProjectMeta, isTaskBlocked, filterTask, hideHabits, search, filter, taskAiRef, directions, changeDirection, pushUndo, extraTasks, setExtraTasks, persistAll, setStatuses, setConfirmAction, showToast, uniqueTags, splitDefault, splitMinDefault, getLocationForDate, projects, setProjects, updateTaskFields, schedFloor, changeStatus, toTime24, fromTime24, toDateISO, fromDateISO, autoReschedule };

  // Lazy-init TaskCard component (stable reference — created once, never recreated)
  if (!taskCardRef.current) {
    taskCardRef.current = function TaskCardStable({ t, dateStr, blocked: blockedProp, pastWindows: pastWindowsProp, ctxRef }) {
    try {
    var ctx = ctxRef.current;
    const { statuses, expandedTask, pendingEdits, setPendingEdits, setExpandedTask, savedFlash, chainPopupId, setChainPopupId, dependentsMap, allTasks, darkMode, TH, locations, tools, allProjectNames, getProjectMeta, isTaskBlocked, taskAiRef, directions, changeDirection, pushUndo, extraTasks, setExtraTasks, persistAll, setStatuses, setConfirmAction, showToast, uniqueTags, splitDefault, splitMinDefault, getLocationForDate, projects, setProjects, updateTaskFields, changeStatus, toTime24, fromTime24, toDateISO, fromDateISO, autoReschedule } = ctx;
    const st = statuses[t.id] || "";
    const sc = STATUS_MAP[st] || STATUS_MAP[""];
    const closed = st === "done" || st === "cancel" || st === "skip";
    const badge = PRI_COLORS[t.pri] || "#6B7280";
    const isExpanded = expandedTask === t.id;
    const isHabit = t.habit;
    const blocked = blockedProp != null ? blockedProp : (dateStr ? isTaskBlocked(t, dateStr) : false);
    const justSaved = savedFlash[t.id];
    const wasBumped = justSaved === "bumped";

  return (
      <div
        onClick={() => {
          console.log("[CLICK] TaskCard " + t.id + " isExpanded=" + isExpanded + " viewMode=" + viewMode);
          if (isExpanded) {
            setExpandedTask(null); setPendingEdits(null); if (taskAiRef.current) taskAiRef.current.value = "";
          } else {
            setExpandedTask(t.id);
            setPendingEdits({ id: t.id, fields: {} });
            if (taskAiRef.current) taskAiRef.current.value = "";
          }
        }}
        style={{
          marginBottom: 2,
          borderRadius: 4,
          borderLeft: `3px solid ${blocked ? "#F97316" : isHabit ? "#059669" : badge}`,
          borderTop: isHabit ? "1px dashed " + TH.textDim : "none",
          borderBottom: isHabit ? "1px dashed " + TH.textDim : "none",
          background: wasBumped ? (darkMode ? "#422006" : "#FEF3C7") : justSaved ? (darkMode ? "#064E3B" : "#D1FAE5") : blocked ? (darkMode ? "#431407" : "#FFF7ED") : st === "skip" ? (darkMode ? "#1E293B" : "#F1F5F9") : closed ? (st === "done" ? TH.cardDone : (darkMode ? "#450A0A" : "#FEF2F2")) : st === "wip" ? TH.cardWip : st === "other" ? (darkMode ? "#2E1065" : "#F5F3FF") : (isHabit && !isExpanded) ? TH.bgHover : TH.cardDefault,
          opacity: isExpanded ? 1 : (st === "skip" ? 0.5 : blocked ? 0.6 : (isHabit && !isExpanded) ? 0.7 : 1),
          cursor: "pointer",
          transition: "all 0.4s ease",
          fontSize: 11,
          overflow: isExpanded ? "visible" : "hidden",
          position: "relative",
          boxShadow: wasBumped ? "0 0 0 2px #D97706" : justSaved ? "0 0 0 2px #10B981" : isExpanded ? ("0 0 0 2px " + TH.accent + ", 0 6px 20px rgba(0,0,0,0.2)") : "none",
          height: "100%", boxSizing: "border-box",
          zIndex: isExpanded ? 50 : undefined,
        }}
      >
        {isExpanded && (
          <button onClick={(e) => { e.stopPropagation(); setExpandedTask(null); setPendingEdits(null); }} style={{
            position: "absolute", top: 2, right: 4, zIndex: 51,
            width: 22, height: 22, borderRadius: "50%", border: "1px solid " + TH.border,
            background: TH.white, color: TH.textMuted, fontSize: 13, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
          }}>✕</button>
        )}
        {blocked && (
          <div style={{
            position: "absolute", top: 2, right: 3, fontSize: 8, fontWeight: 700,
            color: TH.amberText, background: TH.amberBg, padding: "0 3px", borderRadius: 2,
            zIndex: 1,
          }}>🚫 HOME</div>
        )}
        <div style={{ padding: "4px 5px", display: "flex", gap: 4, alignItems: "flex-start", background: isExpanded ? (darkMode ? "#1E293B" : "#F1F5F9") : "transparent", borderRadius: isExpanded ? "4px 4px 0 0" : 0 }}>
          <select
            value={st}
            onChange={e => { e.stopPropagation(); changeStatus(t.id, e.target.value); }}
            onClick={e => e.stopPropagation()}
            title={sc.tip || "Set status"}
            style={{
              flexShrink: 0, minWidth: 28, fontSize: 10, padding: "1px 2px",
              borderRadius: 3, border: `1px solid ${sc.color}33`, background: sc.bg, color: sc.color,
              cursor: "pointer", textAlign: "center",
            }}
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} {o.value ? o.value : "open"}</option>)}
          </select>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
              {t.time && !["", "ASAP"].includes(t.time) && (
                <span style={{
                  fontSize: 9, fontWeight: 700, color: TH.textMuted,
                  background: TH.bgHover, padding: "0 3px", borderRadius: 2,
                  fontVariantNumeric: "tabular-nums",
                }}>{t.time.split("-")[0].split(" ")[0]}{t.time.includes("AM") ? "a" : t.time.includes("PM") ? "p" : ""}</span>
              )}
              {t.dur && (
                <span style={{
                  fontSize: 8, fontWeight: 600, color: TH.textMuted,
                  background: TH.border, padding: "0 3px", borderRadius: 2, lineHeight: "14px",
                }}>{t.dur >= 60 ? (t.dur % 60 === 0 ? (t.dur/60) + "h" : (t.dur/60).toFixed(1) + "h") : t.dur + "m"}</span>
              )}
              {!isHabit && (
                <span style={{
                  fontSize: 8, fontWeight: 700, color: "white",
                  background: badge, padding: "0 3px", borderRadius: 2, lineHeight: "14px",
                }}>{t.pri || "P3"}</span>
              )}
              {t.timeRemaining != null && t.timeRemaining < (t.dur || 30) && (
                <span style={{
                  fontSize: 8, fontWeight: 700, color: TH.purpleText,
                  background: TH.purpleBg, padding: "0 3px", borderRadius: 2, lineHeight: "14px",
                }}>{t.timeRemaining >= 60 ? (t.timeRemaining/60).toFixed(1) + "h" : t.timeRemaining + "m"} left</span>
              )}
              {t.created && (new Date() - new Date(t.created)) < 172800000 && (
                <span style={{
                  fontSize: 8, fontWeight: 700, color: "white",
                  background: "#7C3AED", padding: "0 3px", borderRadius: 2, lineHeight: "14px",
                }}>NEW</span>
              )}
              {(() => {
                var deps = getTaskDeps(t);
                if (deps.length === 0) return null;
                var depStatus = getDepsStatus(t, allTasks, statuses);
                if (depStatus.satisfied) {
                  return <span style={{ fontSize: 8, fontWeight: 600, color: TH.greenText, background: TH.greenBg, padding: "0 3px", borderRadius: 2, lineHeight: "14px" }}>🔗✓</span>;
                }
                var pendingNames = depStatus.pending.map(function(did) {
                  var dt = allTasks.find(function(x) { return x.id === did; });
                  return dt ? dt.text.substring(0, 20) : did;
                });
                return <span title={"Waiting on: " + pendingNames.join(", ")} style={{ fontSize: 8, fontWeight: 700, color: TH.amberText, background: TH.amberBg, padding: "0 3px", borderRadius: 2, lineHeight: "14px" }}>⏳ {depStatus.pending.length} dep{depStatus.pending.length > 1 ? "s" : ""}</span>;
              })()}
              {(() => {
                var dependents = dependentsMap[t.id] || [];
                if (dependents.length === 0) return null;
                var openDeps = dependents.filter(function(d) { var s = statuses[d.id] || ""; return s !== "done" && s !== "cancel" && s !== "skip"; });
                if (openDeps.length === 0) return null;
                return <span style={{ fontSize: 8, fontWeight: 600, color: TH.blueText, background: TH.blueBg, padding: "0 3px", borderRadius: 2, lineHeight: "14px" }}>🔗→{openDeps.length}</span>;
              })()}
              {!closed && t.due && (() => {
                var dueDate = parseDate(t.due);
                if (!dueDate) return null;
                var now = new Date(); now.setHours(0,0,0,0);
                var taskDate = parseDate(t.date);
                var checkDate = taskDate || now;
                var daysUntilDue = Math.round((dueDate - now) / 86400000);
                var scheduledPastDue = taskDate && taskDate > dueDate;
                if (scheduledPastDue || daysUntilDue < 0) {
                  return <span style={{ fontSize: 8, fontWeight: 700, color: "white", background: "#DC2626", padding: "0 3px", borderRadius: 2, lineHeight: "14px" }}>⚠ OVERDUE</span>;
                } else if (daysUntilDue <= 2) {
                  return <span style={{ fontSize: 8, fontWeight: 700, color: TH.amberText, background: TH.amberBg, padding: "0 3px", borderRadius: 2, lineHeight: "14px" }}>Due {daysUntilDue === 0 ? "today" : daysUntilDue === 1 ? "tmrw" : "in " + daysUntilDue + "d"}</span>;
                } else if (daysUntilDue <= 7) {
                  return <span style={{ fontSize: 8, fontWeight: 600, color: TH.blueText, background: TH.blueBg, padding: "0 3px", borderRadius: 2, lineHeight: "14px" }}>Due {t.due}</span>;
                }
                return <span style={{ fontSize: 8, fontWeight: 500, color: TH.textMuted, background: TH.bgHover, padding: "0 3px", borderRadius: 2, lineHeight: "14px" }}>Due {t.due}</span>;
              })()}
              {!closed && t.startAfter && (() => {
                var saDate = parseDate(t.startAfter);
                if (!saDate) return null;
                var now = new Date(); now.setHours(0,0,0,0);
                var daysUntil = Math.round((saDate - now) / 86400000);
                if (daysUntil > 0) return <span style={{ fontSize: 8, fontWeight: 500, color: TH.blueText, background: TH.blueBg, padding: "0 3px", borderRadius: 2, lineHeight: "14px" }}>⏳ starts {t.startAfter}</span>;
                return null;
              })()}
            </div>
            <div style={{
              fontSize: isHabit ? 10 : 11, fontWeight: isHabit ? 400 : 500,
              color: closed ? (st === "done" ? TH.greenText : st === "skip" ? TH.textMuted : TH.redText) : isHabit ? TH.textMuted : TH.text,
              fontStyle: isHabit ? "italic" : "normal",
              textDecoration: closed ? "line-through" : "none",
              lineHeight: "14px", marginTop: 1,
              whiteSpace: isExpanded ? "normal" : "nowrap",
              overflow: isExpanded ? "visible" : "hidden",
              textOverflow: "ellipsis",
            }}>
              {!isHabit && <span style={{ color: (getProjectMeta(t.project) || {}).color || badge, fontWeight: 600, fontSize: 10 }}>{((getProjectMeta(t.project) || {}).icon || "") + (((getProjectMeta(t.project) || {}).icon) ? " " : "")}{t.project} · </span>}
              {isHabit && <span style={{ fontSize: 9 }}>{t.rigid ? "\u{1F4CC}" : "\u{1F501}"} <span style={{ color: badge, fontWeight: 600, fontSize: 8 }}>{t.pri}</span> </span>}
              {!isHabit && t.recur && t.recur.type !== "none" && <span style={{ fontSize: 8, color: "#059669" }}>{"\u{1F501}"} </span>}
              {!isHabit && t.sourceId && <span style={{ fontSize: 8, color: "#059669" }}>{"\u{1F501}"} </span>}
              {t.text}
            </div>
            {/* Collapsed metadata */}
            {!isExpanded && (
              (() => {
                var _mt = migrateTask(t);
                return $("div", { style: { display: "flex", gap: 3, flexWrap: "wrap", marginTop: 2 } },
                  $("span", { style: { fontSize: 7, color: TH.textDim, fontFamily: "monospace", lineHeight: "12px" } }, t.id),
                  (_mt.location.length > 0 || (_mt.tools && _mt.tools.length > 0)) && $("span", { style: { fontSize: 8, color: TH.textMuted, background: TH.chipBg, padding: "0 3px", borderRadius: 2, lineHeight: "12px" } },
                    _mt.location.map(function(lid) { var lo = locations.find(function(l) { return l.id === lid; }); return lo ? lo.icon : lid; }).join(""), " ", _mt.tools && _mt.tools.length > 0 ? _mt.tools.map(function(tid) { var tObj = tools.find(function(x) { return x.id === tid; }); return tObj ? tObj.icon : ""; }).join("") : ""
                  ),
                  t.when && t.when !== "anytime" && $("span", { style: { fontSize: 8, color: TH.textMuted, background: TH.chipBg, padding: "0 3px", borderRadius: 2, lineHeight: "12px" } },
                    parseWhen(t.when).map(function(w) { var tb = uniqueTags.find(function(u){return u.tag===w}); return tb ? tb.icon : w === "fixed" ? "\u{1F4CC}" : ""; }).join(""), " ", parseWhen(t.when).join("+")
                  ),
                  t.pri && $("span", { style: { fontSize: 8, color: "white", background: badge, padding: "0 3px", borderRadius: 2, lineHeight: "12px", fontWeight: 600 } }, t.pri),
                  t.notes && !closed && $("span", { style: { fontSize: 8, color: TH.textMuted, fontStyle: "italic", lineHeight: "12px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" } },
                    t.notes.substring(0, 40), t.notes.length > 40 ? "\u2026" : ""
                  ),
                  blocked && $("span", { style: { fontSize: 8, color: TH.amberText, background: TH.amberBg, padding: "0 3px", borderRadius: 2, lineHeight: "12px", fontWeight: 600 } }, pastWindowsProp ? "\u23F0 past" : "\u{1F6AB} blocked")
                );
              })()
            )}
          </div>
        </div>

        {isExpanded && (
          <div style={{ padding: "4px 5px 6px 35px", borderTop: "1px solid " + TH.border, background: TH.bgCard }} onClick={e => e.stopPropagation()}>
            {/* Rich editor with save/cancel */}
            {(function() {
              console.log("[EXPAND] rendering editor for " + t.id);
              var pe = (pendingEdits && pendingEdits.id === t.id) ? pendingEdits.fields : {};
              var setPE = function(key, val) {
                var nf = Object.assign({}, pe);
                nf[key] = val;
                setPendingEdits({ id: t.id, fields: nf });
              };
              var curDate = pe.date || t.date || "";
              var curTime = pe.time || t.time || "";
              var curDur = pe.dur || t.dur || 30;
              var curRemaining = pe.timeRemaining != null ? pe.timeRemaining : (t.timeRemaining != null ? t.timeRemaining : curDur);
              var curDue = pe.due !== undefined ? pe.due : (t.due || "");
              var curStartAfter = pe.startAfter !== undefined ? pe.startAfter : (t.startAfter || "");
              var curSplit = pe.split !== undefined ? pe.split : (t.split !== undefined ? t.split : splitDefault);
              var curSplitMin = pe.splitMin !== undefined ? pe.splitMin : (t.splitMin || splitMinDefault);
              var curPri = pe.pri || t.pri || "";
              var curHabit = pe.habit !== undefined ? pe.habit : (t.habit || false);
              var curRigid = pe.rigid !== undefined ? pe.rigid : (t.rigid || false);
              var curWhere = pe.where || t.where || "anywhere";
              var mt = migrateTask(Object.assign({}, t, pe));
              var curLocation = pe.location !== undefined ? pe.location : (mt.location || []);
              if (typeof curLocation === "string") curLocation = curLocation === "anywhere" || curLocation === "" ? [] : [curLocation];
              var curTools = pe.tools || mt.tools || [];
              var curWhen = pe.when || t.when || "anytime";
              var hasChanges = pendingEdits && pendingEdits.id === t.id && Object.keys(pe).length > 0;
              var iStyle = { fontSize: 11, padding: "3px 4px", border: "1px solid " + TH.inputBorder, borderRadius: 4, background: TH.inputBg, color: TH.inputText };
              var lStyle = { fontSize: 8, color: TH.textMuted, display: "flex", flexDirection: "column", gap: 2, fontWeight: 600 };
              var curText = pe.text !== undefined ? pe.text : (t.text || "");
              var curNotes = pe.notes !== undefined ? pe.notes : (t.notes || "");
              var curProject = pe.project !== undefined ? pe.project : (t.project || "");
              return $(React.Fragment, null,
                $("div", { style: { display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center", background: darkMode ? "#1E293B" : "#F1F5F9", margin: "-4px -5px 6px -35px", padding: "6px 8px 6px 35px", borderBottom: "1px solid " + TH.border } },
                  $("button", {
                    onClick: function() {
                      pushUndo("edit " + t.id);
                      updateTaskFields(t.id, pe);
                      var newEx = extraTasks.map(function(et) { return et.id === t.id ? Object.assign({}, et, pe) : et; });
                      persistAll(statuses, directions, newEx);
                      setPendingEdits(null); setExpandedTask(null);
                      var fl = {}; fl[t.id] = "saved";
                      setSavedFlash(fl); setTimeout(function() { setSavedFlash({}); }, 1500);
                      // Auto-reschedule after state settles
                      setTimeout(function() { try { ctxRef.current.autoReschedule(); } catch(e) { console.error("Auto-reschedule error:", e); } }, 100);
                    },
                    disabled: !hasChanges,
                    style: {
                      fontSize: 10, fontWeight: 700, padding: "4px 14px", border: "none", borderRadius: 4,
                      background: hasChanges ? "#10B981" : TH.btnBorder, color: "white",
                      cursor: hasChanges ? "pointer" : "default", opacity: hasChanges ? 1 : 0.5,
                    }
                  }, "\u2714 Save"),
                  $("button", {
                    onClick: function() {
                      setConfirmAction({ msg: 'Delete ' + t.text.slice(0,40) + '?', fn: function() {
                        pushUndo("delete " + t.id);
                        // Rewire dependencies: tasks that depended on this one now depend on this one's deps
                        var deletedDeps = t.dependsOn || [];
                        var newEx = extraTasks.filter(function(et) { return et.id !== t.id; }).map(function(et) {
                          if (!et.dependsOn || et.dependsOn.indexOf(t.id) === -1) return et;
                          // Remove deleted task from deps, add its deps instead (avoid duplicates)
                          var newDeps = et.dependsOn.filter(function(d) { return d !== t.id; });
                          deletedDeps.forEach(function(d) { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
                          return Object.assign({}, et, { dependsOn: newDeps });
                        });
                        setExtraTasks(newEx);
                        setStatuses(function(prev) { var n = Object.assign({}, prev); delete n[t.id]; return n; });
                        setPendingEdits(null); setExpandedTask(null);
                        persistAll(statuses, directions, newEx);
                        var rewired = extraTasks.filter(function(et) { return et.dependsOn && et.dependsOn.indexOf(t.id) !== -1; }).length;
                        showToast("Deleted " + t.id + (rewired > 0 ? " · rewired " + rewired + " dep" + (rewired > 1 ? "s" : "") : ""), "info");
                        setTimeout(function() { try { ctxRef.current.autoReschedule(); } catch(e) {} }, 100);
                      }});
                    },
                    title: "Delete this task permanently",
                    style: { fontSize: 10, fontWeight: 600, padding: "4px 10px", border: "1px solid #DC2626", borderRadius: 4, background: TH.redBg, color: TH.redText, cursor: "pointer" }
                  }, "\u{1F5D1} Delete"),
                  $("button", {
                    onClick: function() {
                      var newId = "cp_" + String(Date.now()).slice(-5);
                      var copy = Object.assign({}, t, { id: newId, status: "", notes: "(copy) " + (t.notes || "") });
                      setExtraTasks(function(prev) { return prev.concat([copy]); });
                      setExpandedTask(newId);
                      setPendingEdits(null);
                    },
                    title: "Duplicate this task",
                    style: { fontSize: 10, fontWeight: 600, padding: "4px 10px", border: "1px solid #6366F1", borderRadius: 4, background: "#EEF2FF", color: "#4338CA", cursor: "pointer" }
                  }, "📋 Dupe"),
                  hasChanges && $("span", {
                    style: { fontSize: 9, color: "#D97706", fontWeight: 600 }
                  }, "\u26A0\uFE0F Unsaved changes")
                ),
                $("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 5 } },
                  $("label", { style: Object.assign({}, lStyle, { flex: 1, minWidth: 200 }) },
                    "Task",
                    $("input", { type: "text", value: curText, onChange: function(e) { setPE("text", e.target.value); }, style: Object.assign({}, iStyle, { width: "100%" }), onClick: function(e) { e.stopPropagation(); }, onMouseDown: function(e) { e.stopPropagation(); }, onFocus: function(e) { e.stopPropagation(); } })
                  ),
                  $("label", { style: lStyle },
                    "Project",
                    $("div", { style: { display: "flex", gap: 3, alignItems: "center" } },
                      $("select", { value: curProject, onChange: function(e) {
                        if (e.target.value === "__new__") {
                          var name = prompt("New project name:");
                          if (name && name.trim()) {
                            name = name.trim();
                            setPE("project", name);
                            if (!projects.find(function(p) { return p.name === name; })) {
                              var defaultColors = ["#DC2626","#D97706","#2563EB","#059669","#7C3AED","#DB2777","#0891B2","#65A30D","#C2410C","#4338CA"];
                              setProjects(function(prev) { return prev.concat([{ id: "proj_" + Date.now(), name: name, color: defaultColors[prev.length % defaultColors.length], icon: "" }]); });
                            }
                          }
                        } else {
                          setPE("project", e.target.value);
                        }
                      }, style: Object.assign({}, iStyle, { width: 120 }), onClick: function(e) { e.stopPropagation(); } },
                        $("option", { value: "" }, "— none —"),
                        allProjectNames.map(function(name) {
                          var pm = getProjectMeta(name);
                          return $("option", { key: name, value: name }, (pm && pm.icon ? pm.icon + " " : "") + name);
                        }),
                        $("option", { value: "__new__" }, "+ New Project...")
                      ),
                      curProject && (() => {
                        var pm = getProjectMeta(curProject);
                        return pm && pm.color ? $("span", { style: { width: 10, height: 10, borderRadius: "50%", background: pm.color, flexShrink: 0 } }) : null;
                      })()
                    )
                  )
                ),
                $("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 5 } },
                  $("label", { style: lStyle },
                    "\u{1F4C5} Date",
                    $("input", { type: "date", value: toDateISO(curDate), onChange: function(e) {
                      var nf = Object.assign({}, pe, { date: fromDateISO(e.target.value) });
                      var d = new Date(e.target.value + "T12:00:00");
                      if (!isNaN(d)) nf.day = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
                      setPendingEdits({ id: t.id, fields: nf });
                    }, style: iStyle })
                  ),
                  $("label", { style: lStyle },
                    "\u{1F552} Time",
                    $("input", { type: "time", value: toTime24(curTime) || "", onChange: function(e) { setPE("time", fromTime24(e.target.value)); }, style: iStyle }),
                    toTime24(curTime) === "" && curTime ? $("span", { style: { fontSize: 8, color: TH.textMuted, marginTop: 1 } }, "\"" + curTime + "\"") : null
                  ),
                  $("label", { style: lStyle },
                    "\u23F1 Duration",
                    $("select", { value: curDur, onChange: function(e) { setPE("dur", parseInt(e.target.value)); }, style: iStyle },
                      [5,10,15,20,30,45,60,90,120,180,240].concat(
                        [5,10,15,20,30,45,60,90,120,180,240].indexOf(curDur) === -1 ? [curDur] : []
                      ).sort(function(a,b){return a-b;}).map(function(v) {
                        return $("option", { key: v, value: v }, v < 60 ? v + " min" : v === 60 ? "1 hour" : v === 90 ? "1.5 hrs" : (v/60) + " hrs");
                      })
                    )
                  ),
                  $("label", { style: lStyle },
                    "\u{1F4CA} Remaining",
                    $("select", { value: curRemaining, onChange: function(e) { setPE("timeRemaining", parseInt(e.target.value)); }, style: Object.assign({}, iStyle, { background: curRemaining < curDur ? TH.purpleBg : TH.inputBg }) },
                      [0,5,10,15,20,30,45,60,90,120,180,240].concat(
                        [0,5,10,15,20,30,45,60,90,120,180,240].indexOf(curRemaining) === -1 ? [curRemaining] : [],
                        [0,5,10,15,20,30,45,60,90,120,180,240].indexOf(curDur) === -1 ? [curDur] : []
                      ).filter(function(v, i, a) { return a.indexOf(v) === i; }).sort(function(a,b){return a-b;}).map(function(v) {
                        return $("option", { key: v, value: v }, v === 0 ? "Done (0)" : v < 60 ? v + " min" : v === 60 ? "1 hour" : v === 90 ? "1.5 hrs" : (v/60) + " hrs");
                      })
                    )
                  ),
                  $("label", { style: lStyle },
                    "\u2702 Split",
                    $("div", { style: { display: "flex", gap: 4, alignItems: "center" } },
                      $("button", { onClick: function() { setPE("split", !curSplit); }, style: {
                        padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", fontWeight: 600,
                        border: "1px solid " + (curSplit ? TH.greenBorder : TH.btnBorder),
                        background: curSplit ? TH.greenBg : TH.inputBg,
                        color: curSplit ? TH.greenText : TH.textMuted,
                      } }, curSplit ? "\u2702 Yes" : "No"),
                      curSplit && $("select", { value: curSplitMin, onChange: function(e) { setPE("splitMin", parseInt(e.target.value)); }, style: Object.assign({}, iStyle, { width: "auto", minWidth: 60 }) },
                        [15,20,30,45,60].map(function(v) {
                          return $("option", { key: v, value: v }, v < 60 ? v + "m min" : "1h min");
                        })
                      )
                    )
                  ),
                  $("label", { style: lStyle },
                    "\u{1F4C6} Due",
                    $("div", { style: { display: "flex", gap: 3, alignItems: "center" } },
                      $("input", { type: "date", value: toDateISO(curDue), onChange: function(e) {
                        setPE("due", e.target.value ? fromDateISO(e.target.value) : "");
                      }, min: "2026-02-22", max: "2026-12-31", style: Object.assign({}, iStyle, curDue ? { background: TH.amberBg } : {}) }),
                      curDue && $("button", {
                        onClick: function(e) { e.stopPropagation(); setPE("due", ""); },
                        style: { fontSize: 9, background: "none", border: "none", color: TH.redText, cursor: "pointer", padding: 0, fontWeight: 700 }
                      }, "\u2715")
                    )
                  ),
                  $("label", { style: lStyle },
                    "\u23F3 Start after",
                    $("div", { style: { display: "flex", gap: 3, alignItems: "center" } },
                      $("input", { type: "date", value: toDateISO(curStartAfter), onChange: function(e) {
                        setPE("startAfter", e.target.value ? fromDateISO(e.target.value) : "");
                      }, min: "2026-02-22", max: "2026-12-31", style: Object.assign({}, iStyle, curStartAfter ? { background: TH.blueBg } : {}) }),
                      curStartAfter && $("button", {
                        onClick: function(e) { e.stopPropagation(); setPE("startAfter", ""); },
                        style: { fontSize: 9, background: "none", border: "none", color: TH.redText, cursor: "pointer", padding: 0, fontWeight: 700 }
                      }, "\u2715")
                    )
                  )
                ),
                $("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 5 } },
                  $("label", { style: lStyle },
                    "\u{1F525} Priority",
                    $("select", { value: curPri, onChange: function(e) { setPE("pri", e.target.value); }, style: iStyle },
                      $("option", { value: "P1" }, "\u{1F534} P1 Critical"),
                      $("option", { value: "P2" }, "\u{1F7E0} P2 High"),
                      $("option", { value: "P3" }, "\u{1F535} P3 Medium"),
                      $("option", { value: "P4" }, "\u26AA P4 Low")
                    )
                  ),
                  $("label", { style: lStyle },
                    "\u{1F501} Habit",
                    $("button", { onClick: function() { setPE("habit", !curHabit); }, style: {
                      padding: "3px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer", fontWeight: 600,
                      border: "1px solid " + (curHabit ? TH.greenBorder : TH.btnBorder),
                      background: curHabit ? TH.greenBg : TH.inputBg,
                      color: curHabit ? TH.greenText : TH.textMuted,
                    } }, curHabit ? "\u{1F501} Yes" : "No")
                  ),
                  curHabit && $("label", { style: lStyle },
                    "\u{1F4CC} Rigid",
                    $("div", { style: { display: "flex", gap: 4, alignItems: "center" } },
                      $("button", { onClick: function() { setPE("rigid", !curRigid); }, style: {
                        padding: "3px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer", fontWeight: 600,
                        border: "1px solid " + (curRigid ? TH.accent : TH.btnBorder),
                        background: curRigid ? TH.blueBg : TH.inputBg,
                        color: curRigid ? TH.blueText : TH.textMuted,
                      } }, curRigid ? "\u{1F4CC} Anchored" : "\u{1F501} Slidable"),
                      $("span", { style: { fontSize: 8, color: TH.textDim } }, curRigid ? "Stays at set time" : "Moves to fit schedule")
                    )
                  ),
                  $("label", { style: lStyle },
                    "\u{1F4CD} Location",
                    $("div", { style: { display: "flex", gap: 3, flexWrap: "wrap", marginTop: 2 } },
                      locations.map(function(loc) {
                        var isOn = curLocation.indexOf(loc.id) !== -1;
                        return $("button", {
                          key: loc.id,
                          onClick: function() {
                            var nl = curLocation.slice();
                            if (isOn) { nl = nl.filter(function(x) { return x !== loc.id; }); }
                            else { nl.push(loc.id); }
                            setPE("location", nl);
                          },
                          style: { padding: "3px 6px", borderRadius: 5, border: isOn ? "2px solid " + TH.accent : "1px solid " + TH.btnBorder, background: isOn ? TH.blueBg : TH.bgCard, fontSize: 10, cursor: "pointer", fontWeight: isOn ? 600 : 400 }
                        }, loc.icon + " " + loc.name);
                      })
                    ),
                    curLocation.length === 0 ? $("div", { style: { fontSize: 9, color: TH.muted2, marginTop: 1 } }, "No selection = anywhere") : null
                  ),
                  $("label", { style: lStyle },
                    "\u{1F527} Tools needed",
                    $("div", { style: { display: "flex", gap: 3, flexWrap: "wrap", marginTop: 2 } },
                      tools.map(function(tool) {
                        var isOn = curTools.indexOf(tool.id) !== -1;
                        return $("button", {
                          key: tool.id,
                          onClick: function() {
                            var nt = curTools.slice();
                            if (isOn) { nt = nt.filter(function(x) { return x !== tool.id; }); }
                            else { nt.push(tool.id); }
                            setPE("tools", nt);
                          },
                          style: { padding: "3px 6px", borderRadius: 5, border: isOn ? "2px solid " + TH.accent : "1px solid " + TH.btnBorder, background: isOn ? TH.blueBg : TH.bgCard, fontSize: 10, cursor: "pointer", fontWeight: isOn ? 600 : 400 }
                        }, tool.icon + " " + tool.name);
                      })
                    )
                  ),
                  $("label", { style: lStyle },
                    "\u{1F4C6} When",
                    $("div", { style: { display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 } },
                      uniqueTags.concat([{tag: "fixed", name: "Fixed", icon: "\u{1F4CC}", color: TH.muted2}]).map(function(tb) {
                        var val = tb.tag, lbl = (tb.icon || "") + " " + tb.name;
                        var parts = parseWhen(curWhen);
                        var isOn = parts.indexOf(val) !== -1;
                        return $("button", {
                          key: val,
                          onClick: function() {
                            var cur = parseWhen(curWhen).filter(function(v) { return v !== "anytime"; });
                            if (isOn) {
                              cur = cur.filter(function(v) { return v !== val; });
                            } else {
                              cur.push(val);
                            }
                            setPE("when", cur.length === 0 ? "anytime" : cur.join(","));
                          },
                          style: { padding: "4px 8px", borderRadius: 6, border: isOn ? "2px solid " + (tb.color || "#2563EB") : "1px solid " + TH.btnBorder, background: isOn ? (tb.color || TH.accent) + "22" : TH.bgCard, fontSize: 12, cursor: "pointer", fontWeight: isOn ? 600 : 400, color: isOn ? tb.color || TH.accent : TH.text }
                        }, lbl);
                      })
                    ),
                    curWhen === "anytime" ? $("div", { style: { fontSize: 11, color: TH.muted2, marginTop: 2 } }, "No selection = anytime") : null
                  )
                ),
                // ── Dependencies section ──
                (function() { console.log("[EXPAND] rendering deps for " + t.id); return null; })(),
                $("div", { style: { marginBottom: 5 } },
                  $("label", { style: lStyle },
                    "\u{1F517} Dependencies (must complete first)",
                    (() => {
                      var curDeps = pe.dependsOn !== undefined ? pe.dependsOn : (t.dependsOn || []);
                      if (typeof curDeps === "string") curDeps = curDeps ? [curDeps] : [];
                      // Show current deps as removable chips
                      var depChips = curDeps.map(function(depId) {
                        var depTask = allTasks.find(function(x) { return x.id === depId; });
                        var label = depTask ? depTask.text.substring(0, 30) + " (" + depId + ")" : depId;
                        var depSt = statuses[depId] || "";
                        var isDone = depSt === "done";
                        return $("span", {
                          key: depId,
                          style: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, padding: "2px 6px", borderRadius: 4, background: isDone ? TH.greenBg : TH.amberBg, color: isDone ? TH.greenText : TH.amberText, fontWeight: 500, marginTop: 3 }
                        },
                          isDone ? "\u2713 " : "\u23F3 ",
                          label,
                          $("button", {
                            onClick: function(e) {
                              e.stopPropagation();
                              var nd = curDeps.filter(function(x) { return x !== depId; });
                              setPE("dependsOn", nd);
                            },
                            style: { fontSize: 10, background: "none", border: "none", color: TH.redText, cursor: "pointer", padding: 0, fontWeight: 700, marginLeft: 2 }
                          }, "\u2715")
                        );
                      });
                      // Add dep button + mini search
                      return $("div", null,
                        $("div", { style: { display: "flex", gap: 3, flexWrap: "wrap" } }, depChips),
                        curDeps.length === 0 && $("div", { style: { fontSize: 9, color: TH.textDim, marginTop: 2 } }, "No dependencies"),
                        $("div", { style: { display: "flex", gap: 3, marginTop: 4, alignItems: "center" } },
                          $("input", {
                            type: "text",
                            placeholder: "Type task ID or name to add dep...",
                            onClick: function(e) { e.stopPropagation(); },
                            onKeyDown: function(e) {
                              if (e.key === "Enter") {
                                e.stopPropagation();
                                var val = e.target.value.trim().toLowerCase();
                                if (!val) return;
                                // Find by ID or partial text match
                                var match = allTasks.find(function(x) {
                                  return x.id.toLowerCase() === val || x.text.toLowerCase().includes(val);
                                });
                                if (match && match.id !== t.id && curDeps.indexOf(match.id) === -1) {
                                  setPE("dependsOn", curDeps.concat([match.id]));
                                  e.target.value = "";
                                }
                              }
                            },
                            style: Object.assign({}, iStyle, { flex: 1, minWidth: 120 })
                          }),
                          $("span", { style: { fontSize: 8, color: TH.textDim } }, "Enter to add")
                        )
                      );
                    })()
                  )
                ),
                // ── Recurrence section ──
                $("div", { style: { marginBottom: 5 } },
                  $("label", { style: lStyle },
                    "\u{1F501} Recurrence",
                    (() => {
                      var curRecur = pe.recur !== undefined ? pe.recur : (t.recur || null);
                      var rType = curRecur ? curRecur.type : "none";
                      var rDays = curRecur ? (curRecur.days || "") : "";
                      var rEvery = curRecur ? (curRecur.every || 2) : 2;
                      var RTYPES = [
                        { v: "none", l: "None" }, { v: "daily", l: "Daily" },
                        { v: "weekly", l: "Weekly" }, { v: "biweekly", l: "Biweekly" },
                        { v: "interval", l: "Every N days" },
                      ];
                      var DAY_CODES = [
                        { c: "U", l: "Su" }, { c: "M", l: "Mo" }, { c: "T", l: "Tu" },
                        { c: "W", l: "We" }, { c: "R", l: "Th" }, { c: "F", l: "Fr" }, { c: "S", l: "Sa" },
                      ];
                      return $("div", { style: { marginTop: 3 } },
                        $("div", { style: { display: "flex", gap: 3, flexWrap: "wrap" } },
                          RTYPES.map(function(rt) {
                            var isOn = rType === rt.v;
                            return $("button", {
                              key: rt.v,
                              onClick: function() {
                                if (rt.v === "none") { setPE("recur", null); }
                                else { setPE("recur", { type: rt.v, days: rDays || "MTWRF", every: rEvery }); }
                              },
                              style: { padding: "3px 7px", borderRadius: 4, border: isOn ? "2px solid " + TH.greenBorder : "1px solid " + TH.btnBorder, background: isOn ? TH.greenBg : TH.inputBg, fontSize: 10, cursor: "pointer", fontWeight: isOn ? 700 : 400, color: isOn ? TH.greenText : TH.textMuted }
                            }, rt.l);
                          })
                        ),
                        (rType === "weekly" || rType === "biweekly") && $("div", { style: { display: "flex", gap: 2, marginTop: 4 } },
                          DAY_CODES.map(function(dc) {
                            var isOn = rDays.indexOf(dc.c) !== -1;
                            return $("button", {
                              key: dc.c,
                              onClick: function() {
                                var nd = isOn ? rDays.replace(dc.c, "") : rDays + dc.c;
                                setPE("recur", { type: rType, days: nd, every: rEvery });
                              },
                              style: { width: 28, height: 24, borderRadius: 4, border: isOn ? "2px solid " + TH.accent : "1px solid " + TH.btnBorder, background: isOn ? TH.blueBg : TH.inputBg, fontSize: 9, cursor: "pointer", fontWeight: isOn ? 700 : 400, color: isOn ? TH.blueText : TH.textDim, padding: 0 }
                            }, dc.l);
                          })
                        ),
                        rType === "interval" && $("div", { style: { display: "flex", gap: 4, marginTop: 4, alignItems: "center" } },
                          $("span", { style: { fontSize: 10, color: TH.textMuted } }, "Every"),
                          $("input", {
                            type: "number", min: 2, max: 90, value: rEvery,
                            onClick: function(e) { e.stopPropagation(); },
                            onChange: function(e) { setPE("recur", { type: "interval", days: "", every: parseInt(e.target.value) || 2 }); },
                            style: Object.assign({}, iStyle, { width: 50 })
                          }),
                          $("span", { style: { fontSize: 10, color: TH.textMuted } }, "days")
                        ),
                        curRecur && $("div", { style: { fontSize: 9, color: "#059669", marginTop: 3, fontWeight: 600 } },
                          "\u{1F501} Will generate instances when you click \u201cGenerate Recurring\u201d in the menu"
                        )
                      );
                    })()
                  )
                ),
              );
            })()}
            {/* Notes — editable */}
            {isExpanded && (() => {
              var pe2 = (pendingEdits && pendingEdits.id === t.id) ? pendingEdits.fields : {};
              var noteVal = pe2.notes !== undefined ? pe2.notes : (t.notes || "");
              return $("div", { style: { marginBottom: 3 } },
                $("div", { style: { fontSize: 8, color: TH.textMuted, fontWeight: 600, marginBottom: 2 } }, "Notes"),
                $("textarea", {
                  value: noteVal,
                  onChange: function(e) {
                    var nf = Object.assign({}, pe2); nf.notes = e.target.value;
                    setPendingEdits({ id: t.id, fields: nf });
                  },
                  onClick: function(e) { e.stopPropagation(); },
                  onMouseDown: function(e) { e.stopPropagation(); },
                  onFocus: function(e) { e.stopPropagation(); },
                  rows: Math.max(2, (noteVal.match(/\n/g) || []).length + 1),
                  style: { fontSize: 10, width: "100%", padding: 4, border: "1px solid " + TH.btnBorder, borderRadius: 4, background: TH.inputBg, color: TH.inputText, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }
                })
              );
            })()}
            {blocked && <div style={{ fontSize: 10, color: "#9A3412", fontWeight: 600, marginTop: 2, marginBottom: 3, background: "#FED7AA", padding: "2px 5px", borderRadius: 3, display: "inline-block" }}>{pastWindowsProp ? "\u23F0 All time windows have passed — run Reschedule to move to next available day" : "\u{1F6AB} Can't do here — need " + migrateTask(t).location.join(" or ") + ", you're at " + getLocationForDate(dateStr).name}</div>}
            {/* Dependency chain info */}
            {isExpanded && (() => {
              var deps = getTaskDeps(t);
              var dependents = dependentsMap[t.id] || [];
              if (deps.length === 0 && dependents.length === 0) return null;
              return $("div", { style: { fontSize: 9, marginBottom: 3, padding: "3px 5px", background: TH.blueBg, borderRadius: 3, border: "1px solid #BAE6FD" } },
                $("button", { onClick: function(e) { e.stopPropagation(); setChainPopupId(chainPopupId === t.id ? null : t.id); }, title: "Show full dependency chain", style: { fontSize: 8, padding: "1px 5px", borderRadius: 3, border: "1px solid #0EA5E9", background: chainPopupId === t.id ? "#0EA5E9" : TH.blueBg, color: chainPopupId === t.id ? "white" : "#0369A1", cursor: "pointer", fontWeight: 600, float: "right" } }, chainPopupId === t.id ? "Close Chain" : "Show Chain"),
                deps.length > 0 && $("div", { style: { color: TH.blueText, marginBottom: 2 } },
                  "\u{1F517} Depends on: ",
                  deps.map(function(depId, i) {
                    var dt = allTasks.find(function(x) { return x.id === depId; });
                    var st2 = statuses[depId] || "";
                    var isDone = st2 === "done";
                    return $("span", { key: depId },
                      i > 0 ? ", " : "",
                      $("span", { style: { fontWeight: 600, color: isDone ? TH.greenText : TH.amberText, textDecoration: isDone ? "line-through" : "none" } },
                        (isDone ? "\u2713 " : "\u23F3 ") + (dt ? dt.text.substring(0, 25) : depId)
                      )
                    );
                  })
                ),
                dependents.length > 0 && $("div", { style: { color: TH.blueText } },
                  "\u{1F517}\u2192 Blocks: ",
                  dependents.map(function(dt, i) {
                    return $("span", { key: dt.id },
                      i > 0 ? ", " : "",
                      $("span", { style: { fontWeight: 600 } }, dt.text.substring(0, 25))
                    );
                  })
                )
              );
            })()}
            {/* Direction input for "other" status */}
            {st === "other" && (
              <div style={{ marginBottom: 4 }}>
                <input
                  type="text"
                  placeholder="What should happen instead?"
                  value={directions[t.id] || ""}
                  onChange={e => changeDirection(t.id, e.target.value)}
                  style={{
                    width: "100%", fontSize: 10, padding: "4px 6px",
                    border: "1px solid #7C3AED44", borderRadius: 3,
                    background: TH.settingsBg, color: "#3B0764", outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
            )}
            {/* Task-specific AI command */}
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <input
                type="text"
                ref={taskAiRef}
                placeholder={"AI: e.g. 'move to Thursday 2pm' or 'split into 2 tasks'"}
                defaultValue=""
                onClick={e => e.stopPropagation()}
                onFocus={e => e.stopPropagation()}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === "Enter" && taskAiRef.current && taskAiRef.current.value.trim()) {
                    e.preventDefault();
                    var cmd = "For task " + t.id + " (" + t.text + "): " + taskAiRef.current.value;
                    taskAiRef.current.value = "";
                    setShowAi(true);
                    handleAiCmd(cmd);
                  }
                }}
                autoComplete="off"
                autoCorrect="off"
                style={{
                  flex: 1, fontSize: 16, padding: "8px 10px",
                  border: "1px solid #3B82F644", borderRadius: 6,
                  background: "#EFF6FF", color: TH.text, outline: "none",
                  WebkitAppearance: "none", minHeight: 44,
                }}
              />
              <button onClick={e => {
                e.stopPropagation();
                if (taskAiRef.current && taskAiRef.current.value.trim()) {
                  var cmd = "For task " + t.id + " (" + t.text + "): " + taskAiRef.current.value;
                  taskAiRef.current.value = "";
                  setShowAi(true);
                  handleAiCmd(cmd);
                }
              }} style={{
                fontSize: 14, padding: "8px 12px", border: "none", borderRadius: 6,
                background: "#3B82F6", color: "white", cursor: "pointer", fontWeight: 600, flexShrink: 0, minHeight: 44,
              }}>{"\u{1F916}"}</button>
            </div>
            <div style={{ fontSize: 9, color: TH.textDim, marginTop: 3 }}>ID: {t.id} · {t.project}</div>
          </div>
        )}
      </div>
    );
    } catch(cardErr) {
      console.error("TaskCard crash for", t.id, cardErr);
      return <div style={{ padding: 4, fontSize: 10, color: "#DC2626", background: "#FEE2E2", borderRadius: 4, marginBottom: 2 }}>
        ⚠ Error rendering {t.id}: {t.text?.substring(0, 30)}... <button onClick={(e) => { e.stopPropagation(); ctxRef.current.setExpandedTask(null); }} style={{ fontSize: 9, marginLeft: 4, cursor: "pointer" }}>Reset</button>
      </div>;
    }
  };
  } // end lazy init
  const TaskCard = taskCardRef.current;

  // HOUR GRID CONFIG
  const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6 AM to 11 PM

  // formatHour — moved to module level

  const getHourMeta = (h, dow, locInfo, dk) => {
    // Find which block this hour falls in
    var min = h * 60;
    var block = getBlockAtMinute(selectedDayBlocks, min);
    var fr = "", ic = "", cl = TH.textDim, ll = "";
    if (block) {
      fr = block.name;
      ic = block.icon || "";
      cl = block.color || TH.textDim;
    } else {
      fr = "—";  // gap / dead time
      cl = TH.textDim;
    }
    // Location label from per-hour system
    var hourLocId = getLocationForHour(dk, h);
    var hourLocObj = getLocObj(hourLocId, locations);
    ll = hourLocObj.icon + " " + hourLocObj.name;
    return { fr: fr, ic: ic, cl: cl, ll: ll };
  };

  // ── Constants for time grid ──
  // ── Grid zoom: PX_PER_HOUR scales with interval ──
  // 60 min = 48px/hr (compact), 45 = 64, 30 = 96, 15 = 192 (detailed)
  var ZOOM_MAP = { 15: 192, 30: 96, 45: 64, 60: 48 };
  var PX_PER_HOUR = ZOOM_MAP[gridZoom] || 64;
  var PX_PER_MIN = PX_PER_HOUR / 60;
  // GRID_START, GRID_END, GRID_HOURS_COUNT — moved to module level

  // ── Schedule tasks for a day — lookup from unified scheduler + fill unscheduled ──
  function scheduleDayTasksFn(tasks, dateKey) {
    var placements = schedResultRef.current.dayPlacements[dateKey] || [];
    var placedIds = {};
    placements.forEach(function(p) { placedIds[p.task.id] = true; });
    // Build set of unplaced task IDs — scheduler deliberately excluded these
    var unplacedIds = {};
    (schedResultRef.current.unplaced || []).forEach(function(t) { unplacedIds[t.id] = true; });
    // Only add extras for tasks NOT handled by the scheduler at all
    // (done/cancelled tasks with a set time, or tasks the scheduler doesn't know about)
    var extras = [];
    tasks.forEach(function(t) {
      if (placedIds[t.id]) return; // scheduler placed it
      if (unplacedIds[t.id]) return; // scheduler intentionally excluded it
      // Check if scheduler processed this task (it's in taskUpdates or was in pool)
      if (schedResultRef.current.taskUpdates && schedResultRef.current.taskUpdates[t.id]) return; // scheduler moved it elsewhere
      var st = statuses[t.id] || "";
      // Only render done/cancelled/skip tasks at their original time as faded items
      if (st === "done" || st === "cancel" || st === "skip") {
        var sm = parseTimeToMinutes(t.time);
        if (sm !== null) {
          extras.push({ task: t, start: sm, dur: Math.min(t.dur || 30, 720), locked: false, col: 0, cols: 1, key: t.id });
        }
        return;
      }
      // Fixed tasks that didn't get placed (no time set) — skip, don't dump at 8 AM
      var sm = parseTimeToMinutes(t.time);
      if (sm !== null) {
        extras.push({ task: t, start: sm, dur: Math.min(t.dur || 30, 720), locked: false, col: 0, cols: 1, key: t.id });
      }
      // If no time — DON'T default to 8 AM. Just don't show it.
    });
    return placements.concat(extras);
  }

  // ── Export to .ics ──
  var exportICS = function() {
    var dk = formatDateKey(selectedDate);
    var dayTasks = (tasksByDate[dk] || []).filter(filterTask);
    var yr = selectedDate.getFullYear();
    var mo = String(selectedDate.getMonth() + 1).padStart(2, "0");
    var dy = String(selectedDate.getDate()).padStart(2, "0");
    var now = new Date();
    var stamp = now.getFullYear() + String(now.getMonth()+1).padStart(2,"0") + String(now.getDate()).padStart(2,"0") + "T" + String(now.getHours()).padStart(2,"0") + String(now.getMinutes()).padStart(2,"0") + String(now.getSeconds()).padStart(2,"0");
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TaskTracker//v7.9//EN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Task Tracker",
    ];
    dayTasks.forEach(function(t) {
      var sm = parseTimeToMinutes(t.time);
      if (sm === null) return;
      var hh = String(Math.floor(sm / 60)).padStart(2, "0");
      var mm = String(sm % 60).padStart(2, "0");
      var dur = t.dur || 30;
      var ehh = String(Math.floor((sm + dur) / 60)).padStart(2, "0");
      var emm = String((sm + dur) % 60).padStart(2, "0");
      var st = statuses[t.id] || "";
      var icsStatus = st === "done" ? "CONFIRMED" : st === "cancel" || st === "skip" ? "CANCELLED" : "TENTATIVE";
      // Escape ICS text: fold commas, semicolons, backslashes, newlines
      var esc = function(s) { return (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); };
      // Build description
      var desc = [];
      if (t.project) desc.push("Project: " + t.project);
      if (t.pri) desc.push("Priority: " + t.pri);
      if (t.habit) desc.push("Type: Habit");
      if (t.notes) desc.push("Notes: " + t.notes);
      if (t.dependsOn && Array.isArray(t.dependsOn) && t.dependsOn.length > 0) desc.push("Depends on: " + t.dependsOn.join(", "));
      // Location
      var locName = "";
      if (t.where && t.where !== "anywhere") {
        var locObj = getLocObj(t.where, locations);
        locName = locObj ? locObj.name : t.where;
      }
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + t.id + "-" + yr + mo + dy + "@tasktracker");
      lines.push("DTSTAMP:" + stamp);
      lines.push("SEQUENCE:" + Math.floor(now.getTime() / 60000)); // increases on each export
      lines.push("DTSTART:" + yr + mo + dy + "T" + hh + mm + "00");
      lines.push("DTEND:" + yr + mo + dy + "T" + ehh + emm + "00");
      lines.push("SUMMARY:" + esc(t.text));
      if (desc.length > 0) lines.push("DESCRIPTION:" + esc(desc.join("\\n")));
      if (locName) lines.push("LOCATION:" + esc(locName));
      lines.push("STATUS:" + icsStatus);
      if (t.due) lines.push("X-TASK-DUE:" + t.due);
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    var blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url;
    a.download = "tasks_" + dk.replace(/\//g, "-") + ".ics";
    a.click(); URL.revokeObjectURL(url);
    showToast("Exported " + dayTasks.filter(function(t) { return parseTimeToMinutes(t.time) !== null; }).length + " events to .ics", "success");
  };

  // ── Sync to Google Calendar via Anthropic API + MCP ──
  var openGcalSync = function() {
    var dk = formatDateKey(selectedDate);
    var dayTasks = (tasksByDate[dk] || []).filter(filterTask).filter(function(t) {
      var st = statuses[t.id] || "";
      return st !== "done" && st !== "cancel" && st !== "skip";
    });
    var sel = {};
    dayTasks.forEach(function(t) { if (parseTimeToMinutes(t.time) !== null) sel[t.id] = true; });
    setGcalSyncSel(sel);
    setGcalTab("push");
    setGcalEvents([]);
    setGcalImportSel({});
    setGcalSyncOpen(true);
  };

  var syncToGCal = async function() {
    var ids = Object.keys(gcalSyncSel).filter(function(k) { return gcalSyncSel[k]; });
    if (ids.length === 0) { showToast("No tasks selected", "error"); return; }
    setGcalSyncing(true);
    var tasks = allTasks.filter(function(t) { return gcalSyncSel[t.id]; });
    var gcalUpdates = {};

    try {
      // Build a single batched instruction for all tasks
      var instructions = tasks.map(function(t) {
        var sm = parseTimeToMinutes(t.time);
        if (sm === null) sm = 540;
        var dur = t.dur || 30;
        var td = parseDate(t.date);
        if (!td) { td = new Date(); td.setHours(0,0,0,0); }
        var yr = td.getFullYear(), mo = String(td.getMonth()+1).padStart(2,"0"), dy = String(td.getDate()).padStart(2,"0");
        var hh = String(Math.floor(sm/60)).padStart(2,"0"), mm = String(sm%60).padStart(2,"0");
        var em = sm + dur, ehh = String(Math.floor(em/60)).padStart(2,"0"), emm = String(em%60).padStart(2,"0");
        var desc = [t.pri, t.project ? "Project: " + t.project : "", t.notes].filter(Boolean).join(" | ");
        var dateTime = yr+"-"+mo+"-"+dy;
        return {
          taskId: t.id,
          action: t.gcalEventId ? "update" : "create",
          eventId: t.gcalEventId || null,
          summary: t.text,
          start: dateTime + "T" + hh + ":" + mm + ":00",
          end: dateTime + "T" + ehh + ":" + emm + ":00",
          description: desc,
        };
      });

      var prompt = "Process these Google Calendar operations on primary calendar (timezone America/New_York, sendUpdates=none). Do them ALL in sequence:\n\n" +
        JSON.stringify(instructions, null, 2) +
        "\n\nFor each operation: if action is 'create', create a new event. If 'update', update the event with the given eventId. " +
        "After ALL operations are complete, output a JSON summary line: RESULTS:" + JSON.stringify("[]") + " but with the actual array of {taskId, eventId} for each processed event.";

      var response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{ role: "user", content: prompt }],
          mcp_servers: [{ type: "url", url: "https://gcal.mcp.claude.com/mcp", name: "google-calendar" }]
        })
      });
      var data = await response.json();

      // Extract event IDs from tool results and text
      var toolResults = [];
      var textBlocks = [];
      (data.content || []).forEach(function(block) {
        if (block.type === "mcp_tool_result") {
          var txt = (block.content && block.content[0] && block.content[0].text) || "";
          toolResults.push(txt);
        }
        if (block.type === "text") textBlocks.push(block.text);
      });

      // Strategy 1: Parse RESULTS: JSON line from text
      var allText = textBlocks.join("\n");
      var resultsMatch = allText.match(/RESULTS:\s*(\[[\s\S]*?\])/);
      if (resultsMatch) {
        try {
          var results = JSON.parse(resultsMatch[1]);
          results.forEach(function(r) { if (r.taskId && r.eventId) gcalUpdates[r.taskId] = r.eventId; });
        } catch(e) {}
      }

      // Strategy 2: Extract event IDs from tool result JSON, match by order
      if (Object.keys(gcalUpdates).length < tasks.length) {
        var resultIds = [];
        toolResults.forEach(function(txt) {
          try {
            var p = JSON.parse(txt);
            if (p.id) resultIds.push(p.id);
          } catch(e) {
            var m = txt.match(/"id"\s*:\s*"([^"]+)"/);
            if (m) resultIds.push(m[1]);
          }
        });
        // Match by order — tool results come back in order of operations
        for (var ri = 0; ri < Math.min(resultIds.length, tasks.length); ri++) {
          if (!gcalUpdates[tasks[ri].id]) gcalUpdates[tasks[ri].id] = resultIds[ri];
        }
      }

      // Strategy 3: Look for JSON arrays in text blocks
      if (Object.keys(gcalUpdates).length < tasks.length) {
        textBlocks.forEach(function(txt) {
          var m = txt.match(/\[[\s\S]*?\]/g);
          if (m) m.forEach(function(chunk) {
            try {
              var arr = JSON.parse(chunk);
              if (Array.isArray(arr)) arr.forEach(function(r) {
                if (r.taskId && r.eventId) gcalUpdates[r.taskId] = r.eventId;
              });
            } catch(e) {}
          });
        });
      }

      var synced = Object.keys(gcalUpdates).length;
      // For updates without new IDs, count them as synced
      tasks.forEach(function(t) { if (t.gcalEventId && !gcalUpdates[t.id]) synced++; });
      var errors = tasks.length - synced;

      if (Object.keys(gcalUpdates).length > 0) {
        setExtraTasks(function(prev) {
          var updated = prev.map(function(t) {
            return gcalUpdates[t.id] ? Object.assign({}, t, { gcalEventId: gcalUpdates[t.id] }) : t;
          });
          persistAll(statuses, directions, updated);
          return updated;
        });
      }

      showToast("GCal: " + synced + " synced" + (errors > 0 ? ", " + errors + " failed" : ""), synced > 0 ? "success" : "error");
      if (errors === 0) setGcalSyncOpen(false);
    } catch(err) {
      console.error("GCal batch sync error:", err);
      showToast("GCal sync failed: " + err.message, "error");
    }
    setGcalSyncing(false);
  };

  // ── Pull events from Google Calendar ──
  var pullFromGCal = async function() {
    setGcalFetching(true);
    setGcalEvents([]);
    setGcalImportSel({});
    try {
      var td = new Date(selectedDate);
      var yr = td.getFullYear(), mo = String(td.getMonth()+1).padStart(2,"0"), dy = String(td.getDate()).padStart(2,"0");
      var timeMin = yr+"-"+mo+"-"+dy+"T00:00:00";
      var timeMax = yr+"-"+mo+"-"+dy+"T23:59:59";
      var prompt = 'List all events on my primary Google Calendar between ' + timeMin + ' and ' + timeMax + ' (timezone America/New_York). Return ALL events with their id, summary, start time, end time, and description. Use condensed format.';
      var response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: "You are a calendar assistant. When returning event data, always output a JSON array of events with fields: id, summary, startMin (minutes from midnight), endMin (minutes from midnight), description. Output ONLY the JSON array, no other text.",
          messages: [{ role: "user", content: prompt }],
          mcp_servers: [{ type: "url", url: "https://gcal.mcp.claude.com/mcp", name: "google-calendar" }]
        })
      });
      var data = await response.json();

      // Extract events from response
      var events = [];
      (data.content || []).forEach(function(block) {
        var txt = block.type === "text" ? block.text : (block.type === "mcp_tool_result" && block.content && block.content[0]) ? block.content[0].text : "";
        if (!txt) return;
        // Try to parse as JSON array
        try {
          var parsed = JSON.parse(txt);
          if (Array.isArray(parsed)) { events = events.concat(parsed); return; }
          if (parsed.events && Array.isArray(parsed.events)) { events = events.concat(parsed.events); return; }
        } catch(e) {}
        // Try to extract JSON array from text
        var m = txt.match(/\[[\s\S]*\]/);
        if (m) { try { events = events.concat(JSON.parse(m[0])); } catch(e) {} }
      });

      // Also try parsing event data from tool results that return calendar event format
      (data.content || []).forEach(function(block) {
        if (block.type !== "mcp_tool_result") return;
        var txt = (block.content && block.content[0] && block.content[0].text) || "";
        try {
          var p = JSON.parse(txt);
          // gcal_list_events returns {events: [...]}
          if (p.events && Array.isArray(p.events)) {
            p.events.forEach(function(ev) {
              if (!ev.summary) return;
              var sm = 0, em = 30;
              if (ev.start) {
                var sdt = ev.start.dateTime || ev.start.date;
                if (sdt && sdt.includes("T")) { var sp = sdt.split("T")[1]; sm = parseInt(sp.split(":")[0]) * 60 + parseInt(sp.split(":")[1]); }
              }
              if (ev.end) {
                var edt = ev.end.dateTime || ev.end.date;
                if (edt && edt.includes("T")) { var ep = edt.split("T")[1]; em = parseInt(ep.split(":")[0]) * 60 + parseInt(ep.split(":")[1]); }
              }
              events.push({ id: ev.id, summary: ev.summary, startMin: sm, endMin: em, description: ev.description || "" });
            });
          }
        } catch(e) {}
      });

      // Deduplicate by id
      var seen = {};
      events = events.filter(function(ev) {
        if (!ev.id || seen[ev.id]) return false;
        seen[ev.id] = true;
        return true;
      });

      // Mark which events already exist as tasks
      var existingEventIds = {};
      allTasks.forEach(function(t) { if (t.gcalEventId) existingEventIds[t.gcalEventId] = t.id; });
      events.forEach(function(ev) { ev.existingTaskId = existingEventIds[ev.id] || null; });

      setGcalEvents(events);
      // Pre-select events that aren't already imported
      var sel = {};
      events.forEach(function(ev) { if (!ev.existingTaskId) sel[ev.id] = true; });
      setGcalImportSel(sel);

      if (events.length === 0) showToast("No events found on GCal for this day", "info");
    } catch(err) {
      console.error("GCal pull error:", err);
      showToast("GCal pull failed: " + err.message, "error");
    }
    setGcalFetching(false);
  };

  // ── Import selected GCal events as tasks ──
  var importFromGCal = function() {
    var toImport = gcalEvents.filter(function(ev) { return gcalImportSel[ev.id] && !ev.existingTaskId; });
    if (toImport.length === 0) { showToast("No new events selected", "error"); return; }
    var dk = formatDateKey(selectedDate);
    var dayName = ["Su","M","T","W","R","F","Sa"][selectedDate.getDay()];
    var maxId = 0;
    allTasks.forEach(function(t) { var n = parseInt(t.id.replace(/\D/g, "")); if (n > maxId) maxId = n; });

    var newTasks = toImport.map(function(ev, i) {
      var id = "t" + String(maxId + 1 + i).padStart(2, "0");
      var sm = ev.startMin || 0;
      var em = ev.endMin || (sm + 30);
      var dur = Math.max(em - sm, 15);
      var hh = Math.floor(sm / 60), mm = sm % 60;
      var ap = hh >= 12 ? "PM" : "AM";
      var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
      var timeStr = dh + ":" + String(mm).padStart(2, "0") + " " + ap;
      return {
        id: id, text: ev.summary || "GCal Event", date: dk, day: dayName,
        time: timeStr, dur: dur, pri: "P3", when: "fixed",
        notes: ev.description || "", gcalEventId: ev.id,
      };
    });

    setExtraTasks(function(prev) {
      var updated = prev.concat(newTasks);
      persistAll(statuses, directions, updated);
      return updated;
    });
    showToast("Imported " + newTasks.length + " events from GCal", "success");
    setGcalSyncOpen(false);
  };

  // ── Conflicts View ──
  // Shared drag-drop handler for grid views (Day, 3-Day, Week)
  var handleGridDrop = function(e, targetDateKey) {
    e.preventDefault();
    var taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    var rect = e.currentTarget.getBoundingClientRect();
    var yPx = e.clientY - rect.top;
    var totalMin = GRID_START * 60 + yPx / PX_PER_MIN;
    totalMin = Math.round(totalMin / 5) * 5;
    var hr = Math.floor(totalMin / 60);
    var mn = totalMin % 60;
    var ap = hr >= 12 ? "PM" : "AM";
    var h12 = hr > 12 ? hr - 12 : (hr === 0 ? 12 : hr);
    var newTime = h12 + ":" + (mn < 10 ? "0" : "") + mn + " " + ap;
    var fields = { time: newTime };
    // If target date differs from task's current date, update date too
    var task = allTasks.find(function(t) { return t.id === taskId; });
    if (task && task.date !== targetDateKey) {
      fields.date = targetDateKey;
      var dd = parseDate(targetDateKey);
      if (dd) fields.day = DAY_NAMES[dd.getDay()];
    }
    dispatchPersist({ type: 'UPDATE_TASK', id: taskId, fields: fields }, "drag " + taskId);
    var fl = {}; fl[taskId] = "saved"; setSavedFlash(fl); setTimeout(function() { setSavedFlash({}); }, 1000);
  };

  // Shared date-only drop handler for Month view
  var handleDateDrop = function(e, targetDateKey) {
    e.preventDefault();
    var taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    var task = allTasks.find(function(t) { return t.id === taskId; });
    if (!task || task.date === targetDateKey) return;
    var dd = parseDate(targetDateKey);
    var fields = { date: targetDateKey };
    if (dd) fields.day = DAY_NAMES[dd.getDay()];
    dispatchPersist({ type: 'UPDATE_TASK', id: taskId, fields: fields }, "drag " + taskId);
    var fl = {}; fl[taskId] = "saved"; setSavedFlash(fl); setTimeout(function() { setSavedFlash({}); }, 1000);
  };

  // PRIORITY BOARD VIEW — drag-and-drop chips
  const PriorityView = () => {
    var cols = [
      { pri: "P1", label: "P1 Critical", color: "#DC2626", bg: darkMode ? "#450A0A" : "#FEE2E2", bd: darkMode ? "#7F1D1D" : "#FECACA" },
      { pri: "P2", label: "P2 High", color: "#D97706", bg: darkMode ? "#422006" : "#FEF3C7", bd: darkMode ? "#78350F" : "#FDE68A" },
      { pri: "P3", label: "P3 Medium", color: "#2563EB", bg: darkMode ? "#1E3A5F" : "#DBEAFE", bd: darkMode ? "#1E40AF" : "#93C5FD" },
      { pri: "P4", label: "P4 Low", color: "#6B7280", bg: darkMode ? "#1F2937" : "#F3F4F6", bd: darkMode ? "#374151" : "#D1D5DB" },
    ];
    // Only show open/wip tasks, not habits (habits repeat daily — clutters the board)
    // Also apply search/filter from the toolbar
    var openTasks = allTasks.filter(function(t) {
      if (t.habit) return false;
      var st = statuses[t.id] || "";
      if (!st || st === "wip" || st === "other") {
        // Apply search filter if active
        var searchLower = search.toLowerCase().trim();
        if (searchLower) {
          var hay = (t.project || "") + " " + (t.text || "") + " " + (t.notes || "") + " " + (t.id || "") + " " + (t.section || "");
          return hay.toLowerCase().indexOf(searchLower) >= 0;
        }
        return true;
      }
      return false;
    });

    function handleDrop(targetPri) {
      if (!priDrag || priDrag.fromPri === targetPri) { setPriDrag(null); setPriDragOver(null); return; }
      dispatchPersist({ type: 'UPDATE_TASK', id: priDrag.id, fields: { pri: targetPri } }, "priority " + priDrag.id + " → " + targetPri);
      setPriDrag(null); setPriDragOver(null);
      setTimeout(function() { try { autoRescheduleRef.current(); } catch(e) {} }, 100);
    }

    return (
      <div style={{ display: "flex", gap: 8, minHeight: 300 }}>
        {cols.map(function(col) {
          var tasks = openTasks.filter(function(t) { return (t.pri || "P3") === col.pri; });
          var isOver = priDragOver === col.pri;
          return (
            <div key={col.pri}
              onDragOver={function(e) { e.preventDefault(); setPriDragOver(col.pri); }}
              onDragLeave={function() { setPriDragOver(null); }}
              onDrop={function(e) { e.preventDefault(); handleDrop(col.pri); }}
              style={{
                flex: 1, minWidth: 0, background: isOver ? (col.bg) : TH.bgCard,
                border: "2px solid " + (isOver ? col.color : col.bd), borderRadius: 10,
                padding: 8, display: "flex", flexDirection: "column",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: col.color, marginBottom: 6, textAlign: "center", padding: "4px 0", borderBottom: "2px solid " + col.bd }}>
                {col.label} <span style={{ fontWeight: 400, color: TH.textMuted }}>({tasks.length})</span>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, overflowY: "auto", maxHeight: 500 }}>
                {tasks.map(function(t) {
                  var st = statuses[t.id] || "";
                  var isDragging = priDrag && priDrag.id === t.id;
                  var projMeta = getProjectMeta(t.project) || {};
                  return (
                    <div key={t.id}
                      draggable
                      onDragStart={function() { setPriDrag({ id: t.id, fromPri: col.pri }); }}
                      onDragEnd={function() { setPriDrag(null); setPriDragOver(null); }}
                      onClick={function() { if (t.date) { var td = parseDate(t.date); if (td) setDayOffset(Math.round((td - today) / 86400000)); } setViewMode("day"); setExpandedTask(t.id); }}
                      style={{
                        padding: "5px 8px", borderRadius: 6, fontSize: 10, cursor: "grab",
                        background: isDragging ? (col.color + "22") : TH.white,
                        border: "1px solid " + (isDragging ? col.color : TH.border),
                        opacity: isDragging ? 0.5 : 1,
                        lineHeight: "14px", position: "relative",
                      }}
                    >
                      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 2 }}>
                        {projMeta.icon && <span style={{ fontSize: 9 }}>{projMeta.icon}</span>}
                        <span style={{ fontSize: 8, color: projMeta.color || TH.textMuted, fontWeight: 600 }}>{t.project}</span>
                        {st === "wip" && <span style={{ fontSize: 7, background: "#FEF3C7", color: "#92400E", padding: "0 3px", borderRadius: 2, fontWeight: 700 }}>WIP</span>}
                        {t.due && <span style={{ fontSize: 7, color: TH.redText, fontWeight: 600 }}>📅{t.due}</span>}
                      </div>
                      <div style={{ color: TH.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 12 }}>{t.text}</div>
                      {t.dur && <span style={{ position: "absolute", top: 4, right: 6, fontSize: 7, color: TH.textDim }}>{t.dur}m</span>}
                    </div>
                  );
                })}
                {tasks.length === 0 && <div style={{ textAlign: "center", fontSize: 10, color: TH.textDim, padding: 12, fontStyle: "italic" }}>No tasks</div>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const ConflictsView = () => {
    var cList = [];
    var now = new Date(); now.setHours(0,0,0,0);
    allTasks.forEach(function(t) {
      var st = t.status || (statuses[t.id] || "");
      if (st === "done" || st === "cancel" || st === "skip") return;
      if (t.due) {
        var dd = parseDate(t.due);
        if (dd && dd < now) cList.push({ task: t, msg: "Past due: " + t.due, sev: "red" });
        else if (dd) {
          var days = Math.round((dd - now) / 86400000);
          if (days <= 1) cList.push({ task: t, msg: "Due " + (days === 0 ? "today" : "tomorrow"), sev: "amber" });
        }
      }
      if (t.date && t.date !== "TBD" && isTaskBlocked(t, t.date))
        cList.push({ task: t, msg: "Location blocked", sev: "orange" });
      if ((!t.date || t.date === "TBD") && (!t.section || !t.section.includes("PARKING")))
        cList.push({ task: t, msg: "No date assigned", sev: "grey" });
    });
    var sevOrder = { red: 0, orange: 1, amber: 2, grey: 3 };
    cList.sort(function(a, b) { return (sevOrder[a.sev] || 9) - (sevOrder[b.sev] || 9); });
    var sevC = darkMode
      ? { red: { bg: "#450A0A", bd: "#7F1D1D", tx: "#FCA5A5" }, orange: { bg: "#431407", bd: "#7C2D12", tx: "#FDBA74" }, amber: { bg: "#422006", bd: "#78350F", tx: "#FCD34D" }, grey: { bg: "#334155", bd: "#475569", tx: "#94A3B8" } }
      : { red: { bg: "#FEE2E2", bd: "#FECACA", tx: "#991B1B" }, orange: { bg: "#FFEDD5", bd: "#FED7AA", tx: "#9A3412" }, amber: { bg: "#FEF3C7", bd: "#FDE68A", tx: "#92400E" }, grey: { bg: "#F1F5F9", bd: "#E2E8F0", tx: "#64748B" } };
    return (
      <div style={{ background: TH.bgCard, borderRadius: 8, border: "1px solid " + TH.border, padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TH.text, marginBottom: 8 }}>
          \u26A0\uFE0F {cList.length} Conflicts & Warnings
        </div>
        {cList.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: TH.textDim, fontSize: 12 }}>\u2705 No conflicts!</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {cList.map(function(c, i) {
              var sc = sevC[c.sev] || sevC.grey;
              return (
                <div key={i} onClick={function() {
                  if (c.task.date) {
                    var td = parseDate(c.task.date);
                    if (td) setDayOffset(Math.round((td - today) / 86400000));
                  }
                  setExpandedTask(c.task.id);
                  setViewMode("day");
                }} style={{
                  padding: "4px 8px", borderRadius: 4, border: "1px solid " + sc.bd,
                  background: sc.bg, cursor: "pointer", display: "flex", gap: 6, alignItems: "center",
                }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: sc.tx, fontFamily: "monospace", minWidth: 40 }}>{c.task.id}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: TH.text, flex: 1 }}>{c.task.text.substring(0, 35)}</span>
                  <span style={{ fontSize: 9, color: sc.tx }}>{c.msg}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Multi-Day View (3-day) ──
  const MultiDayView = () => {
    var days = [];
    for (var d = -1; d <= 1; d++) {
      var dt = new Date(selectedDate);
      dt.setDate(dt.getDate() + d);
      days.push(dt);
    }
    var gridH = GRID_HOURS_COUNT * PX_PER_HOUR;
    return (
      <div style={{ background: TH.bgCard, borderRadius: 8, border: "1px solid " + TH.border, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "56px repeat(3, 1fr)", gap: 0 }}>
          {/* Hour gutter */}
          <div style={{ position: "relative", height: gridH, borderRight: "1px solid " + TH.border, background: TH.bgHover }}>
            {HOURS.map(function(h) {
              return (
                <div key={h} style={{
                  position: "absolute", top: (h - GRID_START) * PX_PER_HOUR, fontSize: 8, color: TH.textDim,
                  fontWeight: 600, padding: "0 4px", height: PX_PER_HOUR, borderBottom: "1px solid " + TH.borderLight,
                  width: "100%", boxSizing: "border-box",
                }}>{formatHour(h)}</div>
              );
            })}
          </div>
          {/* Day columns */}
          {days.map(function(dt, di) {
            var dk = formatDateKey(dt);
            var dayTasks = (tasksByDate[dk] || []).filter(filterTask);
            var positioned = scheduleDayTasksFn(dayTasks, dk);
            var isToday = isSameDay(dt, today);
            var loc = getLocationForDate(dk);
            var isAway = loc.id !== "home";
            return (
              <div key={di} style={{ position: "relative", height: gridH, borderRight: di < 2 ? "1px solid " + TH.border : "none" }}
                onDragOver={function(e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={function(e) { handleGridDrop(e, dk); }}>
                <div onClick={function() { setDayOffset(Math.round((dt - today) / 86400000)); setViewMode("day"); }}
                  style={{
                    position: "sticky", top: 0, zIndex: 20, padding: "2px 4px",
                    background: isToday ? TH.amberBg : isAway ? (darkMode ? "#431407" : "#FFEDD5") : TH.bgCard,
                    borderBottom: "1px solid " + TH.border, cursor: "pointer", textAlign: "center",
                  }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: isToday ? TH.amberText : TH.text }}>
                    {DAY_NAMES[dt.getDay()] + " " + dt.getDate()}
                  </div>
                  <div style={{ fontSize: 7, color: TH.textDim }}>{dayTasks.length}t {(() => {
                    var d2 = parseDate(dk);
                    var dn = d2 ? ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d2.getDay()] : "Mon";
                    var defaultTmplId = locScheduleDefaults[dn] || "weekday";
                    var overrideTmplId = locScheduleOverrides[dk];
                    var activeTmplId = overrideTmplId || defaultTmplId;
                    var activeTmpl = locSchedules[activeTmplId];
                    var isOv = !!overrideTmplId;
                    return <select value={activeTmplId} onClick={function(e) { e.stopPropagation(); }} onChange={function(e) {
                      e.stopPropagation();
                      var val = e.target.value;
                      if (val === "__reset__") {
                        setLocScheduleOverrides(function(prev) { var next = Object.assign({}, prev); delete next[dk]; return next; });
                        autoReschedule();
                      } else {
                        setLocScheduleOverrides(function(prev) { var next = Object.assign({}, prev); next[dk] = val; return next; });
                        autoReschedule();
                      }
                    }} style={{ fontSize: 7, fontWeight: 600, padding: "0 2px", borderRadius: 2, border: isOv ? "1px solid #7C3AED" : "1px solid " + TH.border, background: isOv ? (darkMode ? "#2E1065" : "#EDE9FE") : "transparent", color: isOv ? "#7C3AED" : TH.textDim, cursor: "pointer", WebkitAppearance: "none", MozAppearance: "none", appearance: "none", maxWidth: 60 }}>
                      {Object.keys(locSchedules).map(function(tid) {
                        var t = locSchedules[tid];
                        return <option key={tid} value={tid}>{(t.icon || "") + " " + t.name}</option>;
                      })}
                      {isOv && <option value="__reset__">↩ Reset</option>}
                    </select>;
                  })()}</div>
                </div>
                {HOURS.map(function(h) {
                  var hLocId = getLocationForHour(dk, h);
                  var hBlocks = getBlocksForDate(dk, timeBlocks);
                  var hBlock = getBlockAtMinute(hBlocks, h * 60);
                  return <div key={h} style={{
                    position: "absolute", top: (h - GRID_START) * PX_PER_HOUR, left: 0, right: 0,
                    height: PX_PER_HOUR, borderBottom: "1px solid " + TH.borderLight,
                    background: locBgTint(hLocId, "14"),
                  }}>
                    {PX_PER_HOUR >= 32 && <div style={{ position: "absolute", top: 1, right: 2, fontSize: 6, color: TH.textDim, opacity: 0.7, lineHeight: "8px", textAlign: "right", pointerEvents: "none" }}>
                      {locIcon(hLocId)}{hBlock ? " " + hBlock.tag : ""}
                    </div>}
                  </div>;
                })}
                {positioned.map(function(item) {
                  var t = item.task;
                  var topPx = (item.start - GRID_START * 60) * PX_PER_MIN;
                  var hPx = Math.max(14, item.dur * PX_PER_MIN);
                  var st = t.status || (statuses[t.id] || "");
                  var sc = STATUS_MAP[st] || STATUS_MAP[""];
                  return (
                    <div key={item.key} draggable={true} onDragStart={function(e) {
                      e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move";
                    }} onClick={function() {
                      setDayOffset(Math.round((dt - today) / 86400000));
                      setExpandedTask(t.id);
                      setViewMode("day");
                    }} style={{
                      position: "absolute", top: topPx, left: 2, right: 2, height: hPx,
                      background: st === "done" ? TH.greenBg : st === "wip" ? TH.amberBg : sc.bg,
                      border: "1px solid " + sc.color + "44", borderRadius: 3, padding: "1px 3px",
                      fontSize: 8, overflow: "hidden", cursor: "grab", lineHeight: "10px",
                      opacity: st === "done" ? 0.6 : 1,
                    }}>
                      <div style={{ fontWeight: 600, color: TH.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.text}</div>
                      {hPx >= 24 && (t.when && t.when !== "anytime" && t.when !== "fixed" || t.where && t.where !== "anywhere") && (
                        <div style={{ display: "flex", gap: 2, marginTop: 1 }}>
                          {t.when && t.when !== "anytime" && t.when !== "fixed" && <span style={{ fontSize: 6, fontWeight: 600, color: "#7C3AED", background: "#7C3AED18", padding: "0 2px", borderRadius: 2, lineHeight: "8px" }}>{"\u23F1"}{t.when}</span>}
                          {t.where && t.where !== "anywhere" && <span style={{ fontSize: 6, fontWeight: 600, color: "#2563EB", background: "#2563EB18", padding: "0 2px", borderRadius: 2, lineHeight: "8px" }}>{t.where === "home" ? "\u{1F3E0}" : t.where === "work" ? "\u{1F3E2}" : "\u{1F4CD}"}{t.where}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // WEEK VIEW — 7-column time grid
  const WeekView = () => {
    // Now time for today indicator
    var nowMin = null;
    var nowD = new Date();
    if (true) { nowMin = nowD.getHours() * 60 + nowD.getMinutes(); }
    // Get Mon-Sun of selected week
    var wd = selectedDate.getDay();
    var monOff = wd === 0 ? -6 : 1 - wd;
    var mon = new Date(selectedDate); mon.setDate(mon.getDate() + monOff);
    var days = [];
    for (var i = 0; i < 7; i++) { var d = new Date(mon); d.setDate(d.getDate() + i); days.push(d); }
    var gridH = GRID_HOURS_COUNT * PX_PER_HOUR;
    return (
      <div style={{ background: TH.bgCard, borderRadius: 8, border: "1px solid " + TH.border, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "42px repeat(7, 1fr)", gap: 0 }}>
          {/* Hour gutter */}
          <div style={{ position: "relative", height: gridH, borderRight: "1px solid " + TH.border, background: TH.bgHover }}>
            {HOURS.map(function(h) {
              return (
                <div key={h} style={{
                  position: "absolute", top: (h - GRID_START) * PX_PER_HOUR, fontSize: 7, color: TH.textDim,
                  fontWeight: 600, padding: "0 2px", height: PX_PER_HOUR, borderBottom: "1px solid " + TH.borderLight,
                  width: "100%", boxSizing: "border-box",
                }}>{formatHour(h)}</div>
              );
            })}
          </div>
          {/* Day columns */}
          {days.map(function(dt, di) {
            var dk = formatDateKey(dt);
            var dayTasks = (tasksByDate[dk] || []).filter(filterTask);
            var positioned = scheduleDayTasksFn(dayTasks, dk);
            var isToday = isSameDay(dt, today);
            var isSel = isSameDay(dt, selectedDate);
            var loc = getLocationForDate(dk);
            var isAway = loc.id !== "home";
            var doneC = dayTasks.filter(function(t) { return statuses[t.id] === "done"; }).length;
            return (
              <div key={di} style={{ position: "relative", height: gridH, borderRight: di < 6 ? "1px solid " + TH.border : "none" }}
                onDragOver={function(e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={function(e) { handleGridDrop(e, dk); }}>
                <div onClick={function() { setDayOffset(Math.round((dt - today) / 86400000)); setViewMode("day"); }}
                  style={{
                    position: "sticky", top: 0, zIndex: 20, padding: "2px 2px",
                    background: isSel ? TH.blueBg : isToday ? TH.amberBg : isAway ? (darkMode ? "#431407" : "#FFEDD5") : TH.bgCard,
                    borderBottom: isToday ? "2px solid #F59E0B" : isSel ? "2px solid " + TH.accent : "1px solid " + TH.border,
                    cursor: "pointer", textAlign: "center",
                  }}>
                  <div style={{ fontSize: 8, fontWeight: 700, color: isSel ? TH.accent : isToday ? TH.amberText : TH.text }}>
                    {DAY_NAMES[dt.getDay()]}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isSel ? TH.accent : isToday ? TH.amberText : TH.text }}>{dt.getDate()}</div>
                  <div style={{ fontSize: 7, color: TH.textDim }}>{dayTasks.length}t{doneC > 0 ? " ✓" + doneC : ""} {(() => {
                    var d2 = parseDate(dk);
                    var dn = d2 ? ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d2.getDay()] : "Mon";
                    var overrideTmplId = locScheduleOverrides[dk];
                    var activeTmplId = overrideTmplId || locScheduleDefaults[dn] || "weekday";
                    var activeTmpl = locSchedules[activeTmplId];
                    var isOv = !!overrideTmplId;
                    return <span onClick={function(e) { e.stopPropagation(); }} title={(activeTmpl || {}).name + (isOv ? " (override)" : " (default)")} style={{ fontSize: 7, color: isOv ? "#7C3AED" : TH.textDim, fontWeight: isOv ? 700 : 400 }}>{(activeTmpl || {}).icon || "📅"}</span>;
                  })()}</div>
                </div>
                {HOURS.map(function(h) {
                  var hLocId = getLocationForHour(dk, h);
                  return <div key={h} style={{
                    position: "absolute", top: (h - GRID_START) * PX_PER_HOUR, left: 0, right: 0,
                    height: PX_PER_HOUR, borderBottom: "1px solid " + TH.borderLight,
                    background: locBgTint(hLocId, "14"),
                  }} />;
                })}
                {positioned.map(function(item) {
                  var t = item.task;
                  var topPx = (item.start - GRID_START * 60) * PX_PER_MIN;
                  var hPx = Math.max(10, item.dur * PX_PER_MIN);
                  var st = t.status || (statuses[t.id] || "");
                  var sc = STATUS_MAP[st] || STATUS_MAP[""];
                  var closed = st === "done" || st === "cancel" || st === "skip";
                  var isHab = t.habit;
                  var blocked = !!item.blocked;
                  var badge = PRI_COLORS[t.pri] || TH.textMuted;
                  return (
                    <div key={item.key} draggable={true} onDragStart={function(e) {
                      e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move";
                    }} onClick={function() {
                      setDayOffset(Math.round((dt - today) / 86400000));
                      setExpandedTask(t.id);
                      setViewMode("day");
                    }} title={t.text + " (" + (item.dur || t.dur || 30) + "m)" + (t.when && t.when !== "anytime" ? " when:" + t.when : "") + (t.where && t.where !== "anywhere" ? " where:" + t.where : "")} style={{
                      position: "absolute", top: topPx, left: 1, right: 1, height: hPx,
                      background: blocked ? TH.amberBg : st === "skip" ? (darkMode ? "#1E293B" : "#F1F5F9") : closed ? (st === "done" ? TH.greenBg : TH.redBg) : st === "wip" ? TH.amberBg : isHab ? (darkMode ? "#0F2818" : "#F0FDF4") : TH.blueBg,
                      borderLeft: isHab ? "2px solid #059669" : "2px solid " + (blocked ? "#F97316" : badge),
                      borderRadius: 2, padding: "0 2px",
                      fontSize: 7, overflow: "hidden", cursor: "grab", lineHeight: "9px",
                      opacity: closed ? 0.5 : blocked ? 0.55 : isHab ? 0.8 : 1,
                    }}>
                      <div style={{ fontWeight: 600, color: TH.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.text}</div>
                      {hPx >= 20 && (t.when && t.when !== "anytime" && t.when !== "fixed" || t.where && t.where !== "anywhere") && (
                        <div style={{ display: "flex", gap: 1 }}>
                          {t.when && t.when !== "anytime" && t.when !== "fixed" && <span style={{ fontSize: 5, color: "#7C3AED", lineHeight: "7px" }}>{t.when}</span>}
                          {t.where && t.where !== "anywhere" && <span style={{ fontSize: 5, color: "#2563EB", lineHeight: "7px" }}>{t.where === "home" ? "\u{1F3E0}" : t.where === "work" ? "\u{1F3E2}" : "\u{1F4CD}"}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Now line */}
                {isToday && nowMin !== null && nowMin >= GRID_START * 60 && nowMin <= GRID_END * 60 && (
                  <div style={{ position: "absolute", top: (nowMin - GRID_START * 60) * PX_PER_MIN, left: 0, right: 0, height: 2, background: "#EF4444", zIndex: 40 }}>
                    <div style={{ position: "absolute", left: -3, top: -3, width: 8, height: 8, borderRadius: "50%", background: "#EF4444" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // MONTH VIEW — calendar grid
  const MonthView = () => {
    var yr = selectedDate.getFullYear();
    var mo = selectedDate.getMonth();
    var first = new Date(yr, mo, 1);
    var startDow = first.getDay(); // 0=Sun
    // Start from previous Monday (or Sun if startDow is 0)
    var calStart = new Date(first);
    calStart.setDate(calStart.getDate() - (startDow === 0 ? 6 : startDow - 1));
    // Build 6 weeks (42 days)
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(calStart);
      d.setDate(d.getDate() + i);
      cells.push(d);
    }
    // Trim trailing week if all days are next month
    if (cells[35].getMonth() !== mo) cells = cells.slice(0, 35);

    var dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    return (
      <div style={{ background: TH.bgCard, borderRadius: 8, border: "1px solid " + TH.border, overflow: "hidden" }}>
        {/* Month nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid " + TH.border }}>
          <button onClick={function() { var nd = new Date(yr, mo - 1, 1); setDayOffset(Math.round((nd - today) / 86400000)); }} style={{
            background: "none", border: "1px solid " + TH.border, borderRadius: 4, cursor: "pointer", padding: "2px 8px", color: TH.textMuted, fontSize: 12,
          }}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: TH.text }}>{MONTH_NAMES[mo]} {yr}</span>
          <button onClick={function() { var nd = new Date(yr, mo + 1, 1); setDayOffset(Math.round((nd - today) / 86400000)); }} style={{
            background: "none", border: "1px solid " + TH.border, borderRadius: 4, cursor: "pointer", padding: "2px 8px", color: TH.textMuted, fontSize: 12,
          }}>›</button>
        </div>
        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid " + TH.border }}>
          {dayLabels.map(function(dl) {
            return <div key={dl} style={{ textAlign: "center", fontSize: 9, fontWeight: 700, color: TH.textDim, padding: "4px 0", textTransform: "uppercase" }}>{dl}</div>;
          })}
        </div>
        {/* Calendar grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {cells.map(function(dt, ci) {
            var dk = formatDateKey(dt);
            var isThisMonth = dt.getMonth() === mo;
            var isToday = isSameDay(dt, today);
            var isSel = isSameDay(dt, selectedDate);
            var loc = getLocationForDate(dk);
            var isAway = loc.id !== "home";
            var dayTasks = (tasksByDate[dk] || []).filter(filterTask);
            var doneC = dayTasks.filter(function(t) { return statuses[t.id] === "done"; }).length;
            var openC = dayTasks.length - doneC;
            var hasOverdue = dayTasks.some(function(t) {
              if (!t.due) return false;
              var dd = parseDate(t.due);
              return dd && dd < dt && !statuses[t.id];
            });
            // Top 3 task previews
            var previews = dayTasks.slice(0, 3);
            var moreCount = dayTasks.length - 3;

            return (
              <div key={ci} onClick={function() {
                setDayOffset(Math.round((dt - today) / 86400000));
                setViewMode("day");
              }} onDragOver={function(e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
              onDrop={function(e) { e.stopPropagation(); handleDateDrop(e, dk); }} style={{
                minHeight: 72, padding: "3px 4px", cursor: "pointer",
                borderRight: ci % 7 < 6 ? "1px solid " + TH.borderLight : "none",
                borderBottom: "1px solid " + TH.borderLight,
                background: isSel ? TH.blueBg : isToday ? TH.amberBg : isAway ? (darkMode ? "#1A1207" : "#FFFBF0") : "transparent",
                opacity: isThisMonth ? 1 : 0.4,
                transition: "background 0.1s",
              }}>
                {/* Date number */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                  <span style={{
                    fontSize: 11, fontWeight: isToday || isSel ? 700 : 500,
                    color: isSel ? TH.accent : isToday ? TH.amberText : TH.text,
                    background: isToday ? (darkMode ? "#78350F" : "#FDE68A") : "transparent",
                    borderRadius: isToday ? 10 : 0, padding: isToday ? "0 5px" : 0,
                  }}>{dt.getDate()}</span>
                  {(() => {
                    var d2 = parseDate(dk);
                    var dn = d2 ? ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d2.getDay()] : "Mon";
                    var overrideTmplId = locScheduleOverrides[dk];
                    var activeTmplId = overrideTmplId || locScheduleDefaults[dn] || "weekday";
                    var activeTmpl = locSchedules[activeTmplId];
                    var isOv = !!overrideTmplId;
                    return <span title={(activeTmpl || {}).name + (isOv ? " (override)" : "")} style={{ fontSize: 8, color: isOv ? "#7C3AED" : TH.textDim, fontWeight: isOv ? 700 : 400 }}>{(activeTmpl || {}).icon || (isAway ? loc.icon : "")}</span>;
                  })()}
                </div>
                {/* Task count badges */}
                {dayTasks.length > 0 && (
                  <div style={{ display: "flex", gap: 2, marginBottom: 2, flexWrap: "wrap" }}>
                    {openC > 0 && <span style={{ fontSize: 7, fontWeight: 700, color: TH.blueText, background: TH.blueBg, padding: "0 3px", borderRadius: 2, lineHeight: "11px" }}>{openC}</span>}
                    {doneC > 0 && <span style={{ fontSize: 7, fontWeight: 700, color: TH.greenText, background: TH.greenBg, padding: "0 3px", borderRadius: 2, lineHeight: "11px" }}>✓{doneC}</span>}
                    {hasOverdue && <span style={{ fontSize: 7, fontWeight: 700, color: TH.redText, background: TH.redBg, padding: "0 3px", borderRadius: 2, lineHeight: "11px" }}>⚠</span>}
                  </div>
                )}
                {/* Task previews */}
                {previews.map(function(t) {
                  var st = statuses[t.id] || "";
                  var closed = st === "done" || st === "cancel" || st === "skip";
                  var badge = PRI_COLORS[t.pri] || TH.textMuted;
                  return (
                    <div key={t.id} draggable={true} onDragStart={function(e) {
                      e.stopPropagation();
                      e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move";
                    }} style={{
                      fontSize: 7, lineHeight: "10px", padding: "1px 2px", marginBottom: 1,
                      borderLeft: "2px solid " + badge, borderRadius: 1, cursor: "grab",
                      color: closed ? TH.textDim : TH.text,
                      textDecoration: closed ? "line-through" : "none",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      opacity: closed ? 0.5 : 1,
                    }}>{t.text}</div>
                  );
                })}
                {moreCount > 0 && <div style={{ fontSize: 7, color: TH.textDim, fontWeight: 600 }}>+{moreCount} more</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // DAY VIEW
  const DayView = () => {
    const dateKey = selectedDateKey;
    const dayTasks = filter === "unplaced"
      ? (schedResultRef.current.unplaced || []).filter(filterTask)
      : (tasksByDate[dateKey] || []).filter(filterTask);
    const isToday = isSameDay(selectedDate, today);
    const isPast = selectedDate < today && !isToday;
    const loc = getLocationForDate(dateKey);
    const isAway = loc.id !== "home";

    // Schedule tasks
    var positioned = scheduleDayTasksFn(dayTasks, dateKey);
    const blockedCount = positioned.filter(function(p) { return p.blocked; }).length;

    // Now time
    var nowMin = null;
    if (isToday) { var nd = new Date(); nowMin = nd.getHours() * 60 + nd.getMinutes(); }

    var gridH = GRID_HOURS_COUNT * PX_PER_HOUR;

    return (
      <div style={{ background: TH.bgCard, borderRadius: 8, border: "1px solid " + TH.border, overflow: expandedTask ? "visible" : "hidden" }}>
        {/* Day header — compact */}
        <div style={{
          padding: "4px 10px",
          background: isToday ? TH.amberBg : isAway ? (darkMode ? "#431407" : "#FFEDD5") : TH.bgCard,
          borderBottom: isToday ? "2px solid #F59E0B" : isAway ? "2px solid #F97316" : "2px solid " + TH.border,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: isToday ? TH.amberText : TH.text }}>{filter === "unplaced" ? "📭 Unplaced Tasks (" + dayTasks.length + ")" : dayLabel}</span>
            {(() => {
              var d2 = parseDate(dateKey);
              var dn = d2 ? ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d2.getDay()] : "Mon";
              var defaultTmplId = locScheduleDefaults[dn] || "weekday";
              var overrideTmplId = locScheduleOverrides[dateKey];
              var activeTmplId = overrideTmplId || defaultTmplId;
              var activeTmpl = locSchedules[activeTmplId];
              var isOverride = !!overrideTmplId;
              var templateIds = Object.keys(locSchedules);
              return <select value={activeTmplId} onChange={function(e) {
                var val = e.target.value;
                if (val === "__reset__") {
                  setLocScheduleOverrides(function(prev) { var next = Object.assign({}, prev); delete next[dateKey]; return next; });
                  showToast("Reset to default: " + (locSchedules[defaultTmplId] || {}).name, "success");
                  autoReschedule();
                } else {
                  setLocScheduleOverrides(function(prev) { var next = Object.assign({}, prev); next[dateKey] = val; return next; });
                  showToast("Schedule: " + (locSchedules[val] || {}).name, "success");
                  autoReschedule();
                }
              }} title={isOverride ? "Override: " + (activeTmpl || {}).name + " (default: " + (locSchedules[defaultTmplId] || {}).name + ")" : "Default: " + (activeTmpl || {}).name}
              style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3, border: isOverride ? "2px solid #7C3AED" : "1px solid " + TH.border, background: isOverride ? (darkMode ? "#2E1065" : "#EDE9FE") : isAway ? "#F97316" : TH.border, color: isOverride ? "#7C3AED" : isAway ? "white" : TH.textMuted, cursor: "pointer", WebkitAppearance: "none", MozAppearance: "none", appearance: "none", paddingRight: 14, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M0 2l4 4 4-4z' fill='%23666'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 3px center" }}>
                {templateIds.map(function(tid) {
                  var t = locSchedules[tid];
                  var isDef = tid === defaultTmplId;
                  return <option key={tid} value={tid}>{(t.icon || "📅") + " " + t.name + (isDef ? " (default)" : "")}</option>;
                })}
                {isOverride && <option value="__reset__">↩ Reset to default</option>}
              </select>;
            })()}
            <div style={{ flex: 1 }} />
            {dayTasks.filter(t => !t.habit).length > 0 && <span style={{ fontSize: 8, color: "#2563EB", background: TH.blueBg, padding: "0 4px", borderRadius: 2, fontWeight: 600 }}>{dayTasks.filter(t => !t.habit).length}t</span>}
            {dayTasks.filter(t => t.habit).length > 0 && <span style={{ fontSize: 8, color: "#059669", background: TH.greenBg, padding: "0 4px", borderRadius: 2, fontWeight: 600 }}>{dayTasks.filter(t => t.habit).length}h</span>}
            {dayTasks.filter(t => statuses[t.id] === "done").length > 0 && <span style={{ fontSize: 8, color: TH.greenText, background: TH.greenBg, padding: "0 4px", borderRadius: 2, fontWeight: 600 }}>✓{dayTasks.filter(t => statuses[t.id] === "done").length}</span>}
            {blockedCount > 0 && <span style={{ fontSize: 8, color: TH.amberText, background: TH.amberBg, padding: "0 4px", borderRadius: 2, fontWeight: 600 }}>🚫{blockedCount}</span>}
            {dayTasks.filter(function(t) { return t.habit && !statuses[t.id]; }).length > 0 && (
              <button onClick={function(e) { e.stopPropagation(); var count = dayTasks.filter(function(t) { return t.habit && !statuses[t.id]; }).length; if (count > 0) { batchSetStatus(dateKey, function(t) { return t.habit && !statuses[t.id]; }, "done"); showToast("Marked " + count + " habits done ✓", "success"); } }}
                title="Mark all open habits done" style={{ fontSize: 8, padding: "0 4px", borderRadius: 2, border: "1px solid #059669", background: TH.greenBg, color: TH.greenText, cursor: "pointer", fontWeight: 600 }}>✓hab</button>
            )}
            <button onClick={function(e) { e.stopPropagation(); quickAddTask(dateKey); }}
              title="Add a new task" style={{ fontSize: 8, padding: "0 4px", borderRadius: 2, border: "1px solid #3B82F6", background: TH.blueBg, color: TH.blueText, cursor: "pointer", fontWeight: 700 }}>+</button>
          </div>
          {(() => {
            const openTasks = dayTasks.filter(t => { var s = statuses[t.id] || ""; return s !== "done" && s !== "cancel" && s !== "skip"; });
            const totalMins = openTasks.reduce((sum, t) => sum + ((t.timeRemaining != null ? t.timeRemaining : t.dur) || 30), 0);
            const doneMins = dayTasks.filter(t => statuses[t.id] === "done").reduce((sum, t) => sum + (t.dur || 30), 0);
            const wipMins = dayTasks.filter(t => statuses[t.id] === "wip").reduce((sum, t) => sum + ((t.dur || 30) - ((t.timeRemaining != null ? t.timeRemaining : t.dur) || 30)), 0);
            const availMins = 17 * 60;
            const pctUsed = Math.min(100, Math.round((totalMins + doneMins + wipMins) / availMins * 100));
            const pctDone = Math.round((doneMins + wipMins) / availMins * 100);
            const hrs = (h) => h >= 60 ? (h / 60).toFixed(1) + "h" : h + "m";
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                <div style={{ flex: 1, height: 4, background: TH.progressBg, borderRadius: 2, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: pctDone + "%", background: "#10B981", transition: "width 0.3s" }} />
                  <div style={{ width: (pctUsed - pctDone) + "%", background: pctUsed > 90 ? "#F87171" : "#3B82F6", transition: "width 0.3s" }} />
                </div>
                <span style={{ fontSize: 8, color: TH.textMuted, fontWeight: 600, whiteSpace: "nowrap" }}>{hrs(doneMins + wipMins)}✓ {hrs(totalMins)}rem {pctUsed}%</span>
              </div>
            );
          })()}
        </div>

        {dayTasks.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center" }}>
            <div style={{ color: TH.textDim, fontSize: 13, fontStyle: "italic", marginBottom: 8 }}>
              {filter === "unplaced" ? "All tasks placed successfully!" : isPast ? "No tasks recorded" : "No tasks scheduled"}
            </div>
            {!isPast && filter !== "unplaced" && (
              <button onClick={function() { quickAddTask(dateKey); }}
                title="Add a new task" style={{ fontSize: 11, padding: "6px 16px", borderRadius: 6, cursor: "pointer", border: "1px dashed " + TH.accent, background: TH.blueBg, color: TH.accent, fontWeight: 600 }}>+ Add Task</button>
            )}
          </div>
        ) : filter === "unplaced" ? (
          <div style={{ overflowY: "auto", maxHeight: "70vh", padding: 6 }}>
            {dayTasks.map(function(t) {
              var reason = t._unplacedReason === "deadline" ? "Would miss deadline" : "No capacity in windows";
              var deps = (t.dependsOn || []).filter(function(d) { var st = statuses[d] || ""; return st !== "done" && st !== "cancel" && st !== "skip"; });
              var blockedByDeps = deps.length > 0;
              var depNames = deps.map(function(d) {
                var dt = allTasks.find(function(at) { return at.id === d; });
                return { id: d, name: dt ? dt.text : d + " (missing)" };
              });
              return <div key={t.id} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 8, padding: "2px 8px", display: "flex", gap: 6, flexWrap: "wrap", color: TH.textDim, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, color: t._unplacedReason === "deadline" ? "#EF4444" : TH.amberText }}>{reason}</span>
                  <span>📅 {t.date || "TBD"}</span>
                  {t.due && <span>⏰ due {t.due}</span>}
                  <span>⏱ {t.dur || 30}m</span>
                  <span>🕐 w:{t.when || "any"}</span>
                  {t.dayReq && t.dayReq !== "any" && <span>📆 {t.dayReq}</span>}
                  {blockedByDeps && depNames.map(function(dep) {
                    return <span key={dep.id} style={{ color: "#EF4444", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      🔗 blocked by: "{dep.name}"
                      <button onClick={function(e) {
                        e.stopPropagation();
                        if (confirm("Remove dependency on \"" + dep.name + "\" from \"" + t.text + "\"?")) {
                          var newDeps = (t.dependsOn || []).filter(function(x) { return x !== dep.id; });
                          dispatchPersist({ type: 'UPDATE_TASK', id: t.id, fields: { dependsOn: newDeps } }, "remove dep " + dep.id + " from " + t.id);
                          setTimeout(function() { try { autoRescheduleRef.current(); } catch(e2) {} }, 100);
                        }
                      }} style={{
                        fontSize: 7, padding: "1px 5px", borderRadius: 4, cursor: "pointer",
                        background: darkMode ? "#7F1D1D" : "#FEE2E2", color: "#EF4444",
                        border: "1px solid #EF4444", fontWeight: 700, lineHeight: "12px",
                      }}>✕ Remove</button>
                    </span>;
                  })}
                </div>
                {t._unplacedDetail && <div style={{ fontSize: 7, padding: "1px 8px", color: TH.textDim, fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.4, background: darkMode ? "#1a1a2e" : "#f8f8f0", borderRadius: 3, margin: "2px 8px" }}>{t._unplacedDetail}</div>}
                <TaskCard t={t} dateStr={t.date || dateKey} ctxRef={taskCardContextRef} />
              </div>;
            })}
          </div>
        ) : (
          <div ref={dayViewScrollRef} style={{ overflowY: "auto", maxHeight: "70vh" }}>
            {/* Zoom controls */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, padding: "4px 10px", background: TH.bgHover, borderBottom: "1px solid " + TH.border }}>
              <span style={{ fontSize: 9, color: TH.textDim, fontWeight: 600, marginRight: 2 }}>{"\u{1F50D}"} Zoom</span>
              {[60, 45, 30, 15].map(function(z) {
                var sel = gridZoom === z;
                return <button key={z} onClick={() => setGridZoom(z)} style={{
                  padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: sel ? 700 : 500, cursor: "pointer",
                  border: sel ? "1.5px solid " + TH.accent : "1px solid " + TH.btnBorder,
                  background: sel ? TH.blueBg : TH.bgCard, color: sel ? TH.blueText : TH.textMuted,
                }}>{z === 60 ? "1h" : z + "m"}</button>;
              })}
            </div>
            <div style={{ display: "flex", position: "relative", height: gridH }}>
              {/* Hour gutter */}
              <div style={{ width: 76, flexShrink: 0, position: "relative", borderRight: "1px solid " + TH.border, background: TH.bgHover }}>
                {HOURS.map(function(h) {
                  var yy = (h - GRID_START) * PX_PER_HOUR;
                  var mm = getHourMeta(h, selectedDate.getDay(), loc, dateKey);
                  var isCur = isToday && new Date().getHours() === h;
                  var subLabels = [];
                  if (gridZoom <= 30) {
                    for (var sub = gridZoom; sub < 60; sub += gridZoom) {
                      subLabels.push(sub);
                    }
                  }
                  // Per-hour location
                  var hourLocId = getLocationForHour(dateKey, h);
                  var hourLocObj = getLocObj(hourLocId, locations);
                  var isOverride = hourLocationOverrides[dateKey] && hourLocationOverrides[dateKey][h] !== undefined;
                  var isDayOverride = !!locScheduleOverrides[dateKey];
                  var allLocIds = ["home"].concat(locations.filter(function(l) { return l.id !== "home"; }).map(function(l) { return l.id; }));

                  return (
                    <div key={h} style={{ position: "absolute", top: yy, left: 0, right: 0, height: PX_PER_HOUR }}>
                      <div style={{
                        padding: "3px 6px", boxSizing: "border-box",
                        display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "flex-start",
                        borderBottom: "1px solid " + TH.borderLight,
                        background: isCur ? TH.amberBg : isOverride ? TH.purpleBg : locBgTint(hourLocId, "18"),
                        height: gridZoom < 60 ? PX_PER_HOUR * gridZoom / 60 : PX_PER_HOUR,
                      }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: isCur ? 700 : 500, color: isCur ? TH.amberText : TH.textMuted, fontFamily: "'JetBrains Mono', monospace", lineHeight: "14px" }}>{formatHour(h)}</span>
                          <span style={{ fontSize: 7, fontWeight: 600, color: mm.cl, lineHeight: "10px", letterSpacing: "0.3px", whiteSpace: "nowrap" }}>{mm.ic} {mm.fr}</span>
                        </div>
                        <span onClick={function() {
                            var curIdx = allLocIds.indexOf(hourLocId);
                            var nextIdx = (curIdx + 1) % allLocIds.length;
                            var nextId = allLocIds[nextIdx];
                            // Compute what default would be (without override)
                            var defaultId = resolveLocationId(dateKey, h, Object.assign({}, schedCfg, {hourLocationOverrides: {}}), selectedDayBlocks);
                            var newHO = Object.assign({}, hourLocationOverrides);
                            if (!newHO[dateKey]) newHO[dateKey] = {};
                            if (nextId === defaultId) {
                              // Cycling back to default — remove override
                              var copy = Object.assign({}, newHO[dateKey]);
                              delete copy[h];
                              if (Object.keys(copy).length === 0) delete newHO[dateKey];
                              else newHO[dateKey] = copy;
                            } else {
                              newHO[dateKey] = Object.assign({}, newHO[dateKey]);
                              newHO[dateKey][h] = nextId;
                            }
                            setHourLocationOverrides(newHO);
                          }} style={{
                            fontSize: 7, fontWeight: (isOverride || isDayOverride) ? 700 : 500, lineHeight: "9px", cursor: "pointer",
                            color: isOverride ? TH.purpleText : isDayOverride ? "#EA580C" : TH.textDim,
                            background: isOverride ? TH.purpleBg : isDayOverride ? TH.amberBg : "transparent",
                            padding: (isOverride || isDayOverride) ? "1px 3px" : "0",
                            borderRadius: 3, userSelect: "none",
                          }} title={"Tap to change location — " + hourLocObj.name}>
                            {hourLocObj.icon} {hourLocObj.name}
                          </span>
                      </div>
                      {subLabels.map(function(sub) {
                        var subY = sub * PX_PER_MIN;
                        var hh12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
                        var ampm = h >= 12 ? "p" : "a";
                        return <div key={sub} style={{ position: "absolute", top: subY, right: 6, fontSize: 9, color: TH.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                          {hh12}:{sub < 10 ? "0" + sub : sub}{ampm}
                        </div>;
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Task grid area */}
              <div style={{ flex: 1, position: "relative" }} onDragOver={function(e) {
                e.preventDefault(); e.dataTransfer.dropEffect = "move";
              }} onDrop={function(e) { handleGridDrop(e, dateKey); }}>
                {/* Hour gridlines + sub-hour divisions */}
                {HOURS.map(function(h) {
                  var subLines = [];
                  for (var sub = gridZoom; sub < 60; sub += gridZoom) {
                    subLines.push(sub);
                  }
                  var hLocId = getLocationForHour(dateKey, h);
                  return (
                    <div key={"g" + h} style={{
                      position: "absolute", top: (h - GRID_START) * PX_PER_HOUR, left: 0, right: 0,
                      height: PX_PER_HOUR, borderBottom: "1px solid " + TH.borderLight, boxSizing: "border-box",
                      background: locBgTint(hLocId, "14"),
                    }}>
                      {gridZoom >= 60 && <div style={{ position: "absolute", top: PX_PER_HOUR / 2, left: 8, right: 8, borderBottom: "1px dashed " + TH.border }} />}
                      {gridZoom < 60 && subLines.map(function(sub) {
                        return <div key={sub} style={{ position: "absolute", top: sub * PX_PER_MIN, left: 4, right: 4, borderBottom: "1px dashed " + TH.border }} />;
                      })}
                    </div>
                  );
                })}

                {/* Now line */}
                {nowMin !== null && nowMin >= GRID_START * 60 && nowMin <= GRID_END * 60 && (
                  <div style={{
                    position: "absolute", top: (nowMin - GRID_START * 60) * PX_PER_MIN, left: 0, right: 0,
                    height: 2, background: "#EF4444", zIndex: 40, pointerEvents: "none",
                  }}>
                    <div style={{ position: "absolute", left: -4, top: -4, width: 10, height: 10, borderRadius: "50%", background: "#EF4444" }} />
                  </div>
                )}

                {/* Positioned tasks */}
                {positioned.map(function(item) {
                  var t = item.task;
                  var top = (item.start - GRID_START * 60) * PX_PER_MIN;
                  var h = Math.max(20, item.dur * PX_PER_MIN);
                  var left = (item.col / item.cols * 100) + "%";
                  var width = "calc(" + (100 / item.cols) + "% - 4px)";
                  var isExp = expandedTask === t.id;

                  // If expanded, render a highlighted anchor tile (the full card renders below the grid)
                  if (isExp) {
                    var anchorH = Math.max(24, Math.min(item.dur * PX_PER_MIN, 48));
                    return (
                      <div key={item.key} data-expanded-anchor="true" style={{
                        position: "absolute", top: top, left: left, width: width, height: anchorH,
                        marginLeft: 2, borderRadius: 4, overflow: "hidden",
                        border: "2px solid " + TH.accent,
                        background: TH.blueBg,
                        boxShadow: "0 0 0 3px " + TH.accent + "33, 0 4px 12px rgba(0,0,0,0.15)",
                        zIndex: 45, cursor: "pointer",
                        display: "flex", alignItems: "center", padding: "2px 6px", gap: 4,
                      }} onClick={function() { setExpandedTask(null); setPendingEdits(null); }}>
                        <span style={{ fontSize: 8, fontWeight: 700, color: TH.accent, whiteSpace: "nowrap" }}>
                          {(() => { var dH2 = Math.floor(item.start / 60); var dM2 = item.start % 60; var ap2 = dH2 >= 12 ? "p" : "a"; var d122 = dH2 > 12 ? dH2 - 12 : (dH2 === 0 ? 12 : dH2); return d122 + ":" + (dM2 < 10 ? "0" : "") + dM2 + ap2; })()}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: TH.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                          {t.text}
                        </span>
                        <span style={{ fontSize: 8, color: TH.accent, fontWeight: 700 }}>{"\u25BC"}</span>
                      </div>
                    );
                  }

                  var st = statuses[t.id] || "";
                  var sc = STATUS_MAP[st] || STATUS_MAP[""];
                  var closed = st === "done" || st === "cancel" || st === "skip";
                  var badge = PRI_COLORS[t.pri] || "#6B7280";
                  var isHab = t.habit;
                  var blocked = !!item.blocked;
                  var isPastWin = !!item.pastWindows;
                  var isSplit = !!item.splitPart;
                  var tiny = h < 28;
                  var compact = h < 42;
                  var dH = Math.floor(item.start / 60);
                  var dM = item.start % 60;
                  var ap = dH >= 12 ? "p" : "a";
                  var d12 = dH > 12 ? dH - 12 : (dH === 0 ? 12 : dH);
                  var tl = d12 + ":" + (dM < 10 ? "0" : "") + dM + ap;

                  return (
                    <div key={item.key} draggable={true} onDragStart={function(e) {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                    }} onClick={function() {
                      setExpandedTask(t.id);
                      setPendingEdits({ id: t.id, fields: {} });
                      if (taskAiRef.current) taskAiRef.current.value = "";
                    }} style={{
                      position: "absolute", top: top, left: left, width: width, height: h,
                      marginLeft: 2, borderRadius: 4, cursor: "grab", overflow: "hidden",
                      borderLeft: isHab ? ("3px solid " + (blocked ? "#F97316" : "#059669")) : ("3px solid " + (blocked ? "#F97316" : badge)),
                      borderTop: isSplit ? "2px dashed #7C3AED" : (isHab ? "1px dashed " + TH.textDim : "none"),
                      background: item.overflow ? TH.redBg : blocked ? (darkMode ? "#431407" : "#FFF7ED") : isSplit ? TH.purpleBg : st === "skip" ? (darkMode ? "#1E293B" : "#F1F5F9") : closed ? (st === "done" ? TH.greenBg : TH.redBg) : st === "wip" ? TH.amberBg : isHab ? (darkMode ? "#0F2818" : "#F0FDF4") : TH.blueBg,
                      opacity: st === "skip" ? 0.45 : blocked ? 0.55 : isHab ? 0.85 : 1,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                      boxSizing: "border-box",
                      display: "flex", flexDirection: tiny ? "row" : "column",
                      padding: tiny ? "1px 4px" : "2px 5px",
                      gap: tiny ? 4 : 1,
                      alignItems: tiny ? "center" : "flex-start",
                    }}>
                      {blocked && !tiny && (
                        <div style={{ position: "absolute", top: 1, right: 2, fontSize: 7, fontWeight: 700, color: TH.amberText, background: TH.amberBg, padding: "0 2px", borderRadius: 2, zIndex: 1 }}>{isPastWin ? "⏰" : "🚫"}</div>
                      )}
                      <div style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
                        <select value={st} onChange={function(e) { e.stopPropagation(); changeStatus(t.id, e.target.value); }} onClick={function(e) { e.stopPropagation(); }} title={sc.tip || "Set status"} style={{
                          minWidth: 20, fontSize: 8, padding: 0, borderRadius: 2,
                          border: "1px solid " + sc.color + "33", background: sc.bg, color: sc.color,
                          cursor: "pointer", textAlign: "center",
                        }}>
                          {STATUS_OPTIONS.map(function(o) { return <option key={o.value} value={o.value}>{o.label} {o.value ? o.value : "open"}</option>; })}
                        </select>
                        <span style={{ fontSize: 8, fontWeight: 700, color: TH.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>{tl}</span>
                        {item.locked && <span style={{ fontSize: 7 }} title={isHab ? (t.rigid ? "Anchored habit " + t.pri : "Slidable habit " + t.pri) : "Fixed — locked"}>{isHab ? (t.rigid ? "📌" : "🔁") : "📌"}</span>}
                        {isHab && <span style={{ fontSize: 7, fontWeight: 700, color: badge, background: badge + "22", padding: "0 2px", borderRadius: 2, lineHeight: "11px" }}>{t.pri}</span>}
                        {!isHab && <span style={{ fontSize: 7, fontWeight: 700, color: "white", background: badge, padding: "0 2px", borderRadius: 2, lineHeight: "11px" }}>{t.pri || "P3"}</span>}
                        {isSplit && <span style={{ fontSize: 7, fontWeight: 700, color: TH.purpleText, background: TH.purpleBg, padding: "0 2px", borderRadius: 2, lineHeight: "11px" }} title={"Part " + item.splitPart + " of " + item.splitTotal}>✂ {item.splitPart}/{item.splitTotal}</span>}
                        {t.dur && <span style={{ fontSize: 7, fontWeight: 600, color: TH.textMuted, background: TH.border, padding: "0 2px", borderRadius: 2, lineHeight: "11px" }}>{item.dur >= 60 ? (item.dur/60) + "h" : item.dur + "m"}{isSplit ? "/" + (t.dur >= 60 ? (t.dur/60) + "h" : t.dur + "m") : ""}</span>}
                        {t.timeRemaining != null && t.timeRemaining < (t.dur || 30) && !tiny && <span style={{ fontSize: 7, fontWeight: 700, color: TH.purpleText, background: TH.purpleBg, padding: "0 2px", borderRadius: 2, lineHeight: "11px" }}>{t.timeRemaining}m left</span>}
                        {!tiny && t.when && t.when !== "anytime" && t.when !== "fixed" && <span style={{ fontSize: 7, fontWeight: 600, color: "#7C3AED", background: "#7C3AED18", padding: "0 2px", borderRadius: 2, lineHeight: "11px" }} title={"when: " + t.when}>⏱{t.when}</span>}
                        {!tiny && t.where && t.where !== "anywhere" && (() => { var wIc = t.where === "home" ? "🏠" : t.where === "work" ? "🏢" : t.where === "phone" ? "📱" : t.where === "errand" ? "🚗" : "📍"; return <span style={{ fontSize: 7, fontWeight: 600, color: "#2563EB", background: "#2563EB18", padding: "0 2px", borderRadius: 2, lineHeight: "11px" }} title={"where: " + t.where}>{wIc}{t.where}</span>; })()}
                        {!closed && !tiny && t.due && (() => {
                          var dd = parseDate(t.due); if (!dd) return null;
                          var n = new Date(); n.setHours(0,0,0,0);
                          var dl = Math.round((dd - n) / 86400000);
                          var td2 = parseDate(t.date);
                          if ((td2 && td2 > dd) || dl < 0) return <span style={{ fontSize: 7, fontWeight: 700, color: "white", background: "#DC2626", padding: "0 2px", borderRadius: 2, lineHeight: "11px" }}>⚠</span>;
                          if (dl <= 2) return <span style={{ fontSize: 7, fontWeight: 700, color: TH.amberText, background: TH.amberBg, padding: "0 2px", borderRadius: 2, lineHeight: "11px" }}>{dl}d</span>;
                          return null;
                        })()}
                      </div>
                      <div style={{
                        fontSize: compact ? 9 : (isHab ? 10 : 11), fontWeight: isHab ? 400 : 500,
                        color: closed ? (st === "done" ? TH.greenText : st === "skip" ? TH.textMuted : TH.redText) : isHab ? TH.greenText : TH.text,
                        fontStyle: isHab ? "italic" : "normal",
                        textDecoration: closed ? "line-through" : "none",
                        lineHeight: compact ? "11px" : "14px",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        flex: 1, minWidth: 0,
                      }}>
                        {!isHab && <span style={{ color: (getProjectMeta(t.project) || {}).color || badge, fontWeight: 600, fontSize: compact ? 8 : 10 }}>{((getProjectMeta(t.project) || {}).icon || "") + (((getProjectMeta(t.project) || {}).icon) ? " " : "")}{t.project} · </span>}
                        {isHab && <span style={{ fontSize: 8 }}>🔁 </span>}
                        {t.text}
                      </div>
                      {!compact && !tiny && (
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {!isHab && (() => { var mt = migrateTask(t); if (mt.location.length === 0) return null; return (
                            <span style={{ fontSize: 7, color: TH.textMuted, background: TH.chipBg, padding: "0 2px", borderRadius: 2, lineHeight: "10px" }}>
                              {mt.location.map(function(lid) { var lo = locations.find(function(l) { return l.id === lid; }); return lo ? lo.icon + " " + lo.name : lid; }).join("+")}
                            </span>
                          ); })()}
                          {t.notes && !closed && (
                            <span style={{ fontSize: 7, color: TH.textMuted, fontStyle: "italic", lineHeight: "10px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}>
                              {t.notes.substring(0, 30)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* ── Expanded task panel (positioned below anchor tile inside grid) ── */}
              {(() => {
                var expItem = expandedTask ? positioned.find(function(p) { return p.task.id === expandedTask; }) : null;
                if (!expItem) return null;
                var anchorTop = (expItem.start - GRID_START * 60) * PX_PER_MIN;
                var anchorH = Math.max(24, Math.min(expItem.dur * PX_PER_MIN, 48));
                var panelTop = anchorTop + anchorH + 4;
                return (
                  <div ref={expandedPanelRef} style={{
                    position: "absolute", top: panelTop, left: 0, right: 0, zIndex: 50,
                    paddingBottom: 16,
                  }}>
                    {/* Small connector arrow */}
                    <div style={{
                      width: 0, height: 0, marginLeft: 40,
                      borderLeft: "8px solid transparent", borderRight: "8px solid transparent",
                      borderBottom: "8px solid " + TH.accent,
                    }} />
                    {/* Full-width task card */}
                    <div style={{
                      margin: "0 6px 8px",
                      border: "2px solid " + TH.accent,
                      borderRadius: 8,
                      overflow: "hidden",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.18), 0 0 0 1px " + TH.accent + "22",
                      background: TH.bgCard,
                    }}>
                      <TaskCard t={expItem.task} dateStr={dateKey} blocked={!!expItem.blocked} pastWindows={!!expItem.pastWindows} ctxRef={taskCardContextRef} />
                    </div>
                  </div>
                );
              })()}
            </div>
            {/* Scroll spacer — ensures expanded panel is scrollable */}
            {expandedTask && <div style={{ height: 400, pointerEvents: "none" }} />}
          </div>
        )}
      </div>
    );
  };

  // LIST VIEW — shows full week around selected date
  const ListView = () => {
    const weekTasks = weekStripDates.flatMap(date => {
      const key = formatDateKey(date);
      return (tasksByDate[key] || []).filter(filterTask).map(t => ({ ...t, _date: date }));
    });

    const grouped = {};
    weekTasks.forEach(t => {
      const key = formatDateKey(t._date);
      if (!grouped[key]) grouped[key] = { date: t._date, tasks: [] };
      grouped[key].tasks.push(t);
    });

    return (
      <div>
        {Object.values(grouped).map(({ date, tasks }) => {
          const isToday = isSameDay(date, today);
          const dk = formatDateKey(date);
          const section = tasks[0]?.section;
          const loc = getLocationForDate(dk);
          const isAway = loc.id !== "home";
          const blockedCount = tasks.filter(t => isTaskBlocked(t, dk)).length;
          return (
            <div key={dk} style={{ marginBottom: 12 }}>
              <div style={{
                padding: "8px 10px", borderRadius: "6px 6px 0 0",
                background: isToday ? TH.amberBg : isAway ? (darkMode ? "#431407" : "#FFEDD5") : TH.bgHover,
                borderBottom: isToday ? "2px solid #F59E0B" : isAway ? "2px solid #F97316" : "2px solid " + TH.border,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: isToday ? TH.amberText : TH.text }}>
                    {DAY_NAMES_FULL[date.getDay()]}, {MONTH_NAMES[date.getMonth()]} {date.getDate()}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {(() => {
                    var d2 = parseDate(dk);
                    var dn = d2 ? ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d2.getDay()] : "Mon";
                    var defaultTmplId = locScheduleDefaults[dn] || "weekday";
                    var overrideTmplId = locScheduleOverrides[dk];
                    var activeTmplId = overrideTmplId || defaultTmplId;
                    var activeTmpl = locSchedules[activeTmplId];
                    var isOv = !!overrideTmplId;
                    var templateIds = Object.keys(locSchedules);
                    return <select value={activeTmplId} onChange={function(e) {
                      var val = e.target.value;
                      if (val === "__reset__") {
                        setLocScheduleOverrides(function(prev) { var next = Object.assign({}, prev); delete next[dk]; return next; });
                        autoReschedule();
                      } else {
                        setLocScheduleOverrides(function(prev) { var next = Object.assign({}, prev); next[dk] = val; return next; });
                        autoReschedule();
                      }
                    }} style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, border: isOv ? "2px solid #7C3AED" : "1px solid " + TH.border, background: isOv ? (darkMode ? "#2E1065" : "#EDE9FE") : isAway ? "#F97316" : TH.border, color: isOv ? "#7C3AED" : isAway ? "white" : TH.textDim, cursor: "pointer", WebkitAppearance: "none", MozAppearance: "none", appearance: "none", paddingRight: 16, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M0 2l4 4 4-4z' fill='%23666'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center" }}>
                      {templateIds.map(function(tid) {
                        var t = locSchedules[tid];
                        var isDef = tid === defaultTmplId;
                        return <option key={tid} value={tid}>{(t.icon || "📅") + " " + t.name + (isDef ? " ★" : "")}</option>;
                      })}
                      {isOv && <option value="__reset__">↩ Reset to default</option>}
                    </select>;
                  })()}
                  {blockedCount > 0 && <span style={{ fontSize: 10, color: "#9A3412", fontWeight: 600 }}>🚫{blockedCount}</span>}
                  <span style={{ fontSize: 11, color: TH.textDim, fontWeight: 500 }}>{tasks.length} items</span>
                </div>
              </div>
              <div style={{ background: TH.white, borderRadius: "0 0 6px 6px", border: "1px solid " + TH.border, borderTop: 0, padding: 4 }}>
                {tasks.map(t => <TaskCard key={t.id} t={t} dateStr={dk} ctxRef={taskCardContextRef} />)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{
      fontFamily: "'DM Sans', 'SF Pro Display', system-ui, sans-serif",
      maxWidth: 1200,
      margin: "0 auto",
      padding: "12px",
      background: TH.bg,
      color: TH.text,
      minHeight: "100vh",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />

      {/* HEADER BAR — minimal with drawer */}
      <div style={{
        background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
        borderRadius: 8,
        padding: "4px 10px",
        marginBottom: 8,
        color: "white",
        position: "relative",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.5px" }}>📅</span>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, background: TH.progressBg, borderRadius: 3, height: 4, overflow: "hidden" }}>
              <div style={{ background: "linear-gradient(90deg, #4ADE80, #22D3EE)", height: "100%", width: `${pct}%`, borderRadius: 3, transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: 8, color: TH.textDim, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>
              {counts.done}/{allTasks.length}
            </span>
          </div>
          <span style={{ fontSize: 8, color: saving ? "#FBBF24" : savedFlash._undo ? "#60A5FA" : "#4ADE80" }}>{saving ? "⏳" : savedFlash._undo ? "↩" : "✓"}</span>
          <button onClick={() => setDarkMode(d => !d)} style={{
            padding: "2px 6px", borderRadius: 3, fontSize: 9, cursor: "pointer",
            border: "none", background: "transparent", color: darkMode ? "#FBBF24" : TH.textDim,
          }}>{darkMode ? "☀️" : "🌙"}</button>
          <button onClick={() => setShowHeaderMenu(m => !m)} style={{
            padding: "2px 8px", borderRadius: 3, fontSize: 12, cursor: "pointer",
            border: "none", background: showHeaderMenu ? "#334155" : "transparent", color: TH.textDim,
          }}>{showHeaderMenu ? "✕" : "☰"}</button>
        </div>
        {showHeaderMenu && (
          <div style={{
            position: "absolute", top: "100%", right: 0, zIndex: 100,
            background: "#1E293B", borderRadius: "0 0 8px 8px", padding: "8px 12px",
            border: "1px solid #334155", borderTop: "none",
            display: "flex", flexDirection: "column", gap: 4, minWidth: 160,
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          }}>
            {[
              { label: "↩ Undo" + (undoStackRef.current.length > 0 ? " (" + undoStackRef.current.length + ")" : ""), action: () => { popUndo(); }, c: "#E2E8F0", disabled: undoStackRef.current.length === 0 },
              { label: showExport ? "✕ Close Export" : "📤 Export", action: handleExport, active: showExport, c: "#4ADE80" },
              { label: showStatePanel ? "✕ Close State" : "💾 State", action: () => setShowStatePanel(p => !p), active: showStatePanel, c: "#60A5FA" },
              { label: "\u{1F514} Toasts" + (toastHistory.length > 0 ? " (" + toastHistory.length + ")" : ""), action: () => { setShowToastHistory(p => !p); }, active: showToastHistory, c: "#F59E0B" },
              { label: "\u{1F504} Reschedule", action: () => { try { autoReschedule(); } catch(e) { showToast("Reschedule error: " + e.message, "error"); } }, c: "#F59E0B" },
              { label: "📋 Copy Schedule", action: copySchedule, c: "#06B6D4" },
              { label: "\u{1F501} Recurring", action: () => { var cr = generateRecurring(new Date(), new Date(Date.now() + 13*86400000)); showToast("Generated " + cr + " recurring instances for next 14 days", "success"); }, c: "#059669" },
              { label: (showSettings ? "✕ Close" : "⚙️") + " Settings", action: () => setShowSettings(p => !p), active: showSettings, c: "#8B5CF6" },
              { label: "📅 Export .ics", action: exportICS, c: "#94A3B8" },
              { label: gcalSyncing ? "⏳ Syncing..." : "📅 Sync GCal", action: openGcalSync, c: "#4285F4", disabled: gcalSyncing },
              { label: "❓ Help / Shortcuts", action: () => { setShowHelp(true); }, c: "#06B6D4" },
            ].map((item, i) => (
              <button key={i} onClick={(e) => { e.stopPropagation(); setShowHeaderMenu(false); item.action(); }} disabled={item.disabled} style={{
                padding: "5px 10px", borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: item.disabled ? "default" : "pointer",
                border: "1px solid " + item.c + "44", background: item.active ? item.c : item.c + "18",
                color: item.active ? "#0F172A" : item.c, textAlign: "left",
                opacity: item.disabled ? 0.4 : 1,
              }}>{item.label}</button>
            ))}
            <div style={{ borderTop: "1px solid #334155", paddingTop: 4, marginTop: 2, display: "flex", gap: 8, fontSize: 8, color: TH.textMuted }}>
              <span>{pct}% done</span>
              {counts.wip > 0 && <span style={{ color: "#FBBF24" }}>⏳{counts.wip}</span>}
              {counts.other > 0 && <span style={{ color: "#A78BFA" }}>→{counts.other}</span>}
              {counts.cancel > 0 && <span style={{ color: "#F87171" }}>✕{counts.cancel}</span>}
              <span>{counts.open} open</span>
            </div>
          </div>
        )}
      </div>

      {/* WEEK STRIP + DAY NAV */}
      <div style={{
        marginBottom: 8, padding: "6px 10px",
        background: TH.bgCard, borderRadius: 8, border: "1px solid " + TH.border,
      }}>
        {/* Top row: nav + controls */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
          {/* Day nav */}
          <button onClick={() => setDayOffset(d => Math.max(d - 1, minDayOffset))} style={{
            width: 28, height: 28, borderRadius: 6, border: "1px solid " + TH.border, background: TH.white,
            cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: TH.textMuted,
          }}>‹</button>
          <button onClick={() => setDayOffset(0)} style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            border: dayOffset === 0 ? "1.5px solid " + TH.accent : "1px solid " + TH.border,
            background: dayOffset === 0 ? TH.blueBg : TH.bgCard, color: dayOffset === 0 ? TH.accent : TH.textMuted,
          }}>Today</button>
          <input type="date" value={(() => {
            var d = selectedDate;
            return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
          })()} onChange={(e) => {
            var d = new Date(e.target.value + "T12:00:00");
            if (!isNaN(d)) setDayOffset(Math.round((d - today) / 86400000));
          }} style={{
            padding: "3px 4px", borderRadius: 6, fontSize: 10, border: "1px solid " + TH.border,
            background: TH.white, color: TH.textMuted, cursor: "pointer",
          }} title="Jump to any date" />
          <button onClick={() => setDayOffset(d => Math.min(d + 1, maxDayOffset))} style={{
            width: 28, height: 28, borderRadius: 6, border: "1px solid " + TH.border, background: TH.white,
            cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: TH.textMuted,
          }}>›</button>

          <div style={{ flex: 1 }} />

          {/* View toggle */}
          {[["day","Day"],["3day","3-Day"],["week","Week"],["month","Month"],["list","List"],["priority","Pri"],["conflicts","\u26A0\uFE0F"]].map(([k,l]) => (
            <button key={k} onClick={() => setViewMode(k)} style={{
              padding: "4px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
              border: viewMode === k ? "1.5px solid " + TH.accent : "1px solid " + TH.border,
              background: viewMode === k ? TH.accent : TH.bgCard, color: viewMode === k ? "white" : TH.textMuted,
            }}>{l}</button>
          ))}

          {/* Hide habits */}
          <button onClick={() => setHideHabits(!hideHabits)} style={{
            padding: "4px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
            border: hideHabits ? "1.5px solid " + TH.greenBorder : "1px solid " + TH.border,
            background: hideHabits ? TH.greenBg : TH.bgCard, color: hideHabits ? TH.greenText : TH.textMuted,
          }}>{hideHabits ? "Show Habits" : "Hide Habits"}</button>

          {/* Filters */}
          {[["all","All"],["open","Open"],["action","Action"],["done","Done"],["blocked","🚫 Blocked"],["unplaced","📭 Unplaced" + ((schedResultRef.current.unplaced || []).length > 0 ? " (" + (schedResultRef.current.unplaced || []).length + ")" : "")]].map(([k,l]) => (
            <button key={k} onClick={() => setFilter(k)} style={{
              padding: "4px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
              border: filter === k ? "1.5px solid " + TH.accent : k === "unplaced" && (schedResultRef.current.unplaced || []).length > 0 ? "1.5px solid #F59E0B" : "1px solid " + TH.border,
              background: filter === k ? TH.accent : k === "unplaced" && (schedResultRef.current.unplaced || []).length > 0 ? TH.amberBg : TH.bgCard,
              color: filter === k ? "white" : k === "unplaced" && (schedResultRef.current.unplaced || []).length > 0 ? TH.amberText : TH.textMuted,
            }}>{l}</button>
          ))}
        </div>

        {/* Week strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {weekStripDates.map((date, i) => {
            const key = formatDateKey(date);
            const isSelected = isSameDay(date, selectedDate);
            const isTod = isSameDay(date, today);
            const dayTaskCount = (tasksByDate[key] || []).length;
            const loc = getLocationForDate(key);
            const isAway = loc.id !== "home";

            return (
              <button key={i} onClick={() => {
                const diff = Math.round((date - today) / 86400000);
                setDayOffset(diff);
              }} style={{
                padding: "4px 4px",
                borderRadius: 6,
                border: isSelected ? "2px solid " + TH.accent : isTod ? "1.5px solid #F59E0B" : "1px solid " + TH.border,
                background: isSelected ? TH.blueBg : isTod ? TH.amberBg : isAway ? (darkMode ? "#431407" : "#FFF7ED") : TH.bgCard,
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s",
              }}>
                <div style={{
                  fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                  color: isSelected ? TH.accent : TH.textDim, letterSpacing: "0.5px",
                }}>{DAY_NAMES[date.getDay()]}</div>
                <div style={{
                  fontSize: 15, fontWeight: 700, lineHeight: 1.2,
                  color: isSelected ? TH.accent : isTod ? TH.amberText : TH.text,
                }}>{date.getDate()}</div>
                {dayTaskCount > 0 && (
                  <div style={{
                    fontSize: 8, fontWeight: 600, marginTop: 2,
                    color: isSelected ? TH.accent : TH.textDim,
                  }}>{dayTaskCount} {isAway ? loc.icon : ""}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* SEARCH */}
      <div style={{ marginBottom: 10, position: "relative" }}>
        <input
          type="text"
          placeholder="Search tasks by project, name, notes, or ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: "100%", fontSize: 12, padding: "8px 32px 8px 32px",
            border: "1px solid " + TH.border, borderRadius: 8,
            background: TH.white, color: TH.text, outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={e => { e.target.style.borderColor = "#2563EB"; e.target.style.boxShadow = "0 0 0 2px #2563EB22"; }}
          onBlur={e => { e.target.style.borderColor = TH.border; e.target.style.boxShadow = "none"; }}
        />
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: TH.textDim }}>🔍</span>
        {search && (
          <button onClick={() => setSearch("")} style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            background: TH.bgHover, border: "none", cursor: "pointer", fontSize: 10, color: TH.textMuted,
            padding: "2px 6px", borderRadius: 4, fontWeight: 600,
          }}>Clear</button>
        )}
      </div>

      {/* CALENDAR BODY */}
      {(() => { console.log("[RENDER] view start: " + viewMode + " at " + (performance.now() - _renderStart).toFixed(0) + "ms"); try { return viewMode === "day" ? DayView() : viewMode === "3day" ? MultiDayView() : viewMode === "week" ? WeekView() : viewMode === "month" ? MonthView() : viewMode === "list" ? ListView() : viewMode === "priority" ? PriorityView() : ConflictsView(); } catch(viewErr) { console.error("View crash (" + viewMode + "):", viewErr); return <div style={{ padding: 20, textAlign: "center" }}><div style={{ fontSize: 14, color: TH.redText, fontWeight: 700, marginBottom: 8 }}>{"\u26A0"} {viewMode} view crashed</div><pre style={{ fontSize: 10, color: TH.textMuted, background: TH.bgHover, padding: 8, borderRadius: 6, textAlign: "left", maxWidth: 400, margin: "0 auto", overflow: "auto" }}>{String(viewErr)}</pre><button onClick={() => setViewMode("list")} style={{ marginTop: 12, padding: "6px 16px", borderRadius: 6, border: "none", background: TH.accent, color: "white", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>Switch to List View</button></div>; } })()}

      {/* PARKING LOT + TO BE SCHEDULED */}
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setShowParking(!showParking)} style={{
          width: "100%", padding: "10px 12px", borderRadius: 8,
          border: "1px solid " + TH.border, background: TH.white, cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 12, fontWeight: 600, color: TH.textMuted,
        }}>
          <span>🅿️ Parking Lot ({parkingLot.length}) + Templates ({toBeSched.length})</span>
          <span style={{ fontSize: 16, transform: showParking ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
        </button>
        {showParking && (
          <div style={{ background: TH.white, border: "1px solid " + TH.border, borderTop: 0, borderRadius: "0 0 8px 8px", padding: 8 }}>
            {parkingLot.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: TH.textMuted, textTransform: "uppercase", marginBottom: 4, letterSpacing: "0.5px" }}>Parking Lot</div>
                {parkingLot.map(t => <TaskCard key={t.id} t={t} ctxRef={taskCardContextRef} />)}
              </div>
            )}
            {toBeSched.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: TH.textMuted, textTransform: "uppercase", marginBottom: 4, letterSpacing: "0.5px" }}>Recurring Source Tasks</div>
                {toBeSched.map(t => <TaskCard key={t.id} t={t} ctxRef={taskCardContextRef} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Export fallback */}
      {showExport && (
        <div style={{ marginTop: 12, background: TH.exportBg, border: "1.5px solid " + TH.exportBorder, borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: TH.greenText }}>Copy for refresh:</span>
            <button onClick={() => setShowExport(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: TH.muted2 }}>✕</button>
          </div>
          <textarea readOnly value={buildExport()} style={{
            width: "100%", height: 200, fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
            border: "1px solid #D1D5DB", borderRadius: 4, padding: 8, resize: "vertical",
            background: TH.white, color: TH.text, boxSizing: "border-box",
          }} onFocus={e => e.target.select()} />
        </div>
      )}

      {/* ── Settings / Config Panel ── */}
      {showSettings && (
        <div onClick={() => setShowSettings(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: TH.settingsBg, borderRadius: 12, maxWidth: 820, width: "100%",
            maxHeight: "85vh", overflowY: "auto", padding: "16px 20px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)", WebkitOverflowScrolling: "touch",
            border: "1.5px solid " + TH.settingsBorder,
          }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: TH.settingsLabel }}>{"\u2699\uFE0F"} Settings</span>
            <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: TH.muted2 }}>{"\u2715"}</button>
          </div>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 3, marginBottom: 10, flexWrap: "wrap" }}>
            {[["schedule", "\u{1F552} Schedule"], ["locations", "\u{1F4CD} Locations"], ["tools", "\u{1F527} Tools"], ["matrix", "\u{1F517} Availability"], ["weekly", "\u{1F4C5} Schedules"], ["projects", "\u{1F4C1} Projects"]].map(function(tb) {
              var sel = configTab === tb[0];
              return <button key={tb[0]} onClick={() => setConfigTab(tb[0])} style={{ padding: "4px 10px", borderRadius: 6, border: sel ? "2px solid " + TH.purpleBorder : "1px solid " + TH.purpleBorder + "66", background: sel ? TH.settingsTabActive : TH.settingsTabBg, fontSize: 10, fontWeight: sel ? 700 : 500, color: TH.settingsLabel, cursor: "pointer" }}>{tb[1]}</button>;
            })}
          </div>

          {/* Schedule tab — Per-Day Visual Time Block Editor */}
          {configTab === "schedule" && (function() {
            var recurSources = allTasks.filter(function(t) { return t.recur && t.recur.type !== "none"; });
            var genSection = sSection("\u{1F501} Generate Recurring Instances",
              recurSources.length + " recurring source tasks (" + recurSources.filter(function(t){return t.recur.type==="daily"}).length + " daily, " + recurSources.filter(function(t){return t.recur.type!=="daily"}).length + " periodic)",
              "green",
              $("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" } },
                sBtn("Next 7 days", function() { var c = generateRecurring(new Date(), new Date(Date.now() + 6*86400000)); showToast("Generated " + c + " recurring instances for next 7 days", "success"); }, { fs: 9, pad: "3px 8px", br: 4, bc: "#059669", bg: "#059669", c: "white" }),
                sBtn("Next 14 days", function() { var c = generateRecurring(new Date(), new Date(Date.now() + 13*86400000)); showToast("Generated " + c + " recurring instances for next 14 days", "success"); }, { fs: 9, pad: "3px 8px", br: 4, bc: "#059669", bg: TH.white, c: "#059669" }),
                sBtn("Next 28 days", function() { var c = generateRecurring(new Date(), new Date(Date.now() + 27*86400000)); showToast("Generated " + c + " recurring instances for next 28 days", "success"); }, { fs: 9, pad: "3px 8px", br: 4, bc: "#059669", bg: TH.white, c: "#059669" })
              )
            );

            var splitSection = sSection("\u2702 Task Splitting Defaults",
              "When a task can't fit in one slot, split it across available gaps. Per-task overrides in edit form.",
              "purple",
              $("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } },
                $("label", { style: { display: "flex", gap: 4, alignItems: "center", fontSize: 10, color: TH.text } },
                  "Allow splitting:",
                  sBtn(splitDefault ? "\u2702 On" : "Off", function() { setSplitDefault(!splitDefault); }, {
                    pad: "3px 10px", br: 4, bc: splitDefault ? TH.greenBorder : TH.btnBorder,
                    bg: splitDefault ? TH.greenBg : TH.inputBg, c: splitDefault ? TH.greenText : TH.textMuted,
                  })
                ),
                $("label", { style: { display: "flex", gap: 4, alignItems: "center", fontSize: 10, color: TH.text } },
                  "Min chunk:",
                  $("select", { value: splitMinDefault, onChange: function(e) { setSplitMinDefault(parseInt(e.target.value)); }, style: { fontSize: 10, padding: "2px 4px", borderRadius: 4, border: "1px solid " + TH.btnBorder, background: TH.inputBg, color: TH.inputText } },
                    [10,15,20,30,45,60].map(function(v) { return $("option", { key: v, value: v }, v < 60 ? v + " min" : "1 hour"); })
                  )
                )
              )
            );

            var dayBlocks = (timeBlocks[schedEditDay] || []).slice().sort(function(a, b) { return a.start - b.start; });
            function setDayBlocks(nb) {
              nb.sort(function(a, b) { return a.start - b.start; });
              setTimeBlocks(Object.assign({}, timeBlocks, { [schedEditDay]: nb }));
            }
            var barStart = 300, barEnd = 1440, totalMin = barEnd - barStart;
            function pct(m) { return ((m - barStart) / totalMin * 100).toFixed(2) + "%"; }
            function fmt(m) { var h = Math.floor(m/60); var mm = m%60; return (h > 12 ? h-12 : (h === 0 ? 12 : h)) + ":" + (mm<10?"0":"") + mm + (h>=12?"p":"a"); }
            function fmtL(m) { var h = Math.floor(m/60); var mm = m%60; return (h > 12 ? h-12 : (h === 0 ? 12 : h)) + ":" + (mm<10?"0":"") + mm + " " + (h>=12?"PM":"AM"); }
            var hours = [];
            for (var hh = Math.ceil(barStart/60); hh * 60 <= barEnd; hh++) hours.push(hh);
            var colors = ["#F59E0B","#2563EB","#059669","#7C3AED","#DC2626","#1E293B","#0891B2","#DB2777","#4F46E5","#65A30D"];

            return <div>
              <div style={{ fontSize: 9, color: TH.purpleText, marginBottom: 6 }}>Each day has its own schedule. Tap a block to edit. Tasks need a matching tag to be placed in that window.</div>

              {/* Day-of-week selector */}
              <div style={{ display: "flex", gap: 3, marginBottom: 8, flexWrap: "wrap" }}>
                {DAY_NAMES.map(function(dn) {
                  var isSel = schedEditDay === dn;
                  var isWE = dn === "Sat" || dn === "Sun";
                  return <button key={dn} onClick={function() { setSchedEditDay(dn); setSelectedBlockId(null); }}
                    style={{ padding: "4px 10px", borderRadius: 6, border: isSel ? "2px solid #7C3AED" : "1px solid " + (isWE ? "#F59E0B55" : "#C4B5FD"), background: isSel ? "#DDD6FE" : isWE ? "#FFFBEB" : "white", fontSize: 10, fontWeight: isSel ? 700 : 500, color: isSel ? "#5B21B6" : isWE ? "#B45309" : "#5B21B6", cursor: "pointer" }}>{dn}</button>;
                })}
              </div>

              {/* Clone buttons */}
              <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap" }}>
                {(function() {
                  function cloneTo(days) { var nb = Object.assign({}, timeBlocks); days.forEach(function(d) { nb[d] = cloneBlocks(dayBlocks); }); setTimeBlocks(nb); }
                  var isWE = schedEditDay === "Sat" || schedEditDay === "Sun";
                  return [
                    sBtn("📋 Clone → All Weekdays", function() { cloneTo(["Mon","Tue","Wed","Thu","Fri"]); }, { fs: 9, pad: "3px 8px", br: 4, bc: "#93C5FD", bg: TH.blueBg, c: "#2563EB" }),
                    schedEditDay === "Sat" && sBtn("📋 Clone Sat → Sun", function() { cloneTo(["Sun"]); }, { fs: 9, pad: "3px 8px", br: 4, bc: "#FCD34D", bg: TH.amberBg, c: "#B45309" }),
                    schedEditDay === "Sun" && sBtn("📋 Clone Sun → Sat", function() { cloneTo(["Sat"]); }, { fs: 9, pad: "3px 8px", br: 4, bc: "#FCD34D", bg: TH.amberBg, c: "#B45309" }),
                    !isWE && sBtn("📋 Clone → Other Weekdays", function() { cloneTo(["Mon","Tue","Wed","Thu","Fri"].filter(function(d) { return d !== schedEditDay; })); }, { fs: 9, pad: "3px 8px", br: 4 }),
                  ];
                })()}
              </div>

              {/* Visual Timeline Bar */}
              <div style={{ position: "relative", height: 38, background: TH.progressBg, borderRadius: 6, overflow: "hidden", border: "1px solid " + TH.btnBorder, marginBottom: 2 }}>
                {dayBlocks.map(function(b) {
                  var isSel = selectedBlockId === b.id;
                  return <div key={b.id} onClick={function() { setSelectedBlockId(isSel ? null : b.id); }}
                    title={b.name + " (" + b.tag + "): " + fmt(b.start) + " – " + fmt(b.end)}
                    style={{
                      position: "absolute", top: 2, bottom: 2,
                      left: pct(b.start), width: ((b.end - b.start) / totalMin * 100).toFixed(2) + "%",
                      background: b.color + (isSel ? "" : "CC"), borderRadius: 4, cursor: "pointer",
                      border: isSel ? "2px solid #0F172A" : "1px solid " + b.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden", padding: "0 2px", transition: "all 0.15s",
                    }}>
                    <span style={{ fontSize: (b.end - b.start) > 90 ? 9 : 7, color: "white", fontWeight: 700, textShadow: "0 1px 2px rgba(0,0,0,0.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {b.icon + " " + b.name}
                    </span>
                  </div>;
                })}
              </div>
              {/* Hour ticks */}
              <div style={{ position: "relative", height: 14, marginBottom: 6 }}>
                {hours.filter(function(h) { return h % 2 === 0 || totalMin < 900; }).map(function(h) {
                  return <span key={h} style={{ position: "absolute", left: pct(h * 60), transform: "translateX(-50%)", fontSize: 7, color: TH.textDim, top: 1 }}>{fmt(h * 60)}</span>;
                })}
              </div>

              {/* Selected Block Editor */}
              {selectedBlockId && (function() {
                var idx = dayBlocks.findIndex(function(b) { return b.id === selectedBlockId; });
                if (idx === -1) return null;
                var b = dayBlocks[idx];
                function updateBlock(field, val) {
                  var nb = dayBlocks.slice(); nb[idx] = Object.assign({}, nb[idx]); nb[idx][field] = val;
                  // Auto-resolve overlaps: adjust neighbors to make room
                  if (field === "start" || field === "end") {
                    var me = nb[idx];
                    // Ensure own start < end
                    if (me.start >= me.end) {
                      if (field === "start") me.end = Math.min(me.start + 15, 1440);
                      else me.start = Math.max(me.end - 15, 0);
                    }
                    for (var oi = 0; oi < nb.length; oi++) {
                      if (oi === idx) continue;
                      var other = nb[oi] = Object.assign({}, nb[oi]);
                      // If edited block overlaps another, shrink the other
                      if (me.start < other.end && me.end > other.start) {
                        if (other.start < me.start) {
                          // Other starts before me — trim its end
                          other.end = me.start;
                        } else {
                          // Other starts inside me — push its start forward
                          other.start = me.end;
                        }
                        // If shrunk to nothing, remove it
                        if (other.start >= other.end) { nb.splice(oi, 1); if (oi < idx) idx--; oi--; }
                      }
                    }
                  }
                  setDayBlocks(nb);
                }
                var timeOpts = [];
                for (var tm = 0; tm <= 1440; tm += 15) timeOpts.push(tm);

                return <div style={{ background: TH.white, border: "2px solid " + b.color, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: b.color }}>{b.icon} {b.name}</span>
                    <button onClick={function() { setDayBlocks(dayBlocks.filter(function(x) { return x.id !== selectedBlockId; })); setSelectedBlockId(null); }}
                      style={{ fontSize: 10, color: TH.redText, background: TH.redBg, border: "1px solid #FECACA", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                      {"\u{1F5D1}"} Delete
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ fontSize: 10, fontWeight: 600, color: TH.settingsLabel, display: "flex", flexDirection: "column", gap: 2 }}>
                      Name
                      <input value={b.name} onChange={function(e) { updateBlock("name", e.target.value); }} style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #C4B5FD", borderRadius: 4, width: 80 }} />
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: TH.settingsLabel, display: "flex", flexDirection: "column", gap: 2 }}>
                      Tag
                      <input value={b.tag} onChange={function(e) { updateBlock("tag", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")); }} style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #C4B5FD", borderRadius: 4, width: 60 }} />
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: TH.settingsLabel, display: "flex", flexDirection: "column", gap: 2 }}>
                      Icon
                      <input value={b.icon || ""} onChange={function(e) { updateBlock("icon", e.target.value); }} style={{ fontSize: 14, padding: "1px 4px", border: "1px solid #C4B5FD", borderRadius: 4, width: 32, textAlign: "center" }} />
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: TH.settingsLabel, display: "flex", flexDirection: "column", gap: 2 }}>
                      Start
                      <select value={b.start} onChange={function(e) { updateBlock("start", parseInt(e.target.value)); }} style={{ fontSize: 10, padding: "3px 4px", border: "1px solid #C4B5FD", borderRadius: 4 }}>
                        {timeOpts.map(function(m) { return <option key={m} value={m}>{fmtL(m)}</option>; })}
                      </select>
                    </label>
                    <label style={{ fontSize: 10, fontWeight: 600, color: TH.settingsLabel, display: "flex", flexDirection: "column", gap: 2 }}>
                      End
                      <select value={b.end} onChange={function(e) { updateBlock("end", parseInt(e.target.value)); }} style={{ fontSize: 10, padding: "3px 4px", border: "1px solid #C4B5FD", borderRadius: 4 }}>
                        {timeOpts.map(function(m) { return <option key={m} value={m}>{fmtL(m)}</option>; })}
                      </select>
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 9, fontWeight: 600, color: TH.settingsLabel, marginRight: 4 }}>Color:</span>
                    {colors.map(function(c) {
                      return <div key={c} onClick={function() { updateBlock("color", c); }}
                        style={{ width: 16, height: 16, borderRadius: "50%", background: c, cursor: "pointer", border: b.color === c ? "2px solid #0F172A" : "2px solid transparent" }} />;
                    })}
                  </div>
                </div>;
              })()}

              {/* Add / Reset */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={function() {
                  var last = dayBlocks.length > 0 ? dayBlocks[dayBlocks.length - 1] : null;
                  var newStart = last ? last.end : 360;
                  var newEnd = Math.min(newStart + 120, 1440);
                  if (newStart >= 1440) return;
                  var newBlock = { id: "block_" + Date.now(), tag: "new", name: "New Block", start: newStart, end: newEnd, color: TH.textDim, icon: "📋" };
                  // Resolve overlaps with existing blocks
                  var nb = dayBlocks.slice();
                  for (var oi = 0; oi < nb.length; oi++) {
                    var other = nb[oi];
                    if (newBlock.start < other.end && newBlock.end > other.start) {
                      nb[oi] = Object.assign({}, other);
                      if (nb[oi].start < newBlock.start) {
                        nb[oi].end = newBlock.start;
                      } else {
                        nb[oi].start = newBlock.end;
                      }
                      if (nb[oi].start >= nb[oi].end) { nb.splice(oi, 1); oi--; }
                    }
                  }
                  nb.push(newBlock);
                  setDayBlocks(nb);
                  setSelectedBlockId(newBlock.id);
                }} style={{ fontSize: 10, fontWeight: 600, color: TH.settingsLabel, background: TH.purpleBg, border: "1px solid #C4B5FD", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>
                  + Add Block
                </button>
                <button onClick={function() {
                  var isWE = schedEditDay === "Sat" || schedEditDay === "Sun";
                  setDayBlocks(cloneBlocks(isWE ? DEFAULT_WEEKEND_BLOCKS : DEFAULT_WEEKDAY_BLOCKS));
                  setSelectedBlockId(null);
                }} style={{ fontSize: 10, color: TH.muted2, background: TH.bgHover, border: "1px solid " + TH.border, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                  Reset {schedEditDay}
                </button>
                <button onClick={function() { setTimeBlocks(JSON.parse(JSON.stringify(DEFAULT_TIME_BLOCKS))); setSelectedBlockId(null); }}
                  style={{ fontSize: 10, color: TH.muted2, background: TH.bgHover, border: "1px solid " + TH.border, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                  Reset All Days
                </button>
              </div>

              {/* Block summary */}
              <div style={{ marginTop: 8, fontSize: 9, color: TH.textDim, lineHeight: "15px" }}>
                {dayBlocks.map(function(b) {
                  return <div key={b.id}><span style={{ color: b.color, fontWeight: 700 }}>{b.icon} {b.name}</span> <span style={{ color: TH.purpleText }}>({b.tag})</span> {fmt(b.start)}–{fmt(b.end)}</div>;
                })}
                {dayBlocks.length === 0 && <div style={{ fontStyle: "italic" }}>No blocks — nothing will be scheduled on {schedEditDay}.</div>}
                <div style={{ marginTop: 3, fontStyle: "italic" }}>Anytime/no tag → any block. Fixed → bypasses blocks.</div>
              </div>

              {/* Recurring + Splitting sections */}
              {genSection}
              {splitSection}
              {sSection("\u23F0 Earliest Scheduling Time", "Auto-reschedule won't place tasks before this time on any day.", "blue",
                $("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
                  $("select", { value: schedFloor, onChange: function(e) { setSchedFloor(parseInt(e.target.value)); }, style: { fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid " + TH.blueBorder, background: TH.inputBg, color: TH.inputText } },
                    [300,330,360,390,420,450,480,510,540,600].map(function(m) {
                      var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "PM" : "AM", dh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
                      return $("option", { key: m, value: m }, dh + ":" + (mm < 10 ? "0" : "") + mm + " " + ap);
                    })
                  ),
                  $("span", { style: { fontSize: 9, color: TH.textMuted } }, "Currently: " + (function() { var h = Math.floor(schedFloor/60), mm = schedFloor%60, ap = h >= 12 ? "PM" : "AM", dh = h > 12 ? h - 12 : (h === 0 ? 12 : h); return dh + ":" + (mm<10?"0":"") + mm + " " + ap; })())
                )
              )}
            </div>;
          })()}

          {/* Locations tab */}
          {configTab === "locations" && (
            <div>
              <div style={{ fontSize: 10, color: TH.muted2, marginBottom: 6 }}>Where you physically are. Scheduler matches task location to day location.</div>
              {locations.map(function(loc, idx) {
                return editableListRow(loc, idx, locations, setLocations,
                  function(item, i) {
                    return $("input", { value: item.id, onChange: function(e) {
                      var newId = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                      var nl = locations.slice(); var oldId = nl[i].id; nl[i] = Object.assign({}, nl[i], { id: newId }); setLocations(nl);
                      if (oldId !== newId && toolMatrix[oldId]) { var nm = Object.assign({}, toolMatrix); nm[newId] = nm[oldId]; delete nm[oldId]; setToolMatrix(nm); }
                      setLocSchedules(function(prev) { var next = JSON.parse(JSON.stringify(prev)); Object.keys(next).forEach(function(k) { var h = next[k].hours; Object.keys(h).forEach(function(m) { if (h[m] === oldId) h[m] = newId; }); }); return next; });
                    }, style: { width: 60, fontSize: 9, padding: "2px 4px", border: "1px solid #D1D5DB", borderRadius: 3, color: TH.muted2, fontFamily: "monospace" }, placeholder: "id" });
                  },
                  function(item) { var nl = locations.filter(function(l) { return l.id !== item.id; }); setLocations(nl); var nm = Object.assign({}, toolMatrix); delete nm[item.id]; setToolMatrix(nm); }
                );
              })}
              {sBtn("+ Add Location", function() {
                var newId = "loc" + (locations.length + 1);
                setLocations(locations.concat([{ id: newId, name: "New Location", icon: "\u{1F4CD}" }]));
                setToolMatrix(Object.assign({}, toolMatrix, { [newId]: [] }));
              }, { bc: "#C4B5FD", bg: TH.white, c: TH.settingsLabel, style: { marginTop: 6 } })}
            </div>
          )}

          {/* Tools tab */}
          {configTab === "tools" && (
            <div>
              <div style={{ fontSize: 10, color: TH.muted2, marginBottom: 6 }}>What a task needs. Scheduler checks if the tool is available at today's location.</div>
              {tools.map(function(tool, idx) {
                return editableListRow(tool, idx, tools, setTools,
                  function(item, i) {
                    return $("input", { value: item.id, onChange: function(e) {
                      var newId = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                      var nt = tools.slice(); var oldId = nt[i].id; nt[i] = Object.assign({}, nt[i], { id: newId }); setTools(nt);
                      var nm = Object.assign({}, toolMatrix);
                      Object.keys(nm).forEach(function(locId) { nm[locId] = nm[locId].map(function(tid) { return tid === oldId ? newId : tid; }); });
                      setToolMatrix(nm);
                    }, style: { width: 70, fontSize: 9, padding: "2px 4px", border: "1px solid #D1D5DB", borderRadius: 3, color: TH.muted2, fontFamily: "monospace" }, placeholder: "id" });
                  },
                  function(item) {
                    setTools(tools.filter(function(t) { return t.id !== item.id; }));
                    var nm = Object.assign({}, toolMatrix);
                    Object.keys(nm).forEach(function(locId) { nm[locId] = nm[locId].filter(function(tid) { return tid !== item.id; }); });
                    setToolMatrix(nm);
                  }
                );
              })}
              {sBtn("+ Add Tool", function() {
                setTools(tools.concat([{ id: "tool" + (tools.length + 1), name: "New Tool", icon: "\u{1F527}" }]));
              }, { bc: "#C4B5FD", bg: TH.white, c: TH.settingsLabel, style: { marginTop: 6 } })}
            </div>
          )}

          {/* Availability Matrix tab */}
          {configTab === "matrix" && (
            <div>
              <div style={{ fontSize: 10, color: TH.muted2, marginBottom: 6 }}>Tap to toggle which tools are available at each location.</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "4px 8px", textAlign: "left", borderBottom: "2px solid #C4B5FD", color: TH.settingsLabel }}></th>
                      {tools.map(function(tool) {
                        return <th key={tool.id} style={{ padding: "4px 6px", textAlign: "center", borderBottom: "2px solid #C4B5FD", color: TH.settingsLabel, fontSize: 16 }} title={tool.name}>{tool.icon}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map(function(loc) {
                      var available = toolMatrix[loc.id] || [];
                      return <tr key={loc.id}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: TH.text, whiteSpace: "nowrap" }}>{loc.icon} {loc.name}</td>
                        {tools.map(function(tool) {
                          var has = available.indexOf(tool.id) !== -1;
                          return <td key={tool.id} style={{ padding: "2px 6px", textAlign: "center" }}>
                            <button onClick={function() {
                              var nm = Object.assign({}, toolMatrix);
                              var arr = (nm[loc.id] || []).slice();
                              if (has) { arr = arr.filter(function(x) { return x !== tool.id; }); }
                              else { arr.push(tool.id); }
                              nm[loc.id] = arr;
                              setToolMatrix(nm);
                            }} style={{
                              width: 28, height: 28, borderRadius: 6, border: has ? "2px solid #059669" : "1px solid #D1D5DB",
                              background: has ? TH.greenBg : TH.bgCard, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center"
                            }}>{has ? "\u2705" : "\u00B7"}</button>
                          </td>;
                        })}
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Weekly Schedule tab — compact scrollable grid */}
          {/* Weekly Schedule tab — paintable hour grid */}
          {/* Weekly Schedule tab — paintable hour grid */}
          {/* Weekly Schedule tab — paintable hour grid */}
          {/* Weekly Schedule tab — paintable hour grid */}
          {/* Weekly Schedule tab — 15-min paintable grid */}
          {configTab === "weekly" && (function() {
            var GRID_H_START = 6, GRID_H_END = 23;
            var templateIds = Object.keys(locSchedules);
            // Build all 15-min slots
            var slots = [];
            for (var hh = GRID_H_START; hh < GRID_H_END; hh++) {
              for (var q = 0; q < 4; q++) slots.push(hh * 60 + q * 15);
            }
            var locColors = { home: "#3B82F6", work: "#F59E0B", transit: "#9CA3AF", downtown: "#10B981", gym: "#EF4444" };
            locations.forEach(function(l) { if (!locColors[l.id]) locColors[l.id] = "#8B5CF6"; });

            function getSlotLoc(tmplId, min) {
              var tmpl = locSchedules[tmplId];
              return (tmpl && tmpl.hours && tmpl.hours[min] !== undefined) ? tmpl.hours[min] : "home";
            }

            var pr = weeklyPaintRef.current;
            var drag = pr.drag;

            function inDragRange(tmplId, min) {
              if (!drag || drag.tmplId !== tmplId) return false;
              var lo = Math.min(drag.startM, drag.curM != null ? drag.curM : drag.startM);
              var hi = Math.max(drag.startM, drag.curM != null ? drag.curM : drag.startM);
              return min >= lo && min <= hi;
            }

            function commitRange(tmplId, fromM, toM, locId) {
              var lo = Math.min(fromM, toM), hi = Math.max(fromM, toM);
              setLocSchedules(function(prev) {
                var next = JSON.parse(JSON.stringify(prev));
                if (!next[tmplId]) return prev;
                if (!next[tmplId].hours) next[tmplId].hours = {};
                for (var m = lo; m <= hi; m += 15) next[tmplId].hours[m] = locId;
                return next;
              });
            }

            function onDown(tmplId, min, e) {
              e.preventDefault();
              weeklyPaintRef.current.drag = { tmplId: tmplId, startM: min, curM: min };
              setWeeklyPaintVer(function(v) { return v + 1; });
            }

            function onContainerMove(e) {
              var d = weeklyPaintRef.current.drag;
              if (!d) return;
              var el = document.elementFromPoint(e.clientX, e.clientY);
              if (!el) return;
              var target = el.closest ? el.closest("[data-wm]") : null;
              if (!target && el.dataset && el.dataset.wm) target = el;
              if (!target) return;
              var parts = target.dataset.wm.split("|");
              var tmplId = parts[0], min = parseInt(parts[1]);
              if (tmplId !== d.tmplId) return;
              if (d.curM !== min) {
                d.curM = min;
                setWeeklyPaintVer(function(v) { return v + 1; });
              }
            }

            function onUp() {
              var d = weeklyPaintRef.current.drag;
              if (d) {
                commitRange(d.tmplId, d.startM, d.curM != null ? d.curM : d.startM, weeklyPaintRef.current.loc);
                weeklyPaintRef.current.drag = null;
                setWeeklyPaintVer(function(v) { return v + 1; });
              }
            }

            var paintLoc = pr.loc;
            var CW = 10; // cell width px
            var CH = 20; // cell height px
            var NAME_W = 80;

            return <div>
              <div style={{ fontSize: 10, color: TH.muted2, marginBottom: 6 }}>Named location schedules. Assign a default to each day of the week, or override specific dates from the calendar.</div>

              {/* Brush picker */}
              <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: TH.muted2 }}>Brush:</span>
                {locations.map(function(loc) {
                  var sel = paintLoc === loc.id;
                  var c = locColors[loc.id] || "#8B5CF6";
                  return <button key={loc.id} onClick={function() {
                    weeklyPaintRef.current.loc = loc.id;
                    setWeeklyPaintVer(function(v) { return v + 1; });
                  }} style={{ padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: sel ? 700 : 500, border: sel ? "2px solid " + c : "1px solid " + TH.border, background: sel ? c + "30" : TH.bgCard, color: sel ? c : TH.text, cursor: "pointer" }}>{loc.icon} {loc.name}</button>;
                })}
              </div>

              {/* Schedule template grid */}
              <div
                onPointerMove={onContainerMove}
                onPointerUp={onUp}
                onPointerLeave={onUp}
                onPointerCancel={onUp}
                style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", userSelect: "none", touchAction: "none", cursor: "crosshair", paddingBottom: 4 }}
              >
                <div style={{ display: "inline-block" }}>
                  {/* Hour labels row */}
                  <div style={{ display: "flex", paddingLeft: NAME_W, marginBottom: 1 }}>
                    {(function() {
                      var labels = [];
                      for (var h = GRID_H_START; h < GRID_H_END; h++) {
                        var lbl = h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : (h - 12) + "p";
                        labels.push(<div key={h} style={{ width: CW * 4, textAlign: "center", fontSize: 7, color: TH.muted2, flexShrink: 0 }}>{lbl}</div>);
                      }
                      return labels;
                    })()}
                  </div>
                  {/* Template rows */}
                  {templateIds.map(function(tmplId) {
                    var tmpl = locSchedules[tmplId];
                    return <div key={tmplId} style={{ display: "flex", alignItems: "center", height: CH + 2, marginBottom: 1 }}>
                      <div style={{ width: NAME_W, fontSize: 9, fontWeight: 600, color: TH.text, flexShrink: 0, display: "flex", alignItems: "center", gap: 3, overflow: "hidden" }}>
                        <span style={{ fontSize: 10 }}>{tmpl.icon || "\u{1F4C5}"}</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tmpl.name}</span>
                        {tmpl.system ? <span style={{ fontSize: 6, background: TH.purpleBg, color: TH.purpleText, padding: "0 3px", borderRadius: 3 }}>default</span> : null}
                      </div>
                      {slots.map(function(min, idx) {
                        var loc = getSlotLoc(tmplId, min);
                        var isDrag = inDragRange(tmplId, min);
                        var displayLoc = isDrag ? paintLoc : loc;
                        var c = locColors[displayLoc] || "#6B7280";
                        var locO = locations.find(function(l) { return l.id === displayLoc; });
                        var prevMin = idx > 0 ? slots[idx - 1] : null;
                        var nextMin = idx < slots.length - 1 ? slots[idx + 1] : null;
                        var prevLoc = prevMin != null ? (inDragRange(tmplId, prevMin) ? paintLoc : getSlotLoc(tmplId, prevMin)) : null;
                        var nextLoc = nextMin != null ? (inDragRange(tmplId, nextMin) ? paintLoc : getSlotLoc(tmplId, nextMin)) : null;
                        var isStart = prevLoc !== displayLoc;
                        var isEnd = nextLoc !== displayLoc;
                        var isHourBound = min % 60 === 0 && !isStart;
                        return <div key={min}
                          data-wm={tmplId + "|" + min}
                          onPointerDown={function(e) { onDown(tmplId, min, e); }}
                          style={{
                            width: CW, height: CH, flexShrink: 0,
                            background: c + (isDrag ? "60" : "40"),
                            borderTop: "2px solid " + c, borderBottom: "2px solid " + c,
                            borderLeft: isStart ? "2px solid " + c : isHourBound ? "2px solid " + TH.text + "88" : "1px solid " + c + "22",
                            borderRight: isEnd ? "2px solid " + c : "none",
                            borderRadius: (isStart ? 4 : 0) + "px " + (isEnd ? 4 : 0) + "px " + (isEnd ? 4 : 0) + "px " + (isStart ? 4 : 0) + "px",
                            marginRight: isEnd ? 1 : 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            boxSizing: "border-box"
                          }}
                          title={tmpl.name + " " + Math.floor(min/60) + ":" + (min%60 === 0 ? "00" : min%60) + " \u2014 " + (locO ? locO.name : displayLoc)}
                        >
                          {isStart && locO ? <span style={{ fontSize: 8, lineHeight: 1, pointerEvents: "none" }}>{locO.icon}</span> : null}
                        </div>;
                      })}
                    </div>;
                  })}
                </div>
              </div>

              {/* Day-of-week default assignments */}
              <div style={{ marginTop: 10, marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: TH.text, marginBottom: 4 }}>Day-of-Week Defaults</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(function(dn) {
                    var curId = locScheduleDefaults[dn] || "weekday";
                    return <div key={dn} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 600, color: TH.text }}>{dn}</span>
                      <select value={curId} onChange={function(e) {
                        setLocScheduleDefaults(function(prev) { var next = Object.assign({}, prev); next[dn] = e.target.value; return next; });
                      }} style={{ fontSize: 8, padding: "2px 4px", borderRadius: 4, border: "1px solid " + TH.border, background: TH.bgCard, color: TH.text, width: 68, cursor: "pointer" }}>
                        {templateIds.map(function(tid) {
                          return <option key={tid} value={tid}>{locSchedules[tid].icon || ""} {locSchedules[tid].name}</option>;
                        })}
                      </select>
                    </div>;
                  })}
                </div>
              </div>

              {/* Template management */}
              <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={function() {
                  var name = prompt("Schedule name (e.g. WFH Day, NJ Office):", "");
                  if (!name) return;
                  var id = name.toLowerCase().replace(/[^a-z0-9]/g, "_").substring(0, 20);
                  if (locSchedules[id]) { showToast("ID already exists", "error"); return; }
                  // Clone from weekday template by default
                  var srcHours = (locSchedules["weekday"] || {}).hours || {};
                  setLocSchedules(function(prev) {
                    var next = Object.assign({}, prev);
                    next[id] = { name: name, icon: "\u{1F4C5}", system: false, hours: JSON.parse(JSON.stringify(srcHours)) };
                    return next;
                  });
                  showToast("Created: " + name, "success");
                }} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, border: "1px solid " + TH.purpleBorder, background: TH.settingsTabBg, color: TH.settingsLabel, cursor: "pointer" }}>{"\u2795"} Add Schedule</button>

                {templateIds.filter(function(k) { return !locSchedules[k].system; }).map(function(tmplId) {
                  var tmpl = locSchedules[tmplId];
                  return <button key={tmplId} onClick={function() {
                    if (!confirm("Delete schedule \"" + tmpl.name + "\"? Days using it will fall back to defaults.")) return;
                    setLocSchedules(function(prev) { var next = Object.assign({}, prev); delete next[tmplId]; return next; });
                    // Reset any defaults pointing to deleted template
                    setLocScheduleDefaults(function(prev) {
                      var next = Object.assign({}, prev);
                      Object.keys(next).forEach(function(dn) {
                        if (next[dn] === tmplId) {
                          var dow = ["Mon","Tue","Wed","Thu","Fri"].indexOf(dn) >= 0 ? "weekday" : "weekend";
                          next[dn] = dow;
                        }
                      });
                      return next;
                    });
                    // Remove any date overrides pointing to deleted template
                    setLocScheduleOverrides(function(prev) {
                      var next = Object.assign({}, prev);
                      Object.keys(next).forEach(function(dk) { if (next[dk] === tmplId) delete next[dk]; });
                      return next;
                    });
                    showToast("Deleted: " + tmpl.name, "success");
                  }} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, border: "1px solid #EF4444", background: "#FEE2E2", color: "#DC2626", cursor: "pointer" }}>{"\u{1F5D1}"} {tmpl.name}</button>;
                })}
              </div>

              {/* Rename / edit icon for templates */}
              <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                {templateIds.map(function(tmplId) {
                  var tmpl = locSchedules[tmplId];
                  return <div key={tmplId} style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 9, color: TH.muted2 }}>
                    <input value={tmpl.icon || ""} onChange={function(e) {
                      setLocSchedules(function(prev) { var next = JSON.parse(JSON.stringify(prev)); next[tmplId].icon = e.target.value.slice(0, 4); return next; });
                    }} style={{ width: 22, fontSize: 10, textAlign: "center", border: "1px solid " + TH.border, borderRadius: 3, background: TH.bgCard, color: TH.text, padding: 1 }} title="Icon" />
                    <input value={tmpl.name} onChange={function(e) {
                      setLocSchedules(function(prev) { var next = JSON.parse(JSON.stringify(prev)); next[tmplId].name = e.target.value; return next; });
                    }} style={{ width: 80, fontSize: 9, border: "1px solid " + TH.border, borderRadius: 3, background: TH.bgCard, color: TH.text, padding: "1px 4px" }} title="Name" />
                  </div>;
                })}
              </div>

              {/* Quick actions */}
              <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button onClick={function() {
                  var tmplId = prompt("Which template to fill? (" + templateIds.join(", ") + ")", "weekday");
                  if (!tmplId || !locSchedules[tmplId]) return;
                  setLocSchedules(function(prev) {
                    var next = JSON.parse(JSON.stringify(prev));
                    for (var m = GRID_H_START * 60; m < GRID_H_END * 60; m += 15) next[tmplId].hours[m] = "home";
                    return next;
                  });
                  showToast(tmplId + " \u2192 all home", "success");
                }} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, border: "1px solid " + TH.purpleBorder, background: TH.settingsTabBg, color: TH.settingsLabel, cursor: "pointer" }}>{"\u{1F3E0}"} Fill Home</button>
                <button onClick={function() {
                  var tmplId = prompt("Which template? (" + templateIds.join(", ") + ")", "weekday");
                  if (!tmplId || !locSchedules[tmplId]) return;
                  setLocSchedules(function(prev) {
                    var next = JSON.parse(JSON.stringify(prev));
                    for (var m = GRID_H_START * 60; m < GRID_H_END * 60; m += 15) {
                      var h = Math.floor(m / 60);
                      next[tmplId].hours[m] = (h >= 8 && h < 17) ? "work" : "home";
                    }
                    return next;
                  });
                  showToast(tmplId + " \u2192 office 8-5", "success");
                }} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, border: "1px solid " + TH.purpleBorder, background: TH.settingsTabBg, color: TH.settingsLabel, cursor: "pointer" }}>{"\u{1F3E2}"} Office 8-5</button>
                <button onClick={function() {
                  var tmplId = prompt("Which template? (" + templateIds.join(", ") + ")", "weekday");
                  if (!tmplId || !locSchedules[tmplId]) return;
                  setLocSchedules(function(prev) {
                    var next = JSON.parse(JSON.stringify(prev));
                    for (var m = GRID_H_START * 60; m < GRID_H_END * 60; m += 15) {
                      var h = Math.floor(m / 60); var q = (m % 60) / 15;
                      if (h === 7 && q >= 2) next[tmplId].hours[m] = "transit";
                      else if (h >= 8 && h < 17) next[tmplId].hours[m] = "work";
                      else if (h === 17 && q < 2) next[tmplId].hours[m] = "transit";
                      else next[tmplId].hours[m] = "home";
                    }
                    return next;
                  });
                  showToast(tmplId + " \u2192 office + commute", "success");
                }} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, border: "1px solid " + TH.purpleBorder, background: TH.settingsTabBg, color: TH.settingsLabel, cursor: "pointer" }}>{"\u{1F697}"} Office + Commute</button>
                <button onClick={function() {
                  var src = prompt("Copy from template:", templateIds[0]);
                  if (!src || !locSchedules[src]) return;
                  var destName = prompt("New template name:", src + " copy");
                  if (!destName) return;
                  var destId = destName.toLowerCase().replace(/[^a-z0-9]/g, "_").substring(0, 20);
                  setLocSchedules(function(prev) {
                    var next = JSON.parse(JSON.stringify(prev));
                    next[destId] = { name: destName, icon: prev[src].icon, system: false, hours: JSON.parse(JSON.stringify(prev[src].hours)) };
                    return next;
                  });
                  showToast("Copied " + src + " \u2192 " + destName, "success");
                }} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, border: "1px solid " + TH.purpleBorder, background: TH.settingsTabBg, color: TH.settingsLabel, cursor: "pointer" }}>{"\u{1F4CB}"} Duplicate</button>
              </div>

              {/* Date overrides summary */}
              {Object.keys(locScheduleOverrides).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: TH.text, marginBottom: 4 }}>Date Overrides</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {Object.keys(locScheduleOverrides).sort().map(function(dk) {
                      var tmplId = locScheduleOverrides[dk];
                      var tmpl = locSchedules[tmplId];
                      return <div key={dk} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, padding: "2px 6px", borderRadius: 4, background: TH.amberBg, color: TH.text }}>
                        <span>{dk}</span>
                        <span style={{ fontWeight: 600 }}>{tmpl ? (tmpl.icon + " " + tmpl.name) : tmplId}</span>
                        <button onClick={function() {
                          setLocScheduleOverrides(function(prev) { var next = Object.assign({}, prev); delete next[dk]; return next; });
                          showToast("Removed override for " + dk, "success");
                        }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#EF4444", padding: 0 }}>{"\u2715"}</button>
                      </div>;
                    })}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 6, fontSize: 8, color: TH.purpleText, fontStyle: "italic" }}>
                Transit blocks are dead zones. Override specific dates by clicking the location indicator in the calendar day header.
              </div>
            </div>;
          })()}



          {configTab === "projects" && (function() {
            var projColors = ["#DC2626","#D97706","#2563EB","#059669","#7C3AED","#DB2777","#0891B2","#65A30D","#C2410C","#4338CA","#1D4ED8","#B91C1C","#047857","#6D28D9","#BE185D"];
            var unregistered = allProjectNames.filter(function(name) { return !projects.find(function(p) { return p.name === name; }); });
            return <div>
              <div style={{ fontSize: 10, color: TH.muted2, marginBottom: 6 }}>Manage project names, colors, and icons. Rename updates all tasks with that project.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                {projects.map(function(proj) {
                  var taskCount = projectTaskCounts[proj.name] || 0;
                  return $("div", { key: proj.id, style: { display: "flex", gap: 6, alignItems: "center", padding: "4px 6px", background: TH.bgCard, borderRadius: 6, border: "1px solid " + TH.border } },
                    $("span", { style: { width: 14, height: 14, borderRadius: "50%", background: proj.color || "#6B7280", flexShrink: 0, cursor: "pointer", border: "2px solid " + TH.border }, title: "Click to cycle color", onClick: function() {
                      var ci = projColors.indexOf(proj.color); var next = projColors[(ci + 1) % projColors.length];
                      setProjects(function(prev) { return prev.map(function(p) { return p.id === proj.id ? Object.assign({}, p, { color: next }) : p; }); });
                    } }),
                    $("input", { type: "text", value: proj.icon || "", onChange: function(e) {
                      setProjects(function(prev) { return prev.map(function(p) { return p.id === proj.id ? Object.assign({}, p, { icon: e.target.value.slice(0, 2) }) : p; }); });
                    }, placeholder: "📋", style: { width: 28, fontSize: 14, textAlign: "center", border: "1px solid " + TH.border, borderRadius: 4, background: TH.inputBg, padding: "1px 2px" }, title: "Icon (emoji)" }),
                    $("span", { style: { flex: 1, fontSize: 11, fontWeight: 600, color: TH.text } }, proj.name),
                    $("span", { style: { fontSize: 9, color: TH.textMuted, flexShrink: 0 } }, taskCount + " tasks"),
                    sBtn("\u270F\uFE0F", function() {
                      var oldName = proj.name, newName = prompt("Rename project \"" + oldName + "\" to:", oldName);
                      if (newName && newName.trim() && newName.trim() !== oldName) {
                        newName = newName.trim(); pushUndo("rename project " + oldName);
                        setProjects(function(prev) { return prev.map(function(p) { return p.id === proj.id ? Object.assign({}, p, { name: newName }) : p; }); });
                        setExtraTasks(function(prev) { return prev.map(function(t) { return t.project === oldName ? Object.assign({}, t, { project: newName }) : t; }); });
                        showToast("Renamed \"" + oldName + "\" \u2192 \"" + newName + "\" (" + taskCount + " tasks)", "success");
                      }
                    }, { fs: 9, pad: "2px 6px", br: 4, title: "Rename (updates all tasks)" }),
                    sBtn("\u2715", function() {
                      if (taskCount > 0) { showToast("Can't delete — " + taskCount + " tasks use \"" + proj.name + "\". Reassign them first.", "error"); return; }
                      setProjects(function(prev) { return prev.filter(function(p) { return p.id !== proj.id; }); });
                      showToast("Removed project \"" + proj.name + "\"", "info");
                    }, { fs: 9, pad: "2px 6px", br: 4, bc: TH.redBorder, bg: TH.redBg, c: TH.redText, opacity: taskCount > 0 ? 0.4 : 1, title: taskCount > 0 ? "Reassign tasks first" : "Delete project" })
                  );
                })}
              </div>
              {sFlexRow(6, [
                sBtn("+ Add Project", function() {
                  var name = prompt("New project name:");
                  if (name && name.trim()) {
                    name = name.trim();
                    if (projects.find(function(p) { return p.name === name; })) { showToast("\"" + name + "\" already exists", "error"); return; }
                    setProjects(function(prev) { return prev.concat([{ id: "proj_" + Date.now(), name: name, color: projColors[prev.length % projColors.length], icon: "" }]); });
                    showToast("Added project \"" + name + "\"", "success");
                  }
                }, { bc: TH.greenBorder, bg: TH.greenBg, c: TH.greenText, fw: 700 }),
                $("span", { style: { fontSize: 9, color: TH.textMuted } }, projects.length + " registered, " + allProjectNames.length + " total across tasks")
              ], { marginBottom: 8 })}
              {unregistered.length > 0 && sSection("\u26A0 Unregistered (in tasks but not in registry — click to add):", null, "amber",
                $("div", { style: { display: "flex", gap: 3, flexWrap: "wrap" } },
                  unregistered.map(function(name) {
                    var tc = projectTaskCounts[name] || 0;
                    return sBtn("+ " + name + " (" + tc + ")", function() {
                      setProjects(function(prev) { return prev.concat([{ id: "proj_" + Date.now() + "_" + name.substring(0, 5), name: name, color: projColors[prev.length % projColors.length], icon: "" }]); });
                      showToast("Registered \"" + name + "\"", "success");
                    }, { key: name, fs: 9, pad: "2px 8px", br: 4, bc: TH.amberBorder, bg: TH.amberBg, c: TH.amberText });
                  })
                )
              )}
            </div>;
          })()}
          </div>
        </div>
      )}

      {/* ── State Import/Export Panel ── */}
      {showStatePanel && (
        <div style={{ marginTop: 12, background: TH.blueBg, border: "1.5px solid " + TH.blueBorder, borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: TH.blueText }}>State Import / Export</span>
            <button onClick={() => setShowStatePanel(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: TH.muted2 }}>{"\u2715"}</button>
          </div>
          <div style={{ fontSize: 11, color: TH.textMuted, marginBottom: 8 }}>
            Export saves all check-offs, edits, and AI-added tasks. Import restores them on a new version.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button onClick={() => {
              const el = document.createElement("textarea");
              el.value = buildStateExport();
              document.body.appendChild(el);
              el.select();
              document.execCommand("copy");
              document.body.removeChild(el);
            }} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              border: "1px solid #3B82F6", background: "#3B82F6", color: "white",
            }}>Copy State to Clipboard</button>
            <span style={{ fontSize: 10, color: TH.textMuted, alignSelf: "center" }}>
              {Object.keys(statuses).length} statuses, {extraTasks.length} tasks
            </span>
          </div>
          <textarea readOnly value={buildStateExport()} style={{
            width: "100%", height: 100, fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
            border: "1px solid " + TH.blueBorder, borderRadius: 4, padding: 8, resize: "vertical",
            background: TH.white, color: TH.text, boxSizing: "border-box", marginBottom: 10,
          }} onFocus={e => e.target.select()} />
          <div style={{ fontSize: 12, fontWeight: 600, color: TH.blueText, marginBottom: 6 }}>Import State</div>
          <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste exported state JSON here..." style={{
            width: "100%", height: 80, fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
            border: "1px solid " + TH.blueBorder, borderRadius: 4, padding: 8, resize: "vertical",
            background: TH.white, color: TH.text, boxSizing: "border-box",
          }} />
          <button onClick={handleStateImport} disabled={!importText.trim()} style={{
            marginTop: 6, padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: importText.trim() ? "pointer" : "default",
            border: "none", background: importText.trim() ? "#059669" : TH.btnBorder, color: "white",
          }}>Import State</button>
        </div>
      )}

      {/* ── AI Command Bar ── */}
      <div onClick={e => e.stopPropagation()} style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 999,
        background: darkMode ? "linear-gradient(135deg, #0F172A, #1E293B)" : "linear-gradient(135deg, #1E293B, #334155)",
        borderTop: "1px solid #334155",
        padding: showAi ? "0" : "8px 12px",
      }}>
        {showAi && (
          <div style={{ maxHeight: "40vh", overflowY: "auto", padding: "8px 12px", borderBottom: "1px solid #334155" }}>
            {aiLog.length === 0 && (
              <div style={{ fontSize: 12, color: TH.textMuted, padding: "8px 10px", textAlign: "center" }}>
                Try: "Mark t01 done" or "Move t93 to Monday at 10am" or "Add a task: call dentist Wed 2pm"
              </div>
            )}
            {aiLog.map((entry, i) => (
              <div key={i} style={{
                marginBottom: 6, padding: "6px 10px", borderRadius: 8,
                fontSize: 12, lineHeight: 1.4, maxWidth: "85%",
                ...(entry.role === "user"
                  ? { background: "#3B82F6", color: "white", marginLeft: "auto", textAlign: "right" }
                  : { background: TH.bgCard, color: TH.text, border: "1px solid " + TH.border })
              }}>
                {entry.text}
                {entry.ops && entry.ops.length > 0 && (
                  <div style={{ fontSize: 10, color: TH.textDim, marginTop: 3 }}>
                    {entry.ops.length} change{entry.ops.length !== 1 ? "s" : ""} applied
                  </div>
                )}
              </div>
            ))}
            {aiLoading && (
              <div style={{ fontSize: 11, color: TH.textDim, padding: "4px 10px", fontStyle: "italic" }}>
                Thinking...
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: showAi ? "8px 12px" : "0" }}>
          <button
            onClick={() => { if (aiAutoHideRef.current) clearTimeout(aiAutoHideRef.current); setShowAi(!showAi); }}
            style={{
              background: showAi ? "#3B82F6" : "#334155", color: "white", border: "none",
              borderRadius: 6, width: 32, height: 32, fontSize: 14, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >{showAi ? "\u2715" : "\u{1F916}"}</button>
          <input
            value={aiCmd}
            onChange={e => setAiCmd(e.target.value)}
            onClick={e => e.stopPropagation()}
            onFocus={e => { e.stopPropagation(); if (aiAutoHideRef.current) clearTimeout(aiAutoHideRef.current); }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAiCmd(); }}}
            placeholder={showAi ? "Tell me what to do with your tasks..." : "AI command..."}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            style={{
              flex: 1, background: "#0F172A", color: "white", border: "1px solid #475569",
              borderRadius: 8, padding: "10px 12px", fontSize: 16, outline: "none",
              fontFamily: "'DM Sans', system-ui, sans-serif",
              WebkitAppearance: "none", minHeight: 44,
            }}
          />
          <button
            onClick={e => { e.stopPropagation(); handleAiCmd(); }}
            disabled={aiLoading || !aiCmd.trim()}
            style={{
              background: aiLoading ? "#475569" : "#3B82F6", color: "white", border: "none",
              borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600,
              cursor: aiLoading ? "wait" : "pointer", flexShrink: 0, minHeight: 44,
            }}
          >{aiLoading ? "..." : "Send"}</button>
        </div>
      </div>
      <div style={{ height: 56 }} />

      {/* ── Help Modal ── */}
      {/* GCAL SYNC MODAL */}
      {gcalSyncOpen && (() => {
        var dk = formatDateKey(selectedDate);
        var dayTasks = (tasksByDate[dk] || []).filter(filterTask).filter(function(t) {
          var st = statuses[t.id] || "";
          return st !== "done" && st !== "cancel" && st !== "skip";
        });
        var selCount = Object.keys(gcalSyncSel).filter(function(k) { return gcalSyncSel[k]; }).length;
        var importCount = Object.keys(gcalImportSel).filter(function(k) { return gcalImportSel[k]; }).length;
        var busy = gcalSyncing || gcalFetching;
        var tabBtn = function(id, label) {
          return $("button", { key: id, onClick: function() { setGcalTab(id); }, style: {
            fontSize: 11, padding: "5px 12px", borderRadius: 4, border: "none", fontWeight: 600, cursor: "pointer",
            background: gcalTab === id ? "#4285F4" : TH.bgHover, color: gcalTab === id ? "#fff" : TH.textDim,
          }}, label);
        };
        return (
          <div onClick={() => { if (!busy) setGcalSyncOpen(false); }} style={{
            position: "fixed", inset: 0, background: TH.overlayBg, zIndex: 10000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: TH.helpBg, borderRadius: 12, maxWidth: 480, width: "100%",
              maxHeight: "80vh", overflow: "auto", padding: "16px 20px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: TH.text }}>📅 Google Calendar</h3>
                <button onClick={() => setGcalSyncOpen(false)} disabled={busy} style={{
                  background: "none", border: "none", fontSize: 18, cursor: "pointer", color: TH.textDim, padding: 4,
                }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                {tabBtn("push", "⬆ Push to GCal")}
                {tabBtn("pull", "⬇ Pull from GCal")}
              </div>
              <div style={{ fontSize: 10, color: TH.textMuted, marginBottom: 8 }}>{formatDateKey(selectedDate)}</div>

              {gcalTab === "push" && <>
                <div style={{ fontSize: 10, color: TH.textMuted, marginBottom: 6 }}>
                  {dayTasks.length} open tasks • {selCount} selected
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {[
                    { l: "All", fn: function() { var s = {}; dayTasks.forEach(function(t) { s[t.id] = true; }); setGcalSyncSel(s); } },
                    { l: "None", fn: function() { setGcalSyncSel({}); } },
                    { l: "With Time", fn: function() { var s = {}; dayTasks.forEach(function(t) { if (parseTimeToMinutes(t.time) !== null) s[t.id] = true; }); setGcalSyncSel(s); } },
                  ].map(function(b) { return $("button", { key: b.l, onClick: b.fn, style: {
                    fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px solid " + TH.border,
                    background: TH.bgHover, color: TH.text, cursor: "pointer",
                  }}, b.l); })}
                </div>
                <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                  {dayTasks.map(function(t) {
                    var sm = parseTimeToMinutes(t.time);
                    var timeStr = sm !== null ? (Math.floor(sm/60) > 12 ? Math.floor(sm/60)-12 : Math.floor(sm/60)) + ":" + String(sm%60).padStart(2,"0") + (sm >= 720 ? "p" : "a") : "no time";
                    return (
                      <label key={t.id} style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "3px 6px",
                        borderRadius: 4, background: gcalSyncSel[t.id] ? TH.blueBg : "transparent", cursor: "pointer", fontSize: 11,
                      }}>
                        <input type="checkbox" checked={!!gcalSyncSel[t.id]} onChange={function() {
                          setGcalSyncSel(function(prev) { var n = Object.assign({}, prev); n[t.id] = !n[t.id]; return n; });
                        }} />
                        <span style={{ fontWeight: 600, color: PRI_COLORS[t.pri] || TH.textMuted, fontSize: 9, minWidth: 18 }}>{t.pri || "—"}</span>
                        <span style={{ fontSize: 9, color: TH.textDim, minWidth: 38 }}>{timeStr}</span>
                        <span style={{ color: TH.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
                        <span style={{ fontSize: 9, color: TH.textDim }}>{t.dur || 30}m</span>
                        {t.gcalEventId && <span style={{ fontSize: 8, color: "#4285F4", fontWeight: 600 }}>✓</span>}
                      </label>
                    );
                  })}
                  {dayTasks.length === 0 && <div style={{ fontSize: 11, color: TH.textMuted, padding: 12, textAlign: "center" }}>No open tasks</div>}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                  <button onClick={syncToGCal} disabled={busy || selCount === 0} style={{
                    fontSize: 11, padding: "6px 14px", borderRadius: 4, border: "none",
                    background: selCount > 0 && !busy ? "#4285F4" : TH.border,
                    color: selCount > 0 && !busy ? "#fff" : TH.textDim,
                    cursor: selCount > 0 && !busy ? "pointer" : "default", fontWeight: 600,
                  }}>{gcalSyncing ? "⏳ Syncing..." : "Push " + selCount + " to GCal"}</button>
                </div>
              </>}

              {gcalTab === "pull" && <>
                <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <button onClick={pullFromGCal} disabled={gcalFetching} style={{
                    fontSize: 11, padding: "5px 12px", borderRadius: 4, border: "none",
                    background: gcalFetching ? TH.border : "#4285F4", color: gcalFetching ? TH.textDim : "#fff",
                    cursor: gcalFetching ? "wait" : "pointer", fontWeight: 600,
                  }}>{gcalFetching ? "⏳ Fetching..." : "Fetch Events"}</button>
                  {gcalEvents.length > 0 && <span style={{ fontSize: 10, color: TH.textMuted }}>{gcalEvents.length} events found • {importCount} to import</span>}
                </div>
                <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                  {gcalEvents.map(function(ev) {
                    var sm = ev.startMin || 0;
                    var hh = Math.floor(sm/60), mm = sm%60;
                    var timeStr = (hh > 12 ? hh-12 : hh || 12) + ":" + String(mm).padStart(2,"0") + (sm >= 720 ? "p" : "a");
                    var dur = (ev.endMin || sm+30) - sm;
                    var already = !!ev.existingTaskId;
                    return (
                      <label key={ev.id} style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "3px 6px",
                        borderRadius: 4, background: gcalImportSel[ev.id] ? TH.blueBg : "transparent",
                        cursor: already ? "default" : "pointer", fontSize: 11, opacity: already ? 0.5 : 1,
                      }}>
                        <input type="checkbox" checked={!!gcalImportSel[ev.id]} disabled={already} onChange={function() {
                          if (already) return;
                          setGcalImportSel(function(prev) { var n = Object.assign({}, prev); n[ev.id] = !n[ev.id]; return n; });
                        }} />
                        <span style={{ fontSize: 9, color: TH.textDim, minWidth: 38 }}>{timeStr}</span>
                        <span style={{ color: TH.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.summary}</span>
                        <span style={{ fontSize: 9, color: TH.textDim }}>{dur}m</span>
                        {already && <span style={{ fontSize: 8, color: "#059669", fontWeight: 600 }}>already tracked</span>}
                      </label>
                    );
                  })}
                  {gcalEvents.length === 0 && !gcalFetching && <div style={{ fontSize: 11, color: TH.textMuted, padding: 12, textAlign: "center" }}>Click "Fetch Events" to load from GCal</div>}
                </div>
                {gcalEvents.length > 0 && <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                  <button onClick={importFromGCal} disabled={importCount === 0} style={{
                    fontSize: 11, padding: "6px 14px", borderRadius: 4, border: "none",
                    background: importCount > 0 ? "#059669" : TH.border,
                    color: importCount > 0 ? "#fff" : TH.textDim,
                    cursor: importCount > 0 ? "pointer" : "default", fontWeight: 600,
                  }}>Import {importCount} as Tasks</button>
                </div>}
              </>}
            </div>
          </div>
        );
      })()}

      {showHelp && (
        <div onClick={() => setShowHelp(false)} style={{
          position: "fixed", inset: 0, background: TH.overlayBg, zIndex: 10000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: TH.helpBg, borderRadius: 12, maxWidth: 520, width: "100%",
            maxHeight: "85vh", overflow: "auto", padding: "20px 24px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)", WebkitOverflowScrolling: "touch",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: TH.text }}>{"📋"} Task Tracker Guide</h2>
              <button onClick={() => setShowHelp(false)} style={{
                background: "none", border: "none", fontSize: 20, cursor: "pointer", color: TH.textDim, padding: 4,
              }}>{"\u2715"}</button>
            </div>

            {[
              {
                icon: "\u{1F4BE}", title: "Moving to a New Thread",
                body: "Your task data (check-offs, edits, schedule changes) is saved in browser storage and persists across sessions — even if you close the tab.\n\nSaving the JSX to your Project:\n1. Download the .jsx file from the artifact (click the filename above the preview)\n2. In your Claude Project, go to Project Knowledge and upload the timestamped .jsx file\n3. Remove older versions to avoid confusion\n\nStarting a new thread:\n1. Open a new chat in the same Project\n2. Ask: \"Load and render the latest task tracker JSX from project knowledge\"\n3. Claude will read the file and produce a fresh artifact\n4. Your browser storage data carries over automatically — all check-offs, edits, and settings are preserved\n\nIf storage was cleared (different browser/device):\n1. Before leaving the old thread: click ☰ → State → \"Copy State\"\n2. In the new artifact: click ☰ → State → paste → \"Import State\"\n\nThis restores all task data, statuses, and settings."
              },
              {
                icon: "\u{1F916}", title: "AI Commands",
                body: "Use the AI bar at the bottom to manage tasks with natural language:\n\n• \"Mark t01 done\" — complete a task\n• \"Move t93 to Monday at 10am\" — reschedule\n• \"Add a task: call dentist Wed 2pm\" — create new\n• \"Set t120 priority to P1\" — reprioritize\n• \"Set due date on t36 to 3/15\" — add deadline\n• \"Push all P3 tasks to next week\" — bulk edits\n\nThe AI sees all your open tasks, locations, and schedule. Per-task AI inputs (inside expanded cards) work the same way but are scoped to that task."
              },
              {
                icon: "\u{1F504}", title: "Auto-Reschedule",
                body: "The \"Resched\" button rebuilds your entire schedule from today forward:\n\n1. Habits are NEVER moved — mark them done or skip manually\n2. Fixed items (flights, appointments) are locked — never moved\n3. Tasks with due dates get first pick of slots (soonest deadline first)\n4. Location-specific tasks placed next (most constrained)\n5. Tasks cluster by location — downtown errands batch on one day\n6. Remaining tasks fill gaps by priority (P1 → P2 → P3 → P4)\n7. Tasks can split across gaps (15-min minimum chunks)\n8. Due dates are HARD — a task will go unplaced rather than miss its deadline\n9. Start After dates prevent tasks from being scheduled too early\n\nLocation + tool constraints are enforced: tasks only schedule where the required location and tools are available."
              },
              {
                icon: "\u{1F525}", title: "Priorities & Due Dates",
                body: "Priorities: P1 (critical), P2 (high), P3 (medium), P4 (low), Habit (daily routine).\n\nDue dates are HARD deadlines — the scheduler will NEVER place a task after its due date. Tasks with due dates are scheduled first (soonest deadline gets priority over higher-priority tasks without deadlines).\n\nBadges: red OVERDUE, amber \"Due tmrw\", blue/gray for further out.\n\n⏳ Start After delays a task until a future date — it won't be scheduled before then. Use for tasks you can't or don't want to start yet.\n\nSet both via the edit form (tap a task → 📆 Due / ⏳ Start after)."
              },
              {
                icon: "\u270F\uFE0F", title: "Editing Tasks",
                body: "Tap any task to expand it. You can:\n\n• Change date, time, duration, priority\n• Set location (where your body needs to be)\n• Set tools needed (phone, PC, printer, etc.)\n• Set time preference (when — multi-select)\n• Add/clear due dates (hard deadlines)\n• Set \"Start after\" dates (delays scheduling)\n• Adjust time remaining for WIP tasks\n\nClick \"Save\" to apply edits. Changes are persisted automatically."
              },
              {
                icon: "\u2699\uFE0F", title: "Settings",
                body: "The ⚙️ button opens the config panel with 5 tabs:\n\n• Schedule — define time blocks for each day of the week (Morning, Biz, Evening, etc). Tasks must have a matching when-tag to be placed in a block. Clone schedules across weekdays or weekends.\n• Locations — define where you can be (Home, Work, Downtown, Gym...)\n• Tools — define what tasks can require (Phone, Personal PC, Work PC, Printer, Car...)\n• Availability — matrix grid showing which tools exist at which location\n• Weekly — set your default location for each day of the week\n\nThe scheduler uses all three dimensions: a task needs the right time block, location, AND tools."
              },
              {
                icon: "\u{1F4C5}", title: "Views & Calendar",
                body: "6 view modes available from the toolbar:\n\n• Day — full time grid with positioned tasks, drag-drop, hour labels\n• 3-Day — yesterday/today/tomorrow side by side\n• Week — Mon-Sun 7-column time grid, great for seeing the full week at a glance\n• Month — traditional calendar with task previews per day, count badges, overdue warnings\n• List — card-based list grouped by day\n• ⚠️ Conflicts — shows scheduling issues\n\nNavigate with ← → arrows, Today button, or date picker. In Week view, the week adjusts to contain the selected date. In Month view, use ‹/› to move between months.\n\nDay/3-Day/Week grids show task blocks sized proportionally to duration. Color coding: blue (regular), green (done), amber (wip), red (cancelled), light green (habits). The red line shows current time.\n\nClick any task or day in Week/Month to jump to Day view for details."
              },
              {
                icon: "\u{1F517}", title: "Dependencies",
                body: "Tasks can depend on other tasks — a dependent task won't be scheduled before its prerequisite.\n\nBadges on task cards:\n• ⏳ 2 deps — waiting on 2 unfinished prerequisites\n• 🔗✓ — all dependencies satisfied (done)\n• 🔗→3 — this task blocks 3 downstream tasks\n\nHow dependencies work:\n• Same-day: scheduler places dependent task AFTER its prerequisite ends\n• Cross-day: badge warns if prerequisite is on a later date\n• Completing a prerequisite (marking done) unblocks its dependents\n\nAdd dependencies in the expanded edit form (🔗 Dependencies section). Type a task ID or name and press Enter. Remove with ✕.\n\nThe AI bar also supports dependencies:\n• \"Make t75 depend on t64\"\n• \"Add dep t132→t131\""
              },
              {
                icon: "\u{1F501}", title: "Recurring Tasks & Habits",
                body: "Any task can be made recurring via the edit form:\n\n• Daily — generates every day\n• Weekly — pick which days (Mo/Tu/We...)\n• Biweekly — same days, every other week\n• Every N days — custom interval (e.g. every 28 days = monthly)\n\nHabits are now just recurring tasks with pri=Habit. The 12 built-in habits (Breakfast, Lunch, Exercise, etc.) are source tasks with recurrence rules.\n\nTo use:\n1. Create or edit a task and set Recurrence + days\n2. Click ☰ → 🔁 Recurring to generate instances for 14 days\n3. Or use Settings → Schedule → Generate buttons for 7/14/28 days\n4. Each generated instance gets its own status\n\nGenerated instances show 🔁 on the card. The source task stays as the template — editing its recurrence rule affects future generations.\n\nDuplicate detection prevents generating instances where one already exists on that date (by ID or matching text)."
              },
              {
                icon: "⌨️", title: "Keyboard Shortcuts",
                body: "← → — Navigate days (Shift+← → by week)\nJ / K — Next / previous task\nS — Cycle status (open → wip → done)\nEscape — Close expanded task\nCtrl+Z / ⌘Z — Undo last action (up to 30 steps)\n\nUndo works for: status changes, edits, deletes, drag-drop, reschedule, AI commands, and batch operations."
              },
            ].map((section, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <h3 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: TH.text }}>
                  {section.icon} {section.title}
                </h3>
                <div style={{ fontSize: 12, color: TH.textMuted, lineHeight: 1.6, whiteSpace: "pre-line" }}>
                  {section.body}
                </div>
              </div>
            ))}

            <div style={{ borderTop: "1px solid " + TH.border, paddingTop: 12, marginTop: 8, fontSize: 11, color: TH.textDim, textAlign: "center" }}>
              Task Tracker v7.20 · 2/25/2026 10:45 AM
            </div>
          </div>
        </div>
      )}

      {/* Toast notification + history */}
      {(toast || showToastHistory) && (
        <div style={{
          position: "fixed", bottom: 56, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          pointerEvents: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          maxWidth: "90vw", width: 380,
        }}>
          {/* History panel */}
          {showToastHistory && toastHistory.length > 0 && (
            <div style={{
              background: darkMode ? "#1E293B" : "#FFFFFF", border: "1px solid " + TH.border,
              borderRadius: 10, padding: "8px 10px", width: "100%", maxHeight: 240, overflowY: "auto",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)", boxSizing: "border-box",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: TH.textMuted }}>Toast History ({toastHistory.length})</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={function() { setToastHistory([]); setShowToastHistory(false); }} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, border: "1px solid " + TH.border, background: TH.bgHover, color: TH.textMuted, cursor: "pointer" }}>Clear</button>
                  <button onClick={function() { setShowToastHistory(false); }} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, border: "1px solid " + TH.border, background: TH.bgHover, color: TH.textMuted, cursor: "pointer" }}>{"\u2715"}</button>
                </div>
              </div>
              {toastHistory.map(function(th, i) {
                var age = Math.floor((Date.now() - th.ts) / 1000);
                var ageStr = age < 60 ? age + "s ago" : Math.floor(age / 60) + "m ago";
                return $("div", { key: th.ts + "_" + i, style: {
                  padding: "4px 8px", marginBottom: 3, borderRadius: 6, fontSize: 10, lineHeight: 1.4,
                  background: th.type === "error" ? TH.redBg : th.type === "info" ? TH.blueBg : TH.greenBg,
                  color: th.type === "error" ? TH.redText : th.type === "info" ? TH.blueText : TH.greenText,
                  border: "1px solid " + (th.type === "error" ? TH.redBorder : th.type === "info" ? TH.blueBorder : TH.greenBorder),
                  display: "flex", gap: 6, justifyContent: "space-between", alignItems: "flex-start",
                } },
                  $("span", { style: { flex: 1 } },
                    (th.type === "error" ? "\u26A0\uFE0F " : th.type === "info" ? "\u2139\uFE0F " : "\u2705 ") + th.msg
                  ),
                  $("span", { style: { fontSize: 8, color: TH.textDim, flexShrink: 0, marginTop: 1 } }, ageStr)
                );
              })}
            </div>
          )}
          {/* Current toast */}
          {toast && (
            <div style={{
              padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, width: "100%", boxSizing: "border-box",
              background: toast.type === "error" ? (darkMode ? "#7F1D1D" : "#FEE2E2") : toast.type === "info" ? (darkMode ? "#1E3A5F" : "#DBEAFE") : (darkMode ? "#064E3B" : "#D1FAE5"),
              color: toast.type === "error" ? (darkMode ? "#FCA5A5" : "#991B1B") : toast.type === "info" ? (darkMode ? "#93C5FD" : "#1E40AF") : (darkMode ? "#6EE7B7" : "#065F46"),
              border: "1px solid " + (toast.type === "error" ? TH.redBorder : toast.type === "info" ? TH.blueBorder : TH.greenBorder),
              boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
              display: "flex", gap: 10, alignItems: "center",
            }} onClick={function() { setToast(null); }}>
              <span>{toast.type === "error" ? "\u26A0\uFE0F" : toast.type === "info" ? "\u2139\uFE0F" : "\u2705"}</span>
              <span style={{ flex: 1 }}>{toast.msg}</span>
              {toastHistory.length > 1 && (
                <span onClick={function(e) { e.stopPropagation(); setShowToastHistory(function(p) { return !p; }); }} style={{
                  fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10,
                  background: "rgba(0,0,0,0.15)", cursor: "pointer", flexShrink: 0,
                }} title="Show toast history">{toastHistory.length}</span>
              )}
              <span style={{ cursor: "pointer", opacity: 0.6, fontSize: 11 }}>{"\u2715"}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Chain Popup Overlay ── */}
      {chainData && chainOrder && (() => {
        try {
        var STATUS_ICONS = { done: "\u2705", wip: "\u{1F528}", cancel: "\u274C", skip: "\u23ED", other: "\u{1F7E3}" };
        // Build ordered task list from chainOrder
        var orderedTasks = chainOrder.map(function(id) { return allTasks.find(function(t) { return t.id === id; }); }).filter(Boolean);
        var uniqueProjects = [];
        orderedTasks.forEach(function(t) {
          if (t.project && uniqueProjects.indexOf(t.project) < 0) uniqueProjects.push(t.project);
        });
        var projectLabel = uniqueProjects.length <= 2 ? uniqueProjects.join(" + ") : uniqueProjects.slice(0, 2).join(" + ") + " +" + (uniqueProjects.length - 2);
        return $("div", {
          style: { position: "fixed", inset: 0, zIndex: 9997, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)" },
          onClick: function() { if (!chainDirty) setChainPopupId(null); },
          onWheel: function(e) { e.stopPropagation(); }
        },
          $("div", {
            onClick: function(e) { e.stopPropagation(); },
            style: { background: TH.panelBg, border: "1px solid " + TH.border, borderRadius: 14, padding: 0, width: 440, maxWidth: "92vw", maxHeight: "82vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 48px rgba(0,0,0,0.35)", overflow: "hidden" }
          },
            // Header
            $("div", { style: { padding: "14px 18px 10px", borderBottom: "1px solid " + TH.border, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 } },
              $("div", null,
                $("div", { style: { fontSize: 14, fontWeight: 700, color: TH.text } }, "\u{1F517} Dependency Chain"),
                $("div", { style: { fontSize: 11, color: TH.textMuted, marginTop: 2 } },
                  projectLabel + " \u2022 " + orderedTasks.length + " tasks",
                  chainDirty && $("span", { style: { color: TH.amberText, fontWeight: 600, marginLeft: 6 } }, "\u2022 unsaved changes")
                )
              ),
              $("div", { style: { display: "flex", gap: 6 } },
                chainDirty && $("button", {
                  onClick: function() {
                    // Reset to original order and deps
                    var ids = chainData.tasks.map(function(t) { return t.id; });
                    setChainOrder(ids);
                    var chainSet = {};
                    ids.forEach(function(id) { chainSet[id] = true; });
                    var deps = {};
                    chainData.tasks.forEach(function(t) {
                      deps[t.id] = getTaskDeps(t).filter(function(d) { return chainSet[d]; });
                    });
                    setChainDeps(deps);
                    setChainDirty(false);
                    setChainAddDepFor(null);
                  },
                  style: { padding: "4px 10px", borderRadius: 6, border: "1px solid " + TH.border, background: TH.bgCard, color: TH.textMuted, fontSize: 11, fontWeight: 600, cursor: "pointer" }
                }, "Reset"),
                chainDirty && $("button", {
                  onClick: function() {
                    chainSave();
                    setToast({ msg: "Chain dependencies updated!", type: "success" });
                  },
                  style: { padding: "4px 12px", borderRadius: 6, border: "1px solid " + TH.greenBorder, background: TH.greenBg, color: TH.greenText, fontSize: 11, fontWeight: 700, cursor: "pointer" }
                }, "\u2713 Save"),
                $("button", {
                  onClick: function() { setChainPopupId(null); setChainDirty(false); setChainAddDepFor(null); },
                  style: { width: 28, height: 28, borderRadius: 6, border: "1px solid " + TH.border, background: TH.bgCard, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: TH.textMuted }
                }, "\u2715")
              )
            ),
            // Chain body — scrollable with drag-and-drop
            $("div", { ref: chainBodyRef, style: { padding: "12px 18px 16px 28px", overflowY: "auto", flex: 1, position: "relative", overscrollBehavior: "contain" } },
              // SVG arrow overlay for non-adjacent deps
              chainArrows.length > 0 && $("svg", {
                style: { position: "absolute", top: 0, left: 0, width: 28, height: "100%", pointerEvents: "none", zIndex: 1, overflow: "visible" }
              },
                chainArrows.map(function(a, ai) {
                  var x1 = 22, x2 = 22;
                  var curveX = Math.max(2, 16 - a.distance * 4); // curve further left for longer jumps
                  var y1 = a.fromY, y2 = a.toY;
                  // Bezier path curving to the left
                  var path = "M " + x1 + " " + y1 + " C " + curveX + " " + y1 + ", " + curveX + " " + y2 + ", " + x2 + " " + y2;
                  return $("g", { key: ai },
                    $("path", {
                      d: path,
                      fill: "none",
                      stroke: a.color,
                      strokeWidth: 1.5,
                      strokeDasharray: "4,2",
                      opacity: 0.7
                    }),
                    // Arrowhead at target (points upward since dep is above)
                    $("polygon", {
                      points: (x2 - 3) + "," + (y2 + 5) + " " + (x2 + 3) + "," + (y2 + 5) + " " + x2 + "," + y2,
                      fill: a.color,
                      opacity: 0.7
                    })
                  );
                })
              ),
              orderedTasks.map(function(ct, idx) {
                var st = statuses[ct.id] || "";
                var isFocus = ct.id === chainData.focusId;
                var isDone = st === "done";
                var isSkip = st === "skip";
                var isCancel = st === "cancel";
                var isClosed = isDone || isSkip || isCancel;
                var icon = STATUS_ICONS[st] || "\u26AA";
                var dateLabel = ct.date && ct.date !== "TBD" ? ct.date + (ct.day ? " " + ct.day : "") : "TBD";
                var timeLabel = ct.time || "";
                var isDragging = chainDragIdx === idx;
                var isDropTarget = chainDropIdx === idx && chainDragIdx !== null && chainDragIdx !== idx;

                return $("div", { key: ct.id + "-wrap" },
                  // Drop zone indicator ABOVE this card
                  isDropTarget && chainDragIdx > idx && $("div", { style: { height: 3, background: TH.accent, borderRadius: 2, marginBottom: 4, transition: "all 0.15s ease" } }),
                  // Connector line between tasks
                  idx > 0 && !isDropTarget && $("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", height: 22, justifyContent: "center" } },
                    $("div", { style: { width: 2, height: 10, background: chainDirty ? TH.amberText + "55" : TH.accent + "55" } }),
                    $("div", { style: { fontSize: 8, color: chainDirty ? TH.amberText + "88" : TH.accent + "88", lineHeight: "8px" } }, "\u25BC"),
                    $("div", { style: { width: 2, height: 2, background: chainDirty ? TH.amberText + "55" : TH.accent + "55" } })
                  ),
                  // Task card — draggable
                  $("div", {
                    "data-chain-id": ct.id,
                    draggable: true,
                    onDragStart: function(e) {
                      setChainDragIdx(idx);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(idx));
                    },
                    onDragEnd: function() {
                      setChainDragIdx(null);
                      setChainDropIdx(null);
                    },
                    onDragOver: function(e) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (chainDragIdx !== null && chainDragIdx !== idx) {
                        setChainDropIdx(idx);
                      }
                    },
                    onDragLeave: function() {
                      setChainDropIdx(function(prev) { return prev === idx ? null : prev; });
                    },
                    onDrop: function(e) {
                      e.preventDefault();
                      if (chainDragIdx !== null && chainDragIdx !== idx) {
                        chainReorder(chainDragIdx, idx);
                      }
                      setChainDragIdx(null);
                      setChainDropIdx(null);
                    },
                    onClick: function() {
                      if (chainDirty) return; // don't navigate while editing
                      if (ct.date && ct.date !== "TBD") {
                        var parts = ct.date.split("/");
                        if (parts.length === 2) {
                          var taskDate = new Date(2026, parseInt(parts[0]) - 1, parseInt(parts[1]));
                          var today2 = new Date(); today2.setHours(0,0,0,0);
                          var diff = Math.round((taskDate - today2) / 86400000);
                          setDayOffset(diff);
                          if (viewMode !== "day" && viewMode !== "3day") setViewMode("day");
                        }
                      }
                      setChainPopupId(null);
                    },
                    style: {
                      padding: "10px 12px", borderRadius: 10, cursor: chainDirty ? "grab" : "pointer",
                      border: isFocus ? "2px solid " + TH.accent : isDropTarget ? "2px dashed " + TH.accent : "1px solid " + (isClosed ? TH.border + "88" : TH.border),
                      background: isDragging ? TH.accent + "18" : (isFocus ? TH.accent + "12" : (isClosed ? TH.bgCard + "88" : TH.bgCard)),
                      opacity: isDragging ? 0.5 : (isClosed && !isFocus ? 0.65 : 1),
                      transition: "all 0.15s ease",
                      userSelect: "none",
                    }
                  },
                    // Top row: drag handle + icon + text + status
                    $("div", { style: { display: "flex", alignItems: "flex-start", gap: 8 } },
                      // Drag handle
                      $("div", { style: {
                        width: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        color: TH.textMuted + "88", fontSize: 10, cursor: "grab", flexShrink: 0, paddingTop: 6,
                        letterSpacing: 1, lineHeight: "5px", userSelect: "none",
                      } }, "\u2261"),
                      // Step number + status icon
                      $("div", { style: {
                        width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13,
                        background: isDone ? TH.greenBg : (isFocus ? TH.accent + "22" : TH.settingsBg),
                        border: "1px solid " + (isDone ? TH.greenBorder : (isFocus ? TH.accent : TH.border)),
                      } }, icon),
                      // Task info
                      $("div", { style: { flex: 1, minWidth: 0 } },
                        $("div", { style: { fontSize: 12, fontWeight: isFocus ? 700 : 600, color: isClosed ? TH.textMuted : TH.text, textDecoration: isClosed ? "line-through" : "none", lineHeight: "16px" } },
                          ct.text
                        ),
                        $("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4, alignItems: "center" } },
                          $("span", { style: { fontSize: 9, padding: "1px 6px", borderRadius: 4, background: TH.settingsBg, color: TH.textMuted, fontWeight: 500 } }, dateLabel),
                          timeLabel && $("span", { style: { fontSize: 9, padding: "1px 6px", borderRadius: 4, background: TH.settingsBg, color: TH.textMuted, fontWeight: 500 } }, timeLabel),
                          $("span", { style: { fontSize: 9, padding: "1px 6px", borderRadius: 4, background: ((getProjectMeta(ct.project) || {}).color || TH.accent) + "18", color: (getProjectMeta(ct.project) || {}).color || TH.accent, fontWeight: 600 } }, ((getProjectMeta(ct.project) || {}).icon ? (getProjectMeta(ct.project) || {}).icon + " " : "") + ct.project),
                          $("span", { style: { fontSize: 8, color: TH.textMuted + "88" } }, ct.id),
                          isFocus && $("span", { style: { fontSize: 8, padding: "1px 5px", borderRadius: 3, background: TH.accent, color: "white", fontWeight: 700 } }, "VIEWING")
                        )
                      ),
                      // Step number
                      $("div", { style: { fontSize: 9, color: TH.textMuted, fontWeight: 600, flexShrink: 0, paddingTop: 2 } }, "#" + (idx + 1))
                    ),
                    ct.notes && $("div", { style: { fontSize: 9, color: TH.textMuted, marginTop: 4, marginLeft: 52, lineHeight: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, ct.notes.substring(0, 80) + (ct.notes.length > 80 ? "..." : "")),
                    // ── Dependency chips ──
                    $("div", { style: { marginTop: 6, marginLeft: 52 } },
                      // Show current in-chain deps as removable chips
                      (() => {
                        var myDeps = (chainDeps[ct.id] || []).filter(function(d) { return chainOrder.indexOf(d) >= 0; });
                        return $("div", { style: { display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" } },
                          myDeps.length > 0 && $("span", { style: { fontSize: 8, color: TH.textMuted, marginRight: 2 } }, "depends on:"),
                          myDeps.map(function(depId) {
                            var depTask = allTasks.find(function(x) { return x.id === depId; });
                            var depSt = statuses[depId] || "";
                            var depDone = depSt === "done";
                            return $("span", {
                              key: depId,
                              style: { display: "inline-flex", alignItems: "center", gap: 2, fontSize: 9, padding: "1px 6px", borderRadius: 4, background: depDone ? TH.greenBg : TH.amberBg, color: depDone ? TH.greenText : TH.amberText, fontWeight: 500, cursor: "pointer" },
                              title: "Click to remove this dependency",
                              onClick: function(e) { e.stopPropagation(); chainRemoveDep(ct.id, depId); }
                            },
                              (depDone ? "\u2713 " : "\u23F3 "),
                              depTask ? depTask.text.substring(0, 20) : depId,
                              $("span", { style: { marginLeft: 3, opacity: 0.6, fontSize: 8 } }, "\u2715")
                            );
                          }),
                          // Add dep button
                          $("button", {
                            onClick: function(e) { e.stopPropagation(); setChainAddDepFor(chainAddDepFor === ct.id ? null : ct.id); },
                            style: { fontSize: 8, padding: "1px 6px", borderRadius: 4, border: "1px dashed " + (chainAddDepFor === ct.id ? TH.accent : TH.border), background: chainAddDepFor === ct.id ? TH.accent + "15" : "transparent", color: chainAddDepFor === ct.id ? TH.accent : TH.textMuted, cursor: "pointer", fontWeight: 600 }
                          }, chainAddDepFor === ct.id ? "cancel" : "+ dep")
                        );
                      })(),
                      // Dropdown to pick a dep when chainAddDepFor === ct.id
                      chainAddDepFor === ct.id && (() => {
                        var myDeps = chainDeps[ct.id] || [];
                        // In-chain candidates
                        var inChain = chainOrder.filter(function(oid) {
                          if (oid === ct.id) return false;
                          if (myDeps.indexOf(oid) >= 0) return false;
                          return true;
                        }).map(function(oid) { return allTasks.find(function(x) { return x.id === oid; }); }).filter(Boolean);
                        // Same-project candidates (not in chain)
                        var projects = {};
                        chainOrder.forEach(function(oid) {
                          var ot = allTasks.find(function(x) { return x.id === oid; });
                          if (ot && ot.project) projects[ot.project] = true;
                        });
                        // Also include current task's project
                        if (ct.project) projects[ct.project] = true;
                        var sameProj = allTasks.filter(function(ot) {
                          if (!ot.project || !projects[ot.project]) return false;
                          if (ot.id === ct.id) return false;
                          if (chainOrder.indexOf(ot.id) >= 0) return false; // already in chain
                          if (myDeps.indexOf(ot.id) >= 0) return false;
                          var st2 = statuses[ot.id] || "";
                          if (st2 === "done" || st2 === "cancel") return false; // skip closed
                          return true;
                        });

                        var renderRow = function(ot, isExternal) {
                          var oSt = statuses[ot.id] || "";
                          var oDone = oSt === "done";
                          return $("div", {
                            key: ot.id,
                            onClick: function() { chainAddDep(ct.id, ot.id); },
                            style: { padding: "3px 6px", borderRadius: 4, cursor: "pointer", fontSize: 10, display: "flex", gap: 6, alignItems: "center", marginBottom: 2, background: "transparent" },
                            onMouseOver: function(e) { e.currentTarget.style.background = TH.accent + "15"; },
                            onMouseOut: function(e) { e.currentTarget.style.background = "transparent"; }
                          },
                            $("span", { style: { fontSize: 9, opacity: 0.7 } }, oDone ? "\u2705" : "\u26AA"),
                            $("span", { style: { fontWeight: 500, color: TH.text, flex: 1 } }, ot.text.substring(0, 32)),
                            $("span", { style: { fontSize: 8, color: (getProjectMeta(ot.project) || {}).color || TH.accent, fontWeight: 500 } }, ((getProjectMeta(ot.project) || {}).icon ? (getProjectMeta(ot.project) || {}).icon + " " : "") + ot.project),
                            $("span", { style: { fontSize: 8, color: TH.textMuted } }, ot.id),
                            isExternal && $("span", { style: { fontSize: 7, padding: "0 3px", borderRadius: 3, background: TH.amberBg, color: TH.amberText, fontWeight: 600 } }, "NEW")
                          );
                        };

                        return $("div", {
                          style: { marginTop: 4, padding: "6px 8px", background: TH.settingsBg, borderRadius: 6, border: "1px solid " + TH.border, maxHeight: 180, overflowY: "auto" },
                          onClick: function(e) { e.stopPropagation(); }
                        },
                          // In-chain section
                          inChain.length > 0 && $("div", null,
                            $("div", { style: { fontSize: 8, color: TH.textMuted, marginBottom: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 } }, "\u{1F517} In chain"),
                            inChain.map(function(ot) { return renderRow(ot, false); })
                          ),
                          // Same-project section
                          sameProj.length > 0 && $("div", null,
                            (inChain.length > 0) && $("div", { style: { height: 1, background: TH.border, margin: "6px 0" } }),
                            $("div", { style: { fontSize: 8, color: TH.textMuted, marginBottom: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 } }, "\u{1F4C1} Same project" + (Object.keys(projects).length > 1 ? "s" : "")),
                            sameProj.slice(0, 15).map(function(ot) { return renderRow(ot, true); }),
                            sameProj.length > 15 && $("div", { style: { fontSize: 8, color: TH.textMuted, padding: 4, textAlign: "center" } }, "+" + (sameProj.length - 15) + " more")
                          ),
                          inChain.length === 0 && sameProj.length === 0 && $("div", { style: { fontSize: 9, color: TH.textMuted, padding: 4, textAlign: "center" } }, "No available tasks to add")
                        );
                      })()
                    )
                  ),
                  // Drop zone indicator BELOW this card
                  isDropTarget && chainDragIdx < idx && $("div", { style: { height: 3, background: TH.accent, borderRadius: 2, marginTop: 4, transition: "all 0.15s ease" } })
                );
              })
            ),
            // Footer
            $("div", { style: { padding: "8px 18px 12px", borderTop: "1px solid " + TH.border, fontSize: 9, color: TH.textMuted, textAlign: "center", flexShrink: 0 } },
              chainDirty ? "Drag to reorder \u2022 \u2715 to remove dep \u2022 Save to apply" : "Drag to reorder \u2022 +dep for chain or project tasks \u2022 Click to jump"
            )
          )
        );
        } catch(chainErr) {
          console.error("Chain popup error:", chainErr);
          return $("div", { style: { position: "fixed", inset: 0, zIndex: 9997, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }, onClick: function() { setChainPopupId(null); } },
            $("div", { style: { background: TH.panelBg, padding: 20, borderRadius: 12, maxWidth: 360, textAlign: "center" } },
              $("div", { style: { fontSize: 14, fontWeight: 700, color: TH.redText, marginBottom: 8 } }, "\u26A0 Chain error"),
              $("div", { style: { fontSize: 11, color: TH.textMuted, marginBottom: 12 } }, chainErr.message),
              $("button", { onClick: function() { setChainPopupId(null); }, style: { padding: "6px 16px", borderRadius: 6, border: "none", background: TH.accent, color: "white", cursor: "pointer", fontWeight: 600 } }, "Close")
            )
          );
        }
      })()}

      {/* Inline confirm dialog */}
      {confirmAction && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)",
        }} onClick={function() { setConfirmAction(null); }}>
          <div onClick={function(e) { e.stopPropagation(); }} style={{
            background: TH.panelBg, border: "1px solid " + TH.border, borderRadius: 12,
            padding: "20px 24px", maxWidth: 340, boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TH.text }}>{confirmAction.msg}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={function() { setConfirmAction(null); }} style={{
                padding: "6px 16px", borderRadius: 6, border: "1px solid " + TH.border,
                background: TH.bgCard, color: TH.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>Cancel</button>
              <button onClick={function() { confirmAction.fn(); setConfirmAction(null); }} style={{
                padding: "6px 16px", borderRadius: 6, border: "1px solid " + TH.redBorder,
                background: TH.redBg, color: TH.redText, fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapped export with ErrorBoundary to prevent white-screen crashes
export default function TaskTracker() {
  return $(TaskTrackerErrorBoundary, null,
    $(TaskTrackerInner, null)
  );
}
