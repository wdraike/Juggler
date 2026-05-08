/**
 * scoreSchedule — compute a quality score for a proposed schedule.
 *
 * Lower score = better. 0 = perfect.
 *
 * @param {Object} dayPlacements  { dateKey: [ { task, start, dur, ...} ] }
 * @param {Array}  unplaced       Array of task objects that could not be placed
 * @param {Array}  allTasks       All task objects that were considered
 * @returns {{ total: number, breakdown: Object, details: Array }}
 */

var constants = require('./constants');
var PRI_RANK = constants.PRI_RANK;

var UNPLACED_MULTIPLIER = 1;
var DEADLINE_MISS_PENALTY = 500;
var PRIORITY_DRIFT_BASE = 20;
var DATE_DRIFT_PENALTY = 10;
var FRAGMENTATION_PENALTY = 15;

/**
 * Parse a date string like '3/22' or '3/22/2026' into a comparable integer
 * (YYYYMMDD). If year is missing, uses current year.
 */
function parseDateKey(str) {
  if (!str) return null;
  var parts = str.split('/');
  if (parts.length < 2) return null;
  var month = parseInt(parts[0], 10);
  var day   = parseInt(parts[1], 10);
  var year  = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();
  return year * 10000 + month * 100 + day;
}

function priWeight(pri) {
  return PRI_RANK[pri] || PRI_RANK['P3'];
}

function scoreSchedule(dayPlacements, unplaced, allTasks) {
  var breakdown = {
    unplaced:      0,
    deadlineMiss:  0,
    priorityDrift: 0,
    dateDrift:     0,
    fragmentation: 0
  };
  var details = [];

  // ── 1. Unplaced penalty ─────────────────────────────────────────
  (unplaced || []).forEach(function(task) {
    var penalty = priWeight(task.pri) * UNPLACED_MULTIPLIER;
    breakdown.unplaced += penalty;
    details.push({ taskId: task.id, type: 'unplaced', penalty: penalty });
  });

  // ── 2. Per-day analysis ─────────────────────────────────────────
  Object.keys(dayPlacements || {}).forEach(function(dateKey) {
    var slots = dayPlacements[dateKey];
    if (!slots || slots.length === 0) return;

    // ── 2a. Deadline miss ──────────────────────────────────────────
    slots.forEach(function(slot) {
      var task = slot.task;
      if (!task) return;
      var deadline = task.deadline || task.deadlineDate;
      if (!deadline) return;
      var placedNum   = parseDateKey(dateKey);
      var deadlineNum = parseDateKey(deadline);
      if (placedNum != null && deadlineNum != null && placedNum > deadlineNum) {
        var penalty = DEADLINE_MISS_PENALTY;
        breakdown.deadlineMiss += penalty;
        details.push({ taskId: task.id, type: 'deadlineMiss', penalty: penalty });
      }
    });

    // ── 2b. Priority drift (within the same day) ───────────────────
    // Sort placements by start time; check every adjacent pair.
    var sorted = slots.slice().sort(function(a, b) { return a.start - b.start; });
    for (var i = 0; i < sorted.length - 1; i++) {
      var earlier = sorted[i];
      var later   = sorted[i + 1];
      if (!earlier.task || !later.task) continue;
      var priEarlier = priWeight(earlier.task.pri);
      var priLater   = priWeight(later.task.pri);
      // Higher PRI_RANK = higher priority. If a lower-priority task is placed
      // before a higher-priority task, that's drift.
      if (priEarlier < priLater) {
        var gap     = priLater - priEarlier;
        var penalty = PRIORITY_DRIFT_BASE + gap;
        breakdown.priorityDrift += penalty;
        details.push({ taskId: earlier.task.id, type: 'priorityDrift', penalty: penalty });
      }
    }

    // ── 2c. Date drift (placed on different day than task.date) ────
    slots.forEach(function(slot) {
      var task = slot.task;
      if (!task || !task.date) return;
      var taskNum   = parseDateKey(task.date);
      var placedNum = parseDateKey(dateKey);
      if (taskNum != null && placedNum != null && taskNum !== placedNum) {
        breakdown.dateDrift += DATE_DRIFT_PENALTY;
        details.push({ taskId: task.id, type: 'dateDrift', penalty: DATE_DRIFT_PENALTY });
      }
    });

    // ── 2d. Fragmentation (split tasks) ────────────────────────────
    // Group placements by task id that have splitPart metadata.
    var seenSplit = {};
    slots.forEach(function(slot) {
      var task = slot.task;
      if (!task) return;
      if (slot.splitPart == null) return;
      if (!seenSplit[task.id]) seenSplit[task.id] = 0;
      seenSplit[task.id]++;
    });
    Object.keys(seenSplit).forEach(function(taskId) {
      var parts = seenSplit[taskId];
      if (parts <= 1) return;
      // Penalize each split beyond the first
      var penalty = (parts - 1) * FRAGMENTATION_PENALTY;
      breakdown.fragmentation += penalty;
      details.push({ taskId: taskId, type: 'fragmentation', penalty: penalty });
    });
  });

  // ── 3. Total ────────────────────────────────────────────────────
  var total = 0;
  Object.keys(breakdown).forEach(function(k) { total += breakdown[k]; });

  return { total: total, breakdown: breakdown, details: details };
}

module.exports = scoreSchedule;
