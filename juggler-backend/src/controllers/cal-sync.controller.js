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
const getDb = () => require('../db');
var { getConnectedAdapters } = require('../slices/calendar/facade');
var calendarFacade = require('../slices/calendar/facade');
var { enqueueScheduleRun } = require('../scheduler/scheduleQueue');
var { rowToTask, safeParseJSON } = require('./task.controller');
var { localToUtc } = require('../scheduler/dateHelpers');
var { safeTimezone } = require('juggler-shared/scheduler/dateHelpers');
var { taskHash, userHash, isoToJugglerDate, toMySQLDate, DEFAULT_TIMEZONE, callWithRateLimit, isEventPast, isStalePastSkipRow } = require('./cal-sync-helpers');
var sseEmitter = require('../lib/sse-emitter');
var { PLACEMENT_MODES } = require('../lib/placementModes');
var { isTerminalStatus } = require('../lib/task-status');
// 999.1025 sub-leg 2: the ConstraintSolver.effectiveDuration duration-
// correction pass (999.1217/D6) moved into gatherProviderSyncData in
// slices/calendar/facade.js along with the rest of sync()'s Phase 1 — no
// longer needed at this scope. See that function's JSDoc for the boundary.
// 999.1025 sub-leg 3: the Write Phase (lock acquire/retry, flush, conflict
// detection, the 7-step transaction, lock release) moved into
// runSyncWritePhase in slices/calendar/facade.js along with the rest of that
// phase — KnexTaskRepository (999.1199 eslint-boundary import) and the
// lib/sync-lock (acquireLock/releaseLock/refreshLock) and
// lib/task-write-queue (flushQueueInLock) requires moved with it; no longer
// needed at this scope. See that function's JSDoc for the boundary.
var { isAllDayTaskBackend } = require('../lib/isAllDayTaskBackend');
// 999.1025 inc. 3 — pure miss-ladder use-case (decisions in, effects out).
var { decideMissingEventSync } = require('../slices/calendar/domain/missing-event-decision');
// 999.1025 inc. 4 — pure terminal-status use-case (decisions in, effects out).
var { decideTerminalTaskSync } = require('../slices/calendar/domain/terminal-task-decision');
// 999.1025 inc. 5 — pure past-non-done-cleanup use-case (decisions in, effects
// out). Its delete effect is byte-identical to the terminal path, so it is
// applied through the SHARED applyTerminalDelete applier below.
var { decidePastCleanupSync } = require('../slices/calendar/domain/past-cleanup-decision');
// 999.1025 inc. 6 — pure external-edit predicate (axis-S seam). Was FORKED at two
// byte-identical sites below (eventModifiedExternally + provEventModified); now unified.
var { isEventModifiedExternally } = require('../slices/calendar/domain/event-modified-predicate');
// 999.1025 inc. 7 — pure "both changed → conflict resolution" decision (push /
// pull / push-conflict). _buildPullFields + logSyncAction stay effects here.
var { decideExternalEditSync } = require('../slices/calendar/domain/external-edit-decision');
// 999.1025 inc. 8 — pure "pull a NON-juggler-origin event into its task" decision
// (unifies the ingest-only + provider-origin full-sync pull branches). The adapter
// call (applyEventToTaskFields), task/stat buffers, and logSyncAction stay effects here.
var { decideProviderOriginPull } = require('../slices/calendar/domain/provider-origin-pull-decision');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('cal-sync.controller');

// Ledger origin value for tasks created/managed by Juggler (vs. pulled from a provider).
var JUGGLER_ORIGIN = 'juggler';

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

// 999.1025 inc. 4 — the terminal-decision's delete EFFECT, isolated as its own
// small (impure) applier function so it's mockable/testable at this seam
// without a DB (mirrors the sibling delete blocks in sync()). Moved verbatim
// from the old handleTerminalTaskSync (lib/cal-sync-helpers.js): swallow
// 404/410 (event already deleted elsewhere), rethrow anything else, then hand
// back the decision's already-computed mutation buffers unchanged.
async function applyTerminalDelete(pAdapter, pToken, throttleFn, decision) {
  try {
    await pAdapter.deleteEvent(pToken, decision.deleteTarget);
    await throttleFn();
  } catch (e) {
    if (!e.message.includes('404') && !e.message.includes('410')) throw e;
  }
  return {
    taskUpdates: decision.taskUpdates,
    ledgerUpdates: decision.ledgerUpdates,
    statsDelta: decision.statsDelta
  };
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
  } else if (status === 412) {
    summary = 'Could not ' + (opts.operation || 'sync') + ' — ' + providerName + ' conflict (event was modified externally). Will retry next sync.';
    retryable = true;
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
 * Promotion logic (placement_mode=fixed, marker clearing) lives in applyEventToTaskFields.
 */
function _buildPullFields(event, task, tz, adapter) {
  return adapter.applyEventToTaskFields(event, tz, task);
}

/**
 * POST /api/cal/sync — one-way sync (Strive → calendars).
 * Tasks push to their calendar events every sync (deterministic).
 * Ingest-only providers pull events into tasks (as placement_mode='fixed').
 * Sync window: 14 days back + 60 days forward.
 */
async function sync(req, res) {
  try {
    var userId = req.user.id;
    var userRow = await getDb()('users').where('id', userId).select('timezone').first();
    var tz = safeTimezone((userRow && userRow.timezone) || null, DEFAULT_TIMEZONE);
    var year = new Date().getFullYear();
    var now = new Date();

    _throttleCount = 0; // reset per sync run

    // Sync window starts at the user's local midnight today and runs 60
    // days forward. The scheduler only ever places tasks from "now"
    // forward, so anything before today is settled history that doesn't
    // need re-fetching every sync. Starting at midnight (rather than
    // "now") still captures rows the scheduler may have rewound to
    // earlier today.
    var todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    var todayStart = localToUtc(todayKey, '12:00 AM', tz)
      || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var windowStart = todayStart;
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
        detail: opts.detail ? String(opts.detail).substring(0, 500) : null,
        error_detail: opts.errorDetail ? JSON.stringify(opts.errorDetail) : null,
        calendar_name: opts.calendarName || null,
        trigger_type: triggerType
      });
    }

    // deletedDuringSync is derived from taskDeletes[] after the write phase

    // Load user preferences for completed task behavior
    var prefsRow = await getDb()('user_config').where({ user_id: userId, config_key: 'preferences' }).first();
    var calCompletedBehavior = 'update'; // default
    if (prefsRow) {
      try {
        var prefs = typeof prefsRow.config_value === 'string'
          ? JSON.parse(prefsRow.config_value) : prefsRow.config_value;
        if (prefs && prefs.calCompletedBehavior) calCompletedBehavior = prefs.calCompletedBehavior;
} catch { /* ignore parse errors */ }    }

    // Progress helper — emits SSE events so frontend can show a progress bar
    function emitProgress(phase, detail, pct, extra) {
      sseEmitter.emit(userId, 'sync:progress', {
        phase: phase, detail: detail, pct: pct || 0,
        provider: extra && extra.provider || null,
        calendar: extra && extra.calendar || null
      });
    }

    // Load per-provider sync mode (full vs ingest-only)
    var calSyncSettingsRow = await getDb()('user_config')
      .where({ user_id: userId, config_key: 'cal_sync_settings' }).first();
    var calSyncSettings = calSyncSettingsRow
      ? (typeof calSyncSettingsRow.config_value === 'string'
          ? JSON.parse(calSyncSettingsRow.config_value) : calSyncSettingsRow.config_value)
      : {};

    // Apple uses per-calendar sync_direction (multi-calendar model). The
    // provider-level cal_sync_settings.apple.mode is redundant and isn't
    // exposed in the UI — derive Apple's effective mode from user_calendars
    // instead. Apple is treated as ingest-only ONLY when no enabled Apple
    // calendar has sync_direction='full'.
    var appleFullSyncRow = await getDb()('user_calendars')
      .where({ user_id: userId, provider: 'apple', enabled: true, sync_direction: 'full' })
      .first();
    var appleHasFullSync = !!appleFullSyncRow;

    function isIngestOnly(providerId) {
      if (providerId === 'apple') {
        // Apple: per-calendar settings are authoritative. Provider-level mode ignored.
        return !appleHasFullSync;
      }
      return calSyncSettings[providerId] && calSyncSettings[providerId].mode === 'ingest';
    }

    // === Phase 1: Gather data from all connected providers ===
    // 999.1025 sub-leg 2: extracted verbatim into the calendar slice facade
    // (REFACTOR mode — no behavior change). See gatherProviderSyncData's
    // JSDoc in slices/calendar/facade.js for the exact boundary this call
    // replaces (previously inlined here).
    var phase1Data = await calendarFacade.gatherProviderSyncData(
      req.user, userId, windowStart, windowEnd, tz, stats, emitProgress
    );
    if (phase1Data.earlyReturn) {
      return res.json(stats);
    }
    var providerData = phase1Data.providerData;
    var ledgerRecords = phase1Data.ledgerRecords;
    var allTasks = phase1Data.allTasks;
    var tasksById = phase1Data.tasksById;
    var mergedFollowers = phase1Data.mergedFollowers;
    var tasksByMasterDate = phase1Data.tasksByMasterDate;
    var calIngestModeMap = phase1Data.calIngestModeMap;
    var calendarLabels = phase1Data.calendarLabels;

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
          // Decision is PURE (999.1025 inc. 5): decidePastCleanupSync returns a
          // descriptor; the deleteEvent/throttle effect (and its 404/410 swallow)
          // is applied HERE via the SHARED applyTerminalDelete applier — the
          // delete effect is byte-identical to the terminal-delete path
          // (deleteTarget = event._url || ledger.provider_event_id, same buffers,
          // same statsDelta.deleted_local). The boundary distinction
          // (recurring_instance uses `now`, one-off/chain uses `todayStart`) now
          // lives inside the decision. This branch emits no sync_history log.
          if (task && event && ledger.origin === JUGGLER_ORIGIN && task._scheduled_at && !isIngestOnly(pid)) {
            var pastCleanupDecision = decidePastCleanupSync({
              task: task, event: event, ledger: ledger,
              now: now, todayStart: todayStart,
              isIngestOnly: isIngestOnly(pid),
              JUGGLER_ORIGIN: JUGGLER_ORIGIN,
              eventIdColumn: pAdapter.getEventIdColumn()
            });

            if (pastCleanupDecision.action === 'delete') {
              var appliedPast = await applyTerminalDelete(pAdapter, pToken, throttle, pastCleanupDecision);
              taskUpdates = taskUpdates.concat(appliedPast.taskUpdates);
              ledgerUpdates = ledgerUpdates.concat(appliedPast.ledgerUpdates);
              pStats.deleted_local = (pStats.deleted_local || 0) + (appliedPast.statsDelta.deleted_local || 0);
              stats.deleted_local = (stats.deleted_local || 0) + (appliedPast.statsDelta.deleted_local || 0);
              continue;
            }
            // action 'none': not past-due-and-unfinished — fall through unchanged.
          }

          // --- Terminal status handling (done/cancel/skip/pause) ---
          // Decision is PURE (999.1025 inc. 4): decideTerminalTaskSync returns a
          // descriptor; the deleteEvent/throttle effect (and its 404/410 swallow)
          // is applied HERE at the call site, matching the sibling delete blocks
          // above. deleteTarget preserves `event._url || ledger.provider_event_id`
          // exactly (axis T).
          if (task && event && ledger.origin === JUGGLER_ORIGIN && calCompletedBehavior !== 'keep' && !isIngestOnly(pid)) {
            var terminalDecision = decideTerminalTaskSync({
              task: task, event: event, ledger: ledger,
              calCompletedBehavior: calCompletedBehavior,
              isIngestOnly: isIngestOnly(pid),
              JUGGLER_ORIGIN: JUGGLER_ORIGIN,
              eventIdColumn: pAdapter.getEventIdColumn()
            });

            if (terminalDecision.action === 'delete') {
              // effect isolated in applyTerminalDelete (999.1025 inc. 4 — mockable
              // seam, DB-free unit-testable). decideTerminalTaskSync never emits
              // logs (same as the old handleTerminalTaskSync), so there is
              // nothing to forward to logSyncAction here — behavior-identical.
              var applied = await applyTerminalDelete(pAdapter, pToken, throttle, terminalDecision);
              taskUpdates = taskUpdates.concat(applied.taskUpdates);
              ledgerUpdates = ledgerUpdates.concat(applied.ledgerUpdates);
              pStats.deleted_local = (pStats.deleted_local || 0) + (applied.statsDelta.deleted_local || 0);
              stats.deleted_local = (stats.deleted_local || 0) + (applied.statsDelta.deleted_local || 0);
              continue; // Skip to next iteration — event was deleted
            }
            // action 'update' (done + behavior!=delete) or 'none': fall through to
            // regular push so ✓ prefix + transparency propagate to the calendar.
          }

          // [FIX D-03] done_frozen guard — skip push for already-frozen rows
          if (ledger.status === 'done_frozen') {
            pStats.skipped = (pStats.skipped || 0) + 1;
            stats.skipped = (stats.skipped || 0) + 1;
            ledgerUpdates.push({ id: ledger.id, fields: {
              event_summary: event ? (event.title || task.text) : task.text,
              miss_count: 0
            }});
            // [FIX D-10] Log skipped item to sync_history so UI can show skipped count
            logSyncAction(pid, 'skipped', {
              taskId: task ? task.id : null,
              taskText: task ? task.text : null,
              eventId: ledger.provider_event_id,
              calendarName: calendarLabels[pid] || null
            });
            continue;
          }

          // --- Both exist ---
          if (task && event) {
            var isRecurringTemplate = task.taskType === 'recurring_template';
            if (isRecurringTemplate) {
              // Templates should never be on calendars; nothing to do here
              continue;
            }

            // If the task is unscheduled (scheduler couldn't place it), delete its calendar
            // event — unscheduled tasks should never occupy a slot on external calendars.
            if (task.unscheduled && ledger.origin === JUGGLER_ORIGIN && !isIngestOnly(pid)) {
              try {
                await pAdapter.deleteEvent(pToken, event._url || ledger.provider_event_id);
                await throttle();
              } catch (eDel) {
                if (!eDel.message.includes('404') && !eDel.message.includes('410')) throw eDel;
              }
              taskUpdates.push({ id: task.id, fields: { [pAdapter.getEventIdColumn()]: null } });
              ledgerUpdates.push({ id: ledger.id, fields: { status: 'deleted_local', provider_event_id: null } });
              pStats.deleted_local++;
              stats.deleted_local++;
              continue;
            }

            // Only push to events WE created (origin=juggler). Events pulled from
            // a provider (origin=pid) are read-only from Juggler's perspective —
            // we don't own them, can't PATCH them, and shouldn't try.
            if (ledger.origin === JUGGLER_ORIGIN && !isIngestOnly(pid)) {
              // Followers in a merged-chunks run: skip the PATCH — their
              // event is queued for delete in Phase 3's splitDeleteQueue,
              // so patching it first wastes an API call. We also clear
              // last_pushed_hash later via the deleted_local transition.
              if (mergedFollowers[task.id]) {
                pStats.skipped = (pStats.skipped || 0) + 1;
                stats.skipped = (stats.skipped || 0) + 1;
                // [FIX D-10] Log skipped item to sync_history so UI can show skipped count
                logSyncAction(pid, 'skipped', {
                  taskId: task ? task.id : null,
                  taskText: task ? task.text : null,
                  eventId: ledger ? ledger.provider_event_id : null,
                  calendarName: calendarLabels[pid] || null
                });
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
                // come from the calendar. PURE predicate (999.1025 inc. 6 axis-S seam)
                // — the >1000ms tolerance + the ETag fallback (Apple CalDAV) live in
                // slices/calendar/domain/event-modified-predicate.js.
                var eventModifiedExternally = isEventModifiedExternally(event, ledger);

                var isTaskTerminal = isTerminalStatus(task.status);

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
                  // Both changed — conflict resolution is a PURE use-case
                  // (999.1025 inc. 7 — decideExternalEditSync): task placement +
                  // terminal status + the event-vs-task last-modified tiebreaker
                  // in, action ('push' | 'pull' | 'push-conflict') + log
                  // descriptors out. The push effect is identical for 'push' and
                  // 'push-conflict' (only the log detail differs, carried in
                  // editDecision.logs). _buildPullFields + logSyncAction stay
                  // effects here; the pull-branch conflict_provider log lives at
                  // the call site because its newValues.when depends on the
                  // freshly-built pull fields.
                  var editDecision = decideExternalEditSync({
                    task: task, event: event, ledger: ledger, pid: pid,
                    isTaskTerminal: isTaskTerminal,
                    calendarLabels: calendarLabels
                  });
                  if (editDecision.action === 'pull') {
                    // Event newer → pull.
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
                    // 'push' or 'push-conflict' → re-assert the task over the
                    // calendar edit (identical push effect; log detail differs).
                    pendingEventUpdates.push({
                      eventId: event._url || ledger.provider_event_id,
                      task: task,
                      ledgerId: ledger.id,
                      newHash: newHash
                    });
                    pStats.pushed++;
                    stats.pushed++;
                    for (var _cel = 0; _cel < editDecision.logs.length; _cel++) {
                      logSyncAction(editDecision.logs[_cel].provider, editDecision.logs[_cel].action, editDecision.logs[_cel].opts);
                    }
                  }
                } else if (!taskChanged && eventModifiedExternally && !isTaskTerminal) {
                  // Event changed, task stable, task not terminal → pull from event to task
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
                  var isPromotion = pullFields.placement_mode === PLACEMENT_MODES.FIXED;
                  logSyncAction(pid, isPromotion ? 'promoted' : 'pulled', {
                    taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                    oldValues: { placement_mode: task.placement_mode, scheduled_at: task._scheduled_at, dur: task.dur },
                    newValues: { placement_mode: pullFields.placement_mode || task.placement_mode, scheduled_at: pullFields.scheduled_at, dur: pullFields.dur },
                    detail: (isPromotion ? 'Event moved on calendar — task promoted to fixed' : 'Event edited on calendar — task updated') + (backwardDepWarning ? '. WARNING: ' + backwardDepWarning : ''),
                    calendarName: calendarLabels[pid] || null
                  });
                } else if (!taskChanged && eventModifiedExternally && isTaskTerminal) {
                  // Calendar moved a completed task's event — push back to correct it.
                  // Terminal tasks are immutable; the calendar edit is rejected and the
                  // correct date/status is re-asserted so the calendar can't drift forward.
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
                    detail: 'Calendar moved completed task — pushed correct date back (terminal tasks are immutable)',
                    calendarName: calendarLabels[pid] || null
                  });
                } else {
                  // Neither changed → skip (existing behaviour)
                  pStats.skipped = (pStats.skipped || 0) + 1;
                  stats.skipped = (stats.skipped || 0) + 1;
                  // [FIX D-10] Log skipped item to sync_history so UI can show skipped count
                  logSyncAction(pid, 'skipped', {
                    taskId: task ? task.id : null,
                    taskText: task ? task.text : null,
                    eventId: ledger ? ledger.provider_event_id : null,
                    calendarName: calendarLabels[pid] || null
                  });
                }
              }
            } else {
              // NON-juggler-origin pull decision is PURE (999.1025 inc. 8 —
              // decideProviderOriginPull): the two remaining inline pull branches
              // (ingest-only providers + provider-origin full-sync) unified. It
              // decides whether to pull, whether that pull forces placement_mode =
              // FIXED (ingest does; provider-origin leaves the adapter's own
              // change-detection to decide — ROADMAP 999.012 BUG-2), and the log
              // descriptor(s). isEventModifiedExternally (999.1025 inc. 6) is reused
              // inside the decision. The adapter call (applyEventToTaskFields),
              // taskUpdates buffer, pStats/stats.pulled, and logSyncAction stay
              // effects here at the call site.
              var pullDecision = decideProviderOriginPull({
                task: task, event: event, ledger: ledger, pid: pid,
                isIngestOnly: isIngestOnly(pid),
                jugglerOrigin: JUGGLER_ORIGIN,
                isTaskTerminal: isTerminalStatus(task.status),
                calendarLabels: calendarLabels
              });
              if (pullDecision.action === 'pull') {
                var pullTaskFields = pAdapter.applyEventToTaskFields(event, tz, task);
                if (pullDecision.forcePlacementFixed) {
                  pullTaskFields.placement_mode = PLACEMENT_MODES.FIXED;
                }
                taskUpdates.push({ id: task.id, fields: pullTaskFields });
                pStats.pulled++;
                stats.pulled++;
                for (var _ppl = 0; _ppl < pullDecision.logs.length; _ppl++) {
                  logSyncAction(pullDecision.logs[_ppl].provider, pullDecision.logs[_ppl].action, pullDecision.logs[_ppl].opts);
                }
              }
            }

            // Update ledger cached fields
            ledgerUpdates.push({ id: ledger.id, fields: {
              event_summary: event.title || task.text,
              event_start: event.startDateTime || null,
              event_end: event.endDateTime || null,
              event_all_day: event.isAllDay ? 1 : 0,
              last_modified_at: toMySQLDate(event.lastModified),
              provider_etag: event._etag || null,
              task_updated_at: task._updated_at || null,
              miss_count: 0
            }});

          } else if (task && !event) {
            // Event missing from the provider's calendarView. The miss-ladder /
            // terminal-decision is a PURE use-case (999.1025 inc. 3) — decisions
            // in, effects out. Build the resolved context, decide, then apply the
            // returned mutations here. withinCdnGrace/userHash/taskHash are
            // injected so the use-case stays DB/HTTP-free; withinCdnGrace's known
            // raw-Date parse bug (W5 A1-5 / DIGEST-2026-07-16) is preserved via
            // the injected dependency, NOT fixed or re-implemented.
            var missDecision = decideMissingEventSync({
              task: task, ledger: ledger, pid: pid, pd: pd,
              now: now, windowStart: windowStart, windowEnd: windowEnd,
              providerIds: providerIds, ledgerByProvider: ledgerByProvider,
              allTasks: allTasks, calendarLabels: calendarLabels,
              MISS_THRESHOLD: MISS_THRESHOLD, JUGGLER_ORIGIN: JUGGLER_ORIGIN
            }, {
              withinCdnGrace: withinCdnGrace, userHash: userHash, taskHash: taskHash
            });
            for (var _mlu = 0; _mlu < missDecision.ledgerUpdates.length; _mlu++) {
              ledgerUpdates.push(missDecision.ledgerUpdates[_mlu]);
            }
            for (var _mtd = 0; _mtd < missDecision.taskDeletes.length; _mtd++) {
              taskDeletes.push(missDecision.taskDeletes[_mtd]);
            }
            for (var _mrc = 0; _mrc < missDecision.recreateTaskIds.length; _mrc++) {
              tasksNeedingReCreate.add(missDecision.recreateTaskIds[_mrc]);
              processedTaskIds.delete(missDecision.recreateTaskIds[_mrc]);
            }
            for (var _mlg = 0; _mlg < missDecision.logs.length; _mlg++) {
              logSyncAction(missDecision.logs[_mlg].provider, missDecision.logs[_mlg].action, missDecision.logs[_mlg].opts);
            }
            if (missDecision.statsDelta.deleted_remote) {
              pStats.deleted_remote += missDecision.statsDelta.deleted_remote;
              stats.deleted_remote += missDecision.statsDelta.deleted_remote;
            }
            if (missDecision.stop) continue;

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
          logger.error('[CAL-SYNC] Ledger sync error for ' + pid + ':', e);
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
              operation: 'sync event',
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
            last_pushed_at: getDb().fn.now(),
            // +30s: provider server timestamps often lag our push by several seconds
            // (Apple CalDAV is especially slow). Using +2s caused false
            // eventModifiedExternally detections on the following sync.
            last_modified_at: toMySQLDate(new Date(Date.now() + 30000).toISOString()),
            provider_etag: null
          }});
        }
        // [FIX D-02] Freeze done tasks after first successful push (done_frozen)
        var pushedTask = upd && upd.task;
        if (pushedTask && pushedTask.status === 'done' && calCompletedBehavior === 'update') {
          ledgerUpdates.push({ id: upd.ledgerId, fields: { status: 'done_frozen' } });
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
              for (var rui = 0; rui < failedUpdates.length; rui++) {
                try {
                  await callWithRateLimit(pid, function() { return pAdapter.updateEvent(pToken, failedUpdates[rui].eventId, failedUpdates[rui].task, year, tz); });
                  recordPushSuccess(failedUpdates[rui]);
                  await throttle();
                } catch (ruErr) {
                  if (ruErr.message && ruErr.message.includes('410') && failedUpdates[rui] && failedUpdates[rui].ledgerId) {
                    ledgerUpdates.push({ id: failedUpdates[rui].ledgerId, fields: { status: 'deleted_remote', provider_event_id: null } });
                  }
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
            logger.error('[CAL-SYNC] Batch update failed for ' + pid + ', falling back to sequential:', batchUpdateErr.message);
            for (var fui = 0; fui < pendingEventUpdates.length; fui++) {
              try {
                await callWithRateLimit(pid, function() { return pAdapter.updateEvent(pToken, pendingEventUpdates[fui].eventId, pendingEventUpdates[fui].task, year, tz); });
                recordPushSuccess(pendingEventUpdates[fui]);
                await throttle();
              } catch (e5) {
                if (e5.message && e5.message.includes('410') && pendingEventUpdates[fui] && pendingEventUpdates[fui].ledgerId) {
                  ledgerUpdates.push({ id: pendingEventUpdates[fui].ledgerId, fields: { status: 'deleted_remote', provider_event_id: null } });
                }
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
              if (e6.message && e6.message.includes('410') && pendingEventUpdates[sui] && pendingEventUpdates[sui].ledgerId) {
                ledgerUpdates.push({ id: pendingEventUpdates[sui].ledgerId, fields: { status: 'deleted_remote', provider_event_id: null } });
              }
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

    // === Pre-Push Lock Acquisition (999.1457) ===
    // The sync lock MUST be acquired BEFORE the push phase (Phase 3) so that
    // a 409 lock-contention return happens BEFORE any remote calendar events
    // are created. Previously the lock was acquired only in the write phase
    // (runSyncWritePhase), after createEvent calls had already fired — orphan
    // remote events whose ledger inserts were then discarded.
    var MAX_LOCK_ATTEMPTS = 8;
    var _lockResult = null;
    for (var _lockAttempt = 0; _lockAttempt < MAX_LOCK_ATTEMPTS; _lockAttempt++) {
      _lockResult = await calendarFacade.acquireLock(userId);
      if (_lockResult.acquired) break;
      var _backoffMs = Math.min(1000 * Math.pow(1.5, _lockAttempt), 10000) + Math.floor(Math.random() * 500);
      await delay(_backoffMs);
    }
    if (!_lockResult || !_lockResult.acquired) {
      logger.error('[CAL-SYNC] could not acquire lock before push phase after ' + MAX_LOCK_ATTEMPTS + ' attempts');
      sseEmitter.emit(userId, 'sync:lock_conflict', { error: 'Scheduler is busy', retryAfter: 30 });
      return res.status(409).json({ error: 'Scheduler is busy. Try again in a few seconds.', retryAfter: 30 });
    }
    var _syncLockToken = _lockResult.token;
    var _syncLockStart = Date.now();

    // Start a heartbeat immediately so the lock doesn't expire during the
    // push phase (TTL is 30s; a large push batch with rate-limiting can
    // exceed that). runSyncWritePhase will start its own heartbeat using
    // the same lockStart and clear this one via _prePushHeartbeat.
    var _prePushHeartbeat = setInterval(function() {
      if (Date.now() - _syncLockStart > 120000) {
        clearInterval(_prePushHeartbeat);
        logger.warn('[CAL-SYNC] Pre-push heartbeat stopped — lock held over 120s');
        return;
      }
      calendarFacade.refreshLock(userId, _syncLockToken).catch(function(err) {
        logger.error('[CAL-SYNC] Pre-push lock refresh failed:', err.message);
      });
    }, 10000);

    // === Phase 3: Push new tasks to providers (skip for ingest-only) ===
    // Load task IDs with error ledger records so we skip them in push.
    // A manual sync clears error records to allow fresh retries.
    var _errorLedgerTaskIds = new Set();
    var errorLedgerRows = await getDb()('cal_sync_ledger')
      .where('user_id', userId)
      .where('status', 'error')
      .select('task_id', 'id');
    // Clear error records so this manual sync can retry them
    if (errorLedgerRows.length > 0) {
      var errorLedgerIds = errorLedgerRows.map(function(r) { return r.id; });
      await getDb()('cal_sync_ledger').whereIn('id', errorLedgerIds).del();
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
      // eslint-disable-next-line no-redeclare
      var eventIdCol = pAdapter2.getEventIdColumn();

      // 3a: Push — skip entirely for ingest-only providers
      if (isIngestOnly(pid2)) {
        // ingest-only: no push phase
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

      // 999.1217 (W4): the old "cache-flagged split placements replace a
      // stale non-split ledger entry" pass lived here. It only ever fired for
      // tasks carrying schedule_cache splitPlacements (the pre-999.841 model,
      // where a single row could gain split sub-placements only in the cache
      // after already syncing as one event). Since split chunks now persist
      // as separate task_instances rows from creation (999.841), a chunk's
      // ledger/event identity is stable from its first sync — there is no
      // "this task just became split" transition left to detect. Removed
      // along with the schedule_cache read above; splitDeleteQueue/
      // splitReplacedIds stay declared (still fed by the merged-follower
      // cleanup above / still read by the push loop below) but this pass no
      // longer contributes to either.
      if (splitDeleteQueue.length > 0 && pAdapter2.batchDeleteEvents) {
        await pAdapter2.batchDeleteEvents(pToken2, splitDeleteQueue);
      } else {
        for (var sdi = 0; sdi < splitDeleteQueue.length; sdi++) {
          try { await pAdapter2.deleteEvent(pToken2, splitDeleteQueue[sdi]); } catch (e3) { logger.warn('[CAL-SYNC] splitDelete failed (ignored):', e3.message); }
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
        if (newTask.unscheduled) continue;
        if (!newTask.date) continue;
        if (!newTask.time && !isAllDayTaskBackend(newTask)) continue;

        // Skip tasks with existing event IDs — unless they were just cleared for split replacement
        var existingEvId = newTask[(eventIdCol === 'gcal_event_id' ? 'gcalEventId' : eventIdCol === 'msft_event_id' ? 'msftEventId' : 'appleEventId')];
        if (existingEvId && !splitReplacedIds.has(newTask.id)) continue;

        var taskSA = newTask._scheduled_at instanceof Date ? newTask._scheduled_at : new Date(String(newTask._scheduled_at).replace(' ', 'T') + 'Z');
        if (taskSA < todayStart) continue;
        if (taskSA > windowEnd) continue;

        // 999.1217 (W4): split chunks persist as separate task_instances rows
        // (999.841) — `newTask` here already IS a single chunk (or a merged
        // leader with mergeContiguousSplitChunks' summed dur/title), so it
        // pushes as one event with no synthetic per-part expansion needed.
        // The old schedule_cache-driven expansion (one synthetic sub-task per
        // cached splitPart) is removed; it only ever applied to the
        // pre-999.841 model where a chunk had no DB row of its own.
        pushQueue.push({ task: newTask });
      }

      // Batch create if adapter supports it, otherwise fall back to sequential
      if (pushQueue.length > 0 && pAdapter2.batchCreateEvents) {
        var _provLabel = PROVIDER_NAMES[pid2] || pid2;
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
              provider_event_id: br.providerEventId, origin: JUGGLER_ORIGIN,
              last_pushed_hash: taskHash(bTask),
              last_user_hash: userHash(bTask),
              last_pulled_hash: createdNorm ? pAdapter2.eventHash(createdNorm) : null,
              event_summary: bTask.text,
              event_start: (createdNorm && createdNorm.startDateTime) || (bTask._scheduled_at ? String(bTask._scheduled_at).replace(' ', 'T') : null),
              event_end: (createdNorm && createdNorm.endDateTime) || null,
              event_all_day: isAllDayTaskBackend(bTask) ? 1 : 0,
              task_updated_at: bTask._updated_at || null,
              last_modified_at: toMySQLDate(createdNorm && createdNorm.lastModified ? new Date(new Date(createdNorm.lastModified).getTime() + 2000).toISOString() : new Date().toISOString()),
              provider_etag: null,
              status: 'active'
            });
          }
          // Retry failed batch items sequentially (single attempt)
          var failedItems = [];
          for (var fbi = 0; fbi < batchResults.length; fbi++) {
            if (batchResults[fbi].error) failedItems.push(pushQueue[fbi]);
          }
          if (failedItems.length > 0) {
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
                  provider_event_id: rResult.providerEventId, origin: JUGGLER_ORIGIN,
                  last_pushed_hash: taskHash(rTask),
                  last_user_hash: userHash(rTask),
                  last_pulled_hash: rNorm ? pAdapter2.eventHash(rNorm) : null,
                  event_summary: rTask.text,
                  event_start: (rNorm && rNorm.startDateTime) || (rTask._scheduled_at ? String(rTask._scheduled_at).replace(' ', 'T') : null),
                  event_end: (rNorm && rNorm.endDateTime) || null,
                  event_all_day: isAllDayTaskBackend(rTask) ? 1 : 0,
                  task_updated_at: rTask._updated_at || null,
                  last_modified_at: toMySQLDate(rNorm && rNorm.lastModified ? new Date(new Date(rNorm.lastModified).getTime() + 2000).toISOString() : new Date().toISOString()),
                  provider_etag: null,
                  status: 'active'
                });
              } catch (rErr) {
                // Persistent failure — insert error ledger record so task is skipped next sync
                logger.warn('[CAL-SYNC] Retry failed for task ' + rTask.id + ' on ' + pid2 + ': ' + rErr.message);
                var rErrDetail = buildErrorDetail(rErr, {
                  provider: pid2,
                  calendar: calendarLabels[pid2] || null,
                  operation: 'push task to calendar',
                  affectedTasks: [{ id: rTask.id, title: rTask.text }]
                });
                ledgerInserts.push({
                  user_id: userId, provider: pid2, task_id: rTask.id,
                  provider_event_id: null, origin: JUGGLER_ORIGIN,
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
          logger.error('[CAL-SYNC] Batch create failed for ' + pid2 + ', falling back to sequential:', batchErr.message);
          for (var fi = 0; fi < pushQueue.length; fi++) {
            var fTask = pushQueue[fi].task;
            try {
              var result = await callWithRateLimit(pid2, function() { return pAdapter2.createEvent(pToken2, fTask, year, tz); });
              await throttle();
              var fNorm = pAdapter2.normalizeEvent ? pAdapter2.normalizeEvent(result.raw) : null;
              taskUpdates.push({ id: fTask.id, fields: { [eventIdCol]: result.providerEventId } });
              ledgerInserts.push({
                user_id: userId, provider: pid2, task_id: fTask.id,
                provider_event_id: result.providerEventId, origin: JUGGLER_ORIGIN,
                last_pushed_hash: taskHash(fTask),
                last_user_hash: userHash(fTask),
                last_pulled_hash: fNorm ? pAdapter2.eventHash(fNorm) : null,
                event_summary: fTask.text,
                event_start: (fNorm && fNorm.startDateTime) || (fTask._scheduled_at ? String(fTask._scheduled_at).replace(' ', 'T') : null),
                event_end: (fNorm && fNorm.endDateTime) || null,
                event_all_day: isAllDayTaskBackend(fTask) ? 1 : 0,
                task_updated_at: fTask._updated_at || null,
                last_modified_at: toMySQLDate(fNorm && fNorm.lastModified ? new Date(new Date(fNorm.lastModified).getTime() + 2000).toISOString() : new Date().toISOString()),
                provider_etag: null,
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
      var allLedgerForProvider = await getDb()('cal_sync_ledger')
        .where('user_id', userId)
        .where('provider', pid2)
        .whereNotNull('provider_event_id')
        .select('id', 'provider_event_id', 'task_id', 'status',
                'last_pushed_hash', 'last_user_hash', 'event_start', 'event_all_day');
      // 999.1605 healing: all-day events misclassified as past got a
      // task_id-NULL skip row that permanently blocks re-ingestion. A skip
      // row whose all-day date is today-or-later can only be that
      // misclassification (genuinely past rows only age further into the
      // past) — delete it immediately (NOT via the end-of-sync buffers, so
      // the Phase 3b re-ingest below can insert a fresh row for the same
      // event id without colliding) and leave it out of the skip set.
      var stalePastSkipIds = [];
      for (var ali = 0; ali < allLedgerForProvider.length; ali++) {
        if (isStalePastSkipRow(allLedgerForProvider[ali], todayKey)) {
          stalePastSkipIds.push(allLedgerForProvider[ali].id);
          continue;
        }
        existingLedgerEventIds.add(allLedgerForProvider[ali].provider_event_id);
      }
      if (stalePastSkipIds.length > 0) {
        await getDb()('cal_sync_ledger').whereIn('id', stalePastSkipIds).del();
        logger.warn('[999.1605] healed stale past-skip ledger rows (all-day misclassified as past)', {
          userId: userId, provider: pid2, count: stalePastSkipIds.length
        });
      }

      var eventIds = Object.keys(pEventsById2);
      for (var ei2 = 0; ei2 < eventIds.length; ei2++) {
        var evId = eventIds[ei2];
        if (processedEventIds2.has(evId)) continue;

        // Skip events that already have a ledger entry (active or deleted)
        if (existingLedgerEventIds.has(evId)) continue;

        var newEvent = pEventsById2[evId];

        // Apple (CalDAV) indexes each event by BOTH its UID and its CalDAV URL, so the
        // same event object appears under two keys in pEventsById2. Immediately mark the
        // sibling key as processed so the second key is skipped — otherwise the loop
        // creates duplicate tasks (pull) or triggers spurious orphan deletion (push).
        if (newEvent._url && newEvent._url !== evId) {
          if (processedEventIds2.has(newEvent._url) || existingLedgerEventIds.has(newEvent._url)) {
            continue; // sibling (URL key) already handled — skip this UID entry
          }
          processedEventIds2.add(newEvent._url); // claim the URL key so it won't re-process
        }
        if (newEvent.id && newEvent.id !== evId) {
          if (processedEventIds2.has(newEvent.id) || existingLedgerEventIds.has(newEvent.id)) {
            continue; // sibling (UID key) already handled — skip this URL entry
          }
          processedEventIds2.add(newEvent.id); // claim the UID key so it won't re-process
        }

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
            provider_etag: newEvent._etag || null,
            task_updated_at: existingTask._updated_at || null,
            event_url: newEvent.eventUrl || null,
            status: 'active'
          });
          continue;
        }

        // Check if event is in the past (999.1605: all-day events compare by
        // calendar date — new Date('YYYY-MM-DD') is UTC midnight, which lands
        // before local todayStart in negative-offset timezones and skipped
        // TODAY's all-day events)
        var isPast = isEventPast(newEvent.startDateTime, !!newEvent.isAllDay, todayKey, todayStart);

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
            provider_etag: newEvent._etag || null,
            event_url: newEvent.eventUrl || null,
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
              origin: JUGGLER_ORIGIN,
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

          // 999.1627 (David ruling 2026-07-15): provider_event_id is the SOLE
          // dedup identity for incoming provider events — already enforced
          // above this point (existingLedgerEventIds.has(evId) skip for
          // events with any known ledger row; the existingTask check for
          // events already linked via the task's own event-id column). By
          // the time we reach here, this event id is NOT already known.
          // A title+date collision with a different task is therefore only
          // a NON-DESTRUCTIVE "possible duplicate" hint — it must NOT
          // suppress creating this event's own task/ledger row (that used
          // to silently swallow the event into an unrelated task, discarding
          // its own time and provider_event_id). Recurring titles like
          // "Lunch" collide routinely; a visible duplicate task beats an
          // invisibly hijacked one. The hint is recorded via the existing
          // sync_history logSyncAction pattern below (action
          // 'possible_duplicate') — no new schema/UI.
          var possibleDupTask = allTasks.find(function(t) {
            return t.text === newEvent.title && t.date === jd.date;
          });

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

          var calIngestMode = calIngestModeMap[newEvent._calendarId] || 'task';
          var isReminder = !newEvent.isAllDay && calIngestMode === 'reminder';
          var taskRow = {
            id: newTaskId,
            user_id: userId,
            text: newEvent.title,
            scheduled_at: newScheduledAt,
            dur: evDur,
            pri: 'P3',
            status: '',
            // Legacy when='allday' kept for downstream sites that still read it
            // (scheduler skip-gate, outbound push, AllDayBanner, CalendarView).
            // For non-all-day events `when` stays empty — placement_mode='fixed'
            // is now the canonical fixed signal.
            when: newEvent.isAllDay ? 'allday' : '',
            placement_mode: newEvent.isTransparent ? PLACEMENT_MODES.REMINDER : (newEvent.isAllDay ? PLACEMENT_MODES.ALL_DAY : (isReminder ? PLACEMENT_MODES.REMINDER : PLACEMENT_MODES.FIXED)),
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
            provider_etag: newEvent._etag || null,
            event_url: newEvent.eventUrl || null,
            status: 'active'
          });

          pStats2.pulled++;
          stats.pulled++;
          logSyncAction(pid2, 'created', {
            taskId: newTaskId, taskText: newEvent.title, eventId: newEvent.id,
            detail: 'New task from ' + pid2,
            calendarName: calendarLabels[pid2] || null
          });
          // 999.1627: non-destructive possible-duplicate hint (see comment
          // above possibleDupTask) — logged AFTER the real 'created' action
          // so the new task/ledger row always exists first.
          if (possibleDupTask) {
            logSyncAction(pid2, 'possible_duplicate', {
              taskId: newTaskId, taskText: newEvent.title, eventId: newEvent.id,
              detail: 'Title/date matches existing task "' + possibleDupTask.text +
                '" (' + possibleDupTask.id + ') — created as a separate task; review for a possible duplicate.',
              calendarName: calendarLabels[pid2] || null
            });
          }
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
    // 999.1025 sub-leg 3: extracted verbatim into the calendar slice facade
    // (REFACTOR mode — no behavior change). See runSyncWritePhase's JSDoc in
    // slices/calendar/facade.js for the exact boundary this call replaces
    // (previously inlined here) and the earlyReturn contract.
    var writeResult = await calendarFacade.runSyncWritePhase(userId, {
      taskInserts: taskInserts,
      taskUpdates: taskUpdates,
      taskDeletes: taskDeletes,
      ledgerUpdates: ledgerUpdates,
      ledgerInserts: ledgerInserts,
      historyInserts: historyInserts,
      ledgerRecords: ledgerRecords,
      tasksById: tasksById,
      providerIds: providerIds,
      providerData: providerData,
      existingLockToken: _syncLockToken,
      existingLockStart: _syncLockStart,
      prePushHeartbeat: _prePushHeartbeat
    }, syncStart, emitProgress);
    if (writeResult.earlyReturn === 'timeout') {
      return res.status(200).json(Object.assign({}, stats, { error: 'sync_timeout' }));
    }
    if (writeResult.earlyReturn === 'lock_busy') {
      return res.status(409).json({ error: 'Scheduler is busy. Try again in a few seconds.', retryAfter: 30 });
    }
    if (writeResult.earlyReturn === 'lock_lost') {
      return res.status(503).json({ error: 'Sync lock lost. Please retry.', retryAfter: 5 });
    }
    var preSyncMaxUpdatedAt = writeResult.preSyncMaxUpdatedAt;

    // === Phase 5: Build the affected-task-id list and notify ===
    // (runs AFTER lock release so scheduler can pick up)
    emitProgress('finalize', 'Finalizing...', 95);

    var deletedDuringSync = taskDeletes.map(function(d) { return d.id; });
    var touchedRows;
    if (preSyncMaxUpdatedAt) {
      touchedRows = await getDb()('tasks_v')
        .where('user_id', userId)
        .where('updated_at', '>', preSyncMaxUpdatedAt)
        .pluck('id');
    } else {
      touchedRows = await getDb()('tasks_v').where('user_id', userId).pluck('id');
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
      var provLabel = PROVIDER_NAMES[h.provider] || h.provider || 'Calendar';
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
        case 'error': {
          var errDetail = null;
          try { if (h.error_detail) errDetail = JSON.parse(h.error_detail); } catch (_pe) { /* Ignore JSON parse errors in error_detail */ }
          return { type: 'error', text: h.task_text, message: errDetail ? errDetail.summary : (h.detail || 'Sync error'), errorDetail: errDetail || undefined, hasIssue: true };
        }
        default:
          return { type: 'info', text: h.task_text, message: h.detail || h.action };
      }
    });

    res.json(stats);
  } catch (error) {
    logger.error('Cal sync error:', error);
    // Release the pre-push lock if it was acquired but never handed off to
    // runSyncWritePhase (which manages its own release). This prevents lock
    // leaks when an error occurs between lock acquisition and the write phase.
    if (_prePushHeartbeat) clearInterval(_prePushHeartbeat);
    if (_syncLockToken) {
      try { await calendarFacade.releaseLock(userId, _syncLockToken); } catch (_le) { /* best-effort */ }
    }
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

    // Also check if there are local task changes since last sync.
    // Use the most recent sync across all providers — not just GCal — so
    // MSFT-only and Apple-only users also get local-change detection.
    var userId = req.user.id;
    var lastSynced = [
      req.user.gcal_last_synced_at,
      req.user.msft_cal_last_synced_at,
      req.user.apple_cal_last_synced_at,
    ].filter(Boolean).sort().pop() || null;
    if (lastSynced) {
      var localChanges = await calendarFacade.countLocalChangesSince(userId, lastSynced);
      if (localChanges && parseInt(localChanges.cnt) > 0) {
        result.hasChanges = true;
        result.localChanges = parseInt(localChanges.cnt);
      }
    }

    res.json(result);
  } catch (error) {
    logger.error('Cal has-changes error:', error);
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

    // Get the most recent distinct sync run IDs with their timestamps, plus
    // their detail rows — routed through the calendar slice facade.
    var historyResult = await calendarFacade.getSyncHistory(userId, { runLimit: runLimit });
    var recentRuns = historyResult.recentRuns;

    if (recentRuns.length === 0) {
      return res.json({ runs: [] });
    }

    var rows = historyResult.rows;

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
    logger.error('Sync history error:', error);
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
    var userRow = await getDb()('users').where('id', userId).first();
    var days = Math.min(parseInt(req.query.days, 10) || 7, 60);

    var report = await calendarFacade.auditCalendarSync(userId, userRow, days);
    res.json(report);
  } catch (error) {
    logger.error('Cal audit error:', error);
    res.status(500).json({ error: 'Failed to audit calendar sync' });
  }
}

module.exports = { sync, hasChanges, getSyncHistory, audit, withinCdnGrace, applyTerminalDelete };

// 999.1192 (CalSyncTriggerPort inversion): register the HTTP-shaped sync entry
// with the lib/cal-sync-trigger seam. The task slice's skip/cancel outbound
// trigger used to lazy-require THIS controller from inside the domain layer and
// construct the fake req/res itself; the request-shaped call now lives here,
// controller-side, and the slice depends only on the seam. sync() itself is
// untouched (999.1025's territory). Load-time registration: routes load this
// controller at boot, before any task mutation can fire the trigger.
require('../lib/cal-sync-trigger').registerCalSyncTrigger(function (args) {
  return sync(
    { user: { id: args.userId }, body: {}, query: { trigger: 'auto' } },
    { json: function () {}, status: function () { return { json: function () {} }; } }
  );
});
