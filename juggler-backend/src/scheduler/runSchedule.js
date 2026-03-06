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
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(now);

  var vals = {};
  parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });

  var month = vals.month;
  var day = vals.day;
  var hour = vals.hour % 24; // Normalize: some runtimes return 24 for midnight
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
    scheduleTemplates: config.schedule_templates || null,
    preferences: config.preferences || {},
    splitDefault: config.preferences ? config.preferences.splitDefault : undefined,
    splitMinDefault: config.preferences ? config.preferences.splitMinDefault : undefined
  };
}

/**
 * Run the scheduler and persist date moves to the DB.
 *
 * Before each run, tasks that were previously moved by the scheduler are
 * reset to their original_date / original_time so the algorithm starts
 * from the user's intended placement every time.
 *
 * Returns stats: { updated, cleared, reset, tasks: [...] }
 */
async function runScheduleAndPersist(userId) {
  return db.transaction(async function(trx) {

  // 1a. Reset scheduler-moved tasks (date changed) back to their original date/time
  var resetCount = await trx('tasks')
    .where('user_id', userId)
    .whereNotNull('original_date')
    .update({
      date: db.raw('original_date'),
      day: db.raw('COALESCE(original_day, day)'),
      time: db.raw('original_time'),
      original_date: null,
      original_time: null,
      original_day: null,
      updated_at: db.fn.now()
    });

  // 1b. Reset scheduler-moved tasks (time-only change) back to original time
  var resetTimeCount = await trx('tasks')
    .where('user_id', userId)
    .whereNull('original_date')
    .whereNotNull('original_time')
    .update({
      time: db.raw('original_time'),
      original_time: null,
      updated_at: db.fn.now()
    });

  if (resetCount + resetTimeCount > 0) console.log('[SCHED] reset ' + resetCount + ' date moves, ' + resetTimeCount + ' time moves');

  // 2. Load all tasks for user (now with original dates restored)
  var taskRows = await trx('tasks').where('user_id', userId).select();
  var allTasks = taskRows.map(rowToTask);

  // 3. Build statuses map
  var statuses = {};
  allTasks.forEach(function(t) {
    statuses[t.id] = t.status || '';
  });

  // 4. Get current date/time in Eastern
  var timeInfo = getNowInTimezone();

  // 5. Load config
  var cfg = await loadConfig(userId);

  // 6. Run scheduler
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  // 7. Persist schedule results from dayPlacements
  var updated = 0;
  var updatedTasks = [];

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
    var dateHelpers = require('./dateHelpers');
    var newDay = DAY_NAMES[dateHelpers.parseDate(newDate).getDay()];

    var dateChanged = newDate !== original.date;
    var timeChanged = newTime !== original.time;

    // Habits should never have their date moved — they're day-specific.
    // Rigid habits also keep their preferred time.
    if (original.habit && dateChanged) continue;
    if (original.habit && original.rigid) continue;

    if (dateChanged || timeChanged) {
      var dbUpdate = { updated_at: db.fn.now() };
      if (dateChanged) {
        dbUpdate.date = newDate;
        dbUpdate.day = newDay;
        // Save the user's original date so we can reset next run
        dbUpdate.original_date = original.date;
        dbUpdate.original_day = original.day;
      }
      if (timeChanged) {
        dbUpdate.time = newTime;
        if (!dbUpdate.original_date) {
          // Date didn't change but time did — still track original time
          dbUpdate.original_time = original.time;
        } else {
          dbUpdate.original_time = original.time;
        }
      }

      await trx('tasks')
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

  // 8. Clear time on unplaced tasks so they don't ghost-overlap in the UI
  var cleared = 0;
  result.unplaced.forEach(function(t) {
    if (!t || !t.id) return;
    var original = taskById[t.id];
    if (!original) return;
    if (original.time) {
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
  for (var ui = 0; ui < updatedTasks.length; ui++) {
    if (updatedTasks[ui].cleared) {
      await trx('tasks')
        .where({ id: updatedTasks[ui].id, user_id: userId })
        .update({ time: null, original_time: updatedTasks[ui].fromTime, updated_at: db.fn.now() });
      cleared++;
    }
  }

  console.log('[SCHED] runScheduleAndPersist: reset ' + resetCount + ', updated ' + updated + ', cleared ' + cleared + ' for user ' + userId);

  return { updated: updated, cleared: cleared, reset: resetCount, tasks: updatedTasks };

  }); // end transaction
}

/**
 * Read-only: load data, run scheduler, return placements without DB writes.
 */
async function getSchedulePlacements(userId) {
  var taskRows = await db('tasks').where('user_id', userId).select();
  var allTasks = taskRows.map(rowToTask);

  var statuses = {};
  allTasks.forEach(function(t) {
    statuses[t.id] = t.status || '';
  });

  var timeInfo = getNowInTimezone();
  var cfg = await loadConfig(userId);
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  return {
    dayPlacements: result.dayPlacements,
    unplaced: result.unplaced,
    deadlineMisses: result.deadlineMisses,
    placedCount: result.placedCount
  };
}

module.exports = { runScheduleAndPersist, getSchedulePlacements };
