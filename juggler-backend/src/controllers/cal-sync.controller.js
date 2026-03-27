/**
 * Unified Calendar Sync Controller
 *
 * Single endpoint that syncs all connected calendar providers in one pass.
 * Uses the provider adapter pattern for extensibility.
 *
 * Conflict resolution: last-modified-timestamp wins (newest wins).
 * Fixed tasks and habit sources always push (Juggler wins).
 */

var crypto = require('crypto');
var db = require('../db');
var { getConnectedAdapters } = require('../lib/cal-adapters');
var { runScheduleAndPersist } = require('../scheduler/runSchedule');
var { rowToTask } = require('./task.controller');
var { localToUtc } = require('../scheduler/dateHelpers');
var { taskHash, isoToJugglerDate, toMySQLDate, DEFAULT_TIMEZONE } = require('./cal-sync-helpers');

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

/**
 * Determine winner when both task and event have changed.
 * Returns 'juggler' or 'provider'.
 */
function resolveConflict(task, event, ledger) {
  // Fixed tasks and habit sources always push Juggler's version
  var isFixed = task.when && task.when.indexOf('fixed') >= 0;
  var isHabitSource = task._habit && !task._generated;
  if (isFixed || isHabitSource) return 'juggler';

  // Last-modified wins
  if (task._updated_at && event.lastModified) {
    var taskTime = new Date(task._updated_at).getTime();
    var eventTime = new Date(event.lastModified).getTime();
    if (!isNaN(taskTime) && !isNaN(eventTime)) {
      return taskTime >= eventTime ? 'juggler' : 'provider';
    }
  }

  // Fallback: origin wins
  return ledger.origin === 'juggler' ? 'juggler' : 'provider';
}

/**
 * POST /api/cal/sync — unified bidirectional sync for all connected providers.
 * Sync window: 90 days back + 60 days forward.
 */
async function sync(req, res) {
  try {
    var userId = req.user.id;
    var userRow = await db('users').where('id', userId).select('timezone').first();
    var tz = (userRow && userRow.timezone) || DEFAULT_TIMEZONE;
    var year = new Date().getFullYear();
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    var windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 90);
    var windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 60);

    var stats = { pushed: 0, pulled: 0, deleted_local: 0, deleted_remote: 0, errors: [], providers: {} };

    // === Phase 0: Run scheduler (skip if it ran recently) ===
    try {
      var cacheRow = await db('user_config').where({ user_id: userId, config_key: 'schedule_cache' }).first();
      var cacheAge = Infinity;
      if (cacheRow) {
        try {
          var cached = JSON.parse(cacheRow.config_value);
          if (cached.generatedAt) cacheAge = Date.now() - new Date(cached.generatedAt).getTime();
        } catch (e) {}
      }
      if (cacheAge > 30000) {
        var schedResult = await runScheduleAndPersist(userId);
        stats.scheduler = { moved: schedResult.moved, tasks: schedResult.tasks };
      } else {
        console.log('[CAL-SYNC] scheduler cache is fresh (' + Math.round(cacheAge / 1000) + 's old), skipping Phase 0');
      }
    } catch (schedErr) {
      console.error('Cal sync Phase 0 (scheduler) error:', schedErr);
      stats.errors.push({ phase: 'scheduler', error: schedErr.message });
    }

    // === Phase 1: Gather data from all connected providers ===
    var connectedAdapters = getConnectedAdapters(req.user);
    if (connectedAdapters.length === 0) {
      return res.json(stats);
    }

    // Get tokens and fetch events for each provider
    var providerData = {}; // { providerId: { token, events, eventsById } }
    for (var ai = 0; ai < connectedAdapters.length; ai++) {
      var adapter = connectedAdapters[ai];
      try {
        var token = await adapter.getValidAccessToken(req.user);
        var timeMin = windowStart.toISOString();
        var timeMax = windowEnd.toISOString();
        var events = await adapter.listEvents(token, timeMin, timeMax, userId);

        var eventsById = {};
        for (var ei = 0; ei < events.length; ei++) {
          eventsById[events[ei].id] = events[ei];
        }

        providerData[adapter.providerId] = { token: token, events: events, eventsById: eventsById, adapter: adapter };
        stats.providers[adapter.providerId] = { pushed: 0, pulled: 0, deleted_local: 0, deleted_remote: 0, errors: [] };
      } catch (err) {
        var errMsg = err.message || '';
        var isTokenExpired = errMsg.includes('invalid_grant') || errMsg.includes('Token has been expired or revoked');

        if (isTokenExpired) {
          // Clear dead token so status endpoint reports disconnected
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
    }

    // Load unified ledger and all tasks once
    var ledgerRecords = await db('cal_sync_ledger')
      .where('user_id', userId)
      .where('status', 'active')
      .select();

    var allTaskRows = await db('tasks')
      .where('user_id', userId)
      .whereNotNull('scheduled_at')
      .select();

    var allTasks = allTaskRows.map(function(r) {
      var t = rowToTask(r, tz);
      t._habit = r.habit;
      t._generated = r.generated;
      t._scheduled_at = r.scheduled_at;
      t._updated_at = r.updated_at;
      t._marker = r.marker;
      t.marker = !!r.marker;
      return t;
    });

    var tasksById = {};
    for (var ti = 0; ti < allTasks.length; ti++) {
      tasksById[allTasks[ti].id] = allTasks[ti];
    }

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

    var providerIds = Object.keys(providerData);
    for (var pi = 0; pi < providerIds.length; pi++) {
      var pid = providerIds[pi];
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

      for (var pli = 0; pli < pLedger.length; pli++) {
        var ledger = pLedger[pli];
        var task = ledger.task_id ? tasksById[ledger.task_id] : null;
        var event = ledger.provider_event_id ? pEventsById[ledger.provider_event_id] : null;

        if (ledger.task_id) processedTaskIds.add(ledger.task_id);
        if (ledger.provider_event_id) processedEventIds.add(ledger.provider_event_id);

        try {
          // --- Habit/generated cleanup ---
          if (task && (task._habit || task._generated) && event) {
            try {
              await pAdapter.deleteEvent(pToken, ledger.provider_event_id);
              await delay(100);
            } catch (e2) {
              if (!e2.message.includes('404') && !e2.message.includes('410')) throw e2;
            }
            await db.transaction(async function(trx) {
              await trx('tasks').where('id', task.id).update({
                [pAdapter.getEventIdColumn()]: null, updated_at: db.fn.now()
              });
              await trx('cal_sync_ledger').where('id', ledger.id).update({
                status: 'deleted_local', provider_event_id: null, synced_at: db.fn.now()
              });
            });
            pStats.deleted_local++;
            stats.deleted_local++;
            continue;
          }
          if (task && (task._habit || task._generated) && !event) {
            await db.transaction(async function(trx) {
              await trx('tasks').where('id', task.id).update({
                [pAdapter.getEventIdColumn()]: null, updated_at: db.fn.now()
              });
              await trx('cal_sync_ledger').where('id', ledger.id).update({
                status: 'deleted_local', provider_event_id: null, synced_at: db.fn.now()
              });
            });
            continue;
          }

          // --- Past non-done juggler-origin cleanup ---
          if (task && event && ledger.origin === 'juggler' && task._scheduled_at) {
            var taskScheduledAt = task._scheduled_at instanceof Date ? task._scheduled_at : new Date(String(task._scheduled_at).replace(' ', 'T') + 'Z');
            var taskIsPast = taskScheduledAt < todayStart;
            var taskNotDone = task.status !== 'done' && task.status !== 'skip';
            if (taskIsPast && taskNotDone) {
              try {
                await pAdapter.deleteEvent(pToken, ledger.provider_event_id);
                await delay(100);
              } catch (e3) {
                if (!e3.message.includes('404') && !e3.message.includes('410')) throw e3;
              }
              await db.transaction(async function(trx) {
                await trx('tasks').where('id', task.id).update({
                  [pAdapter.getEventIdColumn()]: null, updated_at: db.fn.now()
                });
                await trx('cal_sync_ledger').where('id', ledger.id).update({
                  status: 'deleted_local', provider_event_id: null, synced_at: db.fn.now()
                });
              });
              pStats.deleted_local++;
              stats.deleted_local++;
              continue;
            }
          }

          // --- Both exist: check for changes ---
          if (task && event) {
            var isHabitSource = task._habit && !task._generated;

            var currentTaskHash = taskHash(task);
            var currentEventHash = pAdapter.eventHash(event);
            var taskChanged = currentTaskHash !== ledger.last_pushed_hash;
            var eventChanged = currentEventHash !== ledger.last_pulled_hash;

            var isFixed = task.when && task.when.indexOf('fixed') >= 0;

            if (taskChanged && eventChanged) {
              var winner = resolveConflict(task, event, ledger);
              if (winner === 'juggler') {
                await pAdapter.updateEvent(pToken, ledger.provider_event_id, task, year, tz);
                await delay(100);
                pStats.pushed++;
                stats.pushed++;
              } else {
                if (!isHabitSource && !isFixed) {
                  var updateFields = pAdapter.applyEventToTaskFields(event, tz);
                  await db('tasks').where('id', task.id).update(updateFields);
                  pStats.pulled++;
                  stats.pulled++;
                }
              }
            } else if (taskChanged) {
              await pAdapter.updateEvent(pToken, ledger.provider_event_id, task, year, tz);
              await delay(100);
              pStats.pushed++;
              stats.pushed++;
            } else if (eventChanged) {
              if (!isHabitSource && !isFixed) {
                var updateFields2 = pAdapter.applyEventToTaskFields(event, tz);
                await db('tasks').where('id', task.id).update(updateFields2);
                pStats.pulled++;
                stats.pulled++;
              }
            }

            // Update ledger record
            await db('cal_sync_ledger').where('id', ledger.id).update({
              last_pushed_hash: taskChanged ? taskHash(task) : (ledger.last_pushed_hash || taskHash(task)),
              last_pulled_hash: pAdapter.eventHash(event),
              event_summary: event.title || task.text,
              event_start: event.startDateTime || null,
              event_end: event.endDateTime || null,
              event_all_day: event.isAllDay ? 1 : 0,
              last_modified_at: toMySQLDate(event.lastModified),
              task_updated_at: task._updated_at || null,
              synced_at: db.fn.now()
            });

          } else if (task && !event) {
            // Event deleted from provider
            if (ledger.provider_event_id) {
              var cachedStart = ledger.event_start;
              var eventInWindow = false;
              if (cachedStart) {
                var cachedDate = new Date(cachedStart);
                eventInWindow = cachedDate >= windowStart && cachedDate <= windowEnd;
              }
              if (eventInWindow) {
                // Delete the task (event was deleted on provider side)
                await db.transaction(async function(trx) {
                  var deletedDeps = typeof task.dependsOn === 'object' ? task.dependsOn : [];
                  var affected = await trx('tasks')
                    .where('user_id', userId)
                    .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(task.id)])
                    .select('id', 'depends_on');
                  for (var ai2 = 0; ai2 < affected.length; ai2++) {
                    var a = affected[ai2];
                    var deps = typeof a.depends_on === 'string'
                      ? JSON.parse(a.depends_on || '[]') : (a.depends_on || []);
                    var newDeps = deps.filter(function(d) { return d !== task.id; });
                    deletedDeps.forEach(function(d) { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
                    await trx('tasks').where({ id: a.id, user_id: userId })
                      .update({ depends_on: JSON.stringify(newDeps), updated_at: db.fn.now() });
                  }
                  await trx('tasks').where('id', task.id).del();
                  await trx('cal_sync_ledger').where('id', ledger.id).update({
                    status: 'deleted_remote',
                    task_id: null,
                    synced_at: db.fn.now()
                  });
                });
                pStats.deleted_remote++;
                stats.deleted_remote++;
              }
            }

          } else if (!task && event) {
            // Task deleted from Juggler — delete from provider
            try {
              await pAdapter.deleteEvent(pToken, ledger.provider_event_id);
              await delay(100);
            } catch (e) {
              if (!e.message.includes('404') && !e.message.includes('410')) throw e;
            }
            await db('cal_sync_ledger').where('id', ledger.id).update({
              status: 'deleted_local',
              provider_event_id: null,
              synced_at: db.fn.now()
            });
            pStats.deleted_local++;
            stats.deleted_local++;

          } else {
            // Both gone
            await db('cal_sync_ledger').where('id', ledger.id).update({
              status: 'deleted_local',
              synced_at: db.fn.now()
            });
          }

        } catch (e) {
          var errObj = {
            phase: 'ledger', provider: pid,
            ledgerId: ledger.id, taskId: ledger.task_id,
            eventId: ledger.provider_event_id, error: e.message
          };
          pStats.errors.push(errObj);
          stats.errors.push(errObj);
        }
      }
    }

    // === Phase 3: Handle new items (no ledger record) ===

    for (var pi2 = 0; pi2 < providerIds.length; pi2++) {
      var pid2 = providerIds[pi2];
      var pd2 = providerData[pid2];
      var pAdapter2 = pd2.adapter;
      var pToken2 = pd2.token;
      var pEventsById2 = pd2.eventsById;
      var pStats2 = stats.providers[pid2];
      var processedTaskIds2 = processedTaskIdsByProvider[pid2];
      var processedEventIds2 = processedEventIdsByProvider[pid2];
      var eventIdCol = pAdapter2.getEventIdColumn();

      // 3a: Push unledgered tasks to this provider
      for (var ti2 = 0; ti2 < allTasks.length; ti2++) {
        var newTask = allTasks[ti2];
        if (processedTaskIds2.has(newTask.id)) continue;

        if (newTask._habit || newTask._generated) continue;
        if (!newTask.date) continue;
        if (!newTask.time && newTask.when !== 'allday') continue;

        // Skip if task already has this provider's event ID (may have lost ledger record)
        var existingEvId = newTask[eventIdCol === 'gcal_event_id' ? 'gcalEventId' : 'msftEventId'];
        if (existingEvId) continue;

        // Only push future tasks
        var taskSA = newTask._scheduled_at instanceof Date ? newTask._scheduled_at : new Date(String(newTask._scheduled_at).replace(' ', 'T') + 'Z');
        if (taskSA < todayStart) continue;
        if (taskSA > windowEnd) continue;

        try {
          var result = await pAdapter2.createEvent(pToken2, newTask, year, tz);
          await delay(100);

          // Normalize the created event to get hash
          var createdNorm = pAdapter2.normalizeEvent ? pAdapter2.normalizeEvent(result.raw) : null;

          await db.transaction(async function(trx) {
            await trx('tasks').where('id', newTask.id).update({
              [eventIdCol]: result.providerEventId,
              updated_at: db.fn.now()
            });

            await trx('cal_sync_ledger').insert({
              user_id: userId,
              provider: pid2,
              task_id: newTask.id,
              provider_event_id: result.providerEventId,
              origin: 'juggler',
              last_pushed_hash: taskHash(newTask),
              last_pulled_hash: createdNorm ? pAdapter2.eventHash(createdNorm) : null,
              event_summary: newTask.text,
              event_start: createdNorm ? createdNorm.startDateTime : null,
              event_end: createdNorm ? createdNorm.endDateTime : null,
              event_all_day: (newTask.when === 'allday') ? 1 : 0,
              task_updated_at: newTask._updated_at || null,
              last_modified_at: toMySQLDate(createdNorm ? createdNorm.lastModified : null),
              status: 'active',
              synced_at: db.fn.now(),
              created_at: db.fn.now()
            });
          });

          // Mark this event as processed so Phase 3b won't pull it back
          processedEventIds2.add(result.providerEventId);
          processedTaskIds2.add(newTask.id);

          pStats2.pushed++;
          stats.pushed++;
        } catch (e) {
          var errObj2 = { phase: 'push_new', provider: pid2, taskId: newTask.id, error: e.message };
          pStats2.errors.push(errObj2);
          stats.errors.push(errObj2);
        }
      }

      // 3b: Pull unledgered events from this provider
      var eventIds = Object.keys(pEventsById2);
      for (var ei2 = 0; ei2 < eventIds.length; ei2++) {
        var evId = eventIds[ei2];
        if (processedEventIds2.has(evId)) continue;
        var newEvent = pEventsById2[evId];

        // Check if already linked to a task via the event ID column
        var existingTask = allTasks.find(function(t) {
          return t[eventIdCol === 'gcal_event_id' ? 'gcalEventId' : 'msftEventId'] === evId;
        });
        if (existingTask) {
          var origin = existingTask.id.startsWith(pid2 + '_') ? pid2 : 'juggler';
          await db('cal_sync_ledger').insert({
            user_id: userId,
            provider: pid2,
            task_id: existingTask.id,
            provider_event_id: evId,
            origin: origin,
            last_pushed_hash: taskHash(existingTask),
            last_pulled_hash: pAdapter2.eventHash(newEvent),
            event_summary: newEvent.title || existingTask.text,
            event_start: newEvent.startDateTime || null,
            event_end: newEvent.endDateTime || null,
            event_all_day: newEvent.isAllDay ? 1 : 0,
            last_modified_at: toMySQLDate(newEvent.lastModified),
            task_updated_at: existingTask._updated_at || null,
            status: 'active',
            synced_at: db.fn.now(),
            created_at: db.fn.now()
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
          await db('cal_sync_ledger').insert({
            user_id: userId,
            provider: pid2,
            task_id: null,
            provider_event_id: evId,
            origin: pid2,
            last_pushed_hash: null,
            last_pulled_hash: pAdapter2.eventHash(newEvent),
            event_summary: newEvent.title,
            event_start: newEvent.startDateTime || null,
            event_end: newEvent.endDateTime || null,
            event_all_day: newEvent.isAllDay ? 1 : 0,
            last_modified_at: toMySQLDate(newEvent.lastModified),
            status: 'active',
            synced_at: db.fn.now(),
            created_at: db.fn.now()
          });
          continue;
        }

        // Skip events that originated from Juggler (round-trip prevention)
        // Check both plain text and raw body (Microsoft may return HTML-wrapped content)
        var evDesc = newEvent.description || '';
        var evRawBody = (newEvent._raw && newEvent._raw.body && newEvent._raw.body.content) || '';
        if (evDesc.indexOf('Synced from Raike & Sons') !== -1 || evDesc.indexOf('Synced from Juggler') !== -1
            || evRawBody.indexOf('Synced from Raike & Sons') !== -1 || evRawBody.indexOf('Synced from Juggler') !== -1) {
          await db('cal_sync_ledger').insert({
            user_id: userId,
            provider: pid2,
            task_id: null,
            provider_event_id: evId,
            origin: 'juggler',
            last_pushed_hash: null,
            last_pulled_hash: pAdapter2.eventHash(newEvent),
            event_summary: newEvent.title,
            event_start: newEvent.startDateTime || null,
            event_end: newEvent.endDateTime || null,
            event_all_day: newEvent.isAllDay ? 1 : 0,
            last_modified_at: toMySQLDate(newEvent.lastModified),
            status: 'active',
            synced_at: db.fn.now(),
            created_at: db.fn.now()
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
            await db('cal_sync_ledger').insert({
              user_id: userId,
              provider: pid2,
              task_id: dupTask.id,
              provider_event_id: newEvent.id,
              origin: pid2,
              last_pushed_hash: taskHash(dupTask),
              last_pulled_hash: pAdapter2.eventHash(newEvent),
              event_summary: newEvent.title,
              event_start: newEvent.startDateTime || null,
              event_end: newEvent.endDateTime || null,
              event_all_day: newEvent.isAllDay ? 1 : 0,
              last_modified_at: toMySQLDate(newEvent.lastModified),
              task_updated_at: dupTask._updated_at || null,
              status: 'active',
              synced_at: db.fn.now(),
              created_at: db.fn.now()
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
            rigid: 1,
            status: '',
            when: newEvent.isAllDay ? 'allday' : 'fixed',
            [eventIdCol]: newEvent.id,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
          };
          if (newEvent.description) {
            taskRow.notes = newEvent.description;
          }
          if (newEvent.isTransparent) {
            taskRow.marker = true;
          }

          var newTaskObj = rowToTask(taskRow, tz);

          await db.transaction(async function(trx) {
            await trx('tasks').insert(taskRow);

            await trx('cal_sync_ledger').insert({
              user_id: userId,
              provider: pid2,
              task_id: newTaskId,
              provider_event_id: newEvent.id,
              origin: pid2,
              last_pushed_hash: taskHash(newTaskObj),
              last_pulled_hash: pAdapter2.eventHash(newEvent),
              event_summary: newEvent.title,
              event_start: newEvent.startDateTime || null,
              event_end: newEvent.endDateTime || null,
              event_all_day: newEvent.isAllDay ? 1 : 0,
              last_modified_at: toMySQLDate(newEvent.lastModified),
              status: 'active',
              synced_at: db.fn.now(),
              created_at: db.fn.now()
            });
          });

          pStats2.pulled++;
          stats.pulled++;
        } catch (e) {
          var errObj3 = { phase: 'pull_new', provider: pid2, eventId: evId, error: e.message };
          pStats2.errors.push(errObj3);
          stats.errors.push(errObj3);
        }
      }
    }

    // === Phase 4: Update last-synced timestamps for all providers ===
    var userUpdate = { updated_at: db.fn.now() };
    for (var pi3 = 0; pi3 < providerIds.length; pi3++) {
      var syncedCol = providerData[providerIds[pi3]].adapter.getLastSyncedColumn();
      userUpdate[syncedCol] = db.fn.now();
    }
    await db('users').where('id', userId).update(userUpdate);

    res.json(stats);
  } catch (error) {
    console.error('Cal sync error:', error);
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
        if (msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
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
      var localChanges = await db('tasks')
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

module.exports = { sync, hasChanges };
