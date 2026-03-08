/**
 * Debug script: run the scheduler and check for overlapping placements
 */
var db = require('../db');
var unifiedSchedule = require('./unifiedSchedule');
var constants = require('./constants');
var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DEFAULT_TOOL_MATRIX = constants.DEFAULT_TOOL_MATRIX;
var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var taskController = require('../controllers/task.controller');
var rowToTask = taskController.rowToTask;

var TIMEZONE = 'America/New_York';

function getNowInTimezone() {
  var now = new Date();
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
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

function checkOverlaps(dayPlacements) {
  var overlaps = [];
  var dateKeys = Object.keys(dayPlacements);
  dateKeys.forEach(function(dk) {
    var placed = dayPlacements[dk];
    if (!placed || placed.length < 2) return;
    // Sort by start
    var sorted = placed.slice().sort(function(a, b) { return a.start - b.start; });
    for (var i = 0; i < sorted.length - 1; i++) {
      var curr = sorted[i];
      var next = sorted[i + 1];
      if (next.start < curr.start + curr.dur) {
        overlaps.push({
          date: dk,
          taskA: (curr.task ? curr.task.text : '?') + ' (' + curr.task.id + ')',
          taskB: (next.task ? next.task.text : '?') + ' (' + next.task.id + ')',
          aRange: Math.floor(curr.start/60) + ':' + String(curr.start%60).padStart(2,'0') + '-' + Math.floor((curr.start+curr.dur)/60) + ':' + String((curr.start+curr.dur)%60).padStart(2,'0'),
          bRange: Math.floor(next.start/60) + ':' + String(next.start%60).padStart(2,'0') + '-' + Math.floor((next.start+next.dur)/60) + ':' + String((next.start+next.dur)%60).padStart(2,'0'),
          overlapMins: curr.start + curr.dur - next.start
        });
      }
    }
  });
  return overlaps;
}

async function main() {
  var userId = '24297d4e-6d74-4530-acee-d415e67c9a8f';
  var taskRows = await db('tasks').where('user_id', userId).select();
  var allTasks = taskRows.map(rowToTask);
  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  var timeInfo = getNowInTimezone();
  var cfg = await loadConfig(userId);

  // Expand recurring
  var DAY_NAMES = constants.DAY_NAMES;
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + 56);
  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  var existingIds = {};
  allTasks.forEach(function(t) { existingIds[t.id] = true; });
  var existingByDateText = {};
  allTasks.forEach(function(t) {
    if (t.date && t.text) existingByDateText[t.date + '|' + t.text] = true;
  });
  var sources = allTasks.filter(function(t) { return t.recur && t.recur.type !== 'none'; });
  var newTasks = [];
  var cursor = new Date(today); cursor.setHours(0, 0, 0, 0);
  var end = new Date(expandEnd); end.setHours(23, 59, 59, 999);
  while (cursor <= end) {
    var dateStr = formatDateKey(cursor);
    var dow = cursor.getDay();
    var dayName = DAY_NAMES[dow];
    sources.forEach(function(src) {
      var r = src.recur;
      var srcDate = parseDate(src.date);
      if (!srcDate) srcDate = new Date(today);
      if (cursor < srcDate) return;
      if (dateStr === src.date) return;
      var match = false;
      if (r.type === 'daily') match = true;
      else if (r.type === 'weekly' || r.type === 'biweekly') {
        var days = r.days || 'MTWRF';
        var found = false;
        for (var i = 0; i < days.length; i++) {
          if (dayMap[days[i]] === dow) { found = true; break; }
        }
        if (!found) return;
        if (r.type === 'biweekly') {
          var daysDiff = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
          if (Math.floor(daysDiff / 7) % 2 !== 0) return;
        }
        match = true;
      } else if (r.type === 'interval') {
        var between = Math.round((cursor.getTime() - srcDate.getTime()) / 86400000);
        if (between > 0 && between % (r.every || 2) === 0) match = true;
      }
      if (!match) return;
      var id = 'rc_' + src.id + '_' + dateStr.replace(/\//g, '');
      if (existingIds[id]) return;
      if (existingByDateText[dateStr + '|' + src.text]) return;
      existingIds[id] = true;
      existingByDateText[dateStr + '|' + src.text] = true;
      newTasks.push({
        id: id, date: dateStr, day: dayName, project: src.project, text: src.text,
        pri: src.pri, habit: src.habit || false, rigid: src.rigid || false,
        time: src.time, dur: src.dur, where: src.where, when: src.when,
        location: src.location, tools: src.tools, split: src.split,
        timeFlex: src.timeFlex,
        dayReq: src.dayReq || 'any', section: '', notes: '',
        sourceId: src.id, generated: true
      });
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  if (newTasks.length > 0) {
    allTasks = allTasks.concat(newTasks);
    newTasks.forEach(function(t) { statuses[t.id] = ''; });
  }

  console.log('Running scheduler with', allTasks.length, 'tasks...');
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  var overlaps = checkOverlaps(result.dayPlacements);
  if (overlaps.length === 0) {
    console.log('\n✅ No overlaps found!');
  } else {
    console.log('\n❌ Found', overlaps.length, 'overlaps:');
    overlaps.forEach(function(o) {
      console.log('  ' + o.date + ': ' + o.taskA + ' ' + o.aRange + ' overlaps ' + o.taskB + ' ' + o.bRange + ' by ' + o.overlapMins + 'min');
    });
  }

  // Check for tasks split into multiple parts
  var splitTasks = [];
  var partsByTask = {};
  Object.keys(result.dayPlacements).forEach(function(dk) {
    var placements = result.dayPlacements[dk];
    if (!placements) return;
    placements.forEach(function(p) {
      if (!p.task) return;
      if (!partsByTask[p.task.id]) partsByTask[p.task.id] = { text: p.task.text, split: p.task.split, parts: [] };
      partsByTask[p.task.id].parts.push({ date: dk, start: p.start, dur: p.dur });
    });
  });
  Object.keys(partsByTask).forEach(function(id) {
    var t = partsByTask[id];
    if (t.parts.length > 1) {
      splitTasks.push(id + ': ' + t.text + ' (split=' + t.split + ') => ' + t.parts.length + ' parts: ' +
        t.parts.map(function(p) { return p.date + ' ' + Math.floor(p.start/60) + ':' + String(p.start%60).padStart(2,'0') + ' (' + p.dur + 'm)'; }).join(', '));
    }
  });
  console.log('\nSplit tasks (' + splitTasks.length + '):');
  splitTasks.forEach(function(s) { console.log('  ' + s); });

  console.log('\nScore:', result.score.total);
  console.log('Breakdown:', JSON.stringify(result.score.breakdown));

  await db.destroy();
}

main().catch(function(err) { console.error(err); process.exit(1); });
