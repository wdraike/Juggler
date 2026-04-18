/**
 * Unified Scheduler — Slack-Based Forward Placement
 * Phase 0: Fixed items + rigid recurringTasks (immovable anchors)
 * Phase 1: Non-rigid recurring tasks by slack within cycle windows
 * Phase 2: Slack-sorted left-to-right placement — constraint-aware slack
 *          computation, single forward pass, past-due overflow
 * Phase 3: Relaxation + overflow
 * Phase 4: Recurring rescue + intraday packing
 * Phase 5: Hill-climbing optimization
 *
 * Core rule: "On-time trumps priority" — meeting deadlines is more
 * important than respecting user-assigned priorities. Slack (available
 * capacity before deadline minus task duration) determines placement
 * order; priority is a tie-breaker when slack is equal.
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
var topoSortTasks = dependencyHelpers.topoSortTasks;
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
  var debugMode = !!(cfg && cfg._debug);

  var MIN_CHUNK = cfg.splitMinDefault || 15;
  var WALK_END = 23 * 60;
  var DAY_START = GRID_START * 60;
  var DAY_END = GRID_END * 60 + 59;
  var newSt = Object.assign({}, statuses);
  var taskUpdates = {};
  var schedulerWarnings = [];
  var phaseSnapshots = [];
  var missedRecurrings = [];
  var RECUR_DEFAULT_FLEX = 60; // minutes — used for flex window when timeFlex is null

  function fmtTime(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }

  function captureSnapshot(phaseName) {
    if (!debugMode) return;
    var snap = { phase: phaseName, timestamp: Date.now() - PERF, days: {} };
    // During the algorithm, placements accumulate in dayPlaced (not dayPlacements,
    // which is only built at the end). Read from whichever is populated.
    var source = dayPlaced || dayPlacements || {};
    Object.keys(source).forEach(function(dk) {
      var items = source[dk];
      if (!items || items.length === 0) return;
      snap.days[dk] = items.map(function(p) {
        var t = p.task;
        var deps = t ? getTaskDeps(t) : [];
        var depTexts = deps.slice(0, 3).map(function(did) {
          var dt = taskById[did];
          return dt ? dt.text : did;
        });
        return {
          id: t ? t.id : null,
          text: t ? (t.text || '') : '',
          start: p.start, dur: p.dur,
          locked: !!p.locked, marker: !!p.marker,
          recurring: !!(t && t.recurring),
          rigid: !!(t && t.rigid),
          pri: t ? (t.pri || 'P3') : 'P3',
          deadline: t ? t.deadline : null,
          when: t ? t.when : null,
          project: t ? t.project : null,
          split: !!(t && t.split),
          splitPart: p.splitPart || null,
          splitTotal: p.splitTotal || null,
          dependsOn: depTexts,
          startAfter: t ? t.startAfter : null,
          dayReq: t ? t.dayReq : null,
          location: t ? (t.location || []) : [],
          tools: t ? (t.tools || []) : [],
          flexWhen: !!(t && t.flexWhen),
          datePinned: !!(t && t.datePinned),
          _conflict: !!p._conflict,
          preferredTime: t ? (t.time || null) : null,
          timeFlex: t ? t.timeFlex : null,
          _whenRelaxed: !!p._whenRelaxed,
          _moveReason: p._moveReason || null,
          type: p.locked && t && t.datePinned ? 'fixed'
            : p.locked && t && t.rigid && t.recurring ? 'recurring'
            : p.marker ? 'marker'
            : t && t.deadline ? 'deadline'
            : t && t.recurring ? 'flexRecurring'
            : 'flexible'
        };
      });
    });
    phaseSnapshots.push(snap);
  }

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
    var dd = parseDate(t.deadline); if (dd && dd > endDate) { endDate = new Date(dd); endDate.setDate(endDate.getDate() + 3); }
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
  var recurringByDate = {};
  var fixedByDate = {};
  var markersByDate = {};
  var pool = [];

  allTasks.forEach(function(t) {
    var st = newSt[t.id] || "";
    if (st === "done" || st === "cancel" || st === "skip" || st === "pause" || st === "disabled") return;
    // Recurring templates are sources for instance generation, not schedulable items.
    // Their instances (recurring_instance / generated) are what gets placed.
    if (t.taskType === 'recurring_template') return;
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
    // TBD or explicitly null date: user hasn't decided when — skip scheduling
    if (t.date === 'TBD' || t.date === 'tbd') return;
    // Clear scheduler-set dates for flexible tasks — the scheduler should re-evaluate
    // placement from scratch each run. Only preserve dates for tasks the USER anchored.
    var isUserAnchored = t.datePinned || t.generated || t.recurring || t.marker;
    var td;
    if (!isUserAnchored && t.date) {
      // Non-pinned, non-recurring, non-fixed: scheduler previously placed this.
      // Treat as dateless so it re-evaluates from today.
      td = new Date(localToday);
    } else {
      td = t.date ? parseDate(t.date) : null;
      if (!td && t.date !== null && t.date !== undefined && t.date !== '') {
        // Non-empty but unparseable date string — skip
        return;
      }
      if (!td) {
        td = new Date(localToday);
      }
    }
    var effectiveDur = effectiveDuration(t);
    if (effectiveDur <= 0) return;

    // Preferred time: use preferredTimeMins (authoritative, no tz conversion) with fallback to time string
    var sm = t.preferredTimeMins != null ? t.preferredTimeMins : parseTimeToMinutes(t.time);
    // Treat midnight (0) as "no specific time" — it's the default for unscheduled tasks
    // But not if preferredTimeMins is explicitly set to 0 (user wants midnight)
    if (sm === 0 && t.preferredTimeMins == null && !t.datePinned) sm = null;
    var tdKey = formatDateKey(td);
    var isPast = false;
    if (tdKey === effectiveTodayKey) {
      if (sm !== null && sm + effectiveDur <= nowMins) isPast = true;
    } else if (td < localToday) {
      isPast = true;
    }

    // Pinned tasks with a time: anchor at their time, immovable.
    // On today, always show even if time has passed (user needs to see them to mark done).
    // On past days, drop entirely.
    if (t.datePinned && sm !== null) {
      var pinnedDropped = isPast && tdKey !== effectiveTodayKey;
      if (!pinnedDropped) { if (!fixedByDate[tdKey]) fixedByDate[tdKey] = []; fixedByDate[tdKey].push(t); }
      return;
    }
    // Rigid recurringTasks: anchor at preferred time.
    // On today, always show even if time has passed (user needs to see them to mark done).
    // On past days, drop entirely.
    if (t.recurring && t.rigid) {
      var recurDropped = isPast && tdKey !== effectiveTodayKey;
      if (!recurDropped) { if (!recurringByDate[tdKey]) recurringByDate[tdKey] = []; recurringByDate[tdKey].push(t); }
      return;
    }
    // Non-rigid recurringTasks on past days: drop unless still within placement window.
    if (t.recurring && isPast && tdKey !== effectiveTodayKey) {
      var flex = t.timeFlex != null ? t.timeFlex : RECUR_DEFAULT_FLEX;
      var daysPast = Math.round((localToday.getTime() - td.getTime()) / 86400000);
      if (flex < daysPast * 1440) return; // outside placement window — skip
      // Still within window — redirect to today so the scheduler can place it
      td = new Date(localToday);
      tdKey = effectiveTodayKey;
      isPast = false;
    }

    // Flexible recurring on today with preferred time: if the entire flex window
    // [time - flex, time + flex] has passed, the recurring task is MISSED — don't place
    // it at a wrong time (e.g., breakfast at 11:05am). Add to missedRecurrings
    // so it appears in the unplaced list with a clear diagnostic.
    if (t.recurring && !t.rigid && tdKey === effectiveTodayKey && sm !== null) {
      var missedFlex = t.timeFlex != null ? t.timeFlex : RECUR_DEFAULT_FLEX;
      if (missedFlex > 0) {
        var flexEnd = sm + missedFlex;
        if (flexEnd <= nowMins) {
          var flexStart = Math.max(0, sm - missedFlex);
          t._unplacedReason = 'missed';
          t._unplacedDetail = 'Preferred window (' + fmtTime(flexStart) + ' \u2013 ' + fmtTime(flexEnd) + ') has passed';
          t._suggestions = [{ type: 'missed', text: 'Mark as done if completed, or skip for today' }];
          missedRecurrings.push(t);
          return; // don't add to pool
        }
      }
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
      // Recurring/generated recurringTasks are day-specific: pin to their date (floor + ceiling).
      // Non-recurring recurringTasks (one-off) only get a floor — they can float to later days
      // if their assigned day is too full.
      // Exception: tpc (timesPerCycle) instances are unpinned so the scheduler can
      // move them to better-spaced eligible days within the cycle.
      if (t.recurring && td) {
        if (!earliest || td > earliest) earliest = td;
        var hasTpc = t.recur && t.recur.timesPerCycle > 0;
        var tpcDays = t.recur && t.recur.days || '';
        var tpcDayCount = typeof tpcDays === 'object' ? Object.keys(tpcDays).length
          : (typeof tpcDays === 'string' ? tpcDays.length : 0);
        var isTpcFlexible = hasTpc && t.recur.timesPerCycle < tpcDayCount;
        if ((t.recur || t.generated) && !isTpcFlexible) ceiling = td;
        // tpc-flexible instances: no ceiling, but dayReq constrains which days
      }
      var deadline = t.deadline ? parseDate(t.deadline) : null;
      if (deadline) deadline.setHours(23, 59, 59, 999);

      // Tasks with split=true can be placed in chunks of splitMin minutes.
      // Recurring-split instances are normally pre-chunked by reconcile-splits
      // in runSchedule.js, but when calling unifiedSchedule directly (e.g. tests
      // or read-only schedule views), the full-duration row needs in-scheduler
      // splitting. The splitTotal check avoids re-splitting pre-chunked rows.
      var canSplit = !!(t.split && t.splitMin > 0 && (!t.splitTotal || t.splitTotal <= 1));
      pool.push({
        task: t, remaining: effectiveDur, totalDur: effectiveDur,
        earliestDate: earliest, deadline: deadline, ceiling: ceiling,
        splittable: canSplit,
        minChunk: canSplit ? t.splitMin : effectiveDur,
        _parts: [],
        _poolId: t.id
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
  allTasks.forEach(function(t) { taskPinnedMap[t.id] = !!(t.datePinned || t.generated || (t.recurring && !t.rigid === false)); });
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

  // ── Circular dependency detection ──
  // Walk the dependency graph with DFS.  If we encounter a node already
  // in the current stack, we have a cycle.  Remove one edge to break it
  // and warn the user so both tasks can still be scheduled independently.
  var circularBreaks = {};
  (function detectCycles() {
    var WHITE = 0, GRAY = 1, BLACK = 2;
    var color = {};
    allTasks.forEach(function(t) { color[t.id] = WHITE; });

    function dfs(tid) {
      color[tid] = GRAY;
      var deps = dependedOnBy[tid] || [];
      for (var i = 0; i < deps.length; i++) {
        var cid = deps[i];
        if (color[cid] === GRAY) {
          // Cycle found: cid→...→tid→cid.  Break the edge tid→cid.
          circularBreaks[tid + '→' + cid] = true;
          schedulerWarnings.push({
            type: 'circularDependency',
            taskA: tid,
            taskB: cid,
            message: 'Circular dependency detected between ' + tid + ' and ' + cid + ' — ignoring one edge so both can be scheduled'
          });
        } else if (color[cid] === WHITE) {
          dfs(cid);
        }
      }
      color[tid] = BLACK;
    }

    allTasks.forEach(function(t) {
      if (color[t.id] === WHITE) dfs(t.id);
    });
  })();

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
      // Only use child's date as a ceiling if the child is pinned/generated/recurring —
      // flexible task dates are scheduler-movable and shouldn't constrain ancestors.
      if (childDate && (childTask.datePinned || childTask.generated || childTask.recurring)) {
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

  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // computeSlack: called after recurring placement to compute constraint-aware
  // slack for every constrained pool item. Slack = available capacity between
  // the task's earliest placement date and its effective deadline, minus its
  // duration. Lower slack = more urgent. For dependency chain ancestors, the
  // effective deadline is derived by walking backward from the chain tail's
  // hard deadline, subtracting each consumer's capacity needs.
  //
  // Also computes faux-deadlines for chain ancestors (used as a placement ceiling
  // by placeItemForward) and attaches _slack to each pool item.
  function computeSlack() {
    var poolByTaskId = {};
    pool.forEach(function(item) { poolByTaskId[item.task.id] = item; });

    // Helper: compute available capacity (minutes) for a task between two dates.
    // Walks days forward from startDate through endDate, summing free minutes
    // in the task's when-windows on eligible days.
    function availableCapacity(task, item, startDate, endDate) {
      var total = 0;
      for (var di = 0; di < dates.length; di++) {
        var d = dates[di];
        if (d.date < startDate) continue;
        if (d.date > endDate) break;
        if (!canPlaceOnDate(task, d)) continue;
        var wins = getWhenWindows(task.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        var occ = dayOcc[d.key];
        for (var wi = 0; wi < wins.length; wi++) {
          for (var m = wins[wi][0]; m < wins[wi][1]; m++) {
            if (!occ || !occ[m]) total++;
          }
        }
      }
      return total;
    }

    // Helper: walk days backward from mustFinishBy, subtracting available
    // capacity for a consumer's duration to find the latest start date
    // (the effective deadline for the consumer's parent).
    function computeEffectiveStart(task, dur, mustFinishBy) {
      var needed = dur;
      var effectiveStart = null;
      for (var di = dates.length - 1; di >= 0 && needed > 0; di--) {
        var d = dates[di];
        if (d.date > mustFinishBy) continue;
        if (d.date < localToday) break;
        if (!canPlaceOnDate(task, d)) continue;
        var wins = getWhenWindows(task.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        var occ = dayOcc[d.key];
        var dayFree = 0;
        for (var wi = 0; wi < wins.length; wi++) {
          for (var m = wins[wi][0]; m < wins[wi][1]; m++) {
            if (!occ || !occ[m]) dayFree++;
          }
        }
        needed -= dayFree;
        if (needed <= 0) {
          effectiveStart = new Date(d.date);
        }
      }
      if (!effectiveStart && needed > 0) {
        effectiveStart = new Date(localToday);
      }
      return effectiveStart;
    }

    // Step 1: Compute slack for tasks with their own hard deadline (no chain propagation)
    pool.forEach(function(item) {
      if (!item.deadline && !item.fauxDeadline && !item.ceiling) return;
      var effectiveDL = item.deadline || item.fauxDeadline || item.ceiling;
      var earliest = item.earliestDate || localToday;
      if (earliest < localToday) earliest = localToday;
      var cap = availableCapacity(item.task, item, earliest, effectiveDL);
      item._slack = Math.max(0, cap - item.totalDur);
    });

    // Step 2: Walk backward from each deadline task through dependency chains
    // to compute faux-deadlines and slack for chain ancestors.
    var deadlineItems = pool.filter(function(item) { return item.task.deadline && item.deadline; });

    deadlineItems.forEach(function(dlItem) {
      var dlDate = dlItem.deadline;

      // BFS backward through dependency chain
      var queue = [{ taskId: dlItem.task.id, mustFinishBy: dlDate }];
      var visited = {};

      while (queue.length > 0) {
        var cur = queue.shift();
        if (visited[cur.taskId]) continue;
        visited[cur.taskId] = true;

        var curTask = taskById[cur.taskId];
        if (!curTask) continue;
        var curItem = poolByTaskId[cur.taskId];

        // Find parents (tasks that curTask depends on)
        var parentDeps = getTaskDeps(curTask);
        for (var pi = 0; pi < parentDeps.length; pi++) {
          var parentId = parentDeps[pi];
          if (isBackwardsDep(cur.taskId, parentId)) continue;
          if (circularBreaks[parentId + '→' + cur.taskId]) continue;

          var parentItem = poolByTaskId[parentId];
          if (!parentItem) continue;
          if (parentItem.remaining <= 0) continue;

          var parentTask = parentItem.task;

          // Compute effective start of the consumer (cur) by walking backward
          // from its mustFinishBy, then use that as the parent's mustFinishBy
          var consumerDur = curItem ? curItem.totalDur : 30;
          var parentMustFinishBy = computeEffectiveStart(curTask, consumerDur, cur.mustFinishBy);
          if (!parentMustFinishBy) parentMustFinishBy = new Date(localToday);

          // If parent has its own deadline that's tighter, use that
          if (parentItem.deadline && parentItem.deadline < parentMustFinishBy) {
            parentMustFinishBy = parentItem.deadline;
          }

          // Set faux-deadline on the parent (if it doesn't have its own hard deadline)
          var fauxDate = new Date(parentMustFinishBy);
          fauxDate.setHours(23, 59, 59, 999);

          if (!parentItem.task.deadline) {
            if (!parentItem.fauxDeadline || fauxDate < parentItem.fauxDeadline) {
              parentItem.fauxDeadline = fauxDate;
              parentItem.task._fauxDeadline = formatDateKey(fauxDate);
            }
          }

          // Compute slack for this parent
          var earliest = parentItem.earliestDate || localToday;
          if (earliest < localToday) earliest = localToday;
          var effectiveDL = parentItem.deadline || parentItem.fauxDeadline;
          if (effectiveDL) {
            var cap = availableCapacity(parentTask, parentItem, earliest, effectiveDL);
            var newSlack = Math.max(0, cap - parentItem.totalDur);
            // Take the tightest (lowest) slack from any chain
            if (parentItem._slack == null || newSlack < parentItem._slack) {
              parentItem._slack = newSlack;
            }
          }

          // Continue walking backward
          queue.push({ taskId: parentId, mustFinishBy: fauxDate });
        }
      }
    });

    // Step 3: Default slack for items without deadlines (unconstrained)
    pool.forEach(function(item) {
      if (item._slack == null) item._slack = Infinity;
    });
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

  // (Reservation helpers removed — slack-based forward placement handles
  // capacity naturally via ordering: lower-slack tasks place first.)
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
  var SPECIAL_WHEN = { allday: true, anytime: true };
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
    // Hard floor: never place before DAY_START (6 AM) unless task is explicitly fixed
    if (start < DAY_START && !locked && !t.datePinned) {
      return; // reject wee-hour placement
    }
    // Determine travel buffers — for split tasks, only first chunk gets travelBefore
    // and only last chunk gets travelAfter
    var tb = 0, ta = 0;
    var isFirstPart = !item || item._parts.length === 0;
    var isLastPart = !item || (item.remaining - dur <= 0);
    if (isFirstPart) tb = getTravelBefore(t);
    if (isLastPart) ta = getTravelAfter(t);
    // Reserve travel buffer zones in the occupancy grid.
    // Travel buffers are transitional — only reserve minutes that aren't
    // already occupied (don't double-reserve if an adjacent task abuts).
    if (tb > 0) {
      for (var tbi = Math.max(0, start - tb); tbi < start; tbi++) {
        if (!occ[tbi]) occ[tbi] = true;
      }
    }
    reserve(occ, start, dur);
    if (ta > 0) {
      for (var tai = start + dur; tai < start + dur + ta && tai < 1440; tai++) {
        if (!occ[tai]) occ[tai] = true;
      }
    }
    // Per-placement timezone: fixed/locked tasks carry their own tz (if set on the task),
    // otherwise inherit the schedule-level timezone from cfg.
    var placeTz = (t.tz && (locked || t.datePinned)) ? t.tz : (cfg.timezone || null);
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

  // For time-window mode tasks (preferred time ± flex), compute a narrow window.
  // Works for any task type — recurring or one-off. Rigid tasks are excluded
  // (they're force-placed at exact time in Phase 0).
  var DEFAULT_TIME_FLEX = 60; // minutes
  function getFlexWindows(t, dateWindows) {
    if (t.rigid) return null;

    // Use preferredTimeMins (authoritative) with fallback to parsed time string (legacy)
    var sm = t.preferredTimeMins != null ? t.preferredTimeMins : parseTimeToMinutes(t.time);
    if (sm === null) return null;

    // Time Window mode is indicated by preferredTimeMins being set.
    // Legacy fallback: check timeFlex or single when-tag.
    var isTimeWindow = t.preferredTimeMins != null;
    if (!isTimeWindow) {
      var hasExplicitFlex = t.timeFlex != null && t.timeFlex > 0;
      var when = t.when || '';
      if (when === '' && !hasExplicitFlex) return null;
      var whenParts = when.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      if (whenParts.length > 1 && !hasExplicitFlex) return null;
    }

    var flex = t.timeFlex != null ? t.timeFlex : DEFAULT_TIME_FLEX;
    if (flex <= 0) return null;
    if (flex > 480) return null;

    var lo = Math.max(DAY_START, sm - flex);
    var hi = Math.min(WALK_END, sm + flex);
    return [[lo, hi]];
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
    var scanStart = Math.max(wins[0][0], afterMin || 0, DAY_START);
    var scanLimit = (beforeMin != null && beforeMin < WALK_END) ? beforeMin : WALK_END;
    var placedAny = false;

    while (item.remaining > 0 && scanStart < scanLimit) {
      // For the first chunk, the travel-before zone must also be free
      var needTb = item._parts.length === 0 ? tb : 0;
      var effectiveScan = scanStart - needTb;
      var _myId = t.id;
      if (needTb > 0 && effectiveScan >= 0) {
        var tbBlocked = false;
        for (var tbi2 = effectiveScan; tbi2 < effectiveScan + needTb; tbi2++) {
          if (occ[tbi2] && occ[tbi2] !== _myId) { tbBlocked = true; break; }
        }
        if (tbBlocked) { scanStart++; continue; }
      }
      if (occ[scanStart] && occ[scanStart] !== _myId) { scanStart++; continue; }
      var gEnd = scanStart + 1;
      while (gEnd < scanLimit && (!occ[gEnd] || occ[gEnd] === _myId)) gEnd++;
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

  // (placeLate removed — all placement now uses forward scanning via placeEarly)

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

  // Returns total available minutes across all when-windows for a task.
  // Used as a tiebreaker: tasks with fewer available minutes are harder
  // to place, so they should be scheduled first while there's more room.
  var _whenMinutesCache = {};
  function whenAvailableMinutes(task) {
    var w = task.when || "morning,lunch,afternoon,evening,night";
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

  captureSnapshot('Phase 0: Fixed items');

  // STEP 2: Rigid recurringTasks
  dates.forEach(function(d) {
    var recurringItems = recurringByDate[d.key] || [];
    recurringItems.filter(function(t) { return t.rigid; }).forEach(function(t) {
      placeRecurring(t, d);
    });
  });

  function placeRecurring(t, d) {
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var dateBlocks_d = dayBlocks[d.key];
    var dateWindows_d = dayWindows[d.key];
    var dur = effectiveDuration(t);
    if (dur <= 0) return;
    // Default missing when to standard day windows so recurringTasks don't get "anytime" placement
    if (!t.when) t.when = 'morning,lunch,afternoon,evening,night';
    var sm = parseTimeToMinutes(t.time);
    var mask = buildLocMask(t, d.key, dateBlocks_d);

    // For recurringTasks with an explicit when-tag, derive sm from the when-window
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

    // On today, force-place rigid recurringTasks whose preferred slot overlaps with the
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
    // If still no slot found, force-place the rigid recurring in its designated
    // when-window as an overlap.  Rigid recurringTasks represent daily commitments
    // (eat breakfast, take medication) that shouldn't vanish from the schedule
    // just because a meeting conflicts.  The overlap column system will render
    // them side-by-side, and the user can resolve the conflict manually.
    if (!found) {
      var conflictSm = sm; // Use the when-window start we computed earlier
      // Reserve occupancy — even though this overlaps, we need to prevent
      // later phases from placing additional tasks in this slot.
      // The double-reservation is a minor capacity cost but prevents triple-booking.
      reserve(occ, conflictSm, dur);
      placed.push({
        task: t, start: conflictSm, dur: dur, locked: true,
        _dateKey: d.key, tz: t.tz || cfg.timezone || null,
        _conflict: true
      });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: conflictSm + dur, startMin: conflictSm };
      schedulerWarnings.push({
        type: 'recurringConflict',
        taskId: t.id,
        text: t.text,
        dateKey: d.key,
        message: 'Rigid recurring "' + t.text + '" overlaps with another task on ' + d.key + '. Consider adjusting one of them.'
      });
      // Persist _conflict flag in taskUpdates so the frontend can render
      // overlap columns even after reconstructing from DB.
      var hh2 = Math.floor(conflictSm / 60), mm2 = conflictSm % 60;
      var ampm2 = hh2 >= 12 ? "PM" : "AM";
      var dh2 = hh2 > 12 ? hh2 - 12 : (hh2 === 0 ? 12 : hh2);
      taskUpdates[t.id] = {
        date: d.key,
        time: dh2 + ":" + (mm2 < 10 ? "0" : "") + mm2 + " " + ampm2,
        tz: t.tz || cfg.timezone || null,
        _conflict: true
      };
    }
  }

  var PRI_LEVELS = ["P1", "P2", "P3", "P4"];

  captureSnapshot('Phase 0: + Rigid recurringTasks');

  var PRI_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };

  // PHASE 1: Non-rigid recurring tasks by slack (constrained-first).
  // Sort by slack across ALL priority tiers so narrow-window tasks (e.g.
  // "morning" only) place before wide-window tasks (e.g. "anytime") —
  // the anytime task can find a slot later in the day, the morning task
  // can't. Priority is a tiebreaker, not the primary grouping.
  var recurringItems = pool.filter(function(item) {
    return item.task && item.task.recurring && item.remaining > 0;
  });
  // Compute recurring slack: available capacity from earliestDate to ceiling minus duration.
  // Treat cycle end (ceiling) as the deadline for the recurring instance.
  recurringItems.forEach(function(item) {
    var start = item.earliestDate || localToday;
    if (start < localToday) start = localToday;
    var end = item.ceiling;
    if (!end) {
      item._recurSlack = Infinity; // no cycle constraint — lowest urgency
      return;
    }
    var cap = 0;
    var t = item.task;
    for (var di = 0; di < dates.length; di++) {
      var d = dates[di];
      if (d.date < start) continue;
      if (d.date > end) break;
      if (!canPlaceOnDate(t, d)) continue;
      var wins = getWhenWindows(t.when, dayWindows[d.key]);
      for (var wi = 0; wi < wins.length; wi++) {
        var occ = dayOcc[d.key];
        for (var m = wins[wi][0]; m < wins[wi][1]; m++) {
          if (!occ || !occ[m]) cap++;
        }
      }
    }
    item._recurSlack = Math.max(0, cap - item.totalDur);
  });
  recurringItems.sort(function(a, b) {
    // 1. Slack ascending — most constrained first
    var aSlack = a._recurSlack != null ? a._recurSlack : Infinity;
    var bSlack = b._recurSlack != null ? b._recurSlack : Infinity;
    if (aSlack !== bSlack) return aSlack - bSlack;
    // 2. Priority ascending as tiebreaker
    var aPri = PRI_RANK[a.task.pri || 'P3'] || 3;
    var bPri = PRI_RANK[b.task.pri || 'P3'] || 3;
    if (aPri !== bPri) return aPri - bPri;
    // 3. Narrower when-window first
    return whenAvailableMinutes(a.task) - whenAvailableMinutes(b.task);
  });
  {
    recurringItems.forEach(function(item) {
      if (item.remaining <= 0) return;
      var t = item.task;
      for (var di = 0; di < dates.length; di++) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (item.ceiling && d.date > item.ceiling) continue;
        if (!canPlaceOnDate(t, d)) continue;
        var flexWins = getFlexWindows(t, dayWindows[d.key]);
        if (flexWins) {
          var flexFree = 0;
          var _occ = dayOcc[d.key];
          for (var fi = 0; fi < flexWins.length; fi++) {
            for (var fm = flexWins[fi][0]; fm < flexWins[fi][1]; fm++) {
              if (!_occ[fm]) flexFree++;
            }
          }
          if (flexFree < item.remaining) continue;
        }
        var wins = flexWins || getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        placeEarly(item, d, 0, flexWins);
      }
    });
  }

  captureSnapshot('Phase 1: Recurring tasks');

  // ── PHASE 1.5: Recurring spacing enforcement (average-based) ──
  // Verify placed recurring instances maintain proper average spacing.
  // Target spacing: cycleDays / occurrencesPerCycle.
  // If average interval drops below 60% of target, iteratively unplace
  // the instance with the smallest gap to its neighbor.
  (function enforceRecurringSpacing() {
    var bySource = {};
    pool.forEach(function(item) {
      if (!item.task.recurring || !item.task.sourceId || item._parts.length === 0) return;
      var sid = item.task.sourceId;
      if (!bySource[sid]) bySource[sid] = [];
      bySource[sid].push(item);
    });

    Object.keys(bySource).forEach(function(sid) {
      var instances = bySource[sid];
      if (instances.length < 2) return;

      var src = allTasks.find(function(at) { return at.id === sid; });
      if (!src || !src.recur) return;
      var recType = src.recur.type || 'daily';
      if (recType === 'daily') return; // daily tasks don't need spacing enforcement

      // Compute target spacing
      var cycleDays;
      if (recType === 'weekly') cycleDays = 7;
      else if (recType === 'biweekly') cycleDays = 14;
      else if (recType === 'monthly') cycleDays = 30;
      else return;

      var tpc = (src.recur.timesPerCycle && src.recur.timesPerCycle > 0)
        ? src.recur.timesPerCycle : 1;
      var targetDays = cycleDays / tpc;
      var minAvg = targetDays * 0.6; // allow 40% compression before enforcing

      // Sort by placed date
      instances.sort(function(a, b) {
        var aDate = a._parts.length > 0 ? parseDate(a._parts[0]._dateKey) : null;
        var bDate = b._parts.length > 0 ? parseDate(b._parts[0]._dateKey) : null;
        if (!aDate || !bDate) return 0;
        return aDate - bDate;
      });

      // Compute intervals and average
      function computeAvg(items) {
        if (items.length < 2) return Infinity;
        var total = 0;
        var count = 0;
        for (var i = 1; i < items.length; i++) {
          if (items[i]._parts.length === 0 || items[i - 1]._parts.length === 0) continue;
          var d1 = parseDate(items[i - 1]._parts[0]._dateKey);
          var d2 = parseDate(items[i]._parts[0]._dateKey);
          if (!d1 || !d2) continue;
          total += Math.round((d2 - d1) / 86400000);
          count++;
        }
        return count > 0 ? total / count : Infinity;
      }

      // Iteratively unplace the instance with the smallest gap until average is acceptable
      var maxIter = instances.length;
      for (var iter = 0; iter < maxIter; iter++) {
        var placed = instances.filter(function(item) { return item._parts.length > 0; });
        if (placed.length < 2) break;
        var avg = computeAvg(placed);
        if (avg >= minAvg) break; // average is acceptable

        // Find the pair with the smallest gap
        var smallestGap = Infinity;
        var removeIdx = -1;
        for (var si = 1; si < placed.length; si++) {
          var d1 = parseDate(placed[si - 1]._parts[0]._dateKey);
          var d2 = parseDate(placed[si]._parts[0]._dateKey);
          if (!d1 || !d2) continue;
          var gap = Math.round((d2 - d1) / 86400000);
          if (gap < smallestGap) {
            smallestGap = gap;
            removeIdx = si; // unplace the later instance of the tightest pair
          }
        }
        if (removeIdx < 0) break;

        unplaceItem(placed[removeIdx]);
        placed[removeIdx].task._unplacedReason = 'spacing';
        placed[removeIdx].task._unplacedDetail = 'Average spacing (' + Math.round(avg * 10) / 10 +
          'd) below target (' + Math.round(targetDays * 10) / 10 + 'd) — removed to improve distribution';
      }
    });
  })();

  // ── PHASE 2: Slack-Based Forward Placement ──
  // See docs/SCHEDULER.md for full algorithm description.

  // Step 2a: Compute constraint-aware slack for all constrained pool items
  computeSlack();

  // Step 2a: Chain membership classification.
  // A task is a "chain member" if it has a hard deadline OR if any transitive
  // descendant (walking depends_on links DOWN, i.e. from dependent → its deps)
  // of it has a deadline. Solo tasks with a deadline but no deps and no dependents
  // are anchors without a chain — they can shift forward freely.
  var hasDeadline = {};
  var chainMemberIds = {};
  pool.forEach(function(item) {
    var t = item.task;
    if (t.deadline) hasDeadline[t.id] = true;
  });
  pool.forEach(function(item) {
    var t = item.task;
    if (!hasDeadline[t.id]) return;
    // BFS the depends_on closure starting from this anchor
    var stack = [t.id];
    while (stack.length > 0) {
      var id = stack.pop();
      if (chainMemberIds[id]) continue;
      chainMemberIds[id] = true;
      // Find the task object and walk its depends_on
      var found = pool.find(function(p) { return p.task.id === id; });
      if (!found) continue;
      getTaskDeps(found.task).forEach(function(depId) {
        if (isBackwardsDep(id, depId)) return;
        stack.push(depId);
      });
    }
  });
  // Count dependents per task so we can detect "solo anchor" (no chain deps, no dependents)
  var hasAncestorsCount = {};
  pool.forEach(function(item) {
    getTaskDeps(item.task).forEach(function(depId) {
      if (isBackwardsDep(item.task.id, depId)) return;
      hasAncestorsCount[depId] = (hasAncestorsCount[depId] || 0) + 1;
    });
  });

  // Step 2b: Categorize non-recurring pool into constrained vs unconstrained.
  var constrainedPool = [];
  var unconstrainedPool = [];
  pool.forEach(function(item) {
    var t = item.task;
    if (item.remaining <= 0 || item.task.recurring) return;
    if (item.deadline || item.fauxDeadline || item.ceiling) {
      constrainedPool.push(item);
    } else {
      unconstrainedPool.push(item);
    }
  });

  // Step 2c: Compute placement windows and handle past-due + impossible constraints
  var impossibleItems = [];
  constrainedPool.forEach(function(item) {
    var earliest = item.earliestDate || localToday;
    var latestCandidates = [];
    if (item.deadline) latestCandidates.push(item.deadline);
    if (item.fauxDeadline) latestCandidates.push(item.fauxDeadline);
    if (item.ceiling) latestCandidates.push(item.ceiling);
    var latest = latestCandidates.reduce(function(min, d) {
      return d < min ? d : min;
    }, latestCandidates[0]);

    // Past-due: task whose latest constraint is in the past.
    // Keep in constrained pool with slack=0 and P1 priority boost.
    // The overflow pass (step 2g) will place it ASAP if the normal pass can't.
    if (latest < localToday) {
      item.task._pastDue = true;
      item.task._originalDue = item.deadline ? formatDateKey(item.deadline) : null;
      item.task.pri = 'P1'; // priority boost for tie-breaking
      item._slack = 0; // most urgent
      item._pastDueOverflow = true; // flag for overflow pass
      item.earliestDate = new Date(localToday);
      item._windowEarliest = new Date(localToday);
      // Keep deadline/fauxDeadline for the normal pass attempt;
      // overflow pass will remove them if needed.
      return;
    }

    if (earliest > latest) {
      item._impossible = true;
      item.task._unplacedReason = 'impossible_window';
      item.task._unplacedDetail = 'Earliest placement (' + formatDateKey(earliest) +
        ') is after latest (' + formatDateKey(latest) + ')';
      item.task._suggestions = [{ type: 'constraint', text: 'Adjust start-after date, deadline, or dependencies' }];
      impossibleItems.push(item);
      return;
    }
    item._windowEarliest = earliest;
  });
  constrainedPool = constrainedPool.filter(function(item) { return !item._impossible; });

  // Separate split chunks from chainable items (split chunks share task IDs
  // and can't go through buildChains — they're processed separately)
  var constrainedChunks = constrainedPool.filter(function(item) { return !!item._splitChunk; });
  var constrainedNonChunks = constrainedPool.filter(function(item) { return !item._splitChunk; });

  // Step 2d: Forward placement function (used for all constrained + unconstrained tasks)
  function placeItemForward(item) {
    var t = item.task;
    var earliest = item.earliestDate || localToday;
    var effectiveDeadline = item.deadline || item.fauxDeadline;

    for (var di = 0; di < dates.length; di++) {
      if (item.remaining <= 0) break;
      var d = dates[di];
      if (d.date < localToday) continue;
      if (d.date < earliest) continue;
      if (effectiveDeadline && d.date > effectiveDeadline) continue;
      if (item.ceiling && d.date > item.ceiling) continue;
      if (!canPlaceOnDate(t, d)) continue;
      var depResult = depsMetByDate(t, d);
      if (!depResult) continue;
      var depAfter = depAfterFrom(depResult);
      var depBefore = depBeforeFrom(depResult);
      var flexWins = getFlexWindows(t, dayWindows[d.key]);
      if (flexWins) {
        var flexFree = 0;
        var _occ = dayOcc[d.key];
        for (var fi = 0; fi < flexWins.length; fi++) {
          for (var fm = flexWins[fi][0]; fm < flexWins[fi][1]; fm++) {
            if (!_occ[fm]) flexFree++;
          }
        }
        if (flexFree < item.remaining) continue;
      }
      var wins = flexWins || getWhenWindows(t.when, dayWindows[d.key]);
      if (wins.length === 0) continue;
      placeEarly(item, d, depAfter, flexWins, depBefore);
    }
  }

  // Step 2e: Slack-based forward placement — sort all constrained items by
  // slack ascending (most urgent first), then place left-to-right.
  // No multi-pass convergence needed: slack ordering ensures the most
  // constrained tasks get first pick; depsMetByDate() enforces ordering
  // at placement time.

  // Merge non-chunks and chunks into a single sorted pool
  var allConstrained = constrainedNonChunks.concat(constrainedChunks);
  allConstrained.sort(function(a, b) {
    // 1. Slack ascending (most urgent first)
    var aSlack = a._slack != null ? a._slack : Infinity;
    var bSlack = b._slack != null ? b._slack : Infinity;
    if (aSlack !== bSlack) return aSlack - bSlack;
    // 2. Priority ascending (P1 before P4)
    var aPri = PRI_RANK[a.task.pri || 'P3'] || 3;
    var bPri = PRI_RANK[b.task.pri || 'P3'] || 3;
    if (aPri !== bPri) return aPri - bPri;
    // 3. Duration descending (longer tasks harder to fit)
    if (b.totalDur !== a.totalDur) return b.totalDur - a.totalDur;
    // 4. Deterministic id
    return a.task.id < b.task.id ? -1 : (a.task.id > b.task.id ? 1 : 0);
  });

  // Main forward pass
  for (var ci = 0; ci < allConstrained.length; ci++) {
    var cItem = allConstrained[ci];
    if (cItem.remaining <= 0) continue;
    placeItemForward(cItem);
  }

  // Step 2f: Retry pass for dep-blocked items — some items may not have placed
  // because their dependencies weren't placed yet (e.g., in diamond DAGs where
  // sort order doesn't perfectly match topological order). Now that more tasks
  // are placed, retry unplaced items.
  var retryNeeded = false;
  for (var ri = 0; ri < allConstrained.length; ri++) {
    if (allConstrained[ri].remaining > 0 && allConstrained[ri]._parts.length === 0) {
      retryNeeded = true;
      break;
    }
  }
  if (retryNeeded) {
    for (var ri2 = 0; ri2 < allConstrained.length; ri2++) {
      var rItem = allConstrained[ri2];
      if (rItem.remaining <= 0 || rItem._parts.length > 0) continue;
      placeItemForward(rItem);
    }
  }

  // Step 2g: Chain rollback — if a deadline task (chain tail) couldn't fit
  // because its prerequisites consumed all available capacity, unplace all
  // chain members, then re-place in reverse dependency order (tail first).
  // This ensures deadline tasks are prioritized when capacity is tight.
  (function chainRollback() {
    var itemById = {};
    allConstrained.forEach(function(item) { itemById[item.task.id] = item; });

    // Find unplaced deadline tasks whose chain predecessors ARE placed
    var unplacedDeadlines = allConstrained.filter(function(item) {
      return item.remaining > 0 && item._parts.length === 0 && item.task.deadline;
    });

    unplacedDeadlines.forEach(function(dlItem) {
      // Collect all chain members (including the tail)
      var chainMembers = [];
      var visited = {};
      var stack = [dlItem.task.id];
      while (stack.length > 0) {
        var id = stack.pop();
        if (visited[id]) continue;
        visited[id] = true;
        var found = itemById[id];
        if (!found) continue;
        chainMembers.push(found);
        var foundDeps = getTaskDeps(found.task);
        for (var fdi = 0; fdi < foundDeps.length; fdi++) {
          if (!isBackwardsDep(found.task.id, foundDeps[fdi])) {
            stack.push(foundDeps[fdi]);
          }
        }
      }

      // Only rollback if at least one predecessor is placed
      var hasPlacedPred = false;
      for (var ci = 0; ci < chainMembers.length; ci++) {
        if (chainMembers[ci] !== dlItem && chainMembers[ci]._parts.length > 0) {
          hasPlacedPred = true;
          break;
        }
      }
      if (!hasPlacedPred) return;

      // Topologically sort chain members (prereqs first, tail last)
      var chainTasks = chainMembers.map(function(item) { return item.task; });
      var sorted = topoSortTasks(chainTasks);
      var topoIdx = {};
      sorted.forEach(function(t, idx) { topoIdx[t.id] = idx; });

      // Unplace all chain members
      chainMembers.forEach(function(item) {
        if (item._parts.length > 0) unplaceItem(item);
      });

      // Temporarily hide chain members from poolIds so depsMetByDate
      // doesn't block on unplaced chain siblings
      var hiddenIds = {};
      chainMembers.forEach(function(item) {
        if (poolIds[item.task.id]) {
          hiddenIds[item.task.id] = true;
          delete poolIds[item.task.id];
        }
      });

      // Re-place in reverse topo order (tail first, head last).
      // The tail can now place without being blocked by unplaced deps
      // (they're hidden from poolIds). Each predecessor places after
      // the tail and checks that placed descendants have room.
      var reverseOrder = chainMembers.slice().sort(function(a, b) {
        var ai = topoIdx[a.task.id] != null ? topoIdx[a.task.id] : 0;
        var bi = topoIdx[b.task.id] != null ? topoIdx[b.task.id] : 0;
        return bi - ai; // reverse topo = tail first
      });

      for (var rci = 0; rci < reverseOrder.length; rci++) {
        var item = reverseOrder[rci];
        // Restore this item to poolIds before placing so ITS deps can see it
        if (hiddenIds[item.task.id]) {
          poolIds[item.task.id] = true;
          delete hiddenIds[item.task.id];
        }
        if (item.remaining > 0) {
          placeItemForward(item);
        }
      }

      // Restore any remaining hidden IDs (shouldn't happen, but safety)
      Object.keys(hiddenIds).forEach(function(id) { poolIds[id] = true; });
    });
  })();

  // Step 2i: Past-due overflow — tasks that couldn't fit within their (expired)
  // deadline window get placed ASAP with the deadline ceiling removed.
  // Rule 1: One-off past-due tasks also get their when-constraint relaxed
  // so they can fit in any available time window.
  for (var oi = 0; oi < allConstrained.length; oi++) {
    var oItem = allConstrained[oi];
    if (oItem.remaining <= 0 || oItem._parts.length > 0) continue;
    if (oItem._pastDueOverflow || oItem.task._pastDue) {
      var savedDL = oItem.deadline;
      oItem.deadline = null;
      oItem.fauxDeadline = null;
      oItem.ceiling = null;
      oItem.task._pastDue = true;
      if (!oItem.task._originalDue && savedDL) {
        oItem.task._originalDue = formatDateKey(savedDL);
      }
      // Keep original when/where constraints — the user chose them.
      // If the task can't fit, it goes to the issues log for the user to decide.
      placeItemForward(oItem);
    }
  }

  captureSnapshot('Phase 2: Slack-based forward placement');

  // Step 2j: Mark remaining unplaced constrained tasks with reason
  for (var mi = 0; mi < allConstrained.length; mi++) {
    var mItem = allConstrained[mi];
    if (mItem.remaining > 0 && mItem._parts.length === 0) {
      if (!mItem.task._unplacedReason) {
        if (mItem.task._pastDue) {
          mItem.task._unplacedReason = 'past_due_no_capacity';
          mItem.task._unplacedDetail = 'Past-due task could not be placed — no available capacity';
          mItem.task._suggestions = [{ type: 'constraint', text: 'Clear conflicting tasks or mark as done/skip' }];
        } else {
          mItem.task._unplacedReason = 'capacity_conflict';
          mItem.task._unplacedDetail = 'Could not fit within available capacity before deadline';
          mItem.task._suggestions = [{ type: 'constraint', text: 'Reduce duration, extend deadline, or clear conflicting tasks' }];
        }
      }
    }
  }

  // ── PHASE 3: Fill unconstrained tasks by priority ──
  // No chain grouping — each task competes at its OWN priority level.
  // Dependencies are resolved via depsMetByDate at placement time.
  // Multi-pass iteration handles cross-priority deps (e.g., P1 child
  // waiting for P3 parent to be placed in a later tier).

  // Sort all unconstrained items by priority, then by tighter when-windows
  unconstrainedPool.sort(function(a, b) {
    var aPri = PRI_RANK[a.task.pri || 'P3'] || 3;
    var bPri = PRI_RANK[b.task.pri || 'P3'] || 3;
    if (aPri !== bPri) return aPri - bPri;
    return whenAvailableMinutes(a.task) - whenAvailableMinutes(b.task);
  });

  var maxPhase3Passes = 5;
  for (var phase3Pass = 0; phase3Pass < maxPhase3Passes; phase3Pass++) {
    var phase3Progress = false;
    for (var ui = 0; ui < unconstrainedPool.length; ui++) {
      var uItem = unconstrainedPool[ui];
      if (uItem.remaining <= 0) continue;
      if (uItem._parts.length > 0) continue; // already partially placed
      placeItemForward(uItem);
      if (uItem._parts.length > 0) phase3Progress = true;
    }
    if (!phase3Progress) break;
  }

  captureSnapshot('Phase 3: Unconstrained fill');

  // ── PHASE 4: Relaxation — unplaced items with flexWhen retry with 'anytime' windows ──
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
      for (var ri = partsBeforeRelax; ri < item._parts.length; ri++) {
        item._parts[ri]._whenRelaxed = true;
      }
    });
  });

  // ── PHASE 5: Recurring rescue — bump non-recurring tasks to make room ──
  var unplacedRecurrings = pool.filter(function(item) {
    return item.task.recurring && item.remaining > 0 && item._parts.length === 0;
  });
  unplacedRecurrings.forEach(function(hItem) {
    var td = parseDate(hItem.task.date);
    if (!td) return;
    var dayKey = formatDateKey(td);
    var d = getDateObj(dayKey);
    if (!d) return;

    var recurringLoc = hItem.task.location || [];
    var candidates = [];
    pool.forEach(function(pItem) {
      if (pItem.task.recurring) return;
      if (pItem.deadline) return;
      if (pItem._parts.length === 0) return;
      var onDay = pItem._parts.filter(function(p) { return p._dateKey === dayKey && !p.locked; });
      if (onDay.length === 0) return;
      var locOverlap = recurringLoc.length === 0;
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
    candidates.sort(function(a, b) {
      if (a._locOverlap !== b._locOverlap) return a._locOverlap ? -1 : 1;
      var ap = (a.task.pri || "P3"); var bp = (b.task.pri || "P3");
      if (ap !== bp) return ap > bp ? -1 : 1;
      return (b.totalDur || 0) - (a.totalDur || 0);
    });

    var bumpedStack = [];
    var recurringPlaced = false;
    for (var ci = 0; ci < candidates.length && !recurringPlaced; ci++) {
      var bumpItem = candidates[ci];
      var savedParts = bumpItem._parts.slice();
      var savedRemaining = bumpItem.remaining;
      var savedUpdates = taskUpdates[bumpItem.task.id];
      var savedEnd = globalPlacedEnd[bumpItem.task.id];
      bumpedStack.push({ item: bumpItem, savedParts: savedParts, savedRemaining: savedRemaining, savedUpdates: savedUpdates, savedEnd: savedEnd });

      unplaceItem(bumpItem);

      var flexWins = getFlexWindows(hItem.task, dayWindows[dayKey]);
      placeEarly(hItem, d, 0, flexWins);
      if (hItem.remaining > 0) {
        var rescueWins = getWhenWindows(hItem.task.when, dayWindows[dayKey]);
        if (rescueWins.length > 0) placeEarly(hItem, d, 0, rescueWins);
      }

      if (hItem.remaining <= 0) {
        var allReplace = true;
        for (var ri = 0; ri < bumpedStack.length; ri++) {
          var rb = bumpedStack[ri].item;
          if (rb.remaining <= 0) continue;
          for (var di2 = 0; di2 < dates.length; di2++) {
            if (rb.remaining <= 0) break;
            var rd = dates[di2];
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
          recurringPlaced = true;
        } else {
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
    }
    if (!recurringPlaced && bumpedStack.length > 0) {
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
  // POST-PROCESSING: Merge consecutive same-task split chunks on each day
  dates.forEach(function(d) {
    var placed = dayPlaced[d.key];
    if (!placed || placed.length < 2) return;
    placed.sort(function(a, b) { return a.start - b.start; });

    var merged = [];
    var i = 0;
    while (i < placed.length) {
      var curr = placed[i];
      // Check if next placement is the same task and immediately adjacent
      while (i + 1 < placed.length) {
        var next = placed[i + 1];
        if (next.task && curr.task && next.task.id === curr.task.id &&
            next.start === curr.start + curr.dur) {
          // Merge: extend current placement
          curr.dur += next.dur;
          // Remove next from placed array
          placed.splice(i + 1, 1);
        } else {
          break;
        }
      }
      merged.push(curr);
      i++;
    }
    dayPlaced[d.key] = merged;
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
      if (t.deadline) reasons.push('deadline ' + t.deadline);
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
  // First, aggregate unplaced split chunks by task ID
  var unplacedChunksByTask = {};
  pool.forEach(function(item) {
    if (item.remaining > 0 && item._parts.length === 0 && item._splitChunk) {
      var tid = item.task.id;
      if (!unplacedChunksByTask[tid]) unplacedChunksByTask[tid] = { count: 0, totalMins: 0, parentDur: item._splitParentDur || 0 };
      unplacedChunksByTask[tid].count++;
      unplacedChunksByTask[tid].totalMins += item.totalDur;
    }
  });

  var unplaced = [];
  var seenUnplacedSplit = {};
  pool.forEach(function(item) {
    // Fully unplaced OR partially placed splittable task with remaining minutes
    var fullyUnplaced = item.remaining > 0 && item._parts.length === 0;
    var partialSplit = item.remaining > 0 && item._parts.length > 0 && item.splittable;
    if (fullyUnplaced || partialSplit) {
      var t = item.task;

      // For split chunks or partially placed split tasks, report as partial_split
      if (item._splitChunk || partialSplit) {
        if (seenUnplacedSplit[t.id]) return;
        seenUnplacedSplit[t.id] = true;
        var placedMins = item.totalDur - item.remaining;
        t._unplacedReason = 'partial_split';
        t._unplacedDetail = item.remaining + ' of ' + item.totalDur + ' minutes could not be scheduled (' + placedMins + 'm placed)';
        t._suggestions = [{ type: 'split', text: 'Reduce duration, spread across more days, or clear other tasks' }];
      } else {
        t._unplacedReason = item.deadline ? "deadline" : "no-capacity";
      }

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

      // --- Infeasible chain analysis ---
      // Walk the full dependency chain to compute total duration.  If the
      // chain's aggregate work exceeds available time before the final
      // deadline, surface a specific diagnostic instead of generic "no-capacity".
      if (item.deadline) {
        var chainDur = item.totalDur;
        var visited = {};
        var walkChain = function(tid) {
          if (visited[tid]) return;
          visited[tid] = true;
          var children = dependedOnBy[tid] || [];
          for (var ci2 = 0; ci2 < children.length; ci2++) {
            var cid = children[ci2];
            var ct = taskById[cid];
            if (ct) { chainDur += effectiveDuration(ct); walkChain(cid); }
          }
        };
        walkChain(t.id);

        var daysToDeadline = Math.max(1, Math.round((item.deadline - localToday) / 86400000) + 1);
        var estCapacity = daysToDeadline * 480; // ~8h usable per day
        if (chainDur > estCapacity) {
          t._unplacedReason = "chain_infeasible";
          detail.push("Dependency chain needs " + chainDur + "m but only ~" + estCapacity + "m available before deadline");
          suggestions.push({
            type: 'chainInfeasible',
            text: 'Dependency chain is too long for the deadline — extend the deadline, reduce task durations, or remove dependencies'
          });
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
            suggestions.push({ type: 'enableSplit', text: 'Enable splitting (min 30m chunks' + (t.recurring ? ', all days' : '') + ') — largest gap is ' + maxGap + 'm but task needs ' + item.remaining + 'm', action: 'split' });
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
              suggestions.push({ type: 'enableSplit', text: 'Enable splitting (min 30m chunks' + (t.recurring ? ', all days' : '') + ') to use ' + totalFreeMin + 'm of fragmented free time', action: 'split' });
            } else if (hasLocationConflict) {
              suggestions.push({ type: 'locationPartial', text: 'Some time in ' + whenLabel2 + ' is at the wrong location for this task — adjust the time window or location' });
            } else {
              suggestions.push({ type: 'fragmented', text: 'Free time is too fragmented — try freeing up a larger block or enable splitting (min 30m chunks' + (t.recurring ? ', all days' : '') + ')', action: 'split' });
            }
          }
        }
      }

      t._unplacedDetail = detail.join(" \u00B7 ");
      t._suggestions = suggestions;
      unplaced.push(t);
    }
  });

  // Merge missed recurringTasks into unplaced
  missedRecurrings.forEach(function(t) { unplaced.push(t); });

  var placedCount = Object.keys(taskUpdates).length;
  var deadlineMisses = unplaced.filter(function(t) { return t._unplacedReason === "deadline"; });
  var greedyMs = Math.round(Date.now() - PERF);

  // Score the greedy+resort result
  var scoreOpts = { todayKey: effectiveTodayKey };
  var score = scoreSchedule(dayPlacements, unplaced, allTasks, scoreOpts);
  var greedyScore = score.total;

  captureSnapshot('Phase 4: Recurring rescue');

  var totalMs = Math.round(Date.now() - PERF);

  // Rebuild taskUpdates from final placements so they reflect the actual
  // positions after all phases.
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
      var rebuildTz = p.tz || (p.task.tz && (p.locked || p.task.datePinned)) ? (p.tz || p.task.tz) : (cfg.timezone || null);
      taskUpdates[tid] = { date: dk, time: dh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm, tz: rebuildTz, _startMin: p.start };
    });
  });
  // Strip the internal _startMin field
  Object.keys(taskUpdates).forEach(function(tid) { delete taskUpdates[tid]._startMin; });
  // Strip changes from fixed tasks
  allTasks.forEach(function(ft) {
    if (ft.datePinned && taskUpdates[ft.id]) delete taskUpdates[ft.id];
  });

  // Re-annotate move reasons from final placements
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
      if (t.deadline) reasons.push('deadline ' + t.deadline);
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

  // ── Annotate placement reasons ──
  // Generate a short human-readable explanation for every placed task
  // so users understand WHY the scheduler chose this specific time.
  var whenLabels = { morning: 'Morning', lunch: 'Lunch', afternoon: 'Afternoon', evening: 'Evening', night: 'Night', biz: 'Business hours' };
  function whenLabel(tag) {
    if (!tag) return '';
    var parts = tag.split(',').map(function(p) { return whenLabels[p.trim()] || p.trim(); });
    return parts.join('/');
  }
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(part) {
      if (!part.task) return;
      var t = part.task;

      // 1. Fixed calendar event
      if (part.locked && t.datePinned) {
        part._placementReason = 'Fixed calendar event';
        return;
      }

      // 2. Rigid recurring
      if (part.locked && t.rigid && t.recurring) {
        var block = whenLabel(t.when) || 'scheduled';
        part._placementReason = 'Rigid recurring \u2014 ' + block + ' block';
        if (part._conflict) part._placementReason += ' (overlap \u2014 consider rescheduling one)';
        return;
      }

      // 3. Marker
      if (part.marker) {
        part._placementReason = 'Marker \u2014 non-blocking';
        return;
      }

      // 4. Has a _moveReason — that IS the reason (already well-formatted)
      if (part._moveReason) {
        part._placementReason = part._moveReason;
        return;
      }

      // Build reason from task constraints
      var reasons = [];

      // 5. Dependencies
      var deps = getTaskDeps(t);
      if (deps.length > 0) {
        var depNames = deps.slice(0, 2).map(function(did) {
          var dt = taskByIdMap[did];
          return dt ? '\u201C' + dt.text.substring(0, 25) + '\u201D' : did;
        });
        reasons.push('After ' + depNames.join(', '));
      }

      // 6. Deadline
      if (t.deadline) {
        var pri = t.pri || 'P3';
        reasons.push(pri + ' deadline due ' + t.deadline);
      }

      // 7. When-window constraint
      if (t.when && t.when !== '' && !t.datePinned) {
        var wl = whenLabel(t.when);
        if (wl && !t.when.includes(',') || (t.when.split(',').length <= 2)) {
          reasons.push(wl + ' block');
        }
      }

      // 8. Tool/location constraint
      if (t.tools && t.tools.length > 0) {
        reasons.push('Needs ' + t.tools.join(', '));
      }

      // 9. When-relaxed
      if (part._whenRelaxed) {
        reasons.push('Preferred blocks full \u2014 placed in next available');
      }

      // 10. Split part
      if (part.splitPart) {
        reasons.push('Part ' + part.splitPart + '/' + part.splitTotal);
      }

      // 11. Default
      if (reasons.length === 0) {
        var pri2 = t.pri || 'P3';
        if (t.recurring) {
          reasons.push('Flexible recurring \u2014 best available slot');
        } else {
          reasons.push('Best available slot \u2014 ' + pri2);
        }
      }

      part._placementReason = reasons.join(' \u00B7 ');
    });
  });

  if (schedulerWarnings.length > 0) {
    console.log("[SCHED] " + schedulerWarnings.length + " warning(s): " + schedulerWarnings.map(function(w) { return w.type + '(' + (w.taskId || w.taskA) + ')'; }).join(', '));
  }
  console.log("[SCHED] unified: " + dates.length + " days, " + pool.length + " pool, " + placedCount + " placed, " + unplaced.length + " unplaced | " + totalMs + "ms (score=" + Math.round(score.total) + ")");
  captureSnapshot('Final');

  // Compute spacing stats for tpc recurringTasks
  var spacingStats = [];
  var placedBySource = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    dayPlacements[dk].forEach(function(t) {
      if (t.sourceId && t.recur && t.recur.timesPerCycle > 0) {
        if (!placedBySource[t.sourceId]) placedBySource[t.sourceId] = [];
        placedBySource[t.sourceId].push({ date: parseDate(dk), key: dk, text: t.text });
      }
    });
  });
  Object.keys(placedBySource).forEach(function(sid) {
    var instances = placedBySource[sid].sort(function(a, b) { return a.date - b.date; });
    if (instances.length < 2) return;
    var src = allTasks.find(function(t) { return t.id === sid; });
    if (!src || !src.recur) return;
    var cycleDays = src.recur.type === 'biweekly' ? 14 : 7;
    var targetDays = cycleDays / (src.recur.timesPerCycle || 1);
    var intervals = [];
    for (var si = 1; si < instances.length; si++) {
      intervals.push(Math.round((instances[si].date.getTime() - instances[si-1].date.getTime()) / 86400000));
    }
    var avgDays = intervals.reduce(function(s,v) { return s+v; }, 0) / intervals.length;
    spacingStats.push({
      sourceId: sid,
      text: instances[0].text,
      targetDays: targetDays,
      actualAvgDays: Math.round(avgDays * 10) / 10,
      instanceCount: instances.length,
      label: '~every ' + targetDays + ' days (avg ' + (Math.round(avgDays * 10) / 10) + 'd)'
    });
  });

  var result = { dayPlacements: dayPlacements, taskUpdates: taskUpdates, newStatuses: newSt, unplaced: unplaced, deadlineMisses: deadlineMisses, placedCount: placedCount, score: score, warnings: schedulerWarnings, timezone: cfg.timezone || null, spacingStats: spacingStats };
  if (debugMode) result.phaseSnapshots = phaseSnapshots;
  return result;
}

module.exports = unifiedSchedule;
