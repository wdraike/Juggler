/**
 * Schedule validator: run the scheduler (same path as runSchedule.js)
 * and check for overlaps, priority inversions, location violations,
 * when-window violations, deadline misses, and dependency ordering issues.
 */
var db = require('../db');
var unifiedSchedule = require('./unifiedSchedule');
var constants = require('./constants');
var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DEFAULT_TOOL_MATRIX = constants.DEFAULT_TOOL_MATRIX;
var DAY_NAMES = constants.DAY_NAMES;
var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var timeBlockHelpers = require('./timeBlockHelpers');
var getBlocksForDate = timeBlockHelpers.getBlocksForDate;
var buildWindowsFromBlocks = timeBlockHelpers.buildWindowsFromBlocks;
var getWhenWindows = timeBlockHelpers.getWhenWindows;
var hasWhen = timeBlockHelpers.hasWhen;
var locationHelpers = require('./locationHelpers');
var resolveLocationId = locationHelpers.resolveLocationId;
var canTaskRun = locationHelpers.canTaskRun;
var dependencyHelpers = require('./dependencyHelpers');
var getTaskDeps = dependencyHelpers.getTaskDeps;
var taskController = require('../controllers/task.controller');
var rowToTask = taskController.rowToTask;
var buildSourceMap = taskController.buildSourceMap;
var expandRecurringMod = require('../../../shared/scheduler/expandRecurring');
var expandRecurring = expandRecurringMod.expandRecurring;

var DEFAULT_TIMEZONE = 'America/New_York';

function getNowInTimezone(tz) {
  var now = new Date();
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(now);
  var vals = {};
  parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });
  var hour = vals.hour % 24;
  return { todayKey: vals.month + '/' + vals.day, nowMins: hour * 60 + vals.minute };
}

async function loadConfig(userId) {
  var rows = await db('user_config').where('user_id', userId).select();
  var config = {};
  rows.forEach(function(row) {
    var val = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value;
    config[row.config_key] = val;
  });
  return {
    timeBlocks: config.time_blocks || DEFAULT_TIME_BLOCKS,
    toolMatrix: config.tool_matrix || DEFAULT_TOOL_MATRIX,
    locSchedules: config.loc_schedules || {},
    locScheduleDefaults: config.loc_schedule_defaults || {},
    locScheduleOverrides: config.loc_schedule_overrides || {},
    hourLocationOverrides: config.hour_location_overrides || {},
    scheduleTemplates: config.schedule_templates || null,
    preferences: config.preferences || {},
    splitDefault: config.preferences ? config.preferences.splitDefault : undefined,
    splitMinDefault: config.preferences ? config.preferences.splitMinDefault : undefined
  };
}

function fmtTime(mins) {
  return Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0');
}

function fmtRange(start, dur) {
  return fmtTime(start) + '-' + fmtTime(start + dur);
}

// ── Validation checks ──

function checkOverlaps(dayPlacements) {
  var issues = [];
  Object.keys(dayPlacements).forEach(function(dk) {
    var placed = dayPlacements[dk];
    if (!placed || placed.length < 2) return;
    // Filter out markers — they don't reserve occupancy and can't overlap
    var nonMarkers = placed.filter(function(p) { return !p.marker; });
    if (nonMarkers.length < 2) return;
    var sorted = nonMarkers.slice().sort(function(a, b) { return a.start - b.start; });
    for (var i = 0; i < sorted.length - 1; i++) {
      var curr = sorted[i];
      var next = sorted[i + 1];
      if (next.start < curr.start + curr.dur) {
        issues.push({
          date: dk,
          msg: (curr.task.text || '?') + ' (' + curr.task.id + ') ' + fmtRange(curr.start, curr.dur) +
            ' overlaps ' + (next.task.text || '?') + ' (' + next.task.id + ') ' + fmtRange(next.start, next.dur) +
            ' by ' + (curr.start + curr.dur - next.start) + 'min'
        });
      }
    }
  });
  return issues;
}

function checkPriorityInversions(dayPlacements, unplacedItems, allTasks, cfg, todayKey, nowMins) {
  var issues = [];
  var priRank = { P1: 1, P2: 2, P3: 3, P4: 4 };
  // Build per-day map of lowest-priority placed task (exclude markers)
  var worstByDay = {}; // { dateKey: { rank, id, pri, text } }
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      var r = priRank[p.task.pri || 'P3'] || 3;
      var prev = worstByDay[dk];
      if (!prev || r > prev.rank) {
        worstByDay[dk] = { rank: r, id: p.task.id, pri: p.task.pri || 'P3', text: p.task.text };
      }
    });
  });

  // Helper: check if task's when-windows have any free capacity on the day
  function hasPlaceableWindow(u, dk) {
    if (!u.when || u.when === 'anytime' || hasWhen(u.when, 'fixed') || u.flexWhen) return true;
    var blocks = getBlocksForDate(dk, cfg.timeBlocks, cfg);
    var dateWindows = buildWindowsFromBlocks(blocks);
    var wins = getWhenWindows(u.when, dateWindows);
    if (wins.length === 0) return false; // no matching windows on this day
    // On today, check if all windows are past-blocked
    if (dk === todayKey && nowMins) {
      var anyFuture = wins.some(function(w) { return w[1] > nowMins; });
      if (!anyFuture) return false;
    }
    return true;
  }

  // Helper: check day_req feasibility
  function dayReqOk(u, dk) {
    var dr = u.dayReq;
    if (!dr || dr === 'any') return true;
    var d = parseDate(dk);
    if (!d) return true;
    var dow = d.getDay();
    var isWeekday = dow >= 1 && dow <= 5;
    if (dr === 'weekday' && !isWeekday) return false;
    if (dr === 'weekend' && isWeekday) return false;
    var dm = { M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, Su: 0, S: 6 };
    var parts = dr.split(',');
    if (parts.length > 1 || dm[parts[0]] !== undefined) {
      var match = parts.some(function(p) { return dm[p] !== undefined && dm[p] === dow; });
      if (!match) return false;
    }
    return true;
  }

  // For each unplaced task, check if lower-priority tasks are placed on the same day
  unplacedItems.forEach(function(u) {
    var uRank = priRank[u.pri || 'P3'] || 3;
    var dk = u.date;
    var worst = worstByDay[dk];
    if (worst && uRank < worst.rank) {
      // Skip false positives: task can't actually place on this day
      if (!dayReqOk(u, dk)) return;
      if (!hasPlaceableWindow(u, dk)) return;
      issues.push({
        msg: dk + ': Unplaced ' + u.pri + ' "' + u.text + '" (' + u.id +
          ') while ' + worst.pri + ' "' + worst.text + '" is placed on same day'
      });
    }
  });
  return issues;
}

function checkLocationViolations(dayPlacements, cfg) {
  var issues = [];
  Object.keys(dayPlacements).forEach(function(dk) {
    var blocks = getBlocksForDate(dk, cfg.timeBlocks, cfg);
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.locked || p.marker) return; // skip rigid/fixed/marker items
      var t = p.task;
      if (!t.location || t.location.length === 0) return; // no location constraint
      // Check at start AND end of placement
      var checkPoints = [p.start, p.start + p.dur - 1];
      for (var ci = 0; ci < checkPoints.length; ci++) {
        var min = checkPoints[ci];
        var locId = resolveLocationId(dk, min, cfg, blocks);
        if (!canTaskRun(t, locId, cfg.toolMatrix)) {
          issues.push({
            date: dk,
            msg: '"' + t.text + '" (' + t.id + ') at ' + fmtRange(p.start, p.dur) +
              ' requires ' + JSON.stringify(t.location) + ' but location at ' + fmtTime(min) + ' is "' + locId + '"'
          });
          break; // one per placement
        }
      }
    });
  });
  return issues;
}

function checkWhenViolations(dayPlacements, cfg) {
  var issues = [];
  Object.keys(dayPlacements).forEach(function(dk) {
    var blocks = getBlocksForDate(dk, cfg.timeBlocks, cfg);
    var dateWindows = buildWindowsFromBlocks(blocks);
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.locked || p.marker) return;
      var t = p.task;
      if (!t.when || t.when === 'anytime' || hasWhen(t.when, 'fixed') || hasWhen(t.when, 'allday')) return;
      if (t.flexWhen) return; // flex-when tasks intentionally place outside preferred windows
      var wins = getWhenWindows(t.when, dateWindows);
      if (wins.length === 0) {
        // Task has explicit when-tags but none match any block on this day
        issues.push({
          date: dk,
          msg: '"' + t.text + '" (' + t.id + ') at ' + fmtRange(p.start, p.dur) +
            ' — when-tag "' + t.when + '" has no matching blocks on this day'
        });
        return;
      }
      var inWin = false;
      for (var wi = 0; wi < wins.length; wi++) {
        if (p.start >= wins[wi][0] && p.start + p.dur <= wins[wi][1]) { inWin = true; break; }
        // Partial overlap is OK for split tasks
        if (p.start < wins[wi][1] && p.start + p.dur > wins[wi][0]) { inWin = true; break; }
      }
      if (!inWin) {
        issues.push({
          date: dk,
          msg: '"' + t.text + '" (' + t.id + ') at ' + fmtRange(p.start, p.dur) +
            ' outside when-windows "' + t.when + '" ' + JSON.stringify(wins)
        });
      }
    });
  });
  return issues;
}

function checkDeadlineMisses(dayPlacements, allTasks, todayKey) {
  var issues = [];
  var today = parseDate(todayKey) || new Date();
  // Build map of last placement date per task
  var lastDateByTask = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    var dkDate = parseDate(dk);
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task) return;
      var prev = lastDateByTask[p.task.id];
      if (!prev || dkDate > prev) lastDateByTask[p.task.id] = dkDate;
    });
  });
  allTasks.forEach(function(t) {
    if (!t.due) return;
    var st = t.status || '';
    if (st === 'done' || st === 'cancel' || st === 'skip') return;
    var deadline = parseDate(t.due);
    if (!deadline) return;
    var lastDate = lastDateByTask[t.id];
    if (!lastDate) {
      // Not placed at all — is it past deadline?
      if (deadline < today) {
        issues.push({ msg: '"' + t.text + '" (' + t.id + ') due ' + t.due + ' — UNPLACED past deadline' });
      }
      return;
    }
    if (lastDate > deadline) {
      issues.push({
        msg: '"' + t.text + '" (' + t.id + ') due ' + t.due +
          ' but placed on ' + formatDateKey(lastDate) + ' (' +
          Math.round((lastDate - deadline) / 86400000) + ' days late)'
      });
    }
  });
  return issues;
}

function checkDependencyOrder(dayPlacements, allTasks, statuses) {
  var issues = [];
  // Build task lookup
  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Build earliest placement per task: { dateKey, startMin } — include ALL placements (locked too)
  var firstPlace = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    var dkDate = parseDate(dk);
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      var prev = firstPlace[p.task.id];
      if (!prev || dkDate < prev.date || (dkDate.getTime() === prev.date.getTime() && p.start < prev.startMin)) {
        firstPlace[p.task.id] = { date: dkDate, dateKey: dk, startMin: p.start, endMin: p.start + p.dur };
      }
    });
  });
  // Also build last placement per task (for endMin) — include ALL placements
  var lastPlace = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    var dkDate = parseDate(dk);
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      var prev = lastPlace[p.task.id];
      if (!prev || dkDate > prev.date || (dkDate.getTime() === prev.date.getTime() && p.start + p.dur > prev.endMin)) {
        lastPlace[p.task.id] = { date: dkDate, dateKey: dk, endMin: p.start + p.dur };
      }
    });
  });

  // Deduplicate: only check each task's deps once (not per-placement)
  var checked = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      if (checked[p.task.id]) return;
      checked[p.task.id] = true;
      var deps = getTaskDeps(p.task);
      deps.forEach(function(depId) {
        var depEnd = lastPlace[depId];
        var depTask = taskById[depId];
        var depStatus = statuses ? (statuses[depId] || '') : '';
        if (!depEnd) {
          // Dep not placed — flag if it's active (not done/skip/cancel)
          if (depTask && depStatus !== 'done' && depStatus !== 'cancel' && depStatus !== 'skip') {
            issues.push({
              msg: '"' + p.task.text + '" (' + p.task.id + ') depends on "' +
                (depTask ? depTask.text : depId) + '" (' + depId + ') which is NOT PLACED (status: ' + (depStatus || 'none') + ')'
            });
          }
          return;
        }
        var taskFirst = firstPlace[p.task.id];
        if (!taskFirst) return;
        // Dependency must end before (or on same day, before start of) dependant
        if (depEnd.date > taskFirst.date) {
          issues.push({
            msg: '"' + p.task.text + '" (' + p.task.id + ') on ' + taskFirst.dateKey +
              ' depends on "' + (depTask ? depTask.text : depId) + '" (' + depId +
              ') which ends ' + depEnd.dateKey + ' (after task starts)'
          });
        } else if (depEnd.dateKey === taskFirst.dateKey && depEnd.endMin > taskFirst.startMin) {
          issues.push({
            msg: '"' + p.task.text + '" (' + p.task.id + ') at ' + fmtTime(taskFirst.startMin) +
              ' depends on "' + (depTask ? depTask.text : depId) + '" (' + depId +
              ') which ends at ' + fmtTime(depEnd.endMin) + ' on ' + taskFirst.dateKey
          });
        }
      });
    });
  });
  return issues;
}

function checkStartAfterViolations(dayPlacements, allTasks) {
  var issues = [];
  // Build earliest placement per task
  var firstPlace = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    var dkDate = parseDate(dk);
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      var prev = firstPlace[p.task.id];
      if (!prev || dkDate < prev.date) {
        firstPlace[p.task.id] = { date: dkDate, dateKey: dk };
      }
    });
  });

  allTasks.forEach(function(t) {
    if (!t.startAfter) return;
    var fp = firstPlace[t.id];
    if (!fp) return; // not placed
    var saDate = parseDate(t.startAfter);
    if (!saDate) return;
    saDate.setHours(0, 0, 0, 0);
    if (fp.date < saDate) {
      issues.push({
        msg: '"' + t.text + '" (' + t.id + ') placed on ' + fp.dateKey +
          ' but has startAfter ' + t.startAfter
      });
    }
  });
  return issues;
}

function checkDayReqViolations(dayPlacements) {
  var issues = [];
  var dm = { M: 1, T: 2, W: 3, R: 4, F: 5, Sa: 6, Su: 0, S: 6 };
  Object.keys(dayPlacements).forEach(function(dk) {
    var dkDate = parseDate(dk);
    if (!dkDate) return;
    var dow = dkDate.getDay();
    var isWeekday = dow >= 1 && dow <= 5;
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.locked || p.marker) return;
      var dr = p.task.dayReq;
      if (!dr || dr === 'any') return;
      var violated = false;
      if (dr === 'weekday' && !isWeekday) violated = true;
      if (dr === 'weekend' && isWeekday) violated = true;
      if (!violated) {
        var parts = dr.split(',');
        if (parts.length > 1 || dm[parts[0]] !== undefined) {
          var match = parts.some(function(pp) { return dm[pp] !== undefined && dm[pp] === dow; });
          if (!match) violated = true;
        }
      }
      if (violated) {
        issues.push({
          date: dk,
          msg: '"' + p.task.text + '" (' + p.task.id + ') placed on ' + dk +
            ' (dow=' + dow + ') but dayReq="' + dr + '"'
        });
      }
    });
  });
  return issues;
}

function checkSplitMinViolations(dayPlacements) {
  var issues = [];
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      var t = p.task;
      if (!t.split) return; // only check splittable tasks
      var minChunk = t.splitMin || 15;
      // A chunk smaller than splitMin is only valid if it's the entire remaining duration
      // (i.e., the task had less than splitMin left). Check if task has multiple parts.
      if (p.dur < minChunk) {
        issues.push({
          date: dk,
          msg: '"' + t.text + '" (' + t.id + ') has chunk of ' + p.dur +
            'min which is below splitMin=' + minChunk
        });
      }
    });
  });
  return issues;
}

function checkLocationFullDuration(dayPlacements, cfg) {
  var issues = [];
  Object.keys(dayPlacements).forEach(function(dk) {
    var blocks = getBlocksForDate(dk, cfg.timeBlocks, cfg);
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.locked || p.marker) return;
      var t = p.task;
      if (!t.location || t.location.length === 0) return;
      // Check at start, middle, and end of placement
      var checkPoints = [p.start, p.start + Math.floor(p.dur / 2), p.start + p.dur - 1];
      for (var ci = 0; ci < checkPoints.length; ci++) {
        var min = checkPoints[ci];
        if (min < 0) continue;
        var locId = resolveLocationId(dk, min, cfg, blocks);
        if (!canTaskRun(t, locId, cfg.toolMatrix)) {
          issues.push({
            date: dk,
            msg: '"' + t.text + '" (' + t.id + ') at ' + fmtRange(p.start, p.dur) +
              ' requires ' + JSON.stringify(t.location) + ' but location at ' + fmtTime(min) +
              ' is "' + locId + '"'
          });
          break; // one issue per placement is enough
        }
      }
    });
  });
  return issues;
}

function checkEarliestDateViolations(dayPlacements, allTasks, todayKey) {
  var issues = [];
  var localToday = parseDate(todayKey) || new Date();
  localToday.setHours(0, 0, 0, 0);

  // Build earliest placement per task
  var firstPlace = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    var dkDate = parseDate(dk);
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      var prev = firstPlace[p.task.id];
      if (!prev || dkDate < prev.date) {
        firstPlace[p.task.id] = { date: dkDate, dateKey: dk };
      }
    });
  });

  allTasks.forEach(function(t) {
    var fp = firstPlace[t.id];
    if (!fp) return;
    // Pinned or generated tasks have their date as a floor
    if ((t.datePinned || t.generated) && !fp.date < localToday) {
      var td = parseDate(t.date);
      if (td && td >= localToday && fp.date < td) {
        issues.push({
          msg: '"' + t.text + '" (' + t.id + ') placed on ' + fp.dateKey +
            ' but is ' + (t.datePinned ? 'pinned' : 'generated') + ' to ' + t.date
        });
      }
    }
  });
  return issues;
}

function checkNonSplitFragmentation(dayPlacements) {
  var issues = [];
  // Count parts per task
  var partsByTask = {};
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      if (!partsByTask[p.task.id]) partsByTask[p.task.id] = { task: p.task, parts: [] };
      partsByTask[p.task.id].parts.push({ date: dk, start: p.start, dur: p.dur });
    });
  });
  Object.keys(partsByTask).forEach(function(id) {
    var entry = partsByTask[id];
    if (entry.parts.length > 1 && !entry.task.split) {
      issues.push({
        msg: '"' + entry.task.text + '" (' + id + ') split=' + entry.task.split +
          ' but has ' + entry.parts.length + ' parts: ' +
          entry.parts.map(function(pp) { return pp.date + ' ' + fmtTime(pp.start) + ' (' + pp.dur + 'm)'; }).join(', ')
      });
    }
  });
  return issues;
}

async function main() {
  var userId = '24297d4e-6d74-4530-acee-d415e67c9a8f';
  var userRow = await db('users').where('id', userId).select('timezone').first();
  var userTz = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;

  // Use buildSourceMap for template inheritance — matches runSchedule.js path
  var taskRows = await db('tasks').where('user_id', userId).select();
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, userTz, srcMap); });
  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  var timeInfo = getNowInTimezone(userTz);
  var cfg = await loadConfig(userId);

  // Expand recurring (matches runSchedule.js)
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + 56);
  var expanded = expandRecurring(allTasks, today, expandEnd);
  if (expanded.length > 0) {
    allTasks = allTasks.concat(expanded);
    expanded.forEach(function(t) { statuses[t.id] = ''; });
  }

  console.log('Running scheduler with', allTasks.length, 'tasks (today=' + timeInfo.todayKey + ', nowMins=' + timeInfo.nowMins + ')...');
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  var totalIssues = 0;

  // 1. Overlaps
  var overlaps = checkOverlaps(result.dayPlacements);
  if (overlaps.length === 0) {
    console.log('\n✅ No overlaps');
  } else {
    console.log('\n❌ ' + overlaps.length + ' overlaps:');
    overlaps.forEach(function(o) { console.log('  ' + o.date + ': ' + o.msg); });
    totalIssues += overlaps.length;
  }

  // 2. Unplaced summary
  var unplaced = result.unplaced || [];
  if (unplaced.length === 0) {
    console.log('✅ All tasks placed');
  } else {
    console.log('\n⚠️  ' + unplaced.length + ' unplaced tasks:');
    unplaced.forEach(function(u) {
      console.log('  ' + (u.pri || 'P3') + ' ' + u.date + ' "' + u.text + '" (' + u.id + ') — ' + (u._unplacedReason || 'unknown'));
    });
  }

  // 3. Priority inversions (unplaced high-pri while low-pri is placed)
  var inversions = checkPriorityInversions(result.dayPlacements, unplaced, allTasks, cfg, timeInfo.todayKey, timeInfo.nowMins);
  if (inversions.length === 0) {
    console.log('✅ No priority inversions');
  } else {
    console.log('\n⚠️  ' + inversions.length + ' priority inversions:');
    inversions.forEach(function(o) { console.log('  ' + o.msg); });
  }

  // 4. Location violations
  var locIssues = checkLocationViolations(result.dayPlacements, cfg);
  if (locIssues.length === 0) {
    console.log('✅ No location violations');
  } else {
    console.log('\n❌ ' + locIssues.length + ' location violations:');
    locIssues.forEach(function(o) { console.log('  ' + o.date + ': ' + o.msg); });
    totalIssues += locIssues.length;
  }

  // 5. When-window violations
  var whenIssues = checkWhenViolations(result.dayPlacements, cfg);
  if (whenIssues.length === 0) {
    console.log('✅ No when-window violations');
  } else {
    console.log('\n⚠️  ' + whenIssues.length + ' when-window violations:');
    whenIssues.forEach(function(o) { console.log('  ' + o.date + ': ' + o.msg); });
  }

  // 6. Deadline misses
  var deadlineIssues = checkDeadlineMisses(result.dayPlacements, allTasks, timeInfo.todayKey);
  if (deadlineIssues.length === 0) {
    console.log('✅ No deadline misses');
  } else {
    console.log('\n❌ ' + deadlineIssues.length + ' deadline misses:');
    deadlineIssues.forEach(function(o) { console.log('  ' + o.msg); });
    totalIssues += deadlineIssues.length;
  }

  // 7. Dependency ordering (now includes unplaced dep detection and Phase 0 items)
  var depIssues = checkDependencyOrder(result.dayPlacements, allTasks, statuses);
  if (depIssues.length === 0) {
    console.log('✅ No dependency ordering issues');
  } else {
    console.log('\n❌ ' + depIssues.length + ' dependency ordering issues:');
    depIssues.forEach(function(o) { console.log('  ' + o.msg); });
    totalIssues += depIssues.length;
  }

  // 8. startAfter violations
  var startAfterIssues = checkStartAfterViolations(result.dayPlacements, allTasks);
  if (startAfterIssues.length === 0) {
    console.log('✅ No startAfter violations');
  } else {
    console.log('\n❌ ' + startAfterIssues.length + ' startAfter violations:');
    startAfterIssues.forEach(function(o) { console.log('  ' + o.msg); });
    totalIssues += startAfterIssues.length;
  }

  // 9. dayReq violations
  var dayReqIssues = checkDayReqViolations(result.dayPlacements);
  if (dayReqIssues.length === 0) {
    console.log('✅ No dayReq violations');
  } else {
    console.log('\n❌ ' + dayReqIssues.length + ' dayReq violations:');
    dayReqIssues.forEach(function(o) { console.log('  ' + o.date + ': ' + o.msg); });
    totalIssues += dayReqIssues.length;
  }

  // 10. splitMin violations
  var splitMinIssues = checkSplitMinViolations(result.dayPlacements);
  if (splitMinIssues.length === 0) {
    console.log('✅ No splitMin violations');
  } else {
    console.log('\n⚠️  ' + splitMinIssues.length + ' splitMin violations:');
    splitMinIssues.forEach(function(o) { console.log('  ' + o.date + ': ' + o.msg); });
  }

  // 11. Location full-duration check (not just start minute)
  var locFullIssues = checkLocationFullDuration(result.dayPlacements, cfg);
  if (locFullIssues.length === 0) {
    console.log('✅ No location full-duration violations');
  } else {
    console.log('\n❌ ' + locFullIssues.length + ' location full-duration violations:');
    locFullIssues.forEach(function(o) { console.log('  ' + o.date + ': ' + o.msg); });
    totalIssues += locFullIssues.length;
  }

  // 12. Earliest date / pinned date violations
  var earliestIssues = checkEarliestDateViolations(result.dayPlacements, allTasks, timeInfo.todayKey);
  if (earliestIssues.length === 0) {
    console.log('✅ No earliest date violations');
  } else {
    console.log('\n⚠️  ' + earliestIssues.length + ' earliest date violations:');
    earliestIssues.forEach(function(o) { console.log('  ' + o.msg); });
  }

  // 13. Non-split tasks with multiple parts (should never happen)
  var nonSplitIssues = checkNonSplitFragmentation(result.dayPlacements);
  if (nonSplitIssues.length === 0) {
    console.log('✅ No non-split fragmentation');
  } else {
    console.log('\n❌ ' + nonSplitIssues.length + ' non-split tasks with multiple parts:');
    nonSplitIssues.forEach(function(o) { console.log('  ' + o.msg); });
    totalIssues += nonSplitIssues.length;
  }

  // 14. Split tasks info
  var partsByTask = {};
  Object.keys(result.dayPlacements).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task) return;
      if (!partsByTask[p.task.id]) partsByTask[p.task.id] = { text: p.task.text, split: p.task.split, parts: [] };
      partsByTask[p.task.id].parts.push({ date: dk, start: p.start, dur: p.dur });
    });
  });
  var splitTasks = [];
  Object.keys(partsByTask).forEach(function(id) {
    var t = partsByTask[id];
    if (t.parts.length > 1) {
      splitTasks.push(id + ': ' + t.text + ' (split=' + t.split + ') => ' + t.parts.length + ' parts: ' +
        t.parts.map(function(p) { return p.date + ' ' + fmtTime(p.start) + ' (' + p.dur + 'm)'; }).join(', '));
    }
  });
  console.log('\nSplit tasks (' + splitTasks.length + '):');
  splitTasks.forEach(function(s) { console.log('  ' + s); });

  // Summary
  console.log('\nScore:', result.score.total);
  console.log('Breakdown:', JSON.stringify(result.score.breakdown));
  var softIssues = inversions.length + whenIssues.length + splitMinIssues.length + earliestIssues.length;
  if (totalIssues === 0) {
    console.log('\n✅ Schedule is clean (' + unplaced.length + ' unplaced, ' + softIssues + ' soft warnings)');
  } else {
    console.log('\n❌ ' + totalIssues + ' hard issues found (' + softIssues + ' soft warnings)');
  }

  await db.destroy();
}

main().catch(function(err) { console.error(err); process.exit(1); });
