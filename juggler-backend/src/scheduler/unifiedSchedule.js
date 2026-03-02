/**
 * Unified Scheduler — CJS port of juggler-frontend/src/scheduler/unifiedSchedule.js
 * ONE algorithm: day-by-day, slot-by-slot.
 * 1. Habits stagger around each other
 * 2. Fixed overlay on top (can overlap, reserve time)
 * 3. Pool sorted by strict deadline tiers, then P1-P4
 * 4. Walk 15-min slots filling from pool; splitting happens naturally
 * 5. Non-splittable tasks overflow with warning if deadline forces it
 */

var constants = require('./constants');
var GRID_START = constants.GRID_START;
var GRID_END = constants.GRID_END;
var DAY_NAMES = constants.DAY_NAMES;
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

function unifiedSchedule(allTasks, statuses, effectiveTodayKey, nowMins, cfg) {
  var PERF = Date.now();
  var dayNames = DAY_NAMES;
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

    if (hasWhen(t.when, "fixed")) {
      if (!isPast) { if (!fixedByDate[tdKey]) fixedByDate[tdKey] = []; fixedByDate[tdKey].push(t); }
      return;
    }
    if (t.habit) {
      if (!isPast) { if (!habitsByDate[tdKey]) habitsByDate[tdKey] = []; habitsByDate[tdKey].push(t); }
      return;
    }

    if (isPast || st === "wip" || st === "" || st === "other") {
      var earliest = null;
      var ceiling = null;
      if (t.startAfter) {
        var saDate = parseDate(t.startAfter);
        if (saDate) { saDate.setHours(0, 0, 0, 0); earliest = earliest ? (saDate > earliest ? saDate : earliest) : saDate; }
      }
      if (!isPast && td >= localToday) {
        if (!earliest || earliest <= td) {
          earliest = td;
        }
      }
      var deadline = t.due ? parseDate(t.due) : null;
      if (deadline) deadline.setHours(23, 59, 59, 999);

      pool.push({
        task: t, remaining: effectiveDur, totalDur: effectiveDur,
        earliestDate: earliest, deadline: deadline, ceiling: ceiling,
        splittable: t.split !== undefined ? t.split : cfg.splitDefault,
        minChunk: t.splitMin || MIN_CHUNK,
        _parts: []
      });
    }
  });

  var poolIds = {};
  pool.forEach(function(item) { poolIds[item.task.id] = true; });

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
    dayBlocks[d.key] = getBlocksForDate(d.key, cfg.timeBlocks);
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
      taskUpdates[t.id] = { date: dateKey, day: dayNames[new Date(parseDate(dateKey)).getDay()], time: dh + ":" + (mm < 10 ? "0" : "") + mm + " " + ampm };
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

  // EARLY PLACEMENT
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

  // LATE PLACEMENT
  function placeLate(item, d, beforeMin) {
    var t = item.task;
    var occ = dayOcc[d.key];
    var placed = dayPlaced[d.key];
    var wins = getWhenWindows(t.when, dayWindows[d.key]);
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
      var dur = Math.min((t.timeRemaining != null ? t.timeRemaining : t.dur) || 30, 720);
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

    var locOk = true;
    for (var hm = sm; hm < sm + dur; hm++) { if (mask[hm]) { locOk = false; break; } }
    if (locOk && isFree(occ, sm, dur)) {
      reserve(occ, sm, dur);
      placed.push({ task: t, start: sm, dur: dur, locked: true, _dateKey: d.key });
      globalPlacedEnd[t.id] = { dateKey: d.key, endMin: sm + dur };
      return;
    }

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

  // STEPS 4-6: Priority loop
  var PRI_LEVELS = ["P1", "P2", "P3", "P4"];

  PRI_LEVELS.forEach(function(priLevel) {
    // 3a. Non-rigid habits
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

    // 4. Late-place deadline tasks
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

    // 5. Pull forward
    var pullItems = pool.filter(function(item) {
      return item.deadline && item._parts.length > 0 && (item.task.pri || "P3") === priLevel;
    });
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

  // STEPS 7-8: Non-deadline tasks
  var placeVisited = {};

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
    items.sort(function(a, b) {
      var aDate = parseDate(a.task.date) || localToday;
      var bDate = parseDate(b.task.date) || localToday;
      var dd = aDate - bDate;
      if (dd !== 0) return dd;
      return whenOptionCount(a.task) - whenOptionCount(b.task);
    });
    items.forEach(function(item) { placeWithDeps(item); });
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
  console.log("[SCHED] unified: " + dates.length + " days, " + pool.length + " pool tasks, " + placedCount + " placed, " + unplaced.length + " unplaced in " + Math.round(Date.now() - PERF) + "ms");
  return { dayPlacements: dayPlacements, taskUpdates: taskUpdates, newStatuses: newSt, unplaced: unplaced, deadlineMisses: deadlineMisses, placedCount: placedCount };
}

module.exports = unifiedSchedule;
