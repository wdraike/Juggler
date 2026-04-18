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
import apiClient, { TZ_OVERRIDE_KEY, getAccessToken } from '../services/apiClient';
import { apiBase } from '../proxy-config';
import { getBrowserTimezone, hydrateTaskTimezones, convertTimeForDisplay } from '../utils/timezone';
import { parseTimeToMinutes } from '../scheduler/dateHelpers';

function getHydrationTimezone() {
  try {
    var override = localStorage.getItem(TZ_OVERRIDE_KEY);
    if (override) return override;
  } catch (e) { /* ignore */ }
  return getBrowserTimezone() || 'America/New_York';
}

/**
 * Convert placement start times from UTC (scheduledAtUtc) to local minutes
 * in the browser timezone, and regroup by local dateKey.
 */
function hydratePlacements(data) {
  var tz = getHydrationTimezone();
  var srcPlacements = data.dayPlacements || {};
  var localPlacements = {};

  Object.keys(srcPlacements).forEach(function(dk) {
    var arr = srcPlacements[dk];
    if (!arr) return;
    arr.forEach(function(p) {
      if (!p.task) return; // Skip orphaned placements (task was deleted)
      if (p.scheduledAtUtc) {
        var local = convertTimeForDisplay(p.scheduledAtUtc, tz);
        if (local && local.time) {
          var localMins = parseTimeToMinutes(local.time);
          if (localMins !== null) p.start = localMins;
          // Regroup by local dateKey (may differ from scheduler's dateKey)
          var localDk = local.date || dk;
          if (!localPlacements[localDk]) localPlacements[localDk] = [];
          localPlacements[localDk].push(p);
          return;
        }
      }
      // Fallback: keep original dateKey and start
      if (!localPlacements[dk]) localPlacements[dk] = [];
      localPlacements[dk].push(p);
    });
  });

  return { dayPlacements: localPlacements, unplaced: data.unplaced || [], warnings: data.warnings || [], hasPastTasks: data.hasPastTasks };
}

// Fields that map to task object properties for partial saves
var SAVE_FIELDS = [
  'text', 'status', 'date', 'time', 'dur', 'timeRemaining',
  'pri', 'project', 'section', 'notes', 'due', 'startAfter',
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
  const flushSaveRef = useRef(null);
  const flushPromiseRef = useRef(null);
  const lastVersionRef = useRef(null);
  const loadTasksRef = useRef(null);

  // Load placements from backend scheduler
  const loadPlacements = useCallback(async () => {
    if (placementTimerRef.current) clearTimeout(placementTimerRef.current);
    try {
      const res = await apiClient.get('/schedule/placements');
      setPlacements(hydratePlacements(res.data));
    } catch (error) {
      console.error('Failed to load placements:', error);
    }
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
    apiClient.put(`/tasks/${id}/status`, body).then((res) => {
      // Clear dirty flag once server confirms the save
      dispatch({ type: 'CLEAR_DIRTY_STATUS', id });
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
    dispatch({ type: 'UPDATE_TASK', id, fields });
    // Cancel any pending debounced save
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    // Immediately save to API — placements refresh via SSE schedule:changed
    setSaving(true);
    try {
      // Send the actual task ID — the backend routes template fields to the
      // source and instance fields to the instance for recurring_instance tasks.
      var partial = Object.assign({ id: id }, fields);
      await apiClient.put('/tasks/batch', { updates: [partial] });
      dispatch({ type: 'CLEAR_DIRTY_TASKS', ids: [id], savedFields: { [id]: fields } });
      return true;
    } catch (error) {
      console.error('Save failed:', error);
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const addTasks = useCallback(async (tasks) => {
    dispatch({ type: 'ADD_TASKS', tasks });
    try {
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
      await apiClient.delete(url);
      scheduleSave();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  }, [scheduleSave]);

  const createTask = useCallback(async (task) => {
    dispatch({ type: 'ADD_TASKS', tasks: [task] });
    try {
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

    // Start SSE connection
    function connectSSE() {
      var token = getAccessToken();
      if (!token) { startPolling(); return; }

      var url = apiBase + '/events?token=' + encodeURIComponent(token);
      eventSource = new EventSource(url);
      // Expose globally so other components (e.g. CalSyncPanel) can listen for events
      window.__jugglerEventSource = eventSource;

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
      });

      eventSource.onerror = function() {
        sseActive = false;
        if (eventSource) { eventSource.close(); eventSource = null; }
        // Reconnect after 5s, fall back to polling in the meantime
        startPolling();
        reconnectTimer = setTimeout(connectSSE, 5000);
      };
    }

    // Polling fallback (used when SSE is unavailable)
    function startPolling() {
      if (fallbackIntervalId) return;
      fallbackIntervalId = setInterval(refreshFromServer, 5000);
    }

    connectSSE();

    return function() {
      if (eventSource) eventSource.close();
      if (fallbackIntervalId) clearInterval(fallbackIntervalId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [loadPlacements]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (placementTimerRef.current) clearTimeout(placementTimerRef.current);
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
