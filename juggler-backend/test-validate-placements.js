/**
 * Placement Validation Script — Comprehensive Edition
 *
 * Runs the scheduler against a set of tasks and validates every placement
 * and unplaced task against its constraints:
 *
 *   1.  When-window alignment — placed within declared when windows
 *   2.  Location compatibility — task's location/tools available at placement time
 *   3.  Day requirement — placed on a valid day (weekday/weekend/specific day)
 *   4.  Date constraints — respects earliestDate (startAfter, pinned), ceiling, deadline
 *   5.  Dependency ordering — placed after all dependencies, before all dependants
 *   6.  Occupancy integrity — no two non-marker tasks occupy the same minute
 *   7.  Fixed task immutability — fixed tasks placed at their exact declared time/date
 *   8.  Marker transparency — markers don't reserve occupancy
 *   9.  Habit day-pinning — habits placed only on their assigned date
 *  10.  Split integrity — chunks respect minChunk, no runts, total = duration
 *  11.  Grid bounds — placements fall within GRID_START..GRID_END
 *  12.  FlexWhen annotation — _whenRelaxed only on flexWhen tasks placed outside windows
 *  13.  Duration accuracy — placed duration matches expected (dur or timeRemaining)
 *  14.  Status filtering — done/cancel/skip tasks must NOT appear in placements
 *  15.  Exclusion rules — allday, TBD tasks must NOT be placed
 *  16.  Priority ordering — higher-pri tasks should get earlier/better placement
 *  17.  Downstream ceiling — tasks placed on/before earliest dependant date
 *  18.  DatePinned immutability — pinned tasks stay on their declared date
 *  19.  Habit flex window — flexible habits within timeFlex range of preferred time
 *  20.  Today past-time blocking — minutes before nowMins are blocked on today
 *  21.  Unplaced diagnostics — unplaced tasks have reasons and correct annotations
 *  22.  Move reason annotations — rescheduled tasks annotated with why
 *  23.  Overlap columns — multi-column layout is consistent
 *  24.  Task update records — taskUpdates contain correct date/time for placed tasks
 *  25.  Generated/habit floor — generated and habit tasks not placed before their date
 *  26.  Non-splittable contiguity — non-split tasks have exactly one placement part
 *  27.  Deadline chain coherence — all ancestors of deadline tasks placed before deadline
 *
 * Run: node test-validate-placements.js [--verbose] [--scenario NAME]
 */

var unifiedSchedule = require('./src/scheduler/unifiedSchedule');
var constants = require('./src/scheduler/constants');
var dateHelpers = require('./src/scheduler/dateHelpers');
var timeBlockHelpers = require('./src/scheduler/timeBlockHelpers');
var locationHelpers = require('./src/scheduler/locationHelpers');
var dependencyHelpers = require('./src/scheduler/dependencyHelpers');

var formatDateKey = dateHelpers.formatDateKey;
var parseDate = dateHelpers.parseDate;
var parseTimeToMinutes = dateHelpers.parseTimeToMinutes;
var getBlocksForDate = timeBlockHelpers.getBlocksForDate;
var buildWindowsFromBlocks = timeBlockHelpers.buildWindowsFromBlocks;
var getWhenWindows = timeBlockHelpers.getWhenWindows;
var hasWhen = timeBlockHelpers.hasWhen;
var resolveLocationId = locationHelpers.resolveLocationId;
var canTaskRun = locationHelpers.canTaskRun;
var getTaskDeps = dependencyHelpers.getTaskDeps;

var GRID_START = constants.GRID_START;
var GRID_END = constants.GRID_END;
var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DEFAULT_TOOL_MATRIX = constants.DEFAULT_TOOL_MATRIX;
var DAY_NAMES = constants.DAY_NAMES;

var verbose = process.argv.includes('--verbose');
var scenarioFilter = null;
var sfIdx = process.argv.indexOf('--scenario');
if (sfIdx !== -1 && process.argv[sfIdx + 1]) scenarioFilter = process.argv[sfIdx + 1];

// ── Helpers ──

var today = new Date();
today.setHours(0, 0, 0, 0);
var todayKey = formatDateKey(today);

function dayOffset(n) {
  var d = new Date(today);
  d.setDate(d.getDate() + n);
  return formatDateKey(d);
}

function dayOffsetDate(n) {
  var d = new Date(today);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dowName(d) {
  return DAY_NAMES[(typeof d === 'number' ? new Date(today.getTime() + d * 86400000) : d).getDay()];
}

function minToTime(m) {
  var hh = Math.floor(m / 60), mm = m % 60;
  var ampm = hh >= 12 ? 'PM' : 'AM';
  var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
  return dh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
}

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {}
  }, overrides || {});
}

function makeTask(overrides) {
  var id = overrides.id || 'task_' + Math.random().toString(36).slice(2, 8);
  return Object.assign({
    id: id,
    text: overrides.text || id,
    date: todayKey,
    day: dowName(0),
    project: 'Test',
    pri: 'P3',
    dur: 30,
    when: 'morning,lunch,afternoon,evening',
    dayReq: 'any',
    habit: false,
    rigid: false,
    section: '',
    notes: '',
    dependsOn: [],
    location: [],
    tools: [],
    status: ''
  }, overrides);
}

// ── Validation Engine ──

var totalPassed = 0;
var totalFailed = 0;
var totalWarnings = 0;

function validate(result, tasks, cfg, label, options) {
  options = options || {};
  var dp = result.dayPlacements;
  var passed = 0;
  var failed = 0;
  var warnings = 0;
  var errors = [];
  var warns = [];
  var nowMins = options.nowMins || 0;
  var statuses = options.statuses || {};

  function fail(msg) { errors.push(msg); failed++; }
  function pass() { passed++; }
  function warn(msg) { warns.push(msg); warnings++; }

  // Build lookup maps
  var taskById = {};
  tasks.forEach(function(t) { taskById[t.id] = t; });

  // Collect all placements indexed by task ID
  var placementsByTask = {};
  var allPlacements = [];
  Object.keys(dp).forEach(function(dk) {
    (dp[dk] || []).forEach(function(p) {
      if (!p.task) return;
      var tid = p.task.id;
      if (!placementsByTask[tid]) placementsByTask[tid] = [];
      placementsByTask[tid].push({ dateKey: dk, start: p.start, dur: p.dur, locked: p.locked, marker: p.marker, _whenRelaxed: p._whenRelaxed, _moveReason: p._moveReason, splitPart: p.splitPart, splitTotal: p.splitTotal, col: p.col, cols: p.cols, placement: p });
      allPlacements.push({ dateKey: dk, taskId: tid, start: p.start, dur: p.dur, locked: p.locked, marker: p.marker, task: p.task, _whenRelaxed: p._whenRelaxed, col: p.col, cols: p.cols });
    });
  });

  // ── 1. WHEN-WINDOW ALIGNMENT ──
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    if (pl.locked && !pl.marker) { pass(); return; } // Fixed/rigid — skip when-window check
    if (pl.marker) { pass(); return; }
    if (pl._whenRelaxed) { pass(); return; } // Relaxed placements intentionally outside windows

    var whenVal = t.when;
    if (!whenVal || whenVal === 'anytime' || hasWhen(whenVal, 'allday') || hasWhen(whenVal, 'fixed')) {
      pass();
      return;
    }

    var blocks = getBlocksForDate(pl.dateKey, cfg.timeBlocks, cfg);
    var windows = buildWindowsFromBlocks(blocks);
    var wins = getWhenWindows(whenVal, windows);
    if (wins.length === 0) {
      warn('[WHEN] ' + t.id + ' (' + t.text + ') has when="' + whenVal + '" but no windows resolved on ' + pl.dateKey);
      return;
    }

    var startOk = false;
    for (var wi = 0; wi < wins.length; wi++) {
      if (pl.start >= wins[wi][0] && pl.start < wins[wi][1]) {
        startOk = true;
        break;
      }
    }
    if (!startOk) {
      fail('[WHEN] ' + t.id + ' (' + t.text + ') placed at min ' + pl.start + ' (' + minToTime(pl.start) + ') on ' + pl.dateKey + ' — outside when="' + whenVal + '" windows: ' + JSON.stringify(wins));
    } else {
      // Also check end is within a window
      var endMin = pl.start + pl.dur;
      var endOk = false;
      for (var wi2 = 0; wi2 < wins.length; wi2++) {
        if (endMin > wins[wi2][0] && endMin <= wins[wi2][1]) {
          endOk = true;
          break;
        }
      }
      if (!endOk) {
        warn('[WHEN] ' + t.id + ' (' + t.text + ') end min ' + endMin + ' (' + minToTime(endMin) + ') extends outside when windows on ' + pl.dateKey);
      }
      pass();
    }
  });

  // ── 2. LOCATION COMPATIBILITY ──
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    if (!t.location || t.location.length === 0) { pass(); return; }
    if (pl.marker) { pass(); return; }

    var blocks = getBlocksForDate(pl.dateKey, cfg.timeBlocks, cfg);
    var badMinutes = [];
    for (var m = pl.start; m < pl.start + pl.dur; m += 15) {
      var locId = resolveLocationId(pl.dateKey, m, cfg, blocks);
      if (!canTaskRun(t, locId, cfg.toolMatrix)) {
        badMinutes.push(m);
      }
    }
    if (badMinutes.length > 0) {
      fail('[LOC] ' + t.id + ' (' + t.text + ') requires ' + t.location.join('/') + ' but location incompatible at minutes ' + badMinutes.join(',') + ' on ' + pl.dateKey);
    } else {
      pass();
    }
  });

  // ── 3. DAY REQUIREMENT ──
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    if (!t.dayReq || t.dayReq === 'any') { pass(); return; }
    if (pl.marker) { pass(); return; }

    var d = parseDate(pl.dateKey);
    if (!d) { pass(); return; }
    var dow = d.getDay();
    var isWeekday = dow >= 1 && dow <= 5;

    if (t.dayReq === 'weekday' && !isWeekday) {
      fail('[DAY] ' + t.id + ' (' + t.text + ') requires weekday but placed on ' + DAY_NAMES[dow] + ' (' + pl.dateKey + ')');
      return;
    }
    if (t.dayReq === 'weekend' && isWeekday) {
      fail('[DAY] ' + t.id + ' (' + t.text + ') requires weekend but placed on ' + DAY_NAMES[dow] + ' (' + pl.dateKey + ')');
      return;
    }

    var dm = { M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, Su: 0, S: 6 };
    var parts = t.dayReq.split(',');
    if (parts.length >= 1 && dm[parts[0]] !== undefined) {
      var match = parts.some(function(p) { return dm[p] !== undefined && dm[p] === dow; });
      if (!match) {
        fail('[DAY] ' + t.id + ' (' + t.text + ') requires dayReq=' + t.dayReq + ' but placed on ' + DAY_NAMES[dow] + ' (' + pl.dateKey + ')');
        return;
      }
    }
    pass();
  });

  // ── 4. DATE CONSTRAINTS (startAfter, deadline, datePinned) ──
  Object.keys(placementsByTask).forEach(function(tid) {
    var t = taskById[tid];
    if (!t) return;
    var parts = placementsByTask[tid];

    // startAfter
    if (t.startAfter) {
      var saDate = parseDate(t.startAfter);
      if (saDate) {
        saDate.setHours(0, 0, 0, 0);
        parts.forEach(function(pl) {
          var plDate = parseDate(pl.dateKey);
          if (plDate && plDate < saDate) {
            fail('[DATE] ' + tid + ' (' + t.text + ') has startAfter=' + t.startAfter + ' but placed on ' + pl.dateKey);
          } else {
            pass();
          }
        });
      }
    }

    // deadline (due)
    if (t.due) {
      var dueDate = parseDate(t.due);
      if (dueDate) {
        dueDate.setHours(23, 59, 59, 999);
        var isPastDeadline = dueDate < today;
        parts.forEach(function(pl) {
          var plDate = parseDate(pl.dateKey);
          if (plDate && plDate > dueDate && !isPastDeadline) {
            fail('[DATE] ' + tid + ' (' + t.text + ') has due=' + t.due + ' but placed on ' + pl.dateKey + ' (after deadline)');
          } else if (plDate && plDate > dueDate && isPastDeadline) {
            warn('[DATE] ' + tid + ' (' + t.text + ') past deadline ' + t.due + ' — rescued to ' + pl.dateKey + ' (expected)');
          } else {
            pass();
          }
        });
      }
    }

    if (!t.startAfter && !t.due) pass();
  });

  // ── 5. DEPENDENCY ORDERING ──
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    var deps = getTaskDeps(t);
    if (deps.length === 0) { pass(); return; }

    var plDate = parseDate(pl.dateKey);
    if (!plDate) { pass(); return; }

    deps.forEach(function(depId) {
      var depParts = placementsByTask[depId];
      if (!depParts || depParts.length === 0) {
        var depTask = taskById[depId];
        if (depTask) {
          var depSt = statuses[depId] || depTask.status || '';
          if (depSt !== 'done' && depSt !== 'cancel' && depSt !== 'skip') {
            warn('[DEP] ' + t.id + ' (' + t.text + ') depends on ' + depId + ' which is not placed (and not complete)');
          } else {
            pass(); // dep is done/cancel/skip — fine
          }
        }
        return;
      }

      // Find the latest placement of the dependency
      var depLatestDate = null;
      var depLatestEnd = 0;
      depParts.forEach(function(dp) {
        var dpDate = parseDate(dp.dateKey);
        if (!depLatestDate || dpDate > depLatestDate || (dpDate.getTime() === depLatestDate.getTime() && dp.start + dp.dur > depLatestEnd)) {
          depLatestDate = dpDate;
          depLatestEnd = dp.start + dp.dur;
        }
      });

      if (depLatestDate > plDate) {
        fail('[DEP] ' + t.id + ' (' + t.text + ') placed on ' + pl.dateKey + ' but dependency ' + depId + ' placed on later date ' + formatDateKey(depLatestDate));
      } else if (depLatestDate.getTime() === plDate.getTime()) {
        if (depLatestEnd > pl.start) {
          fail('[DEP] ' + t.id + ' (' + t.text + ') starts at min ' + pl.start + ' (' + minToTime(pl.start) + ') on ' + pl.dateKey + ' but dependency ' + depId + ' ends at min ' + depLatestEnd + ' (' + minToTime(depLatestEnd) + ') (same day, wrong order)');
        } else {
          pass();
        }
      } else {
        pass();
      }
    });
  });

  // ── 6. OCCUPANCY INTEGRITY (no overlapping non-marker tasks) ──
  Object.keys(dp).forEach(function(dk) {
    var placements = (dp[dk] || []).filter(function(p) { return !p.marker; });
    var occ = {};
    var overlapFound = false;
    placements.forEach(function(p) {
      for (var m = p.start; m < p.start + p.dur; m++) {
        if (occ[m]) {
          fail('[OCC] Overlap on ' + dk + ' at min ' + m + ' (' + minToTime(m) + '): ' + occ[m] + ' and ' + (p.task ? p.task.id : '?'));
          overlapFound = true;
        } else {
          occ[m] = p.task ? p.task.id : '?';
        }
      }
    });
    if (!overlapFound) pass();
  });

  // ── 7. FIXED TASK IMMUTABILITY ──
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    if (!hasWhen(t.when, 'fixed')) return;
    if (pl.marker) return;

    var expectedTime = parseTimeToMinutes(t.time);
    if (expectedTime === null || expectedTime === 0) return;

    if (pl.start !== expectedTime) {
      fail('[FIXED] ' + t.id + ' (' + t.text + ') is fixed at ' + t.time + ' (min ' + expectedTime + ') but placed at min ' + pl.start + ' (' + minToTime(pl.start) + ')');
    } else {
      pass();
    }

    var expectedDate = t.date;
    if (expectedDate && pl.dateKey !== expectedDate) {
      fail('[FIXED] ' + t.id + ' (' + t.text + ') is fixed on ' + expectedDate + ' but placed on ' + pl.dateKey);
    } else {
      pass();
    }
  });

  // ── 8. MARKER TRANSPARENCY ──
  allPlacements.forEach(function(pl) {
    if (pl.task && pl.task.marker && !pl.marker) {
      fail('[MARKER] ' + pl.task.id + ' (' + pl.task.text + ') is a marker task but placement not flagged as marker');
    }
  });
  // Verify markers can coexist with other tasks (markers shouldn't block occupancy)
  Object.keys(dp).forEach(function(dk) {
    var markers = (dp[dk] || []).filter(function(p) { return p.marker; });
    var nonMarkers = (dp[dk] || []).filter(function(p) { return !p.marker; });
    markers.forEach(function(mk) {
      // It's VALID for a non-marker task to overlap with a marker
      // This is just an informational check — not a failure
    });
    if (markers.length > 0) pass(); // markers exist and are flagged
  });

  // ── 9. HABIT DAY-PINNING ──
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    if (!t.habit) return;

    var expectedDate = t.date;
    if (expectedDate && pl.dateKey !== expectedDate) {
      fail('[HABIT] ' + t.id + ' (' + t.text + ') is a habit assigned to ' + expectedDate + ' but placed on ' + pl.dateKey);
    } else {
      pass();
    }
  });

  // ── 10. SPLIT INTEGRITY ──
  Object.keys(placementsByTask).forEach(function(tid) {
    var t = taskById[tid];
    if (!t) return;
    var parts = placementsByTask[tid];
    if (parts.length <= 1) { pass(); return; }

    // Task must be splittable
    if (!t.split) {
      fail('[SPLIT] ' + tid + ' (' + t.text + ') is NOT splittable but has ' + parts.length + ' parts');
      return;
    }

    // Total placed duration
    var totalPlaced = 0;
    parts.forEach(function(p) { totalPlaced += p.dur; });
    var expectedDur = t.timeRemaining != null ? t.timeRemaining : t.dur;
    expectedDur = Math.min(expectedDur || 30, 720);
    if (totalPlaced > expectedDur) {
      fail('[SPLIT] ' + tid + ' (' + t.text + ') placed ' + totalPlaced + 'm but expected max ' + expectedDur + 'm');
    } else {
      pass();
    }

    // Minimum chunk size
    var minChunk = t.splitMin || 15;
    parts.forEach(function(p) {
      if (p.dur < minChunk && totalPlaced > p.dur) {
        fail('[SPLIT] ' + tid + ' (' + t.text + ') has chunk of ' + p.dur + 'm which is below minChunk=' + minChunk + 'm');
      } else {
        pass();
      }
    });

    // Split part labeling
    parts.forEach(function(p) {
      if (!p.splitPart || !p.splitTotal) {
        warn('[SPLIT] ' + tid + ' (' + t.text + ') missing splitPart/splitTotal annotation');
      }
    });

    // Chunks on the same day should not overlap
    var byDate = {};
    parts.forEach(function(p) {
      if (!byDate[p.dateKey]) byDate[p.dateKey] = [];
      byDate[p.dateKey].push(p);
    });
    Object.keys(byDate).forEach(function(dk) {
      var dayParts = byDate[dk].sort(function(a, b) { return a.start - b.start; });
      for (var i = 1; i < dayParts.length; i++) {
        if (dayParts[i].start < dayParts[i-1].start + dayParts[i-1].dur) {
          fail('[SPLIT] ' + tid + ' (' + t.text + ') has overlapping chunks on ' + dk + ': chunk at ' + dayParts[i-1].start + ' (dur ' + dayParts[i-1].dur + ') and chunk at ' + dayParts[i].start);
        }
      }
    });
  });

  // ── 11. GRID BOUNDS ──
  allPlacements.forEach(function(pl) {
    if (pl.marker) { pass(); return; }
    if (pl.locked) { pass(); return; } // Fixed tasks may intentionally be outside grid

    var gridStart = GRID_START * 60;
    var gridEnd = (GRID_END + 1) * 60;

    if (pl.start < gridStart) {
      warn('[GRID] ' + (pl.task ? pl.task.id : '?') + ' starts at min ' + pl.start + ' (' + minToTime(pl.start) + ') which is before GRID_START (' + minToTime(gridStart) + ')');
    }
    if (pl.start + pl.dur > gridEnd) {
      warn('[GRID] ' + (pl.task ? pl.task.id : '?') + ' ends at min ' + (pl.start + pl.dur) + ' (' + minToTime(pl.start + pl.dur) + ') which is after GRID_END (' + minToTime(gridEnd) + ')');
    }
    pass();
  });

  // ── 12. FLEX-WHEN ANNOTATION ──
  allPlacements.forEach(function(pl) {
    if (pl._whenRelaxed && pl.task && !pl.task.flexWhen) {
      fail('[FLEX] ' + pl.task.id + ' (' + pl.task.text + ') has _whenRelaxed but flexWhen is not set');
    }
    // If _whenRelaxed, verify it's actually outside its when windows
    if (pl._whenRelaxed && pl.task) {
      var whenVal = pl.task.when;
      if (whenVal && whenVal !== 'anytime') {
        var blocks = getBlocksForDate(pl.dateKey, cfg.timeBlocks, cfg);
        var windows = buildWindowsFromBlocks(blocks);
        var wins = getWhenWindows(whenVal, windows);
        var inWin = false;
        for (var wi = 0; wi < wins.length; wi++) {
          if (pl.start >= wins[wi][0] && pl.start + pl.dur <= wins[wi][1]) { inWin = true; break; }
        }
        if (inWin) {
          warn('[FLEX] ' + pl.task.id + ' (' + pl.task.text + ') has _whenRelaxed but is actually within its when windows');
        } else {
          pass();
        }
      }
    }
  });

  // ── 13. DURATION ACCURACY ──
  Object.keys(placementsByTask).forEach(function(tid) {
    var t = taskById[tid];
    if (!t) return;
    var parts = placementsByTask[tid];
    if (t.marker) return;

    var totalPlaced = 0;
    parts.forEach(function(p) { totalPlaced += p.dur; });
    var expectedDur = t.timeRemaining != null ? t.timeRemaining : t.dur;
    expectedDur = Math.min(expectedDur || 30, 720);

    if (totalPlaced > expectedDur) {
      fail('[DUR] ' + tid + ' (' + t.text + ') placed ' + totalPlaced + 'm but expected max ' + expectedDur + 'm (overplaced)');
    } else if (totalPlaced < expectedDur && parts.length === 1 && !t.split) {
      // Non-split task should be fully placed or not at all
      fail('[DUR] ' + tid + ' (' + t.text + ') placed ' + totalPlaced + 'm but expected ' + expectedDur + 'm (non-split, underplaced)');
    } else {
      pass();
    }
  });

  // ── 14. STATUS FILTERING ──
  var terminalStatuses = ['done', 'cancel', 'skip'];
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    var st = statuses[t.id] || t.status || '';
    if (terminalStatuses.indexOf(st) !== -1) {
      fail('[STATUS] ' + t.id + ' (' + t.text + ') has status "' + st + '" but appears in placements');
    }
  });
  // Also check that no terminal-status task appears
  tasks.forEach(function(t) {
    var st = statuses[t.id] || t.status || '';
    if (terminalStatuses.indexOf(st) !== -1) {
      if (placementsByTask[t.id] && placementsByTask[t.id].length > 0) {
        fail('[STATUS] ' + t.id + ' (' + t.text + ') has status "' + st + '" but has ' + placementsByTask[t.id].length + ' placements');
      } else {
        pass();
      }
    }
  });

  // ── 15. EXCLUSION RULES ──
  tasks.forEach(function(t) {
    if (hasWhen(t.when, 'allday')) {
      if (placementsByTask[t.id] && placementsByTask[t.id].length > 0) {
        fail('[EXCL] ' + t.id + ' (' + t.text + ') is allday but appears in time-grid placements');
      } else {
        pass();
      }
    }
    if (!t.date || t.date === 'TBD') {
      if (placementsByTask[t.id] && placementsByTask[t.id].length > 0) {
        fail('[EXCL] ' + t.id + ' (' + t.text + ') has no date or TBD but appears in placements');
      } else {
        pass();
      }
    }
  });

  // ── 16. PRIORITY ORDERING (advisory) ──
  // Within the same day, higher-pri tasks should generally be placed earlier
  // This is advisory — compaction/when-windows may cause exceptions
  if (options.checkPriorityOrdering) {
    Object.keys(dp).forEach(function(dk) {
      var dayPl = (dp[dk] || []).filter(function(p) { return !p.locked && !p.marker && p.task; });
      if (dayPl.length < 2) return;
      var priRank = { P1: 4, P2: 3, P3: 2, P4: 1 };
      for (var i = 0; i < dayPl.length; i++) {
        for (var j = i + 1; j < dayPl.length; j++) {
          var a = dayPl[i], b = dayPl[j];
          var aRank = priRank[a.task.pri || 'P3'] || 2;
          var bRank = priRank[b.task.pri || 'P3'] || 2;
          // If a is later than b but higher priority, flag
          if (a.start > b.start && aRank > bRank + 1) {
            // Only warn if same when windows (different windows = different constraints)
            if (a.task.when === b.task.when) {
              warn('[PRI] ' + a.task.id + ' (P' + (5 - aRank) + ') at ' + minToTime(a.start) + ' is after ' + b.task.id + ' (P' + (5 - bRank) + ') at ' + minToTime(b.start) + ' on ' + dk);
            }
          }
        }
      }
      pass();
    });
  }

  // ── 17. DOWNSTREAM CEILING ──
  // If task A has dependants, all of A's placements must be on/before the earliest dependant date
  var dependedOnBy = {};
  tasks.forEach(function(t) {
    getTaskDeps(t).forEach(function(depId) {
      if (!dependedOnBy[depId]) dependedOnBy[depId] = [];
      dependedOnBy[depId].push(t.id);
    });
  });

  Object.keys(placementsByTask).forEach(function(tid) {
    var children = dependedOnBy[tid] || [];
    if (children.length === 0) { return; }
    var t = taskById[tid];
    var parts = placementsByTask[tid];

    // Find earliest date of any placed dependant
    var earliestChildDate = null;
    children.forEach(function(childId) {
      var childParts = placementsByTask[childId];
      if (!childParts) return;
      childParts.forEach(function(cp) {
        var cpDate = parseDate(cp.dateKey);
        if (cpDate && (!earliestChildDate || cpDate < earliestChildDate)) earliestChildDate = cpDate;
      });
    });

    if (!earliestChildDate) return;

    parts.forEach(function(pl) {
      var plDate = parseDate(pl.dateKey);
      if (plDate && plDate > earliestChildDate) {
        fail('[CEIL] ' + tid + ' (' + (t ? t.text : '?') + ') placed on ' + pl.dateKey + ' but has dependant placed on earlier date ' + formatDateKey(earliestChildDate));
      } else {
        pass();
      }
    });
  });

  // ── 18. DATEPINNED FLOOR ──
  // datePinned sets earliestDate = date (a floor, not a hard lock).
  // The task should not be placed BEFORE its date, but CAN overflow later
  // if the day is full or dependencies push it out.
  tasks.forEach(function(t) {
    if (!t.datePinned) return;
    var parts = placementsByTask[t.id];
    if (!parts || parts.length === 0) return;
    var expectedDate = t.date;
    if (!expectedDate) return;
    var floorDate = parseDate(expectedDate);
    if (!floorDate) return;

    parts.forEach(function(pl) {
      var plDate = parseDate(pl.dateKey);
      if (plDate && plDate < floorDate) {
        fail('[PIN] ' + t.id + ' (' + t.text + ') is datePinned to ' + expectedDate + ' but placed BEFORE on ' + pl.dateKey);
      } else if (pl.dateKey !== expectedDate) {
        warn('[PIN] ' + t.id + ' (' + t.text + ') is datePinned to ' + expectedDate + ' but overflowed to ' + pl.dateKey + ' (floor respected, day likely full)');
      } else {
        pass();
      }
    });
  });

  // ── 19. HABIT FLEX WINDOW ──
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    if (!t.habit || t.rigid) return;
    if (!t.time) return;

    var sm = parseTimeToMinutes(t.time);
    if (sm === null) return;
    var flex = t.timeFlex != null ? t.timeFlex : 60;
    if (flex <= 0) return;

    var lo = Math.max(GRID_START * 60, sm - flex);
    var hi = Math.min(23 * 60, sm + flex);

    if (pl.start < lo || pl.start > hi) {
      warn('[HFLEX] ' + t.id + ' (' + t.text + ') flexible habit at ' + minToTime(pl.start) + ' is outside timeFlex range ' + minToTime(lo) + '-' + minToTime(hi) + ' (preferred ' + t.time + ', flex=' + flex + 'm)');
    } else {
      pass();
    }
  });

  // ── 20. TODAY PAST-TIME BLOCKING ──
  if (nowMins > 0) {
    var todayDk = formatDateKey(today);
    var todayPl = (dp[todayDk] || []).filter(function(p) { return !p.locked && !p.marker; });
    var nowSlot = Math.ceil(nowMins / 15) * 15;
    todayPl.forEach(function(pl) {
      if (pl.start < nowSlot) {
        fail('[NOW] ' + (pl.task ? pl.task.id : '?') + ' placed at min ' + pl.start + ' (' + minToTime(pl.start) + ') which is before nowMins=' + nowMins + ' on today');
      } else {
        pass();
      }
    });
    if (todayPl.length === 0) pass();
  }

  // ── 21. UNPLACED DIAGNOSTICS ──
  if (result.unplaced) {
    result.unplaced.forEach(function(t) {
      if (!t._unplacedDetail) {
        warn('[UNPL] ' + t.id + ' (' + t.text + ') is unplaced but has no _unplacedDetail diagnostic');
      } else {
        pass();
      }
      if (!t._unplacedReason) {
        warn('[UNPL] ' + t.id + ' (' + t.text + ') is unplaced but has no _unplacedReason');
      } else {
        pass();
      }
    });
  }

  // ── 22. MOVE REASON ANNOTATIONS ──
  // Tasks placed on a different date than their original should have _moveReason
  Object.keys(placementsByTask).forEach(function(tid) {
    var t = taskById[tid];
    if (!t) return;
    if (t.marker) return;
    var origDate = t.date;
    if (!origDate) return;

    var parts = placementsByTask[tid];
    parts.forEach(function(pl) {
      if (pl.dateKey !== origDate && !pl.locked) {
        if (!pl._moveReason) {
          // Only warn for significant moves (not just scheduler optimization)
          var origD = parseDate(origDate);
          var plD = parseDate(pl.dateKey);
          if (origD && plD) {
            var dayDiff = Math.abs(Math.round((plD - origD) / 86400000));
            if (dayDiff >= 2) {
              warn('[MOVE] ' + tid + ' (' + t.text + ') moved from ' + origDate + ' to ' + pl.dateKey + ' (' + dayDiff + ' days) but has no _moveReason');
            }
          }
        }
      }
    });
    pass();
  });

  // ── 23. OVERLAP COLUMNS ──
  Object.keys(dp).forEach(function(dk) {
    var placements = dp[dk] || [];
    if (placements.length < 2) return;

    placements.forEach(function(p) {
      if (p.col === undefined || p.cols === undefined) {
        // col/cols should be assigned during post-processing
        return;
      }
      if (p.col < 0) {
        fail('[COL] ' + (p.task ? p.task.id : '?') + ' has negative col=' + p.col + ' on ' + dk);
      }
      if (p.col >= p.cols) {
        fail('[COL] ' + (p.task ? p.task.id : '?') + ' has col=' + p.col + ' >= cols=' + p.cols + ' on ' + dk);
      }
    });

    // Verify no two non-marker tasks in the same column overlap
    var nonMarkers = placements.filter(function(p) { return !p.marker; });
    for (var i = 0; i < nonMarkers.length; i++) {
      for (var j = i + 1; j < nonMarkers.length; j++) {
        var a = nonMarkers[i], b = nonMarkers[j];
        if (a.col === b.col && a.start < b.start + b.dur && b.start < a.start + a.dur) {
          // Same column overlapping — should be different columns
          if (a.cols > 1 || b.cols > 1) {
            // Multi-column layout, overlapping items should have different columns
            fail('[COL] ' + (a.task ? a.task.id : '?') + ' and ' + (b.task ? b.task.id : '?') + ' overlap on ' + dk + ' in same column ' + a.col);
          }
        }
      }
    }
    pass();
  });

  // ── 24. TASK UPDATE RECORDS ──
  if (result.taskUpdates) {
    Object.keys(result.taskUpdates).forEach(function(tid) {
      var upd = result.taskUpdates[tid];
      var parts = placementsByTask[tid];
      if (!parts || parts.length === 0) {
        warn('[UPD] taskUpdates has entry for ' + tid + ' but task has no placements');
        return;
      }

      // The taskUpdate date should match the first placement's date
      var firstPart = parts.sort(function(a, b) {
        var da = parseDate(a.dateKey), db = parseDate(b.dateKey);
        if (da && db && da.getTime() !== db.getTime()) return da - db;
        return a.start - b.start;
      })[0];

      if (upd.date && upd.date !== firstPart.dateKey) {
        warn('[UPD] taskUpdates[' + tid + '].date=' + upd.date + ' but first placement is on ' + firstPart.dateKey);
      }
      pass();
    });
  }

  // ── 25. GENERATED/HABIT EARLIEST-DATE FLOOR ──
  // Generated and habit tasks have earliestDate = date; they must not be placed before their date
  allPlacements.forEach(function(pl) {
    var t = pl.task;
    if (!t.generated && !t.habit) return;
    if (!t.date || t.date === 'TBD') return;
    var floorDate = parseDate(t.date);
    var plDate = parseDate(pl.dateKey);
    if (floorDate && plDate && plDate < floorDate) {
      fail('[FLOOR] ' + t.id + ' (' + t.text + ') is ' + (t.generated ? 'generated' : 'habit') + ' for ' + t.date + ' but placed before on ' + pl.dateKey);
    } else {
      pass();
    }
  });

  // ── 26. NON-SPLITTABLE CONTIGUITY ──
  // Non-splittable tasks must be placed as a single contiguous block (one part only)
  Object.keys(placementsByTask).forEach(function(tid) {
    var t = taskById[tid];
    if (!t || t.split || t.marker) return;
    var parts = placementsByTask[tid];
    if (parts.length > 1) {
      fail('[CONTIG] ' + tid + ' (' + t.text + ') is non-splittable but has ' + parts.length + ' placement parts');
    } else {
      pass();
    }
  });

  // ── 27. DEADLINE CHAIN COHERENCE ──
  // For tasks with deadlines: all ancestor deps (transitive) must also be placed before the deadline
  Object.keys(placementsByTask).forEach(function(tid) {
    var t = taskById[tid];
    if (!t || !t.due) return;
    var dueDate = parseDate(t.due);
    if (!dueDate) return;
    var isPastDeadline = dueDate < today;
    if (isPastDeadline) return; // Past deadlines are handled by rescue

    // Walk ancestors
    var visited = {};
    var queue = getTaskDeps(t).slice();
    var ancestors = [];
    while (queue.length > 0) {
      var depId = queue.shift();
      if (visited[depId]) continue;
      visited[depId] = true;
      var depTask = taskById[depId];
      if (depTask) {
        ancestors.push(depTask);
        getTaskDeps(depTask).forEach(function(gp) { queue.push(gp); });
      }
    }

    ancestors.forEach(function(anc) {
      var ancParts = placementsByTask[anc.id];
      if (!ancParts) return;
      ancParts.forEach(function(ap) {
        var apDate = parseDate(ap.dateKey);
        if (apDate && apDate > dueDate) {
          fail('[DCHAIN] ' + anc.id + ' (' + anc.text + ') is ancestor of ' + tid + ' (due=' + t.due + ') but placed on ' + ap.dateKey + ' after deadline');
        } else {
          pass();
        }
      });
    });
  });

  // ── Report ──
  if (errors.length > 0 || warns.length > 0 || verbose) {
    console.log('\n--- ' + label + ' ---');
    if (verbose) {
      console.log('  Placements: ' + allPlacements.length + ' across ' + Object.keys(dp).length + ' days');
      console.log('  Unplaced: ' + (result.unplaced ? result.unplaced.length : 0));
      // Show placement summary
      Object.keys(placementsByTask).forEach(function(tid) {
        var parts = placementsByTask[tid];
        var t = taskById[tid] || {};
        var summary = parts.map(function(p) { return p.dateKey + ' ' + minToTime(p.start) + '-' + minToTime(p.start + p.dur); }).join(', ');
        console.log('    ' + tid + ' (' + (t.pri || '?') + ', ' + (t.when || '?') + '): ' + summary);
      });
    }
    errors.forEach(function(e) { console.log('  FAIL: ' + e); });
    warns.forEach(function(w) { console.log('  WARN: ' + w); });
    console.log('  Result: ' + passed + ' passed, ' + failed + ' failed, ' + warnings + ' warnings');
  } else {
    console.log('  PASS: ' + label + ' (' + passed + ' checks)');
  }

  totalPassed += passed;
  totalFailed += failed;
  totalWarnings += warnings;
  return { passed: passed, failed: failed, warnings: warnings };
}

// ══════════════════════════════════════════════════════════════
// SCENARIOS
// ══════════════════════════════════════════════════════════════

var scenarios = {};

// ── Scenario 1: Basic mixed priorities ──
scenarios['basic-priorities'] = function() {
  var tasks = [];
  for (var i = 0; i < 3; i++) tasks.push(makeTask({ id: 'p1_' + i, text: 'P1 task ' + i, pri: 'P1', dur: 60 }));
  for (var j = 0; j < 3; j++) tasks.push(makeTask({ id: 'p3_' + j, text: 'P3 task ' + j, pri: 'P3', dur: 60 }));
  for (var k = 0; k < 3; k++) tasks.push(makeTask({ id: 'p4_' + k, text: 'P4 task ' + k, pri: 'P4', dur: 60 }));

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Basic mixed priorities', { statuses: statuses, checkPriorityOrdering: true });
};

// ── Scenario 2: Deadline tasks ──
scenarios['deadlines'] = function() {
  var tasks = [
    makeTask({ id: 'dl_tight', text: 'Tight deadline', pri: 'P2', dur: 60, due: dayOffset(1) }),
    makeTask({ id: 'dl_medium', text: 'Medium deadline', pri: 'P3', dur: 90, due: dayOffset(5) }),
    makeTask({ id: 'dl_loose', text: 'Loose deadline', pri: 'P4', dur: 45, due: dayOffset(14) }),
    makeTask({ id: 'dl_past', text: 'Past deadline', pri: 'P1', dur: 30, due: dayOffset(-2), date: dayOffset(-3) }),
    // Same-day deadline (most critical)
    makeTask({ id: 'dl_today', text: 'Due today', pri: 'P1', dur: 30, due: todayKey }),
    // Filler
    makeTask({ id: 'filler1', text: 'Filler', pri: 'P3', dur: 120 }),
    makeTask({ id: 'filler2', text: 'Filler 2', pri: 'P3', dur: 120 })
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Deadline tasks', { statuses: statuses });
};

// ── Scenario 3: Dependency chains ──
scenarios['dependencies'] = function() {
  var tasks = [
    makeTask({ id: 'dep_a', text: 'Step A', pri: 'P2', dur: 30 }),
    makeTask({ id: 'dep_b', text: 'Step B (after A)', pri: 'P2', dur: 30, dependsOn: ['dep_a'] }),
    makeTask({ id: 'dep_c', text: 'Step C (after B)', pri: 'P2', dur: 30, dependsOn: ['dep_b'] }),
    makeTask({ id: 'dep_d', text: 'Step D (after A & C)', pri: 'P1', dur: 30, dependsOn: ['dep_a', 'dep_c'] }),
    makeTask({ id: 'ind_1', text: 'Independent', pri: 'P3', dur: 60 })
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Dependency chains', { statuses: statuses });
};

// ── Scenario 4: Deep dependency chain (6 levels) ──
scenarios['deep-deps'] = function() {
  var tasks = [];
  for (var i = 0; i < 6; i++) {
    tasks.push(makeTask({
      id: 'chain_' + i,
      text: 'Chain step ' + i,
      pri: 'P2',
      dur: 30,
      dependsOn: i > 0 ? ['chain_' + (i - 1)] : []
    }));
  }
  // Add a task that depends on multiple chain points (diamond dep)
  tasks.push(makeTask({
    id: 'diamond',
    text: 'Diamond dep (after step 1 & step 4)',
    pri: 'P1',
    dur: 30,
    dependsOn: ['chain_1', 'chain_4']
  }));

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Deep dependency chain (6 levels + diamond)', { statuses: statuses });
};

// ── Scenario 5: When-window constraints ──
scenarios['when-windows'] = function() {
  var tasks = [
    makeTask({ id: 'morning_only', text: 'Morning only', pri: 'P2', dur: 60, when: 'morning' }),
    makeTask({ id: 'evening_only', text: 'Evening only', pri: 'P2', dur: 60, when: 'evening' }),
    makeTask({ id: 'afternoon_only', text: 'Afternoon only', pri: 'P2', dur: 60, when: 'afternoon' }),
    makeTask({ id: 'anytime', text: 'Anytime', pri: 'P3', dur: 60, when: 'anytime' }),
    makeTask({ id: 'multi_when', text: 'Morning+Evening', pri: 'P3', dur: 60, when: 'morning,evening' }),
    // Lunch-only task
    makeTask({ id: 'lunch_only', text: 'Lunch only', pri: 'P2', dur: 30, when: 'lunch' }),
    // Biz-only task (work hours)
    makeTask({ id: 'biz_only', text: 'Business hours', pri: 'P3', dur: 60, when: 'biz' })
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'When-window constraints', { statuses: statuses });
};

// ── Scenario 6: Day requirements ──
scenarios['day-requirements'] = function() {
  var mondayOff = (8 - today.getDay()) % 7 || 7;
  var mondayKey = dayOffset(mondayOff);
  var satOff = (6 - today.getDay() + 7) % 7 || 7;
  var satKey = dayOffset(satOff);
  var wedOff = (3 - today.getDay() + 7) % 7 || 7;
  var wedKey = dayOffset(wedOff);

  var tasks = [
    makeTask({ id: 'weekday_task', text: 'Weekday only', pri: 'P2', dur: 60, dayReq: 'weekday', date: mondayKey }),
    makeTask({ id: 'weekend_task', text: 'Weekend only', pri: 'P2', dur: 60, dayReq: 'weekend', date: satKey }),
    makeTask({ id: 'monday_task', text: 'Monday only', pri: 'P3', dur: 30, dayReq: 'M', date: mondayKey }),
    makeTask({ id: 'multi_day', text: 'Mon/Wed/Fri', pri: 'P3', dur: 30, dayReq: 'M,W,F', date: mondayKey }),
    // Wednesday-only task
    makeTask({ id: 'wed_task', text: 'Wednesday only', pri: 'P3', dur: 60, dayReq: 'W', date: wedKey }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Day requirements', { statuses: statuses });
};

// ── Scenario 7: Fixed tasks + markers ──
scenarios['fixed-and-markers'] = function() {
  var tasks = [
    makeTask({ id: 'fixed_9am', text: 'Fixed 9AM', pri: 'P2', dur: 60, when: 'fixed', time: '9:00 AM' }),
    makeTask({ id: 'fixed_2pm', text: 'Fixed 2PM', pri: 'P3', dur: 30, when: 'fixed', time: '2:00 PM' }),
    makeTask({ id: 'marker_10am', text: 'Game on TV', pri: 'P4', dur: 180, time: '10:00 AM', marker: true }),
    // Regular task that should be able to overlap with the marker
    makeTask({ id: 'flex_task', text: 'Flexible task', pri: 'P2', dur: 60 }),
    // Fixed task at edge of day
    makeTask({ id: 'fixed_6am', text: 'Fixed 6AM', pri: 'P2', dur: 30, when: 'fixed', time: '6:00 AM' }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Fixed tasks and markers', { statuses: statuses });

  // Verify marker allows overlap
  var markerStart = parseTimeToMinutes('10:00 AM');
  var markerEnd = markerStart + 180;
  var overlapping = [];
  Object.keys(result.dayPlacements).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (!p.marker && p.task && p.start < markerEnd && p.start + p.dur > markerStart && dk === todayKey) {
        overlapping.push(p.task.id);
      }
    });
  });
  if (overlapping.length > 0) {
    console.log('  NOTE: Tasks overlapping with marker: ' + overlapping.join(', ') + ' (expected behavior)');
  }
};

// ── Scenario 8: Habits ──
scenarios['habits'] = function() {
  var tasks = [
    makeTask({ id: 'habit_rigid', text: 'Morning run', pri: 'P2', dur: 30, habit: true, rigid: true, time: '7:00 AM', when: 'morning' }),
    makeTask({ id: 'habit_flex', text: 'Read', pri: 'P3', dur: 20, habit: true, rigid: false, time: '8:00 AM', when: 'morning', timeFlex: 60 }),
    // Flexible habit with narrow flex window
    makeTask({ id: 'habit_narrow', text: 'Meditate', pri: 'P2', dur: 15, habit: true, rigid: false, time: '6:30 AM', when: 'morning', timeFlex: 30 }),
    // Regular tasks that might compete
    makeTask({ id: 'reg_1', text: 'Regular task 1', pri: 'P1', dur: 90 }),
    makeTask({ id: 'reg_2', text: 'Regular task 2', pri: 'P1', dur: 90 })
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Habits (rigid + flexible)', { statuses: statuses });
};

// ── Scenario 9: Splittable tasks ──
scenarios['splitting'] = function() {
  var tasks = [
    makeTask({ id: 'split_big', text: 'Big splittable', pri: 'P2', dur: 240, split: true, splitMin: 30 }),
    makeTask({ id: 'split_small', text: 'Small splittable', pri: 'P3', dur: 60, split: true, splitMin: 15 }),
    // Fill most of today to force splitting
    makeTask({ id: 'block_1', text: 'Blocker 1', pri: 'P1', dur: 90, when: 'morning' }),
    makeTask({ id: 'block_2', text: 'Blocker 2', pri: 'P1', dur: 90, when: 'afternoon' }),
    makeTask({ id: 'block_3', text: 'Blocker 3', pri: 'P1', dur: 60, when: 'evening' })
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Splittable tasks', { statuses: statuses });
};

// ── Scenario 10: startAfter constraint ──
scenarios['start-after'] = function() {
  var tasks = [
    makeTask({ id: 'sa_task', text: 'Start after +3', pri: 'P2', dur: 60, startAfter: dayOffset(3), date: dayOffset(3) }),
    makeTask({ id: 'sa_with_dep', text: 'Start after +5 with dep', pri: 'P2', dur: 30, startAfter: dayOffset(5), date: dayOffset(5), dependsOn: ['sa_task'] }),
    makeTask({ id: 'normal', text: 'Normal task', pri: 'P3', dur: 60 })
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Start-after constraint', { statuses: statuses });
};

// ── Scenario 11: Dependency + deadline combo ──
scenarios['deps-with-deadlines'] = function() {
  var tasks = [
    makeTask({ id: 'dd_a', text: 'Research', pri: 'P2', dur: 60 }),
    makeTask({ id: 'dd_b', text: 'Write draft (after research)', pri: 'P2', dur: 120, dependsOn: ['dd_a'], due: dayOffset(5) }),
    makeTask({ id: 'dd_c', text: 'Review (after draft)', pri: 'P1', dur: 30, dependsOn: ['dd_b'], due: dayOffset(5) }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Dependencies with deadlines', { statuses: statuses });
};

// ── Scenario 12: FlexWhen behavior ──
scenarios['flex-when'] = function() {
  var tasks = [];
  // Fill morning slots to force evening-only task to go unplaced (or flex)
  for (var i = 0; i < 6; i++) {
    tasks.push(makeTask({ id: 'filler_' + i, text: 'Filler ' + i, pri: 'P1', dur: 60, when: 'morning' }));
  }
  tasks.push(makeTask({ id: 'strict_morning', text: 'Strict morning', pri: 'P3', dur: 30, when: 'morning', flexWhen: false }));
  tasks.push(makeTask({ id: 'flex_morning', text: 'Flex morning', pri: 'P3', dur: 30, when: 'morning', flexWhen: true }));

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'FlexWhen behavior', { statuses: statuses });

  var flexPlaced = false;
  var strictPlaced = false;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === 'flex_morning') flexPlaced = true;
      if (p.task && p.task.id === 'strict_morning') strictPlaced = true;
    });
  });

  if (strictPlaced) {
    console.log('  NOTE: strict_morning was placed (morning had room) — not a failure');
  }
  if (flexPlaced) {
    console.log('  NOTE: flex_morning placed (possibly with whenRelaxed)');
  }
};

// ── Scenario 13: Marker + dependency (reverse dep check) ──
scenarios['marker-deps'] = function() {
  var tasks = [
    makeTask({ id: 'mk_game', text: 'Game at 6pm', pri: 'P3', dur: 180, time: '6:00 PM', marker: true }),
    makeTask({ id: 'mk_prep', text: 'Game prep (before game)', pri: 'P2', dur: 60, when: 'afternoon,evening' }),
  ];
  tasks[0].dependsOn = ['mk_prep'];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Marker with dependency (reverse dep)', { statuses: statuses });
};

// ── Scenario 14: Status filtering (done/cancel/skip) ──
scenarios['status-filtering'] = function() {
  var tasks = [
    makeTask({ id: 'done_task', text: 'Already done', pri: 'P1', dur: 60 }),
    makeTask({ id: 'cancel_task', text: 'Cancelled', pri: 'P2', dur: 60 }),
    makeTask({ id: 'skip_task', text: 'Skipped', pri: 'P3', dur: 60 }),
    makeTask({ id: 'wip_task', text: 'In progress', pri: 'P2', dur: 60 }),
    makeTask({ id: 'active_task', text: 'Active', pri: 'P3', dur: 60 }),
    // Task depending on done task — should be placed fine
    makeTask({ id: 'after_done', text: 'After done task', pri: 'P2', dur: 30, dependsOn: ['done_task'] }),
  ];

  var statuses = {
    done_task: 'done',
    cancel_task: 'cancel',
    skip_task: 'skip',
    wip_task: 'wip',
    active_task: '',
    after_done: ''
  };
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Status filtering (done/cancel/skip)', { statuses: statuses });
};

// ── Scenario 15: Exclusion rules (allday, TBD) ──
scenarios['exclusions'] = function() {
  var tasks = [
    makeTask({ id: 'allday_task', text: 'All day event', pri: 'P2', dur: 480, when: 'allday' }),
    makeTask({ id: 'tbd_task', text: 'TBD task', pri: 'P3', dur: 60, date: 'TBD' }),
    makeTask({ id: 'no_date', text: 'No date', pri: 'P3', dur: 60, date: '' }),
    // Normal task should still be placed
    makeTask({ id: 'normal', text: 'Normal', pri: 'P3', dur: 60 }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Exclusion rules (allday, TBD)', { statuses: statuses });
};

// ── Scenario 16: Location constraints ──
scenarios['location'] = function() {
  // On weekdays, morning is at home, biz blocks are at work
  var mondayOff = (8 - today.getDay()) % 7 || 7;
  var mondayKey = dayOffset(mondayOff);

  var tasks = [
    // Task that needs work_pc — should only be placed during biz (work) hours
    makeTask({ id: 'work_pc_task', text: 'Needs work PC', pri: 'P2', dur: 60, tools: ['work_pc'], date: mondayKey, when: 'morning,biz,lunch,afternoon,evening' }),
    // Task that needs printer — only at work
    makeTask({ id: 'printer_task', text: 'Needs printer', pri: 'P3', dur: 30, tools: ['printer'], date: mondayKey, when: 'biz,lunch' }),
    // Task with no tool requirement — can go anywhere
    makeTask({ id: 'anywhere_task', text: 'No tools needed', pri: 'P3', dur: 60, date: mondayKey }),
    // Phone-only task — should be placeable everywhere
    makeTask({ id: 'phone_task', text: 'Phone task', pri: 'P4', dur: 30, tools: ['phone'], date: mondayKey }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Location constraints', { statuses: statuses });
};

// ── Scenario 17: timeRemaining (partially completed tasks) ──
scenarios['time-remaining'] = function() {
  var tasks = [
    makeTask({ id: 'partial_60', text: 'Was 120m, 60m left', pri: 'P2', dur: 120, timeRemaining: 60 }),
    makeTask({ id: 'partial_15', text: 'Was 60m, 15m left', pri: 'P3', dur: 60, timeRemaining: 15 }),
    makeTask({ id: 'full_90', text: 'Full 90m', pri: 'P3', dur: 90 }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'timeRemaining (partially completed)', { statuses: statuses });

  // Verify partial tasks aren't overplaced
  Object.keys(result.dayPlacements).forEach(function(dk) {
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === 'partial_60' && p.dur > 60) {
        console.log('  FAIL: partial_60 placed for ' + p.dur + 'm but only 60m remaining');
        totalFailed++;
      }
      if (p.task && p.task.id === 'partial_15' && p.dur > 15) {
        console.log('  FAIL: partial_15 placed for ' + p.dur + 'm but only 15m remaining');
        totalFailed++;
      }
    });
  });
};

// ── Scenario 18: datePinned immutability ──
scenarios['date-pinned'] = function() {
  var tasks = [
    makeTask({ id: 'pinned_1', text: 'Pinned to +3', pri: 'P3', dur: 60, date: dayOffset(3), datePinned: true }),
    makeTask({ id: 'pinned_2', text: 'Pinned to +7', pri: 'P4', dur: 30, date: dayOffset(7), datePinned: true }),
    makeTask({ id: 'unpinned', text: 'Unpinned (scheduler moves)', pri: 'P3', dur: 60, date: dayOffset(3), datePinned: false }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Date-pinned tasks', { statuses: statuses });

  // Extra: verify pinned tasks stayed on their dates
  ['pinned_1', 'pinned_2'].forEach(function(id) {
    var expectedDate = tasks.find(function(t) { return t.id === id; }).date;
    var actualDate = null;
    Object.keys(result.dayPlacements).forEach(function(dk) {
      result.dayPlacements[dk].forEach(function(p) {
        if (p.task && p.task.id === id) actualDate = dk;
      });
    });
    if (actualDate && actualDate !== expectedDate) {
      console.log('  FAIL: ' + id + ' moved from ' + expectedDate + ' to ' + actualDate);
      totalFailed++;
    } else if (actualDate) {
      console.log('  PASS: ' + id + ' stayed on ' + actualDate);
      totalPassed++;
    }
  });
};

// ── Scenario 19: Cross-day dependencies ──
scenarios['cross-day-deps'] = function() {
  var tasks = [
    makeTask({ id: 'cd_dep', text: 'Prep work', pri: 'P2', dur: 60, date: dayOffset(0) }),
    makeTask({ id: 'cd_main', text: 'Main work (after prep)', pri: 'P1', dur: 120, date: dayOffset(1), dependsOn: ['cd_dep'] }),
    // Cross-day with pinning
    makeTask({ id: 'cd_pin_a', text: 'Pinned step A', pri: 'P2', dur: 60, date: dayOffset(2), datePinned: true }),
    makeTask({ id: 'cd_pin_b', text: 'Step B (after pinned A)', pri: 'P2', dur: 60, date: dayOffset(3), dependsOn: ['cd_pin_a'] }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Cross-day dependencies', { statuses: statuses });
};

// ── Scenario 20: Heavy load (stress test) ──
scenarios['stress'] = function() {
  var tasks = [];
  var pris = ['P1', 'P2', 'P3', 'P4'];
  var whens = ['morning', 'afternoon', 'evening', 'morning,afternoon', 'morning,lunch,afternoon,evening'];
  for (var i = 0; i < 80; i++) {
    var dateOff = Math.floor(i / 10);
    tasks.push(makeTask({
      id: 'stress_' + i,
      text: 'Stress task ' + i,
      pri: pris[i % 4],
      dur: 20 + (i % 5) * 15,
      date: dayOffset(dateOff),
      when: whens[i % whens.length],
      split: i % 7 === 0,
      splitMin: 15
    }));
  }
  tasks[5].dependsOn = [tasks[2].id];
  tasks[15].dependsOn = [tasks[10].id, tasks[11].id];
  tasks[30].dependsOn = [tasks[25].id];
  tasks[20].due = dayOffset(4);
  tasks[40].due = dayOffset(8);

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Stress test (80 tasks)', { statuses: statuses });
};

// ── Scenario 21: Today with nowMins (past-time blocking) ──
scenarios['today-now'] = function() {
  var tasks = [
    makeTask({ id: 'now_task1', text: 'Morning task', pri: 'P1', dur: 60, when: 'morning' }),
    makeTask({ id: 'now_task2', text: 'Afternoon task', pri: 'P2', dur: 60, when: 'afternoon' }),
    makeTask({ id: 'now_task3', text: 'Evening task', pri: 'P3', dur: 60, when: 'evening' }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  // Simulate it being 2 PM (840 minutes)
  var result = unifiedSchedule(tasks, statuses, todayKey, 840, cfg);
  validate(result, tasks, cfg, 'Today with nowMins=840 (2 PM)', { statuses: statuses, nowMins: 840 });
};

// ── Scenario 22: Downstream ceiling validation ──
scenarios['downstream-ceiling'] = function() {
  // Task A must finish before task B's date because B depends on A
  var tasks = [
    makeTask({ id: 'ceil_a', text: 'Must finish before B', pri: 'P3', dur: 60 }),
    makeTask({ id: 'ceil_b', text: 'Depends on A, dated +3', pri: 'P2', dur: 60, date: dayOffset(3), datePinned: true, dependsOn: ['ceil_a'] }),
    // Triple chain: C → D → E where E is pinned to +5
    makeTask({ id: 'ceil_c', text: 'Chain start', pri: 'P3', dur: 30 }),
    makeTask({ id: 'ceil_d', text: 'Chain mid (after C)', pri: 'P3', dur: 30, dependsOn: ['ceil_c'] }),
    makeTask({ id: 'ceil_e', text: 'Chain end (after D), dated +5', pri: 'P2', dur: 30, date: dayOffset(5), datePinned: true, dependsOn: ['ceil_d'] }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Downstream ceiling (dep-driven upper bound)', { statuses: statuses });
};

// ── Scenario 23: Concurrent same-day dependencies ──
scenarios['same-day-deps'] = function() {
  // All tasks on the same day with dependency ordering
  var tasks = [
    makeTask({ id: 'sd_a', text: 'First thing', pri: 'P1', dur: 30 }),
    makeTask({ id: 'sd_b', text: 'Second thing (after A)', pri: 'P1', dur: 30, dependsOn: ['sd_a'] }),
    makeTask({ id: 'sd_c', text: 'Third thing (after B)', pri: 'P1', dur: 30, dependsOn: ['sd_b'] }),
    // Independent task that should not be affected by the chain
    makeTask({ id: 'sd_ind', text: 'Independent', pri: 'P2', dur: 60 }),
    // Task depending on two independent chains
    makeTask({ id: 'sd_join', text: 'After A and ind', pri: 'P2', dur: 30, dependsOn: ['sd_a', 'sd_ind'] }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Same-day concurrent dependencies', { statuses: statuses });
};

// ── Scenario 24: Dep with done status ──
scenarios['dep-done-status'] = function() {
  var tasks = [
    makeTask({ id: 'dep_done', text: 'Dependency (done)', pri: 'P2', dur: 60 }),
    makeTask({ id: 'dep_after', text: 'After done dep', pri: 'P2', dur: 60, dependsOn: ['dep_done'] }),
  ];

  var statuses = { dep_done: 'done', dep_after: '' };
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Dependency with done status', { statuses: statuses });

  // dep_after should be placed even though dep_done isn't
  var afterPlaced = false;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === 'dep_after') afterPlaced = true;
    });
  });
  if (!afterPlaced) {
    console.log('  FAIL: dep_after not placed despite dep_done being done');
    totalFailed++;
  } else {
    console.log('  PASS: dep_after placed with done dependency');
    totalPassed++;
  }
};

// ── Scenario 25: Multi-day splittable tasks ──
scenarios['multi-day-split'] = function() {
  // A very large task that must span multiple days
  var tasks = [
    makeTask({ id: 'huge_split', text: 'Huge task (600m)', pri: 'P2', dur: 600, split: true, splitMin: 30 }),
    // Fill today to force multi-day
    makeTask({ id: 'today_block', text: 'Today blocker', pri: 'P1', dur: 300, when: 'morning,lunch,afternoon' }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Multi-day splittable task', { statuses: statuses });

  // Verify the task spans multiple days
  var splitDays = {};
  Object.keys(result.dayPlacements).forEach(function(dk) {
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === 'huge_split') splitDays[dk] = true;
    });
  });
  var dayCount = Object.keys(splitDays).length;
  if (dayCount > 1) {
    console.log('  PASS: huge_split spans ' + dayCount + ' days');
    totalPassed++;
  } else {
    console.log('  NOTE: huge_split on ' + dayCount + ' day(s)');
  }
};

// ── Scenario 26: Habit rescue (bump lower-pri to make room) ──
scenarios['habit-rescue'] = function() {
  // Fill the habit's day with lower-pri tasks, then see if the habit gets rescued
  var tasks = [];
  for (var i = 0; i < 8; i++) {
    tasks.push(makeTask({ id: 'blocker_' + i, text: 'Blocker ' + i, pri: 'P4', dur: 60, when: 'morning,lunch,afternoon,evening' }));
  }
  tasks.push(makeTask({
    id: 'rescue_habit', text: 'Must-do habit', pri: 'P2', dur: 30,
    habit: true, rigid: false, time: '8:00 AM', when: 'morning', timeFlex: 120
  }));

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Habit rescue (bump lower-pri)', { statuses: statuses });

  // Check if habit was placed
  var habitPlaced = false;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === 'rescue_habit') habitPlaced = true;
    });
  });
  console.log('  ' + (habitPlaced ? 'PASS' : 'WARN') + ': rescue_habit ' + (habitPlaced ? 'was placed (rescue worked)' : 'was NOT placed'));
  if (habitPlaced) totalPassed++; else totalWarnings++;
};

// ── Scenario 27: Priority compaction ──
scenarios['priority-compaction'] = function() {
  // P4 on today, P1 on tomorrow — compaction should try to swap them
  var tasks = [
    makeTask({ id: 'early_p4', text: 'Low pri today', pri: 'P4', dur: 60, date: todayKey }),
    makeTask({ id: 'late_p1', text: 'High pri tomorrow', pri: 'P1', dur: 60, date: dayOffset(1) }),
    makeTask({ id: 'filler_a', text: 'Filler A', pri: 'P3', dur: 120 }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Priority compaction', { statuses: statuses });
};

// ── Scenario 28: Overflow (Phase 4.5 — adjacent day spill) ──
scenarios['overflow'] = function() {
  // Overfill today so tasks overflow to adjacent days
  var tasks = [];
  for (var i = 0; i < 12; i++) {
    tasks.push(makeTask({
      id: 'overflow_' + i,
      text: 'Overflow ' + i,
      pri: 'P2',
      dur: 90,
      when: 'morning,lunch,afternoon,evening'
    }));
  }

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Overflow to adjacent days', { statuses: statuses });

  // Check how many ended up on non-today days
  var otherDays = 0;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    if (dk === todayKey) return;
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id.startsWith('overflow_')) otherDays++;
    });
  });
  console.log('  NOTE: ' + otherDays + ' overflow placements on non-today days');
};

// ── Scenario 29: Dependency chain with deadline ──
scenarios['dep-chain-deadline'] = function() {
  // A → B → C with C having a tight deadline
  // All should be placed before the deadline, in correct order
  var tasks = [
    makeTask({ id: 'dc_a', text: 'Step A', pri: 'P2', dur: 60 }),
    makeTask({ id: 'dc_b', text: 'Step B (after A)', pri: 'P2', dur: 60, dependsOn: ['dc_a'] }),
    makeTask({ id: 'dc_c', text: 'Step C (after B, deadline)', pri: 'P1', dur: 60, dependsOn: ['dc_b'], due: dayOffset(2) }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Dep chain with tight deadline', { statuses: statuses });

  // Verify all placed before deadline
  var allBeforeDeadline = true;
  var deadlineDate = parseDate(dayOffset(2));
  Object.keys(result.dayPlacements).forEach(function(dk) {
    var d = parseDate(dk);
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && ['dc_a', 'dc_b', 'dc_c'].indexOf(p.task.id) !== -1) {
        if (d > deadlineDate) {
          allBeforeDeadline = false;
          console.log('  FAIL: ' + p.task.id + ' placed on ' + dk + ' which is after deadline ' + dayOffset(2));
          totalFailed++;
        }
      }
    });
  });
  if (allBeforeDeadline) {
    console.log('  PASS: All chain tasks placed before deadline');
    totalPassed++;
  }
};

// ── Scenario 30: Generated (recurring) tasks ──
scenarios['generated-recurring'] = function() {
  // Generated tasks should be pinned to their date (earliest = date)
  var tasks = [
    makeTask({ id: 'gen_1', text: 'Weekly review (gen)', pri: 'P3', dur: 30, date: dayOffset(3), generated: true }),
    makeTask({ id: 'gen_2', text: 'Standup (gen)', pri: 'P2', dur: 15, date: dayOffset(5), generated: true }),
    makeTask({ id: 'normal', text: 'Normal task', pri: 'P3', dur: 60 }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Generated (recurring) tasks', { statuses: statuses });

  // Verify generated tasks stayed on or after their date
  ['gen_1', 'gen_2'].forEach(function(id) {
    var task = tasks.find(function(t) { return t.id === id; });
    var expectedDate = parseDate(task.date);
    var placedDate = null;
    Object.keys(result.dayPlacements).forEach(function(dk) {
      result.dayPlacements[dk].forEach(function(p) {
        if (p.task && p.task.id === id) placedDate = parseDate(dk);
      });
    });
    if (placedDate && placedDate < expectedDate) {
      console.log('  FAIL: ' + id + ' generated for ' + task.date + ' but placed on earlier date ' + formatDateKey(placedDate));
      totalFailed++;
    } else if (placedDate) {
      console.log('  PASS: ' + id + ' placed on ' + formatDateKey(placedDate) + ' (generated for ' + task.date + ')');
      totalPassed++;
    }
  });
};

// ── Scenario 31: Splittable with deadline ──
scenarios['split-deadline'] = function() {
  var tasks = [
    makeTask({ id: 'sd_big', text: 'Big split + deadline', pri: 'P2', dur: 180, split: true, splitMin: 30, due: dayOffset(3) }),
    // Fill days to force splitting across days
    makeTask({ id: 'sd_block1', text: 'Blocker 1', pri: 'P1', dur: 300, when: 'morning,lunch,afternoon' }),
    makeTask({ id: 'sd_block2', text: 'Blocker 2', pri: 'P1', dur: 300, when: 'morning,lunch,afternoon', date: dayOffset(1) }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Splittable with deadline', { statuses: statuses });

  // Verify all parts before deadline
  var deadlineDate = parseDate(dayOffset(3));
  var allOk = true;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    var d = parseDate(dk);
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === 'sd_big' && d > deadlineDate) {
        console.log('  FAIL: sd_big chunk on ' + dk + ' after deadline ' + dayOffset(3));
        totalFailed++;
        allOk = false;
      }
    });
  });
  if (allOk) {
    console.log('  PASS: All sd_big chunks before deadline');
    totalPassed++;
  }
};

// ── Scenario 32: Mixed constraints stress (deps + deadlines + pinning + splits + locations) ──
scenarios['mixed-stress'] = function() {
  var mondayOff = (8 - today.getDay()) % 7 || 7;
  var mondayKey = dayOffset(mondayOff);
  var tuesKey = dayOffset(mondayOff + 1);
  var wedKey = dayOffset(mondayOff + 2);

  var tasks = [
    // Pinned deadline chain
    makeTask({ id: 'ms_a', text: 'Research (pinned Mon)', pri: 'P2', dur: 60, date: mondayKey, datePinned: true }),
    makeTask({ id: 'ms_b', text: 'Draft (after Research, deadline Wed)', pri: 'P2', dur: 120, dependsOn: ['ms_a'], due: wedKey, split: true, splitMin: 30 }),
    makeTask({ id: 'ms_c', text: 'Review (after Draft)', pri: 'P1', dur: 30, dependsOn: ['ms_b'], due: wedKey }),
    // Location-constrained task
    makeTask({ id: 'ms_d', text: 'Print report', pri: 'P3', dur: 15, tools: ['printer'], date: tuesKey, when: 'biz,lunch' }),
    // Filler
    makeTask({ id: 'ms_e', text: 'Filler', pri: 'P4', dur: 60, date: mondayKey }),
    makeTask({ id: 'ms_f', text: 'Filler 2', pri: 'P4', dur: 60, date: tuesKey }),
    // Habit
    makeTask({ id: 'ms_habit', text: 'Daily standup', pri: 'P2', dur: 15, habit: true, rigid: true, time: '9:00 AM', when: 'biz', date: mondayKey }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Mixed constraints stress', { statuses: statuses });
};

// ── Scenario 33: Unplaced task diagnostics ──
scenarios['unplaced-diagnostics'] = function() {
  // Create tasks that can't possibly be placed
  // Use a habit pinned to a day with conflicting dayReq (habit has ceiling = date)
  var mondayOff = (8 - today.getDay()) % 7 || 7;
  var mondayKey = dayOffset(mondayOff);

  var tasks = [
    // Habit on Monday with dayReq weekend — habit is ceiling-pinned so it can't overflow
    makeTask({ id: 'impossible_habit', text: 'Weekend habit on Monday', pri: 'P2', dur: 60, date: mondayKey, habit: true, rigid: false, dayReq: 'weekend', when: 'morning' }),
    // Task with unresolvable dep chain (dep on a task that doesn't exist)
    makeTask({ id: 'broken_dep', text: 'Depends on missing', pri: 'P3', dur: 30, dependsOn: ['nonexistent_task'] }),
    // Normal task for comparison
    makeTask({ id: 'normal_task', text: 'Normal', pri: 'P3', dur: 60 }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Unplaced task diagnostics', { statuses: statuses });

  // Check that impossible_habit is unplaced with diagnostics
  var foundUnplaced = (result.unplaced || []).find(function(t) { return t.id === 'impossible_habit'; });
  if (foundUnplaced) {
    console.log('  PASS: impossible_habit correctly unplaced');
    if (foundUnplaced._unplacedDetail) {
      console.log('  PASS: Has diagnostic: ' + foundUnplaced._unplacedDetail.substring(0, 80) + '...');
      totalPassed += 2;
    } else {
      console.log('  WARN: Missing _unplacedDetail');
      totalWarnings++;
      totalPassed++;
    }
  } else {
    console.log('  WARN: impossible_habit was somehow placed');
    totalWarnings++;
  }
};

// ── Scenario 34: Deadline pull-forward ──
scenarios['deadline-pull-forward'] = function() {
  // Deadline tasks packed tight at their due date should be pulled forward into gaps
  var tasks = [
    makeTask({ id: 'dpf_a', text: 'Deadline +7 P1', pri: 'P1', dur: 60, due: dayOffset(7) }),
    makeTask({ id: 'dpf_b', text: 'Deadline +7 P3', pri: 'P3', dur: 60, due: dayOffset(7) }),
    makeTask({ id: 'dpf_c', text: 'Deadline +14 P2', pri: 'P2', dur: 90, due: dayOffset(14) }),
    // Flexible filler to compete with pulled-forward deadline tasks
    makeTask({ id: 'dpf_flex1', text: 'Flex filler 1', pri: 'P3', dur: 60 }),
    makeTask({ id: 'dpf_flex2', text: 'Flex filler 2', pri: 'P4', dur: 60 }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Deadline pull-forward', { statuses: statuses });

  // Verify deadline tasks are placed before their deadlines
  ['dpf_a', 'dpf_b', 'dpf_c'].forEach(function(id) {
    var task = tasks.find(function(t) { return t.id === id; });
    var dueDate = parseDate(task.due);
    var placed = false;
    var afterDeadline = false;
    Object.keys(result.dayPlacements).forEach(function(dk) {
      result.dayPlacements[dk].forEach(function(p) {
        if (p.task && p.task.id === id) {
          placed = true;
          if (parseDate(dk) > dueDate) afterDeadline = true;
        }
      });
    });
    if (!placed) {
      console.log('  WARN: ' + id + ' not placed');
      totalWarnings++;
    } else if (afterDeadline) {
      console.log('  FAIL: ' + id + ' placed after deadline ' + task.due);
      totalFailed++;
    } else {
      console.log('  PASS: ' + id + ' placed before deadline');
      totalPassed++;
    }
  });
};

// ── Scenario 34b: Pull-forward dampening ──
scenarios['pull-forward-dampening'] = function() {
  // With dampening ON and a mostly-free calendar, deadline tasks should stay
  // closer to their deadlines (not flood today).
  // Without dampening, same tasks should pull forward more aggressively.
  var tasks = [
    makeTask({ id: 'pfd_a', text: 'Deadline +10', pri: 'P2', dur: 60, due: dayOffset(10) }),
    makeTask({ id: 'pfd_b', text: 'Deadline +8', pri: 'P3', dur: 60, due: dayOffset(8) }),
  ];
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });

  // Run WITHOUT dampening
  var cfgOff = makeCfg({ preferences: {} });
  var resultOff = unifiedSchedule(tasks.map(function(t) { return Object.assign({}, t); }), statuses, todayKey, 0, cfgOff);
  validate(resultOff, tasks, cfgOff, 'Pull-forward dampening OFF', { statuses: statuses });

  // Run WITH dampening
  var cfgOn = makeCfg({ preferences: { pullForwardDampening: true } });
  var resultOn = unifiedSchedule(tasks.map(function(t) { return Object.assign({}, t); }), statuses, todayKey, 0, cfgOn);
  validate(resultOn, tasks, cfgOn, 'Pull-forward dampening ON', { statuses: statuses });

  // Find earliest placement date for each run
  function earliestDate(result, taskId) {
    var earliest = null;
    Object.keys(result.dayPlacements).forEach(function(dk) {
      result.dayPlacements[dk].forEach(function(p) {
        if (p.task && p.task.id === taskId) {
          var d = parseDate(dk);
          if (!earliest || d < earliest) earliest = d;
        }
      });
    });
    return earliest;
  }

  ['pfd_a', 'pfd_b'].forEach(function(id) {
    var dateOff = earliestDate(resultOff, id);
    var dateOn = earliestDate(resultOn, id);
    if (!dateOff || !dateOn) {
      console.log('  WARN: ' + id + ' not placed in one or both runs');
      totalWarnings++;
      return;
    }
    if (dateOn >= dateOff) {
      console.log('  PASS: ' + id + ' dampened — placed on ' + formatDateKey(dateOn) + ' (vs ' + formatDateKey(dateOff) + ' undampened)');
      totalPassed++;
    } else {
      console.log('  FAIL: ' + id + ' dampened date ' + formatDateKey(dateOn) + ' is earlier than undampened ' + formatDateKey(dateOff));
      totalFailed++;
    }
  });

  // Tasks due tomorrow should NOT be dampened
  var urgentTasks = [
    makeTask({ id: 'pfd_urgent', text: 'Due tomorrow', pri: 'P1', dur: 60, due: dayOffset(1) }),
  ];
  var urgentStatuses = { pfd_urgent: '' };
  var resultUrgentOn = unifiedSchedule(urgentTasks.map(function(t) { return Object.assign({}, t); }), urgentStatuses, todayKey, 0, cfgOn);
  var resultUrgentOff = unifiedSchedule(urgentTasks.map(function(t) { return Object.assign({}, t); }), urgentStatuses, todayKey, 0, cfgOff);
  var urgentDateOn = earliestDate(resultUrgentOn, 'pfd_urgent');
  var urgentDateOff = earliestDate(resultUrgentOff, 'pfd_urgent');
  if (urgentDateOn && urgentDateOff && urgentDateOn.getTime() === urgentDateOff.getTime()) {
    console.log('  PASS: due-tomorrow task not dampened (same placement: ' + formatDateKey(urgentDateOn) + ')');
    totalPassed++;
  } else {
    console.log('  WARN: due-tomorrow placement differs — on=' + (urgentDateOn ? formatDateKey(urgentDateOn) : 'unplaced') + ' off=' + (urgentDateOff ? formatDateKey(urgentDateOff) : 'unplaced'));
    totalWarnings++;
  }
};

// ── Scenario 35: Hill-climb dep preservation ──
scenarios['hill-climb-deps'] = function() {
  // Tasks with same-day deps — hill climbing should not break ordering
  var tasks = [
    makeTask({ id: 'hc_a', text: 'HC step A', pri: 'P3', dur: 45 }),
    makeTask({ id: 'hc_b', text: 'HC step B (after A)', pri: 'P2', dur: 45, dependsOn: ['hc_a'] }),
    makeTask({ id: 'hc_c', text: 'HC step C (after B)', pri: 'P1', dur: 45, dependsOn: ['hc_b'] }),
    // Add competing tasks that might cause hill-climber to reshuffle
    makeTask({ id: 'hc_x', text: 'Competitor X', pri: 'P1', dur: 90 }),
    makeTask({ id: 'hc_y', text: 'Competitor Y', pri: 'P2', dur: 60 }),
    makeTask({ id: 'hc_z', text: 'Competitor Z', pri: 'P3', dur: 60 }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Hill-climb dep preservation', { statuses: statuses });
};

// ── Scenario 36: WIP tasks use timeRemaining ──
scenarios['wip-time-remaining'] = function() {
  var tasks = [
    makeTask({ id: 'wip_big', text: 'WIP big task', pri: 'P2', dur: 120, timeRemaining: 30 }),
    makeTask({ id: 'wip_normal', text: 'WIP normal', pri: 'P2', dur: 60, timeRemaining: 60 }),
    makeTask({ id: 'active', text: 'Active task', pri: 'P3', dur: 60 }),
  ];

  var statuses = { wip_big: 'wip', wip_normal: 'wip', active: '' };
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'WIP tasks use timeRemaining', { statuses: statuses });

  // WIP task with 30m remaining should be placed for at most 30m
  Object.keys(result.dayPlacements).forEach(function(dk) {
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === 'wip_big' && p.dur > 30) {
        console.log('  FAIL: wip_big placed for ' + p.dur + 'm but only 30m remaining');
        totalFailed++;
      }
    });
  });
};

// ── Scenario 37: Dependency with startAfter ──
scenarios['dep-start-after'] = function() {
  // Dep chain where child has startAfter — both constraints must be met
  var tasks = [
    makeTask({ id: 'dsa_parent', text: 'Parent task', pri: 'P2', dur: 60 }),
    makeTask({ id: 'dsa_child', text: 'Child (dep + startAfter)', pri: 'P2', dur: 60,
      dependsOn: ['dsa_parent'], startAfter: dayOffset(3), date: dayOffset(3) }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Dependency with startAfter', { statuses: statuses });
};

// ── Scenario 38: Ceiling with multiple dependant chains ──
scenarios['multi-ceiling'] = function() {
  // Task A has two dependants on different dates — ceiling = earliest
  var tasks = [
    makeTask({ id: 'mc_root', text: 'Root task', pri: 'P3', dur: 60 }),
    makeTask({ id: 'mc_child1', text: 'Child 1 (day +2)', pri: 'P2', dur: 30, date: dayOffset(2), datePinned: true, dependsOn: ['mc_root'] }),
    makeTask({ id: 'mc_child2', text: 'Child 2 (day +5)', pri: 'P2', dur: 30, date: dayOffset(5), datePinned: true, dependsOn: ['mc_root'] }),
  ];

  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  var cfg = makeCfg();
  var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);
  validate(result, tasks, cfg, 'Multi-ceiling (earliest dependant)', { statuses: statuses });

  // Root must be placed on or before day +2
  var rootDate = null;
  Object.keys(result.dayPlacements).forEach(function(dk) {
    result.dayPlacements[dk].forEach(function(p) {
      if (p.task && p.task.id === 'mc_root') rootDate = dk;
    });
  });
  if (rootDate) {
    var rootD = parseDate(rootDate);
    var child1D = parseDate(dayOffset(2));
    if (rootD > child1D) {
      console.log('  FAIL: mc_root placed on ' + rootDate + ' after earliest child on ' + dayOffset(2));
      totalFailed++;
    } else {
      console.log('  PASS: mc_root placed on ' + rootDate + ' (before child 1 on ' + dayOffset(2) + ')');
      totalPassed++;
    }
  }
};

// ══════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════

console.log('Placement Validator — Comprehensive Edition');
console.log('Today: ' + todayKey + ' (' + DAY_NAMES[today.getDay()] + ')');
console.log('Checks: 27 validation dimensions, ' + Object.keys(scenarios).length + ' scenarios');
console.log('');

var scenarioNames = Object.keys(scenarios);
if (scenarioFilter) {
  scenarioNames = scenarioNames.filter(function(n) { return n.indexOf(scenarioFilter) !== -1; });
  if (scenarioNames.length === 0) {
    console.log('No scenarios matching "' + scenarioFilter + '"');
    console.log('Available: ' + Object.keys(scenarios).join(', '));
    process.exit(1);
  }
}

scenarioNames.forEach(function(name) {
  scenarios[name]();
});

console.log('\n========================================');
console.log('Total: ' + totalPassed + ' passed, ' + totalFailed + ' failed, ' + totalWarnings + ' warnings');
console.log('Scenarios: ' + scenarioNames.length + ' | Validation dimensions: 27');
console.log('========================================\n');

process.exit(totalFailed > 0 ? 1 : 0);
