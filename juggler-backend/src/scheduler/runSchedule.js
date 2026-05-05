/**
 * runSchedule.js — Load data, run scheduler, persist date moves
 *
 * The DB stores scheduled_at (UTC DATETIME) as the single source of truth.
 * The scheduler works with in-memory task objects that have local date/time/day
 * properties, derived from scheduled_at via rowToTask().
 */

var db = require('../db');
var tasksWrite = require('../lib/tasks-write');
var { computeChunks, reconcileSplitsForUser } = require('../lib/reconcile-splits');
var unifiedScheduleV2 = require('./unifiedScheduleV2');
var constants = require('./constants');

// v2 is the only scheduler. Kept as a thin wrapper so call sites don't have
// to care about whether a shadow / diff layer exists (makes re-adding one
// later for another migration trivial). The `userId` / `context` args are
// accepted for signature compatibility with the historical shadow wrapper;
// they're unused here.
function runSchedulerWithShadow(allTasks, statuses, todayKey, nowMins, cfg /*, userId, context */) {
  return unifiedScheduleV2(allTasks, statuses, todayKey, nowMins, cfg);
}
var DEFAULT_TIME_BLOCKS = constants.DEFAULT_TIME_BLOCKS;
var DEFAULT_TOOL_MATRIX = constants.DEFAULT_TOOL_MATRIX;
var DAY_NAMES = constants.DAY_NAMES;
var SCHEDULER_VERSION = constants.SCHEDULER_VERSION;
var RECUR_EXPAND_DAYS = constants.RECUR_EXPAND_DAYS;
var dateHelpers = require('./dateHelpers');
var parseDate = dateHelpers.parseDate;
var formatDateKey = dateHelpers.formatDateKey;
var isoToDateKey = dateHelpers.isoToDateKey;
var parseTimeToMinutes = dateHelpers.parseTimeToMinutes;
var formatMinutesToTime = dateHelpers.formatMinutesToTime;
var formatMinutesToTimeDb = dateHelpers.formatMinutesToTimeDb;
var localToUtc = dateHelpers.localToUtc;
var utcToLocal = dateHelpers.utcToLocal;
var taskController = require('../controllers/task.controller');
var rowToTask = taskController.rowToTask;
var buildSourceMap = taskController.buildSourceMap;
var taskToRow = taskController.taskToRow;
var expandRecurringShared = require('../../../shared/scheduler/expandRecurring');
var expandRecurring = expandRecurringShared.expandRecurring;
var reconcile = require('./reconcileOccurrences');
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

  var todayKey = vals.year + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
  return {
    todayKey: todayKey,
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
    splitMinDefault: config.preferences ? config.preferences.splitMinDefault : undefined,
    locations: config.locations || []
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

async function loadWeatherForHorizon(locations, db) {
  var weatherByDateHour = {};
  var locWithCoords = (locations || []).find(function(l) {
    return typeof l.lat === 'number' && typeof l.lon === 'number';
  });
  if (!locWithCoords) return weatherByDateHour;

  var latGrid = Math.round(locWithCoords.lat * 10) / 10;
  var lonGrid = Math.round(locWithCoords.lon * 10) / 10;

  var row = await db('weather_cache')
    .where('lat_grid', latGrid)
    .where('lon_grid', lonGrid)
    .where('expires_at', '>', db.fn.now())
    .orderBy('fetched_at', 'desc')
    .first();

  if (!row) return weatherByDateHour; // fail-open: no cached data

  var forecast;
  try { forecast = JSON.parse(row.forecast_json); } catch (e) { return weatherByDateHour; }

  var hourly = forecast.hourly;
  if (!hourly || !hourly.time) return weatherByDateHour;

  for (var i = 0; i < hourly.time.length; i++) {
    var dt = hourly.time[i]; // "2026-05-05T14:00"
    var dateKey = dt.slice(0, 10);
    var hour = parseInt(dt.slice(11, 13), 10);
    if (!weatherByDateHour[dateKey]) weatherByDateHour[dateKey] = {};
    weatherByDateHour[dateKey][hour] = {
      temp:       hourly.temperature_2m              ? hourly.temperature_2m[i]              : null,
      precipProb: hourly.precipitation_probability   ? hourly.precipitation_probability[i]   : 0,
      cloudcover: hourly.cloudcover                  ? hourly.cloudcover[i]                  : 0,
      humidity:   hourly.relativehumidity_2m         ? hourly.relativehumidity_2m[i]         : null,
    };
  }

  return weatherByDateHour;
}

async function runScheduleAndPersist(userId, _retries, options) {
  var retries = _retries || 0;
  var MAX_RETRIES = 3;

  // Timezone from frontend (X-Timezone header) via options, or fallback
  var TIMEZONE = (options && options.timezone) || DEFAULT_TIMEZONE;

  try {
  return await db.transaction(async function(trx) {

  // Per-phase timing. Each checkpoint captures cumulative elapsed ms from
  // transaction start; the summary log at the end shows phase-by-phase
  // deltas so we can find where time is going without a profiler.
  var tPerfStart = Date.now();
  var tPerf = { loadEnd: 0, expandEnd: 0, reconcileEnd: 0, scheduleEnd: 0, persistEnd: 0 };

  // 0. Materialize secondary chunk rows for non-recurring split tasks before
  // the task load so the scheduler sees them and can place each chunk
  // independently. Recurring split tasks are handled by the Phase 1 upfront
  // INSERT path (step 5b) and are excluded here to avoid ID conflicts.
  var _splitResult = await reconcileSplitsForUser(trx, userId);
  if (_splitResult.mastersTouched > 0) {
    console.log('[SCHED] split-reconcile: inserted=' + _splitResult.inserted +
      ' updated=' + _splitResult.updated +
      ' deleted=' + _splitResult.deleted +
      ' masters=' + _splitResult.mastersTouched);
  }

  // 1. Load schedulable tasks + templates + terminal-dedup + user config in
  //    parallel. All three are read-only and independent; serial awaits were
  //    adding the three queries' latencies on top of each other. Config uses
  //    its own connection (db) while the task rows use the transaction (trx)
  //    so the scheduler still sees a consistent snapshot.
  var _loadStart = Date.now();
  var _p_taskRows = trx('tasks_v').where('user_id', userId)
    .where(function() {
      this.where('status', '').orWhere('status', 'wip').orWhereNull('status')
        .orWhere('task_type', 'recurring_template');
    })
    .select();
  // Pull scheduled_at alongside date so we can fall back when date is NULL.
  // Some legacy / partially-created rows end up with NULL date but a valid
  // scheduled_at. Without the fallback, skip/cancel/done on those rows
  // doesn't block expansion of the same occurrence — and a fresh pending
  // instance reappears on the next scheduler run.
  var _p_terminalDedupRows = trx('task_instances').where('user_id', userId)
    .whereNotNull('master_id')
    .whereIn('status', ['done', 'skip', 'cancel'])
    .select('master_id as source_id', 'date', 'scheduled_at', 'occurrence_ordinal', 'id');
  // Cross-cycle spacing history: latest `done` placement date per recurring
  // master. Only `done` counts — `skip` / `cancel` mean the user opted out
  // of that slot and shouldn't be treated as the real cadence (else a user
  // who skips a week would be blocked from re-scheduling earlier than
  // minGap days later). Pending instances are excluded because they include
  // the rows we are about to place; within-run placements contribute via
  // noteMasterPlacement in v2. See docs/RECURRING-SPACING-DESIGN.md.
  var _p_recurHistory = trx('task_instances').where('user_id', userId)
    .whereNotNull('master_id')
    .whereNotNull('date')
    .where('status', 'done')
    .select('master_id')
    .max('date as latest_date')
    .groupBy('master_id');
  var _p_cfg = loadConfig(userId);
  var _loaded = await Promise.all([_p_taskRows, _p_terminalDedupRows, _p_recurHistory, _p_cfg]);
  var taskRows = _loaded[0];
  var terminalDedupRows = _loaded[1];
  var recurHistoryRows = _loaded[2];
  var _preloadedCfg = _loaded[3];
  var recurringHistoryByMaster = {};
  recurHistoryRows.forEach(function(r) {
    if (!r.master_id || !r.latest_date) return;
    var dk = isoToDateKey(r.latest_date);
    if (dk) recurringHistoryByMaster[r.master_id] = dk;
  });
  _preloadedCfg.recurringHistoryByMaster = recurringHistoryByMaster;
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
  // Inject terminal dedup data as synthetic entries so expandRecurring skips
  // those dates. Derive date from scheduled_at when the DB `date` column is
  // NULL — common for legacy rows and for instances created through paths
  // that set scheduled_at but didn't backfill the denormalized date column.
  terminalDedupRows.forEach(function(r) {
    if (!r.source_id) return;
    var dateKey = isoToDateKey(r.date);
    if (!dateKey && r.scheduled_at) {
      var local = utcToLocal(r.scheduled_at, TIMEZONE);
      if (local && local.date) dateKey = local.date;
    }
    if (!dateKey) return;
    allTasks.push({ id: '_dedup_' + r.source_id + '_' + dateKey, sourceId: r.source_id, date: dateKey, taskType: 'recurring_instance', text: '', status: 'done' });
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

  // 5. Config was loaded in parallel with tasks above.
  var cfg = _preloadedCfg;
  cfg.timezone = TIMEZONE;

  tPerf.loadEnd = Date.now() - tPerfStart;

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
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + RECUR_EXPAND_DAYS);

  // Index existing recurring_instance rows. Track pending (placeable) and the
  // full set (any status) for ordinal preservation + existence lookup.
  // `pendingBookedByDate` is additionally passed to expandRecurring so the
  // timesPerCycle slot accounting can treat pending instances as already
  // "filling" cycle slots. Without this, a user who skipped M+W+F of a
  // tpc=4 weekly pattern saw the scheduler pick a fresh 4th date every run
  // (skipped count = 3, slotsNeeded = 4-3 = 1, new instance created →
  // user skips → repeat).
  var existingPendingIds = {};
  var existingById = {}; // id -> { occ, status, master_id }
  var rowsByIdForReconcile = {}; // id -> full raw row (for dur/merge-survivor checks)
  var maxOrdByMaster = {};
  var pendingBookedByDate = {}; // `${masterId}|${date}` -> true (pending only)
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
      // Also track the numeric suffix of the instance ID. IDs from prior runs
      // may have suffixes higher than occurrence_ordinal (they diverge when
      // collision-dropped desired occurrences leave holes in the ordinal space
      // while the actual inserted IDs advance further). If nextOrd starts below
      // an existing ID suffix, the new desired occurrence gets an ID that
      // matches an existing pending instance — existingPendingIds rejects it,
      // silently dropping the new instance from the calendar.
      var idSuffix = String(r.id).match(/-(\d+)(?:-\d+)?$/);
      if (idSuffix) {
        var idNum = Number(idSuffix[1]);
        if (idNum > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = idNum;
      }
    }
    // Record pending dates so tpc slot accounting can count them as booked.
    if (mid && (!r.status || r.status === '') && r.date) {
      var pdkey = isoToDateKey(r.date);
      if (pdkey) pendingBookedByDate[mid + '|' + pdkey] = true;
    }
  });

  // Include terminal (done/skip/cancel) rows in maxOrdByMaster so new ordinals
  // never collide with completed occurrences. Pending rows are already handled
  // above; terminal rows are excluded from taskRows but their ordinals are just
  // as reserved.
  terminalDedupRows.forEach(function(r) {
    var mid = r.source_id;
    if (!mid) return;
    var o = Number(r.occurrence_ordinal) || 0;
    if (o > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = o;
    var idSuffix = String(r.id).match(/-(\d+)(?:-\d+)?$/);
    if (idSuffix) {
      var idNum = Number(idSuffix[1]);
      if (idNum > (maxOrdByMaster[mid] || 0)) maxOrdByMaster[mid] = idNum;
    }
  });

  // expandRecurring skips generating an instance whose (sourceId, date) already
  // appears in allTasks. Hide pending chunks from that input so the expansion
  // is authoritative (we rebuild the full desired set below).
  var allTasksForExpand = allTasks.filter(function(t) {
    if (t.taskType !== 'recurring_instance') return true;
    return !existingPendingIds[t.id];
  });
  var desiredOccurrences = expandRecurring(allTasksForExpand, today, expandEnd, {
    statuses: statuses,
    maxOrdBySource: maxOrdByMaster,
    pendingBookedByDate: pendingBookedByDate
  });
  var MAX_EXPANDED = 500;
  if (desiredOccurrences.length > MAX_EXPANDED) {
    console.warn('[SCHED] expansion capped: ' + desiredOccurrences.length + ' → ' + MAX_EXPANDED);
    desiredOccurrences = desiredOccurrences.slice(0, MAX_EXPANDED);
  }
  tPerf.expandEnd = Date.now() - tPerfStart;

  // ── Date-based reconciliation ──
  // Match existing pending occurrences to target dates by exact-date first,
  // then nearest-first. Preserves instance IDs + occurrence_ordinals across
  // runs so completion state, cal links, and the UI don't churn. Cal-linked
  // rows (gcal/msft) bypass this pool — they pass through the id-based diff
  // unchanged so outbound sync stays correct.
  var existingGroupsByMaster = reconcile.buildExistingGroups(taskRows, parseDate, isoToDateKey);
  var reconResult = reconcile.matchOccurrences(desiredOccurrences, existingGroupsByMaster, parseDate);
  var occIdOverrides = reconResult.occIdOverrides;
  var occurrenceMoves = reconResult.occurrenceMoves;

  // Rewrite matched desired.id to reuse the existing occurrence's primary id.
  // Chunk fanout (below) sees existingById[primaryId] and keeps the original
  // occurrence_ordinal; the existing DB row stays, avoiding ordinal churn.
  desiredOccurrences.forEach(function(occ) {
    var newId = occIdOverrides[occ.id];
    if (newId && newId !== occ.id) occ.id = newId;
  });

  // Mutate matched allTasks entries so the scheduler sees the target date,
  // not the stale existing date. Clearing scheduledAt forces re-placement.
  // Stash `_preReconDate` / `_preReconTime` so the post-placement diff below
  // still sees the pre-move date and emits a proper SSE patch + DB update.
  // Without this, `taskById[id].date` would already be `newDate` at diff time,
  // `dateChanged` would be false, and the frontend would never learn about
  // the move.
  if (occurrenceMoves.length > 0) {
    var moveByChunkId = {};
    occurrenceMoves.forEach(function(mv) {
      mv.chunkIds.forEach(function(cid) { moveByChunkId[cid] = mv; });
    });
    allTasks.forEach(function(t) {
      var mv = moveByChunkId[t.id];
      if (!mv) return;
      t._preReconDate = t.date;
      t._preReconTime = t.time;
      t.date = mv.newDate;
      t._candidateDate = mv.newDate;
      var d = parseDate(mv.newDate);
      if (d) t.day = DAY_NAMES[d.getDay()];
      t.time = null;
      t.startAfter = null;
      t.deadline = null;
      t.scheduledAt = null;
    });
    console.log('[SCHED] reconcile: matched ' + occurrenceMoves.length + ' existing occurrence(s) to new target date(s)');
  }

  // Fan out each occurrence into K chunks based on master.split / splitMin.
  var nextOrdByMaster = Object.assign({}, maxOrdByMaster);
  var desiredRows = [];
  desiredOccurrences.forEach(function(occ) {
    var masterId = occ.sourceId;
    var primaryId = occ.id; // <masterId>-<ordinal> (date-agnostic)

    // Determine chunk plan. occ inherits master.split / master.splitMin via
    // expandRecurring's newTasks copy.
    //
    // User-edited `time_remaining` on the existing primary chunk overrides
    // the full master.dur for this occurrence. This lets the user say "I
    // already did 75 of the planned 120 minutes of apply-for-jobs, only 45
    // left to schedule today" and have the scheduler shrink the chunk plan
    // accordingly. Only the PRIMARY chunk (split_ordinal=1) carries the
    // override because that's what the edit form binds to for multi-chunk
    // split tasks.
    var effectiveDur = occ.dur;
    var primaryRow = rowsByIdForReconcile[primaryId];
    if (primaryRow && primaryRow.time_remaining != null) {
      var remaining = Number(primaryRow.time_remaining);
      if (!isNaN(remaining) && remaining >= 0) effectiveDur = remaining;
    }

    var chunks;
    if (occ.split && effectiveDur > 0) {
      chunks = computeChunks(effectiveDur, occ.splitMin);
      if (chunks.length === 0) chunks = [{ splitOrdinal: 1, splitTotal: 1, dur: effectiveDur || 30 }];
    } else {
      chunks = [{ splitOrdinal: 1, splitTotal: 1, dur: effectiveDur || 30 }];
    }

    // Always produce the correct chunk plan — even if a prior run merged
    // chunks into one row. The scheduler places each chunk independently;
    // the post-placement merge step recombines contiguous chunks.
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
  // Grandfather pending instances that fall beyond the expansion horizon.
  // Without this, shrinking RECUR_EXPAND_DAYS would delete legitimate
  // pending rows that were expanded under a prior (larger) horizon.
  // "Reconstruct the sequence" paths (recur-config change in
  // task.controller.js) delete pending rows directly via SQL before the
  // scheduler runs, so they are unaffected by this grandfather clause.
  var toDeleteIds = Object.keys(existingPendingIds).filter(function(id) {
    if (desiredIds[id]) return false;
    var row = rowsByIdForReconcile[id];
    if (row && row.date) {
      var rowDate = parseDate(row.date);
      if (rowDate && rowDate > expandEnd) return false;
    }
    return true;
  });

  // Drift fix: existing pending rows whose (split_ordinal, split_total, dur)
  // don't match the current chunk plan get UPDATEd in place. Covers the case
  // where master.dur or master.split_min changed, or where a prior bug wrote
  // the wrong chunk dur.
  var toUpdate = [];
  // Declared in outer scope so the reconcileChanged rebuild can re-apply these
  // corrections — without this, the rebuild wipes the allTasks patch and the
  // scheduler then places at the old (wrong) dur, which the persist step writes
  // back to the DB, undoing the drift-fix entirely.
  var updateById = {};
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
    // Use db (not trx) so this persists even if the deletion transaction rolls
    // back on lock timeout — the safety-net flag must survive a rollback.
    await db('task_instances').whereIn('id', toDeleteIds).update({ unscheduled: 1, updated_at: db.fn.now() });
    await tasksWrite.deleteTasksWhere(trx, userId, function(q) { return q.whereIn('id', toDeleteIds); });
    console.log('[SCHED] reconcile: deleted ' + toDeleteIds.length + ' stale recurring instances');
    reconcileChanged = true;
  }
  if (toUpdate.length > 0) {
    // Batch drift-fix UPDATEs into CASE-WHEN expressions, chunked to 200 per
    // statement to stay well below MySQL's max_allowed_packet. Each drift-fix
    // touches up to three fields (split_ordinal, split_total, dur) — we only
    // emit CASEs for fields that actually vary in the chunk, skipping no-op
    // columns.
    var DRIFT_CHUNK = 200;
    for (var dci = 0; dci < toUpdate.length; dci += DRIFT_CHUNK) {
      var driftChunk = toUpdate.slice(dci, dci + DRIFT_CHUNK);
      var driftIds = driftChunk.map(function(u) { return u.id; });
      var driftFields = { updated_at: db.fn.now() };
      ['split_ordinal', 'split_total', 'dur'].forEach(function(col) {
        var touched = driftChunk.filter(function(u) { return u.changes[col] != null; });
        if (touched.length === 0) return;
        var expr = 'CASE id';
        var bindings = [];
        touched.forEach(function(u) { expr += ' WHEN ? THEN ?'; bindings.push(u.id, u.changes[col]); });
        expr += ' ELSE `' + col + '` END';
        driftFields[col] = trx.raw(expr, bindings);
      });
      await trx('task_instances').whereIn('id', driftIds).update(driftFields);
    }
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
    // Re-apply reconcile move mutations — the reload above rebuilt allTasks
    // from the original taskRows, so the date retargeting from the occurrence
    // reconcile (e.g. user changed recur_start) just got wiped. Without this,
    // the scheduler sees the stale original date and re-places at the old
    // anchor (or leaves it unplaced if the old date is past).
    if (typeof occurrenceMoves !== 'undefined' && occurrenceMoves.length > 0) {
      var moveByChunkIdReapply = {};
      occurrenceMoves.forEach(function(mv) {
        mv.chunkIds.forEach(function(cid) { moveByChunkIdReapply[cid] = mv; });
      });
      allTasks.forEach(function(t) {
        var mv = moveByChunkIdReapply[t.id];
        if (!mv) return;
        t._preReconDate = t.date;
        t._preReconTime = t.time;
        t.date = mv.newDate;
        t._candidateDate = mv.newDate;
        var d2 = parseDate(mv.newDate);
        if (d2) t.day = DAY_NAMES[d2.getDay()];
        t.time = null;
        t.startAfter = null;
        t.deadline = null;
        t.scheduledAt = null;
      });
    }
    // Re-apply drift-fix chunk-plan corrections. The taskRows rebuild above
    // loaded stale dur/split values from before the DB update — without this
    // the scheduler places at the old dur and the persist step writes it back,
    // permanently undoing the drift-fix.
    if (Object.keys(updateById).length > 0) {
      allTasks.forEach(function(t) {
        var ch = updateById[t.id];
        if (!ch) return;
        if (ch.dur != null) t.dur = ch.dur;
        if (ch.split_ordinal != null) t.splitOrdinal = ch.split_ordinal;
        if (ch.split_total != null) t.splitTotal = ch.split_total;
      });
    }
  }

  // ── Phase 1: Pre-insert all new chunk rows before scheduling ──
  // Ensures every planned chunk has a DB row immediately (for cal sync,
  // per-chunk status, and idempotent next-run loading). scheduled_at starts
  // null; the persist step UPDATEs it for placed chunks.
  // Hoisted so the changeset builder can project full task objects for these
  // rows even though taskRows was loaded before the INSERT.
  var phase1InsertedById = {};
  if (toInsert.length > 0) {
    var chunkInsertRows = toInsert.map(function(row) {
      var occDate = row._candidateDate || row.date || null;
      var occDay = null;
      if (occDate) {
        var occDateObj = parseDate(occDate);
        if (occDateObj) occDay = DAY_NAMES[occDateObj.getDay()];
      }
      return {
        id: row.id,
        user_id: userId,
        task_type: 'recurring_instance',
        source_id: row.sourceId,
        occurrence_ordinal: row.occurrence_ordinal,
        split_ordinal: row.split_ordinal,
        split_total: row.split_total,
        split_group: row.split_group || null,
        dur: row.dur,
        generated: 0,
        scheduled_at: null,
        date: occDate,
        day: occDay,
        time: null,
        unscheduled: null,
        status: '',
        created_at: trx.fn.now(),
        updated_at: trx.fn.now()
      };
    });
    // Defensive dedup: detect any IDs already in DB before inserting.
    // Structurally impossible given the existingPendingIds filter above,
    // but guards against future code changes breaking that invariant.
    var existingChunkCheck = await trx('task_instances')
      .whereIn('id', chunkInsertRows.map(function(r) { return r.id; }))
      .select('id');
    if (existingChunkCheck.length > 0) {
      var existingChunkSet = {};
      existingChunkCheck.forEach(function(r) { existingChunkSet[r.id] = true; });
      console.error('[SCHED] phase1: collision — ' + existingChunkCheck.length + ' chunk IDs already in DB, skipping:', existingChunkCheck.map(function(r) { return r.id; }));
      chunkInsertRows = chunkInsertRows.filter(function(r) { return !existingChunkSet[r.id]; });
    }
    if (chunkInsertRows.length > 0) {
      await tasksWrite.insertTasksBatch(trx, chunkInsertRows);
      console.log('[SCHED] phase1: pre-inserted ' + chunkInsertRows.length + ' chunk rows');
    }
    // Populate for changeset projection — taskRows was loaded before this INSERT
    // so rowsById won't have these rows; phase1InsertedById fills the gap.
    // Use an ISO string for created_at/updated_at: the DB rows use trx.fn.now()
    // (a Knex raw expression) which is valid SQL but breaks new Date() in rowToTask.
    var nowISO = new Date().toISOString();
    chunkInsertRows.forEach(function(r) {
      phase1InsertedById[r.id] = Object.assign({}, r, { created_at: nowISO, updated_at: nowISO });
    });
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
      placementMode: master.placementMode,
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

  tPerf.reconcileEnd = Date.now() - tPerfStart;

  // Load weather data for weather-constrained tasks (fail-open if no coords/cache)
  cfg.weatherByDateHour = {};
  var hasWeatherTasks = allTasks.some(function(t) {
    return (t.weatherPrecip && t.weatherPrecip !== 'any') ||
           (t.weatherCloud  && t.weatherCloud  !== 'any') ||
           t.weatherTempMin != null || t.weatherTempMax != null;
  });
  if (hasWeatherTasks && cfg.locations && cfg.locations.length > 0) {
    try {
      cfg.weatherByDateHour = await loadWeatherForHorizon(cfg.locations, db);
    } catch (e) {
      cfg.weatherByDateHour = {}; // fail-open: proceed without weather data
    }
  }

  // 6. Run scheduler (primary chosen by SCHEDULER_V2 env var; shadow runs
  //    in parallel when SCHEDULER_V2_SHADOW=true).
  var result = runSchedulerWithShadow(
    allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg, userId, 'main'
  );
  tPerf.scheduleEnd = Date.now() - tPerfStart;

  // 7. Persist schedule results from dayPlacements
  var updated = 0;
  var updatedTasks = [];

  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });

  // Build a map of raw rows by ID for accessing scheduled_at
  var rawRowById = {};
  taskRows.forEach(function(r) { rawRowById[r.id] = r; });

  // Extract the first placement per task from dayPlacements. Phase 1 ensures
  // every split chunk has its own unique row ID, so each task.id maps to
  // exactly one placement. No multi-placement-per-task-id split-master
  // handling needed (that was v1-only behavior).
  var placementByTaskId = {};
  var dayPlacements = result.dayPlacements;

  // ── #42: Merge adjacent split-task chunks ──────────────────────────────────
  // After all placements are determined, collapse back-to-back chunks of the
  // same split occurrence into a single extended placement entry. "Back-to-back"
  // means zero gap: chunk N's start + dur === chunk N+1's start on the same day.
  //
  // Result: one DB row (the primary/first chunk) carries the combined dur.
  // The secondary rows that were merged in are deleted from the DB — they were
  // pre-inserted in Phase 1 but are no longer needed as distinct entries.
  //
  // Rationale: the day view and calendar sync should show one continuous block,
  // not N short tiles/events. If the scheduler placed chunks with gaps between
  // them the chunks remain separate (gap > 0 means the user could fill the gap
  // with something else and the visual split is meaningful).
  var mergedOutIds = []; // secondary chunk IDs whose DB rows should be deleted
  Object.keys(dayPlacements).forEach(function(dateKey) {
    var placements = dayPlacements[dateKey];
    if (!placements || placements.length < 2) return;

    // Track per-day merged IDs to filter only the current day's merged chunks
    var dayMergedIds = [];

    // Collect split-chunk placements grouped by splitGroup.
    // Non-split placements (splitGroup null/undefined) are left untouched.
    var byGroup = {}; // splitGroup → [placementEntry, ...]
    placements.forEach(function(p) {
      if (!p.task) return;
      var sg = p.task.splitGroup;
      if (!sg) return; // not a split chunk
      if (!byGroup[sg]) byGroup[sg] = [];
      byGroup[sg].push(p);
    });

    Object.keys(byGroup).forEach(function(sg) {
      var group = byGroup[sg];
      if (group.length < 2) return; // nothing to merge

      // Sort by start time ascending so we can scan for adjacent pairs.
      group.sort(function(a, b) { return a.start - b.start; });

      // Linear scan: merge consecutive zero-gap pairs.
      // Walk forward; whenever two entries are back-to-back, fold the second
      // into the first (accumulate dur) and mark the second for deletion.
      var i = 0;
      while (i < group.length - 1) {
        var curr = group[i];
        var next = group[i + 1];
        if (curr.start + curr.dur === next.start) {
          // Zero gap — merge next into curr.
          curr.dur += next.dur;
          // Record next's task ID for DB row deletion.
          if (next.task && next.task.id) {
            dayMergedIds.push(next.task.id);
            mergedOutIds.push(next.task.id);
          }
          // Remove next from the group so the scan can continue (handles 3+ chunks).
          group.splice(i + 1, 1);
          // Do NOT advance i: re-check curr against the new group[i+1].
        } else {
          i++;
        }
      }
      // Note: `group` entries are the same object references as in `placements`,
      // so mutating curr.dur already updated the placement list in-place.
      // Entries removed from `group` via splice are still in `placements` — we
      // filter those out below.
    });

    // Remove merged-out entries from the day's placement list so they don't
    // receive a scheduled_at update and don't appear in the outgoing cache/SSE.
    if (dayMergedIds.length > 0) {
      var mergedOutSet = {};
      dayMergedIds.forEach(function(id) { mergedOutSet[id] = true; });
      dayPlacements[dateKey] = placements.filter(function(p) {
        return !(p.task && p.task.id && mergedOutSet[p.task.id]);
      });
    }
  });

  if (mergedOutIds.length > 0) {
    console.log('[SCHED] split-chunk merge: collapsed ' + mergedOutIds.length + ' adjacent chunk(s) into primary rows');
  }

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

    var newTime = formatMinutesToTimeDb(placement.start);
    var newTimeDisplay = formatMinutesToTime(placement.start);
    var newDate = placement.dateKey;

    // For reconciled (moved) occurrences, `original.date` was overwritten
    // in-place with the target date so the scheduler could place against it.
    // The TRUE pre-run date lives on `_preReconDate`. Without this shim, the
    // diff would see `newDate === original.date` and skip emitting the SSE
    // patch / DB update even though the task just moved.
    var priorDate = original._preReconDate != null ? original._preReconDate : original.date;
    var priorTime = original._preReconTime != null ? original._preReconTime : original.time;
    // Normalize to ISO so M/D format from rowToTask never produces a false dateChanged.
    var priorDateIso = priorDate ? (formatDateKey(parseDate(priorDate)) || priorDate) : priorDate;
    var dateChanged = newDate !== priorDateIso;
    var timeChanged = newTimeDisplay !== priorTime;

    // Never touch recurring templates — they're blueprints, not schedulable tasks.
    if (original.taskType === 'recurring_template') continue;
    // Fixed tasks are user-anchored — never override their time/date.
    // Exception: still sync dur back to the DB when the scheduler's effective
    // placed duration differs from the stored value. The user pinned the TIME,
    // not the block size. Without this, the cal-sync uses the master's dur
    // (e.g. 30 min) and pushes a 30-min GCal event even though Juggler shows
    // a 3.5-hour block — the "inaccurate split task information" in GCal.
    if (original.datePinned) {
      var pinnedPlacedDur = placement.dur;
      var pinnedStoredDur = Number(original.dur) || 0;
      if (pinnedPlacedDur && pinnedPlacedDur !== pinnedStoredDur) {
        pendingUpdates.push({ id: taskId, dbUpdate: { dur: pinnedPlacedDur, updated_at: db.fn.now() } });
      }
      continue;
    }
    // Markers are non-blocking — never move them.
    if (original.marker) continue;
    // Recurrings should never have their date moved — they're day-specific.
    // Exceptions:
    //   - Reconcile-initiated moves (e.g. user changed recur_start): reconcile
    //     explicitly retargeted this chunk, so the move is authoritative. The
    //     `_preReconDate` marker signals this case.
    //   - Past recurringTasks within their placement window can be moved to today.
    if (original.recurring && dateChanged && original._preReconDate == null) {
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
    var newScheduledAt = localToUtc(newDate, newTimeDisplay, TIMEZONE);
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
      overdue: 0,
      date_pinned: 0,
      updated_at: db.fn.now()
    };
    if (placement.dur) {
      dbUpdate.dur = placement.dur;
    }
    if (result.slackByTaskId && taskId in result.slackByTaskId) {
      dbUpdate.slack_mins = result.slackByTaskId[taskId];
    }

    pendingUpdates.push({
      id: taskId,
      dbUpdate: dbUpdate
    });

    if (dateChanged || timeChanged) {
      // Derive day-of-week label for the patch so the frontend can render
      // without a lookup. parseDate handles both M/D and MM/DD.
      var parsedForDay = parseDate(newDate);
      var dayLabel = parsedForDay ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][parsedForDay.getDay()] : null;

      // Build a minimal patch — only fields that actually changed. Prior
      // versions included dur/slackMins/unscheduled unconditionally, which
      // meant every move triggered no-op merges (and frontend re-renders)
      // for tasks whose duration and slack were stable across runs (#39).
      var newDur = placement.dur || original.dur || null;
      var newSlackMins = result.slackByTaskId && taskId in result.slackByTaskId ? result.slackByTaskId[taskId] : null;
      var patch = {
        date: newDate || null,
        time: newTimeDisplay || null,
        day: dayLabel,
        scheduledAt: newScheduledAt instanceof Date ? newScheduledAt.toISOString() : newScheduledAt
      };
      if (newDur !== original.dur) patch.dur = newDur;
      // Normalize original.slackMins (number|null) so we don't emit on null→null.
      var priorSlackMins = original.slackMins != null ? original.slackMins : null;
      if (newSlackMins !== priorSlackMins) patch.slackMins = newSlackMins;
      if (original.unscheduled) patch.unscheduled = false; // only send on transition
      if (original.overdue) patch.overdue = false; // only send on transition

      updatedTasks.push({
        id: taskId,
        text: original.text,
        from: priorDate,
        to: newDate,
        fromTime: priorTime,
        toTime: newTimeDisplay,
        patch: patch
      });
      updated++;
    }
  }

  // 8. Mark unplaced tasks.
  //    There are three cases:
  //
  //    A) Recurring instance with a scheduled_at: leave in place on the calendar.
  //       These are already handled above (the recurring-instance preserve path).
  //
  //    B) Non-recurring task (or recurring instance without scheduled_at) that
  //       has a scheduled_at / date set: it was previously placed but couldn't
  //       be re-placed this run. Set overdue=1, keep unscheduled=0, and
  //       PRESERVE scheduled_at/date/time so the task stays at its last proposed
  //       position with an overdue indicator. Do NOT move it to the unscheduled
  //       lane.
  //
  //    C) Brand-new task (no scheduled_at yet) that couldn't be placed: set
  //       unscheduled=1 so the frontend shows it in the unscheduled lane.
  var cleared = 0;
  result.unplaced.forEach(function(t) {
    if (!t || !t.id) return;
    var original = taskById[t.id];
    if (!original) return;
    if (original.taskType === 'recurring_template') return;
    if (original.datePinned) return;
    if (original.marker) return;
    // Recurring instances: two cases based on whether they've ever been placed.
    //   - scheduled_at set: keep last-proposed position on calendar; the overdue
    //     indicator is inferred on the frontend from (date < today AND status='').
    //     No DB write needed here — the task is already in place.
    //   - scheduled_at null: Phase 1 pre-inserted chunk that couldn't be placed
    //     this run. Mark unscheduled=1 so the frontend shows it in the
    //     unscheduled lane. No SSE emitted here — Phase 5 handles new-chunk events.
    if (original.taskType === 'recurring_instance') {
      var rawRec = rawRowById[t.id];
      var hasScheduledAt = rawRec ? !!rawRec.scheduled_at : !!original.scheduledAt;
      if (hasScheduledAt) return;
      var unplacedChunkUpdate = { unscheduled: 1, updated_at: db.fn.now() };
      if (result.slackByTaskId && t.id in result.slackByTaskId) {
        unplacedChunkUpdate.slack_mins = result.slackByTaskId[t.id];
      }
      pendingUpdates.push({ id: t.id, dbUpdate: unplacedChunkUpdate });
      cleared++;
      return;
    }
    // One-off / chain-member task. Two sub-cases:
    var rawRow = rawRowById[t.id];
    var hasScheduledAt = rawRow ? !!rawRow.scheduled_at : !!(original.date || original.scheduledAt);
    if (hasScheduledAt) {
      // Case B: was previously placed — pin in place with overdue=1.
      // Keep unscheduled=0 so the task renders at its scheduled position.
      var wasAlreadyOverdue = !!(rawRow && rawRow.overdue);

      // Only write if there's a state change:
      // 1. If already overdue + unscheduled already 0 → only write if slack_mins changed
      // 2. If newly overdue → write the full transition
      // 3. If already overdue but unscheduled was 1 → fix that
      var needsUpdate = false;
      var overdueDbUpdate = {};

      if (wasAlreadyOverdue && rawRow && rawRow.unscheduled === 0) {
        // Already in final state (overdue=1, unscheduled=0).
        // Only update if slack_mins changed.
        if (result.slackByTaskId && t.id in result.slackByTaskId &&
            result.slackByTaskId[t.id] !== (rawRow.slack_mins || 0)) {
          overdueDbUpdate.slack_mins = result.slackByTaskId[t.id];
          needsUpdate = true;
        }
      } else {
        // Newly overdue OR unscheduled flag needs fixing.
        overdueDbUpdate.unscheduled = 0;
        overdueDbUpdate.overdue = 1;
        overdueDbUpdate.updated_at = db.fn.now();
        if (result.slackByTaskId && t.id in result.slackByTaskId) {
          overdueDbUpdate.slack_mins = result.slackByTaskId[t.id];
        }
        needsUpdate = true;
      }

      if (needsUpdate) {
        pendingUpdates.push({ id: t.id, dbUpdate: overdueDbUpdate });
      }

      // Emit SSE transition only when crossing placed → overdue (not already overdue).
      if (!wasAlreadyOverdue) {
        updatedTasks.push({
          id: t.id,
          text: original.text,
          from: original.date,
          to: original.date, // date stays unchanged
          fromTime: original.time,
          toTime: original.time,
          patch: { overdue: true } // scheduled_at/date/time/day unchanged
        });
      }
    } else {
      // Case C: never placed — move to unscheduled lane.
      var unplacedDbUpdate = { unscheduled: 1, updated_at: db.fn.now() };
      if (result.slackByTaskId && t.id in result.slackByTaskId) {
        unplacedDbUpdate.slack_mins = result.slackByTaskId[t.id];
      }
      pendingUpdates.push({ id: t.id, dbUpdate: unplacedDbUpdate });
    }
    cleared++;
  });

  // Build unplaced lookup so Phase 9 doesn't overwrite Phase 8's null scheduled_at
  var unplacedIds = {};
  result.unplaced.forEach(function(t) { if (t && t.id) unplacedIds[t.id] = true; });

  // 8.5. Clear stale `unscheduled` flag on recurring instances that have a
  // scheduled_at. They stay visible on the calendar at their last proposed
  // time even when they didn't fit a fresh placement (per user request).
  // Without this, a flag set by a prior run persists indefinitely and the
  // task shows in the unscheduled lane instead of the calendar.
  allTasks.forEach(function(t) {
    if (t.taskType !== 'recurring_instance') return;
    var raw = rawRowById[t.id];
    if (!raw || !raw.unscheduled) return; // already clear
    if (!raw.scheduled_at) return; // truly nothing to show on calendar
    pendingUpdates.push({ id: t.id, dbUpdate: { unscheduled: null, updated_at: db.fn.now() } });
  });

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

  // Adjacent split chunks that landed back-to-back (zero gap) on the same day
  // were merged into a single extended DB row earlier in the write path (#42).
  // See the "Merge adjacent split-task chunks" block above. Chunks with gaps
  // between them remain as separate rows — gap > 0 means capacity lives between
  // them and the split is still meaningful for scheduling purposes.

  // Phase 1: in-memory chunk rows were pre-inserted before scheduling (see
  // "Phase 1: Pre-insert" block above). Placed chunks now have DB rows and
  // flow through pendingUpdates as UPDATEs like any other recurring instance.
  console.log('[SCHED] persist: ' + inMemoryChunks.length + ' pre-inserted chunks updating via pendingUpdates');

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

  // Delete merged-out secondary chunk rows. Pre-inserted in Phase 1 but their
  // placement was folded into the primary chunk above.
  if (mergedOutIds.length > 0) {
    await tasksWrite.deleteTasksWhere(trx, userId, function(q) {
      return q.whereIn('id', mergedOutIds);
    });
    console.log('[SCHED] split-chunk merge: deleted ' + mergedOutIds.length + ' secondary chunk row(s) from DB');
  }

  console.log('[SCHED] runScheduleAndPersist: updated ' + updated + ', cleared ' + cleared + ' for user ' + userId);
  tPerf.persistEnd = Date.now() - tPerfStart;
  console.log('[SCHED] perf user=' + userId
    + ' load=' + tPerf.loadEnd
    + 'ms expand=' + (tPerf.expandEnd - tPerf.loadEnd)
    + 'ms reconcile=' + (tPerf.reconcileEnd - tPerf.expandEnd)
    + 'ms schedule=' + (tPerf.scheduleEnd - tPerf.reconcileEnd)
    + 'ms persist=' + (tPerf.persistEnd - tPerf.scheduleEnd)
    + 'ms total=' + tPerf.persistEnd
    + 'ms tasks=' + taskRows.length
    + ' placed=' + updated);

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
      // Overdue flag: preserve through the cache round-trip so the frontend
      // sees it in both the fresh schedule:changed payload and the hydrated
      // read-from-cache path.
      if (p._overdue || (p.task && p.task._overdue)) entry.overdue = true;
      return entry;
    });
  });
  // Store unplaced IDs + diagnostic info in cache
  var unplacedMeta = {};
  result.unplaced.forEach(function(t) {
    if (t._unplacedDetail || t._suggestions || t._unplacedReason) {
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
  // Also synthesize placements for overdue tasks — they have a scheduled_at
  // but weren't re-placed this run. They stay visible in the grid at their
  // last scheduled position with an overdue indicator (overdue=1).
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
    var isFinished = st === 'done' || st === 'cancel' || st === 'skip';
    var isOverdueTask = !!t.overdue;
    if (!isFinished && !isOverdueTask) return;
    if (!t.date || t.date === 'TBD') return;
    var startMin = t.time ? parseTimeToMinutes(t.time) : null;
    if (startMin == null) return;
    var dur = t.dur || 30;
    var entry = { task: t, start: startMin, dur: dur };
    var utcDate = localToUtc(t.date, t.time, TIMEZONE);
    if (utcDate) entry.scheduledAtUtc = utcDate.toISOString();
    if (isOverdueTask) entry._overdue = true;
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
    // rowsById was populated from taskRows (pre-Phase-1 snapshot). Phase 1
    // pre-inserted chunk rows (split_ordinal >= 2) aren't there — fall back
    // to phase1InsertedById so we still ship a full object instead of id-only.
    var r = rowsById[id] || phase1InsertedById[id];
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
    var genParts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(genTime);
    var genVals = {}; genParts.forEach(function(p) { genVals[p.type] = p.value; });
    var _gm = parseInt(genVals.month, 10), _gd = parseInt(genVals.day, 10);
    var genDateKey = genVals.year + '-' + (_gm < 10 ? '0' : '') + _gm + '-' + (_gd < 10 ? '0' : '') + _gd;
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
        if (p.overdue) h._overdue = true;
        hydratedPlacements[dk].push(h);
      });
      if (hydratedPlacements[dk].length === 0) delete hydratedPlacements[dk];
    });
    var unplacedTasks = (cache.unplaced || []).map(function(id) {
      return fastTaskById[id] || null;
    }).filter(Boolean);
    return {
      dayPlacements: hydratedPlacements,
      unplaced: unplacedTasks,
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
    .select('master_id as source_id', 'date', 'scheduled_at');
  var srcMap = buildSourceMap(taskRows);
  var allTasks = taskRows.map(function(r) { return rowToTask(r, TIMEZONE, srcMap); });
  terminalDedupRows2.forEach(function(r) {
    if (!r.source_id) return;
    var dkey = isoToDateKey(r.date);
    if (!dkey && r.scheduled_at) {
      var local = utcToLocal(r.scheduled_at, TIMEZONE);
      if (local && local.date) dkey = local.date;
    }
    if (!dkey) return;
    allTasks.push({ id: '_dedup_' + r.source_id + '_' + dkey, sourceId: r.source_id, date: dkey, taskType: 'recurring_instance', text: '', status: 'done' });
  });

  // Mirror the runScheduleAndPersist path: pending recurring_instance rows
  // must count against tpc cycle budgets so expandRecurring doesn't pick
  // phantom targets on top of them when hydrating stale cache.
  var pendingBookedByDate2 = {};
  taskRows.forEach(function(r) {
    if (r.task_type !== 'recurring_instance') return;
    if (r.status && r.status !== '') return;
    var mid = r.master_id || r.source_id;
    if (!mid || !r.date) return;
    var dk = isoToDateKey(r.date);
    if (dk) pendingBookedByDate2[mid + '|' + dk] = true;
  });

  var statuses = {};
  allTasks.forEach(function(t) { statuses[t.id] = t.status || ''; });

  // Expand recurring so generated instances can be hydrated from cache
  var today = parseDate(timeInfo.todayKey) || new Date();
  var expandEnd = new Date(today); expandEnd.setDate(expandEnd.getDate() + RECUR_EXPAND_DAYS);
  var expanded = expandRecurring(allTasks, today, expandEnd, { statuses: statuses, pendingBookedByDate: pendingBookedByDate2 });
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
    var genParts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(genTime);
    var genVals = {}; genParts.forEach(function(p) { genVals[p.type] = p.value; });
    var _gm = parseInt(genVals.month, 10), _gd = parseInt(genVals.day, 10);
    var genDateKey = genVals.year + '-' + (_gm < 10 ? '0' : '') + _gm + '-' + (_gd < 10 ? '0' : '') + _gd;
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

    // Synthesize placements for finished tasks (done/cancel/skip) and overdue
    // tasks using their scheduled_at-derived date/time. The scheduler never
    // places these, so without this they'd appear unscheduled when the "all"
    // filter is active. Overdue tasks render in-place with an overdue indicator.
    allTasks.forEach(function(t) {
      if (cachedIds[t.id]) return;
      if (t.generated || t.taskType === 'recurring_template') return;
      var st = statuses[t.id] || '';
      var isFinished = st === 'done' || st === 'cancel' || st === 'skip';
      var isOverdueTask = !!t.overdue;
      if (!isFinished && !isOverdueTask) return;
      if (!t.date || t.date === 'TBD') return;
      var startMin = t.time ? parseTimeToMinutes(t.time) : null;
      if (startMin == null) return;
      var dur = t.dur || 30;
      var entry = { task: t, start: startMin, dur: dur };
      // Add scheduledAtUtc for timezone-safe frontend hydration
      var utcDate = localToUtc(t.date, t.time, TIMEZONE);
      if (utcDate) entry.scheduledAtUtc = utcDate.toISOString();
      if (isOverdueTask) entry._overdue = true;
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
  var result = runSchedulerWithShadow(
    allTasks, statuses, timeInfo.todayKey, timeInfo.nowMins, cfg, userId, 'cache-hydrate'
  );

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
      if (p._overdue || (p.task && p.task._overdue)) entry.overdue = true;
      return entry;
    });
  });
  newCache.unplaced = result.unplaced.map(function(t) { return t.id; });
  var unplacedMeta2 = {};
  result.unplaced.forEach(function(t) {
    if (t._unplacedDetail || t._suggestions || t._unplacedReason) {
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
