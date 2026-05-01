/**
 * Unified Calendar Sync Controller
 *
 * Single endpoint that syncs all connected calendar providers in one pass.
 * Uses the provider adapter pattern for extensibility.
 *
 * Conflict resolution: last-modified-timestamp wins (newest wins).
 * Fixed tasks and recurring sources always push (Juggler wins).
 */

var crypto = require('crypto');
var db = require('../db');
var tasksWrite = require('../lib/tasks-write');
var { getConnectedAdapters } = require('../lib/cal-adapters');
var { enqueueScheduleRun } = require('../scheduler/scheduleQueue');
var { rowToTask, safeParseJSON } = require('./task.controller');
var { localToUtc, utcToLocal } = require('../scheduler/dateHelpers');
var { taskHash, userHash, isoToJugglerDate, toMySQLDate, DEFAULT_TIMEZONE, withGCalRateLimit, callWithRateLimit } = require('./cal-sync-helpers');
var sseEmitter = require('../lib/sse-emitter');
var { acquireLock, releaseLock, refreshLock } = require('../lib/sync-lock');
var { flushQueueInLock } = require('../lib/task-write-queue');
var { PLACEMENT_MODES } = require('../lib/placementModes');

// Number of consecutive syncs an event must be missing before we delete the task.
// Prevents data loss from transient calendarView failures or API propagation delays.
var MISS_THRESHOLD = 3;

// CDN propagation grace period per provider (ms). Within this window after a push,
// a missing event is treated as CDN lag rather than a deletion — miss_count is not
// incremented. Apple CalDAV CDN consistently lags >62s; GCal/MSFT have near-instant
// read-after-write so no grace is needed there.
var CDN_GRACE_MS = { apple: 120 * 1000 };

function withinCdnGrace(ledger, pid) {
  var grace = CDN_GRACE_MS[pid] || 0;
  if (!grace || !ledger.last_pushed_at) return false;
  return (Date.now() - new Date(ledger.last_pushed_at).getTime()) < grace;
}

var PROVIDER_NAMES = { gcal: 'Google Calendar', msft: 'Microsoft Calendar', apple: 'Apple Calendar' };

var RE_AUTH_ERR   = /invalid_grant|unauthorized|forbidden|authorization|access.?denied|token.*expired|expired.*token/i;
var RE_404_ERR    = /not found|404/i;
var RE_RATE_ERR   = /rate.?limit|too many requests|quota/i;
var RE_SERVER_ERR = /server error|service unavailable|bad gateway|timeout/i;

function buildErrorDetail(err, opts) {
  var msg = (err && (err.message || String(err))) || 'Unknown error';
  var provider = opts.provider || 'unknown';
  var providerName = PROVIDER_NAMES[provider] || provider;
  var calendar = opts.calendar || null;
  var affectedTasks = opts.affectedTasks || [];

  var status = (err && err.status != null ? err.status : null) ||
               (err && err.response && err.response.status != null ? err.response.status : null);
  if (status == null) {
    var m = msg.match(/\b(4\d\d|5\d\d)\b/);
    if (m) status = parseInt(m[1], 10);
  }

  var summary, retryable, userAction;

  if (status === 401 || status === 403 || RE_AUTH_ERR.test(msg)) {
    summary = 'Could not ' + (opts.operation || 'sync') + ' — ' + providerName + ' authorization expired or access denied';
    retryable = false;
    userAction = 'Reconnect your ' + providerName + ' in Settings → Calendars';
  } else if (status === 404 || RE_404_ERR.test(msg)) {
    summary = 'Event no longer exists on ' + providerName;
    retryable = false;
    userAction = null;
  } else if (status === 429 || RE_RATE_ERR.test(msg)) {
    summary = providerName + ' rate limit hit — sync will retry automatically';
    retryable = true;
    userAction = null;
  } else if (status >= 500 || RE_SERVER_ERR.test(msg)) {
    summary = providerName + ' is temporarily unavailable — sync will retry automatically';
    retryable = true;
    userAction = null;
  } else {
    summary = 'Could not ' + (opts.operation || 'sync') + ' — ' + msg;
    retryable = true;
    userAction = null;
  }

  return {
    summary: summary,
    affectedTasks: affectedTasks,
    provider: provider,
    calendar: calendar,
    retryable: retryable,
    userAction: userAction || undefined
  };
}

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// Rate-limit helper: pause 250ms every 4 calls (~4 req/s, safe for both GCal and MSFT).
// Avoids the old pattern of sleeping after EVERY call which added minutes of dead time.
var _throttleCount = 0;
function throttle() {
  _throttleCount++;
  if (_throttleCount % 4 === 0) return delay(250);
  return Promise.resolve();
}

/**
 * Build the fields to write to a task when pulling an event edit back from a provider.
 * Promotion logic (when=fixed, prev_when, date_pinned, marker clearing) lives in applyEventToTaskFields.
 */
function _buildPullFields(event, task, tz, adapter) {
  return adapter.applyEventToTaskFields(event, tz, task);
}

/**
 * POST /api/cal/sync — one-way sync (Strive → calendars).
 * Tasks push to their calendar events every sync (deterministic).
 * Ingest-only providers pull events into tasks (as when='fixed').
 * Sync window: 14 days back + 60 days forward.
 */
async function sync(req, res) {
  try {
    var userId = req.user.id;
    var userRow = await db('users').where('id', userId).select('timezone').first();
    var tz = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;
    var year = new Date().getFullYear();
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    _throttleCount = 0; // reset per sync run

    var windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 14);
    var windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 60);

    var stats = { pushed: 0, pulled: 0, skipped: 0, deleted_local: 0, deleted_remote: 0, errors: [], providers: {} };
    var syncRunId = crypto.randomUUID();
    var syncStart = Date.now();
    var triggerType = req.query.trigger === 'auto' ? 'auto' : 'manual';

    // === In-memory mutation buffers (written in one transaction at the end) ===
    var taskUpdates = [];      // { id, fields: { ... } }
    var taskInserts = [];      // full row objects for new tasks from providers
    var taskDeletes = [];      // { id, dependencyTransfers: [{ id, newDepsJson }] }
    var ledgerUpdates = [];    // { id, fields: { ... } }
    var ledgerInserts = [];    // full row objects
    var historyInserts = [];   // sync_history rows

    function logSyncAction(provider, action, opts) {
      historyInserts.push({
        user_id: userId, sync_run_id: syncRunId, provider: provider,
        action: action, task_id: opts.taskId || null,
        task_text: (opts.taskText || '').substring(0, 500),
        event_id: opts.eventId || null,
        old_values: opts.oldValues ? JSON.stringify(opts.oldValues) : null,
        new_values: opts.newValues ? JSON.stringify(opts.newValues) : null,
        detail: opts.detail || null,
        error_detail: opts.errorDetail ? JSON.stringify(opts.errorDetail) : null,
        calendar_name: opts.calendarName || null,
        trigger_type: triggerType
      });
    }

    // deletedDuringSync is derived from taskDeletes[] after the write phase

    // Load user preferences for completed task behavior
    var prefsRow = await db('user_config').where({ user_id: userId, config_key: 'preferences' }).first();
    var calCompletedBehavior = 'update'; // default
    if (prefsRow) {
      try {
        var prefs = typeof prefsRow.config_value === 'string'
          ? JSON.parse(prefsRow.config_value) : prefsRow.config_value;
        if (prefs && prefs.calCompletedBehavior) calCompletedBehavior = prefs.calCompletedBehavior;
      } catch (e) { /* ignore parse errors */ }
    }

    // Progress helper — emits SSE events so frontend can show a progress bar
    function emitProgress(phase, detail, pct, extra) {
      sseEmitter.emit(userId, 'sync:progress', {
        phase: phase, detail: detail, pct: pct || 0,
        provider: extra && extra.provider || null,
        calendar: extra && extra.calendar || null
      });
    }

    // Load per-provider sync mode (full vs ingest-only)
    var calSyncSettingsRow = await db('user_config')
      .where({ user_id: userId, config_key: 'cal_sync_settings' }).first();
    var calSyncSettings = calSyncSettingsRow
      ? (typeof calSyncSettingsRow.config_value === 'string'
          ? JSON.parse(calSyncSettingsRow.config_value) : calSyncSettingsRow.config_value)
      : {};
    function isIngestOnly(providerId) {
      return calSyncSettings[providerId] && calSyncSettings[providerId].mode === 'ingest';
    }

    // === Phase 1: Gather data from all connected providers ===
    var connectedAdapters = getConnectedAdapters(req.user);
    if (connectedAdapters.length === 0) {
      return res.json(stats);
    }

    // Pre-validate tokens before fetching events. Adapters with invalid tokens
    // are excluded so the ledger phase won't misinterpret missing events as deletions.
    var validAdapters = [];
    for (var vai = 0; vai < connectedAdapters.length; vai++) {
      var va = connectedAdapters[vai];
      try {
        await va.getValidAccessToken(req.user);
        validAdapters.push(va);
      } catch (err) {
        var vaErrMsg = err.message || '';
        var vaIsTokenExpired = RE_AUTH_ERR.test(vaErrMsg);
        if (vaIsTokenExpired) {
          var vaEventIdCol = va.getEventIdColumn();
          var vaTokenCols = vaEventIdCol === 'gcal_event_id'
            ? { gcal_access_token: null, gcal_refresh_token: null, gcal_token_expiry: null }
            : { msft_access_token: null, msft_refresh_token: null, msft_token_expiry: null };
          await db('users').where('id', userId).update({ ...vaTokenCols, updated_at: db.fn.now() });
        }
        stats.errors.push({
          phase: 'token_validation',
          provider: va.providerId,
          error: vaErrMsg,
          tokenExpired: vaIsTokenExpired,
          action: vaIsTokenExpired ? 'Please reconnect your calendar in Settings' : undefined
        });
        stats.providers[va.providerId] = { error: vaErrMsg, tokenExpired: vaIsTokenExpired };
        console.warn('[CAL-SYNC] Token validation failed for ' + va.providerId + ': ' + vaErrMsg);
      }
    }
    if (validAdapters.length === 0) {
      emitProgress('done', 'No valid calendar connections', 100);
      return res.json(stats);
    }

    // Get tokens and fetch events for all validated providers IN PARALLEL
    var providerData = {}; // { providerId: { token, events, eventsById } }
    var timeMin = windowStart.toISOString();
    var timeMax = windowEnd.toISOString();

    await Promise.all(validAdapters.map(async function(adapter) {
      try {
        emitProgress('fetch', 'Fetching events...', 5, { provider: adapter.providerId });
        var token = await adapter.getValidAccessToken(req.user);
        var events = await adapter.listEvents(token, timeMin, timeMax, userId);
        emitProgress('fetch', 'Fetched ' + events.length + ' events', 15, { provider: adapter.providerId });

        var eventsById = {};
        for (var ei = 0; ei < events.length; ei++) {
          eventsById[events[ei].id] = events[ei];
          // Apple events: provider_event_id stores the CalDAV URL, not the UID —
          // index by _url too so ledger lookups work regardless of which key was stored.
          if (events[ei]._url) eventsById[events[ei]._url] = events[ei];
        }

        providerData[adapter.providerId] = { token: token, events: events, eventsById: eventsById, adapter: adapter, partialFailure: !!events._hasPartialFailure };
        stats.providers[adapter.providerId] = { pushed: 0, pulled: 0, skipped: 0, deleted_local: 0, deleted_remote: 0, errors: [] };
      } catch (err) {
        console.error('[CAL-SYNC] Event fetch failed for ' + adapter.providerId + ':', err);
        var errMsg = err.message || '';
        var isTokenExpired = RE_AUTH_ERR.test(errMsg);

        if (isTokenExpired) {
          var eventIdCol = adapter.getEventIdColumn();
          var tokenCols = eventIdCol === 'gcal_event_id'
            ? { gcal_access_token: null, gcal_refresh_token: null, gcal_token_expiry: null }
            : { msft_access_token: null, msft_refresh_token: null, msft_token_expiry: null };
          await db('users').where('id', userId).update({ ...tokenCols, updated_at: db.fn.now() });
        }

        stats.errors.push({
          phase: 'fetch',
          provider: adapter.providerId,
          error: errMsg,
          tokenExpired: isTokenExpired,
          action: isTokenExpired ? 'Please reconnect your calendar in Settings' : undefined
        });
        stats.providers[adapter.providerId] = {
          error: errMsg,
          tokenExpired: isTokenExpired
        };
      }
    }));

    // Load unified ledger and all tasks once
    // Load active rows AND deleted_local rows that still hold a provider_event_id.
    // The deleted_local+provider_event_id case arises when deleteTask marks the ledger
    // before the next sync runs — the provider event is still live. Phase 2's
    // !task && event branch handles the actual provider DELETE and clears provider_event_id.
    var ledgerRecords = await db('cal_sync_ledger')
      .where('user_id', userId)
      .where(function() {
        this.where('status', 'active')
          .orWhere(function() {
            this.where('status', 'deleted_local').whereNotNull('provider_event_id');
          });
      })
      .select();

    var { fetchTasksWithEventIds } = require('./task.controller');
    var allTaskRows = await fetchTasksWithEventIds(db, userId, function(q) {
      q.whereNotNull('scheduled_at')
        .where(function() { this.whereNull('unscheduled').orWhere('unscheduled', 0); });
    });

    var allTasks = allTaskRows.map(function(r) {
      var t = rowToTask(r, tz);
      t._recurring = r.recurring;
      t._generated = r.generated;
      t._scheduled_at = r.scheduled_at;
      t._updated_at = r.updated_at;
      t._marker = r.marker;
      t.marker = !!r.marker;
      t.user_id = r.user_id; // needed by Apple adapter's createEvent
      // rowToTask only derives local date/time for user-anchored tasks
      // (date_pinned / recurring / generated / marker / when contains 'fixed')
      // so the scheduler doesn't re-bias off stale auto-placements. Sync is
      // a different consumer: it needs the local date/time for buildEventBody
      // and for the push-filter (!time && when !== 'allday' → skip). Without
      // this, flexible tasks (e.g. one-off with when='morning,afternoon,…')
      // get skipped from every sync and never land on the calendar. Localize
      // from scheduled_at here for display purposes only — this does not
      // write back to the DB and does not affect the next scheduler run.
      if (r.scheduled_at && (!t.date || !t.time)) {
        var local = utcToLocal(r.scheduled_at, tz);
        if (local) {
          if (!t.date) t.date = local.date;
          if (!t.time) t.time = local.time;
          if (!t.day) t.day = local.day;
        }
      }
      return t;
    });

    var tasksById = {};
    for (var ti = 0; ti < allTasks.length; ti++) {
      tasksById[allTasks[ti].id] = allTasks[ti];
    }

    // Contiguous-split merge (#33 finding #7). Each split chunk of an
    // occurrence lives as its own task_instances row — so a 3-hour task
    // cut into 6×30-min contiguous blocks persists as 6 separate tasks
    // and, without this pass, syncs as 6 separate GCal events. Users
    // see a stack of "Task (chunk-like titles)" instead of one span.
    //
    // Group sibling chunks by (master_id, occurrence_ordinal), sort by
    // split_ordinal, find contiguous runs (where chunk N's end equals
    // chunk N+1's start). For each run longer than 1:
    //   - LEADER = first chunk. Mutate its in-memory dur to the run's
    //     total, append "(parts X-Y/N)" to the title when the run doesn't
    //     cover all of the original chunks, and let it push as normal.
    //   - FOLLOWERS = chunks 2..N in the run. Marked in `mergedFollowers`
    //     to suppress from the push loop below, and any existing ledger
    //     row for them gets queued for delete (their old one-per-chunk
    //     GCal event disappears and the leader's single merged event
    //     takes over).
    // The hash-skip in the ledger loop handles steady-state updates —
    // hash now sees merged dur + new title, so the first post-deploy
    // sync will re-push each merged leader with the new shape; after
    // that hash matches and the sync is a no-op for that task.
    var mergedFollowers = {}; // taskId -> leaderId (suppress in push loop)
    var mergedLeaderInfo = {}; // leaderId -> { leaderDur, titleSuffix }
    (function mergeContiguousSplitChunks() {
      var byOccurrence = {};
      allTaskRows.forEach(function(r) {
        var tot = Number(r.split_total) || 1;
        if (tot <= 1) return;
        if (!r.master_id || r.occurrence_ordinal == null) return;
        var key = r.master_id + '|' + r.occurrence_ordinal;
        if (!byOccurrence[key]) byOccurrence[key] = [];
        byOccurrence[key].push(r);
      });
      Object.keys(byOccurrence).forEach(function(k) {
        var chunks = byOccurrence[k].slice().sort(function(a, b) {
          return (Number(a.split_ordinal) || 1) - (Number(b.split_ordinal) || 1);
        });
        // Build contiguous runs. "Contiguous" = chunk N's end (UTC ms) equals
        // chunk N+1's start (UTC ms) within a 30-second tolerance (scheduler
        // rounds to 15-minute slots so drift is never real).
        var runs = [];
        var current = null;
        chunks.forEach(function(c) {
          if (!c.scheduled_at) return;
          var startMs = new Date(String(c.scheduled_at).replace(' ', 'T') + 'Z').getTime();
          var endMs = startMs + ((Number(c.dur) || 30) * 60000);
          if (current && Math.abs(current.endMs - startMs) < 30000) {
            current.chunks.push(c);
            current.endMs = endMs;
          } else {
            current = { chunks: [c], startMs: startMs, endMs: endMs };
            runs.push(current);
          }
        });
        runs.forEach(function(run) {
          if (run.chunks.length < 2) {
            // Non-contiguous singleton chunk: still part of a split task.
            // Add a "(X/N)" suffix so the user can see which part it is.
            var c = run.chunks[0];
            var tot = Number(c.split_total) || 1;
            if (tot > 1) {
              var so = Number(c.split_ordinal) || 1;
              mergedLeaderInfo[c.id] = {
                leaderDur: c.dur != null ? Number(c.dur) : null,
                titleSuffix: ' (' + so + '/' + tot + ')'
              };
            }
            return;
          }
          var leader = run.chunks[0];
          var total = chunks.length;
          var coversAll = run.chunks.length === total;
          var firstPart = Number(leader.split_ordinal) || 1;
          var lastPart = Number(run.chunks[run.chunks.length - 1].split_ordinal) || run.chunks.length;
          mergedLeaderInfo[leader.id] = {
            leaderDur: Math.round((run.endMs - run.startMs) / 60000),
            titleSuffix: coversAll ? '' : ' (parts ' + firstPart + '-' + lastPart + '/' + total + ')'
          };
          for (var ci = 1; ci < run.chunks.length; ci++) {
            mergedFollowers[run.chunks[ci].id] = leader.id;
          }
        });
      });
      // Apply mutations to the in-memory task objects. Leaders get merged
      // dur + optional title suffix; followers are left untouched here
      // and filtered later in the push loop + ledger-follower deletes.
      for (var mi = 0; mi < allTasks.length; mi++) {
        var info = mergedLeaderInfo[allTasks[mi].id];
        if (!info) continue;
        if (info.leaderDur != null) allTasks[mi].dur = info.leaderDur;
        if (info.titleSuffix) allTasks[mi].text = (allTasks[mi].text || '') + info.titleSuffix;
      }
    })();

    // Secondary index: (masterId|date) → instance task. Used to self-heal
    // ledger rows whose `task_id` points to an occurrence_ordinal that the
    // scheduler's reconcile has since renumbered. Without this, every renamed
    // instance triggers a delete-and-recreate cycle on GCal (see issue #33 —
    // Apr 24 reconnect surfaced 222 orphan events from exactly this drift).
    var tasksByMasterDate = {};
    for (var tj = 0; tj < allTasks.length; tj++) {
      var t2 = allTasks[tj];
      if (t2.sourceId && t2.date) tasksByMasterDate[t2.sourceId + '|' + t2.date] = t2;
    }

    // Resolve text for recurring/generated instances that inherit from templates.
    // Instances often have empty text — the frontend resolves it at render time
    // from the source template, but sync needs it for the calendar event title.
    // Templates have scheduled_at=NULL so they're not in allTasks — load them.
    var sourceIds = [];
    allTasks.forEach(function(t) {
      if (!t.text && t.sourceId && !tasksById[t.sourceId]) sourceIds.push(t.sourceId);
    });
    var templateTextById = {};
    if (sourceIds.length > 0) {
      var templateRows = await db('tasks_v').whereIn('id', sourceIds).select('id', 'text');
      templateRows.forEach(function(r) { templateTextById[r.id] = r.text; });
    }
    allTasks.forEach(function(t) {
      if (t.text) return;
      var src = t.sourceId;
      if (src) {
        t.text = (tasksById[src] && tasksById[src].text) || templateTextById[src] || '';
      }
    });

    // Load placement cache to get split task placements.
    // The scheduler splits long tasks into multiple time blocks — the DB only
    // stores the first placement's time, but the cache has all of them.
    // We use this to create one calendar event per split part.
    // Load placement cache — the scheduler's actual placed times and durations.
    // Used for: (1) split task expansion, (2) correcting durations that differ
    // from DB (e.g. recurring instances where runSchedule persists partial dur).
    var splitPlacements = {}; // { taskId: [{ start, dur, dateKey, splitPart, splitTotal }] }
    // Index each individual placement by taskId+scheduledAtUtc so we can match
    // a task to its SPECIFIC placement (not the sum of all placements).
    var placementsByTaskId = {}; // { taskId: [{ start, dur, dateKey, scheduledAtUtc }] }
    var cacheRow = await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
    if (cacheRow) {
      try {
        var cache = typeof cacheRow.config_value === 'string' ? JSON.parse(cacheRow.config_value) : cacheRow.config_value;
        if (cache.dayPlacements) {
          Object.keys(cache.dayPlacements).forEach(function(dk) {
            (cache.dayPlacements[dk] || []).forEach(function(p) {
              if (!p.taskId) return;
              if (p.splitPart) {
                if (!splitPlacements[p.taskId]) splitPlacements[p.taskId] = [];
                splitPlacements[p.taskId].push({
                  start: p.start, dur: p.dur, dateKey: dk,
                  splitPart: p.splitPart, splitTotal: p.splitTotal,
                  scheduledAtUtc: p.scheduledAtUtc || null
                });
              }
              if (!placementsByTaskId[p.taskId]) placementsByTaskId[p.taskId] = [];
              placementsByTaskId[p.taskId].push({
                start: p.start, dur: p.dur, dateKey: dk,
                scheduledAtUtc: p.scheduledAtUtc || null
              });
            });
          });
        }
      } catch (e) { /* ignore parse errors */ }
    }

    // Apply placed duration to each task — match by scheduled_at to find the
    // SPECIFIC placement, not the sum. The scheduler may place a 180-min task
    // as two 90-min blocks; each block should become its own calendar event
    // with the block's duration, not the total.
    //
    // Skip merged leaders (#46): mergeContiguousSplitChunks() already set the
    // correct merged dur from the DB rows. The cache may still hold the old
    // per-chunk dur for the leader's taskId (e.g. the schedule_cache was written
    // before the #42 DB merge ran, or has a stale entry without a splitPart key).
    // Overwriting here would replace the merged total with the short chunk dur,
    // producing a calendar event that ends before the next block starts.
    allTasks.forEach(function(t) {
      var placements = placementsByTaskId[t.id];
      if (!placements || placements.length === 0 || splitPlacements[t.id] || mergedLeaderInfo[t.id]) return;

      if (placements.length === 1) {
        // Single placement — use its duration directly
        t.dur = placements[0].dur;
      } else {
        // Multiple placements — match by scheduled_at time
        var taskSAStr = t._scheduled_at ? String(t._scheduled_at).replace(' ', 'T') : null;
        if (!taskSAStr) return;
        var taskSATime = new Date(taskSAStr + 'Z').getTime();
        var matched = null;
        for (var pi2 = 0; pi2 < placements.length; pi2++) {
          var pl = placements[pi2];
          if (pl.scheduledAtUtc) {
            var plTime = new Date(pl.scheduledAtUtc).getTime();
            if (Math.abs(plTime - taskSATime) < 2 * 60000) { matched = pl; break; }
          }
        }
        if (matched) {
          t.dur = matched.dur;
        } else {
          // Fallback: use the first placement's duration (better than summing)
          t.dur = placements[0].dur;
        }
      }
    });

    // Load Apple write-calendar display name for progress reporting (best-effort)
    var appleCalendarLabel = null;
    if (providerData.apple) {
      try {
        var appleWriteCal = await db('user_calendars')
          .where({ user_id: userId, provider: 'apple', enabled: true })
          .orderByRaw("CASE WHEN sync_direction = 'full' THEN 0 ELSE 1 END")
          .first();
        appleCalendarLabel = appleWriteCal ? (appleWriteCal.display_name || null) : null;
      } catch (e) { /* ignore — label is display-only */ }
    }
    var calendarLabels = { apple: appleCalendarLabel };

    // === Phase 2: Process existing ledger records per provider ===
    // Group ledger by provider
    var ledgerByProvider = {};
    for (var li = 0; li < ledgerRecords.length; li++) {
      var lr = ledgerRecords[li];
      var prov = lr.provider;
      if (!ledgerByProvider[prov]) ledgerByProvider[prov] = [];
      ledgerByProvider[prov].push(lr);
    }

    // Track which tasks and events have been processed per provider
    var processedTaskIdsByProvider = {};
    var processedEventIdsByProvider = {};
    // Tasks where GCal event was deleted but juggler task was modified — Phase 3 will re-create
    var tasksNeedingReCreate = new Set();

    var providerIds = Object.keys(providerData);
    for (var pi = 0; pi < providerIds.length; pi++) {
      var pid = providerIds[pi];
      emitProgress('ledger', 'Checking for changes...', 20 + (pi * 5), { provider: pid, calendar: calendarLabels[pid] || null });
      var pd = providerData[pid];
      var pAdapter = pd.adapter;
      var pToken = pd.token;
      var pEventsById = pd.eventsById;
      var pStats = stats.providers[pid];
      var pLedger = ledgerByProvider[pid] || [];

      var processedTaskIds = new Set();
      var processedEventIds = new Set();
      processedTaskIdsByProvider[pid] = processedTaskIds;
      processedEventIdsByProvider[pid] = processedEventIds;

      // Collect event updates for batch execution at end of ledger phase.
      // Each entry carries ledgerId + newHash so we can write the hash back
      // only after the PATCH succeeds (a premature write would leave the
      // ledger claiming the task was pushed when it wasn't, and the next
      // sync would mistakenly skip the retry).
      var pendingEventUpdates = []; // { eventId, task, ledgerId, newHash }

      for (var pli = 0; pli < pLedger.length; pli++) {
        var ledger = pLedger[pli];
        var task = ledger.task_id ? tasksById[ledger.task_id] : null;

        // Self-heal stale recurring-instance IDs. Reconcile re-numbers
        // occurrence_ordinal over time; ledger task_ids end up pointing to
        // instances that were replaced by new rows for the same date. Before
        // taking the `!task && event` branch below (which deletes the GCal
        // event + marks the ledger deleted_local, followed by a fresh push
        // that creates a duplicate event), rewrite the ledger to the current
        // live instance when we can find one by (master, date).
        //
        // Scope: recurring instance task_ids of the form `<masterId>-<ordinal>`.
        // The trailing `-\d+` captures numeric ordinals for both UUID masters
        // (dash-separated v7 UUIDs) and legacy short-id masters like
        // `t1775853066082nuxt-1157`. Split chunks use `_part<N>` (underscore)
        // so they're not matched by this regex — they fall through to the
        // original branch. event_start is an ISO datetime from the provider;
        // the leading YYYY-MM-DD is compared against the instance's `date`.
        if (!task && ledger.task_id && ledger.event_start) {
          var masterMatch = ledger.task_id.match(/^(.+)-\d+$/);
          var dateMatch = ledger.event_start.match(/^(\d{4}-\d{2}-\d{2})/);
          if (masterMatch && dateMatch) {
            var healKey = masterMatch[1] + '|' + dateMatch[1];
            var healed = tasksByMasterDate[healKey];
            if (healed) {
              // If the healed task is already tracked by another active ledger row,
              // marking this row replaced avoids a unique-constraint violation on
              // active_task_key when both rows would share the same (user,provider,task_id).
              var healAlreadyTracked = pLedger.some(function(l) {
                return l.task_id === healed.id && l.id !== ledger.id;
              });
              if (healAlreadyTracked) {
                ledgerUpdates.push({ id: ledger.id, fields: { status: 'replaced' } });
                ledger.task_id = null;
              } else {
                ledgerUpdates.push({ id: ledger.id, fields: { task_id: healed.id } });
                ledger.task_id = healed.id; // keep in-memory consistent for the rest of this iteration
                task = healed;
              }
            }
          }
        }

        var event = ledger.provider_event_id ? pEventsById[ledger.provider_event_id] : null;

        if (ledger.task_id) processedTaskIds.add(ledger.task_id);
        if (ledger.provider_event_id) processedEventIds.add(ledger.provider_event_id);

        // --- Consistency repair: ensure task's event ID column matches ledger ---
        var eventIdCol = pAdapter.getEventIdColumn();
        if (task && ledger.provider_event_id) {
          var taskEventId = task[(eventIdCol === 'gcal_event_id' ? 'gcalEventId' : eventIdCol === 'msft_event_id' ? 'msftEventId' : 'appleEventId')];
          if (taskEventId !== ledger.provider_event_id) {
            taskUpdates.push({ id: task.id, fields: { [eventIdCol]: ledger.provider_event_id } });
            task[(eventIdCol === 'gcal_event_id' ? 'gcalEventId' : eventIdCol === 'msft_event_id' ? 'msftEventId' : 'appleEventId')] = ledger.provider_event_id;
          }
        }

        try {
          // === NEW DESIGN: One-way sync (Strive → calendars).
          // Sync never modifies task.scheduled_at, task.dur, task.when, etc.
          // Sync only pushes the current task state to the calendar event.
          // Exception: ingest-only providers pull event changes into the task. ===

          // --- Past non-done juggler-origin cleanup ---
          if (task && event && ledger.origin === 'juggler' && task._scheduled_at && !isIngestOnly(pid)) {
            var taskScheduledAt = task._scheduled_at instanceof Date ? task._scheduled_at : new Date(String(task._scheduled_at).replace(' ', 'T') + 'Z');
            var taskIsPast = taskScheduledAt < todayStart;
            var taskNotDone = task.status !== 'done' && task.status !== 'skip';
            if (taskIsPast && taskNotDone) {
              try {
                await pAdapter.deleteEvent(pToken, event._url || ledger.provider_event_id);
                await throttle();
              } catch (e3) {
                if (!e3.message.includes('404') && !e3.message.includes('410')) throw e3;
              }
              taskUpdates.push({ id: task.id, fields: { [pAdapter.getEventIdColumn()]: null } });
              ledgerUpdates.push({ id: ledger.id, fields: { status: 'deleted_local', provider_event_id: null } });
              pStats.deleted_local++;
              stats.deleted_local++;
              continue;
            }
          }

          // --- Terminal status handling (done/cancel/skip/pause) ---
          if (task && event && ledger.origin === 'juggler' && calCompletedBehavior !== 'keep' && !isIngestOnly(pid)) {
            var isTerminal = task.status === 'done' || task.status === 'cancel' || task.status === 'skip' || task.status === 'pause';
            if (isTerminal) {
              var shouldDelete = calCompletedBehavior === 'delete' || task.status !== 'done';
              if (shouldDelete) {
                try {
                  await pAdapter.deleteEvent(pToken, event._url || ledger.provider_event_id);
                  await throttle();
                } catch (e4) {
                  if (!e4.message.includes('404') && !e4.message.includes('410')) throw e4;
                }
                taskUpdates.push({ id: task.id, fields: { [pAdapter.getEventIdColumn()]: null } });
                ledgerUpdates.push({ id: ledger.id, fields: { status: 'deleted_local', provider_event_id: null } });
                pStats.deleted_local++;
                stats.deleted_local++;
                continue;
              }
              // 'update' mode for done tasks: fall through to regular push so ✓ prefix + transparency propagate
            }
          }

          // --- Both exist ---
          if (task && event) {
            var isRecurringTemplate = task.taskType === 'recurring_template';
            if (isRecurringTemplate) {
              // Templates should never be on calendars; nothing to do here
              continue;
            }

            // Only push to events WE created (origin=juggler). Events pulled from
            // a provider (origin=pid) are read-only from Juggler's perspective —
            // we don't own them, can't PATCH them, and shouldn't try.
            if (ledger.origin === 'juggler' && !isIngestOnly(pid)) {
              // Followers in a merged-chunks run: skip the PATCH — their
              // event is queued for delete in Phase 3's splitDeleteQueue,
              // so patching it first wastes an API call. We also clear
              // last_pushed_hash later via the deleted_local transition.
              if (mergedFollowers[task.id]) {
                pStats.skipped = (pStats.skipped || 0) + 1;
                stats.skipped = (stats.skipped || 0) + 1;
              } else {
                // Hash-based skip: push only when the task's push-relevant fields
                // actually differ from what the ledger says we last sent. With
                // 200+ active tasks per user, the old "every sync, every task"
                // PATCH loop burned through GCal's 600/min quota on every sync —
                // and masked real errors behind rate-limit 403s. taskHash covers
                // text/date/time/dur/status/when/project/marker (see
                // cal-sync-helpers.js). On push success the new hash is written
                // to last_pushed_hash (below); on failure we leave the old hash
                // in place so the next sync retries.
                var newHash = taskHash(task);
                var taskChanged = (newHash !== ledger.last_pushed_hash);

                // Detect whether the user edited the event on the calendar side.
                // Compares event.lastModified against ledger.last_modified_at (the
                // value we recorded on the previous sync). If the event is newer by
                // more than 1s AND the task itself hasn't changed, the edit must have
                // come from the calendar.
                var eventModifiedExternally = false;
                if (event.lastModified && ledger.last_modified_at) {
                  var evModMs = new Date(event.lastModified).getTime();
                  var recordedModMs = new Date(String(ledger.last_modified_at).replace(' ', 'T') + 'Z').getTime();
                  if (!isNaN(evModMs) && !isNaN(recordedModMs)) {
                    eventModifiedExternally = evModMs > recordedModMs;
                  }
                }

                if (taskChanged && !eventModifiedExternally) {
                  // Task changed, event stable → push (existing behaviour)
                  pendingEventUpdates.push({
                    eventId: event._url || ledger.provider_event_id,
                    task: task,
                    ledgerId: ledger.id,
                    newHash: newHash
                  });
                  pStats.pushed++;
                  stats.pushed++;
                } else if (taskChanged && eventModifiedExternally) {
                  // Both changed — conflict resolution
                  var isFixed = (task.when || '').indexOf('fixed') >= 0 || task.rigid;
                  if (isFixed) {
                    // Fixed tasks always win → push, log conflict
                    pendingEventUpdates.push({
                      eventId: event._url || ledger.provider_event_id,
                      task: task,
                      ledgerId: ledger.id,
                      newHash: newHash
                    });
                    pStats.pushed++;
                    stats.pushed++;
                    logSyncAction(pid, 'conflict_juggler', {
                      taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                      detail: 'Conflict: fixed task pushed over calendar edit',
                      calendarName: calendarLabels[pid] || null
                    });
                  } else {
                    // Last-modified wins
                    var evModMsConflict = new Date(event.lastModified).getTime();
                    var taskModMsConflict = new Date(String(task._updated_at).replace(' ', 'T') + 'Z').getTime();
                    if (!isNaN(evModMsConflict) && !isNaN(taskModMsConflict) && evModMsConflict > taskModMsConflict) {
                      // Event newer → pull
                      var conflictPullFields = _buildPullFields(event, task, tz, pAdapter);
                      taskUpdates.push({ id: task.id, fields: conflictPullFields });
                      pStats.pulled++;
                      stats.pulled++;
                      logSyncAction(pid, 'conflict_provider', {
                        taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                        oldValues: { text: task.text, when: task.when, dur: task.dur },
                        newValues: { text: event.title, when: conflictPullFields.when || task.when, dur: event.durationMinutes },
                        detail: 'Conflict: calendar edit accepted (newer than task)',
                        calendarName: calendarLabels[pid] || null
                      });
                    } else {
                      // Task newer → push
                      pendingEventUpdates.push({
                        eventId: event._url || ledger.provider_event_id,
                        task: task,
                        ledgerId: ledger.id,
                        newHash: newHash
                      });
                      pStats.pushed++;
                      stats.pushed++;
                      logSyncAction(pid, 'conflict_juggler', {
                        taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                        detail: 'Conflict: task pushed over calendar edit (task is newer)',
                        calendarName: calendarLabels[pid] || null
                      });
                    }
                  }
                } else if (!taskChanged && eventModifiedExternally) {
                  // Event changed, task stable → pull from event to task
                  var pullFields = _buildPullFields(event, task, tz, pAdapter);
                  // Backward dependency check: warn if task is moved to before a task it depends on
                  var backwardDepWarning = '';
                  if (pullFields.scheduled_at && Array.isArray(task.dependsOn) && task.dependsOn.length > 0) {
                    var newScheduledMs = new Date(pullFields.scheduled_at).getTime();
                    for (var bdi = 0; bdi < task.dependsOn.length; bdi++) {
                      var depId = task.dependsOn[bdi];
                      var depTask = tasksById[depId];
                      if (depTask && depTask._scheduled_at) {
                        var depMs = new Date(depTask._scheduled_at).getTime();
                        if (newScheduledMs < depMs) {
                          backwardDepWarning = 'Task promoted to before dependency ' + depId;
                          break;
                        }
                      }
                    }
                  }
                  taskUpdates.push({ id: task.id, fields: pullFields });
                  pStats.pulled++;
                  stats.pulled++;
                  var isPromotion = pullFields.when === 'fixed';
                  logSyncAction(pid, isPromotion ? 'promoted' : 'pulled', {
                    taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                    oldValues: { when: task.when, scheduled_at: task._scheduled_at, dur: task.dur },
                    newValues: { when: pullFields.when || task.when, scheduled_at: pullFields.scheduled_at, dur: pullFields.dur },
                    detail: (isPromotion ? 'Event moved on calendar — task promoted to fixed' : 'Event edited on calendar — task updated') + (backwardDepWarning ? '. WARNING: ' + backwardDepWarning : ''),
                    calendarName: calendarLabels[pid] || null
                  });
                } else {
                  // Neither changed → skip (existing behaviour)
                  pStats.skipped = (pStats.skipped || 0) + 1;
                  stats.skipped = (stats.skipped || 0) + 1;
                }
              }
            } else if (isIngestOnly(pid)) {
              // Ingest-only: pull event changes into the task. Tasks created from
              // ingest-only events are when='fixed' by design (never scheduled by
              // Juggler), so we overwrite task fields from the event every sync.
              var updateFields = pAdapter.applyEventToTaskFields(event, tz, task);
              updateFields.when = 'fixed';
              taskUpdates.push({ id: task.id, fields: updateFields });
              pStats.pulled++;
              stats.pulled++;
            }
            // else: origin=provider in full-sync mode — we don't push, we don't pull,
            // the ledger just exists to track that this task is linked to that event.

            // Update ledger cached fields
            ledgerUpdates.push({ id: ledger.id, fields: {
              event_summary: event.title || task.text,
              event_start: event.startDateTime || null,
              event_end: event.endDateTime || null,
              event_all_day: event.isAllDay ? 1 : 0,
              last_modified_at: toMySQLDate(event.lastModified),
              task_updated_at: task._updated_at || null,
              miss_count: 0
            }});

          } else if (task && !event) {
            // Event not found in provider's calendarView response.
            // This could mean the event was genuinely deleted, OR the API
            // transiently failed to return it. Use miss_count to avoid
            // data loss from transient failures.
            // If the provider had a partial failure (e.g. one Apple calendar
            // couldn't be fetched), skip miss-count entirely to avoid
            // deleting tasks due to incomplete event data.
            if (pd.partialFailure) {
              // Do nothing — keep task alive until next clean sync
            } else if (ledger.provider_event_id) {
              // Skip miss entirely if the event was pushed recently — CDN propagation
              // delay (especially Apple CalDAV) can make a freshly-written event
              // invisible for 60–120s. withinCdnGrace checks last_pushed_at against
              // the per-provider grace window; miss_count is not incremented.
              if (withinCdnGrace(ledger, pid)) {
                // CDN propagation window — treat as not-yet-visible, not missing
              } else if (ledger.origin === 'juggler'
                  && ledger.last_user_hash !== null
                  && userHash(task) !== ledger.last_user_hash
                  && (ledger.miss_count || 0) >= 1) {
                // User-editable content changed AND event is gone after at least one miss —
                // the event link is broken. Re-create.
                // Guarded on last_user_hash !== null: legacy rows (no stored user hash) fall
                // through to the normal deletion ladder rather than triggering a spurious repush.
                tasksNeedingReCreate.add(task.id);
                processedTaskIds.delete(task.id);
                ledgerUpdates.push({ id: ledger.id, fields: {
                  status: 'replaced', task_id: null, provider_event_id: null, miss_count: 0
                }});
                logSyncAction(pid, 'repush', {
                  taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                  detail: pid + ' event gone but juggler task content changed — will re-create',
                  calendarName: calendarLabels[pid] || null
                });
              } else if (ledger.origin === 'juggler'
                  && taskHash(task) !== ledger.last_pushed_hash
                  && (ledger.miss_count || 0) === 0) {
                // First miss only: task changed (possibly scheduler timing update) on the same
                // sync the event went missing. Wait one more cycle before acting — could be CDN lag.
                ledgerUpdates.push({ id: ledger.id, fields: { miss_count: 1 } });
              } else {
                var cachedStart = ledger.event_start;
                var eventInWindow = false;
                if (cachedStart) {
                  var cachedDate = new Date(cachedStart);
                  eventInWindow = cachedDate >= windowStart && cachedDate <= windowEnd;
                }
                if (eventInWindow) {
                  var newMissCount = (ledger.miss_count || 0) + 1;
                  if (newMissCount >= MISS_THRESHOLD) {
                    // Confirmed missing after multiple syncs — delete the task.
                    // Pre-compute dependency transfers from in-memory data so the
                    // write phase can apply them without querying.
                    var deletedDeps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
                    var depTransfers = [];
                    for (var ai2 = 0; ai2 < allTasks.length; ai2++) {
                      var a = allTasks[ai2];
                      var aDeps = Array.isArray(a.dependsOn) ? a.dependsOn : [];
                      if (aDeps.indexOf(task.id) >= 0) {
                        var newDeps = aDeps.filter(function(d) { return d !== task.id; });
                        deletedDeps.forEach(function(d) { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
                        depTransfers.push({ id: a.id, newDepsJson: JSON.stringify(newDeps) });
                      }
                    }
                    taskDeletes.push({ id: task.id, dependencyTransfers: depTransfers });
                    ledgerUpdates.push({ id: ledger.id, fields: {
                      status: 'deleted_remote', task_id: null, miss_count: newMissCount
                    }});
                    pStats.deleted_remote++;
                    stats.deleted_remote++;
                    logSyncAction(pid, 'deleted_remote', {
                      taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                      detail: 'Event deleted in ' + pid + ' — task removed after ' + MISS_THRESHOLD + ' consecutive syncs',
                      calendarName: calendarLabels[pid] || null
                    });
                  } else {
                    // Not yet confirmed — increment miss counter, keep task alive
                    ledgerUpdates.push({ id: ledger.id, fields: { miss_count: newMissCount } });
                  }
                }
              }
            }

          } else if (!task && event) {
            // Task deleted from Juggler — delete from provider (skip in ingest-only)
            if (!isIngestOnly(pid)) {
              try {
                await pAdapter.deleteEvent(pToken, event._url || ledger.provider_event_id);
                await throttle();
              } catch (e) {
                if (!e.message.includes('404') && !e.message.includes('410')) throw e;
              }
              ledgerUpdates.push({ id: ledger.id, fields: { status: 'deleted_local', provider_event_id: null } });
              pStats.deleted_local++;
              stats.deleted_local++;
              logSyncAction(pid, 'deleted_local', {
                taskId: ledger.task_id, taskText: ledger.event_summary, eventId: ledger.provider_event_id,
                detail: 'Task deleted in Juggler — event removed from ' + pid,
                calendarName: calendarLabels[pid] || null
              });
            }

          } else {
            // Both gone
            ledgerUpdates.push({ id: ledger.id, fields: { status: 'deleted_local', provider_event_id: null } });
          }

        } catch (e) {
          console.error('[CAL-SYNC] Ledger sync error for ' + pid + ':', e);
          var errObj = {
            phase: 'ledger', provider: pid,
            ledgerId: ledger.id, taskId: ledger.task_id,
            eventId: ledger.provider_event_id, error: e.message
          };
          pStats.errors.push(errObj);
          stats.errors.push(errObj);
          var taskTitle = task ? task.text : ledger.event_summary;
          logSyncAction(pid, 'error', {
            taskId: ledger.task_id, taskText: taskTitle,
            eventId: ledger.provider_event_id,
            detail: 'Error in ledger sync: ' + e.message,
            calendarName: calendarLabels[pid] || null,
            errorDetail: buildErrorDetail(e, {
              provider: pid,
              calendar: calendarLabels[pid] || null,
              operation: 'update event',
              affectedTasks: taskTitle ? [{ id: ledger.task_id, title: taskTitle }] : []
            })
          });
        }
      }

      // Flush batched event updates for this provider. On each success the
      // new last_pushed_hash gets queued so the next sync skips the PATCH if
      // the task still matches.
      function recordPushSuccess(upd) {
        if (upd && upd.ledgerId && upd.newHash) {
          ledgerUpdates.push({ id: upd.ledgerId, fields: {
            last_pushed_hash: upd.newHash,
            last_user_hash: upd.task ? userHash(upd.task) : null,
            last_pushed_at: db.fn.now(),
            // +30s: provider server timestamps often lag our push by several seconds
            // (Apple CalDAV is especially slow). Using +2s caused false
            // eventModifiedExternally detections on the following sync.
            last_modified_at: toMySQLDate(new Date(Date.now() + 30000).toISOString())
          }});
        }
      }
      if (pendingEventUpdates.length > 0) {
        if (pAdapter.batchUpdateEvents) {
          try {
            var batchUpdateResults = await pAdapter.batchUpdateEvents(pToken, pendingEventUpdates, year, tz);
            var failedUpdates = [];
            for (var bui = 0; bui < batchUpdateResults.length; bui++) {
              if (batchUpdateResults[bui].error) {
                failedUpdates.push(pendingEventUpdates[bui]);
              } else {
                recordPushSuccess(pendingEventUpdates[bui]);
              }
            }
            // Retry failed batch update items sequentially (single attempt)
            if (failedUpdates.length > 0) {
              console.log('[CAL-SYNC] Retrying ' + failedUpdates.length + ' failed batch updates sequentially for ' + pid);
              for (var rui = 0; rui < failedUpdates.length; rui++) {
                try {
                  await callWithRateLimit(pid, function() { return pAdapter.updateEvent(pToken, failedUpdates[rui].eventId, failedUpdates[rui].task, year, tz); });
                  recordPushSuccess(failedUpdates[rui]);
                  await throttle();
                } catch (ruErr) {
                  pStats.errors.push({ phase: 'ledger_update', provider: pid, eventId: failedUpdates[rui].eventId, error: ruErr.message });
                  stats.errors.push({ phase: 'ledger_update', provider: pid, eventId: failedUpdates[rui].eventId, error: ruErr.message });
                  logSyncAction(pid, 'error', {
                    taskId: failedUpdates[rui].task && failedUpdates[rui].task.id || null,
                    taskText: failedUpdates[rui].task && failedUpdates[rui].task.text || null,
                    eventId: failedUpdates[rui].eventId,
                    detail: 'Retry failed: ' + ruErr.message,
                    calendarName: calendarLabels[pid] || null,
                    errorDetail: buildErrorDetail(ruErr, {
                      provider: pid,
                      calendar: calendarLabels[pid] || null,
                      operation: 'update event',
                      affectedTasks: failedUpdates[rui].task ? [{ id: failedUpdates[rui].task.id, title: failedUpdates[rui].task.text }] : []
                    })
                  });
                }
              }
            }
          } catch (batchUpdateErr) {
            // Fallback to sequential updates
            console.error('[CAL-SYNC] Batch update failed for ' + pid + ', falling back to sequential:', batchUpdateErr.message);
            for (var fui = 0; fui < pendingEventUpdates.length; fui++) {
              try {
                await callWithRateLimit(pid, function() { return pAdapter.updateEvent(pToken, pendingEventUpdates[fui].eventId, pendingEventUpdates[fui].task, year, tz); });
                recordPushSuccess(pendingEventUpdates[fui]);
                await throttle();
              } catch (e5) {
                pStats.errors.push({ phase: 'ledger_update', provider: pid, eventId: pendingEventUpdates[fui].eventId, error: e5.message });
                stats.errors.push({ phase: 'ledger_update', provider: pid, eventId: pendingEventUpdates[fui].eventId, error: e5.message });
                logSyncAction(pid, 'error', {
                  taskId: pendingEventUpdates[fui].task && pendingEventUpdates[fui].task.id || null,
                  taskText: pendingEventUpdates[fui].task && pendingEventUpdates[fui].task.text || null,
                  eventId: pendingEventUpdates[fui].eventId,
                  detail: 'Fallback sequential update failed: ' + e5.message,
                  calendarName: calendarLabels[pid] || null,
                  errorDetail: buildErrorDetail(e5, {
                    provider: pid,
                    calendar: calendarLabels[pid] || null,
                    operation: 'update event',
                    affectedTasks: pendingEventUpdates[fui].task ? [{ id: pendingEventUpdates[fui].task.id, title: pendingEventUpdates[fui].task.text }] : []
                  })
                });
              }
            }
          }
        } else {
          // Provider doesn't support batch updates (e.g., Apple CalDAV) — sequential
          for (var sui = 0; sui < pendingEventUpdates.length; sui++) {
            try {
              await pAdapter.updateEvent(pToken, pendingEventUpdates[sui].eventId, pendingEventUpdates[sui].task, year, tz);
              recordPushSuccess(pendingEventUpdates[sui]);
              await throttle();
            } catch (e6) {
              pStats.errors.push({ phase: 'ledger_update', provider: pid, eventId: pendingEventUpdates[sui].eventId, error: e6.message });
              stats.errors.push({ phase: 'ledger_update', provider: pid, eventId: pendingEventUpdates[sui].eventId, error: e6.message });
              logSyncAction(pid, 'error', {
                taskId: pendingEventUpdates[sui].task && pendingEventUpdates[sui].task.id || null,
                taskText: pendingEventUpdates[sui].task && pendingEventUpdates[sui].task.text || null,
                eventId: pendingEventUpdates[sui].eventId,
                detail: 'Sequential update failed: ' + e6.message,
                calendarName: calendarLabels[pid] || null,
                errorDetail: buildErrorDetail(e6, {
                  provider: pid,
                  calendar: calendarLabels[pid] || null,
                  operation: 'update event',
                  affectedTasks: pendingEventUpdates[sui].task ? [{ id: pendingEventUpdates[sui].task.id, title: pendingEventUpdates[sui].task.text }] : []
                })
              });
            }
          }
        }
      }
    }

    // === Phase 3: Push new tasks to providers (skip for ingest-only) ===
    // Load task IDs with error ledger records so we skip them in push.
    // A manual sync clears error records to allow fresh retries.
    var errorLedgerTaskIds = new Set();
    var errorLedgerRows = await db('cal_sync_ledger')
      .where('user_id', userId)
      .where('status', 'error')
      .select('task_id', 'id');
    // Clear error records so this manual sync can retry them
    if (errorLedgerRows.length > 0) {
      var errorLedgerIds = errorLedgerRows.map(function(r) { return r.id; });
      await db('cal_sync_ledger').whereIn('id', errorLedgerIds).del();
      console.log('[CAL-SYNC] Cleared ' + errorLedgerIds.length + ' error ledger records for retry');
    }

    for (var pi2 = 0; pi2 < providerIds.length; pi2++) {
      var pid2 = providerIds[pi2];
      emitProgress('push', 'Syncing tasks...', 50 + (pi2 * 5), { provider: pid2, calendar: calendarLabels[pid2] || null });
      var pd2 = providerData[pid2];
      var pAdapter2 = pd2.adapter;
      var pToken2 = pd2.token;
      var pEventsById2 = pd2.eventsById;
      var pStats2 = stats.providers[pid2];
      var processedTaskIds2 = processedTaskIdsByProvider[pid2];
      var processedEventIds2 = processedEventIdsByProvider[pid2];
      var eventIdCol = pAdapter2.getEventIdColumn();

      // 3a: Push — skip entirely for ingest-only providers
      if (isIngestOnly(pid2)) {
        console.log('[CAL-SYNC] skipping push phase for ' + pid2 + ' (ingest-only mode)');
      } else {

      // Build set of task IDs that already have active ledger records for this provider
      // (defense against duplicate pushes when event_id column is stale)
      var ledgeredTaskIds2 = new Set();
      var pLedger2 = ledgerByProvider[pid2] || [];
      for (var li2 = 0; li2 < pLedger2.length; li2++) {
        if (pLedger2[li2].status === 'active' && pLedger2[li2].task_id && !tasksNeedingReCreate.has(pLedger2[li2].task_id)) {
          ledgeredTaskIds2.add(pLedger2[li2].task_id);
        }
      }

      // 3a: Push unledgered tasks to this provider (batch)
      // Collect eligible tasks first, then batch-create in one shot
      // Before building the push queue, handle split tasks that have a non-split
      // ledger entry from a previous sync — delete the old event so split parts
      // can replace it.
      // Replace non-split ledger entries with split parts.
      // Must clear: ledger, task event_id (DB + in-memory), processedTaskIds.
      var splitDeleteQueue = [];
      var splitReplacedIds = new Set();

      // Merged-follower cleanup. Each chunk that got absorbed into a
      // contiguous run (by the mergeContiguousSplitChunks pass above)
      // should have its own GCal event removed and its ledger row marked
      // deleted_local — the leader's expanded event now covers its time
      // slot. If the follower had no active ledger yet (new merge before
      // that chunk ever synced on its own), there's nothing to delete.
      Object.keys(mergedFollowers).forEach(function(followerId) {
        var row = (ledgerByProvider[pid2] || []).find(function(l) {
          return l.task_id === followerId && l.status === 'active';
        });
        if (!row) return;
        if (row.provider_event_id) splitDeleteQueue.push(row.provider_event_id);
        ledgerUpdates.push({ id: row.id, fields: { status: 'deleted_local' } });
        ledgeredTaskIds2.delete(followerId);
      });

      for (var si = 0; si < allTasks.length; si++) {
        var sTask = allTasks[si];
        var sSplits = splitPlacements[sTask.id];
        if (!sSplits || sSplits.length <= 1) continue;
        // Has split placements — check if there's a NON-split ledger entry
        var hasNonSplitLedger = ledgeredTaskIds2.has(sTask.id);
        var hasEventId = !!(sTask[(eventIdCol === 'gcal_event_id' ? 'gcalEventId' : eventIdCol === 'msft_event_id' ? 'msftEventId' : 'appleEventId')]);
        if (hasNonSplitLedger || hasEventId) {
          if (hasNonSplitLedger) {
            var oldLedger = (ledgerByProvider[pid2] || []).find(function(l) { return l.task_id === sTask.id; });
            if (oldLedger && oldLedger.provider_event_id) {
              splitDeleteQueue.push(oldLedger.provider_event_id);
              ledgerUpdates.push({ id: oldLedger.id, fields: { status: 'deleted_local' } });
            }
          }
          // Clear task event_id in-memory (DB write deferred to write phase)
          taskUpdates.push({ id: sTask.id, fields: { [eventIdCol]: null } });
          sTask[(eventIdCol === 'gcal_event_id' ? 'gcalEventId' : eventIdCol === 'msft_event_id' ? 'msftEventId' : 'appleEventId')] = null;
          // Unblock from all skip checks
          ledgeredTaskIds2.delete(sTask.id);
          processedTaskIds2.delete(sTask.id);
          splitReplacedIds.add(sTask.id);
        }
      }
      if (splitDeleteQueue.length > 0 && pAdapter2.batchDeleteEvents) {
        await pAdapter2.batchDeleteEvents(pToken2, splitDeleteQueue);
      } else {
        for (var sdi = 0; sdi < splitDeleteQueue.length; sdi++) {
          try { await pAdapter2.deleteEvent(pToken2, splitDeleteQueue[sdi]); } catch (e3) { console.warn('[CAL-SYNC] splitDelete failed (ignored):', e3.message); }
        }
      }

      var pushQueue = [];
      for (var ti2 = 0; ti2 < allTasks.length; ti2++) {
        var newTask = allTasks[ti2];
        if (processedTaskIds2.has(newTask.id)) continue;
        if (ledgeredTaskIds2.has(newTask.id)) continue;
        // Followers in a merged-chunks run: their time slot is covered
        // by the leader's expanded event; don't push a separate event.
        if (mergedFollowers[newTask.id]) continue;

        var taskStatus = newTask.status || '';
        if (taskStatus === 'done' || taskStatus === 'cancel' || taskStatus === 'skip' || taskStatus === 'pause' || taskStatus === 'disabled') continue;

        if (newTask.taskType === 'recurring_template') continue;
        if (!newTask.date) continue;
        if (!newTask.time && newTask.when !== 'allday') continue;

        // Skip tasks with existing event IDs — unless they were just cleared for split replacement
        var existingEvId = newTask[(eventIdCol === 'gcal_event_id' ? 'gcalEventId' : eventIdCol === 'msft_event_id' ? 'msftEventId' : 'appleEventId')];
        if (existingEvId && !splitReplacedIds.has(newTask.id)) continue;

        var taskSA = newTask._scheduled_at instanceof Date ? newTask._scheduled_at : new Date(String(newTask._scheduled_at).replace(' ', 'T') + 'Z');
        if (taskSA < todayStart) continue;
        if (taskSA > windowEnd) continue;

        // Split tasks: create one calendar event per split placement.
        // When splitTotal > 1 the task IS a real chunk row — Path A (merge
        // pass) already set the right dur and title suffix, so push it as-is.
        // Only fall into the synthetic-ID expansion for old-style cache-only
        // splits where the task itself has no split_total.
        var splits = splitPlacements[newTask.id];
        if (splits && splits.length > 1 && !(Number(newTask.splitTotal) > 1)) {
          var anySplitLedgered = splits.some(function(sp) {
            return ledgeredTaskIds2.has(newTask.id + '_part' + sp.splitPart);
          });
          if (!anySplitLedgered) {
            splits.forEach(function(sp) {
              var hh = Math.floor(sp.start / 60), mm = sp.start % 60;
              var ampm = hh >= 12 ? 'PM' : 'AM';
              var dh = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
              var splitTime = dh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
              var splitTask = Object.assign({}, newTask, {
                id: newTask.id + '_part' + sp.splitPart,
                _originalId: newTask.id,
                date: sp.dateKey,
                time: splitTime,
                dur: sp.dur,
                text: (newTask.text || '') + ' (part ' + sp.splitPart + '/' + sp.splitTotal + ')',
                _scheduled_at: sp.scheduledAtUtc || newTask._scheduled_at
              });
              pushQueue.push({ task: splitTask });
            });
          }
        } else {
          pushQueue.push({ task: newTask });
        }
      }

      // Batch create if adapter supports it, otherwise fall back to sequential
      if (pushQueue.length > 0 && pAdapter2.batchCreateEvents) {
        var provLabel = PROVIDER_NAMES[pid2] || pid2;
        emitProgress('push', 'Pushing ' + pushQueue.length + ' tasks...', 50 + (pi2 * 20), { provider: pid2, calendar: calendarLabels[pid2] || null });
        try {
          var batchResults = await pAdapter2.batchCreateEvents(pToken2, pushQueue, year, tz);
          // Collect successful results into mutation buffers
          var batchPushCount = 0;
          for (var bi = 0; bi < batchResults.length; bi++) {
            var br = batchResults[bi];
            var bTask = pushQueue[bi].task;
            if (br.error) {
              pStats2.errors.push({ phase: 'push_new', provider: pid2, taskId: bTask.id, error: br.error });
              stats.errors.push({ phase: 'push_new', provider: pid2, taskId: bTask.id, error: br.error });
              logSyncAction(pid2, 'error', {
                taskId: bTask.id,
                taskText: bTask.text || null,
                detail: 'Push new event failed: ' + br.error,
                calendarName: calendarLabels[pid2] || null,
                errorDetail: buildErrorDetail(br.error, {
                  provider: pid2,
                  calendar: calendarLabels[pid2] || null,
                  operation: 'push new event',
                  affectedTasks: [{ id: bTask.id, title: bTask.text }]
                })
              });
              continue;
            }
            var createdNorm = pAdapter2.normalizeEvent ? pAdapter2.normalizeEvent(br.raw) : null;
            processedEventIds2.add(br.providerEventId);
            processedTaskIds2.add(br.taskId);
            if (bTask._originalId) processedTaskIds2.add(bTask._originalId);
            pStats2.pushed++;
            stats.pushed++;
            batchPushCount++;

            if (!bTask._originalId) {
              taskUpdates.push({ id: br.taskId, fields: { [eventIdCol]: br.providerEventId } });
            }
            ledgerInserts.push({
              user_id: userId, provider: pid2, task_id: br.taskId,
              provider_event_id: br.providerEventId, origin: 'juggler',
              last_pushed_hash: taskHash(bTask),
              last_user_hash: userHash(bTask),
              last_pulled_hash: createdNorm ? pAdapter2.eventHash(createdNorm) : null,
              event_summary: bTask.text,
              event_start: createdNorm ? createdNorm.startDateTime : null,
              event_end: createdNorm ? createdNorm.endDateTime : null,
              event_all_day: (bTask.when === 'allday') ? 1 : 0,
              task_updated_at: bTask._updated_at || null,
              last_modified_at: toMySQLDate(createdNorm && createdNorm.lastModified ? new Date(new Date(createdNorm.lastModified).getTime() + 2000).toISOString() : new Date().toISOString()),
              status: 'active'
            });
          }
          // Retry failed batch items sequentially (single attempt)
          var failedItems = [];
          for (var fbi = 0; fbi < batchResults.length; fbi++) {
            if (batchResults[fbi].error) failedItems.push(pushQueue[fbi]);
          }
          if (failedItems.length > 0) {
            console.log('[CAL-SYNC] Retrying ' + failedItems.length + ' failed batch items sequentially for ' + pid2);
            for (var ri = 0; ri < failedItems.length; ri++) {
              var rTask = failedItems[ri].task;
              try {
                var rResult = await callWithRateLimit(pid2, function() { return pAdapter2.createEvent(pToken2, rTask, year, tz); });
                await throttle();
                var rNorm = pAdapter2.normalizeEvent ? pAdapter2.normalizeEvent(rResult.raw) : null;
                processedEventIds2.add(rResult.providerEventId);
                processedTaskIds2.add(rResult.taskId || rTask.id);
                if (rTask._originalId) processedTaskIds2.add(rTask._originalId);
                pStats2.pushed++;
                stats.pushed++;
                batchPushCount++;
                if (!rTask._originalId) {
                  taskUpdates.push({ id: rTask.id, fields: { [eventIdCol]: rResult.providerEventId } });
                }
                ledgerInserts.push({
                  user_id: userId, provider: pid2, task_id: rTask.id,
                  provider_event_id: rResult.providerEventId, origin: 'juggler',
                  last_pushed_hash: taskHash(rTask),
                  last_user_hash: userHash(rTask),
                  last_pulled_hash: rNorm ? pAdapter2.eventHash(rNorm) : null,
                  event_summary: rTask.text,
                  event_start: rNorm ? rNorm.startDateTime : null,
                  event_end: rNorm ? rNorm.endDateTime : null,
                  event_all_day: (rTask.when === 'allday') ? 1 : 0,
                  task_updated_at: rTask._updated_at || null,
                  last_modified_at: toMySQLDate(rNorm && rNorm.lastModified ? new Date(new Date(rNorm.lastModified).getTime() + 2000).toISOString() : new Date().toISOString()),
                  status: 'active'
                });
              } catch (rErr) {
                // Persistent failure — insert error ledger record so task is skipped next sync
                console.warn('[CAL-SYNC] Retry failed for task ' + rTask.id + ' on ' + pid2 + ': ' + rErr.message);
                var rErrDetail = buildErrorDetail(rErr, {
                  provider: pid2,
                  calendar: calendarLabels[pid2] || null,
                  operation: 'push task to calendar',
                  affectedTasks: [{ id: rTask.id, title: rTask.text }]
                });
                ledgerInserts.push({
                  user_id: userId, provider: pid2, task_id: rTask.id,
                  provider_event_id: null, origin: 'juggler',
                  last_pushed_hash: taskHash(rTask),
                  last_user_hash: userHash(rTask),
                  event_summary: rTask.text,
                  status: 'error',
                  error_detail: rErr.message.substring(0, 1000)
                });
                logSyncAction(pid2, 'error', {
                  taskId: rTask.id, taskText: rTask.text,
                  detail: 'Push failed: ' + rErr.message,
                  calendarName: calendarLabels[pid2] || null,
                  errorDetail: rErrDetail
                });
              }
            }
          }
          if (batchPushCount > 0) {
            logSyncAction(pid2, 'pushed', {
              detail: 'Batch pushed ' + batchPushCount + ' tasks to ' + pid2,
              calendarName: calendarLabels[pid2] || null
            });
          }
        } catch (batchErr) {
          // Batch endpoint failed entirely — fall back to sequential
          console.error('[CAL-SYNC] Batch create failed for ' + pid2 + ', falling back to sequential:', batchErr.message);
          for (var fi = 0; fi < pushQueue.length; fi++) {
            var fTask = pushQueue[fi].task;
            try {
              var result = await callWithRateLimit(pid2, function() { return pAdapter2.createEvent(pToken2, fTask, year, tz); });
              await throttle();
              var fNorm = pAdapter2.normalizeEvent ? pAdapter2.normalizeEvent(result.raw) : null;
              taskUpdates.push({ id: fTask.id, fields: { [eventIdCol]: result.providerEventId } });
              ledgerInserts.push({
                user_id: userId, provider: pid2, task_id: fTask.id,
                provider_event_id: result.providerEventId, origin: 'juggler',
                last_pushed_hash: taskHash(fTask),
                last_user_hash: userHash(fTask),
                last_pulled_hash: fNorm ? pAdapter2.eventHash(fNorm) : null,
                event_summary: fTask.text,
                event_start: fNorm ? fNorm.startDateTime : null,
                event_end: fNorm ? fNorm.endDateTime : null,
                event_all_day: (fTask.when === 'allday') ? 1 : 0,
                task_updated_at: fTask._updated_at || null,
                last_modified_at: toMySQLDate(fNorm && fNorm.lastModified ? new Date(new Date(fNorm.lastModified).getTime() + 2000).toISOString() : new Date().toISOString()),
                status: 'active'
              });
              processedEventIds2.add(result.providerEventId);
              processedTaskIds2.add(fTask.id);
              pStats2.pushed++;
              stats.pushed++;
            } catch (e) {
              pStats2.errors.push({ phase: 'push_new', provider: pid2, taskId: fTask.id, error: e.message });
              stats.errors.push({ phase: 'push_new', provider: pid2, taskId: fTask.id, error: e.message });
              logSyncAction(pid2, 'error', {
                taskId: fTask.id, taskText: fTask.text,
                detail: 'Push failed: ' + e.message,
                calendarName: calendarLabels[pid2] || null,
                errorDetail: buildErrorDetail(e, {
                  provider: pid2,
                  calendar: calendarLabels[pid2] || null,
                  operation: 'push task to calendar',
                  affectedTasks: [{ id: fTask.id, title: fTask.text }]
                })
              });
            }
          }
        }
      }
      } // end of !isIngestOnly push block

      // 3b: Pull unledgered events from this provider
      //
      // Build a set of event IDs that already have ANY ledger entry (including
      // deleted ones) to prevent the orphan-pull-delete loop: previously, a
      // past event whose ledger was marked deleted_local would be re-pulled as
      // "unledgered", creating a new active entry, which the next sync would
      // try to delete again — ad infinitum.
      var existingLedgerEventIds = new Set();
      var allLedgerForProvider = await db('cal_sync_ledger')
        .where('user_id', userId)
        .where('provider', pid2)
        .whereNotNull('provider_event_id')
        .select('provider_event_id');
      for (var ali = 0; ali < allLedgerForProvider.length; ali++) {
        existingLedgerEventIds.add(allLedgerForProvider[ali].provider_event_id);
      }

      var eventIds = Object.keys(pEventsById2);
      for (var ei2 = 0; ei2 < eventIds.length; ei2++) {
        var evId = eventIds[ei2];
        if (processedEventIds2.has(evId)) continue;

        // Skip events that already have a ledger entry (active or deleted)
        if (existingLedgerEventIds.has(evId)) continue;

        var newEvent = pEventsById2[evId];

        // Check if already linked to a task via the event ID column
        var existingTask = allTasks.find(function(t) {
          return t[(eventIdCol === 'gcal_event_id' ? 'gcalEventId' : eventIdCol === 'msft_event_id' ? 'msftEventId' : 'appleEventId')] === evId;
        });
        if (existingTask) {
          var origin = existingTask.id.startsWith(pid2 + '_') ? pid2 : 'juggler';
          ledgerInserts.push({
            user_id: userId,
            provider: pid2,
            task_id: existingTask.id,
            provider_event_id: evId,
            origin: origin,
            last_pushed_hash: taskHash(existingTask),
            last_user_hash: userHash(existingTask),
            last_pulled_hash: pAdapter2.eventHash(newEvent),
            event_summary: newEvent.title || existingTask.text,
            event_start: newEvent.startDateTime || null,
            event_end: newEvent.endDateTime || null,
            event_all_day: newEvent.isAllDay ? 1 : 0,
            last_modified_at: toMySQLDate(newEvent.lastModified),
            task_updated_at: existingTask._updated_at || null,
            status: 'active'
          });
          continue;
        }

        // Check if event is in the past
        var evStartStr = newEvent.startDateTime;
        var isPast = false;
        if (evStartStr) {
          var evDate = new Date(evStartStr);
          isPast = evDate < todayStart;
        }

        if (isPast) {
          ledgerInserts.push({
            user_id: userId,
            provider: pid2,
            task_id: null,
            provider_event_id: evId,
            origin: pid2,
            last_pushed_hash: null,
            last_user_hash: null,
            last_pulled_hash: pAdapter2.eventHash(newEvent),
            event_summary: newEvent.title,
            event_start: newEvent.startDateTime || null,
            event_end: newEvent.endDateTime || null,
            event_all_day: newEvent.isAllDay ? 1 : 0,
            last_modified_at: toMySQLDate(newEvent.lastModified),
            status: 'active'
          });
          continue;
        }

        // Skip events that originated from Juggler (round-trip prevention)
        // Check both plain text and raw body (Microsoft may return HTML-wrapped content)
        // Also check HTML-encoded '&amp;' variant because Graph API returns HTML by default
        var evDesc = newEvent.description || '';
        var evRawBody = (newEvent._raw && newEvent._raw.body && newEvent._raw.body.content) || '';
        var combinedBody = evDesc + ' ' + evRawBody;
        if (combinedBody.indexOf('Synced from Raike & Sons') !== -1
            || combinedBody.indexOf('Synced from Raike &amp; Sons') !== -1
            || combinedBody.indexOf('Synced from Juggler') !== -1) {
          // Try to match orphaned event back to its source task (dual-write recovery)
          var jdOrphan = isoToJugglerDate(newEvent.startDateTime, newEvent.startTimezone || tz);
          var orphanMatch = allTasks.find(function(t) {
            return t.text === newEvent.title && t.date === jdOrphan.date && !processedTaskIds2.has(t.id);
          });
          if (orphanMatch) {
            taskUpdates.push({ id: orphanMatch.id, fields: { [eventIdCol]: evId } });
            ledgerInserts.push({
              user_id: userId,
              provider: pid2,
              task_id: orphanMatch.id,
              provider_event_id: evId,
              origin: 'juggler',
              last_pushed_hash: taskHash(orphanMatch),
              last_user_hash: userHash(orphanMatch),
              last_pulled_hash: pAdapter2.eventHash(newEvent),
              event_summary: newEvent.title,
              event_start: newEvent.startDateTime || null,
              event_end: newEvent.endDateTime || null,
              event_all_day: newEvent.isAllDay ? 1 : 0,
              last_modified_at: toMySQLDate(newEvent.lastModified),
              task_updated_at: orphanMatch._updated_at || null,
              status: 'active'
            });
            processedTaskIds2.add(orphanMatch.id);
            processedEventIds2.add(evId);
            pStats2.pushed++;
            stats.pushed++;
            continue;
          }
          // No matching task — this is a stale Juggler event (e.g. from a
          // recurring instance that was regenerated with a new ID). Delete it
          // from the provider to prevent duplicates accumulating.
          try {
            // For Apple, evId is the VEVENT UID but deleteEvent needs the CalDAV URL.
            // Use _url when available; fall back to evId for GCal/MSFT.
            await pAdapter2.deleteEvent(pToken2, newEvent._url || evId);
            await throttle();
          } catch (e7) {
            if (!e7.message.includes('404') && !e7.message.includes('410')) {
              pStats2.errors.push({ phase: 'orphan_cleanup', provider: pid2, eventId: evId, error: e7.message });
            }
          }
          processedEventIds2.add(evId);
          pStats2.deleted_local++;
          stats.deleted_local++;
          logSyncAction(pid2, 'deleted_local', {
            eventId: evId, taskText: newEvent.title,
            oldValues: { startDateTime: newEvent.startDateTime },
            detail: 'Stale orphan event removed — task was rescheduled or deleted',
            calendarName: calendarLabels[pid2] || null
          });
          continue;
        }

        // Future event — create task
        try {
          var jd = isoToJugglerDate(newEvent.startDateTime, newEvent.startTimezone || tz);
          var evDur = newEvent.isAllDay ? 0 : newEvent.durationMinutes;

          // Skip if a task with same text and date already exists
          var dupTask = allTasks.find(function(t) {
            return t.text === newEvent.title && t.date === jd.date;
          });
          if (dupTask) {
            ledgerInserts.push({
              user_id: userId,
              provider: pid2,
              task_id: dupTask.id,
              provider_event_id: newEvent.id,
              origin: pid2,
              last_pushed_hash: taskHash(dupTask),
              last_user_hash: userHash(dupTask),
              last_pulled_hash: pAdapter2.eventHash(newEvent),
              event_summary: newEvent.title,
              event_start: newEvent.startDateTime || null,
              event_end: newEvent.endDateTime || null,
              event_all_day: newEvent.isAllDay ? 1 : 0,
              last_modified_at: toMySQLDate(newEvent.lastModified),
              task_updated_at: dupTask._updated_at || null,
              status: 'active'
            });
            continue;
          }

          var newTaskId = pid2 + '_' + crypto.randomBytes(8).toString('hex');

          // Compute scheduled_at
          var newScheduledAt = null;
          if (jd.date) {
            if (newEvent.isAllDay) {
              newScheduledAt = localToUtc(jd.date, '12:00 AM', tz);
            } else if (jd.time) {
              newScheduledAt = localToUtc(jd.date, jd.time, tz);
            }
          }

          var taskRow = {
            id: newTaskId,
            user_id: userId,
            text: newEvent.title,
            scheduled_at: newScheduledAt,
            dur: evDur,
            pri: 'P3',
            status: '',
            when: newEvent.isAllDay ? 'allday' : 'fixed',
            date_pinned: newEvent.isAllDay ? 0 : 1,
            placement_mode: newEvent.isTransparent ? PLACEMENT_MODES.MARKER : (newEvent.isAllDay ? PLACEMENT_MODES.FLEXIBLE : PLACEMENT_MODES.FIXED),
            [eventIdCol]: newEvent.id
          };
          if (newEvent.description) {
            taskRow.notes = newEvent.description;
          }

          var newTaskObj = rowToTask(taskRow, tz);

          taskInserts.push(taskRow);
          ledgerInserts.push({
            user_id: userId,
            provider: pid2,
            task_id: newTaskId,
            provider_event_id: newEvent.id,
            origin: pid2,
            last_pushed_hash: taskHash(newTaskObj),
            last_user_hash: userHash(newTaskObj),
            last_pulled_hash: pAdapter2.eventHash(newEvent),
            event_summary: newEvent.title,
            event_start: newEvent.startDateTime || null,
            event_end: newEvent.endDateTime || null,
            event_all_day: newEvent.isAllDay ? 1 : 0,
            last_modified_at: toMySQLDate(newEvent.lastModified),
            status: 'active'
          });

          pStats2.pulled++;
          stats.pulled++;
          logSyncAction(pid2, 'created', {
            taskId: newTaskId, taskText: newEvent.title, eventId: newEvent.id,
            detail: 'New task from ' + pid2,
            calendarName: calendarLabels[pid2] || null
          });
        } catch (e) {
          var errObj3 = { phase: 'pull_new', provider: pid2, eventId: evId, error: e.message };
          pStats2.errors.push(errObj3);
          stats.errors.push(errObj3);
          logSyncAction(pid2, 'error', {
            eventId: evId,
            detail: 'Failed to pull event: ' + e.message,
            calendarName: calendarLabels[pid2] || null,
            errorDetail: buildErrorDetail(e, {
              provider: pid2,
              calendar: calendarLabels[pid2] || null,
              operation: 'pull event',
              affectedTasks: []
            })
          });
        }
      }
    }

    // === Write Phase: Acquire lock, flush pending writes, then apply ===
    emitProgress('finalize', 'Saving changes...', 85);

    if (Date.now() - syncStart > 300000) {
      console.warn('[CAL-SYNC] Sync exceeded 5-minute timeout — aborting before write phase');
      emitProgress('done', 'Sync timed out — please try again', 100);
      return res.status(200).json(Object.assign({}, stats, { error: 'sync_timeout' }));
    }

    // Acquire per-user lock for the write phase only. During the API fetch
    // phase above, user/MCP edits flowed normally. Now we lock so the
    // scheduler doesn't start while we write.
    var MAX_LOCK_ATTEMPTS = 8;
    var lockResult = null;
    for (var lockAttempt = 0; lockAttempt < MAX_LOCK_ATTEMPTS; lockAttempt++) {
      lockResult = await acquireLock(userId);
      if (lockResult.acquired) break;
      var backoffMs = Math.min(1000 * Math.pow(1.5, lockAttempt), 10000) + Math.floor(Math.random() * 500);
      console.log('[CAL-SYNC] lock held, retry ' + (lockAttempt + 1) + '/' + MAX_LOCK_ATTEMPTS + ' in ' + backoffMs + 'ms');
      await new Promise(function(r) { setTimeout(r, backoffMs); });
    }
    if (!lockResult || !lockResult.acquired) {
      console.error('[CAL-SYNC] could not acquire lock for write phase after ' + MAX_LOCK_ATTEMPTS + ' attempts');
      sseEmitter.emit(userId, 'sync:lock_conflict', { error: 'Scheduler is busy', retryAfter: 30 });
      return res.status(409).json({ error: 'Scheduler is busy. Try again in a few seconds.', retryAfter: 30 });
    }
    var lockToken = lockResult.token;
    var lockStart = Date.now();
    var writePhaseLockLost = false;
    var lockHeartbeat = setInterval(function() {
      if (Date.now() - lockStart > 120000) {
        clearInterval(lockHeartbeat);
        writePhaseLockLost = true;
        console.warn('[CAL-SYNC] Write-phase heartbeat stopped — held over 120s, allowing expiry');
        return;
      }
      refreshLock(userId, lockToken).then(function(ok) {
        if (!ok) {
          writePhaseLockLost = true;
          clearInterval(lockHeartbeat);
          console.warn('[CAL-SYNC] Write-phase lock lost — refresh returned 0 rows');
        }
      }).catch(function(err) {
        writePhaseLockLost = true;
        clearInterval(lockHeartbeat);
        console.error('[CAL-SYNC] Write-phase lock refresh failed:', err.message);
      });
    }, 10000);

    try {

    // Flush any pending user/MCP writes so conflict detection sees fresh data
    await flushQueueInLock(userId);

    // Snapshot watermark BEFORE writing so we can detect what we touched
    var syncStartWatermark = (await db('tasks_v')
      .where('user_id', userId)
      .max('updated_at as max_ts')
      .first()) || { max_ts: null };
    var preSyncMaxUpdatedAt = syncStartWatermark.max_ts;

    // Conflict detection: if a task was modified by user/MCP during the API
    // phase, skip our update for that task to avoid clobbering their edit.
    // Runs inside lock so the data is stable.
    var conflictSkipIds = new Set();
    var taskIdsToCheck = taskUpdates.map(function(u) { return u.id; });
    if (taskIdsToCheck.length > 0) {
      var freshRows = await db('tasks_v')
        .whereIn('id', taskIdsToCheck)
        .select('id', 'updated_at');
      var freshById = {};
      freshRows.forEach(function(r) { freshById[r.id] = r.updated_at; });
      for (var ci = 0; ci < taskUpdates.length; ci++) {
        var tu = taskUpdates[ci];
        var origTask = tasksById[tu.id];
        if (origTask && freshById[tu.id]) {
          var origTime = new Date(String(origTask._updated_at).replace(' ', 'T') + 'Z').getTime();
          var freshTime = new Date(String(freshById[tu.id]).replace(' ', 'T') + 'Z').getTime();
          if (!isNaN(origTime) && !isNaN(freshTime) && freshTime > origTime) {
            conflictSkipIds.add(tu.id);
          }
        }
      }
    }

    // Abort if the lock was lost during conflict detection
    if (writePhaseLockLost) {
      console.error('[CAL-SYNC] Aborting write phase — lock lost before transaction');
      emitProgress('error', 'Sync aborted — lock lost', 0);
      return res.status(503).json({ error: 'Sync lock lost. Please retry.', retryAfter: 5 });
    }

    await db.transaction(async function(trx) {
      var now = db.fn.now();

      // 1. Task inserts (new tasks from provider events) — bulk insert
      if (taskInserts.length > 0) {
        for (var wi = 0; wi < taskInserts.length; wi++) {
          taskInserts[wi].created_at = now;
          taskInserts[wi].updated_at = now;
        }
        for (var wi2 = 0; wi2 < taskInserts.length; wi2++) {
          await tasksWrite.insertTask(trx, taskInserts[wi2]);
        }
      }

      // 2. Task updates (event IDs, field changes from provider)
      // Merge multiple updates for the same task into one write
      var mergedTaskUpdates = {};
      for (var wu = 0; wu < taskUpdates.length; wu++) {
        var upd = taskUpdates[wu];
        if (conflictSkipIds.has(upd.id)) continue;
        if (!mergedTaskUpdates[upd.id]) mergedTaskUpdates[upd.id] = {};
        Object.assign(mergedTaskUpdates[upd.id], upd.fields);
      }
      var mergedIds = Object.keys(mergedTaskUpdates);
      for (var wm = 0; wm < mergedIds.length; wm++) {
        var mid = mergedIds[wm];
        mergedTaskUpdates[mid].updated_at = now;
        await tasksWrite.updateTaskById(trx, mid, mergedTaskUpdates[mid], userId);
      }

      // 3. Task deletes (remote-deleted events past miss threshold)
      for (var wd = 0; wd < taskDeletes.length; wd++) {
        var del = taskDeletes[wd];
        // Transfer dependencies first
        for (var wdt = 0; wdt < del.dependencyTransfers.length; wdt++) {
          var dt = del.dependencyTransfers[wdt];
          await tasksWrite.updateTaskById(trx, dt.id, {
            depends_on: dt.newDepsJson, updated_at: now
          }, userId);
        }
        await tasksWrite.deleteTaskById(trx, del.id, userId);
      }

      // 4. Ledger updates
      for (var wl = 0; wl < ledgerUpdates.length; wl++) {
        var lu = ledgerUpdates[wl];
        lu.fields.synced_at = now;
        await trx('cal_sync_ledger').where('id', lu.id).update(lu.fields);
      }

      // 5. Ledger inserts — dedup by (user_id, provider, task_id) then bulk insert.
      // Within-run dedup: last entry wins (handles split-replacement / partial-failure cases).
      // Cross-run dedup: INSERT IGNORE silently drops rows that violate the DB-level
      // unique constraint on active_task_key (concurrent sync runs pushing the same task).
      if (ledgerInserts.length > 0) {
        var seenLedgerKeys = {};
        var dedupedLedgerInserts = [];
        for (var wli = 0; wli < ledgerInserts.length; wli++) {
          ledgerInserts[wli].synced_at = now;
          ledgerInserts[wli].created_at = now;
          if (ledgerInserts[wli].origin === 'juggler' && ledgerInserts[wli].status === 'active') {
            ledgerInserts[wli].last_pushed_at = now;
          }
          var lKey = ledgerInserts[wli].user_id + '|' + ledgerInserts[wli].provider + '|' + ledgerInserts[wli].task_id;
          seenLedgerKeys[lKey] = wli; // last entry wins
        }
        var winnerIdxs = Object.values(seenLedgerKeys);
        for (var wli2 = 0; wli2 < winnerIdxs.length; wli2++) {
          dedupedLedgerInserts.push(ledgerInserts[winnerIdxs[wli2]]);
        }
        await trx('cal_sync_ledger').insert(dedupedLedgerInserts).onConflict().ignore();
      }

      // 6. Sync history inserts — bulk insert
      if (historyInserts.length > 0) {
        for (var wh = 0; wh < historyInserts.length; wh++) {
          historyInserts[wh].created_at = now;
        }
        await trx('sync_history').insert(historyInserts);
      }

      // 7. Update last-synced timestamps for all providers
      var userUpdate = { updated_at: now };
      for (var pi3 = 0; pi3 < providerIds.length; pi3++) {
        var syncedCol = providerData[providerIds[pi3]].adapter.getLastSyncedColumn();
        userUpdate[syncedCol] = now;
      }
      await trx('users').where('id', userId).update(userUpdate);
    });

    } finally {
      // Release the write-phase lock
      clearInterval(lockHeartbeat);
      await releaseLock(userId, lockToken);
    }

    // === Phase 5: Build the affected-task-id list and notify ===
    // (runs AFTER lock release so scheduler can pick up)
    emitProgress('finalize', 'Finalizing...', 95);

    var deletedDuringSync = taskDeletes.map(function(d) { return d.id; });
    var touchedRows;
    if (preSyncMaxUpdatedAt) {
      touchedRows = await db('tasks_v')
        .where('user_id', userId)
        .where('updated_at', '>', preSyncMaxUpdatedAt)
        .pluck('id');
    } else {
      touchedRows = await db('tasks_v').where('user_id', userId).pluck('id');
    }
    var affectedIds = touchedRows.concat(deletedDuringSync);
    var seenIds = {};
    var uniqueAffected = [];
    for (var ii = 0; ii < affectedIds.length; ii++) {
      if (!seenIds[affectedIds[ii]]) {
        seenIds[affectedIds[ii]] = true;
        uniqueAffected.push(affectedIds[ii]);
      }
    }
    // Only reschedule if something actually changed in juggler — a push-only sync
    // (flexible tasks re-pushed due to scheduler placement) doesn't affect task order
    // and doesn't need a full reschedule cycle.
    if (stats.pulled > 0 || stats.deleted_local > 0 || stats.deleted_remote > 0) {
      enqueueScheduleRun(userId, 'cal-sync', uniqueAffected);
    }

    // Build human-readable summary from in-memory history
    var doneSummaryParts = [];
    Object.keys(stats.providers).forEach(function(pid) {
      var ps = stats.providers[pid];
      var label = PROVIDER_NAMES[pid] || pid;
      var parts = [];
      if (ps.pulled > 0) parts.push(ps.pulled + ' pulled');
      if (ps.pushed > 0) parts.push(ps.pushed + ' pushed');
      if (ps.deleted_local > 0) parts.push(ps.deleted_local + ' removed');
      if (parts.length > 0) doneSummaryParts.push(label + ': ' + parts.join(', '));
    });
    emitProgress('done', doneSummaryParts.length > 0 ? doneSummaryParts.join(' | ') : 'Sync complete — no changes', 100);
    stats.syncRunId = syncRunId;
    stats.summary = historyInserts.map(function(h) {
      var provLabel = h.provider === 'gcal' ? 'Google Calendar' : 'Microsoft Calendar';
      switch (h.action) {
        case 'promoted':
          return { type: 'pin', text: h.task_text, message: 'Pinned to new time (moved in ' + provLabel + ')', hasIssue: (h.detail || '').indexOf('before dependency') >= 0 || (h.detail || '').indexOf('now before this task') >= 0 };
        case 'pulled':
          return { type: 'pull', text: h.task_text, message: 'Updated from ' + provLabel };
        case 'pushed':
          return { type: 'push', text: h.task_text, message: 'Pushed to ' + provLabel };
        case 'created':
          return { type: 'create', text: h.task_text, message: 'New task from ' + provLabel };
        case 'deleted_remote':
          return { type: 'delete', text: h.task_text, message: 'Removed (deleted in ' + provLabel + ')' };
        case 'deleted_local':
          return { type: 'delete', text: h.task_text, message: 'Event removed from ' + provLabel };
        case 'conflict_juggler':
          return { type: 'push', text: h.task_text, message: 'Conflict resolved — kept Juggler version' };
        case 'conflict_provider':
          return { type: 'pull', text: h.task_text, message: 'Conflict resolved — accepted ' + provLabel + ' version' };
        case 'error':
          return { type: 'error', text: h.task_text, message: h.detail || 'Sync error', hasIssue: true };
        default:
          return { type: 'info', text: h.task_text, message: h.detail || h.action };
      }
    });

    res.json(stats);
  } catch (error) {
    console.error('Cal sync error:', error);
    sseEmitter.emit(userId, 'sync:error', { error: error.message || 'Unknown sync error' });
    res.status(500).json({ error: 'Failed to sync calendars' });
  }
}

/**
 * GET /api/cal/has-changes — lightweight check if any connected calendar has changes.
 * Uses Google sync tokens to avoid fetching all events.
 * Returns { hasChanges: true/false, providers: { gcal: { hasChanges }, ... } }
 */
async function hasChanges(req, res) {
  try {
    var connectedAdapters = getConnectedAdapters(req.user);
    if (connectedAdapters.length === 0) {
      return res.json({ hasChanges: false, providers: {} });
    }

    var result = { hasChanges: false, providers: {} };

    for (var i = 0; i < connectedAdapters.length; i++) {
      var adapter = connectedAdapters[i];
      try {
        if (!adapter.hasChanges) {
          // Adapter doesn't support lightweight check — assume changes
          result.providers[adapter.providerId] = { hasChanges: true, reason: 'no_sync_token_support' };
          result.hasChanges = true;
          continue;
        }

        var token = await adapter.getValidAccessToken(req.user);
        var check = await adapter.hasChanges(token, req.user);
        result.providers[adapter.providerId] = check;
        if (check.hasChanges) result.hasChanges = true;
      } catch (err) {
        var msg = err.message || '';
        if (RE_AUTH_ERR.test(msg)) {
          result.providers[adapter.providerId] = { hasChanges: false, tokenExpired: true };
        } else {
          result.providers[adapter.providerId] = { hasChanges: true, error: msg };
          result.hasChanges = true;
        }
      }
    }

    // Also check if there are local task changes since last sync
    var userId = req.user.id;
    var lastSynced = req.user.gcal_last_synced_at;
    if (lastSynced) {
      var localChanges = await db('tasks_v')
        .where('user_id', userId)
        .whereNotNull('scheduled_at')
        .where('updated_at', '>', lastSynced)
        .count('* as cnt')
        .first();
      if (localChanges && parseInt(localChanges.cnt) > 0) {
        result.hasChanges = true;
        result.localChanges = parseInt(localChanges.cnt);
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Cal has-changes error:', error);
    res.status(500).json({ error: 'Failed to check for changes' });
  }
}

/**
 * GET /api/cal/sync-history — retrieve sync history for the current user.
 * Supports ?limit=N&offset=N&syncRunId=UUID query params.
 */
async function getSyncHistory(req, res) {
  try {
    var userId = req.user.id;
    var runLimit = Math.min(parseInt(req.query.runs) || 20, 50);

    // Get the most recent distinct sync run IDs with their timestamps
    var recentRuns = await db('sync_history')
      .where('user_id', userId)
      .select('sync_run_id')
      .max('created_at as run_time')
      .groupBy('sync_run_id')
      .orderBy('run_time', 'desc')
      .limit(runLimit);

    if (recentRuns.length === 0) {
      return res.json({ runs: [] });
    }

    var runIds = recentRuns.map(function(r) { return r.sync_run_id; });

    var rows = await db('sync_history')
      .where('user_id', userId)
      .whereIn('sync_run_id', runIds)
      .orderBy('id', 'asc')
      .select();

    rows.forEach(function(r) {
      r.old_values   = safeParseJSON(r.old_values,   r.old_values);
      r.new_values   = safeParseJSON(r.new_values,   r.new_values);
      r.error_detail = safeParseJSON(r.error_detail, r.error_detail);
    });

    // Group rows by sync_run_id, preserving run order from recentRuns
    var runMap = {};
    rows.forEach(function(r) {
      if (!runMap[r.sync_run_id]) {
        runMap[r.sync_run_id] = {
          sync_run_id: r.sync_run_id,
          created_at: r.created_at,
          trigger_type: r.trigger_type || 'manual',
          providers: [],
          calendar_names: [],
          counts: {},
          items: []
        };
      }
      var run = runMap[r.sync_run_id];
      if (r.provider && run.providers.indexOf(r.provider) < 0) run.providers.push(r.provider);
      if (r.calendar_name && run.calendar_names.indexOf(r.calendar_name) < 0) run.calendar_names.push(r.calendar_name);
      run.counts[r.action] = (run.counts[r.action] || 0) + 1;
      run.items.push(r);
    });

    var runs = recentRuns.map(function(r) {
      return runMap[r.sync_run_id] || {
        sync_run_id: r.sync_run_id,
        created_at: r.run_time,
        trigger_type: 'manual',
        providers: [],
        calendar_names: [],
        counts: {},
        items: []
      };
    });

    res.json({ runs: runs });
  } catch (error) {
    console.error('Sync history error:', error);
    res.status(500).json({ error: 'Failed to retrieve sync history' });
  }
}

/**
 * GET /api/cal/audit — compare Strive tasks to calendar events and report mismatches.
 * Query params: ?days=7 (window, default 7 days forward from today)
 */
async function audit(req, res) {
  try {
    var userId = req.user.id;
    var userRow = await db('users').where('id', userId).first();
    var tz = userRow.timezone || DEFAULT_TIMEZONE;

    var days = Math.min(parseInt(req.query.days, 10) || 7, 60);
    var now = new Date();
    var end = new Date(now); end.setDate(end.getDate() + days);

    var adapters = getConnectedAdapters(userRow);
    var report = {
      window: { startUTC: now.toISOString(), endUTC: end.toISOString(), days: days },
      providers: {}
    };

    // Load Strive tasks in window
    var { fetchTasksWithEventIds } = require('./task.controller');
    var taskRows = await fetchTasksWithEventIds(db, userId, function(q) {
      q.whereNotNull('scheduled_at')
        .where('scheduled_at', '>=', now).where('scheduled_at', '<=', end)
        .whereNot('status', 'done').whereNot('status', 'cancel').whereNot('status', 'skip')
        .whereNot('status', 'pause').whereNot('status', 'disabled')
        .whereNot('task_type', 'recurring_template')
        .where(function() { this.whereNull('unscheduled').orWhere('unscheduled', 0); })
        .orderBy('scheduled_at');
    });

    // Resolve recurring instance text from templates
    var srcIds = taskRows.filter(function(r){ return !r.text && r.source_id; }).map(function(r){ return r.source_id; });
    var tpl = {};
    if (srcIds.length > 0) {
      (await db('tasks_v').whereIn('id', srcIds).select('id', 'text'))
        .forEach(function(r) { tpl[r.id] = r.text; });
    }
    taskRows.forEach(function(r) { if (!r.text && r.source_id) r.text = tpl[r.source_id] || ''; });

    for (var pi = 0; pi < adapters.length; pi++) {
      var adapter = adapters[pi];
      var pid = adapter.providerId;
      var eventIdCol = adapter.getEventIdColumn();
      var provReport = {
        striveTasks: taskRows.length,
        matched: 0,
        missingFromCalendar: [],
        timeMismatches: [],
        durMismatches: [],
        orphansOnCalendar: []
      };

      try {
        var token = await adapter.getValidAccessToken(userRow);
        var events = await adapter.listEvents(token, now.toISOString(), end.toISOString(), userId);

        var eventsById = {};
        events.forEach(function(e) {
          eventsById[e.id] = e;
          if (e._url) eventsById[e._url] = e;
        });
        provReport.calendarEvents = events.length;

        taskRows.forEach(function(r) {
          var evId = r[eventIdCol];
          var striveStart = new Date(String(r.scheduled_at).replace(' ', 'T') + 'Z');
          var striveDur = r.dur || 30;

          if (!evId) {
            provReport.missingFromCalendar.push({
              taskId: r.id, text: r.text, striveTime: striveStart.toISOString(), striveDur: striveDur, reason: 'no event ID'
            });
            return;
          }
          var ev = eventsById[evId];
          if (!ev) {
            provReport.missingFromCalendar.push({
              taskId: r.id, text: r.text, striveTime: striveStart.toISOString(), striveDur: striveDur, reason: 'event ID not on calendar'
            });
            return;
          }
          var evStart = new Date(ev.startDateTime);
          var timeDiffMin = Math.abs(striveStart.getTime() - evStart.getTime()) / 60000;
          var evDur = ev.durationMinutes || 30;
          var durDiff = Math.abs(striveDur - evDur);

          if (timeDiffMin > 1) {
            provReport.timeMismatches.push({
              taskId: r.id, text: r.text,
              striveTime: striveStart.toISOString(), calTime: evStart.toISOString(), diffMinutes: Math.round(timeDiffMin)
            });
          } else if (durDiff > 1 && striveDur > 0 && evDur > 0) {
            provReport.durMismatches.push({
              taskId: r.id, text: r.text, striveDur: striveDur, calDur: evDur
            });
          } else {
            provReport.matched++;
          }
        });

        var taskEventIds = new Set(taskRows.map(function(r) { return r[eventIdCol]; }).filter(Boolean));
        events.forEach(function(e) {
          if (!taskEventIds.has(e.id)) {
            provReport.orphansOnCalendar.push({
              eventId: e.id, title: e.title, calTime: e.startDateTime
            });
          }
        });

        provReport.mismatchCount = provReport.missingFromCalendar.length + provReport.timeMismatches.length + provReport.durMismatches.length + provReport.orphansOnCalendar.length;
      } catch (err) {
        provReport.error = err.message;
      }

      report.providers[pid] = provReport;
    }

    res.json(report);
  } catch (error) {
    console.error('Cal audit error:', error);
    res.status(500).json({ error: 'Failed to audit calendar sync' });
  }
}

module.exports = { sync, hasChanges, getSyncHistory, audit };
