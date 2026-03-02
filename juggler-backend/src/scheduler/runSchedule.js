/**
 * runSchedule.js — Load data, run scheduler, persist date moves
 */

var db = require('../db');
var unifiedSchedule = require('./unifiedSchedule');
var constants = require('./constants');
var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DEFAULT_TOOL_MATRIX = constants.DEFAULT_TOOL_MATRIX;
var DAY_NAMES = constants.DAY_NAMES;
var taskController = require('../controllers/task.controller');
var rowToTask = taskController.rowToTask;

var TIMEZONE = 'America/New_York';

/**
 * Get current date/time in America/New_York timezone
 */
function getNowInTimezone() {
  var now = new Date();
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false
  }).formatToParts(now);

  var vals = {};
  parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });

  var month = vals.month;
  var day = vals.day;
  var hour = vals.hour;
  var minute = vals.minute;

  return {
    todayKey: month + '/' + day,
    nowMins: hour * 60 + minute
  };
}

/**
 * Load user config values from DB and assemble into scheduler cfg object
 */
async function loadConfig(userId) {
  var rows = await db('user_config').where('user_id', userId).select();
  var config = {};
  rows.forEach(function(row) {
    var val = typeof row.config_value === 'string'
      ? JSON.parse(row.config_value) : row.config_value;
    config[row.config_key] = val;
  });

  return {
    timeBlocks: config.time_blocks || DEFAULT_TIME_BLOCKS,
    toolMatrix: config.tool_matrix || DEFAULT_TOOL_MATRIX,
    locSchedules: config.loc_schedules || {},
    locScheduleDefaults: config.loc_schedule_defaults || {},
    locScheduleOverrides: config.loc_schedule_overrides || {},
    hourLocationOverrides: config.hour_location_overrides || {},
    preferences: config.preferences || {},
    splitDefault: config.preferences ? config.preferences.splitDefault : undefined,
    splitMinDefault: config.preferences ? config.preferences.splitMinDefault : undefined
  };
}

/**
 * Run the scheduler and persist date moves to the DB.
 * Returns stats: { moved, tasks: [{id, from, to}] }
 */
async function runScheduleAndPersist(userId) {
  // 1. Load all tasks for user
  var taskRows = await db('tasks').where('user_id', userId).select();
  var allTasks = taskRows.map(rowToTask);

  // 2. Build statuses map
  var statuses = {};
  allTasks.forEach(function(t) {
    statuses[t.id] = t.status || '';
  });

  // 3. Get current date/time in Eastern
  var timeInfo = getNowInTimezone();

  // 4. Load config
  var cfg = await loadConfig(userId);

  // 5. Run scheduler
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  // 6. Persist schedule results from dayPlacements (covers all tasks: pool, habits, fixed)
  var updated = 0;
  var updatedTasks = [];

  // Build a lookup of original task data by id
  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Extract the first placement per task from dayPlacements
  var placementByTaskId = {};
  var dayPlacements = result.dayPlacements;
  Object.keys(dayPlacements).forEach(function(dateKey) {
    var placements = dayPlacements[dateKey];
    if (!placements) return;
    placements.forEach(function(p) {
      if (!p.task || !p.task.id) return;
      // Keep the first (earliest) placement per task
      if (!placementByTaskId[p.task.id]) {
        placementByTaskId[p.task.id] = { dateKey: dateKey, start: p.start, dur: p.dur };
      }
    });
  });

  for (var taskId in placementByTaskId) {
    var placement = placementByTaskId[taskId];
    var original = taskById[taskId];
    if (!original) continue;

    // Convert start minutes to "H:MM AM/PM" time string
    var hh = Math.floor(placement.start / 60);
    var mm = placement.start % 60;
    var ampm = hh >= 12 ? 'PM' : 'AM';
    var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
    var newTime = dh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
    var newDate = placement.dateKey;
    var newDay = DAY_NAMES[new Date(2026, parseInt(newDate.split('/')[0]) - 1, parseInt(newDate.split('/')[1])).getDay()];

    var dateChanged = newDate !== original.date;
    var timeChanged = newTime !== original.time;

    if (dateChanged || timeChanged) {
      var dbUpdate = { updated_at: db.fn.now() };
      if (dateChanged) {
        dbUpdate.date = newDate;
        dbUpdate.day = newDay;
      }
      if (timeChanged) {
        dbUpdate.time = newTime;
      }

      await db('tasks')
        .where({ id: taskId, user_id: userId })
        .update(dbUpdate);

      updatedTasks.push({
        id: taskId,
        text: original.text,
        from: original.date,
        to: newDate,
        fromTime: original.time,
        toTime: newTime
      });
      updated++;
    }
  }

  // 7. Clear time on unplaced tasks so they don't ghost-overlap in the UI
  var cleared = 0;
  result.unplaced.forEach(function(t) {
    if (!t || !t.id) return;
    var original = taskById[t.id];
    if (!original) return;
    // Only clear if the task currently has a time set
    if (original.time) {
      // Queue update (don't await in forEach)
      updatedTasks.push({
        id: t.id,
        text: original.text,
        from: original.date,
        to: original.date,
        fromTime: original.time,
        toTime: null,
        cleared: true
      });
    }
  });
  // Persist time clears
  for (var ui = 0; ui < updatedTasks.length; ui++) {
    if (updatedTasks[ui].cleared) {
      await db('tasks')
        .where({ id: updatedTasks[ui].id, user_id: userId })
        .update({ time: null, updated_at: db.fn.now() });
      cleared++;
    }
  }

  console.log('[SCHED] runScheduleAndPersist: updated ' + updated + ', cleared ' + cleared + ' for user ' + userId);

  return { updated: updated, cleared: cleared, tasks: updatedTasks };
}

module.exports = { runScheduleAndPersist };
