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
var getWhenWindows = timeBlockHelpers.getWhenWindows;
var locationHelpers = require('./locationHelpers');
var resolveLocationId = locationHelpers.resolveLocationId;
var canTaskRun = locationHelpers.canTaskRun;
var dependencyHelpers = require('./dependencyHelpers');
var getTaskDeps = dependencyHelpers.getTaskDeps;
var scoreSchedule = require('./scoreSchedule');
var hillClimb = require('./hillClimb');

function effectiveDuration(t) {
  var rd = t.timeRemaining != null ? t.timeRemaining : t.dur;
  return rd === 0 ? 0 : Math.min(rd || 30, 720);
}

function unifiedSchedule(allTasks, statuses, effectiveTodayKey, nowMins, cfg) {
  var PERF = Date.now();

  var MIN_CHUNK = cfg.splitMinDefault || 15;
  var WALK_END = 23 * 60;
  var DAY_START = GRID_START * 60;
  var DAY_END = GRID_END * 60 + 59;
  var newSt = Object.assign({}, statuses);
  var taskUpdates = {};

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

  // Build habit template lookup so instances inherit current template fields.
  // Instances may have stale values from when they were generated; the template
  // represents the user's current intent for the habit.
  var habitTemplates = {};
  allTasks.forEach(function(t) {
    if (t.id && t.id.indexOf("ht_") === 0 && t.habit) {
      habitTemplates[t.text] = t;
    }
  });
  var HABIT_INHERIT_FIELDS = ["location", "when", "where", "tools", "rigid", "split", "pri", "dayReq", "timeFlex"];
  allTasks.forEach(function(t) {
    if (t.habit && t.id && t.id.indexOf("dh") === 0 && habitTemplates[t.text]) {
      var tmpl = habitTemplates[t.text];
      HABIT_INHERIT_FIELDS.forEach(function(f) {
        if (tmpl[f] !== undefined) t[f] = tmpl[f];
      });
    }
  });

  // Categorize tasks
  var habitsByDate = {};
  var fixedByDate = {};
  var pool = [];

  allTasks.forEach(function(t) {
    var st = newSt[t.id] || "";
    if (st === "done" || st === "cancel" || st === "skip") return;
    if (!t.date || t.date === "TBD") return;
    if (hasWhen(t.when, "allday")) return; // All-day events don't go on the time grid
    if (t.section && (t.section.includes("PARKING") || t.section.includes("TO BE SCHEDULED"))) return;
    var td = parseDate(t.date);
    if (!td) return;
    var effectiveDur = effectiveDuration(t);
    if (effectiveDur <= 0) return;

    var sm = parseTimeToMinutes(t.time);
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
    // Non-rigid habits on past days: drop them (missed day = missed day).
    // Only today's and future habits enter the pool.
    if (t.habit && isPast && tdKey !== effectiveTodayKey) return;

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
      // Habits are day-specific: pin them to their date (floor + ceiling).
      // If they can't fit on their day, they go unplaced (missed).
      if (t.habit && td) {
        if (!earliest || td > earliest) earliest = td;
        ceiling = td;
      }
      var deadline = t.due ? parseDate(t.due) : null;
      if (deadline) deadline.setHours(23, 59, 59, 999);

      pool.push({
        task: t, remaining: effectiveDur, totalDur: effectiveDur,
        earliestDate: earliest, deadline: deadline, ceiling: ceiling,
        splittable: t.habit ? false : !!t.split,
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

  function computeDownstreamCeiling(taskId, visited) {
    if (visited[taskId]) return null;
    visited[taskId] = true;
    var children = dependedOnBy[taskId] || [];
    var earliest = null;
    for (var ci = 0; ci < children.length; ci++) {
      var childId = children[ci];
      var childTask = null;
      for (var ti = 0; ti < allTasks.length; ti++) {
        if (allTasks[ti].id === childId) { childTask = allTasks[ti]; break; }
      }
      if (!childTask) continue;
      var childSt = newSt[childId] || '';
      if (childSt === 'done' || childSt === 'cancel' || childSt === 'skip') continue;
      var childDate = parseDate(childTask.date);
      if (childDate && (!earliest || childDate < earliest)) earliest = childDate;
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
      taskUpdates[t.id] = { date: dateKey, time: dh + ":" + (mm < 10 ? "0" : "") + mm + " " + ampm };
    }
    return part;
  }

  function canPlaceOnDate(t, d) {
    if (t.dayReq && t.dayReq !== "any") {
      if (t.dayReq === "weekday" && !d.isWeekday) return false;
      if (t.dayReq === "weekend" && d.isWeekday) return false;
      var dm = { M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, Su: 0, S: 6 };
      if (dm[t.dayReq] !== undefined && dm[t.dayReq] !== d.dow) return false;
    }
    return true;
  }

  function depsMetByDate(t, d) {
    var ok = true;
    getTaskDeps(t).forEach(function(depId) {
      var info = globalPlacedEnd[depId];
      if (info) {
        var depDate = parseDate(info.dateKey);
        if (depDate > d.date) ok = false;
      } else if (poolIds[depId]) {
        ok = false;
      }
    });
    return ok;
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
  function placeEarly(item, d, afterMin, whenOverride) {
    var t = item.task;
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    // whenOverride can be an array of windows or a string
    var wins = Array.isArray(whenOverride) ? whenOverride : getWhenWindows(whenOverride || t.when, dayWindows[d.key]);
    if (wins.length === 0) return false;
    var scanStart = Math.max(wins[0][0], afterMin || 0);
    var placedAny = false;

    while (item.remaining > 0 && scanStart < WALK_END) {
      if (occ[scanStart]) { scanStart++; continue; }
      var gEnd = scanStart + 1;
      while (gEnd < WALK_END && !occ[gEnd]) gEnd++;
      var gapSize = gEnd - scanStart;

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

      var locId = resolveLocationId(d.key, scanStart, cfg, dayBlocks[d.key]);
      if (!canTaskRun(t, locId, cfg.toolMatrix)) { scanStart = Math.floor(scanStart / 15) * 15 + 15; continue; }

      if (!item.splittable && gapSize < item.remaining) { scanStart = gEnd; continue; }
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

      if (item.splittable && item.remaining - placeLen > 0 && item.remaining - placeLen < item.minChunk) {
        if (maxPlace >= item.remaining) {
          placeLen = item.remaining; // extend to consume all remaining
        } else {
          // Shrink current chunk to leave at least minChunk for next gap
          var shrunk = item.remaining - item.minChunk;
          if (shrunk >= item.minChunk) placeLen = shrunk;
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
  function placeLate(item, d, beforeMin, whenOverride) {
    var t = item.task;
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var wins = Array.isArray(whenOverride) ? whenOverride : getWhenWindows(whenOverride || t.when, dayWindows[d.key]);
    if (wins.length === 0) return false;
    var maxEnd = beforeMin || WALK_END;

    var chunks = [];
    var needed = item.remaining;

    for (var wi = wins.length - 1; wi >= 0 && needed > 0; wi--) {
      var wStart = wins[wi][0];
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
                if (shrunk2 >= item.minChunk) take = shrunk2;
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

  function whenOptionCount(task) {
    var w = task.when || "morning,lunch,afternoon,evening";
    return w.split(",").length;
  }

  // STEP 1: Fixed items
  dates.forEach(function(d) {
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var fixedTasks = fixedByDate[d.key] || [];
    fixedTasks.forEach(function(t) {
      var sm = parseTimeToMinutes(t.time);
      if (sm === null) return;
      var dur = effectiveDuration(t);
      if (dur <= 0) return;
      sm = Math.max(DAY_START, Math.min(sm, GRID_END * 60));
      reserve(occ, sm, dur);
      placed.push({ task: t, start: sm, dur: dur, locked: true, _dateKey: d.key });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur };
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
    var sm = parseTimeToMinutes(t.time);
    var mask = buildLocMask(t, d.key, dateBlocks_d);

    if (sm === null) {
      var hw = getWhenWindows(t.when, dateWindows_d, "morning")[0];
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
      placed.push({ task: t, start: placeSm, dur: dur, locked: true, _dateKey: d.key });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: placeSm + dur };
      return;
    }

    var locOk = true;
    for (var hm = sm; hm < sm + dur; hm++) { if (mask[hm]) { locOk = false; break; } }
    if (whenOk && locOk && isFree(occ, sm, dur)) {
      reserve(occ, sm, dur);
      placed.push({ task: t, start: sm, dur: dur, locked: true, _dateKey: d.key });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur };
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
          placed.push({ task: t, start: s, dur: dur, locked: true, _dateKey: d.key });
          globalPlacedEnd[t.id] = { dateKey: d.key, endMin: s + dur };
          found = true; break;
        }
      }
      if (!found) {
        for (var s2 = scanFrom - 15; s2 >= winStart; s2 -= 15) {
          var ok2 = true;
          for (var cm2 = s2; cm2 < s2 + dur; cm2++) { if (occ[cm2] || mask[cm2]) { ok2 = false; break; } }
          if (ok2) {
            reserve(occ, s2, dur);
            placed.push({ task: t, start: s2, dur: dur, locked: true, _dateKey: d.key });
            globalPlacedEnd[t.id] = { dateKey: d.key, endMin: s2 + dur };
            found = true; break;
          }
        }
      }
    }
    // If no slot was found, do NOT force-place (which creates overlaps).
    // The task will remain unplaced for this day.
  }

  var PRI_LEVELS = ["P1", "P2", "P3", "P4"];

  // PHASE 0.5: Place non-rigid habits first — daily commitments get priority
  // over deadline tasks so a deadline doesn't steal a habit's preferred slot.
  PRI_LEVELS.forEach(function(priLevel) {
    var habitItems = pool.filter(function(item) {
      return item.task.habit && item.remaining > 0 && (item.task.pri || "P3") === priLevel;
    });
    habitItems.sort(function(a, b) {
      var aDate = parseDate(a.task.date) || localToday;
      var bDate = parseDate(b.task.date) || localToday;
      return aDate - bDate;
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
        var wins = flexWins || getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        placeEarly(item, d, 0, flexWins);
      }
    });
  });

  // PHASE 1: Deadline late-placement (P1 first)
  // Guarantee deadline tasks a spot at/before their deadline before anything
  // else flexible fills the calendar.

  PRI_LEVELS.forEach(function(priLevel) {
    // Late-place deadline tasks at/before their deadline
    var deadlineItems = pool.filter(function(item) {
      return item.deadline && item.remaining > 0 && (item.task.pri || "P3") === priLevel;
    });
    deadlineItems.sort(function(a, b) {
      var dd = a.deadline - b.deadline;
      if (dd !== 0) return dd;
      return whenOptionCount(a.task) - whenOptionCount(b.task);
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

        var placed2 = false;
        for (var di = dates.length - 1; di >= 0; di--) {
          var d = dates[di];
          if (d.date > targetDate) continue;
          if (d.date < localToday) break;
          if (!canPlaceOnDate(cItem.task, d)) continue;
          var wins = getWhenWindows(cItem.task.when, dayWindows[d.key]);
          if (wins.length === 0) continue;

          var beforeMin2 = WALK_END;
          if (nextBeforeDate && d.date.getTime() === nextBeforeDate.getTime() && nextBeforeMin != null) {
            beforeMin2 = nextBeforeMin;
          }

          if (placeLate(cItem, d, beforeMin2)) {
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
  });

  // Track which tasks have been placed (shared across phases)
  var placeVisited = {};
  // Mark habits placed in Phase 0.5 so Phase 2 won't re-process them
  pool.forEach(function(item) {
    if (item.task.habit) placeVisited[item.task.id] = true;
  });

  // PHASE 1.5: Past-deadline tasks — deadline already passed, place from today forward
  PRI_LEVELS.forEach(function(priLevel) {
    pool.filter(function(item) {
      return item.deadline && item.remaining > 0 && item._parts.length === 0 && (item.task.pri || "P3") === priLevel;
    }).forEach(function(item) {
      placeVisited[item.task.id] = true; // Prevent Phase 2 from re-processing
      for (var di = 0; di < dates.length; di++) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (d.date < localToday) continue;
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (item.ceiling && d.date > item.ceiling) continue;
        if (!canPlaceOnDate(item.task, d)) continue;
        if (!depsMetByDate(item.task, d)) continue;
        var wins = getWhenWindows(item.task.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        placeEarly(item, d);
      }
    });
  });

  // PHASE 2: Non-deadline flexible tasks (P1 first)
  // These lock into place before deadline pull-forward happens.

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
    var hasDownstreamCeiling = item.ceiling && !item.deadline && !t.datePinned && !t.generated && !t.habit;
    if (hasDownstreamCeiling) {
      // Try late-placement near the ceiling first
      for (var di = dates.length - 1; di >= 0; di--) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (d.date > item.ceiling) continue;
        if (d.date < localToday) break;
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (!canPlaceOnDate(t, d)) continue;
        if (!depsMetByDate(t, d)) continue;
        var wins = getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        if (placeLate(item, d)) break;
      }
      // Fallback: if late-placement failed, try early placement (better placed early than unplaced)
      if (item.remaining > 0 && item._parts.length === 0) {
        for (var di2 = 0; di2 < dates.length; di2++) {
          if (item.remaining <= 0) break;
          var d2 = dates[di2];
          if (item.earliestDate && d2.date < item.earliestDate) continue;
          if (!canPlaceOnDate(t, d2)) continue;
          if (!depsMetByDate(t, d2)) continue;
          var wins2 = getWhenWindows(t.when, dayWindows[d2.key]);
          if (wins2.length === 0) continue;
          placeEarly(item, d2);
        }
      }
      return;
    }

    for (var di = 0; di < dates.length; di++) {
      if (item.remaining <= 0) break;
      var d = dates[di];
      if (item.earliestDate && d.date < item.earliestDate) continue;
      if (item.ceiling && d.date > item.ceiling) continue;
      if (!canPlaceOnDate(t, d)) continue;
      if (!depsMetByDate(t, d)) continue;
      var flexWins = getHabitFlexWindows(t, dayWindows[d.key]);
      var wins = flexWins || getWhenWindows(t.when, dayWindows[d.key]);
      if (wins.length === 0) continue;
      placeEarly(item, d, 0, flexWins);
    }
  }

  // Phase 2: Non-habit, non-deadline flexible tasks (P1→P4).
  // Habits were already placed in Phase 0.5.
  PRI_LEVELS.forEach(function(priLevel) {
    var items = pool.filter(function(item) {
      return !item.deadline && item.remaining > 0 && (item.task.pri || "P3") === priLevel;
    });
    items.sort(function(a, b) {
      var aDate = a.task.datePinned ? (parseDate(a.task.date) || localToday) : localToday;
      var bDate = b.task.datePinned ? (parseDate(b.task.date) || localToday) : localToday;
      var dd = aDate - bDate;
      if (dd !== 0) return dd;
      return whenOptionCount(a.task) - whenOptionCount(b.task);
    });
    items.forEach(function(item) { placeWithDeps(item); });
  });

  // PHASE 3: Pull deadline tasks forward into remaining gaps
  // Flexible tasks are already locked in. Pull forward earliest-first within
  // each priority level so higher-priority deadlines get the best gaps.
  PRI_LEVELS.forEach(function(priLevel) {
    var pullItems = pool.filter(function(item) {
      return item.deadline && item.deadline >= localToday && item._parts.length > 0 && (item.task.pri || "P3") === priLevel;
    });
    pullItems.sort(function(a, b) {
      // Earliest placement first — pull the soonest-due items forward first
      var aDate = parseDate(a._parts[0]._dateKey);
      var bDate = parseDate(b._parts[0]._dateKey);
      var dd = aDate - bDate;
      if (dd !== 0) return dd;
      return whenOptionCount(a.task) - whenOptionCount(b.task);
    });

    pullItems.forEach(function(item) {
      var t = item.task;
      var dueDate = item.deadline;

      var pullFloor = new Date(localToday);
      if (t.startAfter) {
        var saDate = parseDate(t.startAfter);
        if (saDate && saDate > pullFloor) pullFloor = saDate;
      }

      var savedParts = item._parts.slice();
      var savedDateKey = savedParts.length > 0 ? savedParts[0]._dateKey : null;
      unplaceItem(item);

      for (var di = 0; di < dates.length; di++) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (d.date < pullFloor) continue;
        if (d.date > dueDate) break;
        if (!canPlaceOnDate(t, d)) continue;
        if (!depsMetByDate(t, d)) continue;
        var wins = getWhenWindows(t.when, dayWindows[d.key]);
        if (wins.length === 0) continue;
        placeEarly(item, d);
      }

      if (item.remaining > 0 && savedDateKey) {
        unplaceItem(item);
        var origD = getDateObj(savedDateKey);
        if (origD) placeLate(item, origD, WALK_END);
      }
    });
  });

  // PHASE 4 — RELAXATION: Unplaced items retry with 'anytime' windows.
  // When a task's `when` preference (e.g. "biz") conflicts with its location/
  // tool constraints (e.g. needs home but biz hours are at work), relax the
  // time-of-day preference so the task can be placed wherever its constraints
  // are actually met.
  PRI_LEVELS.forEach(function(priLevel) {
    pool.filter(function(item) {
      return item.remaining > 0 && item._parts.length === 0 && (item.task.pri || "P3") === priLevel;
    }).forEach(function(item) {
      for (var di = 0; di < dates.length; di++) {
        if (item.remaining <= 0) break;
        var d = dates[di];
        if (item.earliestDate && d.date < item.earliestDate) continue;
        if (item.ceiling && d.date > item.ceiling) continue;
        if (d.date < localToday) continue;
        if (!canPlaceOnDate(item.task, d)) continue;
        if (!depsMetByDate(item.task, d)) continue;
        placeEarly(item, d, 0, "anytime");
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
      if (hItem.remaining > 0) placeEarly(hItem, d, 0, "anytime");

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
            if (!depsMetByDate(rb.task, rd)) continue;
            var wins = getWhenWindows(rb.task.when, dayWindows[rd.key]);
            if (wins.length === 0) continue;
            placeEarly(rb, rd);
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

  // PHASE 5.5: Priority-aware re-sort (same-duration slot swaps)
  // For each day, group non-locked same-duration placements and reassign
  // the best-quality time slots to the highest-priority tasks. Pure slot
  // swaps preserve gap structure — no tasks become unplaced.
  function resortPriRank(pri) {
    if (pri === 'P1') return 4;
    if (pri === 'P2') return 3;
    if (pri === 'P4') return 1;
    return 2;
  }
  function resortSlotQuality(startMin) {
    if (startMin >= 540 && startMin < 720) return 3;  // 9am-12pm prime
    if (startMin >= 720 && startMin < 1020) return 2;  // 12pm-5pm
    return 1;
  }

  // Build set of task IDs that have multiple parts (split tasks) — exclude from re-sort
  var splitTaskIds = {};
  pool.forEach(function(item) {
    if (item._parts.length > 1) splitTaskIds[item.task.id] = true;
  });

  dates.forEach(function(d) {
    var placed = dayPlaced[d.key];
    if (!placed || placed.length < 2) return;

    // Collect movable placements: non-locked, non-habit, non-split
    var movable = [];
    for (var i = 0; i < placed.length; i++) {
      var p = placed[i];
      if (p.locked) continue;
      if (!p.task) continue;
      if (p.task.rigid) continue;
      if (hasWhen(p.task.when, 'fixed')) continue;
      if (splitTaskIds[p.task.id]) continue;
      movable.push(p);
    }
    if (movable.length < 2) return;

    // Group by duration
    var durGroups = {};
    movable.forEach(function(p) {
      if (!durGroups[p.dur]) durGroups[p.dur] = [];
      durGroups[p.dur].push(p);
    });

    for (var durKey in durGroups) {
      var group = durGroups[durKey];
      if (group.length < 2) continue;

      // Check if group has mixed priorities (otherwise nothing to re-sort)
      var hasMixed = false;
      var firstPri = group[0].task.pri || 'P3';
      for (var gi = 1; gi < group.length; gi++) {
        if ((group[gi].task.pri || 'P3') !== firstPri) { hasMixed = true; break; }
      }
      if (!hasMixed) continue;

      // Extract slots, sorted by quality (best first)
      var slots = group.map(function(p) { return { start: p.start, dur: p.dur }; });
      slots.sort(function(a, b) {
        var qa = resortSlotQuality(a.start), qb = resortSlotQuality(b.start);
        if (qa !== qb) return qb - qa;
        return a.start - b.start;
      });

      // Sort tasks by priority (P1 first), then fewer when-options as tiebreaker
      var tasks = group.slice();
      tasks.sort(function(a, b) {
        var pa = resortPriRank(a.task.pri), pb = resortPriRank(b.task.pri);
        if (pa !== pb) return pb - pa;
        return whenOptionCount(a.task) - whenOptionCount(b.task);
      });

      // Greedy assignment: highest priority gets best compatible slot
      var usedSlots = {};
      var assignments = [];

      for (var ti = 0; ti < tasks.length; ti++) {
        var p2 = tasks[ti];
        var assigned = false;
        for (var si = 0; si < slots.length; si++) {
          if (usedSlots[si]) continue;
          var newStart = slots[si].start;

          // Check when-windows (habits use flex windows to stay near preferred time)
          var wins = p2.task.habit
            ? (getHabitFlexWindows(p2.task, dayWindows[d.key]) || getWhenWindows(p2.task.when, dayWindows[d.key]))
            : getWhenWindows(p2.task.when, dayWindows[d.key]);
          var inWin = wins.length === 0;
          for (var wi = 0; wi < wins.length; wi++) {
            if (newStart >= wins[wi][0] && newStart + p2.dur <= wins[wi][1]) { inWin = true; break; }
          }
          if (!inWin) continue;

          // Check location
          var locOk = true;
          for (var m = newStart; m < newStart + p2.dur; m += 15) {
            var locId = resolveLocationId(d.key, m, cfg, dayBlocks[d.key]);
            if (!canTaskRun(p2.task, locId, cfg.toolMatrix)) { locOk = false; break; }
          }
          if (!locOk) continue;

          usedSlots[si] = true;
          assignments.push({ placement: p2, newStart: newStart });
          assigned = true;
          break;
        }
        if (!assigned) {
          // Fall back to original slot
          for (var si2 = 0; si2 < slots.length; si2++) {
            if (!usedSlots[si2] && slots[si2].start === p2.start) {
              usedSlots[si2] = true;
              assignments.push({ placement: p2, newStart: p2.start });
              break;
            }
          }
        }
      }

      // If any group member didn't get an assignment, skip this group
      // to prevent overlaps (unassigned tasks stay at original slot which
      // may have been given to another task)
      if (assignments.length !== group.length) continue;

      // Verify dependency ordering before applying
      var proposedStarts = {};
      assignments.forEach(function(a) { proposedStarts[a.placement.task.id] = a.newStart; });

      var depsOk = true;
      for (var ai = 0; ai < assignments.length && depsOk; ai++) {
        var t = assignments[ai].placement.task;
        var deps = getTaskDeps(t);
        for (var dii = 0; dii < deps.length; dii++) {
          if (proposedStarts[deps[dii]] !== undefined) {
            var depEndMin = proposedStarts[deps[dii]] + parseInt(durKey);
            if (depEndMin > assignments[ai].newStart) { depsOk = false; break; }
          }
        }
        var depChildren = dependedOnBy[t.id] || [];
        for (var chi = 0; chi < depChildren.length; chi++) {
          if (proposedStarts[depChildren[chi]] !== undefined) {
            var myEnd = assignments[ai].newStart + parseInt(durKey);
            if (myEnd > proposedStarts[depChildren[chi]]) { depsOk = false; break; }
          }
        }
      }

      if (!depsOk) continue;

      // Apply assignments — batch free all old slots before reserving new ones
      // to prevent corruption when tasks swap positions
      var occ = dayOcc[d.key];
      var changedAssignments = assignments.filter(function(a) { return a.placement.start !== a.newStart; });

      // Step 1: Free ALL old slots
      changedAssignments.forEach(function(a) {
        var pr = a.placement;
        for (var m = pr.start; m < pr.start + pr.dur; m++) delete occ[m];
      });

      // Step 2: Reserve ALL new slots and update placements
      changedAssignments.forEach(function(a) {
        var pr = a.placement;
        for (var m2 = a.newStart; m2 < a.newStart + pr.dur; m2++) occ[m2] = true;

        pr.start = a.newStart;

        var hh = Math.floor(a.newStart / 60), mm2 = a.newStart % 60;
        var ampm = hh >= 12 ? 'PM' : 'AM';
        var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
        taskUpdates[pr.task.id] = { date: d.key, time: dh + ':' + (mm2 < 10 ? '0' : '') + mm2 + ' ' + ampm };
        globalPlacedEnd[pr.task.id] = { dateKey: d.key, endMin: a.newStart + pr.dur };

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
    }

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
        reasons.push((dayLabels[t.dayReq] || t.dayReq) + ' only');
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
      if (reasons.length > 0) part._moveReason = reasons.join(' \u00B7 ');
    });
  });

  // Collect unplaced
  var unplaced = [];
  pool.forEach(function(item) {
    if (item.remaining > 0 && item._parts.length === 0) {
      var t = item.task;
      t._unplacedReason = item.deadline ? "deadline" : "no-capacity";

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
          if (!info && poolIds[depId]) {
            blockedDeps.push(depName(depId) + " (unplaced)");
          } else if (!info) {
            var found = allTasks.find(function(at) { return at.id === depId; });
            if (found) {
              var st = newSt[depId] || "";
              if (st !== "done" && st !== "cancel" && st !== "skip") {
                blockedDeps.push(depName(depId) + " (not scheduled)");
              }
            }
          }
        });
        if (blockedDeps.length > 0) {
          detail.push("Blocked by deps: " + blockedDeps.join(", "));
        }
      }

      if (item.earliestDate) detail.push("Earliest: " + formatDateKey(item.earliestDate));
      if (item.deadline) detail.push("Deadline: " + formatDateKey(item.deadline));
      detail.push("Duration: " + item.totalDur + "m, splittable: " + (item.splittable ? "yes" : "no"));
      if (t.location && t.location.length > 0) {
        detail.push("Requires: " + t.location.join("/"));
        // Check if location is available on the target day(s)
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
            detail.push("Only " + locAvail + "m of " + t.location.join("/") + " time available on " + targetKey);
          }
        }
      }
      detail.push("When: " + (t.when || "any") + ", DayReq: " + (t.dayReq || "any"));

      t._unplacedDetail = detail.join(" \u00B7 ");
      unplaced.push(t);
    }
  });

  // Strip changes from fixed tasks
  allTasks.forEach(function(ft) {
    if (hasWhen(ft.when, "fixed") && taskUpdates[ft.id]) delete taskUpdates[ft.id];
  });

  var placedCount = Object.keys(taskUpdates).length;
  var deadlineMisses = unplaced.filter(function(t) { return t._unplacedReason === "deadline"; });
  var greedyMs = Math.round(Date.now() - PERF);

  // Score the greedy+resort result
  var score = scoreSchedule(dayPlacements, unplaced, allTasks);
  var greedyScore = score.total;

  // Phase 6: Hill-climbing optimization
  var hcResult = hillClimb(dayPlacements, dayOcc, dayWindows, dayBlocks, unplaced, allTasks, cfg);
  var totalMs = Math.round(Date.now() - PERF);

  // Re-score after hill-climbing if it improved
  if (hcResult.improved) {
    score = scoreSchedule(dayPlacements, unplaced, allTasks);
  }

  console.log("[SCHED] unified: " + dates.length + " days, " + pool.length + " pool, " + placedCount + " placed, " + unplaced.length + " unplaced | " + greedyMs + "ms greedy (score=" + Math.round(greedyScore) + ") + " + hcResult.elapsed + "ms hill-climb (" + hcResult.iterations + " iters" + (hcResult.improved ? ", " + Math.round(hcResult.scoreBefore) + "->" + Math.round(hcResult.scoreAfter) : ", no change") + ") = " + totalMs + "ms | final=" + score.total);
  return { dayPlacements: dayPlacements, taskUpdates: taskUpdates, newStatuses: newSt, unplaced: unplaced, deadlineMisses: deadlineMisses, placedCount: placedCount, score: score };
}

module.exports = unifiedSchedule;
