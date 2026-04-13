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
var parseTimeToMinutes = dateHelpers.parseTimeToMinutes;
var formatMinutesToTime = dateHelpers.formatMinutesToTime;
var localToUtc = dateHelpers.localToUtc;
var utcToLocal = dateHelpers.utcToLocal;
var taskController = require('../controllers/task.controller');
var rowToTask = taskController.rowToTask;
var buildSourceMap = taskController.buildSourceMap;
var taskToRow = taskController.taskToRow;
var expandRecurringShared = require('../../../shared/scheduler/expandRecurring');
var expandRecurring = expandRecurringShared.expandRecurring;
var cache = require('../lib/redis');
var syncLock = require('../lib/sync-lock');

var DEFAULT_TIMEZONE = constants.DEFAULT_TIMEZONE;

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
 * The scheduler reads current scheduled_at values and places tasks from
 * scratch. Only tasks whose scheduled_at actually changed are written back.
 * Pinned, fixed, marker, and template tasks are never modified.
 *
 * Returns stats: { updated, cleared, tasks: [...] }
 */
// Per-user mutex to prevent concurrent scheduler runs (Redis-based for multi-process safety)
var LOCK_TTL_MS = 30000; // 30s max lock hold time
async function acquireSchedulerLock(userId) {
  var lockKey = 'sched_lock:' + userId;
  try {
    var acquired = await cache.getClient().set(lockKey, Date.now(), 'PX', LOCK_TTL_MS, 'NX');
    return acquired ? null : 'locked'; // null = acquired, truthy = already locked
  } catch (e) {
    return null; // Redis down — allow through (fail open)
  }
}
async function releaseSchedulerLock(userId) {
  var lockKey = 'sched_lock:' + userId;
  try { await cache.getClient().del(lockKey); } catch (e) { /* fail open */ }
}

async function runScheduleAndPersist(userId, _retries, options) {
  var retries = _retries || 0;
  var MAX_RETRIES = 3;

  // Timezone from frontend (X-Timezone header) via options, or fallback
  var TIMEZONE = (options && options.timezone) || DEFAULT_TIMEZONE;

  try {
  return await db.transaction(async function(trx) {

  // 1. Load all tasks for user
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
  cfg.timezone = TIMEZONE;

  // 5b. Reconcile recurring instance expansion.
  // Instance IDs are derived from sourceId + date (see expandRecurring.js:293),
  // so they're stable across runs. Rather than delete-all-then-regenerate
  // (which bumps updated_at on every pending instance every run and triggers
  // a full frontend refresh via /tasks/version), we diff the desired expansion
  // against the existing pending set and only INSERT truly new instances and
  // DELETE stale ones. Unchanged rows stay byte-identical — no write, no
  // updated_at bump, no version bump, no SSE churn.
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + 56);

  // Existing pending recurring instances keyed by id (from the in-memory load).
  var existingPendingIds = {};
  taskRows.forEach(function(r) {
    if (r.task_type === 'recurring_instance' && (!r.status || r.status === '')) {
      existingPendingIds[r.id] = true;
    }
  });

  // expandRecurring() skips generating an instance whose (sourceId, date)
  // already appears in allTasks (see expandRecurring.js:28-35). To learn the
  // full desired set (not just the "missing" delta), hide existing pending
  // instances from it — same effect as the old "delete first" sequence, but
  // no DB round-trip.
  var allTasksForExpand = allTasks.filter(function(t) {
    if (t.taskType !== 'recurring_instance') return true;
    return !existingPendingIds[t.id]; // keep non-pending (done/skipped) instances
  });
  var desired = expandRecurring(allTasksForExpand, today, expandEnd, { statuses: statuses });
  var MAX_EXPANDED = 500;
  if (desired.length > MAX_EXPANDED) {
    console.warn('[SCHED] expansion capped: ' + desired.length + ' → ' + MAX_EXPANDED);
    desired = desired.slice(0, MAX_EXPANDED);
  }

  // Diff desired vs existing pending.
  var desiredIds = {};
  desired.forEach(function(t) { desiredIds[t.id] = true; });
  var toInsert = desired.filter(function(t) { return !existingPendingIds[t.id]; });
  var toDeleteIds = Object.keys(existingPendingIds).filter(function(id) { return !desiredIds[id]; });

  // Preserve the variable names the downstream changeset computation uses:
  //   deadIds = ids that were actually deleted this run
  //   expanded = instances that were actually inserted this run
  var deadIds = toDeleteIds;
  var expanded = toInsert;

  var reconcileChanged = false;
  if (toDeleteIds.length > 0) {
    await trx('tasks').whereIn('id', toDeleteIds).del();
    console.log('[SCHED] reconcile: deleted ' + toDeleteIds.length + ' stale recurring instances');
    reconcileChanged = true;
  }
  if (toInsert.length > 0) {
    var insertRows = toInsert.map(function(t) {
      var scheduledAt = t.date ? localToUtc(t.date, t.time || null, TIMEZONE) : null;
      return {
        id: t.id,
        user_id: userId,
        task_type: 'recurring_instance',
        source_id: t.sourceId,
        generated: 0,
        recurring: 1,
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
    console.log('[SCHED] reconcile: inserted ' + toInsert.length + ' new recurring instances');
    reconcileChanged = true;
  }

  // Re-read all tasks only if the reconcile actually changed the set.
  if (reconcileChanged) {
    taskRows = await trx('tasks').where('user_id', userId).select();
    srcMap = buildSourceMap(taskRows);
    allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
    statuses = {};
    allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
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

    var newTime = formatMinutesToTime(placement.start);
    var newDate = placement.dateKey;

    var dateChanged = newDate !== original.date;
    var timeChanged = newTime !== original.time;

    // Never touch recurring templates — they're blueprints, not schedulable tasks.
    if (original.taskType === 'recurring_template') continue;
    // Fixed tasks are user-anchored — never override their time/date.
    if (original.when && original.when.indexOf('fixed') >= 0) continue;
    // Date-pinned tasks are user-set — never override their date/time.
    if (original.datePinned) continue;
    // Markers are non-blocking — never move them.
    if (original.marker) continue;
    // Recurrings should never have their date moved — they're day-specific.
    // Exception: past recurringTasks within their placement window can be moved to today.
    if (original.recurring && dateChanged) {
      var origTd = parseDate(original.date);
      var isBehind = origTd && origTd < today;
      var recurFlex = original.timeFlex != null ? original.timeFlex : 60;
      var recurDaysPast = origTd ? Math.round((today.getTime() - origTd.getTime()) / 86400000) : 0;
      if (!isBehind || recurFlex < recurDaysPast * 1440) continue;
      // Within placement window — allow the date move to today
    }
    // Rigid recurringTasks keep their preferred time (unless redirected from past above).
    if (original.recurring && original.rigid && !dateChanged) continue;

    if (dateChanged || timeChanged) {
      // Compute the new scheduled_at from the placement's local date+time
      var newScheduledAt = localToUtc(newDate, newTime, TIMEZONE);
      if (!newScheduledAt) continue;

      // Minimal-diff: skip write if scheduled_at hasn't actually changed
      var rawRow = rawRowById[taskId];
      if (rawRow && rawRow.scheduled_at && newScheduledAt.getTime() === new Date(rawRow.scheduled_at).getTime()) continue;

      pendingUpdates.push({
        id: taskId,
        dbUpdate: {
          scheduled_at: newScheduledAt,
          unscheduled: null,
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

  // 8. Mark unplaced tasks — set unscheduled flag instead of overwriting scheduled_at
  //    Skip future recurring instances — they'll be placed when their day arrives.
  var cleared = 0;
  result.unplaced.forEach(function(t) {
    if (!t || !t.id) return;
    var original = taskById[t.id];
    if (!original) return;
    if (original.taskType === 'recurring_template') return;
    if (original.when && original.when.indexOf('fixed') >= 0) return;
    if (original.datePinned) return;
    if (original.marker) return;
    // Recurring instances that weren't placed by the algorithm should not be flagged
    // as unscheduled — they'll be placed when their day comes, or auto-skipped if past.
    if (original.taskType === 'recurring_instance') return;
    // Mark as unscheduled — clear scheduled_at so the task shows as unscheduled, not at a fake time
    pendingUpdates.push({ id: t.id, dbUpdate: { unscheduled: 1, scheduled_at: null, updated_at: db.fn.now() } });
    cleared++;
  });

  // Build unplaced lookup so Phase 9 doesn't overwrite Phase 8's null scheduled_at
  var unplacedIds = {};
  result.unplaced.forEach(function(t) { if (t && t.id) unplacedIds[t.id] = true; });

  // 9. Move remaining past-dated tasks to today
  //    Past recurringTasks missed their day — mark as 'skip'.
  //    Past non-recurringTasks that weren't placed — move date to today.
  var todayMidnight = localToUtc(timeInfo.todayKey, '12:00 AM', TIMEZONE);
  if (todayMidnight) {
    var movedPast = 0;
    allTasks.forEach(function(t) {
      // Skip generated recurring instances (not real DB rows)
      if (t.generated) return;
      // Never touch recurring templates — they're blueprints, not schedulable tasks
      if (t.taskType === 'recurring_template') return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'pause' || st === 'disabled') return;
      if (!t.date || t.date === 'TBD') return;
      var td = parseDate(t.date);
      if (!td || td >= today) return;  // not past
      // Already handled by placement persistence above
      if (placementByTaskId[t.id]) return;
      // Already marked unscheduled in Phase 8 — don't overwrite with midnight
      if (unplacedIds[t.id]) return;

      var rawRowPast = rawRowById[t.id];
      if (!rawRowPast) return;  // not a real DB task

      // Fixed tasks are user-anchored — never move them, even if past.
      if (t.when && t.when.indexOf('fixed') >= 0) return;
      // Date-pinned tasks are user-set — never move them.
      if (t.datePinned) return;
      // Markers are non-blocking — never move them.
      if (t.marker) return;

      if (t.recurring) {
        // Past recurring — check placement window before auto-skipping.
        // If still within timeFlex range, the scheduler can place it today.
        var flex = t.timeFlex != null ? t.timeFlex : 60;
        var daysPast = Math.round((today.getTime() - td.getTime()) / 86400000);
        if (flex >= daysPast * 1440) return; // still within window, don't skip
        // Outside placement window — day was missed, mark as skipped
        pendingUpdates.push({
          id: t.id,
          dbUpdate: { status: 'skip', updated_at: db.fn.now() }
        });
      } else {
        // Past non-recurring — move date forward to today
        pendingUpdates.push({
          id: t.id,
          dbUpdate: {
            scheduled_at: todayMidnight,
            updated_at: db.fn.now()
          }
        });
      }
      movedPast++;
    });
    if (movedPast > 0) console.log('[SCHED] moved/skipped ' + movedPast + ' past-dated tasks');
  }

  // Execute updates in batches to avoid long-running single-row UPDATEs.
  // Group by identical dbUpdate shape, then batch with CASE expressions.
  console.log('[SCHED] executing ' + pendingUpdates.length + ' DB updates');
  pendingUpdates.sort(function(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });

  // Batch scheduled_at updates (the most common case)
  var scheduledAtUpdates = [];
  var otherUpdates = [];
  pendingUpdates.forEach(function(pu) {
    if (pu.dbUpdate.scheduled_at && !pu.dbUpdate.status) {
      scheduledAtUpdates.push(pu);
    } else {
      otherUpdates.push(pu);
    }
  });

  // Batch scheduled_at updates in chunks of 200 using CASE expressions
  var CHUNK = 200;
  for (var ci = 0; ci < scheduledAtUpdates.length; ci += CHUNK) {
    var chunk = scheduledAtUpdates.slice(ci, ci + CHUNK);
    var ids = chunk.map(function(pu) { return pu.id; });
    var caseExpr = 'CASE id';
    var bindings = [];
    chunk.forEach(function(pu) {
      caseExpr += ' WHEN ? THEN ?';
      bindings.push(pu.id, pu.dbUpdate.scheduled_at);
    });
    caseExpr += ' END';
    await trx('tasks')
      .where('user_id', userId)
      .whereIn('id', ids)
      .update({
        scheduled_at: trx.raw(caseExpr, bindings),
        unscheduled: null,
        updated_at: db.fn.now()
      });
  }

  // Run remaining updates individually (status changes, unscheduled flags, etc.)
  for (var pi = 0; pi < otherUpdates.length; pi++) {
    await trx('tasks')
      .where({ id: otherUpdates[pi].id, user_id: userId })
      .update(otherUpdates[pi].dbUpdate);
  }

  console.log('[SCHED] runScheduleAndPersist: updated ' + updated + ', cleared ' + cleared + ' for user ' + userId);

  // 10. Cache the placement result so GET /placements doesn't re-run the scheduler
  var placementCache = { dayPlacements: {}, unplaced: [], score: result.score, warnings: result.warnings || [], generatedAt: new Date().toISOString(), timezone: TIMEZONE };
  Object.keys(result.dayPlacements).forEach(function(dk) {
    placementCache.dayPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      var entry = { taskId: p.task ? p.task.id : null, start: p.start, dur: p.dur };
      // Convert local start to UTC ISO for timezone-independent display
      var timeStr = formatMinutesToTime(p.start);
      var utcDate = localToUtc(dk, timeStr, TIMEZONE);
      if (utcDate) entry.scheduledAtUtc = utcDate.toISOString();
      if (p.locked) entry.locked = true;
      if (p.marker) entry.marker = true;
      if (p._whenRelaxed) entry.whenRelaxed = true;
      if (p.splitPart) { entry.splitPart = p.splitPart; entry.splitTotal = p.splitTotal; }
      if (p.travelBefore) entry.travelBefore = p.travelBefore;
      if (p.travelAfter) entry.travelAfter = p.travelAfter;
      if (p._moveReason) entry.moveReason = p._moveReason;
      if (p._conflict) entry.conflict = true;
      if (p._placementReason) entry.placementReason = p._placementReason;
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
  cache.invalidateTasks(userId).catch(function(err) { console.error("[silent-catch]", err.message); });

  // Add scheduledAtUtc to placements for timezone-independent frontend display
  var outPlacements = {};
  Object.keys(result.dayPlacements).forEach(function(dk) {
    outPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      var hh3 = Math.floor(p.start / 60);
      var mm3 = p.start % 60;
      var ampm3 = hh3 >= 12 ? 'PM' : 'AM';
      var dh3 = hh3 > 12 ? hh3 - 12 : (hh3 === 0 ? 12 : hh3);
      var ts3 = dh3 + ':' + (mm3 < 10 ? '0' : '') + mm3 + ' ' + ampm3;
      var utc3 = localToUtc(dk, ts3, TIMEZONE);
      if (utc3) p.scheduledAtUtc = utc3.toISOString();
      return p;
    });
  });

  // Synthesize placements for finished tasks so they appear on the calendar
  // when the "all" filter is active (scheduler only places active tasks).
  var placedIds = {};
  Object.keys(outPlacements).forEach(function(dk) {
    outPlacements[dk].forEach(function(p) {
      if (p.task) placedIds[p.task.id] = true;
    });
  });
  allTasks.forEach(function(t) {
    if (placedIds[t.id]) return;
    if (t.generated || t.taskType === 'recurring_template') return;
    var st = statuses[t.id] || '';
    if (st !== 'done' && st !== 'cancel' && st !== 'skip') return;
    if (!t.date || t.date === 'TBD') return;
    var startMin = t.time ? parseTimeToMinutes(t.time) : null;
    if (startMin == null) return;
    var dur = t.dur || 30;
    var entry = { task: t, start: startMin, dur: dur };
    var utcDate = localToUtc(t.date, t.time, TIMEZONE);
    if (utcDate) entry.scheduledAtUtc = utcDate.toISOString();
    if (!outPlacements[t.date]) outPlacements[t.date] = [];
    outPlacements[t.date].push(entry);
  });

  // Compute changeset: which task IDs were added, removed, or moved
  var deadSet = {};
  (deadIds || []).forEach(function(id) { deadSet[id] = true; });
  var bornSet = {};
  expanded.forEach(function(t) { bornSet[t.id] = true; });

  // Removed: deleted but not regenerated with same ID
  var removed = (deadIds || []).filter(function(id) { return !bornSet[id]; });
  // Added: born but didn't exist before
  var added = expanded.filter(function(t) { return !deadSet[t.id]; }).map(function(t) { return t.id; });
  // Changed: tasks whose date/time was moved by the scheduler
  var changed = updatedTasks.map(function(t) { return t.id; });

  // Affected dates: all dates that had tasks added, removed, or moved
  var affectedDates = {};
  updatedTasks.forEach(function(t) {
    if (t.from) affectedDates[t.from] = true;
    if (t.to) affectedDates[t.to] = true;
  });
  Object.keys(outPlacements).forEach(function(dk) { affectedDates[dk] = true; });

  return {
    updated: updated, cleared: cleared, tasks: updatedTasks, score: result.score,
    dayPlacements: outPlacements,
    unplaced: result.unplaced.filter(function(t) { return !t.generated; }),
    warnings: result.warnings || [],
    changeset: {
      added: added,
      changed: changed,
      removed: removed,
      affectedDates: Object.keys(affectedDates)
    }
  };

  }); // end transaction
  } catch (err) {
    if ((err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') && retries < MAX_RETRIES) {
      console.log('[SCHED] ' + err.code + ' detected, retry ' + (retries + 1) + '/' + MAX_RETRIES);
      await new Promise(function(r) { setTimeout(r, 500 * (retries + 1)); });
      return runScheduleAndPersist(userId, retries + 1, options);
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
async function getSchedulePlacements(userId, options) {
  var TIMEZONE = (options && options.timezone) || DEFAULT_TIMEZONE;
  var timeInfo = getNowInTimezone(TIMEZONE);

  // Fast path: check cache freshness with minimal DB queries BEFORE loading all tasks
  var cacheRow = await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
  var cache = null;
  if (cacheRow) {
    try {
      cache = typeof cacheRow.config_value === 'string' ? (function() { try { return JSON.parse(cacheRow.config_value); } catch(e) { return cacheRow.config_value; } })() : cacheRow.config_value;
    } catch (e) { cache = null; }
  }

  // Quick staleness check — only needs cache metadata + one lightweight query
  var cacheUsable = false;
  if (cache && cache.generatedAt && cache.timezone === TIMEZONE) {
    var genTime = new Date(cache.generatedAt);
    var ageMs = Date.now() - genTime.getTime();
    var genParts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, month: 'numeric', day: 'numeric' }).formatToParts(genTime);
    var genVals = {}; genParts.forEach(function(p) { genVals[p.type] = p.value; });
    var genDateKey = genVals.month + '/' + genVals.day;
    if (genDateKey === timeInfo.todayKey && ageMs <= 30 * 60 * 1000) {
      // Check if tasks were modified since cache
      var maxRow = await db('tasks').where('user_id', userId).max('updated_at as max_updated').first();
      if (!maxRow || !maxRow.max_updated || new Date(maxRow.max_updated) <= genTime) {
        cacheUsable = true;
      }
    }
  }

  // Fast return: if cache is fresh, hydrate and return without loading all tasks
  if (cacheUsable && cache.dayPlacements) {
    console.log('[SCHED] placements: returning fresh cache (age=' + Math.round((Date.now() - new Date(cache.generatedAt).getTime()) / 1000) + 's)');
    return {
      dayPlacements: cache.dayPlacements,
      unplaced: cache.unplaced || [],
      score: cache.score || {},
      warnings: cache.warnings || [],
      hasPastTasks: false // conservative — full check requires loading all tasks
    };
  }

  // Slow path: cache stale — load everything and potentially re-run scheduler
  var taskRows = await db('tasks').where('user_id', userId).select();
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });

  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });

  // Expand recurring so generated instances can be hydrated from cache
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + 56);
  var expanded = expandRecurring(allTasks, today, expandEnd, { statuses: statuses });
  if (expanded.length > 0) {
    allTasks = allTasks.concat(expanded);
    expanded.forEach(function(t) { statuses[t.id] = ''; });
  }

  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Check for past tasks (same logic regardless of cache)
  var hasPastTasks = false;
  var todayDate = parseDate(timeInfo.todayKey);
  if (todayDate) {
    for (var ti = 0; ti < allTasks.length; ti++) {
      var t = allTasks[ti];
      if (t.generated) continue;
      if (t.taskType === 'recurring_template') continue;
      var tSt = statuses[t.id] || '';
      if (tSt === 'done' || tSt === 'cancel' || tSt === 'skip' || tSt === 'pause' || tSt === 'disabled') continue;
      if (!t.date || t.date === 'TBD') continue;
      var tDate = parseDate(t.date);
      if (tDate && tDate < todayDate) { hasPastTasks = true; break; }
    }
  }

  // Cache was already checked in fast path above — if we reached here, it's stale.
  // But we still need to decide whether to re-run the scheduler or hydrate from stale cache.
  var cacheStale = true; // we know it's stale (fast path would have returned if fresh)
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
        return st !== 'done' && st !== 'cancel' && st !== 'skip' && st !== 'disabled';
      });
      if (activeTodayTasks.length > 0) {
        console.log('[SCHED] cache stale: no placements for today but ' + activeTodayTasks.length + ' active tasks exist');
        cacheStale = true;
      }
    }
  }

  if (cacheStale && cache) {
    // Try to acquire the canonical per-user sync lock. If we get it, run
    // the scheduler to refresh the cache. If another run holds the lock
    // (queue worker, REST /schedule/run, or MCP run_schedule), wait briefly
    // and re-read the cache that run produced. Previously this path used a
    // separate Redis-based lock (acquireSchedulerLock/releaseSchedulerLock),
    // which did not interlock with the table-based sync_locks used by the
    // other paths — two scheduler runs could race and deadlock on row
    // inserts. Unifying on withLock closes that hole.
    var freshResult = null;
    try {
      freshResult = await syncLock.withLock(userId, function() {
        console.log('[SCHED] cache stale (age=' + Math.round((Date.now() - new Date(cache.generatedAt).getTime()) / 60000) + 'm), re-running scheduler under sync lock');
        return runScheduleAndPersist(userId, undefined, { timezone: TIMEZONE });
      });
    } catch (err) {
      console.error('[SCHED] stale re-run failed, using cached:', err.message);
      // Fall through to cached hydration
    }
    if (freshResult) {
      return {
        dayPlacements: freshResult.dayPlacements,
        unplaced: freshResult.unplaced,
        score: freshResult.score,
        warnings: freshResult.warnings || [],
        hasPastTasks: hasPastTasks
      };
    }
    // Lock was held by another run (freshResult === null). Wait briefly
    // and re-read the cache that run produced, then fall through to
    // cached hydration below.
    if (freshResult === null) {
      console.log('[SCHED] cache stale but scheduler already running, waiting...');
      await new Promise(function(r) { setTimeout(r, 2000); });
      var freshCacheRow = await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
      if (freshCacheRow) {
        try {
          cache = typeof freshCacheRow.config_value === 'string' ? JSON.parse(freshCacheRow.config_value) : freshCacheRow.config_value;
        } catch (e) { /* fall through */ }
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
        var hydrated = { task: task, start: p.start, dur: p.dur };
        if (p.scheduledAtUtc) hydrated.scheduledAtUtc = p.scheduledAtUtc;
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

    // Synthesize placements for finished tasks (done/cancel/skip) using their
    // scheduled_at-derived date/time. The scheduler never places these, so without
    // this they'd appear unscheduled when the "all" filter is active.
    allTasks.forEach(function(t) {
      if (cachedIds[t.id]) return;
      if (t.generated || t.taskType === 'recurring_template') return;
      var st = statuses[t.id] || '';
      if (st !== 'done' && st !== 'cancel' && st !== 'skip') return;
      if (!t.date || t.date === 'TBD') return;
      var startMin = t.time ? parseTimeToMinutes(t.time) : null;
      if (startMin == null) return;
      var dur = t.dur || 30;
      var entry = { task: t, start: startMin, dur: dur };
      // Add scheduledAtUtc for timezone-safe frontend hydration
      var utcDate = localToUtc(t.date, t.time, TIMEZONE);
      if (utcDate) entry.scheduledAtUtc = utcDate.toISOString();
      if (!dayPlacements[t.date]) dayPlacements[t.date] = [];
      dayPlacements[t.date].push(entry);
      cachedIds[t.id] = true;
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
      if (t.taskType === 'recurring_template') return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'pause' || st === 'disabled') return;
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
      if (!t.date || t.date === 'TBD') return;
      var td = parseDate(t.date);
      if (!td) return;
      var isPast = td < todayDate;
      // Past recurringTasks missed their day — not schedulable
      if (t.recurring && isPast) return;
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
  cfg.timezone = TIMEZONE;
  var result = unifiedSchedule(allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg);

  // Save cache
  var newCache = { dayPlacements: {}, unplaced: [], score: result.score, warnings: result.warnings || [], generatedAt: new Date().toISOString(), timezone: TIMEZONE };
  Object.keys(result.dayPlacements).forEach(function(dk) {
    newCache.dayPlacements[dk] = result.dayPlacements[dk].map(function(p) {
      var entry = { taskId: p.task ? p.task.id : null, start: p.start, dur: p.dur };
      var hh2 = Math.floor(p.start / 60);
      var mm2 = p.start % 60;
      var ampm2 = hh2 >= 12 ? 'PM' : 'AM';
      var dh2 = hh2 > 12 ? hh2 - 12 : (hh2 === 0 ? 12 : hh2);
      var timeStr2 = dh2 + ':' + (mm2 < 10 ? '0' : '') + mm2 + ' ' + ampm2;
      var utcDate2 = localToUtc(dk, timeStr2, TIMEZONE);
      if (utcDate2) entry.scheduledAtUtc = utcDate2.toISOString();
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

  // Add scheduledAtUtc to placements for timezone-independent frontend display
  var outPlacements2 = {};
  Object.keys(result.dayPlacements).forEach(function(dk) {
    outPlacements2[dk] = result.dayPlacements[dk].map(function(p) {
      var hh4 = Math.floor(p.start / 60);
      var mm4 = p.start % 60;
      var ampm4 = hh4 >= 12 ? 'PM' : 'AM';
      var dh4 = hh4 > 12 ? hh4 - 12 : (hh4 === 0 ? 12 : hh4);
      var ts4 = dh4 + ':' + (mm4 < 10 ? '0' : '') + mm4 + ' ' + ampm4;
      var utc4 = localToUtc(dk, ts4, TIMEZONE);
      if (utc4) p.scheduledAtUtc = utc4.toISOString();
      return p;
    });
  });

  return {
    dayPlacements: outPlacements2,
    unplaced: result.unplaced.filter(function(t) { return !t.generated; }),
    score: result.score,
    warnings: result.warnings || [],
    hasPastTasks: hasPastTasks
  };
}

module.exports = { runScheduleAndPersist, getSchedulePlacements };
