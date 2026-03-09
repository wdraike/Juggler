/**
 * runSchedule.js — Load data, run scheduler, persist date moves
 *
 * The DB stores scheduled_at (UTC DATETIME) as the single source of truth.
 * The scheduler works with in-memory task objects that have local date/time/day
 * properties, derived from scheduled_at via rowToTask().
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
var localToUtc = dateHelpers.localToUtc;
var utcToLocal = dateHelpers.utcToLocal;
var taskController = require('../controllers/task.controller');
var rowToTask = taskController.rowToTask;
var buildSourceMap = taskController.buildSourceMap;

var DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Get current date/time in user's timezone
 */
function getNowInTimezone(timezone) {
  var tz = timezone || DEFAULT_TIMEZONE;
  var now = new Date();
  var parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(now);

  var vals = {};
  parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });

  var month = vals.month;
  var day = vals.day;
  var hour = vals.hour % 24;
  var minute = vals.minute;

  return {
    todayKey: month + '/' + day,
    nowMins: hour * 60 + minute
  };
}

/**
 * Expand recurring habits into per-day instances so the scheduler always has
 * tasks to work with, even if the frontend hasn't generated them yet.
 */
function expandRecurring(allTasks, startDate, endDate) {
  var dayMap = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
  var existingIds = {};
  allTasks.forEach(function(t) { existingIds[t.id] = true; });
  var existingByDateText = {};
  allTasks.forEach(function(t) {
    if (t.date && t.text) existingByDateText[t.date + '|' + t.text] = true;
  });

  var sources = allTasks.filter(function(t) { return t.recur && t.recur.type !== 'none'; });
  if (sources.length === 0) return [];

  var newTasks = [];
  var cursor = new Date(startDate); cursor.setHours(0, 0, 0, 0);
  var end = new Date(endDate); end.setHours(23, 59, 59, 999);

  while (cursor <= end) {
    var dateStr = formatDateKey(cursor);
    var dow = cursor.getDay();
    var dayName = DAY_NAMES[dow];

    sources.forEach(function(src) {
      var r = src.recur;
      var srcDate = parseDate(src.date);
      if (!srcDate) srcDate = new Date(startDate);
      if (cursor < srcDate) return;
      if (dateStr === src.date) return;

      var match = false;
      if (r.type === 'daily') {
        match = true;
      } else if (r.type === 'weekly' || r.type === 'biweekly') {
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
        taskType: 'generated', sourceId: src.id, generated: true
      });
    });

    cursor.setDate(cursor.getDate() + 1);
  }
  return newTasks;
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
 * reset to their original_scheduled_at so the algorithm starts from the
 * user's intended placement every time.
 *
 * Returns stats: { updated, cleared, reset, tasks: [...] }
 */
async function runScheduleAndPersist(userId, _retries) {
  var retries = _retries || 0;
  var MAX_RETRIES = 3;

  // Load user timezone
  var userRow = await db('users').where('id', userId).select('timezone').first();
  var TIMEZONE = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;

  try {
  return await db.transaction(async function(trx) {

  // 1. Reset scheduler-moved tasks back to their original scheduled_at
  var resetCount = await trx('tasks')
    .where('user_id', userId)
    .whereNotNull('original_scheduled_at')
    .update({
      scheduled_at: db.raw('original_scheduled_at'),
      original_scheduled_at: null,
      updated_at: db.fn.now()
    });

  if (resetCount > 0) console.log('[SCHED] reset ' + resetCount + ' tasks to original_scheduled_at');

  // 2. Load all tasks for user (now with originals restored)
  var taskRows = await trx('tasks').where('user_id', userId).select();
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });

  // 3. Build statuses map
  var statuses = {};
  allTasks.forEach(function(t) {
    statuses[t.id] = t.status || '';
  });

  // 4. Get current date/time in user's timezone
  var timeInfo = getNowInTimezone(TIMEZONE);

  // 5. Load config
  var cfg = await loadConfig(userId);

  // 5b. Expand recurring habits into per-day instances
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + 56);
  var expanded = expandRecurring(allTasks, today, expandEnd);
  if (expanded.length > 0) {
    allTasks = allTasks.concat(expanded);
    expanded.forEach(function(t) { statuses[t.id] = ''; });
  }

  // 6. Run scheduler
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  // 7. Persist schedule results from dayPlacements
  var updated = 0;
  var updatedTasks = [];

  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Build a map of raw rows by ID for accessing scheduled_at
  var rawRowById = {};
  taskRows.forEach(function(r) { rawRowById[r.id] = r; });

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

  // Collect all updates, then batch them to minimize lock contention
  var pendingUpdates = []; // { id, dbUpdate }

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

    var dateChanged = newDate !== original.date;
    var timeChanged = newTime !== original.time;

    // Habits should never have their date moved — they're day-specific.
    // Rigid habits also keep their preferred time.
    if (original.habit && dateChanged) continue;
    if (original.habit && original.rigid) continue;

    if (dateChanged || timeChanged) {
      // Compute the new scheduled_at from the placement's local date+time
      var newScheduledAt = localToUtc(newDate, newTime, TIMEZONE);
      if (!newScheduledAt) continue;

      var rawRow = rawRowById[taskId];
      pendingUpdates.push({
        id: taskId,
        dbUpdate: {
          scheduled_at: newScheduledAt,
          original_scheduled_at: rawRow ? rawRow.scheduled_at : null,
          updated_at: db.fn.now()
        }
      });

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
      var rawRowClr = rawRowById[t.id];
      var clearUpdate = {
        original_scheduled_at: rawRowClr ? rawRowClr.scheduled_at : null,
        updated_at: db.fn.now()
      };
      var clearOriginal = taskById[t.id];
      if (clearOriginal && clearOriginal.date) {
        var utcMidnight = localToUtc(clearOriginal.date, '12:00 AM', TIMEZONE);
        if (utcMidnight) clearUpdate.scheduled_at = utcMidnight;
      }
      pendingUpdates.push({ id: t.id, dbUpdate: clearUpdate });
      updatedTasks.push({
        id: t.id,
        text: original.text,
        from: original.date,
        to: original.date,
        fromTime: original.time,
        toTime: null,
        cleared: true
      });
      cleared++;
    }
  });

  // 9. Move remaining past-dated tasks to today
  //    Past habits missed their day — mark as 'skip'.
  //    Past non-habit tasks that weren't placed — move date to today.
  var todayMidnight = localToUtc(timeInfo.todayKey, '12:00 AM', TIMEZONE);
  if (todayMidnight) {
    var movedPast = 0;
    allTasks.forEach(function(t) {
      // Skip generated recurring instances (not real DB rows)
      if (t.generated) return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;
      if (!t.date || t.date === 'TBD') return;
      var td = parseDate(t.date);
      if (!td || td >= today) return;  // not past
      // Already handled by placement persistence above
      if (placementByTaskId[t.id]) return;

      var rawRowPast = rawRowById[t.id];
      if (!rawRowPast) return;  // not a real DB task

      if (t.habit) {
        // Past habit — day was missed, mark as skipped
        pendingUpdates.push({
          id: t.id,
          dbUpdate: { status: 'skip', updated_at: db.fn.now() }
        });
      } else {
        // Past non-habit — move date forward to today
        pendingUpdates.push({
          id: t.id,
          dbUpdate: {
            scheduled_at: todayMidnight,
            original_scheduled_at: rawRowPast.scheduled_at,
            updated_at: db.fn.now()
          }
        });
      }
      movedPast++;
    });
    if (movedPast > 0) console.log('[SCHED] moved/skipped ' + movedPast + ' past-dated tasks');
  }

  // Execute all updates in sorted order to avoid deadlocks
  pendingUpdates.sort(function(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  for (var pi = 0; pi < pendingUpdates.length; pi++) {
    await trx('tasks')
      .where({ id: pendingUpdates[pi].id, user_id: userId })
      .update(pendingUpdates[pi].dbUpdate);
  }

  console.log('[SCHED] runScheduleAndPersist: reset ' + resetCount + ', updated ' + updated + ', cleared ' + cleared + ' for user ' + userId);

  // 10. Cache the placement result so GET /placements doesn't re-run the scheduler
  var placementCache = { dayPlacements: {}, unplaced: [], score: result.score, generatedAt: new Date().toISOString() };
  Object.keys(result.dayPlacements).forEach(function(dk) {
    placementCache.dayPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      return { taskId: p.task ? p.task.id : null, start: p.start, dur: p.dur };
    });
  });
  placementCache.unplaced = result.unplaced.map(function(t) { return t.id; });
  var cacheJson = JSON.stringify(placementCache);
  var existingCache = await trx('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
  if (existingCache) {
    await trx('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).update({ config_value: cacheJson });
  } else {
    await trx('user_config').insert({ user_id: userId, config_key: 'schedule_cache', config_value: cacheJson });
  }

  return {
    updated: updated, cleared: cleared, reset: resetCount, tasks: updatedTasks, score: result.score,
    dayPlacements: result.dayPlacements,
    unplaced: result.unplaced.filter(function(t) { return !t.generated; })
  };

  }); // end transaction
  } catch (err) {
    if (err.code === 'ER_LOCK_DEADLOCK' && retries < MAX_RETRIES) {
      console.log('[SCHED] deadlock detected, retry ' + (retries + 1) + '/' + MAX_RETRIES);
      await new Promise(function(r) { setTimeout(r, 200 * (retries + 1)); });
      return runScheduleAndPersist(userId, retries + 1);
    }
    throw err;
  }
}

/**
 * Read-only: return cached placements from the last scheduler run.
 * Falls back to running the scheduler if no cache exists (first load).
 *
 * This ensures the schedule is stable across page loads — only an explicit
 * POST /schedule/run changes task placements.
 */
async function getSchedulePlacements(userId) {
  var userRow = await db('users').where('id', userId).select('timezone').first();
  var TIMEZONE = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;

  // Load all tasks (needed for hydration and hasPastTasks check)
  var taskRows = await db('tasks').where('user_id', userId).select();
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });

  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });

  var timeInfo = getNowInTimezone(TIMEZONE);

  // Expand recurring so generated instances can be hydrated from cache
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + 56);
  var expanded = expandRecurring(allTasks, today, expandEnd);
  if (expanded.length > 0) {
    allTasks = allTasks.concat(expanded);
    expanded.forEach(function(t) { statuses[t.id] = ''; });
  }

  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Try cached placements
  var cacheRow = await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
  var cache = null;
  if (cacheRow) {
    try {
      cache = typeof cacheRow.config_value === 'string' ? JSON.parse(cacheRow.config_value) : cacheRow.config_value;
    } catch (e) { cache = null; }
  }

  // Check for past tasks (same logic regardless of cache)
  var hasPastTasks = false;
  var todayDate = parseDate(timeInfo.todayKey);
  if (todayDate) {
    for (var ti = 0; ti < allTasks.length; ti++) {
      var t = allTasks[ti];
      if (t.generated) continue;
      if (t.taskType === 'habit_template') continue;
      var tSt = statuses[t.id] || '';
      if (tSt === 'done' || tSt === 'cancel' || tSt === 'skip') continue;
      if (!t.date || t.date === 'TBD') continue;
      var tDate = parseDate(t.date);
      if (tDate && tDate < todayDate) { hasPastTasks = true; break; }
    }
  }

  if (cache && cache.dayPlacements) {
    // Hydrate cached placements with current task data
    var dayPlacements = {};
    var cachedIds = {};
    Object.keys(cache.dayPlacements).forEach(function(dk) {
      dayPlacements[dk] = [];
      cache.dayPlacements[dk].forEach(function(p) {
        var task = taskById[p.taskId];
        if (!task) return; // task was deleted since last run
        var st = statuses[p.taskId] || '';
        if (st === 'done' || st === 'cancel' || st === 'skip') return; // completed since last run
        dayPlacements[dk].push({ task: task, start: p.start, dur: p.dur });
        cachedIds[p.taskId] = true;
      });
      if (dayPlacements[dk].length === 0) delete dayPlacements[dk];
    });

    // Collect unplaced: cached unplaced + any new tasks not in cache.
    // Mirror the same exclusions that unifiedSchedule applies so tasks the
    // scheduler would silently drop don't inflate the unplaced count.
    var cachedUnplacedSet = {};
    (cache.unplaced || []).forEach(function(id) { cachedUnplacedSet[id] = true; });
    var unplaced = [];
    allTasks.forEach(function(t) {
      if (t.generated) return;
      if (t.taskType === 'habit_template') return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;
      // Already placed in a day slot — not unplaced
      if (cachedIds[t.id]) return;
      // Known unplaced from cache — include it
      if (cachedUnplacedSet[t.id]) { unplaced.push(t); return; }
      // New task not in cache at all — apply scheduler exclusion rules
      if (t.when && t.when.indexOf('allday') >= 0) return;
      if (t.section && (t.section.indexOf('PARKING') >= 0 || t.section.indexOf('TO BE SCHEDULED') >= 0)) return;
      if (!t.date || t.date === 'TBD') return;
      var td = parseDate(t.date);
      if (!td) return;
      var isPast = td < todayDate;
      // Past habits missed their day — not schedulable
      if (t.habit && isPast) return;
      // Past fixed tasks — not schedulable
      if (isPast && t.when && t.when.indexOf('fixed') >= 0) return;
      unplaced.push(t);
    });

    return {
      dayPlacements: dayPlacements,
      unplaced: unplaced,
      score: cache.score || {},
      hasPastTasks: hasPastTasks
    };
  }

  // No cache — first load, run scheduler and cache the result
  console.log('[SCHED] no placement cache, running scheduler for first load');
  var cfg = await loadConfig(userId);
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  // Save cache
  var newCache = { dayPlacements: {}, unplaced: [], score: result.score, generatedAt: new Date().toISOString() };
  Object.keys(result.dayPlacements).forEach(function(dk) {
    newCache.dayPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      return { taskId: p.task ? p.task.id : null, start: p.start, dur: p.dur };
    });
  });
  newCache.unplaced = result.unplaced.map(function(t) { return t.id; });
  var cacheJson = JSON.stringify(newCache);
  var existingRow = await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
  if (existingRow) {
    await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).update({ config_value: cacheJson });
  } else {
    await db('user_config').insert({ user_id: userId, config_key: 'schedule_cache', config_value: cacheJson });
  }

  return {
    dayPlacements: result.dayPlacements,
    unplaced: result.unplaced.filter(function(t) { return !t.generated; }),
    score: result.score,
    hasPastTasks: hasPastTasks
  };
}

module.exports = { runScheduleAndPersist, getSchedulePlacements };
