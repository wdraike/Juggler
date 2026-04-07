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
  'preferredTime', 'tz', '_timezone'
];

export default function useTaskState() {
  const [taskState, dispatch] = useReducer(taskReducer, TASK_STATE_INIT);
  const [loading, setLoading] = useState(true);
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

  // Load placements from backend scheduler (immediate)
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
        await loadPlacements();
      } catch (error) {
        console.error('Save failed:', error);
      } finally {
        flushPromiseRef.current = null;
        setSaving(false);
      }
    })();

    flushPromiseRef.current = promise;
    return promise;
  }, [loadPlacements]);
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
      setLoading(true);
      const [tasksRes, configRes] = await Promise.all([
        apiClient.get('/tasks'),
        apiClient.get('/config')
      ]);

      const tasks = tasksRes.data.tasks || [];
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
      setLoading(false);
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
      // Pausing a recurring task template deletes future instances server-side — reload all tasks
      if (val === 'pause' && res.data && res.data.instancesRemoved > 0) {
        loadTasks();
      } else {
        // For terminal statuses, reload tasks so the frontend picks up the
        // clamped scheduledAt from the server (rowToTask enforces this).
        if (val === 'done' || val === 'cancel' || val === 'skip') {
          loadTasks();
        } else {
          loadPlacements();
        }
      }
    }).catch(err => console.error('Failed to save status:', err));
    // If there are also taskFields (e.g. date changes on recurring completion), save those too
    if (opts.taskFields) scheduleSave();
  }, [scheduleSave, loadPlacements]);

  const updateTask = useCallback(async (id, fields) => {
    dispatch({ type: 'UPDATE_TASK', id, fields });
    // Cancel any pending debounced save
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    // Immediately save to API, then refresh placements in background (non-blocking)
    setSaving(true);
    try {
      // Send the actual task ID — the backend routes template fields to the
      // source and instance fields to the instance for recurring_instance tasks.
      var partial = Object.assign({ id: id }, fields);
      await apiClient.put('/tasks/batch', { updates: [partial] });
      dispatch({ type: 'CLEAR_DIRTY_TASKS', ids: [id], savedFields: { [id]: fields } });
      // If a scheduling-relevant field changed, wait for the backend's
      // auto-reschedule (500ms debounce + run time) before refreshing placements
      var schedFields = ['split', 'flexWhen', 'dur', 'when', 'dayReq', 'date', 'due', 'pri', 'dependsOn', 'location', 'time', 'timeFlex', 'travelBefore', 'travelAfter'];
      var needsResched = schedFields.some(function(f) { return f in fields; });
      if (needsResched) {
        setTimeout(function() { loadPlacements().finally(function() { setSaving(false); }); }, 3500);
      } else {
        loadPlacements().finally(function() { setSaving(false); });
      }
      return true;
    } catch (error) {
      console.error('Save failed:', error);
      setSaving(false);
      return false;
    }
  }, [loadPlacements]);

  const addTasks = useCallback(async (tasks) => {
    dispatch({ type: 'ADD_TASKS', tasks });
    try {
      await apiClient.post('/tasks/batch', { tasks });
      await loadPlacements();
    } catch (error) {
      console.error('Failed to add tasks:', error);
    }
  }, [loadPlacements]);

  const deleteTask = useCallback(async (id, opts) => {
    // Cancel any pending save that has stale dependsOn data
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    var cascade = opts && opts.cascade;
    if (cascade === 'recurring') {
      // Cascade recurring delete: remove template + pending instances from state
      var state = taskStateRef.current;
      var task = state.tasks.find(function(t) { return t.id === id; });
      var templateId = (task && (task.sourceId || task.source_id)) || id;
      // Remove template and all its instances from local state
      state.tasks.forEach(function(t) {
        if (t.id === templateId || t.sourceId === templateId || t.source_id === templateId) {
          dispatch({ type: 'DELETE_TASK', id: t.id });
        }
      });
    } else {
      dispatch({ type: 'DELETE_TASK', id });
    }

    try {
      var url = cascade ? `/tasks/${id}?cascade=${cascade}` : `/tasks/${id}`;
      await apiClient.delete(url);
      // Schedule a save so the cleaned-up dependsOn arrays get persisted
      scheduleSave();
      await loadPlacements();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  }, [loadPlacements, scheduleSave]);

  const createTask = useCallback(async (task) => {
    dispatch({ type: 'ADD_TASKS', tasks: [task] });
    try {
      await apiClient.post('/tasks', task);
      await loadPlacements();
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  }, [loadPlacements]);

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

      eventSource.addEventListener('connected', function() {
        sseActive = true;
        // Stop polling fallback if active
        if (fallbackIntervalId) { clearInterval(fallbackIntervalId); fallbackIntervalId = null; }
      });

      eventSource.addEventListener('tasks:changed', function() {
        refreshFromServer();
      });

      eventSource.addEventListener('schedule:changed', function() {
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
