/**
 * Scheduler-relevant constants — CJS port of juggler-frontend/src/state/constants.js
 */

var PRI_RANK = { P1: 100, P2: 80, P3: 50, P4: 20 };

var TASK_DEFAULTS = {
  where: "anywhere", when: "morning,lunch,afternoon,evening,night",
  dayReq: "any", dur: 30, notes: "", due: "", startAfter: "",
  section: "", dependsOn: []
};

var DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

var GRID_START = 6;  // 6 AM
var GRID_END = 23;   // 11 PM

var DEFAULT_TOOLS = [
  { id: "phone", name: "Phone", icon: "\uD83D\uDCF1" },
  { id: "personal_pc", name: "Personal PC", icon: "\uD83D\uDCBB" },
  { id: "work_pc", name: "Work PC", icon: "\uD83D\uDDA5\uFE0F" },
  { id: "printer", name: "Printer", icon: "\uD83D\uDDA8\uFE0F" },
  { id: "car", name: "Car", icon: "\uD83D\uDE97" },
];

var DEFAULT_TOOL_MATRIX = {
  home: ["phone", "personal_pc", "car"],
  work: ["phone", "work_pc", "printer"],
  transit: ["phone"],
  downtown: ["phone", "car"],
  gym: ["phone"],
};

var DEFAULT_WEEKDAY_BLOCKS = [
  { id: "morning", tag: "morning", name: "Morning", start: 360, end: 480, color: "#F59E0B", icon: "\u2600\uFE0F", loc: "home" },
  { id: "biz1", tag: "biz", name: "Biz", start: 480, end: 720, color: "#2563EB", icon: "\uD83D\uDCBC", loc: "work" },
  { id: "lunch", tag: "lunch", name: "Lunch", start: 720, end: 780, color: "#059669", icon: "\uD83C\uDF7D\uFE0F", loc: "work" },
  { id: "biz2", tag: "biz", name: "Biz", start: 780, end: 1020, color: "#2563EB", icon: "\uD83D\uDCBC", loc: "work" },
  { id: "evening", tag: "evening", name: "Evening", start: 1020, end: 1260, color: "#7C3AED", icon: "\uD83C\uDF19", loc: "home" },
  { id: "night", tag: "night", name: "Night", start: 1260, end: 1380, color: "#475569", icon: "\uD83C\uDF11", loc: "home" },
];

var DEFAULT_WEEKEND_BLOCKS = [
  { id: "morning", tag: "morning", name: "Morning", start: 420, end: 720, color: "#F59E0B", icon: "\u2600\uFE0F", loc: "home" },
  { id: "afternoon", tag: "afternoon", name: "Afternoon", start: 720, end: 1020, color: "#F59E0B", icon: "\uD83C\uDF24\uFE0F", loc: "home" },
  { id: "evening", tag: "evening", name: "Evening", start: 1020, end: 1260, color: "#7C3AED", icon: "\uD83C\uDF19", loc: "home" },
  { id: "night", tag: "night", name: "Night", start: 1260, end: 1380, color: "#475569", icon: "\uD83C\uDF11", loc: "home" },
];

var DEFAULT_TIME_BLOCKS = {
  Mon: DEFAULT_WEEKDAY_BLOCKS, Tue: DEFAULT_WEEKDAY_BLOCKS, Wed: DEFAULT_WEEKDAY_BLOCKS,
  Thu: DEFAULT_WEEKDAY_BLOCKS, Fri: DEFAULT_WEEKDAY_BLOCKS,
  Sat: DEFAULT_WEEKEND_BLOCKS, Sun: DEFAULT_WEEKEND_BLOCKS,
};

// Auto-invalidate cached schedules whenever the scheduler source changes.
// Composite version = manual prefix + content hash of the core scheduler
// files. Any edit to unifiedScheduleV2.js / runSchedule.js / reconcile /
// the shared expandRecurring changes the hash, so `cache.schedulerVersion
// === SCHEDULER_VERSION` flips on the next read and stale placements get
// rebuilt instead of served.
//
// Keep MANUAL_SCHEDULER_VERSION as an explicit escape hatch for cases
// where semantics change WITHOUT a code edit — e.g. a cfg format change,
// a default-blocks bump, or an emergency "burn the cache" across a fleet.
// Bump it and every cache becomes stale, regardless of hash.
var MANUAL_SCHEDULER_VERSION = 3;

function computeSchedulerHash() {
  var fs = require('fs');
  var crypto = require('crypto');
  var path = require('path');
  // Order matters for hash stability, not correctness: same files every time.
  // Hash all logic that, if edited, should invalidate the cache. Keep this
  // list tight — including every helper bloats noise when iterating.
  var files = [
    path.join(__dirname, 'unifiedScheduleV2.js'),
    path.join(__dirname, 'runSchedule.js'),
    path.join(__dirname, 'reconcileOccurrences.js'),
    path.join(__dirname, '..', '..', '..', 'shared', 'scheduler', 'expandRecurring.js')
  ];
  var h = crypto.createHash('sha1');
  files.forEach(function(f) {
    try { h.update(fs.readFileSync(f)); }
    catch (e) { /* missing file — skip rather than fail startup */ }
  });
  return h.digest('hex').slice(0, 10);
}

var SCHEDULER_VERSION = MANUAL_SCHEDULER_VERSION + '-' + computeSchedulerHash();

// Forward expansion horizon for recurring templates. The scheduler only
// generates/places recurring instances out to today + RECUR_EXPAND_DAYS.
// Existing pending instances beyond this horizon are grandfathered (not
// deleted by the reconciler) so users don't lose manually-adjusted
// occurrences when the horizon shrinks.
var RECUR_EXPAND_DAYS = 14;

module.exports = {
  PRI_RANK,
  TASK_DEFAULTS,
  DAY_NAMES,
  GRID_START,
  GRID_END,
  DEFAULT_TOOLS,
  DEFAULT_TOOL_MATRIX,
  DEFAULT_WEEKDAY_BLOCKS,
  DEFAULT_WEEKEND_BLOCKS,
  DEFAULT_TIME_BLOCKS,
  DEFAULT_TIMEZONE: 'America/New_York',
  SCHEDULER_VERSION,
  RECUR_EXPAND_DAYS
};
