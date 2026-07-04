/**
 * useTaskState — manages task state with useReducer + API sync
 *
 * Field-level dirty tracking: only sends changed fields per task to the server,
 * preventing overwrites of concurrent changes from MCP, GCal sync, etc.
 *
 * Change polling: polls GET /tasks/version every 5s to detect external changes
 * (MCP, GCal, another tab) and reloads when needed.
 */

import { useReducer, useCallback, useRef, useEffect, useState } from 'react';
import taskReducer, { TASK_STATE_INIT } from '../state/taskReducer';
import apiClient, { TZ_OVERRIDE_KEY, USER_TZ_KEY, getAccessToken } from '../services/apiClient';
import { apiBase } from '../proxy-config';
import { hydrateTaskTimezones, resolveDisplayTimezone } from '../utils/timezone';
import { isTerminalStatus } from '../state/constants';
import { derivePlacements } from '../utils/derivePlacements';

function getHydrationTimezone() {
  // Display in the user's CONFIGURED timezone, never the browser's (A1 /
  // TZ-DISPLAY-1/3): explicit override → configured users.timezone → NY default.
  var override = null;
  var userTz = null;
  try {
    override = localStorage.getItem(TZ_OVERRIDE_KEY);
    userTz = localStorage.getItem(USER_TZ_KEY);
  } catch (e) { /* ignore */ }
  return resolveDisplayTimezone({ override: override, userTimezone: userTz });
}

// Fields that map to task object properties for partial saves
var SAVE_FIELDS = [
  'text', 'status', 'date', 'time', 'dur', 'timeRemaining',
  'pri', 'project', 'section', 'notes', 'due', 'earliestStart',
  'location', 'tools', 'when', 'dayReq', 'recurring', 'rigid',
  'split', 'splitMin', 'travelBefore', 'travelAfter', 'recur', 'dependsOn', 'datePinned',
  'preferredTime', 'tz', '_timezone', 'anchorDate'
];

export default function useTaskState() {
  const [taskState, dispatch] = useReducer(taskReducer, TASK_STATE_INIT);
  const [loading, setLoading] = useState(true);
  // True once the first loadTasks() has completed. Subsequent calls are
  // silent — they still dispatch INIT with fresh data but never flip the
  // loading state back on, so the AppLayout "Loading tasks…" early-return
  // doesn't unmount the entire UI on every refresh.
  const initialLoadDoneRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [placements, setPlacements] = useState({ dayPlacements: {}, unplaced: [] });
  const taskStateRef = useRef(taskState);
  taskStateRef.current = taskState;
  const saveTimerRef = useRef(null);
  const placementTimerRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const nudgePendingRef = useRef(null);  // { deadline: number } when tab-hidden timer fired
  const flushSaveRef = useRef(null);
  const flushPromiseRef = useRef(null);
  const lastVersionRef = useRef(null);
  const loadTasksRef = useRef(null);
  // sched-audit L3 ernie WARN-2 — per-task write sequence: guards updateTask's
  // rollback from clobbering a NEWER concurrent update to the same task (e.g. two
  // rapid drags). Maps taskId -> the sequence number of the most recently
  // STARTED updateTask call for that id.
  const writeSeqRef = useRef({});
  // IDs of tasks this client just wrote. The server echoes our writes back
  // over tasks:changed, and without filtering we'd re-fetch them — which
  // races any still-queued writes and flashes the UI back to pre-write
  // state. Each entry is an expiry timestamp (ms since epoch).
  const selfWriteExpiryRef = useRef(new Map());
  const SELF_WRITE_TTL_MS = 3000;

  function markSelfWrite(ids) {
    if (!ids) return;
    var arr = Array.isArray(ids) ? ids : [ids];
    var expiry = Date.now() + SELF_WRITE_TTL_MS;
    arr.forEach(function(id) { if (id) selfWriteExpiryRef.current.set(id, expiry); });
  }

  function filterOutSelfWrites(ids) {
    if (!ids || ids.length === 0) return ids;
    var now = Date.now();
    var map = selfWriteExpiryRef.current;
    // Evict expired entries as we go.
    var kept = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var exp = map.get(id);
      if (exp == null) { kept.push(id); continue; }
      if (exp < now) { map.delete(id); kept.push(id); continue; }
      // Self-written within TTL — skip and consume the token so a second
      // echo (shouldn't happen, but safety) goes through.
      map.delete(id);
    }
    return kept;
  }

  // Derive placements from the already-loaded /tasks data (W3 — DB single
  // source). No /schedule/placements fetch: each task already carries its
  // server-converted LOCAL date/time, so we just regroup the current tasks.
  const loadPlacements = useCallback(async () => {
    const tasks = (taskStateRef.current && taskStateRef.current.tasks) || [];
    setPlacements(derivePlacements(tasks));
  }, []);

  // Core save logic — sends only dirty fields per task to server
  const flushSave = useCallback(async () => {
    // Concurrency guard: if a save is already in flight, return the existing promise
    if (flushPromiseRef.current) return flushPromiseRef.current;

    const state = taskStateRef.current;
    const dirtyIds = state._dirtyTaskIds || {};
    const dirtyKeys = Object.keys(dirtyIds);
    if (dirtyKeys.length === 0) return;

    // Snapshot the dirty fields we're about to save
    const savingIds = dirtyKeys.slice();
    const savedFields = {};
    dirtyKeys.forEach(function(id) {
      savedFields[id] = Object.assign({}, dirtyIds[id]);
    });

    setSaving(true);
    const promise = (async () => {
      try {
        const taskMap = {};
        state.tasks.forEach(function(t) { taskMap[t.id] = t; });

        const updates = savingIds.map(function(id) {
          var t = taskMap[id];
          if (!t) return null;
          var dirtyFieldMap = savedFields[id] || {};
          // Build partial update with only dirty fields + id
          var partial = { id: t.id };
          SAVE_FIELDS.forEach(function(f) {
            if (dirtyFieldMap[f]) {
              // Special case: status comes from state map
              if (f === 'status') { partial.status = state.statuses[id] || ''; }
              else { partial[f] = t[f]; }
            }
          });
          return partial;
        }).filter(Boolean);

        if (updates.length > 0) {
          markSelfWrite(updates.map(function(u) { return u.id; }));
          await apiClient.put('/tasks/batch', { updates });
        }
        // Only clear the specific fields we saved — preserve any dirtied during the await
        dispatch({ type: 'CLEAR_DIRTY_TASKS', ids: savingIds, savedFields: savedFields });
        // Placements refresh via SSE schedule:changed — no blocking wait here
      } catch (error) {
        console.error('Save failed:', error);
      } finally {
        flushPromiseRef.current = null;
        setSaving(false);
      }
    })();

    flushPromiseRef.current = promise;
    return promise;
  }, []);
  flushSaveRef.current = flushSave;

  // Load tasks from API — flushes any pending save first
  // so local changes aren't lost when reloading from server
  const loadTasks = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await flushSaveRef.current();
    }
    try {
      if (!initialLoadDoneRef.current) setLoading(true);
      const [tasksRes, configRes] = await Promise.all([
        apiClient.get('/tasks'),
        apiClient.get('/config')
      ]);

      const tasks = tasksRes.data.tasks || [];
      var _ex = tasks.find(function(t) { return t.text === 'Exercise' && t.taskType === 'recurring_instance' && t.status === ''; });
      console.log('[LOAD-RAW] Exercise anchorDate:', _ex ? _ex.anchorDate : 'NOT FOUND', 'total tasks:', tasks.length);
      hydrateTaskTimezones(tasks, getHydrationTimezone());
      const statuses = {};
      tasks.forEach(t => {
        if (t.status) statuses[t.id] = t.status;
      });

      dispatch({ type: 'INIT', tasks, statuses });
      // Update version watermark so polling doesn't immediately re-trigger
      if (tasksRes.data.version) {
        lastVersionRef.current = tasksRes.data.version;
      }
      return { tasks, config: configRes.data };
    } catch (error) {
      console.error('Failed to load tasks:', error);
      return null;
    } finally {
      if (!initialLoadDoneRef.current) {
        setLoading(false);
        initialLoadDoneRef.current = true;
      }
    }
  }, []);
  loadTasksRef.current = loadTasks;

  // Debounced save — batches updates
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { flushSaveRef.current(); }, 1000);
  }, []);

  // Dispatch + persist wrapper
  const dispatchPersist = useCallback((action) => {
    dispatch(action);
    scheduleSave();
  }, [scheduleSave]);

  // Status changes save immediately (not debounced) to prevent race conditions
  // with loadTasks/GCal sync that could overwrite in-memory state
  const setStatus = useCallback((id, val, opts = {}) => {
    dispatch({
      type: 'SET_STATUS',
      id, val,
      taskFields: opts.taskFields
    });
    // Save status immediately via dedicated endpoint
    var body = { status: val || '' };
    if (opts.completedAt) body.completedAt = opts.completedAt;
    markSelfWrite(id);
    apiClient.put(`/tasks/${id}/status`, body).then((res) => {
      // Clear dirty flag once server confirms the save. Pass the SAME
      // taskFields this call's SET_STATUS dirtied (WARN ernie-w2-cleardirty-
      // overbroad, 2026-07-04) so the reducer clears only those specific
      // _dirtyTaskIds[id] keys — a co-pending edit to an UNRELATED field
      // (e.g. `dur` queued via UPDATE_TASK before this status PUT resolved)
      // is not silently dropped.
      dispatch({ type: 'CLEAR_DIRTY_STATUS', id, taskFields: opts.taskFields });
      // For terminal statuses, the server may clamp scheduled_at to the
      // completion time (rowToTask enforces this). Fetch just this task and
      // upsert — do NOT do a full loadTasks() refresh, which causes a
      // visible flash across the whole UI. The scheduler run triggered by
      // the status change will also fire a schedule:changed SSE with its
      // own sparse upsert; both are idempotent.
      if (val === 'done' || val === 'cancel' || val === 'skip' || val === 'pause') {
        apiClient.get('/tasks/' + id).then(function(r) {
          if (r && r.data && r.data.task) {
            dispatch({ type: 'UPSERT_TASKS', tasks: [r.data.task] });
          }
        }).catch(function() { /* SSE will catch up */ });
      }
      // Placements refresh via SSE schedule:changed
    }).catch(err => console.error('Failed to save status:', err));
    // If there are also taskFields (e.g. date changes on recurring completion), save those too
    if (opts.taskFields) scheduleSave();
  }, [scheduleSave]);

  const updateTask = useCallback(async (id, fields) => {
    // sched-audit REG-44/F3 — capture the pre-update values for the changed
    // fields BEFORE the optimistic dispatch, so a server rejection (e.g.
    // calLocked 403 on a drag-move) can be rolled back rather than left
    // showing a change the backend never persisted.
    var prevTask = ((taskStateRef.current && taskStateRef.current.tasks) || []).find(function(t) { return t.id === id; });
    var prevFields = {};
    if (prevTask) {
      Object.keys(fields).forEach(function(k) { prevFields[k] = prevTask[k]; });
    }
    // sched-audit L3 ernie WARN-2 — stamp this call with a per-task monotonic
    // sequence number BEFORE dispatching the optimistic update. On rejection,
    // only restore `prevFields` if no later updateTask call for this same id
    // has started since (i.e. this call is still the most recent in-flight
    // write) — otherwise this rollback would clobber that newer update.
    var mySeq = (writeSeqRef.current[id] || 0) + 1;
    writeSeqRef.current[id] = mySeq;
    dispatch({ type: 'UPDATE_TASK', id, fields });
    // Cancel any pending debounced save
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    // Immediately save to API — placements refresh via SSE schedule:changed
    setSaving(true);
    try {
      // Send the actual task ID — the backend routes template fields to the
      // source and instance fields to the instance for recurring_instance tasks.
      var partial = Object.assign({ id: id }, fields);
      markSelfWrite(id);
      await apiClient.put('/tasks/batch', { updates: [partial] });
      dispatch({ type: 'CLEAR_DIRTY_TASKS', ids: [id], savedFields: { [id]: fields } });
      return true;
    } catch (error) {
      console.error('Save failed:', error);
      // Propagate the server's error message string if present so the caller
      // can surface it in the UI. The backend returns { error: '...' } on 400.
      var serverMsg = error && error.response && error.response.data && error.response.data.error;
      // Roll back the optimistic UPDATE_TASK dispatch — the server rejected the
      // change, so the UI must not keep showing it (REG-44/F3). Guarded (WARN-2):
      // skip the rollback if a newer updateTask call for this id has since
      // started — that call's own optimistic value (or its own
      // success/rollback) is authoritative now, not this stale snapshot.
      if (prevTask && writeSeqRef.current[id] === mySeq) {
        dispatch({ type: 'UPDATE_TASK', id: id, fields: prevFields });
      }
      dispatch({ type: 'CLEAR_DIRTY_TASKS', ids: [id], savedFields: { [id]: fields } });
      return serverMsg || false;
    } finally {
      setSaving(false);
    }
  }, []);

  const addTasks = useCallback(async (tasks) => {
    dispatch({ type: 'ADD_TASKS', tasks });
    try {
      markSelfWrite(tasks.map(function(t) { return t.id; }));
      await apiClient.post('/tasks/batch', { tasks });
      // Placements refresh via SSE schedule:changed
    } catch (error) {
      console.error('Failed to add tasks:', error);
    }
  }, []);

  const deleteTask = useCallback(async (id, opts) => {
    // Cancel any pending save that has stale dependsOn data
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    var cascade = opts && opts.cascade;
    var idsToRemove = [id];
    if (cascade === 'recurring') {
      // Cascade recurring delete: remove template + pending instances from state
      var state = taskStateRef.current;
      var task = state.tasks.find(function(t) { return t.id === id; });
      var templateId = (task && (task.sourceId || task.source_id)) || id;
      idsToRemove = [];
      state.tasks.forEach(function(t) {
        if (t.id === templateId || t.sourceId === templateId || t.source_id === templateId) {
          dispatch({ type: 'DELETE_TASK', id: t.id });
          idsToRemove.push(t.id);
        }
      });
    } else {
      dispatch({ type: 'DELETE_TASK', id });
    }

    // Optimistically remove from calendar placements so the card disappears immediately
    var removeSet = {};
    idsToRemove.forEach(function(rid) { removeSet[rid] = true; });
    setPlacements(function(prev) {
      var changed = false;
      var newDayPlacements = {};
      Object.keys(prev.dayPlacements).forEach(function(dk) {
        var filtered = prev.dayPlacements[dk].filter(function(p) {
          if (p.task && removeSet[p.task.id]) { changed = true; return false; }
          return true;
        });
        newDayPlacements[dk] = filtered;
      });
      if (!changed) return prev;
      return Object.assign({}, prev, { dayPlacements: newDayPlacements });
    });

    try {
      var url = cascade ? `/tasks/${id}?cascade=${cascade}` : `/tasks/${id}`;
      markSelfWrite(idsToRemove);
      await apiClient.delete(url);
      scheduleSave();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  }, [scheduleSave]);

  const createTask = useCallback(async (task) => {
    dispatch({ type: 'ADD_TASKS', tasks: [task] });
    try {
      markSelfWrite(task.id);
      await apiClient.post('/tasks', task);
      // Placements refresh via SSE schedule:changed
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  }, []);

  // Real-time updates via SSE, with polling fallback
  useEffect(() => {
    var sseActive = false;
    var fallbackIntervalId = null;
    var eventSource = null;
    var reconnectTimer = null;
    // Set true by the effect cleanup below so an in-flight /events/token
    // POST (or its .catch) that resolves AFTER unmount/effect-rerun is a
    // no-op instead of opening a zombie EventSource nothing will ever close
    // (999.946 bird BLOCK-1: async gap between POST and EventSource creation
    // races the cleanup, which only checks `eventSource` — still null while
    // the POST is in flight).
    var sseTornDown = false;

    // 999.997: a STABLE EventTarget "hub" exposed as window.__jugglerEventSource.
    // External consumers (AppLayout / CalSyncPanel / SchedulerStepper) bind their
    // SSE listeners ONCE on mount to window.__jugglerEventSource. Previously that
    // was the raw EventSource, which is REPLACED on every reconnect (onerror →
    // new EventSource) — so after any reconnect those once-bound listeners pointed
    // at the closed instance and silently stopped firing until a full remount.
    // Fix: window.__jugglerEventSource is now a hub that is NEVER replaced; each
    // reconnect's raw EventSource re-forwards its events into this hub, so
    // once-bound consumer listeners survive reconnects. Reuse an existing hub (a
    // prior mount / React 18 StrictMode double-invoke) so consumers that already
    // bound to it are not orphaned.
    var sseHub = (window.__jugglerEventSource && window.__jugglerEventSource.__jugglerHub)
      ? window.__jugglerEventSource
      : Object.assign(new EventTarget(), { __jugglerHub: true });
    window.__jugglerEventSource = sseHub;
    // Event types external consumers subscribe to — re-dispatched from the raw
    // EventSource onto the stable hub on every (re)connect. (useTaskState's own
    // handlers stay bound to the raw EventSource, which it re-binds each connect,
    // so they are unaffected by the swap and are not forwarded here.)
    var SSE_HUB_FORWARD_TYPES = [
      'tasks:changed', 'schedule:changed', 'schedule:running',
      'sync:progress', 'sync:error', 'sync:lock_conflict'
    ];

    // Shared refresh logic — reload tasks + placements
    async function refreshFromServer() {
      try {
        var res = await apiClient.get('/tasks/version');
        var serverVersion = res.data.version;
        if (lastVersionRef.current !== null && serverVersion !== lastVersionRef.current) {
          lastVersionRef.current = serverVersion;
          var [tasksRes] = await Promise.all([apiClient.get('/tasks')]);
          var tasks = tasksRes.data.tasks || [];
          hydrateTaskTimezones(tasks, getHydrationTimezone());
          var statuses = {};
          tasks.forEach(function(t) { if (t.status) statuses[t.id] = t.status; });
          dispatch({ type: 'INIT', tasks, statuses });
        }
        lastVersionRef.current = serverVersion;
        loadPlacements();
      } catch (e) { /* silently ignore */ }
    }

    // Compute the soonest end time across all incomplete (non-terminal) tasks with a future scheduledAt
    function computeNextTaskEnd(tasks) {
      var now = Date.now();
      var soonest = null;
      tasks.forEach(function(t) {
        if (isTerminalStatus(t.status)) return;
        if (!t.scheduledAt || !t.dur) return;
        var endMs = new Date(t.scheduledAt).getTime() + (t.dur * 60 * 1000);
        if (endMs <= now) return;
        if (soonest === null || endMs < soonest) soonest = endMs;
      });
      return soonest;  // ms since epoch, or null
    }

    // Arm (or rearm) the nudge timer for the next task end time
    function armNudgeTimer(nextEndMs) {
      if (nudgeTimerRef.current) { clearTimeout(nudgeTimerRef.current); nudgeTimerRef.current = null; }
      nudgePendingRef.current = null;
      if (!nextEndMs) return;
      var delay = nextEndMs - Date.now();
      if (delay <= 0) return;
      nudgeTimerRef.current = setTimeout(function() {
        nudgeTimerRef.current = null;
        if (document.visibilityState === 'visible') {
          // Tab visible — fire immediately
          apiClient.post('/schedule/nudge').catch(function(e) {
            console.warn('[nudge] POST failed:', e && e.message);
          });
        } else {
          // Tab hidden — arm one-shot visibilitychange listener
          nudgePendingRef.current = { deadline: nextEndMs };
          var onVisible = function() {
            document.removeEventListener('visibilitychange', onVisible);
            var pending = nudgePendingRef.current;
            nudgePendingRef.current = null;
            if (!pending) return;
            var ageMs = Date.now() - pending.deadline;
            if (ageMs <= 15 * 60 * 1000) {
              // Within 15-minute staleness window — fire
              apiClient.post('/schedule/nudge').catch(function(e) {
                console.warn('[nudge] POST failed (visibility):', e && e.message);
              });
            }
            // else: stale — skip; next mutation will retrigger the scheduler
          };
          document.addEventListener('visibilitychange', onVisible, { once: true });
        }
      }, delay);
    }

    // Start SSE connection. Exchanges the JWT (sent in the Authorization
    // HEADER via apiClient) for a one-time, 60s opaque SSE token, then
    // connects with that opaque token in the URL — never the raw JWT
    // (999.946). connectSSE is the single entry point for both the initial
    // connect and every reconnect (see onerror below), so each (re)connect
    // naturally fetches a fresh one-time token.
    function connectSSE() {
      var token = getAccessToken();
      if (!token) { startPolling(); return; }

      apiClient.post('/events/token').then(function(tokenRes) {
        if (sseTornDown) return;
        var opaque = tokenRes.data && tokenRes.data.token;
        if (!opaque) {
          // No token in response — fall back to polling, retry later.
          startPolling();
          reconnectTimer = setTimeout(connectSSE, 5000);
          return;
        }

        var url = apiBase + '/events?token=' + encodeURIComponent(opaque);
        eventSource = new EventSource(url);
        // 999.997: forward consumer event types from this (per-connect) raw
        // EventSource onto the STABLE hub so once-bound external listeners survive
        // reconnects. These forwarder listeners die with the EventSource when it is
        // closed on the next reconnect/unmount, so they do not accumulate. `e.data`
        // is preserved (consumers JSON.parse it) via MessageEvent.
        SSE_HUB_FORWARD_TYPES.forEach(function(type) {
          eventSource.addEventListener(type, function(e) {
            sseHub.dispatchEvent(new MessageEvent(type, { data: e.data }));
          });
        });

        eventSource.addEventListener('connected', function() {
          sseActive = true;
          // Stop polling fallback if active
          if (fallbackIntervalId) { clearInterval(fallbackIntervalId); fallbackIntervalId = null; }
        });

        eventSource.addEventListener('tasks:changed', function(e) {
          // Surgical path: if the server told us which ids changed, fetch just
          // those and upsert. Ids that 404 (the underlying mutation was a
          // delete) are removed from state. Otherwise fall back to the full
          // version-check + reload path (covers old servers, sources like
          // cal-sync and config that don't carry an ids payload).
          var data = null;
          try { data = JSON.parse(e.data); } catch(err) {}
          var ids = data && Array.isArray(data.ids) ? data.ids : null;
          var hadIds = !!(ids && ids.length > 0);
          if (hadIds) ids = filterOutSelfWrites(ids);
          if (hadIds && (!ids || ids.length === 0)) {
            // Every id was our own just-acked write — nothing to fetch.
            return;
          }
          if (ids && ids.length > 0) {
            Promise.all(ids.map(function(id) {
              return apiClient.get('/tasks/' + id)
                .then(function(res) { return { id: id, task: res.data.task }; })
                .catch(function(err) {
                  // 404 = deleted; any other error = leave state alone
                  if (err && err.response && err.response.status === 404) return { id: id, task: null };
                  return null;
                });
            })).then(function(results) {
              var upserts = [];
              var removals = [];
              results.forEach(function(r) {
                if (!r) return;
                if (r.task) upserts.push(r.task);
                else removals.push(r.id);
              });
              if (removals.length > 0) {
                dispatch({ type: 'REMOVE_TASKS', ids: removals });
              }
              if (upserts.length > 0) {
                hydrateTaskTimezones(upserts, getHydrationTimezone());
                dispatch({ type: 'UPSERT_TASKS', tasks: upserts });
              }
            });
          } else {
            refreshFromServer();
          }
        });

        eventSource.addEventListener('schedule:changed', function(e) {
          var data = null;
          try { data = JSON.parse(e.data); } catch(err) {}
          var cs = data && data.changeset;

          if (cs) {
            var addedArr = cs.added || [];
            var changedArr = cs.changed || [];
            var removedArr = cs.removed || [];
            // Nothing changed in the changeset — skip task upserts but still
            // reload placements. The schedule cache includes newly-created
            // tasks that the scheduler didn't move (already had scheduled_at).
            if (addedArr.length + changedArr.length + removedArr.length === 0) {
              loadPlacements();
              armNudgeTimer(computeNextTaskEnd(taskStateRef.current.tasks));
              return;
            }
            // Remove deleted tasks from state immediately
            if (removedArr.length > 0) {
              dispatch({ type: 'REMOVE_TASKS', ids: removedArr });
            }
            // Patch path: changed entries may be either ids (legacy) or {id, patch}.
            // New format ships with patches so we skip the per-task fetch entirely.
            var changedPatches = [];
            var changedFetchIds = [];
            changedArr.forEach(function(c) {
              if (c && typeof c === 'object' && c.id && c.patch) changedPatches.push(c);
              else if (typeof c === 'string') changedFetchIds.push(c);
            });
            if (changedPatches.length > 0) {
              dispatch({ type: 'PATCH_TASKS', patches: changedPatches });
            }
            // Added: backend now ships full task objects in the changeset so the
            // frontend can upsert directly. Older payloads (or any added entry
            // that's still a bare id string) fall back to the fetch path.
            var addedFullRows = [];
            var addedFetchIds = [];
            addedArr.forEach(function(a) {
              if (a && typeof a === 'object' && a.id) addedFullRows.push(a);
              else if (typeof a === 'string') addedFetchIds.push(a);
            });
            if (addedFullRows.length > 0) {
              hydrateTaskTimezones(addedFullRows, getHydrationTimezone());
              dispatch({ type: 'UPSERT_TASKS', tasks: addedFullRows });
            }
            var fetchIds = addedFetchIds.concat(changedFetchIds);
            if (fetchIds.length > 0) {
              Promise.all(fetchIds.map(function(id) {
                return apiClient.get('/tasks/' + id).then(function(res) {
                  return res.data.task;
                }).catch(function() { return null; });
              })).then(function(tasks) {
                var valid = tasks.filter(Boolean);
                if (valid.length > 0) {
                  hydrateTaskTimezones(valid, getHydrationTimezone());
                  dispatch({ type: 'UPSERT_TASKS', tasks: valid });
                }
              });
            }
          } else {
            // Fallback: no changeset — full reload
            if (loadTasksRef.current) loadTasksRef.current();
          }

          // Reload placements (time-slot positions) — only when something
          // actually moved on the schedule grid.
          loadPlacements();
          // Recompute nudge timer on every schedule change (D-05)
          armNudgeTimer(computeNextTaskEnd(taskStateRef.current.tasks));
        });

        eventSource.onerror = function() {
          sseActive = false;
          if (eventSource) { eventSource.close(); eventSource = null; }
          // Reconnect after 5s, fall back to polling in the meantime
          startPolling();
          reconnectTimer = setTimeout(connectSSE, 5000);
        };
      }).catch(function() {
        if (sseTornDown) return;
        // Opaque-token fetch failed (network/auth error) — fall back to
        // polling and retry the whole connect (incl. a fresh token fetch)
        // after 5s, mirroring the existing eventSource.onerror fallback.
        startPolling();
        reconnectTimer = setTimeout(connectSSE, 5000);
      });
    }

    // Polling fallback (used when SSE is unavailable)
    function startPolling() {
      if (fallbackIntervalId) return;
      fallbackIntervalId = setInterval(refreshFromServer, 5000);
    }

    connectSSE();
    // Arm nudge timer for current task state on mount
    armNudgeTimer(computeNextTaskEnd(taskStateRef.current.tasks));

    // Periodic scheduler run — fallback for overdue detection and stale-cache
    // recovery when no task mutations have fired (e.g. after page load with no edits).
    var periodicNudgeId = setInterval(function() {
      if (document.visibilityState !== 'visible') return;
      apiClient.post('/schedule/nudge').catch(function(e) {
        console.warn('[periodic-nudge] POST failed:', e && e.message);
      });
    }, 5 * 60 * 1000); // every 5 minutes

    return function() {
      sseTornDown = true;
      if (eventSource) eventSource.close();
      if (fallbackIntervalId) clearInterval(fallbackIntervalId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      clearInterval(periodicNudgeId);
      nudgePendingRef.current = null;
    };
  }, [loadPlacements]);

  // Keep derived placements in sync with tasks (W3 — DB single source).
  // Placements are now a pure function of the loaded tasks, so re-derive
  // whenever the task list changes — after loadTasks() INIT, SSE upserts/
  // patches/removals, optimistic adds, etc. This makes the explicit
  // loadPlacements() calls in the SSE handlers redundant-but-harmless and
  // guarantees the grid never lags the task state even if a handler forgets
  // to call it.
  useEffect(() => {
    setPlacements(derivePlacements(taskState.tasks));
  }, [taskState.tasks]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (placementTimerRef.current) clearTimeout(placementTimerRef.current);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      nudgePendingRef.current = null;
    };
  }, []);

  // Flush pending saves immediately (cancels debounce timer)
  const flushNow = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await flushSaveRef.current();
  }, []);

  return {
    taskState,
    dispatch,
    dispatchPersist,
    loading,
    saving,
    loadTasks,
    placements,
    loadPlacements,
    setStatus,
    updateTask,
    addTasks,
    deleteTask,
    createTask,
    taskStateRef,
    setPlacements,
    flushNow
  };
}
