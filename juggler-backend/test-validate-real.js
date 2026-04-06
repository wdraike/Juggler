/**
 * Validate real Juggler tasks against all scheduler rules.
 * Loads tasks and config, runs the scheduler, validates every placement.
 */

var unifiedSchedule = require('./src/scheduler/unifiedSchedule');
var constants = require('./src/scheduler/constants');
var dateHelpers = require('./src/scheduler/dateHelpers');
var timeBlockHelpers = require('./src/scheduler/timeBlockHelpers');
var locationHelpers = require('./src/scheduler/locationHelpers');
var dependencyHelpers = require('./src/scheduler/dependencyHelpers');
var fs = require('fs');

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
var DAY_NAMES = constants.DAY_NAMES;

var verbose = process.argv.includes('--verbose');

var today = new Date();
today.setHours(0, 0, 0, 0);
var todayKey = formatDateKey(today);

function minToTime(m) {
  var hh = Math.floor(m / 60), mm = m % 60;
  var ampm = hh >= 12 ? 'PM' : 'AM';
  var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
  return dh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
}

// Load real data
var tasks = JSON.parse(fs.readFileSync('/tmp/juggler-real-tasks.json', 'utf8'));
var cfg = {
  timeBlocks: constants.DEFAULT_TIME_BLOCKS,
  toolMatrix: constants.DEFAULT_TOOL_MATRIX,
  locSchedules: {},
  locScheduleDefaults: {},
  locScheduleOverrides: {},
  hourLocationOverrides: {},
  scheduleTemplates: null,
  preferences: {}
};

// Load real config
try {
  var realCfgStr = fs.readFileSync('/Users/david/.claude/projects/-Users-david-Offline-Coding-Juggler/14fcd557-18c7-48f1-9bf8-51e00469f420/tool-results/mcp-juggler-get_config-*.txt', 'utf8');
} catch(e) {}

// Use the config from the MCP response embedded in the script
cfg.timeBlocks = {"Fri":[{"id":"morning","end":480,"loc":"home","tag":"morning","start":360},{"id":"biz1","end":720,"loc":"work","tag":"biz","start":480},{"id":"lunch","end":780,"loc":"work","tag":"lunch","start":720},{"id":"biz2","end":1020,"loc":"work","tag":"biz","start":780},{"id":"evening","end":1260,"loc":"home","tag":"evening","start":1020},{"id":"night","end":1380,"loc":"home","tag":"night","start":1260}],"Mon":[{"id":"morning","end":480,"loc":"home","tag":"morning","start":360},{"id":"biz1","end":720,"loc":"work","tag":"biz","start":480},{"id":"lunch","end":780,"loc":"work","tag":"lunch","start":720},{"id":"biz2","end":1020,"loc":"work","tag":"biz","start":780},{"id":"evening","end":1260,"loc":"home","tag":"evening","start":1020},{"id":"night","end":1380,"loc":"home","tag":"night","start":1260}],"Sat":[{"id":"morning","end":720,"loc":"home","tag":"morning","start":420},{"id":"afternoon","end":1020,"loc":"home","tag":"afternoon","start":720},{"id":"evening","end":1260,"loc":"home","tag":"evening","start":1020},{"id":"night","end":1380,"loc":"home","tag":"night","start":1260}],"Sun":[{"id":"morning","end":720,"loc":"home","tag":"morning","start":420},{"id":"afternoon","end":1020,"loc":"home","tag":"afternoon","start":720},{"id":"evening","end":1260,"loc":"home","tag":"evening","start":1020},{"id":"night","end":1380,"loc":"home","tag":"night","start":1260}],"Thu":[{"id":"morning","end":480,"loc":"home","tag":"morning","start":360},{"id":"biz1","end":720,"loc":"work","tag":"biz","start":480},{"id":"lunch","end":780,"loc":"work","tag":"lunch","start":720},{"id":"biz2","end":1020,"loc":"work","tag":"biz","start":780},{"id":"evening","end":1260,"loc":"home","tag":"evening","start":1020},{"id":"night","end":1380,"loc":"home","tag":"night","start":1260}],"Tue":[{"id":"morning","end":480,"loc":"home","tag":"morning","start":360},{"id":"biz1","end":720,"loc":"work","tag":"biz","start":480},{"id":"lunch","end":780,"loc":"work","tag":"lunch","start":720},{"id":"biz2","end":1020,"loc":"work","tag":"biz","start":780},{"id":"evening","end":1260,"loc":"home","tag":"evening","start":1020},{"id":"night","end":1380,"loc":"home","tag":"night","start":1260}],"Wed":[{"id":"morning","end":480,"loc":"home","tag":"morning","start":360},{"id":"biz1","end":720,"loc":"work","tag":"biz","start":480},{"id":"lunch","end":780,"loc":"work","tag":"lunch","start":720},{"id":"biz2","end":1020,"loc":"work","tag":"biz","start":780},{"id":"evening","end":1260,"loc":"home","tag":"evening","start":1020},{"id":"night","end":1380,"loc":"home","tag":"night","start":1260}]};
cfg.toolMatrix = {"gym":["phone"],"home":["phone","personal_pc","car","TV"],"work":["phone","work_pc","printer"],"Hotel":["phone","personal_pc","work_pc","car","TV"],"transit":["phone"],"Airplane":["personal_pc","work_pc"],"downtown":["phone","car"]};
cfg.locSchedules = {"bh1":{"hours":{"360":"Hotel","375":"Hotel","390":"Hotel","405":"Hotel","420":"Hotel","435":"Hotel","450":"transit","465":"transit","480":"work","495":"work","510":"work","525":"work","540":"work","555":"work","570":"work","585":"work","600":"work","615":"work","630":"work","645":"work","660":"work","675":"work","690":"work","705":"work","720":"work","735":"work","750":"work","765":"work","780":"work","795":"work","810":"work","825":"work","840":"work","855":"work","870":"work","885":"work","900":"work","915":"work","930":"work","945":"work","960":"work","975":"work","990":"work","1005":"work","1020":"transit","1035":"transit","1050":"Hotel","1065":"Hotel","1080":"Hotel","1095":"Hotel","1110":"Hotel","1125":"Hotel","1140":"Hotel","1155":"Hotel","1170":"Hotel","1185":"Hotel","1200":"Hotel","1215":"Hotel","1230":"Hotel","1245":"Hotel","1260":"Hotel","1275":"Hotel","1290":"Hotel","1305":"Hotel","1320":"Hotel","1335":"Hotel","1350":"Hotel","1365":"Hotel"}},"bh2":{"hours":{"360":"Hotel","375":"Hotel","390":"Hotel","405":"Hotel","420":"Hotel","435":"Hotel","450":"Hotel","465":"Hotel","480":"Hotel","495":"Hotel","510":"Hotel","525":"Hotel","540":"Hotel","555":"Hotel","570":"Hotel","585":"Hotel","600":"Hotel","615":"Hotel","630":"Hotel","645":"Hotel","660":"Hotel","675":"Hotel","690":"Hotel","705":"Hotel","720":"Hotel","735":"Hotel","750":"Hotel","765":"Hotel","780":"Hotel","795":"Hotel","810":"Hotel","825":"Hotel","840":"Hotel","855":"Hotel","870":"Hotel","885":"Hotel","900":"Hotel","915":"Hotel","930":"Hotel","945":"Hotel","960":"Hotel","975":"Hotel","990":"Hotel","1005":"Hotel","1020":"Hotel","1035":"Hotel","1050":"Hotel","1065":"Hotel","1080":"Hotel","1095":"Hotel","1110":"Hotel","1125":"Hotel","1140":"Hotel","1155":"Hotel","1170":"Hotel","1185":"Hotel","1200":"Hotel","1215":"Hotel","1230":"Hotel","1245":"Hotel","1260":"Hotel","1275":"Hotel","1290":"Hotel","1305":"Hotel","1320":"Hotel","1335":"Hotel","1350":"Hotel","1365":"Hotel"}},"wfh":{"hours":{"360":"home","375":"home","390":"home","405":"home","420":"home","435":"home","450":"home","465":"home","480":"home","495":"home","510":"home","525":"home","540":"home","555":"home","570":"home","585":"home","600":"home","615":"home","630":"home","645":"home","660":"home","675":"home","690":"home","705":"home","720":"home","735":"home","750":"home","765":"home","780":"home","795":"home","810":"home","825":"home","840":"home","855":"home","870":"home","885":"home","900":"home","915":"home","930":"home","945":"home","960":"home","975":"home","990":"home","1005":"home","1020":"home","1035":"home","1050":"home","1065":"home","1080":"home","1095":"home","1110":"home","1125":"home","1140":"home","1155":"home","1170":"home","1185":"home","1200":"home","1215":"home","1230":"home","1245":"home","1260":"home","1275":"home","1290":"home","1305":"home","1320":"home","1335":"home","1350":"home","1365":"home","1380":"home","1395":"home","1410":"home","1425":"home","1440":"home"}},"bhnj1":{"hours":{"360":"Hotel","375":"Hotel","390":"Hotel","405":"Hotel","420":"Hotel","435":"Hotel","450":"Hotel","465":"Hotel","480":"Hotel","495":"work","510":"work","525":"work","540":"work","555":"work","570":"work","585":"work","600":"work","615":"work","630":"work","645":"work","660":"work","675":"work","690":"work","705":"work","720":"work","735":"work","750":"work","765":"work","780":"work","795":"work","810":"work","825":"work","840":"work","855":"work","870":"work","885":"work","900":"work","915":"work","930":"work","945":"work","960":"work","975":"work","990":"work","1005":"work","1020":"Hotel","1035":"Hotel","1050":"Hotel","1065":"Hotel","1080":"Hotel","1095":"Hotel","1110":"Hotel","1125":"Hotel","1140":"Hotel","1155":"Hotel","1170":"Hotel","1185":"Hotel","1200":"Hotel","1215":"Hotel","1230":"Hotel","1245":"Hotel","1260":"Hotel","1275":"Hotel","1290":"Hotel","1305":"Hotel","1320":"Hotel","1335":"Hotel","1350":"Hotel","1365":"Hotel","1380":"Hotel","1395":"Hotel","1410":"Hotel","1425":"Hotel","1440":"transit"}},"weekday":{"hours":{"360":"home","375":"home","390":"home","405":"home","420":"home","435":"home","450":"home","465":"home","480":"work","495":"work","510":"work","525":"work","540":"work","555":"work","570":"work","585":"work","600":"work","615":"work","630":"work","645":"work","660":"work","675":"work","690":"work","705":"work","720":"work","735":"work","750":"work","765":"work","780":"work","795":"work","810":"work","825":"work","840":"work","855":"work","870":"work","885":"work","900":"work","915":"work","930":"work","945":"work","960":"work","975":"work","990":"work","1005":"work","1020":"home","1035":"home","1050":"home","1065":"home","1080":"home","1095":"home","1110":"home","1125":"home","1140":"home","1155":"home","1170":"home","1185":"home","1200":"home","1215":"home","1230":"home","1245":"home","1260":"home","1275":"home","1290":"home","1305":"home","1320":"home","1335":"home","1350":"home","1365":"home","1380":"home","1395":"home","1410":"home","1425":"home","1440":"home"},"system":true},"weekend":{"hours":{"420":"home","435":"home","450":"home","465":"home","480":"home","495":"home","510":"home","525":"home","540":"home","555":"home","570":"home","585":"home","600":"home","615":"home","630":"home","645":"home","660":"home","675":"home","690":"home","705":"home","720":"home","735":"home","750":"home","765":"home","780":"home","795":"home","810":"home","825":"home","840":"home","855":"home","870":"home","885":"home","900":"home","915":"home","930":"home","945":"home","960":"home","975":"home","990":"home","1005":"home","1020":"home","1035":"home","1050":"home","1065":"home","1080":"home","1095":"home","1110":"home","1125":"home","1140":"home","1155":"home","1170":"home","1185":"home","1200":"home","1215":"home","1230":"home","1245":"home","1260":"home","1275":"home","1290":"home","1305":"home","1320":"home","1335":"home","1350":"home","1365":"home"},"system":true}};
cfg.locScheduleDefaults = {"Fri":"weekday","Mon":"weekday","Sat":"weekend","Sun":"weekend","Thu":"weekday","Tue":"weekday","Wed":"weekday"};
cfg.locScheduleOverrides = {"3/4":"bh2","3/5":"bhnj1","3/6":"wfh","3/9":"bhnj1","3/10":"bhnj1","3/11":"bh2","3/12":"bhnj1","3/13":"wfh"};
cfg.hourLocationOverrides = {"3/1":{"7":"home"},"3/3":{"7":"work","8":"home","13":"work"},"3/4":{"12":"Hotel","18":"Hotel"},"3/5":{"6":"Hotel","8":"Hotel","11":"Hotel","12":"Hotel","13":"Hotel","15":"Hotel","17":"Hotel","19":"Hotel"},"3/8":{"16":"transit","17":"transit","18":"Airplane","19":"transit","20":"transit","21":"transit","22":"Hotel","23":"Hotel"},"3/9":{"17":"Hotel","18":"Hotel","19":"Hotel","20":"Hotel","21":"Hotel","22":"Hotel","23":"Hotel"},"3/12":{"8":"work","17":"transit","18":"transit","19":"transit","20":"Airplane","21":"transit"}};
cfg.preferences = {"fontSize":112,"gridZoom":60,"schedFloor":360,"splitDefault":false,"splitMinDefault":15};

// Build statuses map from task data
var statuses = {};
tasks.forEach(function(t) {
  statuses[t.id] = t.status || '';
});

console.log('Real Data Validation');
console.log('Today: ' + todayKey + ' (' + DAY_NAMES[today.getDay()] + ')');
console.log('Tasks: ' + tasks.length + ' total');

// Count active tasks
var active = tasks.filter(function(t) {
  var st = statuses[t.id];
  return st !== 'done' && st !== 'cancel' && st !== 'skip';
});
console.log('Active: ' + active.length);
console.log('');

// Run scheduler
var result = unifiedSchedule(tasks, statuses, todayKey, 0, cfg);

// Build lookups
var taskById = {};
tasks.forEach(function(t) { taskById[t.id] = t; });

var placementsByTask = {};
var allPlacements = [];
Object.keys(result.dayPlacements).forEach(function(dk) {
  (result.dayPlacements[dk] || []).forEach(function(p) {
    if (!p.task) return;
    var tid = p.task.id;
    if (!placementsByTask[tid]) placementsByTask[tid] = [];
    placementsByTask[tid].push({ dateKey: dk, start: p.start, dur: p.dur, locked: p.locked, marker: p.marker, task: p.task, _whenRelaxed: p._whenRelaxed });
    allPlacements.push({ dateKey: dk, taskId: tid, start: p.start, dur: p.dur, locked: p.locked, marker: p.marker, task: p.task, _whenRelaxed: p._whenRelaxed });
  });
});

var passed = 0, failed = 0, warnings = 0;
var errors = [], warns = [];

function fail(msg) { errors.push(msg); failed++; }
function pass() { passed++; }
function warn(msg) { warns.push(msg); warnings++; }

// ── 1. WHEN-WINDOW ALIGNMENT ──
allPlacements.forEach(function(pl) {
  var t = pl.task;
  if (pl.locked && !pl.marker) { pass(); return; }
  if (pl.marker) { pass(); return; }
  if (pl._whenRelaxed) { pass(); return; }
  var whenVal = t.when;
  if (!whenVal || whenVal === 'anytime' || hasWhen(whenVal, 'allday') || hasWhen(whenVal, 'fixed')) { pass(); return; }
  var blocks = getBlocksForDate(pl.dateKey, cfg.timeBlocks, cfg);
  var windows = buildWindowsFromBlocks(blocks);
  var wins = getWhenWindows(whenVal, windows);
  if (wins.length === 0) { pass(); return; } // no windows on this day type
  var startOk = false;
  for (var wi = 0; wi < wins.length; wi++) {
    if (pl.start >= wins[wi][0] && pl.start < wins[wi][1]) { startOk = true; break; }
  }
  if (!startOk) {
    fail('[WHEN] ' + t.id + ' (' + t.text + ') at ' + minToTime(pl.start) + ' on ' + pl.dateKey + ' outside when="' + whenVal + '" windows: ' + JSON.stringify(wins));
  } else { pass(); }
});

// ── 2. LOCATION COMPATIBILITY ──
allPlacements.forEach(function(pl) {
  var t = pl.task;
  if (!t.location || t.location.length === 0) { pass(); return; }
  if (pl.marker) { pass(); return; }
  var blocks = getBlocksForDate(pl.dateKey, cfg.timeBlocks, cfg);
  for (var m = pl.start; m < pl.start + pl.dur; m += 15) {
    var locId = resolveLocationId(pl.dateKey, m, cfg, blocks);
    if (!canTaskRun(t, locId, cfg.toolMatrix)) {
      fail('[LOC] ' + t.id + ' (' + t.text + ') needs ' + (t.location||[]).join('/') + ' but incompatible at min ' + m + ' on ' + pl.dateKey + ' (loc=' + locId + ')');
      return;
    }
  }
  pass();
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
    fail('[DAY] ' + t.id + ' (' + t.text + ') needs weekday but placed on ' + DAY_NAMES[dow] + ' (' + pl.dateKey + ')');
    return;
  }
  if (t.dayReq === 'weekend' && isWeekday) {
    fail('[DAY] ' + t.id + ' (' + t.text + ') needs weekend but placed on ' + DAY_NAMES[dow] + ' (' + pl.dateKey + ')');
    return;
  }
  pass();
});

// ── 4. DATE CONSTRAINTS (startAfter, deadline) ──
Object.keys(placementsByTask).forEach(function(tid) {
  var t = taskById[tid];
  if (!t) return;
  var parts = placementsByTask[tid];
  if (t.startAfter) {
    var saDate = parseDate(t.startAfter);
    if (saDate) {
      saDate.setHours(0,0,0,0);
      parts.forEach(function(pl) {
        var plDate = parseDate(pl.dateKey);
        if (plDate && plDate < saDate) {
          fail('[DATE] ' + tid + ' (' + t.text + ') startAfter=' + t.startAfter + ' but placed on ' + pl.dateKey);
        } else { pass(); }
      });
    }
  }
  if (t.due) {
    var dueDate = parseDate(t.due);
    if (dueDate) {
      dueDate.setHours(23,59,59,999);
      var isPast = dueDate < today;
      parts.forEach(function(pl) {
        var plDate = parseDate(pl.dateKey);
        if (plDate && plDate > dueDate && !isPast) {
          fail('[DATE] ' + tid + ' (' + t.text + ') due=' + t.due + ' but placed on ' + pl.dateKey);
        } else if (plDate && plDate > dueDate && isPast) {
          warn('[DATE] ' + tid + ' (' + t.text + ') past deadline ' + t.due + ' rescued to ' + pl.dateKey);
        } else { pass(); }
      });
    }
  }
  if (!t.startAfter && !t.due) pass();
});

// ── 5. DEPENDENCY ORDERING ──
allPlacements.forEach(function(pl) {
  var t = pl.task;
  if (pl.marker) { pass(); return; } // markers are transparent
  var deps = getTaskDeps(t);
  if (deps.length === 0) { pass(); return; }
  var plDate = parseDate(pl.dateKey);
  if (!plDate) { pass(); return; }
  deps.forEach(function(depId) {
    var depParts = placementsByTask[depId];
    if (!depParts || depParts.length === 0) { return; }
    var depLatestDate = null, depLatestEnd = 0;
    depParts.forEach(function(dp) {
      var dpDate = parseDate(dp.dateKey);
      if (!depLatestDate || dpDate > depLatestDate || (dpDate.getTime() === depLatestDate.getTime() && dp.start + dp.dur > depLatestEnd)) {
        depLatestDate = dpDate;
        depLatestEnd = dp.start + dp.dur;
      }
    });
    if (depLatestDate > plDate) {
      // Check if this is a data issue (dep's own date is after task's date)
      var depTask = taskById[depId];
      var depOwnDate = depTask && depTask.date ? parseDate(depTask.date) : null;
      var taskOwnDate = t.date ? parseDate(t.date) : null;
      if (depOwnDate && taskOwnDate && depOwnDate > taskOwnDate) {
        warn('[DEP-DATA] ' + t.id + ' (' + t.text + ') date=' + t.date + ' depends on ' + depId + ' (' + (depTask?depTask.text:'?') + ') date=' + (depTask?depTask.date:'?') + ' — backwards dependency in data');
      } else {
        fail('[DEP] ' + t.id + ' (' + t.text + ') on ' + pl.dateKey + ' but dep ' + depId + ' on later date ' + formatDateKey(depLatestDate));
      }
    } else if (depLatestDate.getTime() === plDate.getTime() && depLatestEnd > pl.start) {
      fail('[DEP] ' + t.id + ' (' + t.text + ') at ' + minToTime(pl.start) + ' on ' + pl.dateKey + ' but dep ' + depId + ' ends at ' + minToTime(depLatestEnd) + ' (same day)');
    } else { pass(); }
  });
});

// ── 6. OCCUPANCY (no overlaps) ──
Object.keys(result.dayPlacements).forEach(function(dk) {
  var placements = (result.dayPlacements[dk] || []).filter(function(p) { return !p.marker; });
  var occ = {};
  var overlapFound = false;
  placements.forEach(function(p) {
    for (var m = p.start; m < p.start + p.dur; m++) {
      if (occ[m]) {
        // Check if both tasks are fixed — data conflict, not scheduler bug
        var otherId = occ[m];
        var otherTask = taskById[otherId];
        var thisFixed = p.task && hasWhen(p.task.when, 'fixed');
        var otherFixed = otherTask && hasWhen(otherTask.when, 'fixed');
        if (thisFixed && otherFixed) {
          warn('[OCC-DATA] Fixed-task overlap on ' + dk + ' at ' + minToTime(m) + ': ' + otherId + ' and ' + (p.task ? p.task.id : '?'));
        } else {
          fail('[OCC] Overlap on ' + dk + ' at ' + minToTime(m) + ': ' + otherId + ' and ' + (p.task ? p.task.id : '?'));
        }
        overlapFound = true;
        return;
      }
      occ[m] = p.task ? p.task.id : '?';
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
    fail('[FIXED] ' + t.id + ' (' + t.text + ') fixed at ' + t.time + ' but placed at ' + minToTime(pl.start));
  } else { pass(); }
  if (t.date && pl.dateKey !== t.date) {
    fail('[FIXED] ' + t.id + ' (' + t.text + ') fixed on ' + t.date + ' but placed on ' + pl.dateKey);
  } else { pass(); }
});

// ── 8. HABIT DAY-PINNING ──
allPlacements.forEach(function(pl) {
  var t = pl.task;
  if (!t.habit) return;
  if (t.date && pl.dateKey !== t.date) {
    fail('[HABIT] ' + t.id + ' (' + t.text + ') habit for ' + t.date + ' but placed on ' + pl.dateKey);
  } else { pass(); }
});

// ── 9. STATUS FILTERING ──
allPlacements.forEach(function(pl) {
  var st = statuses[pl.task.id] || pl.task.status || '';
  if (st === 'done' || st === 'cancel' || st === 'skip') {
    fail('[STATUS] ' + pl.task.id + ' (' + pl.task.text + ') has status "' + st + '" but appears in placements');
  }
});

// ── 10. EXCLUSION RULES ──
tasks.forEach(function(t) {
  if (hasWhen(t.when, 'allday') && placementsByTask[t.id]) {
    fail('[EXCL] ' + t.id + ' (' + t.text + ') is allday but placed');
  }
  if ((!t.date || t.date === 'TBD') && placementsByTask[t.id]) {
    fail('[EXCL] ' + t.id + ' (' + t.text + ') has no date but placed');
  }
});

// ── 11. GENERATED/HABIT FLOOR ──
allPlacements.forEach(function(pl) {
  var t = pl.task;
  if (!t.generated && !t.habit) return;
  if (!t.date || t.date === 'TBD') return;
  var floorDate = parseDate(t.date);
  var plDate = parseDate(pl.dateKey);
  if (floorDate && plDate && plDate < floorDate) {
    fail('[FLOOR] ' + t.id + ' (' + t.text + ') ' + (t.generated ? 'generated' : 'habit') + ' for ' + t.date + ' but placed before on ' + pl.dateKey);
  } else { pass(); }
});

// ── 12. DURATION ACCURACY ──
Object.keys(placementsByTask).forEach(function(tid) {
  var t = taskById[tid];
  if (!t || t.marker) return;
  var parts = placementsByTask[tid];
  var totalPlaced = 0;
  parts.forEach(function(p) { totalPlaced += p.dur; });
  var expectedDur = t.timeRemaining != null ? t.timeRemaining : t.dur;
  expectedDur = Math.min(expectedDur || 30, 720);
  if (totalPlaced > expectedDur) {
    fail('[DUR] ' + tid + ' (' + t.text + ') placed ' + totalPlaced + 'm but expected max ' + expectedDur + 'm');
  } else { pass(); }
});

// ── 13. DOWNSTREAM CEILING ──
var dependedOnBy = {};
tasks.forEach(function(t) {
  getTaskDeps(t).forEach(function(depId) {
    if (!dependedOnBy[depId]) dependedOnBy[depId] = [];
    dependedOnBy[depId].push(t.id);
  });
});
Object.keys(placementsByTask).forEach(function(tid) {
  var children = dependedOnBy[tid] || [];
  if (children.length === 0) return;
  var parts = placementsByTask[tid];
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
      var t = taskById[tid];
      // Check if this is caused by a backwards dep in data
      var isBackwardsDep = false;
      if (t && t.date) {
        var tOwnDate = parseDate(t.date);
        children.forEach(function(childId) {
          var child = taskById[childId];
          if (child && child.date) {
            var childOwnDate = parseDate(child.date);
            if (tOwnDate && childOwnDate && tOwnDate > childOwnDate) isBackwardsDep = true;
          }
        });
      }
      if (isBackwardsDep) {
        warn('[CEIL-DATA] ' + tid + ' (' + (t ? t.text : '?') + ') on ' + pl.dateKey + ' but dependant placed on earlier ' + formatDateKey(earliestChildDate) + ' — backwards dependency in data');
      } else {
        fail('[CEIL] ' + tid + ' (' + (t ? t.text : '?') + ') on ' + pl.dateKey + ' but dependant placed on earlier ' + formatDateKey(earliestChildDate));
      }
    } else { pass(); }
  });
});

// ── 14. DEADLINE CHAIN COHERENCE ──
Object.keys(placementsByTask).forEach(function(tid) {
  var t = taskById[tid];
  if (!t || !t.due) return;
  var dueDate = parseDate(t.due);
  if (!dueDate || dueDate < today) return;
  var visited = {};
  var queue = getTaskDeps(t).slice();
  while (queue.length > 0) {
    var depId = queue.shift();
    if (visited[depId]) continue;
    visited[depId] = true;
    var depTask = taskById[depId];
    if (!depTask) continue;
    var ancParts = placementsByTask[depId];
    if (ancParts) {
      ancParts.forEach(function(ap) {
        var apDate = parseDate(ap.dateKey);
        if (apDate && apDate > dueDate) {
          fail('[DCHAIN] ' + depId + ' (' + depTask.text + ') ancestor of ' + tid + ' (due=' + t.due + ') placed on ' + ap.dateKey + ' after deadline');
        } else { pass(); }
      });
    }
    getTaskDeps(depTask).forEach(function(gp) { queue.push(gp); });
  }
});

// ── Report ──
var placedCount = Object.keys(placementsByTask).length;
var unplacedCount = result.unplaced ? result.unplaced.length : 0;

console.log('Placed: ' + placedCount + ' tasks (' + allPlacements.length + ' placement parts)');
console.log('Unplaced: ' + unplacedCount);
console.log('');

if (errors.length > 0) {
  console.log('=== FAILURES ===');
  errors.forEach(function(e) { console.log('  FAIL: ' + e); });
  console.log('');
}
if (warns.length > 0) {
  console.log('=== WARNINGS ===');
  warns.forEach(function(w) { console.log('  WARN: ' + w); });
  console.log('');
}

console.log('========================================');
console.log('Total: ' + passed + ' passed, ' + failed + ' failed, ' + warnings + ' warnings');
console.log('========================================');

// Dump suggestions
if (process.argv.includes('--suggestions')) {
  console.log("\n=== SUGGESTIONS ===");
  (result.unplaced || []).forEach(function(t) {
    console.log("TASK: " + (t.text || t.id).substring(0, 60));
    console.log("  DETAIL: " + (t._unplacedDetail || "no detail"));
    (t._suggestions || []).forEach(function(s) { console.log("  SUG: " + s.text + (s.action ? " [" + s.action + "]" : "")); });
  });
}

process.exit(failed > 0 ? 1 : 0);
