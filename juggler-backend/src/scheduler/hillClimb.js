/**
 * hillClimb.js — Post-greedy hill-climbing optimizer
 *
 * After the greedy phases produce a baseline schedule, tries random
 * swaps/shifts and keeps improvements. Bounded by iteration count
 * and wall-clock time.
 *
 * Move types:
 *  0 - Swap: two non-locked tasks on same day (any duration)
 *  1 - Shift: move task to different gap on same day
 *  2 - Date shift: move non-pinned, non-habit task closer to original date
 */

var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var locationHelpers = require('./locationHelpers');
var resolveLocationId = locationHelpers.resolveLocationId;
var canTaskRun = locationHelpers.canTaskRun;
var timeBlockHelpers = require('./timeBlockHelpers');
var getWhenWindows = timeBlockHelpers.getWhenWindows;
var hasWhen = timeBlockHelpers.hasWhen;
var dependencyHelpers = require('./dependencyHelpers');
var getTaskDeps = dependencyHelpers.getTaskDeps;
var dateHelpers2 = require('./dateHelpers');
var parseTimeToMinutes = dateHelpers2.parseTimeToMinutes;
var scoreSchedule = require('./scoreSchedule');

var MAX_ITERATIONS = 500;
var TIME_LIMIT_MS = 800;
var DEFAULT_TIME_FLEX = 60;
var FULL_RESCORE_INTERVAL = 100;

function isMovable(placement) {
  if (placement.locked) return false;
  var t = placement.task;
  if (!t) return false;
  if (hasWhen(t.when, 'fixed')) return false;
  if (t.rigid) return false;
  return true;
}

/**
 * For habits, check that new start is within flex window of preferred time.
 */
function habitFlexOk(task, newStart, dur) {
  if (!task.habit) return true;
  var sm = parseTimeToMinutes(task.time);
  if (sm === null) return true; // no preferred time
  var flex = task.timeFlex != null ? task.timeFlex : DEFAULT_TIME_FLEX;
  if (flex <= 0) return true;
  return newStart >= sm - flex && newStart + dur <= sm + flex + dur;
}

function fitsWhenWindows(task, dateKey, startMin, dur, dayWindows) {
  var wins = getWhenWindows(task.when, dayWindows[dateKey]);
  if (wins.length === 0) return true;
  for (var i = 0; i < wins.length; i++) {
    if (startMin >= wins[i][0] && startMin + dur <= wins[i][1]) return true;
  }
  return false;
}

function fitsLocation(task, dateKey, startMin, dur, dayBlocks, cfg) {
  for (var m = startMin; m < startMin + dur; m += 15) {
    var locId = resolveLocationId(dateKey, m, cfg, dayBlocks[dateKey]);
    if (!canTaskRun(task, locId, cfg.toolMatrix)) return false;
  }
  var lastMin = startMin + dur - 1;
  var locIdLast = resolveLocationId(dateKey, lastMin, cfg, dayBlocks[dateKey]);
  if (!canTaskRun(task, locIdLast, cfg.toolMatrix)) return false;
  return true;
}

function isFreeRange(occ, start, dur) {
  for (var m = start; m < start + dur; m++) {
    if (occ[m]) return false;
  }
  return true;
}

function reserve(occ, start, dur) {
  for (var m = start; m < start + dur; m++) occ[m] = true;
}

function free(occ, start, dur) {
  for (var m = start; m < start + dur; m++) delete occ[m];
}

/**
 * Find a random valid gap for a task on a given day.
 * Returns start minute or -1.
 */
function findRandomGap(task, dur, dateKey, dayOcc, dayWindows, dayBlocks, cfg) {
  var occ = dayOcc[dateKey];
  if (!occ) return -1;
  var wins = getWhenWindows(task.when, dayWindows[dateKey]);
  if (wins.length === 0) wins = [[360, 1380]];

  var candidates = [];
  for (var wi = 0; wi < wins.length; wi++) {
    var pos = wins[wi][0];
    var wEnd = wins[wi][1];
    while (pos + dur <= wEnd) {
      if (occ[pos]) { pos++; continue; }
      if (isFreeRange(occ, pos, dur) && fitsLocation(task, dateKey, pos, dur, dayBlocks, cfg) && habitFlexOk(task, pos, dur)) {
        candidates.push(pos);
        pos += 15; // skip ahead to avoid too many nearby candidates
      } else {
        pos++;
      }
    }
  }
  if (candidates.length === 0) return -1;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Run hill-climbing optimization on a schedule.
 */
function hillClimb(dayPlacements, dayOcc, dayWindows, dayBlocks, unplaced, allTasks, cfg) {
  var startTime = Date.now();

  var allTasksById = {};
  allTasks.forEach(function(t) { allTasksById[t.id] = t; });

  var dependedOnBy = {};
  allTasks.forEach(function(t) {
    getTaskDeps(t).forEach(function(depId) {
      if (!dependedOnBy[depId]) dependedOnBy[depId] = [];
      dependedOnBy[depId].push(t.id);
    });
  });

  var baseScore = scoreSchedule(dayPlacements, unplaced, allTasks);
  var bestTotal = baseScore.total;
  var scoreBefore = bestTotal;

  var dateKeys = Object.keys(dayPlacements).filter(function(k) {
    return dayPlacements[k] && dayPlacements[k].length > 0;
  });

  if (dateKeys.length === 0) {
    return { improved: false, iterations: 0, elapsed: 0, scoreBefore: scoreBefore, scoreAfter: scoreBefore };
  }

  // Build placement index for dependency checks
  function buildPlacementIndex() {
    var idx = {};
    for (var di = 0; di < dateKeys.length; di++) {
      var dk = dateKeys[di];
      var pls = dayPlacements[dk];
      if (!pls) continue;
      for (var pi = 0; pi < pls.length; pi++) {
        var p = pls[pi];
        if (!p.task) continue;
        if (!idx[p.task.id]) idx[p.task.id] = [];
        idx[p.task.id].push({ dateKey: dk, start: p.start, dur: p.dur });
      }
    }
    return idx;
  }

  function checkDeps(taskId, dateKey, startMin, dur, placIdx) {
    var task = allTasksById[taskId];
    if (!task) return true;
    var thisDate = parseDate(dateKey);
    if (!thisDate) return true;
    var deps = getTaskDeps(task);
    for (var i = 0; i < deps.length; i++) {
      var depParts = placIdx[deps[i]];
      if (!depParts) continue;
      for (var j = 0; j < depParts.length; j++) {
        var depDate = parseDate(depParts[j].dateKey);
        if (!depDate) continue;
        if (thisDate < depDate) return false;
        if (thisDate.getTime() === depDate.getTime() && startMin < depParts[j].start + depParts[j].dur) return false;
      }
    }
    var dependants = dependedOnBy[taskId] || [];
    for (var k = 0; k < dependants.length; k++) {
      var depantParts = placIdx[dependants[k]];
      if (!depantParts) continue;
      for (var l = 0; l < depantParts.length; l++) {
        var depantDate = parseDate(depantParts[l].dateKey);
        if (!depantDate) continue;
        if (thisDate > depantDate) return false;
        if (thisDate.getTime() === depantDate.getTime() && startMin + dur > depantParts[l].start) return false;
      }
    }
    return true;
  }

  // Collect tasks that were placed on a different day than their original date
  // for targeted date-drift moves
  var driftCandidates = [];
  for (var di = 0; di < dateKeys.length; di++) {
    var pls = dayPlacements[dateKeys[di]];
    if (!pls) continue;
    for (var pi = 0; pi < pls.length; pi++) {
      var p = pls[pi];
      if (!p.task || !p.task.date) continue;
      if (p.locked || p.task.habit || p.task.rigid || p.task.datePinned) continue;
      if (hasWhen(p.task.when, 'fixed')) continue;
      if (p._dateKey !== p.task.date) {
        // Don't drift back to original date if it's before startAfter
        if (p.task.startAfter) {
          var saDate = parseDate(p.task.startAfter);
          var origDate = parseDate(p.task.date);
          if (saDate && origDate && origDate < saDate) continue;
        }
        driftCandidates.push({ placement: p, currentDateKey: dateKeys[di] });
      }
    }
  }

  var iterations = 0;
  var improved = false;

  for (var iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (Date.now() - startTime > TIME_LIMIT_MS) break;
    iterations++;

    // Periodic full re-score to correct any drift in running total
    if (iter > 0 && iter % FULL_RESCORE_INTERVAL === 0) {
      bestTotal = scoreSchedule(dayPlacements, unplaced, allTasks).total;
    }

    // Pick move type: 0=swap(40%), 1=shift(30%), 2=date-shift(30%)
    var r = Math.random();
    var moveType = r < 0.4 ? 0 : r < 0.7 ? 1 : 2;

    if (moveType === 0) {
      // SWAP: two non-locked tasks on same day (any duration)
      var dayIdx = Math.floor(Math.random() * dateKeys.length);
      var dk = dateKeys[dayIdx];
      var dayPls = dayPlacements[dk];
      if (!dayPls || dayPls.length < 2) continue;

      var movable = [];
      for (var mi = 0; mi < dayPls.length; mi++) {
        if (isMovable(dayPls[mi])) movable.push(mi);
      }
      if (movable.length < 2) continue;

      var ai = movable[Math.floor(Math.random() * movable.length)];
      var bi = movable[Math.floor(Math.random() * movable.length)];
      if (ai === bi) continue;

      var pa = dayPls[ai], pb = dayPls[bi];
      var oldStartA = pa.start, oldStartB = pb.start;

      // For unequal durations: check both fit at new positions
      // Free both first, then check
      var occ = dayOcc[dk];
      free(occ, oldStartA, pa.dur);
      free(occ, oldStartB, pb.dur);

      // pa goes to oldStartB, pb goes to oldStartA
      var paFits = isFreeRange(occ, oldStartB, pa.dur)
        && fitsWhenWindows(pa.task, dk, oldStartB, pa.dur, dayWindows)
        && fitsLocation(pa.task, dk, oldStartB, pa.dur, dayBlocks, cfg)
        && habitFlexOk(pa.task, oldStartB, pa.dur);
      var pbFits = false;
      if (paFits) {
        reserve(occ, oldStartB, pa.dur);
        pbFits = isFreeRange(occ, oldStartA, pb.dur)
          && fitsWhenWindows(pb.task, dk, oldStartA, pb.dur, dayWindows)
          && fitsLocation(pb.task, dk, oldStartA, pb.dur, dayBlocks, cfg)
          && habitFlexOk(pb.task, oldStartA, pb.dur);
        free(occ, oldStartB, pa.dur);
      }

      if (!paFits || !pbFits) {
        // Revert
        reserve(occ, oldStartA, pa.dur);
        reserve(occ, oldStartB, pb.dur);
        continue;
      }

      // Check dependencies
      // Temporarily apply swap for dep check
      pa.start = oldStartB;
      pb.start = oldStartA;
      var placIdx = buildPlacementIndex();
      var depsOk = checkDeps(pa.task.id, dk, oldStartB, pa.dur, placIdx)
        && checkDeps(pb.task.id, dk, oldStartA, pb.dur, placIdx);
      pa.start = oldStartA;
      pb.start = oldStartB;

      if (!depsOk) {
        reserve(occ, oldStartA, pa.dur);
        reserve(occ, oldStartB, pb.dur);
        continue;
      }

      // Apply swap
      pa.start = oldStartB;
      pb.start = oldStartA;
      reserve(occ, oldStartB, pa.dur);
      reserve(occ, oldStartA, pb.dur);

      var newScore = scoreSchedule(dayPlacements, unplaced, allTasks);
      if (newScore.total < bestTotal) {
        bestTotal = newScore.total;
        improved = true;
      } else {
        // Revert
        free(occ, oldStartB, pa.dur);
        free(occ, oldStartA, pb.dur);
        pa.start = oldStartA;
        pb.start = oldStartB;
        reserve(occ, oldStartA, pa.dur);
        reserve(occ, oldStartB, pb.dur);
      }

    } else if (moveType === 1) {
      // SHIFT: move task to different gap on same day
      var dayIdx2 = Math.floor(Math.random() * dateKeys.length);
      var dk2 = dateKeys[dayIdx2];
      var dayPls2 = dayPlacements[dk2];
      if (!dayPls2 || dayPls2.length === 0) continue;

      var movable2 = [];
      for (var mi2 = 0; mi2 < dayPls2.length; mi2++) {
        if (isMovable(dayPls2[mi2])) movable2.push(mi2);
      }
      if (movable2.length === 0) continue;

      var pi2 = movable2[Math.floor(Math.random() * movable2.length)];
      var placement = dayPls2[pi2];
      var task = placement.task;
      var dur = placement.dur;
      var oldStart = placement.start;

      free(dayOcc[dk2], oldStart, dur);

      var newStart = findRandomGap(task, dur, dk2, dayOcc, dayWindows, dayBlocks, cfg);
      if (newStart < 0 || newStart === oldStart) {
        reserve(dayOcc[dk2], oldStart, dur);
        continue;
      }

      // Check dependencies
      placement.start = newStart;
      var placIdx2 = buildPlacementIndex();
      var depsOk2 = checkDeps(task.id, dk2, newStart, dur, placIdx2);
      placement.start = oldStart;

      if (!depsOk2) {
        reserve(dayOcc[dk2], oldStart, dur);
        continue;
      }

      // Apply
      placement.start = newStart;
      reserve(dayOcc[dk2], newStart, dur);

      var newScore2 = scoreSchedule(dayPlacements, unplaced, allTasks);
      if (newScore2.total < bestTotal) {
        bestTotal = newScore2.total;
        improved = true;
      } else {
        free(dayOcc[dk2], newStart, dur);
        placement.start = oldStart;
        reserve(dayOcc[dk2], oldStart, dur);
      }

    } else {
      // DATE SHIFT: move a drifted task closer to its original date
      if (driftCandidates.length === 0) continue;

      var dcIdx = Math.floor(Math.random() * driftCandidates.length);
      var dc = driftCandidates[dcIdx];
      var pl = dc.placement;
      var origDateKey = pl.task.date;
      var currDateKey = pl._dateKey;

      // Skip if task has moved (from a previous iteration)
      if (pl._dateKey !== dc.currentDateKey) {
        // Update the candidate
        dc.currentDateKey = pl._dateKey;
        if (dc.currentDateKey === origDateKey) {
          driftCandidates.splice(dcIdx, 1);
          continue;
        }
      }

      // Try placing on original date
      var targetDateKey = origDateKey;

      // Enforce startAfter constraint — never move before startAfter date
      if (pl.task.startAfter) {
        var saD = parseDate(pl.task.startAfter);
        var tgtD = parseDate(targetDateKey);
        if (saD && tgtD && tgtD < saD) continue;
      }

      if (!dayOcc[targetDateKey]) continue;
      if (!dayWindows[targetDateKey]) continue;

      var oldDk = pl._dateKey;
      var oldSt = pl.start;
      var plDur = pl.dur;

      // Free from current day
      free(dayOcc[oldDk], oldSt, plDur);

      // Remove from current day's placements list
      var oldPls = dayPlacements[oldDk];
      var plIdx = oldPls.indexOf(pl);

      var newSt2 = findRandomGap(pl.task, plDur, targetDateKey, dayOcc, dayWindows, dayBlocks, cfg);
      if (newSt2 < 0) {
        reserve(dayOcc[oldDk], oldSt, plDur);
        continue;
      }

      // Check dependencies on new day
      pl.start = newSt2;
      pl._dateKey = targetDateKey;
      if (plIdx !== -1) oldPls.splice(plIdx, 1);
      if (!dayPlacements[targetDateKey]) dayPlacements[targetDateKey] = [];
      dayPlacements[targetDateKey].push(pl);

      var placIdx3 = buildPlacementIndex();
      var depsOk3 = checkDeps(pl.task.id, targetDateKey, newSt2, plDur, placIdx3);

      if (!depsOk3) {
        // Revert
        var tgtPls = dayPlacements[targetDateKey];
        var tgtIdx = tgtPls.indexOf(pl);
        if (tgtIdx !== -1) tgtPls.splice(tgtIdx, 1);
        pl.start = oldSt;
        pl._dateKey = oldDk;
        if (plIdx !== -1) oldPls.splice(plIdx, 0, pl);
        else oldPls.push(pl);
        reserve(dayOcc[oldDk], oldSt, plDur);
        continue;
      }

      reserve(dayOcc[targetDateKey], newSt2, plDur);

      var newScore3 = scoreSchedule(dayPlacements, unplaced, allTasks);
      if (newScore3.total < bestTotal) {
        bestTotal = newScore3.total;
        improved = true;
        dc.currentDateKey = targetDateKey;
        // Remove from drift candidates if now on original date
        if (targetDateKey === origDateKey) {
          driftCandidates.splice(dcIdx, 1);
        }
      } else {
        // Revert
        free(dayOcc[targetDateKey], newSt2, plDur);
        var tgtPls2 = dayPlacements[targetDateKey];
        var tgtIdx2 = tgtPls2.indexOf(pl);
        if (tgtIdx2 !== -1) tgtPls2.splice(tgtIdx2, 1);
        pl.start = oldSt;
        pl._dateKey = oldDk;
        if (plIdx !== -1) oldPls.splice(plIdx, 0, pl);
        else oldPls.push(pl);
        reserve(dayOcc[oldDk], oldSt, plDur);
      }
    }
  }

  var elapsed = Date.now() - startTime;

  return {
    improved: improved,
    iterations: iterations,
    elapsed: elapsed,
    scoreBefore: scoreBefore,
    scoreAfter: bestTotal
  };
}

module.exports = hillClimb;
