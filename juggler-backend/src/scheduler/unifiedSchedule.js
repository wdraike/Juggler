/**
 * Unified Scheduler
 * Phase 0: Fixed items + rigid habits (immovable anchors)
 * Phase 1: Habits + deadline tasks late-placed at/before due date (P1→P4)
 * Phase 2: Non-deadline flexible tasks fill remaining slots (P1→P4)
 * Phase 3: Pull deadline tasks forward into gaps (P1→P4, earliest first)
 *
 * This order guarantees deadlines are met before flexible tasks consume
 * capacity, and flexible tasks lock in before pull-forward can displace them.
 */

var constants = require('./constants');
var GRID_START = constants.GRID_START;
var GRID_END = constants.GRID_END;

var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var parseTimeToMinutes = dateHelpers.parseTimeToMinutes;
var timeBlockHelpers = require('./timeBlockHelpers');
var getBlocksForDate = timeBlockHelpers.getBlocksForDate;
var buildWindowsFromBlocks = timeBlockHelpers.buildWindowsFromBlocks;
var hasWhen = timeBlockHelpers.hasWhen;
var parseWhen = timeBlockHelpers.parseWhen;
var getWhenWindows = timeBlockHelpers.getWhenWindows;
var locationHelpers = require('./locationHelpers');
var resolveLocationId = locationHelpers.resolveLocationId;
var canTaskRun = locationHelpers.canTaskRun;
var dependencyHelpers = require('./dependencyHelpers');
var getTaskDeps = dependencyHelpers.getTaskDeps;
var scoreSchedule = require('./scoreSchedule');
var hillClimb = require('./hillClimb');

function normalizePri(pri) {
  if (!pri) return 'P3';
  var s = String(pri).trim();
  if (/^P[1-4]$/i.test(s)) return s.toUpperCase();
  if (/^[1-4]$/.test(s)) return 'P' + s;
  return 'P3';
}

function effectiveDuration(t) {
  var rd = t.timeRemaining != null ? t.timeRemaining : t.dur;
  return Math.min(rd > 0 ? rd : (rd === 0 ? 0 : 30), 720);
}

function getTravelBefore(t) { return t.travelBefore > 0 ? t.travelBefore : 0; }
function getTravelAfter(t) { return t.travelAfter > 0 ? t.travelAfter : 0; }

function unifiedSchedule(allTasks, statuses, effectiveTodayKey, nowMins, cfg) {
  var PERF = Date.now();

  var MIN_CHUNK = cfg.splitMinDefault || 15;
  var WALK_END = 23 * 60;
  var DAY_START = GRID_START * 60;
  var DAY_END = GRID_END * 60 + 59;
  var newSt = Object.assign({}, statuses);
  var taskUpdates = {};
  var schedulerWarnings = [];

  // Normalize priorities (accept both "1" and "P1" formats)
  allTasks.forEach(function(t) { t.pri = normalizePri(t.pri); });

  // Build date range
  var dates = [];
  var localToday = parseDate(effectiveTodayKey) || new Date();
  localToday.setHours(0, 0, 0, 0);
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

  // Categorize tasks
  var habitsByDate = {};
  var fixedByDate = {};
  var markersByDate = {};
  var pool = [];

  allTasks.forEach(function(t) {
    var st = newSt[t.id] || "";
    if (st === "done" || st === "cancel" || st === "skip" || st === "pause" || st === "disabled") return;
    if (hasWhen(t.when, "allday")) return; // All-day events don't go on the time grid
    if (t.marker) {
      // Markers are non-blocking — shown on calendar but don't consume time slots
      var tdM = parseDate(t.date);
      if (tdM) {
        var mKey = formatDateKey(tdM);
        if (!markersByDate[mKey]) markersByDate[mKey] = [];
        markersByDate[mKey].push(t);
      }
      return;
    }
    if (t.section && (t.section.includes("PARKING") || t.section.includes("TO BE SCHEDULED"))) return;
    // Dateless tasks: scheduler owns placement — treat as starting from today
    var td = t.date ? parseDate(t.date) : null;
    if (!td) {
      td = new Date(localToday);
    }
    var effectiveDur = effectiveDuration(t);
    if (effectiveDur <= 0) return;

    var sm = parseTimeToMinutes(t.time);
    // Treat midnight (0) as "no specific time" — it's the default for unscheduled tasks
    if (sm === 0 && !hasWhen(t.when, 'fixed')) sm = null;
    var tdKey = formatDateKey(td);
    var isPast = false;
    if (tdKey === effectiveTodayKey) {
      if (sm !== null && sm + effectiveDur <= nowMins) isPast = true;
    } else if (td < localToday) {
      isPast = true;
    }

    // Fixed tasks: anchor at their time.
    // On today, always show even if time has passed (user needs to see them to mark done).
    // On past days, drop entirely.
    if (hasWhen(t.when, "fixed")) {
      if (sm !== null) {
        var fixedDropped = isPast && tdKey !== effectiveTodayKey;
        if (!fixedDropped) { if (!fixedByDate[tdKey]) fixedByDate[tdKey] = []; fixedByDate[tdKey].push(t); }
        return;
      }
      // No parseable time — fall through to pool as "anytime"
      t = Object.assign({}, t, { when: "anytime" });
    }
    // Rigid habits: anchor at preferred time.
    // On today, always show even if time has passed (user needs to see them to mark done).
    // On past days, drop entirely.
    if (t.habit && t.rigid) {
      var habitDropped = isPast && tdKey !== effectiveTodayKey;
      if (!habitDropped) { if (!habitsByDate[tdKey]) habitsByDate[tdKey] = []; habitsByDate[tdKey].push(t); }
      return;
    }
    // Non-rigid habits on past days: drop unless still within placement window.
    if (t.habit && isPast && tdKey !== effectiveTodayKey) {
      var flex = t.timeFlex != null ? t.timeFlex : 60;
      var daysPast = Math.round((localToday.getTime() - td.getTime()) / 86400000);
      if (flex < daysPast * 1440) return; // outside placement window — skip
      // Still within window — redirect to today so the scheduler can place it
      td = new Date(localToday);
      tdKey = effectiveTodayKey;
      isPast = false;
    }

    if (isPast || st === "wip" || st === "" || st === "other") {
      var earliest = null;
      var ceiling = null;
      if (t.startAfter) {
        var saDate = parseDate(t.startAfter);
        if (saDate) { saDate.setHours(0, 0, 0, 0); earliest = earliest ? (saDate > earliest ? saDate : earliest) : saDate; }
      }
      // Pinned tasks: user explicitly set the date, so honor it as a floor.
      // Generated recurring instances: their date is the intended occurrence day,
      // so treat it as a floor to prevent pulling future instances into earlier days.
      // Unpinned flexible tasks: scheduler-controlled, only startAfter constrains.
      if ((t.datePinned || t.generated) && !isPast && td >= localToday) {
        if (!earliest || earliest <= td) {
          earliest = td;
        }
      }
      // Past-time-today tasks: set floor to today so remaining capacity is
      // used before overflowing to future days.  Without this, the scheduler
      // freely moves all of today's tasks to tomorrow where there's more room,
      // leaving the user with an empty today.
      if (isPast && tdKey === effectiveTodayKey && td) {
        if (!earliest || earliest < td) earliest = td;
      }
      // Recurring/generated habits are day-specific: pin to their date (floor + ceiling).
      // Non-recurring habits (one-off) only get a floor — they can float to later days
      // if their assigned day is too full.
      if (t.habit && td) {
        if (!earliest || td > earliest) earliest = td;
        if (t.recur || t.generated) ceiling = td;
      }
      var deadline = t.due ? parseDate(t.due) : null;
      if (deadline) deadline.setHours(23, 59, 59, 999);

      pool.push({
        task: t, remaining: effectiveDur, totalDur: effectiveDur,
        earliestDate: earliest, deadline: deadline, ceiling: ceiling,
        splittable: !!t.split,
        minChunk: t.splitMin || MIN_CHUNK,
        _parts: []
      });
    }
  });

  var poolIds = {};
  pool.forEach(function(item) { poolIds[item.task.id] = true; });

  // ── Backward scheduling: compute downstream date ceilings ──
  // If task B depends on task A and B is dated 3/27, then A must be
  // scheduled on or before 3/27.  Walk the reverse dependency graph
  // to propagate the earliest downstream date as a ceiling on each
  // ancestor pool item.
  var dependedOnBy = {};
  allTasks.forEach(function(t) {
    getTaskDeps(t).forEach(function(depId) {
      if (!dependedOnBy[depId]) dependedOnBy[depId] = [];
      dependedOnBy[depId].push(t.id);
    });
  });

  // ── Detect backwards dependencies ──
  // A dep is "backwards" if task A depends on task B but A.date < B.date,
  // making the dependency chronologically impossible. Skip these silently
  // in scheduling constraints and warn.
  var backwardsDeps = {}; // key: taskId + '→' + depId
  var taskDateMap = {};
  allTasks.forEach(function(t) {
    if (t.date) {
      var d = parseDate(t.date);
      if (d) taskDateMap[t.id] = d;
    }
  });
  var taskPinnedMap = {};
  allTasks.forEach(function(t) { taskPinnedMap[t.id] = !!(t.datePinned || t.generated || (t.habit && !t.rigid === false)); });
  allTasks.forEach(function(t) {
    var deps = getTaskDeps(t);
    if (deps.length === 0) return;
    var tDate = taskDateMap[t.id];
    if (!tDate) return;
    deps.forEach(function(depId) {
      var depDate = taskDateMap[depId];
      if (!depDate) return;
      // Backwards: task's date is before its dependency's date AND both are pinned
      // (if either is flexible, the scheduler can move it — not truly impossible)
      if (tDate < depDate && taskPinnedMap[t.id] && taskPinnedMap[depId]) {
        var key = t.id + '→' + depId;
        backwardsDeps[key] = true;
        schedulerWarnings.push({
          type: 'backwardsDep',
          taskId: t.id,
          depId: depId,
          taskDate: formatDateKey(tDate),
          depDate: formatDateKey(depDate),
          message: 'Task ' + t.id + ' (' + formatDateKey(tDate) + ') depends on ' + depId + ' (' + formatDateKey(depDate) + ') — both pinned, dependency is chronologically impossible, skipping constraint'
        });
      }
    });
  });

  function isBackwardsDep(taskId, depId) {
    return !!backwardsDeps[taskId + '→' + depId];
  }

  function computeDownstreamCeiling(taskId, visited) {
    if (visited[taskId]) return null;
    visited[taskId] = true;
    var children = dependedOnBy[taskId] || [];
    var earliest = null;
    for (var ci = 0; ci < children.length; ci++) {
      var childId = children[ci];
      // Skip backwards deps: child depends on taskId but child.date < taskId.date
      if (isBackwardsDep(childId, taskId)) continue;
      var childTask = null;
      for (var ti = 0; ti < allTasks.length; ti++) {
        if (allTasks[ti].id === childId) { childTask = allTasks[ti]; break; }
      }
      if (!childTask) continue;
      var childSt = newSt[childId] || '';
      if (childSt === 'done' || childSt === 'cancel' || childSt === 'skip' || childSt === 'pause' || childSt === 'disabled') continue;
      var childDate = parseDate(childTask.date);
      // Ignore past-dated children — they'll be moved forward by the scheduler,
      // so they shouldn't constrain the ancestor to an impossible past ceiling.
      if (childDate && childDate < localToday) continue;
      // Only use child's date as a ceiling if the child is pinned/generated/habit —
      // flexible task dates are scheduler-movable and shouldn't constrain ancestors.
      if (childDate && (childTask.datePinned || childTask.generated || childTask.habit)) {
        if (!earliest || childDate < earliest) earliest = childDate;
      }
      var childCeiling = computeDownstreamCeiling(childId, visited);
      if (childCeiling && (!earliest || childCeiling < earliest)) earliest = childCeiling;
    }
    return earliest;
  }

  pool.forEach(function(item) {
    var ceiling = computeDownstreamCeiling(item.task.id, {});
    if (ceiling) {
      if (!item.ceiling || ceiling < item.ceiling) {
        item.ceiling = ceiling;
      }
    }
  });

  // ── Backward deadline propagation ──
  // If task A → task B and B has due=4/15, then A inherits an effective
  // deadline of 4/15 (the latest it could start without risking B's deadline).
  // Walk the reverse dep graph to find the earliest downstream due date.
  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Static pre-computation: walk the chain backward, subtracting durations
  // of intervening tasks to get approximate effective deadlines.
  // E.g., chain A → B → C → D(due 3/27, 60m): D's deadline is 3/27,
  // C's effective deadline ≈ 3/27 minus D's 60m, B's ≈ C's minus C's dur, etc.
  function computeDownstreamDeadline(taskId, visited) {
    if (visited[taskId]) return null;
    visited[taskId] = true;
    var children = dependedOnBy[taskId] || [];
    var earliest = null;
    for (var ci = 0; ci < children.length; ci++) {
      var childId = children[ci];
      if (isBackwardsDep(childId, taskId)) continue;
      var childTask = taskById[childId];
      if (!childTask) continue;
      var childSt = newSt[childId] || '';
      if (childSt === 'done' || childSt === 'cancel' || childSt === 'skip' || childSt === 'pause' || childSt === 'disabled') continue;
      var childDur = effectiveDuration(childTask);
      // Use child's own due date, offset by child's duration
      if (childTask.due) {
        var childDue = parseDate(childTask.due);
        if (childDue) {
          // Subtract child's duration from its due date to get our effective deadline.
          // Convert to day-level: if the child takes 120m, that's roughly 1 day buffer
          // on a schedule with ~480m of work time per day.
          var bufferDays = Math.ceil(childDur / 480);
          var adjusted = new Date(childDue);
          adjusted.setDate(adjusted.getDate() - bufferDays);
          adjusted.setHours(23, 59, 59, 999);
          if (!earliest || adjusted < earliest) earliest = adjusted;
        }
      }
      // Recurse: child's downstream deadline (already duration-adjusted) may be earlier
      var childDeadline = computeDownstreamDeadline(childId, visited);
      if (childDeadline) {
        // Further subtract this child's own duration from the downstream deadline
        var bufferDays2 = Math.ceil(childDur / 480);
        var adjusted2 = new Date(childDeadline);
        adjusted2.setDate(adjusted2.getDate() - bufferDays2);
        adjusted2.setHours(23, 59, 59, 999);
        if (!earliest || adjusted2 < earliest) earliest = adjusted2;
      }
    }
    return earliest;
  }

  pool.forEach(function(item) {
    var downstreamDue = computeDownstreamDeadline(item.task.id, {});
    if (downstreamDue) {
      if (!item.deadline || downstreamDue < item.deadline) {
        item.deadline = downstreamDue;
      }
    }
  });

  // Dynamic deadline recomputation: once a downstream task is placed at a
  // specific time, the upstream task's effective deadline tightens to the
  // actual placement start. Called after each placement to keep deadlines fresh.
  function recomputeEffectiveDeadline(taskId) {
    var children = dependedOnBy[taskId] || [];
    var earliest = null;
    for (var ci = 0; ci < children.length; ci++) {
      var childId = children[ci];
      if (isBackwardsDep(childId, taskId)) continue;
      var childSt = newSt[childId] || '';
      if (childSt === 'done' || childSt === 'cancel' || childSt === 'skip' || childSt === 'pause' || childSt === 'disabled') continue;
      // If child is placed, use its actual start as a hard deadline
      var childPlacement = globalPlacedEnd[childId];
      if (childPlacement && childPlacement.startMin != null) {
        var placedDate = parseDate(childPlacement.dateKey);
        if (placedDate) {
          // Effective deadline = start of placed child (we must finish before it)
          // Convert startMin back to a date ceiling (use the day, minus any buffer)
          var placedDeadline = new Date(placedDate);
          placedDeadline.setHours(23, 59, 59, 999);
          if (!earliest || placedDeadline < earliest) earliest = placedDeadline;
        }
      } else {
        // Child not yet placed — use its due date (or downstream deadline) minus duration
        var childTask = taskById[childId];
        if (childTask) {
          var childDur = effectiveDuration(childTask);
          var bufferDays = Math.ceil(childDur / 480);
          if (childTask.due) {
            var childDue = parseDate(childTask.due);
            if (childDue) {
              var adj = new Date(childDue);
              adj.setDate(adj.getDate() - bufferDays);
              adj.setHours(23, 59, 59, 999);
              if (!earliest || adj < earliest) earliest = adj;
            }
          }
          // Recurse to get child's downstream deadline
          var childDL = recomputeEffectiveDeadline(childId);
          if (childDL) {
            var adj2 = new Date(childDL);
            adj2.setDate(adj2.getDate() - bufferDays);
            adj2.setHours(23, 59, 59, 999);
            if (!earliest || adj2 < earliest) earliest = adj2;
          }
        }
      }
    }
    return earliest;
  }

  // Helper: update a pool item's deadline from its downstream placements
  function refreshDeadline(item) {
    var dynamic = recomputeEffectiveDeadline(item.task.id);
    if (dynamic) {
      // Use the tighter of own due date vs dynamic downstream deadline
      var ownDue = item.task.due ? parseDate(item.task.due) : null;
      if (ownDue) ownDue.setHours(23, 59, 59, 999);
      item.deadline = ownDue && ownDue < dynamic ? ownDue : dynamic;
    }
  }

  // ── Detect impossible constraint combinations ──
  pool.forEach(function(item) {
    var t = item.task;
    // Deadline + dayReq: check if there are any eligible days in the window
    if (item.deadline && t.dayReq && t.dayReq !== 'any') {
      var floor = item.earliestDate || localToday;
      var ceil = item.ceiling ? (item.ceiling < item.deadline ? item.ceiling : item.deadline) : item.deadline;
      var hasEligibleDay = false;
      var check = new Date(floor);
      while (check <= ceil) {
        var dow = check.getDay();
        var isWeekday = dow >= 1 && dow <= 5;
        if ((t.dayReq === 'weekday' && isWeekday) || (t.dayReq === 'weekend' && !isWeekday)) {
          hasEligibleDay = true;
          break;
        }
        check.setDate(check.getDate() + 1);
      }
      if (!hasEligibleDay) {
        schedulerWarnings.push({
          type: 'impossibleDayReq',
          taskId: t.id,
          dayReq: t.dayReq,
          deadline: formatDateKey(item.deadline),
          earliest: formatDateKey(floor),
          message: 'Task ' + t.id + ' requires ' + t.dayReq + ' but no ' + t.dayReq + ' days exist between ' + formatDateKey(floor) + ' and ' + formatDateKey(ceil)
        });
      }
    }
  });

  // Helpers
  function reserve(occ, s, d) { for (var i = Math.max(0, s); i < Math.min(s + d, 1440); i++) occ[i] = true; }
  function isFree(occ, s, d) { for (var i = s; i < s + d && i < 1440; i++) { if (occ[i]) return false; } return true; }
  function buildLocMask(task, dateKey, dateBlocks) {
    var mask = {};
    for (var m = GRID_START * 60; m < (GRID_END + 1) * 60; m += 15) {
      var locId = resolveLocationId(dateKey, m, cfg, dateBlocks);
      if (!canTaskRun(task, locId, cfg.toolMatrix)) {
        for (var mm = m; mm < m + 15; mm++) mask[mm] = true;
      }
    }
    return mask;
  }

  // Persistent day state
  var dayPlacements = {};
  var dayOcc = {};
  var dayWindows = {};
  var dayBlocks = {};
  var dayPlaced = {};
  var globalPlacedEnd = {};

  dates.forEach(function(d) {
    var occ = {};
    dayOcc[d.key] = occ;
    dayPlaced[d.key] = [];
    dayBlocks[d.key] = getBlocksForDate(d.key, cfg.timeBlocks, cfg);
    dayWindows[d.key] = buildWindowsFromBlocks(dayBlocks[d.key]);
    if (d.isToday) {
      var nowSlot = Math.ceil(nowMins / 15) * 15;
      for (var pm = 0; pm < nowSlot; pm++) occ[pm] = true;
    }
  });

  // ── Orphaned when-tag safety net ──
  // Collect all tags that exist in ANY day's windows (excluding synthetic "anytime").
  // If a task's when-tags don't match any global tag, override to "" in-memory
  // so it falls through to default windows instead of being pushed to the horizon.
  var globalAvailableTags = {};
  dates.forEach(function(d) {
    var wins = dayWindows[d.key];
    for (var tag in wins) {
      if (tag !== 'anytime') globalAvailableTags[tag] = true;
    }
  });
  var SPECIAL_WHEN = { fixed: true, allday: true, anytime: true };
  var orphanCount = 0;
  allTasks.forEach(function(t) {
    if (!t.when || t.when === '') return;
    var parts = parseWhen(t.when);
    if (parts.length === 1 && parts[0] === 'anytime') return;
    var hasSpecial = parts.some(function(p) { return SPECIAL_WHEN[p]; });
    if (hasSpecial) return;
    var hasValid = parts.some(function(p) { return globalAvailableTags[p]; });
    if (!hasValid) {
      schedulerWarnings.push({
        type: 'orphanedWhenTag',
        taskId: t.id,
        originalWhen: t.when,
        message: 'Tag "' + t.when + '" not found in any template; defaulting to anytime'
      });
      t.when = '';
      orphanCount++;
    }
  });
  if (orphanCount > 0) console.log('[SCHED] reassigned ' + orphanCount + ' task(s) with orphaned when-tags to anytime');

  function recordPlace(occ, placed, t, start, dur, locked, dateKey, item) {
    // Determine travel buffers — for split tasks, only first chunk gets travelBefore
    // and only last chunk gets travelAfter
    var tb = 0, ta = 0;
    var isFirstPart = !item || item._parts.length === 0;
    var isLastPart = !item || (item.remaining - dur <= 0);
    if (isFirstPart) tb = getTravelBefore(t);
    if (isLastPart) ta = getTravelAfter(t);
    // Reserve travel buffer zones in the occupancy grid
    if (tb > 0) reserve(occ, Math.max(0, start - tb), tb);
    reserve(occ, start, dur);
    if (ta > 0) reserve(occ, start + dur, ta);
    // Per-placement timezone: fixed/locked tasks carry their own tz (if set on the task),
    // otherwise inherit the schedule-level timezone from cfg.
    var placeTz = (t.tz && (locked || hasWhen(t.when, 'fixed'))) ? t.tz : (cfg.timezone || null);
    var part = { task: t, start: start, dur: dur, locked: locked, _dateKey: dateKey, travelBefore: tb, travelAfter: ta, tz: placeTz };
    placed.push(part);
    if (item) { item._parts.push(part); item.remaining -= dur; }
    var effectiveStart = start - tb;
    var effectiveEnd = start + dur + ta;
    var gpe = globalPlacedEnd[t.id];
    if (!gpe) {
      globalPlacedEnd[t.id] = { dateKey: dateKey, endMin: effectiveEnd, startMin: effectiveStart };
    } else if (gpe.dateKey === dateKey) {
      if (effectiveEnd > gpe.endMin) gpe.endMin = effectiveEnd;
      if (effectiveStart < gpe.startMin || gpe.startMin == null) gpe.startMin = effectiveStart;
    } else if (parseDate(dateKey) > parseDate(gpe.dateKey)) {
      globalPlacedEnd[t.id] = { dateKey: dateKey, endMin: effectiveEnd, startMin: effectiveStart };
    }
    if (!locked && !taskUpdates[t.id]) {
      var hh = Math.floor(start / 60), mm = start % 60;
      var ampm = hh >= 12 ? "PM" : "AM";
      var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
      taskUpdates[t.id] = { date: dateKey, time: dh + ":" + (mm < 10 ? "0" : "") + mm + " " + ampm, tz: placeTz };
    }
    // Dynamic deadline propagation: this task being placed tightens the
    // effective deadline of all upstream ancestors. Walk deps backward
    // through the full chain so all unplaced ancestors get updated.
    function propagateDeadlineUp(taskId, visited) {
      var deps = taskById[taskId] ? getTaskDeps(taskById[taskId]) : [];
      for (var dai = 0; dai < deps.length; dai++) {
        var depId = deps[dai];
        if (visited[depId]) continue;
        visited[depId] = true;
        for (var pii = 0; pii < pool.length; pii++) {
          if (pool[pii].task.id === depId && pool[pii].remaining > 0) {
            refreshDeadline(pool[pii]);
            break;
          }
        }
        propagateDeadlineUp(depId, visited);
      }
    }
    propagateDeadlineUp(t.id, {});
    return part;
  }

  function canPlaceOnDate(t, d) {
    if (t.dayReq && t.dayReq !== "any") {
      if (t.dayReq === "weekday" && !d.isWeekday) return false;
      if (t.dayReq === "weekend" && d.isWeekday) return false;
      var dm = { M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, Su: 0, S: 6 };
      // Support comma-separated multi-day values (e.g. "M,W,F")
      var parts = t.dayReq.split(",");
      if (parts.length > 1 || dm[parts[0]] !== undefined) {
        var match = parts.some(function(p) { return dm[p] !== undefined && dm[p] === d.dow; });
        if (!match) return false;
      }
    }
    return true;
  }

  function depsMetByDate(t, d) {
    var ok = true;
    var afterMin = 0;
    var beforeMin = 1440;
    getTaskDeps(t).forEach(function(depId) {
      if (isBackwardsDep(t.id, depId)) return; // skip chronologically impossible deps
      var info = globalPlacedEnd[depId];
      if (info) {
        var depDate = parseDate(info.dateKey);
        if (depDate > d.date) ok = false;
        // Same-day dependency: must start after the dependency ends
        else if (info.dateKey === d.key && info.endMin > afterMin) {
          afterMin = info.endMin;
        }
      } else if (poolIds[depId]) {
        ok = false;
      }
    });
    if (!ok) return false;
    // Reverse check: if any dependants (tasks that depend on this task) are
    // already placed (e.g. markers at fixed times), this task must finish
    // before the dependant starts on the same day, or on an earlier day.
    var children = dependedOnBy[t.id] || [];
    for (var ci = 0; ci < children.length; ci++) {
      if (isBackwardsDep(children[ci], t.id)) continue; // child's dep on us is backwards
      var childInfo = globalPlacedEnd[children[ci]];
      if (!childInfo) continue;
      var childDate = parseDate(childInfo.dateKey);
      if (childDate < d.date) { ok = false; break; }
      if (childInfo.dateKey === d.key && childInfo.startMin != null && childInfo.startMin < beforeMin) {
        beforeMin = childInfo.startMin;
      }
    }
    if (!ok) return false;
    // Return object when we have constraints, true otherwise
    if (afterMin > 0 || beforeMin < 1440) {
      return { afterMin: afterMin, beforeMin: beforeMin };
    }
    return true;
  }

  function depAfterFrom(result) {
    return (result && typeof result === 'object') ? result.afterMin : (typeof result === 'number' ? result : 0);
  }
  function depBeforeFrom(result) {
    return (result && typeof result === 'object') ? result.beforeMin : 1440;
  }

  // For flexible habits with a preferred time, compute a narrow window
  // [time - flex, time + flex + dur] so they stay near their preferred slot.
  var DEFAULT_TIME_FLEX = 60; // minutes
  function getHabitFlexWindows(t, dateWindows) {
    if (!t.habit || t.rigid) return null;
    var sm = parseTimeToMinutes(t.time);
    if (sm === null) return null;
    var flex = t.timeFlex != null ? t.timeFlex : DEFAULT_TIME_FLEX;
    if (flex <= 0) return null;
    var lo = Math.max(DAY_START, sm - flex);
    var hi = Math.min(WALK_END, sm + flex);
    // Intersect with the task's when windows so a morning habit can't leak into evening
    var whenWins = getWhenWindows(t.when, dateWindows);
    if (whenWins.length === 0) return [[lo, hi]];
    var result = [];
    for (var i = 0; i < whenWins.length; i++) {
      var wLo = Math.max(lo, whenWins[i][0]);
      var wHi = Math.min(hi, whenWins[i][1]);
      if (wHi > wLo) result.push([wLo, wHi]);
    }
    return result.length > 0 ? result : null;
  }

  // EARLY PLACEMENT
  function placeEarly(item, d, afterMin, whenOverride, beforeMin) {
    var t = item.task;
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    // Travel buffers — first chunk needs travelBefore, last needs travelAfter
    var tb = getTravelBefore(t);
    var ta = getTravelAfter(t);
    // whenOverride can be an array of windows or a string
    var wins = Array.isArray(whenOverride) ? whenOverride : getWhenWindows(whenOverride || t.when, dayWindows[d.key]);
    if (wins.length === 0) return false;
    var scanStart = Math.max(wins[0][0], afterMin || 0);
    var scanLimit = beforeMin || WALK_END;
    var placedAny = false;

    while (item.remaining > 0 && scanStart < scanLimit) {
      // For the first chunk, the travel-before zone must also be free
      var needTb = item._parts.length === 0 ? tb : 0;
      var effectiveScan = scanStart - needTb;
      if (needTb > 0 && effectiveScan >= 0 && !isFree(occ, effectiveScan, needTb)) { scanStart++; continue; }
      if (occ[scanStart]) { scanStart++; continue; }
      var gEnd = scanStart + 1;
      while (gEnd < scanLimit && !occ[gEnd]) gEnd++;
      var gapSize = gEnd - scanStart;

      var inWin = false, winEnd = scanLimit;
      for (var wi = 0; wi < wins.length; wi++) {
        var wEndClamped = Math.min(wins[wi][1], scanLimit);
        if (scanStart >= wins[wi][0] && scanStart < wEndClamped) { inWin = true; winEnd = wEndClamped; break; }
      }
      if (!inWin) {
        var nextWinStart = scanLimit;
        for (var nwi = 0; nwi < wins.length; nwi++) {
          if (wins[nwi][0] > scanStart && wins[nwi][0] < nextWinStart) nextWinStart = wins[nwi][0];
        }
        scanStart = nextWinStart; continue;
      }

      var locId = resolveLocationId(d.key, scanStart, cfg, dayBlocks[d.key]);
      if (!canTaskRun(t, locId, cfg.toolMatrix)) { scanStart = Math.floor(scanStart / 15) * 15 + 15; continue; }

      // For non-splittable tasks, gap must also fit travel-after
      var needTa = item.remaining <= (item.splittable ? gapSize : item.remaining) ? ta : 0;
      if (!item.splittable && gapSize < item.remaining + needTa) { scanStart = gEnd; continue; }
      if (item.splittable && gapSize < item.minChunk && item.remaining > gapSize) { scanStart = gEnd; continue; }

      var placeEnd = Math.min(gEnd, winEnd);
      var lEnd = scanStart;
      while (lEnd < placeEnd) {
        var lId = resolveLocationId(d.key, lEnd, cfg, dayBlocks[d.key]);
        if (!canTaskRun(t, lId, cfg.toolMatrix)) break;
        lEnd++;
      }
      var maxPlace = lEnd - scanStart;
      var placeLen = Math.min(item.remaining, maxPlace);

      // Non-splittable tasks must fit entirely — don't place partial chunks
      if (!item.splittable && maxPlace < item.remaining) { scanStart = lEnd; continue; }

      // Don't place a runt chunk smaller than minChunk when other parts exist
      if (item.splittable && placeLen < item.minChunk && item._parts.length > 0) { scanStart = lEnd; continue; }

      // Also skip if location checks shrunk maxPlace below minChunk (gap looked big enough but isn't usable)
      if (item.splittable && placeLen < item.minChunk && item.remaining > placeLen) { scanStart = lEnd; continue; }

      if (item.splittable && item.remaining - placeLen > 0 && item.remaining - placeLen < item.minChunk) {
        if (maxPlace >= item.remaining) {
          placeLen = item.remaining; // extend to consume all remaining
        } else {
          // Shrink current chunk to leave at least minChunk for next gap
          var shrunk = item.remaining - item.minChunk;
          if (shrunk >= item.minChunk) {
            placeLen = shrunk;
          } else {
            // Can't split into two valid chunks from this gap — skip it
            scanStart = lEnd; continue;
          }
        }
      }
      if (placeLen <= 0) { scanStart++; continue; }

      recordPlace(occ, placed, t, scanStart, placeLen, false, d.key, item);
      placedAny = true;
      scanStart += placeLen;
    }
    return placedAny;
  }

  // LATE PLACEMENT
  function placeLate(item, d, beforeMin, whenOverride, afterMin) {
    var t = item.task;
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var wins = Array.isArray(whenOverride) ? whenOverride : getWhenWindows(whenOverride || t.when, dayWindows[d.key]);
    if (wins.length === 0) return false;
    var maxEnd = beforeMin || WALK_END;
    var minStart = afterMin || 0;

    var chunks = [];
    var needed = item.remaining;

    for (var wi = wins.length - 1; wi >= 0 && needed > 0; wi--) {
      var wStart = Math.max(wins[wi][0], minStart);
      var wEnd = Math.min(wins[wi][1], maxEnd);
      if (wEnd <= wStart) continue;

      var pos = wEnd - 1;
      while (pos >= wStart && needed > 0) {
        if (occ[pos]) { pos--; continue; }
        var gapEnd = pos + 1;
        while (pos > wStart && !occ[pos - 1]) pos--;
        var gapStart = pos;
        var gapSize = gapEnd - gapStart;

        var locOk = true;
        for (var cm = gapStart; cm < gapEnd; cm++) {
          var lId = resolveLocationId(d.key, cm, cfg, dayBlocks[d.key]);
          if (!canTaskRun(t, lId, cfg.toolMatrix)) { locOk = false; break; }
        }

        if (locOk && gapSize > 0) {
          if (!item.splittable) {
            if (gapSize >= needed) {
              var start = gapEnd - needed;
              chunks.push({ start: start, len: needed });
              needed = 0;
            }
          } else {
            var take = Math.min(needed, gapSize);
            if (take < item.minChunk && needed > take) {
              pos--;
              continue;
            }
            // Don't place a runt chunk when other parts exist
            if (take < item.minChunk && chunks.length > 0) {
              pos = gapStart - 1;
              continue;
            }
            // Shrink to avoid leaving a runt remainder
            if (needed - take > 0 && needed - take < item.minChunk) {
              if (gapSize >= needed) {
                take = needed;
              } else {
                var shrunk2 = needed - item.minChunk;
                if (shrunk2 >= item.minChunk) {
                  take = shrunk2;
                } else {
                  // Can't split into two valid chunks from this gap — skip it
                  pos = gapStart - 1;
                  continue;
                }
              }
            }
            var start2 = gapEnd - take;
            chunks.push({ start: start2, len: take });
            needed -= take;
          }
        }
        pos = gapStart - 1;
      }
    }

    if (needed > 0 && chunks.length === 0) return false;

    chunks.forEach(function(c) {
      recordPlace(occ, placed, t, c.start, c.len, false, d.key, item);
    });
    return true;
  }

  // Place a task as close to a preferred minute as possible within when-windows
  function placeNearTime(item, d, preferredMin, whenOverride) {
    var t = item.task;
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var wins = Array.isArray(whenOverride) ? whenOverride : getWhenWindows(whenOverride || t.when, dayWindows[d.key]);
    if (wins.length === 0) return false;
    var dur = item.remaining;
    if (dur <= 0) return false;
    var tb = getTravelBefore(t);
    var ta = getTravelAfter(t);
    var totalNeeded = tb + dur + ta;

    var candidates = [];
    for (var wi = 0; wi < wins.length; wi++) {
      var wStart = wins[wi][0];
      var wEnd = wins[wi][1];
      var pos = wStart;
      while (pos < wEnd) {
        if (occ[pos]) { pos++; continue; }
        var gEnd = pos + 1;
        while (gEnd < wEnd && !occ[gEnd]) gEnd++;
        var gapSize = gEnd - pos;
        // Gap must fit travel-before + task body + travel-after
        // Also check that travel-before zone before the gap is free
        if (gapSize >= totalNeeded || (tb === 0 && ta === 0 && gapSize >= dur)) {
          var bodyStart = pos + tb;
          var idealStart = Math.max(bodyStart, Math.min(preferredMin, gEnd - dur - ta));
          // Verify travel-before zone is free (it may be before gap start)
          var tbStart = idealStart - tb;
          var tbOk = tb === 0 || (tbStart >= 0 && isFree(occ, tbStart, tb));
          // Verify travel-after zone is free
          var taOk = ta === 0 || isFree(occ, idealStart + dur, ta);
          if (tbOk && taOk) {
            var locOk = true;
            for (var cm = idealStart; cm < idealStart + dur; cm++) {
              var locId = resolveLocationId(d.key, cm, cfg, dayBlocks[d.key]);
              if (!canTaskRun(t, locId, cfg.toolMatrix)) { locOk = false; break; }
            }
            if (locOk) {
              candidates.push({ start: idealStart, dist: Math.abs(idealStart - preferredMin) });
            }
          }
        }
        pos = gEnd;
      }
    }
    if (candidates.length === 0) return false;

    candidates.sort(function(a, b) { return a.dist - b.dist; });
    recordPlace(occ, placed, t, candidates[0].start, dur, false, d.key, item);
    return true;
  }

  function unplaceItem(item) {
    item._parts.forEach(function(part) {
      var occ = dayOcc[part._dateKey];
      if (occ) {
        var freeStart = part.start - (part.travelBefore || 0);
        var freeEnd = part.start + part.dur + (part.travelAfter || 0);
        for (var m = Math.max(0, freeStart); m < freeEnd; m++) delete occ[m];
      }
      var pl = dayPlaced[part._dateKey];
      if (pl) { var idx = pl.indexOf(part); if (idx !== -1) pl.splice(idx, 1); }
    });
    item.remaining = item.totalDur;
    item._parts = [];
    delete taskUpdates[item.task.id];
    delete globalPlacedEnd[item.task.id];
  }

  function getDateObj(key) {
    for (var i = 0; i < dates.length; i++) { if (dates[i].key === key) return dates[i]; }
    return null;
  }

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
      chain.push(t);
    }
    walk(task.id);
    return chain;
  }

  // Returns total available minutes across all when-windows for a task.
  // Used as a tiebreaker: tasks with fewer available minutes are harder
  // to place, so they should be scheduled first while there's more room.
  var _whenMinutesCache = {};
  function whenAvailableMinutes(task) {
    var w = task.when || "morning,lunch,afternoon,evening";
    if (_whenMinutesCache[w] !== undefined) return _whenMinutesCache[w];
    // Use the first future date's windows as a representative sample
    var sampleKey = dates.length > 1 ? dates[1].key : dates[0].key;
    var wins = getWhenWindows(w, dayWindows[sampleKey]);
    var total = 0;
    for (var i = 0; i < wins.length; i++) total += wins[i][1] - wins[i][0];
    _whenMinutesCache[w] = total || 1440; // fallback to full day if no windows
    return _whenMinutesCache[w];
  }

  // STEP 1: Fixed items
  dates.forEach(function(d) {
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var fixedTasks = fixedByDate[d.key] || [];
    // Detect overlapping fixed tasks on the same day
    for (var fi = 0; fi < fixedTasks.length; fi++) {
      var fA = fixedTasks[fi];
      var smA = parseTimeToMinutes(fA.time);
      if (smA === null) continue;
      var durA = effectiveDuration(fA);
      for (var fj = fi + 1; fj < fixedTasks.length; fj++) {
        var fB = fixedTasks[fj];
        var smB = parseTimeToMinutes(fB.time);
        if (smB === null) continue;
        var durB = effectiveDuration(fB);
        // Check overlap: A starts before B ends AND B starts before A ends
        if (smA < smB + durB && smB < smA + durA) {
          schedulerWarnings.push({
            type: 'fixedOverlap',
            dateKey: d.key,
            taskA: fA.id,
            taskB: fB.id,
            message: 'Fixed tasks ' + fA.id + ' (' + fA.time + ') and ' + fB.id + ' (' + fB.time + ') overlap on ' + d.key
          });
        }
      }
    }
    fixedTasks.forEach(function(t) {
      var sm = parseTimeToMinutes(t.time);
      if (sm === null) return;
      var dur = effectiveDuration(t);
      if (dur <= 0) return;
      var tb = getTravelBefore(t);
      var ta = getTravelAfter(t);
      // Don't clamp fixed tasks — honor the user's exact time.
      // Reserve travel buffer zones plus the task body.
      if (tb > 0) reserve(occ, Math.max(0, sm - tb), tb);
      var reserveStart = Math.max(0, sm);
      reserve(occ, reserveStart, Math.min(dur, 1440 - reserveStart));
      if (ta > 0) reserve(occ, sm + dur, Math.min(ta, 1440 - sm - dur));
      var fixedTz = t.tz || cfg.timezone || null;
      placed.push({ task: t, start: sm, dur: dur, locked: true, _dateKey: d.key, travelBefore: tb, travelAfter: ta, tz: fixedTz });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur + ta, startMin: sm - tb };
    });
  });

  // STEP 1b: Markers — placed at their time but do NOT reserve occupancy
  dates.forEach(function(d) {
    var placed = dayPlaced[d.key];
    var markers = markersByDate[d.key] || [];
    markers.forEach(function(t) {
      var sm = parseTimeToMinutes(t.time);
      if (sm === null) sm = DAY_START;
      var dur = effectiveDuration(t);
      if (dur <= 0) return;
      // No reserve() call — markers don't block time slots
      placed.push({ task: t, start: sm, dur: dur, locked: true, marker: true, _dateKey: d.key, tz: t.tz || cfg.timezone || null });
      // Register in globalPlacedEnd so dependent tasks respect the marker's date
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur, startMin: sm };
    });
  });

  // STEP 2: Rigid habits
  dates.forEach(function(d) {
    var habits = habitsByDate[d.key] || [];
    habits.filter(function(t) { return t.rigid; }).forEach(function(t) {
      placeHabit(t, d);
    });
  });

  function placeHabit(t, d) {
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var dateBlocks_d = dayBlocks[d.key];
    var dateWindows_d = dayWindows[d.key];
    var dur = effectiveDuration(t);
    if (dur <= 0) return;
    // Default missing when to standard day windows so habits don't get "anytime" placement
    if (!t.when) t.when = 'morning,lunch,afternoon,evening';
    var sm = parseTimeToMinutes(t.time);
    var mask = buildLocMask(t, d.key, dateBlocks_d);

    // For habits with an explicit when-tag, derive sm from the when-window
    // rather than the previously scheduled time (which may be stale/wrong).
    // This prevents a feedback loop where a bad placement persists forever
    // because scheduledAt is read back as t.time on the next run.
    var hw = getWhenWindows(t.when, dateWindows_d, "morning")[0];
    if (hw && t.when && t.when !== 'anytime' && !t.when.includes(',')) {
      // Single explicit when-tag (e.g. "lunch"): prefer the when-window
      if (sm !== null && sm >= hw[0] && sm + dur <= hw[1]) {
        // t.time is inside the when-window — keep it
        sm = Math.max(DAY_START, Math.min(sm, GRID_END * 60));
      } else {
        // t.time is outside the when-window — use window start
        sm = hw[0];
      }
    } else if (sm === null) {
      sm = hw ? hw[0] : GRID_START * 60;
    } else {
      sm = Math.max(DAY_START, Math.min(sm, GRID_END * 60));
    }

    // Check whether sm+dur fits inside one of the task's when-windows.
    var hWinsPref = getWhenWindows(t.when, dateWindows_d, "morning");
    var whenOk = false;
    for (var wi2 = 0; wi2 < hWinsPref.length; wi2++) {
      if (sm >= hWinsPref[wi2][0] && sm + dur <= hWinsPref[wi2][1]) { whenOk = true; break; }
    }

    // On today, force-place rigid habits whose preferred slot overlaps with the
    // past-time blocked region. Without this, the scheduler pushes them to evening
    // because the morning slots are occupied by the past-time fill.
    // Shift earlier if needed so the full duration fits within the location and when windows.
    var nowSlot = Math.ceil(nowMins / 15) * 15;
    if (d.isToday && sm !== null && sm < nowSlot) {
      var placeSm = sm;
      var needsShift = !whenOk;
      if (!needsShift) {
        for (var lm = sm; lm < sm + dur; lm++) { if (mask[lm]) { needsShift = true; break; } }
      }
      if (needsShift) {
        for (var ls = Math.floor(sm / 15) * 15; ls >= DAY_START; ls -= 15) {
          var lOk = true;
          for (var lc = ls; lc < ls + dur; lc++) { if (mask[lc]) { lOk = false; break; } }
          if (!lOk) continue;
          var wOk = false;
          for (var wi3 = 0; wi3 < hWinsPref.length; wi3++) {
            if (ls >= hWinsPref[wi3][0] && ls + dur <= hWinsPref[wi3][1]) { wOk = true; break; }
          }
          if (wOk) { placeSm = ls; break; }
        }
      }
      reserve(occ, placeSm, dur);
      placed.push({ task: t, start: placeSm, dur: dur, locked: true, _dateKey: d.key, tz: t.tz || cfg.timezone || null });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: placeSm + dur, startMin: placeSm };
      return;
    }

    var locOk = true;
    for (var hm = sm; hm < sm + dur; hm++) { if (mask[hm]) { locOk = false; break; } }
    if (whenOk && locOk && isFree(occ, sm, dur)) {
      reserve(occ, sm, dur);
      placed.push({ task: t, start: sm, dur: dur, locked: true, _dateKey: d.key, tz: t.tz || cfg.timezone || null });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur, startMin: sm };
      return;
    }

    var hWins = getWhenWindows(t.when, dateWindows_d, "morning");
    if (hWins.length === 0) hWins = [[GRID_START * 60, DAY_END]];
    // Sort windows by distance from preferred time so nearby slots are tried first
    var prefMid = sm + dur / 2;
    hWins.sort(function(a, b) {
      var midA = (a[0] + a[1]) / 2, midB = (b[0] + b[1]) / 2;
      return Math.abs(midA - prefMid) - Math.abs(midB - prefMid);
    });
    var found = false;
    for (var wi = 0; wi < hWins.length && !found; wi++) {
      // Within each window, scan from the point closest to preferred time
      var winStart = hWins[wi][0], winEnd = hWins[wi][1];
      var scanFrom = Math.max(winStart, Math.min(sm, winEnd - dur));
      scanFrom = Math.floor(scanFrom / 15) * 15;
      // Try from scanFrom forward, then from scanFrom backward
      for (var s = scanFrom; s + dur <= winEnd; s += 15) {
        var ok = true;
        for (var cm = s; cm < s + dur; cm++) { if (occ[cm] || mask[cm]) { ok = false; break; } }
        if (ok) {
          reserve(occ, s, dur);
          placed.push({ task: t, start: s, dur: dur, locked: true, _dateKey: d.key, tz: t.tz || cfg.timezone || null });
          globalPlacedEnd[t.id] = { dateKey: d.key, endMin: s + dur, startMin: s };
          found = true; break;
        }
      }
      if (!found) {
        for (var s2 = scanFrom - 15; s2 >= winStart; s2 -= 15) {
          var ok2 = true;
          for (var cm2 = s2; cm2 < s2 + dur; cm2++) { if (occ[cm2] || mask[cm2]) { ok2 = false; break; } }
          if (ok2) {
            reserve(occ, s2, dur);
            placed.push({ task: t, start: s2, dur: dur, locked: true, _dateKey: d.key, tz: t.tz || cfg.timezone || null });
            globalPlacedEnd[t.id] = { dateKey: d.key, endMin: s2 + dur, startMin: s2 };
            found = true; break;
          }
        }
      }
    }
    // If the preferred when-windows were fully blocked, try ALL day windows
    // sorted by proximity to the preferred time.  This handles cases like
    // "lunch block occupied by a fixed meeting — place lunch in adjacent block".
    if (!found) {
      var allWins = dateWindows_d.anytime || [[GRID_START * 60, DAY_END]];
      allWins = allWins.slice().sort(function(a, b) {
        var midA2 = (a[0] + a[1]) / 2, midB2 = (b[0] + b[1]) / 2;
        return Math.abs(midA2 - prefMid) - Math.abs(midB2 - prefMid);
      });
      for (var wi2 = 0; wi2 < allWins.length && !found; wi2++) {
        var ws2 = allWins[wi2][0], we2 = allWins[wi2][1];
        var sf2 = Math.max(ws2, Math.min(sm, we2 - dur));
        sf2 = Math.floor(sf2 / 15) * 15;
        for (var s3 = sf2; s3 + dur <= we2; s3 += 15) {
          var ok3 = true;
          for (var cm3 = s3; cm3 < s3 + dur; cm3++) { if (occ[cm3] || mask[cm3]) { ok3 = false; break; } }
          if (ok3) {
            reserve(occ, s3, dur);
            placed.push({ task: t, start: s3, dur: dur, locked: true, _dateKey: d.key, tz: t.tz || cfg.timezone || null });
            globalPlacedEnd[t.id] = { dateKey: d.key, endMin: s3 + dur, startMin: s3 };
            found = true; break;
          }
        }
      }
    }
    // If still no slot found, force-place the rigid habit in its designated
    // when-window as an overlap.  Rigid habits represent daily commitments
    // (eat breakfast, take medication) that shouldn't vanish from the schedule
    // just because a meeting conflicts.  The overlap column system will render
    // them side-by-side, and the user can resolve the conflict manually.
    if (!found) {
      var conflictSm = sm; // Use the when-window start we computed earlier
      reserve(occ, conflictSm, dur);
      placed.push({
        task: t, start: conflictSm, dur: dur, locked: true,
        _dateKey: d.key, tz: t.tz || cfg.timezone || null,
        _conflict: true
      });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: conflictSm + dur, startMin: conflictSm };
      schedulerWarnings.push({
        type: 'habitConflict',
        taskId: t.id,
        text: t.text,
        dateKey: d.key,
        message: 'Rigid habit "' + t.text + '" overlaps with another task on ' + d.key + '. Consider adjusting one of them.'
      });
    }
  }

  var PRI_LEVELS = ["P1", "P2", "P3", "P4"];

  // PHASES 0.5 + 1 (merged): Interleave deadline tasks and habits by priority.
  // Within each priority tier, deadline tasks are placed first (they have date
  // constraints), then habits get remaining capacity.  This prevents habits
  // from starving imminent deadlines while still giving habits good slots
  // when there is no deadline pressure.

  PRI_LEVELS.forEach(function(priLevel) {

    // --- Step A: Deadline late-placement for this priority level ---
    // Pack deadline tasks tight against their due dates.  This reserves
    // deadline capacity near due dates and leaves early calendar open for
    // flexible tasks.  Phase 3 will decompress these into earlier gaps.
    var deadlineItems = pool.filter(function(item) {
      if (!item.deadline || item.remaining <= 0 || (item.task.pri || "P3") !== priLevel) return false;
      // Skip deadline tasks that have non-deadline dependencies — these need
      // Phase 2's placeWithDeps to ensure deps are placed first
      var deps = getTaskDeps(item.task);
      for (var di = 0; di < deps.length; di++) {
        var depItem = null;
        for (var pi = 0; pi < pool.length; pi++) { if (pool[pi].task.id === deps[di]) { depItem = pool[pi]; break; } }
        if (depItem && !depItem.deadline && depItem.remaining > 0) return false;
      }
      return true;
    });
    deadlineItems.sort(function(a, b) {
      var dd = a.deadline - b.deadline;
      if (dd !== 0) return dd;
      return whenAvailableMinutes(a.task) - whenAvailableMinutes(b.task);
    });

    deadlineItems.forEach(function(item) {
      if (item.remaining <= 0) return;
      var chain = getAncestorChain(item.task);
      chain.reverse();

      var nextBeforeDate = null;
      var nextBeforeMin = null;

      for (var ci = 0; ci < chain.length; ci++) {
        var cItem = chain[ci];
        if (cItem.remaining <= 0) {
          var info = globalPlacedEnd[cItem.task.id];
          if (info) {
            var earliestStart = null;
            cItem._parts.forEach(function(p) {
              if (earliestStart === null || p.start < earliestStart) earliestStart = p.start;
            });
            nextBeforeDate = parseDate(info.dateKey);
            nextBeforeMin = earliestStart || info.endMin;
          }
          continue;
        }

        // Non-deadline dependencies: defer to Phase 2 (early-placed from today)
        // instead of late-placing them near the deadline.  Phase 2's depsMetByDate
        // ensures they're placed before any task that depends on them.
        if (!cItem.deadline) {
          continue;
        }

        var targetDate = null;
        if (ci === 0) {
          targetDate = cItem.deadline;
        } else {
          targetDate = nextBeforeDate || cItem.deadline;
        }
        if (!targetDate) continue;

        // Lower bound: don't place before today, task's earliest date,
        // or the dependency's placement date (would violate dep ordering)
        var lowerBound = localToday;
        if (cItem.earliestDate && cItem.earliestDate > lowerBound) lowerBound = cItem.earliestDate;
        if (nextBeforeDate && nextBeforeDate > lowerBound) lowerBound = nextBeforeDate;

        var placed2 = false;
        for (var di = dates.length - 1; di >= 0; di--) {
          var d = dates[di];
          if (d.date > targetDate) continue;
          if (d.date < lowerBound) break;
          if (!canPlaceOnDate(cItem.task, d)) continue;
          // Check deps (including fixed/pre-placed items not in pool)
          var depResult1 = depsMetByDate(cItem.task, d);
          if (!depResult1) continue;
          var depAfter1 = depAfterFrom(depResult1);
          var wins = getWhenWindows(cItem.task.when, dayWindows[d.key]);
          if (wins.length === 0) continue;

          var beforeMin2 = WALK_END;
          if (nextBeforeDate && d.date.getTime() === nextBeforeDate.getTime() && nextBeforeMin != null) {
            beforeMin2 = nextBeforeMin;
          }

          if (placeLate(cItem, d, beforeMin2, undefined, depAfter1)) {
            placed2 = true;
            var myStart = null;
            cItem._parts.forEach(function(p) {
              if (myStart === null || p.start < myStart) myStart = p.start;
            });
            nextBeforeDate = d.date;
            nextBeforeMin = myStart;
            break;
          }
        }
      }
    });

    // --- Step B: Non-rigid habits for this priority level ---
    // Habits get remaining capacity after deadline tasks at this priority
    // tier have claimed their slots.
    var habitItems = pool.filter(function(item) {
      return item.task.habit && item.remaining > 0 && (item.task.pri || "P3") === priLevel;
    });
    habitItems.sort(function(a, b) {
      var aDate = parseDate(a.task.date) || localToday;
      var bDate = parseDate(b.task.date) || localToday;
      var dd = aDate - bDate;
      if (dd !== 0) return dd;
      // Within same date, narrower when-windows first so constrained
      // habits get their slots before flexible ones consume them.
      return whenAvailableMinutes(a.task) - whenAvailableMinutes(b.task);
    });
    habitItems.forEach(function(item) {
      if (item.remaining <= 0) return;
      var t = item.task;
      for (var di = 0; di < dates.length; di++) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (item.ceiling && d.date > item.ceiling) continue;
        if (!canPlaceOnDate(t, d)) continue;
        var flexWins = getHabitFlexWindows(t, dayWindows[d.key]);
        // If flex window has less free capacity than needed, fall back to when-windows
        if (flexWins) {
          var flexFree = 0;
          var _occ = dayOcc[d.key];
          for (var fi = 0; fi < flexWins.length; fi++) {
            for (var fm = flexWins[fi][0]; fm < flexWins[fi][1]; fm++) {
              if (!_occ[fm]) flexFree++;
            }
          }
          if (flexFree < item.remaining) flexWins = null;
        }
        var wins = flexWins || getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        placeEarly(item, d, 0, flexWins);
      }
    });
  });

  // Track which tasks have been placed (shared across phases)
  var placeVisited = {};
  // Mark placed habits and deadline items from the merged phase.
  // Unplaced habits fall through to Phase 2 where they can try other days.
  pool.forEach(function(item) {
    if (item.task.habit && item._parts.length > 0) placeVisited[item.task.id] = true;
    if (item.deadline && item._parts.length > 0) placeVisited[item.task.id] = true;
  });

  // PHASE 1.5: Past-deadline tasks — deadline already passed, place from today forward
  PRI_LEVELS.forEach(function(priLevel) {
    pool.filter(function(item) {
      return item.deadline && item.remaining > 0 && item._parts.length === 0 && (item.task.pri || "P3") === priLevel;
    }).forEach(function(item) {
      for (var di = 0; di < dates.length; di++) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (d.date < localToday) continue;
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (item.ceiling && d.date > item.ceiling) continue;
        if (!canPlaceOnDate(item.task, d)) continue;
        var depResult1b = depsMetByDate(item.task, d);
        if (!depResult1b) continue;
        var depAfter1b = depAfterFrom(depResult1b);
        var depBefore1b = depBeforeFrom(depResult1b);
        var wins = getWhenWindows(item.task.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        placeEarly(item, d, depAfter1b, undefined, depBefore1b);
      }
      // Only prevent Phase 2 re-processing if actually placed
      if (item._parts.length > 0) placeVisited[item.task.id] = true;
    });
  });

  // PHASE 2: Non-deadline flexible tasks (P1 first)
  // These lock into place before deadline pull-forward happens.

  // Today capacity reservation: estimate high-pri demand on today.
  // If P1/P2 tasks need most of today's capacity, P3/P4 flexible tasks
  // should defer to tomorrow so they don't consume today's limited slots.
  var todayReserved = false;
  var todayDateObj = dates.length > 0 && dates[0].isToday ? dates[0] : null;
  if (todayDateObj) {
    var highPriDemand = 0;
    pool.forEach(function(item) {
      if (item.remaining <= 0) return;
      var pri = item.task.pri || 'P3';
      if (pri !== 'P1' && pri !== 'P2') return;
      // Only count if eligible for today
      if (item.earliestDate && todayDateObj.date < item.earliestDate) return;
      if (item.ceiling && todayDateObj.date > item.ceiling) return;
      if (!canPlaceOnDate(item.task, todayDateObj)) return;
      highPriDemand += item.remaining;
    });
    // Compute today's remaining free capacity (after Phase 0/0.5/1)
    var todayOcc = dayOcc[todayDateObj.key];
    var todayFree = 0;
    var todayWins = dayWindows[todayDateObj.key] && dayWindows[todayDateObj.key].anytime ? dayWindows[todayDateObj.key].anytime : [];
    for (var twi = 0; twi < todayWins.length; twi++) {
      for (var tm = todayWins[twi][0]; tm < todayWins[twi][1]; tm++) {
        if (!todayOcc[tm]) todayFree++;
      }
    }
    todayReserved = todayFree > 0 && highPriDemand > todayFree * 0.6;
  }

  function placeWithDeps(item) {
    if (!item || item.remaining <= 0) return;
    if (placeVisited[item.task.id]) return;
    placeVisited[item.task.id] = true;


    getTaskDeps(item.task).forEach(function(depId) {
      if (globalPlacedEnd[depId]) return;
      var depItem = null;
      for (var i = 0; i < pool.length; i++) { if (pool[i].task.id === depId) { depItem = pool[i]; break; } }
      if (depItem && depItem.remaining > 0) placeWithDeps(depItem);
    });

    var t = item.task;

    // Backward scheduling: if this task has a downstream ceiling (dependants
    // need it done by a certain date) and is not pinned/generated, schedule
    // it late — close to when it's actually needed rather than ASAP.
    // Deadline tasks: late-place toward their due date.
    // Deadlines govern placement — if the math demands today, it goes today
    // regardless of priority. The backward scan naturally places near the
    // deadline and only reaches today when capacity requires it.
    if (item.deadline && !t.datePinned && !t.generated && !t.habit) {
      for (var di = dates.length - 1; di >= 0; di--) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (d.date > item.deadline) continue;
        if (d.date < localToday) break;
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (!canPlaceOnDate(t, d)) continue;
        var depResultDL = depsMetByDate(t, d);
        if (!depResultDL) continue;
        var depAfterDL = depAfterFrom(depResultDL);
        var depBeforeDL = depBeforeFrom(depResultDL);
        var wins = getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        placeLate(item, d, depBeforeDL < 1440 ? depBeforeDL : undefined, undefined, depAfterDL);
        if (item.remaining <= 0) break;
      }
      // Fallback: early placement if late-place failed
      if (item.remaining > 0 && item._parts.length === 0) {
        for (var di2 = 0; di2 < dates.length; di2++) {
          if (item.remaining <= 0) break;
          var d2 = dates[di2];
          if (d2.date < localToday) continue;
          if (item.earliestDate && d2.date < item.earliestDate) continue;
          if (d2.date > item.deadline) break;
          if (!canPlaceOnDate(t, d2)) continue;
          var depResult2 = depsMetByDate(t, d2);
          if (!depResult2) continue;
          var depAfter2 = depAfterFrom(depResult2);
          var depBefore2 = depBeforeFrom(depResult2);
          var wins2 = getWhenWindows(t.when, dayWindows[d2.key]);
          if (wins2.length === 0) continue;
          placeEarly(item, d2, depAfter2, undefined, depBefore2);
        }
      }
      return;
    }

    var hasDownstreamCeiling = item.ceiling && !item.deadline && !t.datePinned && !t.generated && !t.habit;
    // Skip late-placement when ceiling and earliest date are the same day —
    // late-placing pushes to end-of-day, breaking same-day dependency chains
    var ceilingSameDay = hasDownstreamCeiling && item.ceiling.getTime() === (item.earliestDate || localToday).getTime();
    // Also skip late-placement if this task has un-placed dependants with ceilings —
    // late-placing pushes to end-of-day, leaving no room for dependants after it.
    // Early-place instead so dependants can late-place in remaining space.
    var hasCeilingDependants = false;
    if (hasDownstreamCeiling && !ceilingSameDay) {
      var children = dependedOnBy[t.id] || [];
      for (var ci = 0; ci < children.length; ci++) {
        var childItem = null;
        for (var pi = 0; pi < pool.length; pi++) { if (pool[pi].task.id === children[ci]) { childItem = pool[pi]; break; } }
        if (childItem && childItem.ceiling && childItem.remaining > 0) { hasCeilingDependants = true; break; }
      }
    }
    if (hasDownstreamCeiling && !ceilingSameDay && !hasCeilingDependants) {
      // Try late-placement near the ceiling first
      for (var di = dates.length - 1; di >= 0; di--) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (d.date > item.ceiling) continue;
        if (d.date < localToday) break;
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (!canPlaceOnDate(t, d)) continue;
        var depResultDC = depsMetByDate(t, d);
        if (!depResultDC) continue;
        var depAfterDC = depAfterFrom(depResultDC);
        var depBeforeDC = depBeforeFrom(depResultDC);
        var wins = getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        placeLate(item, d, depBeforeDC < 1440 ? depBeforeDC : undefined, undefined, depAfterDC);
        if (item.remaining <= 0) break;
      }
      // Fallback: if late-placement failed, try early placement (better placed early than unplaced)
      if (item.remaining > 0 && item._parts.length === 0) {
        for (var di2 = 0; di2 < dates.length; di2++) {
          if (item.remaining <= 0) break;
          var d2 = dates[di2];
          if (item.earliestDate && d2.date < item.earliestDate) continue;
          if (!canPlaceOnDate(t, d2)) continue;
          var depResult2 = depsMetByDate(t, d2);
          if (!depResult2) continue;
          var depAfter2 = depAfterFrom(depResult2);
          var depBefore2 = depBeforeFrom(depResult2);
          var wins2 = getWhenWindows(t.when, dayWindows[d2.key]);
          if (wins2.length === 0) continue;
          placeEarly(item, d2, depAfter2, undefined, depBefore2);
        }
      }
      return;
    }

    // Today reservation: two distinct rules.
    //
    // 1. Tasks WITH a deadline (own or inherited from dep chain): the deadline
    //    governs placement. The late-placement path already handles this — it
    //    places backward from the due date. skipToday is NOT applied; if the
    //    math demands today, it goes today regardless of priority.
    //
    // 2. Tasks WITHOUT any deadline: priority decides. P3/P4 without deadlines
    //    should not claim today's scarce capacity when higher-priority tasks
    //    could use it. P1/P2 without deadlines stay.
    var skipToday = false;
    if (todayReserved && !t.habit && !t.datePinned && !t.generated) {
      if (!item.deadline) {
        var tPri = t.pri || 'P3';
        if (tPri === 'P4' || tPri === 'P3') skipToday = true;
      }
      // Tasks with deadlines: skipToday stays false — deadline math governs
    }

    for (var di = 0; di < dates.length; di++) {
      if (item.remaining <= 0) break;
      var d = dates[di];
      if (skipToday && d.isToday) continue;
      if (item.earliestDate && d.date < item.earliestDate) continue;
      if (item.ceiling && d.date > item.ceiling) continue;
      if (!canPlaceOnDate(t, d)) continue;
      var depResult = depsMetByDate(t, d);
      if (!depResult) continue;
      var depAfter = depAfterFrom(depResult);
      var depBefore = depBeforeFrom(depResult);
      var flexWins = getHabitFlexWindows(t, dayWindows[d.key]);
      if (flexWins) {
        var flexFree2 = 0;
        var _occ2 = dayOcc[d.key];
        for (var fi = 0; fi < flexWins.length; fi++) {
          for (var fm = flexWins[fi][0]; fm < flexWins[fi][1]; fm++) {
            if (!_occ2[fm]) flexFree2++;
          }
        }
        if (flexFree2 < item.remaining) flexWins = null;
      }
      var wins = flexWins || getWhenWindows(t.when, dayWindows[d.key]);
      if (wins.length === 0) continue;
      placeEarly(item, d, depAfter, flexWins, depBefore);
    }
  }

  // Phase 2: Unified placement by priority (P1→P4).
  // Deadline tasks go before free tasks within the same priority level —
  // they have constrained windows and must be placed first to avoid
  // no-deadline tasks consuming their limited capacity.
  // Habits were placed in Phase 0.5, critical deadlines in Phase 1.
  PRI_LEVELS.forEach(function(priLevel) {
    var items = pool.filter(function(item) {
      return item.remaining > 0 && (item.task.pri || "P3") === priLevel;
    });
    items.sort(function(a, b) {
      // Tasks with deadlines (or downstream ceilings) before free tasks
      var aConstrained = (a.deadline || a.ceiling) ? 0 : 1;
      var bConstrained = (b.deadline || b.ceiling) ? 0 : 1;
      if (aConstrained !== bConstrained) return aConstrained - bConstrained;
      // Deadline tasks: earliest deadline first
      if (a.deadline && b.deadline) {
        var dd = a.deadline - b.deadline;
        if (dd !== 0) return dd;
      }
      // Ceiling tasks: earliest ceiling first
      if (a.ceiling && b.ceiling) {
        var cc = a.ceiling - b.ceiling;
        if (cc !== 0) return cc;
      }
      // Pinned-date tasks first among free tasks
      var aDate = a.task.datePinned ? (parseDate(a.task.date) || localToday) : localToday;
      var bDate = b.task.datePinned ? (parseDate(b.task.date) || localToday) : localToday;
      var dd2 = aDate - bDate;
      if (dd2 !== 0) return dd2;
      return whenAvailableMinutes(a.task) - whenAvailableMinutes(b.task);
    });
    items.forEach(function(item) { placeWithDeps(item); });
  });

  // PHASE 2.5: Priority compaction — swap lower-pri tasks on earlier days
  // with higher-pri tasks on later days when possible.
  var compactAttempts = 0;
  var MAX_COMPACT = 50;
  var sortedDates = dates.filter(function(d) { return d.date >= localToday; });
  for (var earlyIdx = 0; earlyIdx < sortedDates.length - 1 && compactAttempts < MAX_COMPACT; earlyIdx++) {
    var earlyD = sortedDates[earlyIdx];
    var earlyPlaced = dayPlaced[earlyD.key];
    if (!earlyPlaced) continue;

    // Find low-pri tasks on this early day
    for (var epi = 0; epi < earlyPlaced.length && compactAttempts < MAX_COMPACT; epi++) {
      var earlyP = earlyPlaced[epi];
      if (earlyP.locked || !earlyP.task) continue;
      if (earlyP.task.habit || earlyP.task.rigid) continue;
      if (hasWhen(earlyP.task.when, 'fixed')) continue;
      var earlyPri = earlyP.task.pri || 'P3';
      var earlyRank = earlyPri === 'P1' ? 4 : earlyPri === 'P2' ? 3 : earlyPri === 'P4' ? 1 : 2;

      // Look for higher-pri tasks on later days
      for (var lateIdx = earlyIdx + 1; lateIdx < sortedDates.length && compactAttempts < MAX_COMPACT; lateIdx++) {
        var lateD = sortedDates[lateIdx];
        var latePlaced = dayPlaced[lateD.key];
        if (!latePlaced) continue;

        for (var lpi = 0; lpi < latePlaced.length && compactAttempts < MAX_COMPACT; lpi++) {
          var lateP = latePlaced[lpi];
          if (lateP.locked || !lateP.task) continue;
          if (lateP.task.habit || lateP.task.rigid) continue;
          if (hasWhen(lateP.task.when, 'fixed')) continue;
          var latePri = lateP.task.pri || 'P3';
          var lateRank = latePri === 'P1' ? 4 : latePri === 'P2' ? 3 : latePri === 'P4' ? 1 : 2;
          if (lateRank <= earlyRank) continue;
          // Only attempt swaps with a meaningful priority gap (>= 2 levels)
          // to avoid wasting budget on marginal improvements
          if (lateRank - earlyRank < 2) continue;

          compactAttempts++;

          // Find pool items for both
          var earlyItem = null, lateItem = null;
          for (var pi = 0; pi < pool.length; pi++) {
            if (pool[pi].task.id === earlyP.task.id) earlyItem = pool[pi];
            if (pool[pi].task.id === lateP.task.id) lateItem = pool[pi];
          }
          if (!earlyItem || !lateItem) continue;

          // Check constraints: lateItem can go on earlyD, earlyItem can go on lateD
          if (!canPlaceOnDate(lateP.task, earlyD)) continue;
          if (!canPlaceOnDate(earlyP.task, lateD)) continue;
          if (lateItem.earliestDate && earlyD.date < lateItem.earliestDate) continue;
          if (earlyItem.ceiling && lateD.date > earlyItem.ceiling) continue;

          // Save state for rollback
          var eSavedParts = earlyItem._parts.slice();
          var eSavedRemaining = earlyItem.remaining;
          var eSavedUpdates = taskUpdates[earlyItem.task.id];
          var eSavedEnd = globalPlacedEnd[earlyItem.task.id];
          var lSavedParts = lateItem._parts.slice();
          var lSavedRemaining = lateItem.remaining;
          var lSavedUpdates = taskUpdates[lateItem.task.id];
          var lSavedEnd = globalPlacedEnd[lateItem.task.id];

          unplaceItem(earlyItem);
          unplaceItem(lateItem);

          // Try placing higher-pri on earlier day
          var lateWins = getWhenWindows(lateP.task.when, dayWindows[earlyD.key]);
          var latePlacedOk = lateWins.length > 0 && placeEarly(lateItem, earlyD);

          // Try placing lower-pri on later day
          var earlyPlacedOk = false;
          if (latePlacedOk) {
            for (var cdi = 0; cdi < dates.length; cdi++) {
              if (earlyItem.remaining <= 0) break;
              var cd = dates[cdi];
              if (earlyItem.earliestDate && cd.date < earlyItem.earliestDate) continue;
              if (earlyItem.ceiling && cd.date > earlyItem.ceiling) continue;
              if (cd.date < localToday) continue;
              if (!canPlaceOnDate(earlyItem.task, cd)) continue;
              var cWins = getWhenWindows(earlyItem.task.when, dayWindows[cd.key]);
              if (cWins.length === 0) continue;
              placeEarly(earlyItem, cd);
            }
            earlyPlacedOk = earlyItem.remaining <= 0;
          }

          // Verify dependency ordering after swap
          var compactDepsOk = true;
          if (latePlacedOk && earlyPlacedOk) {
            // Check that both swapped tasks still respect dep ordering
            [earlyItem, lateItem].forEach(function(swapItem) {
              if (!compactDepsOk) return;
              // Check this task's placements are after its deps
              var deps = getTaskDeps(swapItem.task);
              for (var dci = 0; dci < deps.length && compactDepsOk; dci++) {
                var depEnd = globalPlacedEnd[deps[dci]];
                if (!depEnd) continue;
                var depEndDate = parseDate(depEnd.dateKey);
                for (var pci = 0; pci < swapItem._parts.length && compactDepsOk; pci++) {
                  var partDate = parseDate(swapItem._parts[pci]._dateKey);
                  if (!partDate || !depEndDate) continue;
                  if (partDate < depEndDate) { compactDepsOk = false; break; }
                  if (partDate.getTime() === depEndDate.getTime() && swapItem._parts[pci].start < depEnd.endMin) { compactDepsOk = false; break; }
                }
              }
              // Check this task's dependants are still after it
              var children = dependedOnBy[swapItem.task.id] || [];
              for (var cci = 0; cci < children.length && compactDepsOk; cci++) {
                var childEnd = globalPlacedEnd[children[cci]];
                if (!childEnd) continue;
                // Find the child's earliest start
                var childStart = null;
                var childDateKey = null;
                for (var dki = 0; dki < dates.length; dki++) {
                  var dp = dayPlaced[dates[dki].key];
                  if (!dp) continue;
                  for (var dpi = 0; dpi < dp.length; dpi++) {
                    if (dp[dpi].task && dp[dpi].task.id === children[cci]) {
                      if (childStart === null || dp[dpi].start < childStart) {
                        childStart = dp[dpi].start;
                        childDateKey = dates[dki].key;
                      }
                    }
                  }
                }
                if (childStart === null) continue;
                var myEnd = globalPlacedEnd[swapItem.task.id];
                if (!myEnd) continue;
                var myEndDate = parseDate(myEnd.dateKey);
                var childDate = parseDate(childDateKey);
                if (!myEndDate || !childDate) continue;
                if (myEndDate > childDate) { compactDepsOk = false; break; }
                if (myEndDate.getTime() === childDate.getTime() && myEnd.endMin > childStart) { compactDepsOk = false; break; }
              }
            });
          }

          if (latePlacedOk && earlyPlacedOk && compactDepsOk) {
            // Success — keep the swap, continue checking for more inversions
            continue;
          } else {
            // Rollback
            unplaceItem(earlyItem);
            unplaceItem(lateItem);
            eSavedParts.forEach(function(part) {
              recordPlace(dayOcc[part._dateKey], dayPlaced[part._dateKey], earlyItem.task, part.start, part.dur, part.locked, part._dateKey, earlyItem);
            });
            if (eSavedUpdates) taskUpdates[earlyItem.task.id] = eSavedUpdates;
            if (eSavedEnd) globalPlacedEnd[earlyItem.task.id] = eSavedEnd;
            lSavedParts.forEach(function(part) {
              recordPlace(dayOcc[part._dateKey], dayPlaced[part._dateKey], lateItem.task, part.start, part.dur, part.locked, part._dateKey, lateItem);
            });
            if (lSavedUpdates) taskUpdates[lateItem.task.id] = lSavedUpdates;
            if (lSavedEnd) globalPlacedEnd[lateItem.task.id] = lSavedEnd;
          }
        }
      }
    }
  }

  // PHASE 3: Pull deadline tasks forward into remaining gaps
  // Deadline tasks were packed tight against their due dates in Phase 1.
  // Now decompress them into earlier gaps, processing dependencies first
  // so dependency ordering is maintained.
  var pullVisited = {};

  function pullForwardWithDeps(item) {
    if (pullVisited[item.task.id]) return;
    pullVisited[item.task.id] = true;

    // Recursively pull forward dependencies first
    getTaskDeps(item.task).forEach(function(depId) {
      var depItem = null;
      for (var i = 0; i < pool.length; i++) { if (pool[i].task.id === depId) { depItem = pool[i]; break; } }
      if (depItem && depItem.deadline && depItem._parts.length > 0 && !pullVisited[depId]) {
        pullForwardWithDeps(depItem);
      }
    });

    if (item._parts.length === 0) return;

    // Save snapshot for rollback
    var savedParts = item._parts.slice();
    var savedEnd = globalPlacedEnd[item.task.id];
    var savedUpdates = taskUpdates[item.task.id];

    // Capture original placement date BEFORE unplacing
    var originalDateKey = item._parts.length > 0 ? item._parts[0]._dateKey : null;

    unplaceItem(item);

    // Determine pull-forward floor
    var pullFloor = new Date(localToday);
    if (item.task.startAfter) {
      var saDate = parseDate(item.task.startAfter);
      if (saDate && saDate > pullFloor) pullFloor = saDate;
    }
    if (item.earliestDate && item.earliestDate > pullFloor) pullFloor = item.earliestDate;

    // Dampening: raise pullFloor when intervening days are mostly free
    // Default ON — only skip if explicitly disabled via pullForwardDampening: false
    var dampeningEnabled = !(cfg.preferences && cfg.preferences.pullForwardDampening === false);
    if (originalDateKey && dampeningEnabled) {
      var origDate = parseDate(originalDateKey);
      if (origDate) {
        var dayGap = Math.round((origDate - localToday) / 86400000);
        if (dayGap > 1) {
          var totalAvail = 0, totalUsed = 0;
          for (var ddi = 0; ddi < dates.length; ddi++) {
            var dd = dates[ddi];
            if (dd.date <= localToday || dd.date >= origDate) continue;
            var awins = dayWindows[dd.key] && dayWindows[dd.key].anytime ? dayWindows[dd.key].anytime : [];
            var dayAvail = 0;
            for (var wi = 0; wi < awins.length; wi++) dayAvail += (awins[wi][1] - awins[wi][0]);
            totalAvail += dayAvail;
            var occ = dayOcc[dd.key];
            if (occ) { for (var mk in occ) { if (occ[mk]) totalUsed++; } }
          }
          var freeRatio = totalAvail > 0 ? Math.max(0, totalAvail - totalUsed) / totalAvail : 0;
          var skipDays = Math.floor(freeRatio * dayGap);
          if (skipDays > 0) {
            var dampenedFloor = new Date(localToday);
            dampenedFloor.setDate(dampenedFloor.getDate() + skipDays);
            if (dampenedFloor > pullFloor) pullFloor = dampenedFloor;
          }
        }
      }
    }

    var dueDate = item.deadline;

    for (var di = 0; di < dates.length; di++) {
      if (item.remaining <= 0) break;
      var d = dates[di];
      if (d.date < pullFloor) continue;
      if (d.date > dueDate) break;
      if (!canPlaceOnDate(item.task, d)) continue;
      var depResult = depsMetByDate(item.task, d);
      if (!depResult) continue;
      var depAfter = depAfterFrom(depResult);
      var depBefore = depBeforeFrom(depResult);
      var wins = getWhenWindows(item.task.when, dayWindows[d.key]);
      if (wins.length === 0) continue;
      placeEarly(item, d, depAfter, undefined, depBefore);
    }

    // Rollback only if pull-forward placed fewer parts than original
    if (item.remaining > 0 && item._parts.length < savedParts.length) {
      unplaceItem(item);
      savedParts.forEach(function(part) {
        recordPlace(dayOcc[part._dateKey], dayPlaced[part._dateKey], item.task, part.start, part.dur, part.locked, part._dateKey, item);
      });
      if (savedEnd) globalPlacedEnd[item.task.id] = savedEnd;
      if (savedUpdates) taskUpdates[item.task.id] = savedUpdates;
    }
  }

  PRI_LEVELS.forEach(function(priLevel) {
    var pullItems = pool.filter(function(item) {
      return item.deadline && item.deadline >= localToday && item._parts.length > 0 && (item.task.pri || "P3") === priLevel;
    });
    // Sort by earliest deadline first so most urgent get best gaps
    pullItems.sort(function(a, b) {
      var dd = a.deadline - b.deadline;
      if (dd !== 0) return dd;
      return whenAvailableMinutes(a.task) - whenAvailableMinutes(b.task);
    });
    pullItems.forEach(function(item) { pullForwardWithDeps(item); });
  });

  // PHASE 4 — RELAXATION: Unplaced items with flexWhen opt-in retry with
  // 'anytime' windows.  Tasks without flexWhen stay unplaced and surface
  // a diagnostic message so the user can enable the override if desired.
  PRI_LEVELS.forEach(function(priLevel) {
    pool.filter(function(item) {
      return item.remaining > 0 && item._parts.length === 0 && item.task.flexWhen && (item.task.pri || "P3") === priLevel;
    }).forEach(function(item) {
      var partsBeforeRelax = item._parts.length;
      for (var di = 0; di < dates.length; di++) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (item.ceiling && d.date > item.ceiling) continue;
        if (d.date < localToday) continue;
        if (!canPlaceOnDate(item.task, d)) continue;
        var depResultR = depsMetByDate(item.task, d);
        if (!depResultR) continue;
        var depAfterR = depAfterFrom(depResultR);
        var depBeforeR = depBeforeFrom(depResultR);
        placeEarly(item, d, depAfterR, "anytime", depBeforeR);
      }
      // Tag newly placed parts as when-relaxed
      for (var ri = partsBeforeRelax; ri < item._parts.length; ri++) {
        item._parts[ri]._whenRelaxed = true;
      }
    });
  });

  // PHASE 4.5 — OVERFLOW: Unplaced non-pinned tasks try adjacent days (±1, ±2)
  var overflowOffsets = [1, -1, 2, -2];
  PRI_LEVELS.forEach(function(priLevel) {
    pool.filter(function(item) {
      return item.remaining > 0 && item._parts.length === 0 && (item.task.pri || "P3") === priLevel
        && !item.task.habit && !item.task.datePinned && !item.task.generated;
    }).forEach(function(item) {
      var t = item.task;
      var origDate = parseDate(t.date);
      if (!origDate) return;
      var origKey = formatDateKey(origDate);
      var origIdx = -1;
      for (var i = 0; i < dates.length; i++) {
        if (dates[i].key === origKey) { origIdx = i; break; }
      }
      if (origIdx < 0) return;

      for (var oi = 0; oi < overflowOffsets.length; oi++) {
        if (item.remaining <= 0) break;
        var tryIdx = origIdx + overflowOffsets[oi];
        if (tryIdx < 0 || tryIdx >= dates.length) continue;
        var d = dates[tryIdx];
        if (d.date < localToday) continue;
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (item.deadline && d.date > item.deadline) continue;
        if (item.ceiling && d.date > item.ceiling) continue;
        if (!canPlaceOnDate(t, d)) continue;
        var depResultO = depsMetByDate(t, d);
        if (!depResultO) continue;
        var depAfterO = depAfterFrom(depResultO);
        var depBeforeO = depBeforeFrom(depResultO);
        var wins = getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length > 0) { if (placeEarly(item, d, depAfterO, undefined, depBeforeO)) break; }
        if (t.flexWhen && placeEarly(item, d, depAfterO, "anytime", depBeforeO)) break;
      }

      // If still unplaced and has dayReq, try adjacent days relaxing dayReq
      if (item.remaining > 0 && item._parts.length === 0 && t.dayReq && t.dayReq !== "any") {
        for (var oi2 = 0; oi2 < overflowOffsets.length; oi2++) {
          if (item.remaining <= 0) break;
          var tryIdx2 = origIdx + overflowOffsets[oi2];
          if (tryIdx2 < 0 || tryIdx2 >= dates.length) continue;
          var d2 = dates[tryIdx2];
          if (d2.date < localToday) continue;
          if (item.earliestDate && d2.date < item.earliestDate) continue;
          if (item.deadline && d2.date > item.deadline) continue;
          if (item.ceiling && d2.date > item.ceiling) continue;
          if (canPlaceOnDate(t, d2)) continue; // already tried above
          var depResultO2 = depsMetByDate(t, d2);
          if (!depResultO2) continue;
          var depAfterO2 = depAfterFrom(depResultO2);
          var depBeforeO2 = depBeforeFrom(depResultO2);
          var wins2 = getWhenWindows(t.when, dayWindows[d2.key]);
          if (wins2.length > 0) { if (placeEarly(item, d2, depAfterO2, undefined, depBeforeO2)) break; }
          if (t.flexWhen && placeEarly(item, d2, depAfterO2, "anytime", depBeforeO2)) break;
        }
      }
    });
  });

  // PHASE 5 — HABIT RESCUE: Reflow days that have unplaced habits.
  // If a habit couldn't fit on its day, try bumping one non-habit task
  // off that day to make room — but only if the bumped task successfully
  // re-places elsewhere (net improvement, never net worse).
  var unplacedHabits = pool.filter(function(item) {
    return item.task.habit && item.remaining > 0 && item._parts.length === 0;
  });
  unplacedHabits.forEach(function(hItem) {
    var td = parseDate(hItem.task.date);
    if (!td) return;
    var dayKey = formatDateKey(td);
    var d = getDateObj(dayKey);
    if (!d) return;

    // Collect displaceable items: non-locked, non-habit, non-deadline on this day
    // Prefer items that occupy time in the habit's required location window
    var habitLoc = hItem.task.location || [];
    var candidates = [];
    pool.forEach(function(pItem) {
      if (pItem.task.habit) return;
      if (pItem.deadline) return;
      if (pItem._parts.length === 0) return;
      var onDay = pItem._parts.filter(function(p) { return p._dateKey === dayKey && !p.locked; });
      if (onDay.length === 0) return;
      // Check if any of the item's parts overlap with a location-compatible window
      var locOverlap = habitLoc.length === 0; // no constraint = any overlap is fine
      if (!locOverlap) {
        for (var pi = 0; pi < onDay.length; pi++) {
          var partMid = onDay[pi].start + Math.floor(onDay[pi].dur / 2);
          var locId = resolveLocationId(dayKey, partMid, cfg, dayBlocks[dayKey]);
          if (canTaskRun(hItem.task, locId, cfg.toolMatrix)) { locOverlap = true; break; }
        }
      }
      pItem._locOverlap = locOverlap;
      candidates.push(pItem);
    });
    // Sort: location-overlapping first, then lowest priority, then largest duration
    candidates.sort(function(a, b) {
      if (a._locOverlap !== b._locOverlap) return a._locOverlap ? -1 : 1;
      var ap = (a.task.pri || "P3"); var bp = (b.task.pri || "P3");
      if (ap !== bp) return ap > bp ? -1 : 1;
      return (b.totalDur || 0) - (a.totalDur || 0);
    });

    // Accumulate bumps until the habit fits, then verify all bumped items re-place
    var bumpedStack = [];
    var habitPlaced = false;
    for (var ci = 0; ci < candidates.length && !habitPlaced; ci++) {
      var bumpItem = candidates[ci];

      // Save state for rollback
      var savedParts = bumpItem._parts.slice();
      var savedRemaining = bumpItem.remaining;
      var savedUpdates = taskUpdates[bumpItem.task.id];
      var savedEnd = globalPlacedEnd[bumpItem.task.id];
      bumpedStack.push({ item: bumpItem, savedParts: savedParts, savedRemaining: savedRemaining, savedUpdates: savedUpdates, savedEnd: savedEnd });

      // Unplace the bump candidate entirely
      unplaceItem(bumpItem);

      // Try placing the habit
      var flexWins = getHabitFlexWindows(hItem.task, dayWindows[dayKey]);
      placeEarly(hItem, d, 0, flexWins);
      // If flex windows didn't work, try the full when-windows (but NOT "anytime"
      // — placing outside the task's when constraint creates invalid placements)
      if (hItem.remaining > 0) {
        var rescueWins = getWhenWindows(hItem.task.when, dayWindows[dayKey]);
        if (rescueWins.length > 0) placeEarly(hItem, d, 0, rescueWins);
      }

      if (hItem.remaining <= 0) {
        // Habit placed! Now verify all bumped items can re-place
        var allReplace = true;
        for (var ri = 0; ri < bumpedStack.length; ri++) {
          var rb = bumpedStack[ri].item;
          if (rb.remaining <= 0) continue;
          for (var di = 0; di < dates.length; di++) {
            if (rb.remaining <= 0) break;
            var rd = dates[di];
            if (rb.earliestDate && rd.date < rb.earliestDate) continue;
            if (rb.ceiling && rd.date > rb.ceiling) continue;
            if (rd.date < localToday) continue;
            if (!canPlaceOnDate(rb.task, rd)) continue;
            var depResult5b = depsMetByDate(rb.task, rd);
            if (!depResult5b) continue;
            var depAfter5b = depAfterFrom(depResult5b);
            var depBefore5b = depBeforeFrom(depResult5b);
            var wins = getWhenWindows(rb.task.when, dayWindows[rd.key]);
            if (wins.length === 0) continue;
            placeEarly(rb, rd, depAfter5b, undefined, depBefore5b);
          }
          if (rb.remaining > 0) { allReplace = false; break; }
        }
        if (allReplace) {
          habitPlaced = true;
        } else {
          // Revert everything — habit and all bumped items
          unplaceItem(hItem);
          for (var vi = 0; vi < bumpedStack.length; vi++) {
            var vb = bumpedStack[vi];
            unplaceItem(vb.item);
            vb.savedParts.forEach(function(part) {
              recordPlace(dayOcc[part._dateKey], dayPlaced[part._dateKey], vb.item.task, part.start, part.dur, part.locked, part._dateKey, vb.item);
            });
            if (vb.savedUpdates) taskUpdates[vb.item.task.id] = vb.savedUpdates;
            if (vb.savedEnd) globalPlacedEnd[vb.item.task.id] = vb.savedEnd;
          }
          bumpedStack = [];
        }
      }
      // If habit still not placed, keep bumping (accumulate freed space)
    }
    // If we exhausted candidates without success, unplace the partially-placed
    // habit and revert any leftover bumps
    if (!habitPlaced && bumpedStack.length > 0) {
      unplaceItem(hItem);
      for (var vi2 = 0; vi2 < bumpedStack.length; vi2++) {
        var vb2 = bumpedStack[vi2];
        unplaceItem(vb2.item);
        vb2.savedParts.forEach(function(part) {
          recordPlace(dayOcc[part._dateKey], dayPlaced[part._dateKey], vb2.item.task, part.start, part.dur, part.locked, part._dateKey, vb2.item);
        });
        if (vb2.savedUpdates) taskUpdates[vb2.item.task.id] = vb2.savedUpdates;
        if (vb2.savedEnd) globalPlacedEnd[vb2.item.task.id] = vb2.savedEnd;
      }
    }
  });

  // PHASE 5.5: Intraday packing — unplace movable tasks, sort by priority,
  // re-pack tightly into earliest valid slots within their when-windows.
  // This consolidates scattered gaps into contiguous free blocks at the end
  // of each window, making room for larger or split tasks.
  function packPriRank(pri) {
    if (pri === 'P1') return 4;
    if (pri === 'P2') return 3;
    if (pri === 'P4') return 1;
    return 2;
  }

  dates.forEach(function(d) {
    var placed = dayPlaced[d.key];
    if (!placed || placed.length < 2) return;

    // Count parts per task on THIS day
    var partsOnDay = {};
    for (var ci = 0; ci < placed.length; ci++) {
      if (placed[ci].task) {
        var cid = placed[ci].task.id;
        partsOnDay[cid] = (partsOnDay[cid] || 0) + 1;
      }
    }

    // Collect movable placements: non-locked, non-rigid, not fixed, not multi-part
    var movable = [];
    var immovable = [];
    for (var i = 0; i < placed.length; i++) {
      var p = placed[i];
      if (!p.task) continue;
      if (p.locked || p.task.rigid || hasWhen(p.task.when, 'fixed') || partsOnDay[p.task.id] > 1) {
        immovable.push(p);
      } else {
        movable.push(p);
      }
    }
    if (movable.length < 2) return;

    // Save old positions for rollback
    var saved = movable.map(function(p) { return { placement: p, oldStart: p.start }; });

    // Step 1: Free all movable slots from occupancy
    var occ = dayOcc[d.key];
    movable.forEach(function(p) {
      for (var m = p.start; m < p.start + p.dur; m++) delete occ[m];
    });

    // Step 2: Sort by priority (P1 first), then tighter constraints first
    movable.sort(function(a, b) {
      var pa = packPriRank(a.task.pri), pb = packPriRank(b.task.pri);
      if (pa !== pb) return pb - pa;
      // Tighter when-windows first (fewer available minutes = harder to place)
      return whenAvailableMinutes(a.task) - whenAvailableMinutes(b.task);
    });

    // Step 3: Pack each task into earliest valid slot
    var allPlaced = true;
    var assignments = [];

    for (var ti = 0; ti < movable.length; ti++) {
      var p2 = movable[ti];
      var t = p2.task;
      var dur = p2.dur;

      // Determine valid when-windows for this task
      var wins = t.habit
        ? (getHabitFlexWindows(t, dayWindows[d.key]) || getWhenWindows(t.when, dayWindows[d.key]))
        : getWhenWindows(t.when, dayWindows[d.key]);
      if (wins.length === 0) wins = [[DAY_START, WALK_END]];

      // Determine dependency constraints on this day
      var afterMin = 0;
      var beforeMin = 1440;
      getTaskDeps(t).forEach(function(depId) {
        if (isBackwardsDep(t.id, depId)) return;
        var info = globalPlacedEnd[depId];
        if (info && info.dateKey === d.key && info.endMin > afterMin) {
          afterMin = info.endMin;
        }
      });
      var children = dependedOnBy[t.id] || [];
      for (var cci = 0; cci < children.length; cci++) {
        if (isBackwardsDep(children[cci], t.id)) continue;
        // Check immovable placements for children
        for (var ipi = 0; ipi < immovable.length; ipi++) {
          if (immovable[ipi].task && immovable[ipi].task.id === children[cci]) {
            if (immovable[ipi].start < beforeMin) beforeMin = immovable[ipi].start;
          }
        }
        // Check already-packed movable assignments for children
        for (var api = 0; api < assignments.length; api++) {
          if (assignments[api].placement.task.id === children[cci]) {
            if (assignments[api].newStart < beforeMin) beforeMin = assignments[api].newStart;
          }
        }
      }

      // Scan for earliest valid slot within when-windows
      var bestStart = -1;
      for (var wi = 0; wi < wins.length && bestStart < 0; wi++) {
        var wStart = Math.max(wins[wi][0], afterMin);
        var wEnd = Math.min(wins[wi][1], beforeMin);
        if (wEnd - wStart < dur) continue;

        for (var scan = wStart; scan + dur <= wEnd; scan++) {
          if (occ[scan]) { scan = scan; continue; } // occupied minute
          // Check contiguous gap
          var gapOk = true;
          for (var gm = scan; gm < scan + dur; gm++) {
            if (occ[gm]) { scan = gm; gapOk = false; break; }
          }
          if (!gapOk) continue;
          // Check location for full duration
          var locOk = true;
          for (var lm = scan; lm < scan + dur; lm += 15) {
            var locId = resolveLocationId(d.key, lm, cfg, dayBlocks[d.key]);
            if (!canTaskRun(t, locId, cfg.toolMatrix)) { locOk = false; break; }
          }
          if (!locOk) continue;
          bestStart = scan;
          break;
        }
      }

      if (bestStart < 0) {
        // Can't fit — rollback entire day
        allPlaced = false;
        break;
      }

      // Reserve the slot
      for (var rm = bestStart; rm < bestStart + dur; rm++) occ[rm] = true;
      assignments.push({ placement: p2, newStart: bestStart });
    }

    if (!allPlaced) {
      // Rollback: restore all original positions
      // First free any partially packed slots
      assignments.forEach(function(a) {
        for (var fm = a.newStart; fm < a.newStart + a.placement.dur; fm++) delete occ[fm];
      });
      saved.forEach(function(s) {
        for (var rm2 = s.oldStart; rm2 < s.oldStart + s.placement.dur; rm2++) occ[rm2] = true;
      });
      return;
    }

    // Step 4: Apply — update placement start times and metadata
    assignments.forEach(function(a) {
      var pr = a.placement;
      if (pr.start === a.newStart) return; // no change

      pr.start = a.newStart;

      var hh = Math.floor(a.newStart / 60), mm2 = a.newStart % 60;
      var ampm = hh >= 12 ? 'PM' : 'AM';
      var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
      var packTz = (pr.task.tz && (pr.locked || hasWhen(pr.task.when, 'fixed'))) ? pr.task.tz : (cfg.timezone || null);
      taskUpdates[pr.task.id] = { date: d.key, time: dh + ':' + (mm2 < 10 ? '0' : '') + mm2 + ' ' + ampm, tz: packTz };
      globalPlacedEnd[pr.task.id] = { dateKey: d.key, endMin: a.newStart + pr.dur, startMin: a.newStart };

      for (var pi = 0; pi < pool.length; pi++) {
        if (pool[pi].task.id !== pr.task.id) continue;
        for (var ppi = 0; ppi < pool[pi]._parts.length; ppi++) {
          if (pool[pi]._parts[ppi] === pr) {
            pool[pi]._parts[ppi].start = a.newStart;
          }
        }
        break;
      }
    });

  });

  // POST-PROCESSING: Overlap columns + unique keys
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

  // Label split parts
  pool.forEach(function(item) {
    if (item._parts.length <= 1) return;
    for (var p = 0; p < item._parts.length; p++) {
      item._parts[p].splitPart = p + 1;
      item._parts[p].splitTotal = item._parts.length;
    }
  });

  // Annotate move reasons for rescheduled tasks
  pool.forEach(function(item) {
    if (item._parts.length === 0) return;
    var t = item.task;
    var origKey = t.date ? t.date.replace(/^0/, '') : null;
    item._parts.forEach(function(part) {
      if (!origKey || origKey === part._dateKey) return;
      var reasons = [];
      var origDate = parseDate(t.date);
      if (origDate && origDate < localToday) reasons.push('from ' + origKey);
      if (t.dayReq && t.dayReq !== 'any') {
        var dayLabels = {M:'Mon',T:'Tue',W:'Wed',R:'Thu',F:'Fri',Sa:'Sat',Su:'Sun',weekday:'weekday',weekend:'weekend'};
        var dayParts = t.dayReq.split(',');
        var dayNames = dayParts.map(function(p) { return dayLabels[p] || p; });
        reasons.push(dayNames.join('/') + ' only');
      }
      if (t.startAfter) reasons.push('after ' + t.startAfter);
      var deps = getTaskDeps(t);
      if (deps.length > 0) {
        var depNames = deps.slice(0, 2).map(function(did) {
          var dt = allTasks.find(function(at) { return at.id === did; });
          return dt ? dt.text.substring(0, 20) : did;
        });
        reasons.push('after ' + depNames.join(', '));
      }
      if (t.due) reasons.push('due ' + t.due);
      // Fallback: if task moved but no specific constraint explains why,
      // it was moved due to capacity (day full, priority compaction, etc.)
      if (reasons.length === 0) {
        var origD = parseDate(t.date);
        var partD = parseDate(part._dateKey);
        if (origD && partD) {
          if (partD < origD) reasons.push('pulled earlier (capacity)');
          else reasons.push('day full \u2192 ' + part._dateKey);
        }
      }
      if (reasons.length > 0) part._moveReason = reasons.join(' \u00B7 ');
    });
  });

  // Collect unplaced with actionable suggestions
  var unplaced = [];
  pool.forEach(function(item) {
    if (item.remaining > 0 && item._parts.length === 0) {
      var t = item.task;
      t._unplacedReason = item.deadline ? "deadline" : "no-capacity";

      var detail = [];
      var suggestions = [];
      var depName = function(id) {
        var dt = allTasks.find(function(at) { return at.id === id; });
        return dt ? "\"" + dt.text + "\"" : id + " (missing)";
      };

      // --- Dependency analysis ---
      var deps = getTaskDeps(t);
      var hasBlockingDeps = false;
      if (deps.length > 0) {
        var blockedDeps = [];
        deps.forEach(function(depId) {
          var info = globalPlacedEnd[depId];
          if (!info && poolIds[depId]) {
            blockedDeps.push(depName(depId) + " (unplaced)");
          } else if (!info) {
            var found = allTasks.find(function(at) { return at.id === depId; });
            if (found) {
              var st = newSt[depId] || "";
              if (st !== "done" && st !== "cancel" && st !== "skip" && st !== "disabled") {
                blockedDeps.push(depName(depId) + " (not scheduled)");
              }
            }
          }
        });
        if (blockedDeps.length > 0) {
          hasBlockingDeps = true;
          detail.push("Blocked by deps: " + blockedDeps.join(", "));
          suggestions.push({ type: 'depBlocked', text: 'Complete or reschedule blocking dependencies first' });
        }
      }

      if (item.earliestDate) detail.push("Earliest: " + formatDateKey(item.earliestDate));
      if (item.deadline) detail.push("Deadline: " + formatDateKey(item.deadline));
      detail.push("Duration: " + item.totalDur + "m, splittable: " + (item.splittable ? "yes" : "no"));

      // --- Location analysis ---
      var locationBlocked = false;
      if (t.location && t.location.length > 0) {
        detail.push("Requires: " + t.location.join("/"));
        var targetKey = item.earliestDate ? formatDateKey(item.earliestDate) : null;
        if (targetKey && dayBlocks[targetKey]) {
          var locAvail = 0;
          var wins2 = getWhenWindows(t.when, dayWindows[targetKey]);
          for (var wi2 = 0; wi2 < wins2.length; wi2++) {
            for (var m2 = wins2[wi2][0]; m2 < wins2[wi2][1]; m2 += 15) {
              var lid = resolveLocationId(targetKey, m2, cfg, dayBlocks[targetKey]);
              if (canTaskRun(t, lid, cfg.toolMatrix)) locAvail += 15;
            }
          }
          if (locAvail < item.totalDur) {
            locationBlocked = true;
            detail.push("Only " + locAvail + "m of " + t.location.join("/") + " time on " + targetKey);
            suggestions.push({ type: 'locationBlocked', text: 'Not enough ' + t.location.join('/') + ' time — move to a day with more availability at that location, or remove the location requirement' });
          }
        }
      }
      detail.push("When: " + (t.when || "any") + ", DayReq: " + (t.dayReq || "any"));

      // --- Gap analysis: find the real bottleneck ---
      if (!hasBlockingDeps && !locationBlocked) {
        var candidateDates3 = dates.filter(function(d) {
          if (d.date < localToday) return false;
          if (item.earliestDate && d.date < item.earliestDate) return false;
          if (item.ceiling && d.date > item.ceiling) return false;
          if (item.deadline && d.date > item.deadline) return false;
          return canPlaceOnDate(t, d);
        });

        if (candidateDates3.length === 0) {
          // No eligible dates at all
          if (t.dayReq && t.dayReq !== 'any') {
            detail.push('No ' + t.dayReq + ' days in range');
            suggestions.push({ type: 'noDays', text: 'No matching days — change the day requirement or extend the date range' });
          } else if (item.deadline && item.deadline < localToday) {
            suggestions.push({ type: 'pastDeadline', text: 'Deadline has passed — extend the deadline or mark as done/skipped' });
          } else {
            suggestions.push({ type: 'noDays', text: 'No eligible dates in the scheduling window' });
          }
        } else {
          // Scan gaps across candidate dates, respecting location constraints
          var maxGap = 0;
          var totalFreeMin = 0;
          var bestGapDate = null;
          var hasLocationConflict = false;
          var totalWhenMin = 0;
          var totalLocOkMin = 0;
          for (var ci = 0; ci < candidateDates3.length; ci++) {
            var cd = candidateDates3[ci];
            var occ3 = dayOcc[cd.key];
            var cwins = getWhenWindows(t.when, dayWindows[cd.key]);
            for (var cwi = 0; cwi < cwins.length; cwi++) {
              var cStart = cwins[cwi][0], cEnd = cwins[cwi][1];
              totalWhenMin += cEnd - cStart;
              var gStart = cStart;
              while (gStart < cEnd) {
                if (occ3[gStart]) { gStart++; continue; }
                // Check location constraint for this slot
                var locOk = true;
                if (t.location && t.location.length > 0) {
                  var slotLoc = resolveLocationId(cd.key, gStart, cfg, dayBlocks[cd.key]);
                  locOk = canTaskRun(t, slotLoc, cfg.toolMatrix);
                }
                if (!locOk) {
                  hasLocationConflict = true;
                  gStart++;
                  continue;
                }
                totalLocOkMin++;
                var gEndPt = gStart + 1;
                while (gEndPt < cEnd && !occ3[gEndPt]) {
                  var eLoc = true;
                  if (t.location && t.location.length > 0) {
                    eLoc = canTaskRun(t, resolveLocationId(cd.key, gEndPt, cfg, dayBlocks[cd.key]), cfg.toolMatrix);
                  }
                  if (!eLoc) break;
                  gEndPt++;
                }
                var gLen = gEndPt - gStart;
                totalFreeMin += gLen;
                if (gLen > maxGap) { maxGap = gLen; bestGapDate = cd.key; }
                gStart = gEndPt;
              }
            }
          }

          var whenLabel2 = (t.when || 'anytime').replace(/,/g, ', ');

          if (totalFreeMin === 0 && hasLocationConflict) {
            // Location blocks all available time
            var locLabel = t.location ? t.location.join('/') : '';
            detail.push('No ' + locLabel + ' time in ' + whenLabel2 + ' slots');
            suggestions.push({ type: 'locationWhenConflict', text: 'Task needs ' + locLabel + ' during ' + whenLabel2 + ', but those blocks are at a different location. Change the time window or the location requirement.' });
          } else if (totalFreeMin === 0) {
            // When-windows completely full (no location issue)
            detail.push('All ' + whenLabel2 + ' slots full');
            t._whenBlocked = true;
            if (!t.flexWhen) {
              suggestions.push({ type: 'enableFlex', text: 'Allow scheduling outside preferred time windows', action: 'flexWhen' });
            }
            suggestions.push({ type: 'freeUp', text: 'Free up time in ' + whenLabel2 + ' blocks on eligible days' });
          } else if (!item.splittable && maxGap < item.remaining) {
            // Gaps exist but none big enough for non-splittable task
            detail.push('Largest gap: ' + maxGap + 'm (on ' + bestGapDate + '), needs ' + item.remaining + 'm contiguous');
            suggestions.push({ type: 'enableSplit', text: 'Enable splitting (min 30m chunks' + (t.habit ? ', all days' : '') + ') — largest gap is ' + maxGap + 'm but task needs ' + item.remaining + 'm', action: 'split' });
            if (maxGap >= item.remaining * 0.5) {
              suggestions.push({ type: 'reduceDuration', text: 'Reduce duration to ' + maxGap + 'm or less to fit in available gaps' });
            }
          } else if (totalFreeMin < item.remaining) {
            // Some free time but not enough total
            detail.push('Only ' + totalFreeMin + 'm free across ' + candidateDates3.length + ' day' + (candidateDates3.length > 1 ? 's' : '') + ', need ' + item.remaining + 'm');
            if (item.deadline) {
              suggestions.push({ type: 'overloaded', text: 'Not enough room before deadline — extend the deadline, shorten the task, or free up time on eligible days' });
            } else {
              suggestions.push({ type: 'overloaded', text: 'Schedule is overloaded — reduce task duration or remove lower-priority tasks to free up space' });
            }
          } else {
            // Enough total free time but still unplaced — likely fragmentation or location/splittability
            detail.push('Largest gap: ' + maxGap + 'm (on ' + bestGapDate + ')');
            if (!item.splittable && maxGap < item.remaining) {
              suggestions.push({ type: 'enableSplit', text: 'Enable splitting (min 30m chunks' + (t.habit ? ', all days' : '') + ') to use ' + totalFreeMin + 'm of fragmented free time', action: 'split' });
            } else if (hasLocationConflict) {
              suggestions.push({ type: 'locationPartial', text: 'Some time in ' + whenLabel2 + ' is at the wrong location for this task — adjust the time window or location' });
            } else {
              suggestions.push({ type: 'fragmented', text: 'Free time is too fragmented — try freeing up a larger block or enable splitting (min 30m chunks' + (t.habit ? ', all days' : '') + ')', action: 'split' });
            }
          }
        }
      }

      t._unplacedDetail = detail.join(" \u00B7 ");
      t._suggestions = suggestions;
      unplaced.push(t);
    }
  });

  var placedCount = Object.keys(taskUpdates).length;
  var deadlineMisses = unplaced.filter(function(t) { return t._unplacedReason === "deadline"; });
  var greedyMs = Math.round(Date.now() - PERF);

  // Score the greedy+resort result
  var scoreOpts = { todayKey: effectiveTodayKey };
  var score = scoreSchedule(dayPlacements, unplaced, allTasks, scoreOpts);
  var greedyScore = score.total;

  // Phase 6: Hill-climbing optimization
  var hcResult = hillClimb(dayPlacements, dayOcc, dayWindows, dayBlocks, unplaced, allTasks, cfg, scoreOpts);
  var totalMs = Math.round(Date.now() - PERF);

  // Re-score after hill-climbing if it improved
  if (hcResult.improved) {
    score = scoreSchedule(dayPlacements, unplaced, allTasks, scoreOpts);
  }

  // Rebuild taskUpdates from final placements so they reflect the actual
  // positions after all phases (compaction, pull-forward, hill-climb).
  // For each placed task, use the earliest placement's date and start time.
  taskUpdates = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.locked || p.marker) return;
      var tid = p.task.id;
      var existing = taskUpdates[tid];
      if (existing) {
        // Keep the earliest placement (by date, then by start time)
        var existDate = parseDate(existing.date);
        var thisDate = parseDate(dk);
        if (thisDate < existDate || (thisDate && existDate && thisDate.getTime() === existDate.getTime() && p.start < existing._startMin)) {
          // This placement is earlier — replace
        } else {
          return; // existing is earlier — keep it
        }
      }
      var hh = Math.floor(p.start / 60), mm = p.start % 60;
      var ampm = hh >= 12 ? 'PM' : 'AM';
      var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
      var rebuildTz = p.tz || (p.task.tz && (p.locked || hasWhen(p.task.when, 'fixed'))) ? (p.tz || p.task.tz) : (cfg.timezone || null);
      taskUpdates[tid] = { date: dk, time: dh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm, tz: rebuildTz, _startMin: p.start };
    });
  });
  // Strip the internal _startMin field
  Object.keys(taskUpdates).forEach(function(tid) { delete taskUpdates[tid]._startMin; });
  // Strip changes from fixed tasks
  allTasks.forEach(function(ft) {
    if (hasWhen(ft.when, 'fixed') && taskUpdates[ft.id]) delete taskUpdates[ft.id];
  });

  // Re-annotate move reasons from final placements (hill-climb may have moved tasks)
  var taskByIdMap = {};
  allTasks.forEach(function(at) { taskByIdMap[at.id] = at; });
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(part) {
      if (!part.task || part.locked || part.marker) return;
      if (part._moveReason) return; // already annotated
      var t = part.task;
      var origKey = t.date ? t.date.replace(/^0/, '') : null;
      if (!origKey || origKey === dk) return;
      var reasons = [];
      var origDate = parseDate(t.date);
      if (origDate && origDate < localToday) reasons.push('from ' + origKey);
      if (t.dayReq && t.dayReq !== 'any') {
        var dayLabels = {M:'Mon',T:'Tue',W:'Wed',R:'Thu',F:'Fri',Sa:'Sat',Su:'Sun',weekday:'weekday',weekend:'weekend'};
        var dayParts2 = t.dayReq.split(',');
        reasons.push(dayParts2.map(function(p) { return dayLabels[p] || p; }).join('/') + ' only');
      }
      if (t.startAfter) reasons.push('after ' + t.startAfter);
      var deps = getTaskDeps(t);
      if (deps.length > 0) {
        var depNames = deps.slice(0, 2).map(function(did) {
          var dt = taskByIdMap[did];
          return dt ? dt.text.substring(0, 20) : did;
        });
        reasons.push('after ' + depNames.join(', '));
      }
      if (t.due) reasons.push('due ' + t.due);
      if (reasons.length === 0) {
        var partD = parseDate(dk);
        if (origDate && partD) {
          if (partD < origDate) reasons.push('pulled earlier (capacity)');
          else reasons.push('day full \u2192 ' + dk);
        }
      }
      if (reasons.length > 0) part._moveReason = reasons.join(' \u00B7 ');
    });
  });

  placedCount = Object.keys(taskUpdates).length;

  if (schedulerWarnings.length > 0) {
    console.log("[SCHED] " + schedulerWarnings.length + " warning(s): " + schedulerWarnings.map(function(w) { return w.type + '(' + (w.taskId || w.taskA) + ')'; }).join(', '));
  }
  console.log("[SCHED] unified: " + dates.length + " days, " + pool.length + " pool, " + placedCount + " placed, " + unplaced.length + " unplaced | " + greedyMs + "ms greedy (score=" + Math.round(greedyScore) + ") + " + hcResult.elapsed + "ms hill-climb (" + hcResult.iterations + " iters" + (hcResult.improved ? ", " + Math.round(hcResult.scoreBefore) + "->" + Math.round(hcResult.scoreAfter) : ", no change") + ") = " + totalMs + "ms | final=" + score.total);
  return { dayPlacements: dayPlacements, taskUpdates: taskUpdates, newStatuses: newSt, unplaced: unplaced, deadlineMisses: deadlineMisses, placedCount: placedCount, score: score, warnings: schedulerWarnings, timezone: cfg.timezone || null };
}

module.exports = unifiedSchedule;
