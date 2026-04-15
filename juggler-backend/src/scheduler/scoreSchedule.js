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
var W_PRIORITY_DRIFT = 200;
var W_CROSS_DAY_PRI = 80;
var W_RECUR_TIME_DRIFT = 10;
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
  // Priority ordering matters equally at all times of day.
  // Higher-pri tasks should always come first on a given day.
  return 1;
}

/**
 * Score a schedule.
 *
 * @param {Object} dayPlacements - { dateKey: [{ task, start, dur, locked, _dateKey }] }
 * @param {Array}  unplaced      - array of unplaced task objects
 * @param {Array}  allTasks       - all task objects (for dependency lookups)
 * @returns {{ total, breakdown, details }}
 */
function scoreSchedule(dayPlacements, unplaced, allTasks, options) {
  var todayKey = options && options.todayKey || null;
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
      if (t.recurring) mult *= 1.5;
      unplacedPenalty += mult;
      details.push({ type: 'unplaced', taskId: t.id, text: t.text, penalty: mult });
    });
  }

  // 2. Deadline Miss Penalty
  var deadlineMissPenalty = 0;
  for (var tid in placementsByTask) {
    var task = taskById[tid];
    if (!task || !task.deadline) continue;
    var parts = placementsByTask[tid];
    // Use the latest placement date for this task
    var latestDateKey = parts[0].dateKey;
    for (var i = 1; i < parts.length; i++) {
      if (dateDiffDays(parts[i].dateKey, latestDateKey) > 0) {
        latestDateKey = parts[i].dateKey;
      }
    }
    var daysLate = dateDiffDays(latestDateKey, task.deadline);
    if (daysLate > 0) {
      var p = daysLate * priMultiplier(task.pri);
      deadlineMissPenalty += p;
      details.push({ type: 'deadlineMiss', taskId: tid, text: task.text, daysLate: daysLate, penalty: p });
    }
  }

  // 3. Priority Drift Penalty
  // Use pre-computed ancestors if provided (avoids recomputation during hill-climbing)
  var ancestors = (options && options._ancestors) || {};
  if (!options || !options._ancestors) {
    (function buildAncestors() {
      function getAnc(tid) {
        if (ancestors[tid]) return ancestors[tid];
        var result = {};
        ancestors[tid] = result;
        var task = taskById[tid];
        if (!task) return result;
        var deps = getTaskDeps(task);
        for (var di2 = 0; di2 < deps.length; di2++) {
          result[deps[di2]] = true;
          var grandparents = getAnc(deps[di2]);
          for (var gp in grandparents) result[gp] = true;
        }
        return result;
      }
      allTasks.forEach(function(t) { getAnc(t.id); });
    })();
  }

  var priorityDriftPenalty = 0;
  dateKeys.forEach(function(dateKey) {
    var placements = dayPlacements[dateKey];
    if (!placements || placements.length < 2) return;
    // Sort by start time, then scan for priority inversions (O(n log n) vs O(n²))
    var movable = [];
    for (var mi = 0; mi < placements.length; mi++) {
      var mp = placements[mi];
      if (!mp.task || mp.locked || mp.marker) continue;
      movable.push(mp);
    }
    if (movable.length < 2) return;
    movable.sort(function(a, b) { return a.start - b.start; });
    // Build suffix max: maxPriAfter[i] = max priority of items at index > i
    var maxPriAfter = new Array(movable.length);
    maxPriAfter[movable.length - 1] = 0;
    for (var ri = movable.length - 2; ri >= 0; ri--) {
      maxPriAfter[ri] = Math.max(priMultiplier(movable[ri + 1].task.pri), maxPriAfter[ri + 1]);
    }
    // Scan: if this item's pri < max pri of later items, it's a drift
    for (var si = 0; si < movable.length - 1; si++) {
      var sp = movable[si];
      var spPri = priMultiplier(sp.task.pri);
      if (spPri < maxPriAfter[si]) {
        // Scan forward to find the specific higher-pri items
        for (var sj = si + 1; sj < movable.length; sj++) {
          var sq = movable[sj];
          var sqPri = priMultiplier(sq.task.pri);
          if (sqPri > spPri) {
            if (ancestors[sq.task.id] && ancestors[sq.task.id][sp.task.id]) continue;
            priorityDriftPenalty += (sqPri - spPri);
          }
        }
      }
    }
  });

  // 4. Recurring Time Drift
  var recurTimeDriftPenalty = 0;
  for (var tid2 in placementsByTask) {
    var task2 = taskById[tid2];
    if (!task2 || !task2.recurring || !task2.time) continue;
    var preferredMin = parseTimeToMinutes(task2.time);
    if (preferredMin === null) continue;
    var parts2 = placementsByTask[tid2];
    parts2.forEach(function(part) {
      var drift = Math.abs(part.start - preferredMin);
      var p = (drift / 60) * priMultiplier(task2.pri);
      if (p > 0) {
        recurTimeDriftPenalty += p;
        details.push({ type: 'recurTimeDrift', taskId: tid2, text: task2.text, drift: drift, penalty: p });
      }
    });
  }

  // 5. Fragmentation Penalty
  var fragmentationPenalty = 0;
  for (var tid3 in placementsByTask) {
    var task3 = taskById[tid3];
    if (!task3) continue;
    if (task3.recurring) continue; // recurringTasks exempt
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
      } else if (slack === 0) {
        // Same-day: check minute-level ordering
        // Find latest end minute of the dependency on this day
        var depLatestEnd = 0;
        for (var i5 = 0; i5 < taskParts.length; i5++) {
          if (taskParts[i5].dateKey === lastDateKey) {
            var end5 = taskParts[i5].start + taskParts[i5].dur;
            if (end5 > depLatestEnd) depLatestEnd = end5;
          }
        }
        // Find earliest start minute of the dependant on this day
        var depantEarliestStart = Infinity;
        for (var i6 = 0; i6 < depParts.length; i6++) {
          if (depParts[i6].dateKey === earliestDepKey) {
            if (depParts[i6].start < depantEarliestStart) depantEarliestStart = depParts[i6].start;
          }
        }
        if (depLatestEnd > depantEarliestStart) {
          dependencySlackPenalty += 100;
          details.push({ type: 'depViolation', taskId: tid4, dependant: dependants[di], slack: 0, penalty: 100, note: 'same-day minute ordering' });
        }
      } else if (slack > 7) {
        var p4 = (slack - 7) * 0.5;
        dependencySlackPenalty += p4;
        details.push({ type: 'depSlack', taskId: tid4, dependant: dependants[di], slack: slack, penalty: p4 });
      }
    }
  }

  // 7. Cross-Day Priority Inversion Penalty
  // Penalize when a lower-priority task is on an earlier day than a higher-priority task.
  // Excludes recurringTasks, locked tasks, and dep-constrained orderings.
  var crossDayPriPenalty = 0;
  var sortedDateKeys = dateKeys.slice().sort(function(a, b) {
    return dateDiffDays(a, b);
  });
  // Track high-pri task IDs seen on later days (for dep exemption checks)
  var maxPriSeenLater = 0;
  var laterHighPriTaskIds = []; // [{id, pri}] — tasks on later days
  for (var sdi = sortedDateKeys.length - 1; sdi >= 0; sdi--) {
    var sdKey = sortedDateKeys[sdi];
    var sdPlacements = dayPlacements[sdKey];
    if (!sdPlacements) continue;
    var dayMaxPri = 0;
    for (var spi = 0; spi < sdPlacements.length; spi++) {
      var sp = sdPlacements[spi];
      if (!sp.task || sp.locked) continue;
      if (sp.task.recurring) continue;
      var spPri = priMultiplier(sp.task.pri);
      if (spPri > dayMaxPri) dayMaxPri = spPri;
    }
    if (maxPriSeenLater > 0) {
      for (var spi2 = 0; spi2 < sdPlacements.length; spi2++) {
        var sp2 = sdPlacements[spi2];
        if (!sp2.task || sp2.locked) continue;
        if (sp2.task.recurring) continue;
        var sp2Pri = priMultiplier(sp2.task.pri);
        if (sp2Pri < maxPriSeenLater) {
          // Check if this low-pri task is a dep ancestor of any high-pri task on a later day
          var depExempt = false;
          for (var lti = 0; lti < laterHighPriTaskIds.length && !depExempt; lti++) {
            if (laterHighPriTaskIds[lti].pri > sp2Pri && ancestors[laterHighPriTaskIds[lti].id] && ancestors[laterHighPriTaskIds[lti].id][sp2.task.id]) {
              depExempt = true;
            }
          }
          if (!depExempt) {
            var priDiff = maxPriSeenLater - sp2Pri;
            // Premium: low-pri tasks on today are more costly to waste
            var todayPremium = (todayKey && sdKey === todayKey) ? 1.5 : 1.0;
            var adjustedDiff = priDiff * todayPremium;
            crossDayPriPenalty += adjustedDiff;
            details.push({ type: 'crossDayPri', taskId: sp2.task.id, text: sp2.task.text, date: sdKey, priDiff: priDiff, penalty: adjustedDiff });
          }
        }
      }
    }
    // Add this day's tasks to the later-tasks list and update max
    for (var spi3 = 0; spi3 < sdPlacements.length; spi3++) {
      var sp3 = sdPlacements[spi3];
      if (!sp3.task || sp3.locked || sp3.task.recurring) continue;
      laterHighPriTaskIds.push({ id: sp3.task.id, pri: priMultiplier(sp3.task.pri) });
    }
    if (dayMaxPri > maxPriSeenLater) maxPriSeenLater = dayMaxPri;
  }

  // 8. Date Drift Penalty
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
    + W_CROSS_DAY_PRI * crossDayPriPenalty
    + W_RECUR_TIME_DRIFT * recurTimeDriftPenalty
    + W_FRAGMENTATION * fragmentationPenalty
    + W_DEPENDENCY_SLACK * dependencySlackPenalty
    + W_DATE_DRIFT * dateDriftPenalty;

  return {
    total: Math.round(total * 100) / 100,
    breakdown: {
      unplaced: Math.round(W_UNPLACED * unplacedPenalty * 100) / 100,
      deadlineMiss: Math.round(W_DEADLINE_MISS * deadlineMissPenalty * 100) / 100,
      priorityDrift: Math.round(W_PRIORITY_DRIFT * priorityDriftPenalty * 100) / 100,
      crossDayPri: Math.round(W_CROSS_DAY_PRI * crossDayPriPenalty * 100) / 100,
      recurTimeDrift: Math.round(W_RECUR_TIME_DRIFT * recurTimeDriftPenalty * 100) / 100,
      fragmentation: Math.round(W_FRAGMENTATION * fragmentationPenalty * 100) / 100,
      dependencySlack: Math.round(W_DEPENDENCY_SLACK * dependencySlackPenalty * 100) / 100,
      dateDrift: Math.round(W_DATE_DRIFT * dateDriftPenalty * 100) / 100
    },
    details: details
  };
}

module.exports = scoreSchedule;
