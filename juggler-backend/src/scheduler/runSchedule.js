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
var taskToRow = taskController.taskToRow;
var expandRecurringShared = require('../../../shared/scheduler/expandRecurring');
var expandRecurring = expandRecurringShared.expandRecurring;
var cache = require('../lib/redis');

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
// Per-user mutex to prevent concurrent scheduler runs
var _schedulerLocks = {};
function acquireSchedulerLock(userId) {
  if (_schedulerLocks[userId]) return _schedulerLocks[userId];
  var resolve;
  var p = new Promise(function(r) { resolve = r; });
  _schedulerLocks[userId] = p;
  p._resolve = resolve;
  return null; // null means lock acquired
}
function releaseSchedulerLock(userId) {
  var p = _schedulerLocks[userId];
  delete _schedulerLocks[userId];
  if (p && p._resolve) p._resolve();
}

async function runScheduleAndPersist(userId, _retries) {
  var retries = _retries || 0;
  var MAX_RETRIES = 3;

  // Load user timezone
  var userRow = await db('users').where('id', userId).select('timezone').first();
  var TIMEZONE = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;

  try {
  return await db.transaction(async function(trx) {

  // 1. Reset scheduler-moved tasks back to their original scheduled_at
  //    Fixed tasks are user-anchored and should never be reset.
  var resetCount = await trx('tasks')
    .where('user_id', userId)
    .whereNotNull('original_scheduled_at')
    .where(function() {
      this.whereNull('when').orWhere('when', 'not like', '%fixed%');
    })
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

  // 5b. Expand recurring habits into per-day instances and persist them
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + 56);
  var expanded = expandRecurring(allTasks, today, expandEnd);
  if (expanded.length > 0) {
    // Persist generated instances as real habit_instance rows so they can be
    // interacted with (status changes, edits, etc.) without 404 errors.
    var insertRows = expanded.map(function(t) {
      var scheduledAt = t.date ? localToUtc(t.date, t.time || null, TIMEZONE) : null;
      return {
        id: t.id,
        user_id: userId,
        task_type: 'habit_instance',
        source_id: t.sourceId,
        generated: 0,
        habit: 1,
        scheduled_at: scheduledAt || null,
        status: '',
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      };
    });
    var chunkSize = 100;
    for (var ci = 0; ci < insertRows.length; ci += chunkSize) {
      await trx('tasks').insert(insertRows.slice(ci, ci + chunkSize));
    }
    // Re-read all tasks so the newly persisted instances are included with full data
    taskRows = await trx('tasks').where('user_id', userId).select();
    srcMap = buildSourceMap(taskRows);
    allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
    statuses = {};
    allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
    console.log('[SCHED] persisted ' + insertRows.length + ' expanded habit instances');
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

    // Never touch habit templates — they're blueprints, not schedulable tasks.
    if (original.taskType === 'habit_template') continue;
    // Fixed tasks are user-anchored — never override their time/date.
    if (original.when && original.when.indexOf('fixed') >= 0) continue;
    // Markers are non-blocking — never move them.
    if (original.marker) continue;
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
    // Never touch habit templates.
    if (original.taskType === 'habit_template') return;
    // Fixed tasks are user-anchored — never clear their time.
    if (original.when && original.when.indexOf('fixed') >= 0) return;
    // Markers are non-blocking — never clear their time.
    if (original.marker) return;
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
      // Never touch habit templates — they're blueprints, not schedulable tasks
      if (t.taskType === 'habit_template') return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;
      if (!t.date || t.date === 'TBD') return;
      var td = parseDate(t.date);
      if (!td || td >= today) return;  // not past
      // Already handled by placement persistence above
      if (placementByTaskId[t.id]) return;

      var rawRowPast = rawRowById[t.id];
      if (!rawRowPast) return;  // not a real DB task

      // Fixed tasks are user-anchored — never move them, even if past.
      if (t.when && t.when.indexOf('fixed') >= 0) return;
      // Markers are non-blocking — never move them.
      if (t.marker) return;

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
  var placementCache = { dayPlacements: {}, unplaced: [], score: result.score, warnings: result.warnings || [], generatedAt: new Date().toISOString() };
  Object.keys(result.dayPlacements).forEach(function(dk) {
    placementCache.dayPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      var entry = { taskId: p.task ? p.task.id : null, start: p.start, dur: p.dur };
      if (p.locked) entry.locked = true;
      if (p.marker) entry.marker = true;
      if (p._whenRelaxed) entry.whenRelaxed = true;
      if (p.splitPart) { entry.splitPart = p.splitPart; entry.splitTotal = p.splitTotal; }
      if (p.travelBefore) entry.travelBefore = p.travelBefore;
      if (p.travelAfter) entry.travelAfter = p.travelAfter;
      return entry;
    });
  });
  // Store unplaced IDs + diagnostic info in cache
  var unplacedMeta = {};
  result.unplaced.forEach(function(t) {
    if (t._unplacedDetail || t._suggestions) {
      var meta = {};
      if (t._unplacedDetail) meta.detail = t._unplacedDetail;
      if (t._unplacedReason) meta.reason = t._unplacedReason;
      if (t._suggestions) meta.suggestions = t._suggestions;
      if (t._whenBlocked) meta.whenBlocked = true;
      unplacedMeta[t.id] = meta;
    }
  });
  placementCache.unplaced = result.unplaced.map(function(t) { return t.id; });
  placementCache.unplacedMeta = unplacedMeta;
  var cacheJson = JSON.stringify(placementCache);
  var existingCache = await trx('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
  if (existingCache) {
    await trx('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).update({ config_value: cacheJson });
  } else {
    await trx('user_config').insert({ user_id: userId, config_key: 'schedule_cache', config_value: cacheJson });
  }

  // Invalidate Redis caches — scheduler modified tasks
  cache.invalidateTasks(userId).catch(function() {});

  return {
    updated: updated, cleared: cleared, reset: resetCount, tasks: updatedTasks, score: result.score,
    dayPlacements: result.dayPlacements,
    unplaced: result.unplaced.filter(function(t) { return !t.generated; }),
    warnings: result.warnings || []
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

  // If cache is stale, re-run the scheduler.
  // Stale conditions: different day, >30 min old, or tasks modified since cache was generated.
  var cacheStale = false;
  if (cache && cache.generatedAt) {
    var genTime = new Date(cache.generatedAt);
    var ageMs = Date.now() - genTime.getTime();
    // Use Intl to get the generated date in the user's timezone (server may run in UTC)
    var genParts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, month: 'numeric', day: 'numeric' }).formatToParts(genTime);
    var genVals = {}; genParts.forEach(function(p) { genVals[p.type] = p.value; });
    var genDateKey = genVals.month + '/' + genVals.day;
    if (genDateKey !== timeInfo.todayKey || ageMs > 30 * 60 * 1000) {
      cacheStale = true;
    }
    // Check if any tasks were modified since the cache was generated
    if (!cacheStale) {
      var maxRow = await db('tasks').where('user_id', userId)
        .max('updated_at as max_updated').first();
      if (maxRow && maxRow.max_updated) {
        var lastModified = new Date(String(maxRow.max_updated).replace(' ', 'T') + 'Z');
        if (lastModified > genTime) {
          console.log('[SCHED] cache stale: tasks modified since cache (' + Math.round((lastModified - genTime) / 1000) + 's newer)');
          cacheStale = true;
        }
      }
    }
    // Check if cache has no placements for today but tasks exist for today
    if (!cacheStale && cache.dayPlacements && !cache.dayPlacements[timeInfo.todayKey]) {
      var todayTasks = allTasks.filter(function(t) { return t.date === timeInfo.todayKey; });
      var activeTodayTasks = todayTasks.filter(function(t) {
        var st = statuses[t.id] || '';
        return st !== 'done' && st !== 'cancel' && st !== 'skip';
      });
      if (activeTodayTasks.length > 0) {
        console.log('[SCHED] cache stale: no placements for today but ' + activeTodayTasks.length + ' active tasks exist');
        cacheStale = true;
      }
    }
  }

  if (cacheStale && cache) {
    // Check if another request is already re-running the scheduler
    var existingLock = acquireSchedulerLock(userId);
    if (existingLock) {
      console.log('[SCHED] cache stale but scheduler already running, waiting...');
      await existingLock;
      // Re-read the cache that the other run produced
      var freshCacheRow = await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
      if (freshCacheRow) {
        try {
          cache = typeof freshCacheRow.config_value === 'string' ? JSON.parse(freshCacheRow.config_value) : freshCacheRow.config_value;
        } catch (e) { /* fall through */ }
      }
    } else {
      // We hold the lock — run the scheduler
      console.log('[SCHED] cache stale (age=' + Math.round((Date.now() - new Date(cache.generatedAt).getTime()) / 60000) + 'm), re-running scheduler');
      try {
        var freshResult = await runScheduleAndPersist(userId);
        releaseSchedulerLock(userId);
        return {
          dayPlacements: freshResult.dayPlacements,
          unplaced: freshResult.unplaced,
          score: freshResult.score,
          warnings: freshResult.warnings || [],
          hasPastTasks: hasPastTasks
        };
      } catch (err) {
        releaseSchedulerLock(userId);
        console.error('[SCHED] stale re-run failed, using cached:', err.message);
        // Fall through to cached hydration
      }
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
        var hydrated = { task: task, start: p.start, dur: p.dur };
        if (p.locked) hydrated.locked = true;
        if (p.marker) hydrated.marker = true;
        if (p.whenRelaxed) hydrated._whenRelaxed = true;
        if (p.splitPart) { hydrated.splitPart = p.splitPart; hydrated.splitTotal = p.splitTotal; }
        if (p.travelBefore) hydrated.travelBefore = p.travelBefore;
        if (p.travelAfter) hydrated.travelAfter = p.travelAfter;
        dayPlacements[dk].push(hydrated);
        cachedIds[p.taskId] = true;
      });
      if (dayPlacements[dk].length === 0) delete dayPlacements[dk];
    });

    // Collect unplaced: cached unplaced + any new tasks not in cache.
    // Mirror the same exclusions that unifiedSchedule applies so tasks the
    // scheduler would silently drop don't inflate the unplaced count.
    var cachedUnplacedSet = {};
    (cache.unplaced || []).forEach(function(id) { cachedUnplacedSet[id] = true; });
    var cachedMeta = cache.unplacedMeta || {};
    var unplaced = [];
    allTasks.forEach(function(t) {
      if (t.generated) return;
      if (t.taskType === 'habit_template') return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;
      // Already placed in a day slot — not unplaced
      if (cachedIds[t.id]) return;
      // Known unplaced from cache — include it with cached diagnostics
      if (cachedUnplacedSet[t.id]) {
        var meta = cachedMeta[t.id];
        if (meta) {
          if (meta.detail) t._unplacedDetail = meta.detail;
          if (meta.reason) t._unplacedReason = meta.reason;
          if (meta.suggestions) t._suggestions = meta.suggestions;
          if (meta.whenBlocked) t._whenBlocked = true;
        }
        unplaced.push(t);
        return;
      }
      // New task not in cache at all — apply scheduler exclusion rules
      if (t.marker) return;
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
      warnings: cache.warnings || [],
      hasPastTasks: hasPastTasks
    };
  }

  // No cache — first load, run scheduler and cache the result
  console.log('[SCHED] no placement cache, running scheduler for first load');
  var cfg = await loadConfig(userId);
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  // Save cache
  var newCache = { dayPlacements: {}, unplaced: [], score: result.score, warnings: result.warnings || [], generatedAt: new Date().toISOString() };
  Object.keys(result.dayPlacements).forEach(function(dk) {
    newCache.dayPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      var entry = { taskId: p.task ? p.task.id : null, start: p.start, dur: p.dur };
      if (p.locked) entry.locked = true;
      if (p.marker) entry.marker = true;
      if (p._whenRelaxed) entry.whenRelaxed = true;
      if (p.splitPart) { entry.splitPart = p.splitPart; entry.splitTotal = p.splitTotal; }
      if (p.travelBefore) entry.travelBefore = p.travelBefore;
      if (p.travelAfter) entry.travelAfter = p.travelAfter;
      return entry;
    });
  });
  newCache.unplaced = result.unplaced.map(function(t) { return t.id; });
  var unplacedMeta2 = {};
  result.unplaced.forEach(function(t) {
    if (t._unplacedDetail || t._suggestions) {
      var meta = {};
      if (t._unplacedDetail) meta.detail = t._unplacedDetail;
      if (t._unplacedReason) meta.reason = t._unplacedReason;
      if (t._suggestions) meta.suggestions = t._suggestions;
      if (t._whenBlocked) meta.whenBlocked = true;
      unplacedMeta2[t.id] = meta;
    }
  });
  newCache.unplacedMeta = unplacedMeta2;
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
    warnings: result.warnings || [],
    hasPastTasks: hasPastTasks
  };
}

module.exports = { runScheduleAndPersist, getSchedulePlacements };
