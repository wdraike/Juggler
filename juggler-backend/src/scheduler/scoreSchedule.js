/**
 * scoreSchedule.js — Objective function for schedule quality
 *
 * Computes a weighted penalty score (lower = better, 0 = perfect).
 * Seven dimensions capture different aspects of schedule quality.
 */

var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var parseTimeToMinutes = dateHelpers.parseTimeToMinutes;
var dependencyHelpers = require('./dependencyHelpers');
var getTaskDeps = dependencyHelpers.getTaskDeps;

// Weights
var W_UNPLACED = 1000;
var W_DEADLINE_MISS = 500;
var W_PRIORITY_DRIFT = 50;
var W_HABIT_TIME_DRIFT = 10;
var W_FRAGMENTATION = 20;
var W_DEPENDENCY_SLACK = 5;
var W_DATE_DRIFT = 10;

function priMultiplier(pri) {
  if (pri === 'P1') return 4;
  if (pri === 'P2') return 3;
  if (pri === 'P4') return 1;
  return 2; // P3 default
}

function dateDiffDays(dateKeyA, dateKeyB) {
  var a = parseDate(dateKeyA);
  var b = parseDate(dateKeyB);
  if (!a || !b) return 0;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function slotQuality(startMin) {
  if (startMin >= 540 && startMin < 720) return 3;  // 9am-12pm prime
  if (startMin >= 720 && startMin < 1020) return 2;  // 12pm-5pm afternoon
  return 1; // evening/early morning
}

/**
 * Score a schedule.
 *
 * @param {Object} dayPlacements - { dateKey: [{ task, start, dur, locked, _dateKey }] }
 * @param {Array}  unplaced      - array of unplaced task objects
 * @param {Array}  allTasks       - all task objects (for dependency lookups)
 * @returns {{ total, breakdown, details }}
 */
function scoreSchedule(dayPlacements, unplaced, allTasks) {
  var details = [];

  // Build task lookup
  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Build placement index: taskId -> [{ dateKey, start, dur }]
  var placementsByTask = {};
  var dateKeys = Object.keys(dayPlacements);
  dateKeys.forEach(function(dateKey) {
    var placements = dayPlacements[dateKey];
    if (!placements) return;
    placements.forEach(function(p) {
      if (!p.task || !p.task.id) return;
      var id = p.task.id;
      if (!placementsByTask[id]) placementsByTask[id] = [];
      placementsByTask[id].push({ dateKey: dateKey, start: p.start, dur: p.dur });
    });
  });

  // 1. Unplaced Penalty
  var unplacedPenalty = 0;
  if (unplaced && unplaced.length > 0) {
    unplaced.forEach(function(t) {
      var mult = priMultiplier(t.pri);
      if (t.habit) mult *= 1.5;
      unplacedPenalty += mult;
      details.push({ type: 'unplaced', taskId: t.id, text: t.text, penalty: mult });
    });
  }

  // 2. Deadline Miss Penalty
  var deadlineMissPenalty = 0;
  for (var tid in placementsByTask) {
    var task = taskById[tid];
    if (!task || !task.due) continue;
    var parts = placementsByTask[tid];
    // Use the latest placement date for this task
    var latestDateKey = parts[0].dateKey;
    for (var i = 1; i < parts.length; i++) {
      if (dateDiffDays(parts[i].dateKey, latestDateKey) > 0) {
        latestDateKey = parts[i].dateKey;
      }
    }
    var daysLate = dateDiffDays(latestDateKey, task.due);
    if (daysLate > 0) {
      var p = daysLate * priMultiplier(task.pri);
      deadlineMissPenalty += p;
      details.push({ type: 'deadlineMiss', taskId: tid, text: task.text, daysLate: daysLate, penalty: p });
    }
  }

  // 3. Priority Drift Penalty
  var priorityDriftPenalty = 0;
  dateKeys.forEach(function(dateKey) {
    var placements = dayPlacements[dateKey];
    if (!placements || placements.length < 2) return;
    // Compare each pair
    for (var i = 0; i < placements.length; i++) {
      for (var j = i + 1; j < placements.length; j++) {
        var a = placements[i], b = placements[j];
        if (!a.task || !b.task) continue;
        var priA = priMultiplier(a.task.pri);
        var priB = priMultiplier(b.task.pri);
        // If lower-pri task is in an earlier (better) slot than higher-pri task
        if (priA < priB && a.start < b.start) {
          var diff = priB - priA;
          var p = diff * slotQuality(a.start);
          priorityDriftPenalty += p;
        } else if (priB < priA && b.start < a.start) {
          var diff2 = priA - priB;
          var p2 = diff2 * slotQuality(b.start);
          priorityDriftPenalty += p2;
        }
      }
    }
  });

  // 4. Habit Time Drift
  var habitTimeDriftPenalty = 0;
  for (var tid2 in placementsByTask) {
    var task2 = taskById[tid2];
    if (!task2 || !task2.habit || !task2.time) continue;
    var preferredMin = parseTimeToMinutes(task2.time);
    if (preferredMin === null) continue;
    var parts2 = placementsByTask[tid2];
    parts2.forEach(function(part) {
      var drift = Math.abs(part.start - preferredMin);
      var p = (drift / 60) * priMultiplier(task2.pri);
      if (p > 0) {
        habitTimeDriftPenalty += p;
        details.push({ type: 'habitTimeDrift', taskId: tid2, text: task2.text, drift: drift, penalty: p });
      }
    });
  }

  // 5. Fragmentation Penalty
  var fragmentationPenalty = 0;
  for (var tid3 in placementsByTask) {
    var task3 = taskById[tid3];
    if (!task3) continue;
    if (task3.habit) continue; // habits exempt
    var parts3 = placementsByTask[tid3];
    if (parts3.length <= 1) continue;
    var numParts = parts3.length;
    var smallestChunk = parts3[0].dur;
    for (var i2 = 1; i2 < parts3.length; i2++) {
      if (parts3[i2].dur < smallestChunk) smallestChunk = parts3[i2].dur;
    }
    var p3 = (numParts - 1) * 2;
    if (smallestChunk < 15) p3 += 5;
    fragmentationPenalty += p3;
    details.push({ type: 'fragmentation', taskId: tid3, text: task3.text, parts: numParts, smallest: smallestChunk, penalty: p3 });
  }

  // 6. Dependency Slack Penalty
  var dependencySlackPenalty = 0;
  // Build reverse dependency map
  var dependedOnBy = {};
  allTasks.forEach(function(t) {
    getTaskDeps(t).forEach(function(depId) {
      if (!dependedOnBy[depId]) dependedOnBy[depId] = [];
      dependedOnBy[depId].push(t.id);
    });
  });
  for (var tid4 in dependedOnBy) {
    var taskParts = placementsByTask[tid4];
    if (!taskParts || taskParts.length === 0) continue;
    // Find last placement date for this task
    var lastDateKey = taskParts[0].dateKey;
    for (var i3 = 1; i3 < taskParts.length; i3++) {
      if (dateDiffDays(taskParts[i3].dateKey, lastDateKey) > 0) lastDateKey = taskParts[i3].dateKey;
    }
    var dependants = dependedOnBy[tid4];
    for (var di = 0; di < dependants.length; di++) {
      var depParts = placementsByTask[dependants[di]];
      if (!depParts || depParts.length === 0) continue;
      // Find earliest placement date for dependant
      var earliestDepKey = depParts[0].dateKey;
      for (var i4 = 1; i4 < depParts.length; i4++) {
        if (dateDiffDays(depParts[i4].dateKey, earliestDepKey) < 0) earliestDepKey = depParts[i4].dateKey;
      }
      var slack = dateDiffDays(earliestDepKey, lastDateKey);
      if (slack < 0) {
        dependencySlackPenalty += 100;
        details.push({ type: 'depViolation', taskId: tid4, dependant: dependants[di], slack: slack, penalty: 100 });
      } else if (slack > 7) {
        var p4 = (slack - 7) * 0.5;
        dependencySlackPenalty += p4;
        details.push({ type: 'depSlack', taskId: tid4, dependant: dependants[di], slack: slack, penalty: p4 });
      }
    }
  }

  // 7. Date Drift Penalty
  var dateDriftPenalty = 0;
  for (var tid5 in placementsByTask) {
    var task5 = taskById[tid5];
    if (!task5 || !task5.date) continue;
    var parts5 = placementsByTask[tid5];
    // Use the first placement date
    var placedDateKey = parts5[0].dateKey;
    if (placedDateKey !== task5.date) {
      var daysMoved = Math.abs(dateDiffDays(placedDateKey, task5.date));
      if (daysMoved > 0) {
        var mult2 = task5.datePinned ? 3 : 1;
        var p5 = daysMoved * mult2 * 0.5;
        dateDriftPenalty += p5;
        details.push({ type: 'dateDrift', taskId: tid5, text: task5.text, from: task5.date, to: placedDateKey, days: daysMoved, penalty: p5 });
      }
    }
  }

  var total = W_UNPLACED * unplacedPenalty
    + W_DEADLINE_MISS * deadlineMissPenalty
    + W_PRIORITY_DRIFT * priorityDriftPenalty
    + W_HABIT_TIME_DRIFT * habitTimeDriftPenalty
    + W_FRAGMENTATION * fragmentationPenalty
    + W_DEPENDENCY_SLACK * dependencySlackPenalty
    + W_DATE_DRIFT * dateDriftPenalty;

  return {
    total: Math.round(total * 100) / 100,
    breakdown: {
      unplaced: Math.round(W_UNPLACED * unplacedPenalty * 100) / 100,
      deadlineMiss: Math.round(W_DEADLINE_MISS * deadlineMissPenalty * 100) / 100,
      priorityDrift: Math.round(W_PRIORITY_DRIFT * priorityDriftPenalty * 100) / 100,
      habitTimeDrift: Math.round(W_HABIT_TIME_DRIFT * habitTimeDriftPenalty * 100) / 100,
      fragmentation: Math.round(W_FRAGMENTATION * fragmentationPenalty * 100) / 100,
      dependencySlack: Math.round(W_DEPENDENCY_SLACK * dependencySlackPenalty * 100) / 100,
      dateDrift: Math.round(W_DATE_DRIFT * dateDriftPenalty * 100) / 100
    },
    details: details
  };
}

module.exports = scoreSchedule;
