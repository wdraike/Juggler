/**
 * missing-event-decision.js — pure miss-ladder use-case for cal-sync's sync().
 *
 * 999.1025 increment 3 (FIRST EXTRACTION SEAM): carves the `task && !event`
 * branch of the per-ledger loop out of controllers/cal-sync.controller.js into
 * a PURE decision function — decisions in, effects out. No DB, no HTTP, no
 * provider clients: given a fully-resolved context and injected pure helpers,
 * it returns a plain descriptor of the mutations the controller must apply.
 *
 * Covers (each traces to a shipped Apple/GCal soak-test behavior, pinned by W4
 * axes E/E2/J/K/P + W5 A2):
 *   - miss_count ladder (first-miss wait / increment / threshold delete / reset)
 *   - CDN-grace gating (grace short-circuits BEFORE the increment — order matters)
 *   - past-time recurring-instance ledger cleanup (never delete the task row)
 *   - recurring "ponytail" ledger cleanup (no re-create → no duplicate-event loop)
 *   - repush on user-content change after a miss (last_user_hash guard)
 *   - multi-provider miss-guard (Bug #4): delete the task only when NO other
 *     provider still tracks it as active; otherwise ledger-only + stop the loop
 *
 * PURITY / KNOWN BUG: `withinCdnGrace` is injected as a dependency. Its raw
 * `new Date(ledger.last_pushed_at)` parse is a KNOWN pinned bug (W5 A1-5 /
 * DIGEST-2026-07-16) that lives in cal-sync.controller.js and is DELIBERATELY
 * NOT fixed or re-implemented here — this use-case only consults the injected
 * boolean-returning helper, preserving behavior exactly.
 *
 * @param {Object} ctx
 *   @param {Object}   ctx.task            resolved task row (never null in this branch)
 *   @param {Object}   ctx.ledger          the ledger row whose event is missing
 *   @param {string}   ctx.pid             provider id ('gcal' | 'msft' | 'apple')
 *   @param {Object}   ctx.pd              provider data ({ partialFailure })
 *   @param {Date}     ctx.now             sync clock
 *   @param {Date}     ctx.windowStart     sync window lower bound
 *   @param {Date}     ctx.windowEnd       sync window upper bound
 *   @param {string[]} ctx.providerIds     all providers processed this sync
 *   @param {Object}   ctx.ledgerByProvider  { pid: ledgerRow[] }
 *   @param {Object[]} ctx.allTasks        all tasks (for dependency transfers)
 *   @param {Object}   ctx.calendarLabels  { pid: label } for sync_history rows
 *   @param {number}   ctx.MISS_THRESHOLD  consecutive-miss delete threshold
 *   @param {string}   ctx.JUGGLER_ORIGIN  the 'juggler' origin sentinel
 * @param {Object} deps  injected pure helpers
 *   @param {function(Object,string):boolean} deps.withinCdnGrace
 *   @param {function(Object):string} deps.userHash
 *   @param {function(Object):string} deps.taskHash
 * @returns {{
 *   ledgerUpdates: Array<{id:*, fields:Object}>,
 *   taskDeletes: Array<{id:*, dependencyTransfers:Array}>,
 *   recreateTaskIds: Array<*>,
 *   logs: Array<{provider:string, action:string, opts:Object}>,
 *   statsDelta: {deleted_remote:number},
 *   stop: boolean
 * }} decision descriptor. `stop` mirrors the original `continue;` — the caller
 *    must skip the rest of this ledger iteration when true.
 */
'use strict';

function decideMissingEventSync(ctx, deps) {
  var task = ctx.task;
  var ledger = ctx.ledger;
  var pid = ctx.pid;
  var pd = ctx.pd;
  var now = ctx.now;
  var windowStart = ctx.windowStart;
  var windowEnd = ctx.windowEnd;
  var providerIds = ctx.providerIds;
  var ledgerByProvider = ctx.ledgerByProvider;
  var allTasks = ctx.allTasks;
  var calendarLabels = ctx.calendarLabels;
  var MISS_THRESHOLD = ctx.MISS_THRESHOLD;
  var JUGGLER_ORIGIN = ctx.JUGGLER_ORIGIN;

  var withinCdnGrace = deps.withinCdnGrace;
  var userHash = deps.userHash;
  var taskHash = deps.taskHash;

  // ── effect buffers (decisions in, effects out) ────────────────────────────
  var ledgerUpdates = [];
  var taskDeletes = [];
  var recreateTaskIds = [];
  var logs = [];
  var statsDelta = { deleted_remote: 0 };

  function logSyncAction(provider, action, opts) {
    logs.push({ provider: provider, action: action, opts: opts });
  }
  function result(stop) {
    return {
      ledgerUpdates: ledgerUpdates,
      taskDeletes: taskDeletes,
      recreateTaskIds: recreateTaskIds,
      logs: logs,
      statsDelta: statsDelta,
      stop: !!stop
    };
  }

  // ── moved verbatim from cal-sync.controller.js sync() `task && !event` ─────
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
    // Past-time recurring instance guard: providers don't return past events in their
    // calendar view, so a past recurring_instance will always appear as task&&!event
    // after its scheduled time. Without this guard it would accumulate miss_count and
    // be catastrophically deleted after MISS_THRESHOLD syncs.
    // Fix: detect past-time recurring instances here and only clean up the ledger row —
    // never delete the task itself.
    var _taskScheduledAt = task._scheduled_at instanceof Date
      ? task._scheduled_at
      : new Date(String(task._scheduled_at).replace(' ', 'T') + 'Z');
    if (task.taskType === 'recurring_instance' && !isNaN(_taskScheduledAt) && _taskScheduledAt < now) {
      // Ledger-only cleanup: stop tracking this past instance in the ledger.
      // The task row itself is preserved — it's historical data.
      ledgerUpdates.push({ id: ledger.id, fields: {
        status: 'deleted_local', task_id: null, miss_count: 0
      }});
      logSyncAction(pid, 'past_recurring_cleanup', {
        taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
        detail: 'Past recurring instance — provider does not return past events; ledger cleaned only',
        calendarName: calendarLabels[pid] || null
      });
    } else if (withinCdnGrace(ledger, pid)) {
      // CDN propagation window — treat as not-yet-visible, not missing
    } else if (ledger.origin === JUGGLER_ORIGIN
        && task.taskType === 'recurring_instance'
        && (ledger.miss_count || 0) >= 1) {
      // ponytail: recurring instances are scheduler-owned — the scheduler
      // moves them to new dates and the sync should follow, not re-create.
      // A recurring instance whose event goes missing on the provider is
      // almost always a stale ledger from a date the scheduler has already
      // moved past. Re-creating spawns duplicate events (observed: 44 ledger
      // rows, 42 deleted_local for one Cut Grass instance). Clean the ledger
      // only — the next push phase will create a fresh event at the current
      // date if the task is still active and in the sync window.
      ledgerUpdates.push({ id: ledger.id, fields: {
        status: 'deleted_local', task_id: null, miss_count: 0
      }});
      logSyncAction(pid, 'recurring_ledger_cleanup', {
        taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
        detail: 'Recurring instance event missing — ledger cleaned (no re-create to avoid dup loop)',
        calendarName: calendarLabels[pid] || null
      });
    } else if (ledger.origin === JUGGLER_ORIGIN
        && ledger.last_user_hash !== null
        && userHash(task) !== ledger.last_user_hash
        && (ledger.miss_count || 0) >= 1) {
      // User-editable content changed AND event is gone after at least one miss —
      // the event link is broken. Re-create.
      // Guarded on last_user_hash !== null: legacy rows (no stored user hash) fall
      // through to the normal deletion ladder rather than triggering a spurious repush.
      // NOT reached for recurring_instance — the guard above catches those first.
      recreateTaskIds.push(task.id);
      ledgerUpdates.push({ id: ledger.id, fields: {
        status: 'replaced', task_id: null, provider_event_id: null, miss_count: 0
      }});
      logSyncAction(pid, 'repush', {
        taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
        detail: pid + ' event gone but juggler task content changed — will re-create',
        calendarName: calendarLabels[pid] || null
      });
    } else if (ledger.origin === JUGGLER_ORIGIN
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
          // === Fix Bug #4: Check multi-provider before deleting task ===
          // If the task is still on OTHER providers, don't delete the task — just delete the ledger row.
          // Only delete the task when ALL providers have marked it missing.
          var otherProviders = providerIds.filter(function(op) {
            return op !== pid;
          });
          var hasOtherActive = false;
          for (var opi = 0; opi < otherProviders.length; opi++) {
            var otherLedger = (ledgerByProvider[otherProviders[opi]] || []).find(function(l) {
              return l.task_id === task.id && l.status === 'active';
            });
            if (otherLedger) {
              hasOtherActive = true;
              break;
            }
          }

          if (hasOtherActive) {
            // Task exists on another provider — delete this ledger row only
            ledgerUpdates.push({ id: ledger.id, fields: {
              status: 'deleted_remote', task_id: null, miss_count: newMissCount
            }});
            statsDelta.deleted_remote++;
            logSyncAction(pid, 'deleted_remote_partial', {
              taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
              detail: 'Event deleted in ' + pid + ' but still active on another provider — ledger removed, task kept',
              calendarName: calendarLabels[pid] || null
            });
            return result(true);
          }

          // Confirmed missing after multiple syncs AND no other provider has it — delete the task.
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
          statsDelta.deleted_remote++;
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

  return result(false);
}

module.exports = { decideMissingEventSync: decideMissingEventSync };
