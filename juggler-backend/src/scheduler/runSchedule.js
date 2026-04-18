/**
 * runSchedule.js — Load data, run scheduler, persist date moves
 *
 * The DB stores scheduled_at (UTC DATETIME) as the single source of truth.
 * The scheduler works with in-memory task objects that have local date/time/day
 * properties, derived from scheduled_at via rowToTask().
 */

var db = require('../db');
var tasksWrite = require('../lib/tasks-write');
var { computeChunks } = require('../lib/reconcile-splits');
var unifiedSchedule = require('./unifiedSchedule');
var constants = require('./constants');
var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DEFAULT_TOOL_MATRIX = constants.DEFAULT_TOOL_MATRIX;
var DAY_NAMES = constants.DAY_NAMES;
var SCHEDULER_VERSION = constants.SCHEDULER_VERSION;
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

  // 1. Load schedulable tasks + templates (skip terminal-status rows at DB level).
  //    This avoids loading the entire history (done/skip/cancel) into memory.
  //    A separate lightweight query fetches just (source_id, date) for dedup.
  var taskRows = await trx('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        .orWhere('task_type', 'recurring_template');
    })
    .select();
  // Dedup data for expandRecurring: which (source_id, date) combos already exist
  // in terminal-status rows? Lightweight query — only two columns, no join needed.
  var terminalDedupRows = await trx('task_instances').where('user_id', userId)
    .whereNotNull('master_id')
    .whereIn('status', ['done', 'skip', 'cancel'])
    .select('master_id as source_id', 'date');
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
  // Inject terminal dedup data as synthetic entries so expandRecurring skips those dates
  terminalDedupRows.forEach(function(r) {
    if (r.source_id && r.date) {
      allTasks.push({ id: '_dedup_' + r.source_id + '_' + r.date, sourceId: r.source_id, date: r.date, taskType: 'recurring_instance', text: '', status: 'done' });
    }
  });

  // 2a. Normalize empty `when` to all five standard day windows. Users treat
  // no-when-set as "place whenever," not "skip scheduling" — the placement
  // phase requires a non-empty when-tag to match against day windows.
  var ALL_WINDOWS = 'morning,lunch,afternoon,evening,night';
  allTasks.forEach(function(t) {
    if (t.when == null || t.when === '') t.when = ALL_WINDOWS;
  });

  // 2b. Derive per-chunk placement brackets for recurring instances.
  // Use the task's date field (or _candidateDate from expandRecurring) to
  // determine the occurrence date. Master.recur's type drives the flex window:
  //   daily    → 0 days  (strict same-day)
  //   weekly   → 6 days  (Mon→Sun anchor)
  //   monthly  → 27 days (~end of month)
  //   every_N  → N-1 days
  // start_after = occurrence date; due = start_after + flex.
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_instance' || !t.sourceId) return;
    var master = srcMap[t.sourceId];
    if (!master) return;
    // Determine occurrence date from the task's date field or _candidateDate.
    // Legacy IDs encode the date as YYYYMMDD suffix; new ordinal IDs don't.
    var occDate = t._candidateDate || t.date;
    if (!occDate) {
      // Fallback: try parsing date from legacy ID format
      var m = String(t.id).match(/-(\d{8})(?:-\d+)?$/);
      if (m) {
        var y = parseInt(m[1].slice(0, 4), 10);
        var mo = parseInt(m[1].slice(4, 6), 10);
        var dd = parseInt(m[1].slice(6, 8), 10);
        occDate = formatDateKey(new Date(y, mo - 1, dd));
      }
    }
    if (!occDate) return;
    var occ = parseDate(occDate);
    if (!occ) return;
    var recur = master.recur || {};
    var type = (recur.type || '').toLowerCase();
    var flex = 0;
    if (type === 'weekly') flex = 6;
    else if (type === 'monthly') flex = 27;
    else if (type === 'every' || type === 'every_n') {
      var every = Number(recur.every) || 1;
      flex = Math.max(0, every - 1);
    }
    var dueDate = new Date(occ); dueDate.setDate(dueDate.getDate() + flex);
    t.startAfter = formatDateKey(occ);
    t.deadline = formatDateKey(dueDate);
    if (!t.date) {
      t.date = t.startAfter;
      t.day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][occ.getDay()];
    }
  });

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

  // 5b. Unified reconcile — recurring-instance expansion PLUS split chunks
  // in one pass. Each master with split=1 produces K chunks per occurrence
  // (computeChunks derives {split_ordinal, dur}). Chunk IDs are deterministic:
  //   split_ordinal=1 → "<masterId>-YYYYMMDD" (from expandRecurring)
  //   split_ordinal=N>=2 → "<masterId>-YYYYMMDD-N"
  // All chunks of one occurrence share the same occurrence_ordinal.
  //
  // This replaces the prior two-pass design (expand-then-split-reconcile) that
  // thrashed because the expand pass deleted chunk rows it didn't recognize.
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + 56);

  // Index existing recurring_instance rows. Track pending (placeable) and the
  // full set (any status) for ordinal preservation + existence lookup.
  var existingPendingIds = {};
  var existingById = {}; // id -> { occ, status, master_id }
  var rowsByIdForReconcile = {}; // id -> full raw row (for dur/merge-survivor checks)
  var maxOrdByMaster = {};
  taskRows.forEach(function(r) {
    if (r.task_type !== 'recurring_instance') return;
    rowsByIdForReconcile[r.id] = r;
    existingById[r.id] = {
      occ: Number(r.occurrence_ordinal) || 0,
      status: r.status,
      master_id: r.master_id || r.source_id
    };
    if (!r.status || r.status === '') existingPendingIds[r.id] = true;
    var mid = r.master_id || r.source_id;
    if (mid) {
      var o = Number(r.occurrence_ordinal) || 0;
      if (o > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = o;
    }
  });

  // expandRecurring skips generating an instance whose (sourceId, date) already
  // appears in allTasks. Hide pending chunks from that input so the expansion
  // is authoritative (we rebuild the full desired set below).
  var allTasksForExpand = allTasks.filter(function(t) {
    if (t.taskType !== 'recurring_instance') return true;
    return !existingPendingIds[t.id];
  });
  var desiredOccurrences = expandRecurring(allTasksForExpand, today, expandEnd, { statuses: statuses, maxOrdBySource: maxOrdByMaster });
  var MAX_EXPANDED = 500;
  if (desiredOccurrences.length > MAX_EXPANDED) {
    console.warn('[SCHED] expansion capped: ' + desiredOccurrences.length + ' → ' + MAX_EXPANDED);
    desiredOccurrences = desiredOccurrences.slice(0, MAX_EXPANDED);
  }

  // Fan out each occurrence into K chunks based on master.split / splitMin.
  var nextOrdByMaster = Object.assign({}, maxOrdByMaster);
  var desiredRows = [];
  desiredOccurrences.forEach(function(occ) {
    var masterId = occ.sourceId;
    var primaryId = occ.id; // <masterId>-<ordinal> (date-agnostic)

    // Determine chunk plan. occ inherits master.split / master.splitMin via
    // expandRecurring's newTasks copy.
    var chunks;
    if (occ.split && occ.dur) {
      chunks = computeChunks(occ.dur, occ.splitMin);
      if (chunks.length === 0) chunks = [{ splitOrdinal: 1, splitTotal: 1, dur: occ.dur || 30 }];
    } else {
      chunks = [{ splitOrdinal: 1, splitTotal: 1, dur: occ.dur || 30 }];
    }

    // Always produce the correct chunk plan — even if a prior run merged
    // chunks into one row. The scheduler places each chunk independently;
    // the post-placement merge step (Phase 5a) recombines contiguous chunks.
    // If the primary row carries the full master dur from a prior merge,
    // the drift-fix below will correct it back to chunk 1's dur.

    // One occurrence ordinal shared by all chunks of this day.
    var occOrd;
    if (existingById[primaryId]) {
      occOrd = existingById[primaryId].occ;
    } else {
      nextOrdByMaster[masterId] = (nextOrdByMaster[masterId] || 0) + 1;
      occOrd = nextOrdByMaster[masterId];
    }

    chunks.forEach(function(c) {
      var chunkId = c.splitOrdinal === 1 ? primaryId : primaryId + '-' + c.splitOrdinal;
      desiredRows.push({
        id: chunkId,
        sourceId: masterId,
        date: occ.date,
        time: occ.time,
        occurrence_ordinal: occOrd,
        split_ordinal: c.splitOrdinal,
        split_total: chunks.length,
        split_group: chunks.length > 1 ? primaryId : null,
        dur: c.dur,
        _candidateDate: occ._candidateDate || occ.date
      });
    });
  });

  // Diff desired vs existing pending.
  var desiredIds = {};
  var desiredById = {};
  desiredRows.forEach(function(r) { desiredIds[r.id] = true; desiredById[r.id] = r; });
  var toInsert = desiredRows.filter(function(r) { return !existingPendingIds[r.id]; });
  var toDeleteIds = Object.keys(existingPendingIds).filter(function(id) { return !desiredIds[id]; });

  // Drift fix: existing pending rows whose (split_ordinal, split_total, dur)
  // don't match the current chunk plan get UPDATEd in place. Covers the case
  // where master.dur or master.split_min changed, or where a prior bug wrote
  // the wrong chunk dur.
  var toUpdate = [];
  taskRows.forEach(function(r) {
    if (r.task_type !== 'recurring_instance') return;
    if (r.status && r.status !== '') return;
    var want = desiredById[r.id];
    if (!want) return;
    var curSo = Number(r.split_ordinal) || 1;
    var curSt = Number(r.split_total) || 1;
    var curDur = Number(r.dur);
    if (curSo !== want.split_ordinal || curSt !== want.split_total || curDur !== want.dur) {
      toUpdate.push({
        id: r.id,
        changes: { split_ordinal: want.split_ordinal, split_total: want.split_total, dur: want.dur }
      });
    }
  });

  // Preserve the variable names the downstream changeset computation uses.
  var deadIds = toDeleteIds;
  var expanded = toInsert;

  // ── DB reconcile: deletions and drift-fixes only ──
  // Inserts are deferred — chunks are built in memory for the scheduler.
  // Only delete stale rows and fix drifted rows in the DB.
  var reconcileChanged = false;
  if (toDeleteIds.length > 0) {
    await tasksWrite.deleteTasksWhere(trx, userId, function(q) { return q.whereIn('id', toDeleteIds); });
    console.log('[SCHED] reconcile: deleted ' + toDeleteIds.length + ' stale recurring instances');
    reconcileChanged = true;
  }
  if (toUpdate.length > 0) {
    for (var ui = 0; ui < toUpdate.length; ui++) {
      await trx('task_instances')
        .where('id', toUpdate[ui].id)
        .update(Object.assign({}, toUpdate[ui].changes, { updated_at: db.fn.now() }));
    }
    var updateById = {};
    toUpdate.forEach(function(u) { updateById[u.id] = u.changes; });
    allTasks.forEach(function(t) {
      var ch = updateById[t.id];
      if (!ch) return;
      if (ch.dur != null) t.dur = ch.dur;
      if (ch.split_ordinal != null) t.splitOrdinal = ch.split_ordinal;
      if (ch.split_total != null) t.splitTotal = ch.split_total;
    });
    console.log('[SCHED] reconcile: updated ' + toUpdate.length + ' instance rows to match chunk plan');
    reconcileChanged = true;
  }
  if (reconcileChanged) {
    var deletedIds = new Set(toDeleteIds);
    if (deletedIds.size > 0) {
      taskRows = taskRows.filter(function(r) { return !deletedIds.has(r.id); });
    }
    srcMap = buildSourceMap(taskRows);
    allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
    statuses = {};
    allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  }

  // ── In-memory chunk expansion ──
  // Build task objects for new/missing chunks directly from master fields.
  // No DB insert — the scheduler works on these in memory. Persist step
  // will INSERT placed chunks after scheduling completes.
  var masterById = {};
  allTasks.forEach(function(t) {
    if (t.taskType === 'recurring_template') masterById[t.id] = t;
  });
  var existingTaskIds = {};
  allTasks.forEach(function(t) { existingTaskIds[t.id] = true; });

  var inMemoryChunks = [];
  toInsert.forEach(function(row) {
    if (existingTaskIds[row.id]) return; // already in allTasks
    var master = masterById[row.sourceId];
    if (!master) return;

    // Build a task object inheriting master fields
    var chunk = {
      id: row.id,
      taskType: 'recurring_instance',
      text: master.text,
      dur: row.dur,
      pri: master.pri,
      project: master.project,
      section: master.section,
      notes: master.notes,
      location: master.location,
      tools: master.tools,
      when: master.when || ALL_WINDOWS,
      dayReq: master.dayReq,
      recurring: true,
      rigid: master.rigid,
      timeFlex: master.timeFlex,
      split: master.split,
      splitMin: master.splitMin,
      travelBefore: master.travelBefore,
      travelAfter: master.travelAfter,
      dependsOn: master.dependsOn || [],
      marker: master.marker,
      flexWhen: master.flexWhen,
      recur: master.recur,
      recurStart: master.recurStart,
      recurEnd: master.recurEnd,
      preferredTimeMins: row.split_ordinal === 1 ? master.preferredTimeMins : null,
      sourceId: row.sourceId,
      generated: true,
      date: row.date,
      day: row.date ? DAY_NAMES[parseDate(row.date).getDay()] : null,
      time: row.split_ordinal === 1 ? row.time : null,
      status: '',
      datePinned: false,
      splitOrdinal: row.split_ordinal,
      splitTotal: row.split_total,
      splitGroup: row.split_group || null,
      occurrenceOrdinal: row.occurrence_ordinal,
      startAfter: null,
      deadline: null,
      scheduledAt: null,
      unscheduled: false,
      _candidateDate: row._candidateDate || row.date,
      _inMemoryChunk: true // flag for persist step
    };
    inMemoryChunks.push(chunk);
  });

  if (inMemoryChunks.length > 0) {
    allTasks = allTasks.concat(inMemoryChunks);
    inMemoryChunks.forEach(function(t) { statuses[t.id] = ''; });
    console.log('[SCHED] in-memory: added ' + inMemoryChunks.length + ' chunk tasks for scheduling');
  }

  // Re-apply placement brackets (startAfter/deadline) for all recurring instances
  // including in-memory chunks. This was done in step 2b but only for tasks that
  // existed at that point — in-memory chunks need it too.
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_instance' || !t.sourceId) return;
    if (t.startAfter && t.deadline) return; // already set from step 2b
    var master = masterById[t.sourceId];
    if (!master) { master = srcMap[t.sourceId]; }
    if (!master) return;
    // Use _candidateDate or date field; fallback to legacy ID parsing
    var occDate = t._candidateDate || t.date;
    if (!occDate) {
      var m = String(t.id).match(/-(\d{8})(?:-\d+)?$/);
      if (m) {
        occDate = formatDateKey(new Date(parseInt(m[1].slice(0,4),10), parseInt(m[1].slice(4,6),10)-1, parseInt(m[1].slice(6,8),10)));
      }
    }
    if (!occDate) return;
    var occ = parseDate(occDate);
    if (!occ) return;
    var recur = (master.recur || master.recur_json) || {};
    if (typeof recur === 'string') { try { recur = JSON.parse(recur); } catch(e) { recur = {}; } }
    var type = (recur.type || '').toLowerCase();
    var flex = 0;
    if (type === 'weekly') flex = 6;
    else if (type === 'monthly') flex = 27;
    else if (type === 'every' || type === 'every_n') {
      var every = Number(recur.every) || 1;
      flex = Math.max(0, every - 1);
    }
    var dueDate = new Date(occ); dueDate.setDate(dueDate.getDate() + flex);
    t.startAfter = formatDateKey(occ);
    t.deadline = formatDateKey(dueDate);
    if (!t.date) {
      t.date = t.startAfter;
      t.day = DAY_NAMES[occ.getDay()];
    }
    if (t.when == null || t.when === '') t.when = ALL_WINDOWS;
  });

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
    if (original.datePinned) continue;
    // Date-pinned tasks are user-set — never override their date/time.
    // Exception: a datePinned flag without an actual date/scheduled_at is a
    // stale artifact (user cleared the date but pin survived). Treat as
    // unpinned — the scheduler is free to place.
    if (original.datePinned && (original.date || original.time)) continue;
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

    // NEW DESIGN: write scheduled_at and dur for EVERY placed task, every run.
    // This guarantees the DB matches what the scheduler decided. No minimal-diff
    // optimization — the batch CASE update handles 200 rows per query, so cost is
    // negligible, and it eliminates stale-DB states the sync used to compensate for.
    var newScheduledAt = localToUtc(newDate, newTime, TIMEZONE);
    if (!newScheduledAt) continue;

    // Derive day-of-week for the DB write
    var parsedNewDate = parseDate(newDate);
    var newDay = parsedNewDate ? DAY_NAMES[parsedNewDate.getDay()] : null;
    var dbUpdate = {
      scheduled_at: newScheduledAt,
      date: newDate || null,
      day: newDay,
      time: newTime || null,
      unscheduled: null,
      date_pinned: 0,
      updated_at: db.fn.now()
    };
    if (placement.dur) dbUpdate.dur = placement.dur;

    pendingUpdates.push({
      id: taskId,
      dbUpdate: dbUpdate
    });

    if (dateChanged || timeChanged) {
      // Derive day-of-week label for the patch so the frontend can render
      // without a lookup. parseDate handles both M/D and MM/DD.
      var parsedForDay = parseDate(newDate);
      var dayLabel = parsedForDay ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][parsedForDay.getDay()] : null;
      updatedTasks.push({
        id: taskId,
        text: original.text,
        from: original.date,
        to: newDate,
        fromTime: original.time,
        toTime: newTime,
        // Minimal patch for SSE — only the fields the scheduler actually mutated.
        // Frontend merges this in without a re-fetch.
        patch: {
          date: newDate || null,
          time: newTime || null,
          day: dayLabel,
          scheduledAt: newScheduledAt instanceof Date ? newScheduledAt.toISOString() : newScheduledAt,
          dur: placement.dur || original.dur || null,
          unscheduled: false
        }
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
    if (original.datePinned) return;
    if (original.datePinned) return;
    if (original.marker) return;
    // Future recurring instances: skip — they'll be placed when their day arrives.
    // Past/today recurring instances that couldn't place: fall through to unscheduled
    // marking so they show up in the issues tab instead of silently vanishing.
    if (original.taskType === 'recurring_instance') {
      var instDate = parseDate(original.date);
      if (instDate && instDate > today) return;
    }
    // Mark as unscheduled but PRESERVE scheduled_at — it stays as the
    // last-proposed time so the frontend can render the chunk in the
    // unscheduled lane with a sensible "was supposed to be at" timestamp,
    // and a future "mark done" click can infer a plausible done_at.
    // The unscheduled=1 boolean is the sole signal that it's not on the calendar.
    pendingUpdates.push({ id: t.id, dbUpdate: { unscheduled: 1, updated_at: db.fn.now() } });
    // Emit SSE change only on the transition from placed → unscheduled.
    var rawRow = rawRowById[t.id];
    var wasPlaced = !!(original.date || original.time || (rawRow && rawRow.scheduled_at));
    var wasAlreadyUnscheduled = !!(rawRow && rawRow.unscheduled);
    if (wasPlaced && !wasAlreadyUnscheduled) {
      updatedTasks.push({
        id: t.id,
        text: original.text,
        from: original.date,
        to: original.date, // proposed date stays
        fromTime: original.time,
        toTime: original.time,
        patch: { unscheduled: true } // scheduled_at/date/time/day unchanged
      });
    }
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
      if (t.datePinned) return;
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

  // Merge-back removed — adjacent split chunks stay as separate DB rows.
  // Visual collapsing is handled in the frontend (DailyView). Backend merge
  // was counterproductive: it folded 8x30m chunks into one 240m block,
  // defeating the purpose of splitting for flexible intra-day placement.

  // INSERT in-memory chunks that got placed (they don't exist in the DB yet).
  // Separate them from pendingUpdates since they need INSERT, not UPDATE.
  var inMemoryInserts = [];
  var inMemoryIds = {};
  inMemoryChunks.forEach(function(t) { inMemoryIds[t.id] = t; });
  pendingUpdates = pendingUpdates.filter(function(pu) {
    var chunk = inMemoryIds[pu.id];
    if (!chunk) return true; // not an in-memory chunk — keep in pendingUpdates
    // This is an in-memory chunk that got placed — collect for INSERT.
    // Derive local date from scheduled_at so the dedup query can match it.
    var chunkLocal = pu.dbUpdate.scheduled_at ? utcToLocal(
      pu.dbUpdate.scheduled_at instanceof Date ? pu.dbUpdate.scheduled_at : new Date(pu.dbUpdate.scheduled_at),
      TIMEZONE
    ) : null;
    inMemoryInserts.push({
      id: pu.id,
      user_id: userId,
      task_type: 'recurring_instance',
      source_id: chunk.sourceId,
      occurrence_ordinal: chunk.occurrenceOrdinal || 1,
      split_ordinal: chunk.splitOrdinal || 1,
      split_total: chunk.splitTotal || 1,
      split_group: chunk.splitGroup || null,
      dur: pu.dbUpdate.dur || chunk.dur,
      generated: 0,
      recurring: 1,
      scheduled_at: pu.dbUpdate.scheduled_at || null,
      date: chunkLocal ? chunkLocal.date : (chunk._candidateDate || chunk.date || null),
      day: chunkLocal ? chunkLocal.day : null,
      time: chunkLocal ? chunkLocal.time : null,
      unscheduled: pu.dbUpdate.unscheduled || null,
      status: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    return false; // remove from pendingUpdates
  });
  if (inMemoryInserts.length > 0) {
    var nullDateCount = inMemoryInserts.filter(function(r) { return !r.date; }).length;
    if (nullDateCount > 0) console.log('[SCHED] WARNING: ' + nullDateCount + ' of ' + inMemoryInserts.length + ' in-memory inserts have null date');
    if (inMemoryInserts.length > 0 && inMemoryInserts[0]) {
      console.log('[SCHED] sample insert: id=' + inMemoryInserts[0].id + ' sa=' + inMemoryInserts[0].scheduled_at + ' date=' + inMemoryInserts[0].date);
    }
    await tasksWrite.insertTasksBatch(trx, inMemoryInserts);
    console.log('[SCHED] persist: inserted ' + inMemoryInserts.length + ' newly-placed chunk rows');
  } else {
    console.log('[SCHED] persist: 0 in-memory inserts (chunks matched ' + Object.keys(inMemoryIds).length + ' inMemoryIds, pendingUpdates had ' + pendingUpdates.length + ' entries)');
  }

  // Execute updates in batches to avoid long-running single-row UPDATEs.
  // Group by identical dbUpdate shape, then batch with CASE expressions.
  console.log('[SCHED] executing ' + pendingUpdates.length + ' DB updates');
  pendingUpdates.sort(function(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });

  // Batch scheduled_at + dur updates (the most common case)
  var scheduledAtUpdates = [];
  var otherUpdates = [];
  pendingUpdates.forEach(function(pu) {
    if ((pu.dbUpdate.scheduled_at || pu.dbUpdate.dur) && !pu.dbUpdate.status) {
      scheduledAtUpdates.push(pu);
    } else {
      otherUpdates.push(pu);
    }
  });

  // Batch scheduled_at + dur updates in chunks of 200 using CASE expressions
  var CHUNK = 200;
  for (var ci = 0; ci < scheduledAtUpdates.length; ci += CHUNK) {
    var chunk = scheduledAtUpdates.slice(ci, ci + CHUNK);
    var ids = chunk.map(function(pu) { return pu.id; });

    var updateFields = { unscheduled: null, date_pinned: 0, updated_at: db.fn.now() };

    // Build CASE for scheduled_at (only include tasks that have a new scheduled_at)
    var saChunk = chunk.filter(function(pu) { return !!pu.dbUpdate.scheduled_at; });
    if (saChunk.length > 0) {
      var saCaseExpr = 'CASE id';
      var saBindings = [];
      saChunk.forEach(function(pu) {
        saCaseExpr += ' WHEN ? THEN ?';
        saBindings.push(pu.id, pu.dbUpdate.scheduled_at);
      });
      saCaseExpr += ' ELSE scheduled_at END';
      updateFields.scheduled_at = trx.raw(saCaseExpr, saBindings);
    }

    // Build CASE for dur (only include tasks that have a new dur)
    var durChunk = chunk.filter(function(pu) { return !!pu.dbUpdate.dur; });
    if (durChunk.length > 0) {
      var durCaseExpr = 'CASE id';
      var durBindings = [];
      durChunk.forEach(function(pu) {
        durCaseExpr += ' WHEN ? THEN ?';
        durBindings.push(pu.id, pu.dbUpdate.dur);
      });
      durCaseExpr += ' ELSE dur END';
      updateFields.dur = trx.raw(durCaseExpr, durBindings);
    }

    // Build CASE for date/day/time (keep DB in sync with scheduled_at)
    var dateChunk = chunk.filter(function(pu) { return pu.dbUpdate.date != null; });
    if (dateChunk.length > 0) {
      var dateCaseExpr = 'CASE id'; var dateBindings = [];
      var dayCaseExpr = 'CASE id'; var dayBindings = [];
      var timeCaseExpr = 'CASE id'; var timeBindings = [];
      dateChunk.forEach(function(pu) {
        dateCaseExpr += ' WHEN ? THEN ?'; dateBindings.push(pu.id, pu.dbUpdate.date);
        dayCaseExpr += ' WHEN ? THEN ?'; dayBindings.push(pu.id, pu.dbUpdate.day || null);
        timeCaseExpr += ' WHEN ? THEN ?'; timeBindings.push(pu.id, pu.dbUpdate.time || null);
      });
      dateCaseExpr += ' ELSE `date` END';
      dayCaseExpr += ' ELSE `day` END';
      timeCaseExpr += ' ELSE `time` END';
      updateFields.date = trx.raw(dateCaseExpr, dateBindings);
      updateFields.day = trx.raw(dayCaseExpr, dayBindings);
      updateFields.time = trx.raw(timeCaseExpr, timeBindings);
    }

    // Route `updateFields` across master/instance via helper.
    await tasksWrite.updateTasksWhere(trx, userId, function(q) {
      return q.whereIn('id', ids);
    }, updateFields);
  }

  // Run remaining updates individually (status changes, unscheduled flags, etc.)
  for (var pi = 0; pi < otherUpdates.length; pi++) {
    await tasksWrite.updateTaskById(trx, otherUpdates[pi].id, otherUpdates[pi].dbUpdate, userId);
  }

  console.log('[SCHED] runScheduleAndPersist: updated ' + updated + ', cleared ' + cleared + ' for user ' + userId);

  // 10. Cache the placement result so GET /placements doesn't re-run the scheduler
  var placementCache = { dayPlacements: {}, unplaced: [], score: result.score, warnings: result.warnings || [], generatedAt: new Date().toISOString(), timezone: TIMEZONE, schedulerVersion: SCHEDULER_VERSION };
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
  // Added: born but didn't exist before. Carry the full row so the frontend
  // doesn't have to fetch — it has nothing to merge into and would otherwise
  // do an N+1 GET per added row (catastrophic when reconcile inserts ~500).
  var addedIdSet = {};
  expanded.forEach(function(t) { if (!deadSet[t.id]) addedIdSet[t.id] = true; });
  var rowsById = {};
  taskRows.forEach(function(r) { rowsById[r.id] = r; });
  var added = Object.keys(addedIdSet).map(function(id) {
    var r = rowsById[id];
    if (!r) return { id: id }; // fallback: id-only (frontend will fetch as before)
    // Project a full task shape via rowToTask so the frontend gets exactly the
    // same fields it would have received from GET /api/tasks/:id.
    return rowToTask(r, null, srcMap);
  });
  // Changed: tasks whose date/time was moved (or cleared) by the scheduler.
  // Send {id, patch} so the frontend can merge without re-fetching.
  var changed = updatedTasks.map(function(t) { return { id: t.id, patch: t.patch || {} }; });

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
    unplaced: result.unplaced.filter(function(t) {
      // Keep missed recurring instances (they have _unplacedReason) even if generated
      if (t.generated && !t._unplacedReason) return false;
      return true;
    }),
    warnings: result.warnings || [],
    changeset: {
      added: added,
      changed: changed,
      removed: removed,
      affectedDates: Object.keys(affectedDates)
    },
    _debug: { inMemoryChunks: inMemoryChunks.length, expandedOccurrences: desiredOccurrences.length }
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
  if (cache && cache.generatedAt && cache.timezone === TIMEZONE && cache.schedulerVersion === SCHEDULER_VERSION) {
    var genTime = new Date(cache.generatedAt);
    var ageMs = Date.now() - genTime.getTime();
    var genParts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, month: 'numeric', day: 'numeric' }).formatToParts(genTime);
    var genVals = {}; genParts.forEach(function(p) { genVals[p.type] = p.value; });
    var genDateKey = genVals.month + '/' + genVals.day;
    if (genDateKey === timeInfo.todayKey && ageMs <= 30 * 60 * 1000) {
      // Check if tasks were modified since cache
      var maxRow = await db('tasks_v').where('user_id', userId).max('updated_at as max_updated').first();
      if (!maxRow || !maxRow.max_updated || new Date(maxRow.max_updated) <= genTime) {
        cacheUsable = true;
      }
    }
  }

  // Fast return: if cache is fresh, hydrate task objects and return
  if (cacheUsable && cache.dayPlacements) {
    console.log('[SCHED] placements: returning fresh cache (age=' + Math.round((Date.now() - new Date(cache.generatedAt).getTime()) / 1000) + 's)');
    // Load tasks to hydrate placements — cache stores taskId only
    var fastRows = await db('tasks_v').where('user_id', userId).select();
    var fastSrcMap = buildSourceMap(fastRows);
    var fastTaskById = {};
    fastRows.forEach(function(r) {
      var t = rowToTask(r, TIMEZONE, fastSrcMap);
      fastTaskById[t.id] = t;
    });
    var hydratedPlacements = {};
    Object.keys(cache.dayPlacements).forEach(function(dk) {
      hydratedPlacements[dk] = [];
      (cache.dayPlacements[dk] || []).forEach(function(p) {
        var task = fastTaskById[p.taskId];
        if (!task) return;
        var h = { task: task, start: p.start, dur: p.dur };
        if (p.scheduledAtUtc) h.scheduledAtUtc = p.scheduledAtUtc;
        if (p.locked) h.locked = true;
        if (p.marker) h.marker = true;
        if (p.travelBefore) h.travelBefore = p.travelBefore;
        if (p.travelAfter) h.travelAfter = p.travelAfter;
        if (p.placementReason) h.placementReason = p.placementReason;
        hydratedPlacements[dk].push(h);
      });
      if (hydratedPlacements[dk].length === 0) delete hydratedPlacements[dk];
    });
    return {
      dayPlacements: hydratedPlacements,
      unplaced: cache.unplaced || [],
      score: cache.score || {},
      warnings: cache.warnings || [],
      hasPastTasks: false
    };
  }

  // Slow path: cache stale — load schedulable rows and re-run scheduler
  var taskRows = await db('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        .orWhere('task_type', 'recurring_template');
    })
    .select();
  var terminalDedupRows2 = await db('task_instances').where('user_id', userId)
    .whereNotNull('master_id')
    .whereIn('status', ['done', 'skip', 'cancel'])
    .select('master_id as source_id', 'date');
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
  terminalDedupRows2.forEach(function(r) {
    if (r.source_id && r.date) {
      allTasks.push({ id: '_dedup_' + r.source_id + '_' + r.date, sourceId: r.source_id, date: r.date, taskType: 'recurring_instance', text: '', status: 'done' });
    }
  });

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
      var maxRow = await db('tasks_v').where('user_id', userId)
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
      if (isPast && t.datePinned) return;
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
  var newCache = { dayPlacements: {}, unplaced: [], score: result.score, warnings: result.warnings || [], generatedAt: new Date().toISOString(), timezone: TIMEZONE, schedulerVersion: SCHEDULER_VERSION };
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
    unplaced: result.unplaced.filter(function(t) {
      if (t.generated && !t._unplacedReason) return false;
      return true;
    }),
    score: result.score,
    warnings: result.warnings || [],
    hasPastTasks: hasPastTasks
  };
}

module.exports = { runScheduleAndPersist, getSchedulePlacements };
