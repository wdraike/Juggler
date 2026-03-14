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
      // Check at placement start
      var locId = resolveLocationId(dk, p.start, cfg, blocks);
      if (!canTaskRun(t, locId, cfg.toolMatrix)) {
        issues.push({
          date: dk,
          msg: '"' + t.text + '" (' + t.id + ') at ' + fmtRange(p.start, p.dur) +
            ' requires ' + JSON.stringify(t.location) + ' but location is "' + locId + '"'
        });
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

function checkDependencyOrder(dayPlacements) {
  var issues = [];
  // Build earliest placement per task: { dateKey, startMin } — skip markers
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
  // Also build last placement per task (for endMin) — skip markers
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
  // Check each placed task's dependencies finish before it starts — skip markers
  Object.keys(dayPlacements).forEach(function(dk) {
    (dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task || p.marker) return;
      var deps = getTaskDeps(p.task);
      deps.forEach(function(depId) {
        var depEnd = lastPlace[depId];
        if (!depEnd) return; // dep not placed — might be done/skipped
        var taskFirst = firstPlace[p.task.id];
        if (!taskFirst) return;
        // Dependency must end before (or on same day, before start of) dependant
        if (depEnd.date > taskFirst.date) {
          issues.push({
            msg: '"' + p.task.text + '" (' + p.task.id + ') depends on "' + depId +
              '" but dep ends ' + depEnd.dateKey + ' after task starts ' + taskFirst.dateKey
          });
        } else if (depEnd.dateKey === taskFirst.dateKey && depEnd.endMin > taskFirst.startMin) {
          issues.push({
            msg: '"' + p.task.text + '" (' + p.task.id + ') at ' + fmtTime(taskFirst.startMin) +
              ' depends on "' + depId + '" which ends at ' + fmtTime(depEnd.endMin) + ' on ' + dk
          });
        }
      });
    });
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

  // 7. Dependency ordering
  var depIssues = checkDependencyOrder(result.dayPlacements);
  if (depIssues.length === 0) {
    console.log('✅ No dependency ordering issues');
  } else {
    console.log('\n❌ ' + depIssues.length + ' dependency ordering issues:');
    depIssues.forEach(function(o) { console.log('  ' + o.msg); });
    totalIssues += depIssues.length;
  }

  // 8. Split tasks
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
  if (totalIssues === 0) {
    console.log('\n✅ Schedule is clean (' + unplaced.length + ' unplaced, ' + inversions.length + ' inversions, ' + whenIssues.length + ' when-window issues)');
  } else {
    console.log('\n❌ ' + totalIssues + ' hard issues found');
  }

  await db.destroy();
}

main().catch(function(err) { console.error(err); process.exit(1); });
