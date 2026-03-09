/**
 * useTaskState — manages task state with useReducer + API sync
 */

import { useReducer, useCallback, useRef, useEffect, useState } from 'react';
import taskReducer, { TASK_STATE_INIT } from '../state/taskReducer';
import apiClient from '../services/apiClient';

export default function useTaskState() {
  const [taskState, dispatch] = useReducer(taskReducer, TASK_STATE_INIT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [placements, setPlacements] = useState({ dayPlacements: {}, unplaced: [] });
  const taskStateRef = useRef(taskState);
  taskStateRef.current = taskState;
  const saveTimerRef = useRef(null);
  const placementTimerRef = useRef(null);

  // Load tasks from API — cancels any pending debounced save first
  // to prevent stale local state from overwriting server data after reload
  const loadTasks = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      setLoading(true);
      const [tasksRes, configRes] = await Promise.all([
        apiClient.get('/tasks'),
        apiClient.get('/config')
      ]);

      const tasks = tasksRes.data.tasks || [];
      const statuses = {};
      const directions = {};
      tasks.forEach(t => {
        if (t.status) statuses[t.id] = t.status;
        if (t.direction) directions[t.id] = t.direction;
      });

      dispatch({ type: 'INIT', tasks, statuses, directions });
      return { tasks, config: configRes.data };
    } catch (error) {
      console.error('Failed to load tasks:', error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Load placements from backend scheduler (debounced)
  const loadPlacements = useCallback(() => {
    if (placementTimerRef.current) clearTimeout(placementTimerRef.current);
    placementTimerRef.current = setTimeout(async () => {
      try {
        const res = await apiClient.get('/schedule/placements');
        setPlacements({ dayPlacements: res.data.dayPlacements || {}, unplaced: res.data.unplaced || [] });
      } catch (error) {
        console.error('Failed to load placements:', error);
      }
    }, 300);
  }, []);

  // Debounced save — batches updates
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const state = taskStateRef.current;
      if (state.tasks.length === 0) return;
      setSaving(true);
      try {
        const updates = state.tasks.map(t => ({
          id: t.id,
          status: state.statuses[t.id] || '',
          direction: state.directions[t.id] || null,
          date: t.date,
          time: t.time,
          dur: t.dur,
          timeRemaining: t.timeRemaining,
          pri: t.pri,
          project: t.project,
          section: t.section,
          notes: t.notes,
          due: t.due,
          startAfter: t.startAfter,
          location: t.location,
          tools: t.tools,
          when: t.when,
          dayReq: t.dayReq,
          habit: t.habit,
          rigid: t.rigid,
          split: t.split,
          splitMin: t.splitMin,
          recur: t.recur,
          dependsOn: t.dependsOn
        }));
        await apiClient.put('/tasks/batch', { updates });
        await loadPlacements();
      } catch (error) {
        console.error('Save failed:', error);
      } finally {
        setSaving(false);
      }
    }, 1000);
  }, [loadPlacements]);

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
      deleteDirection: opts.deleteDirection,
      taskFields: opts.taskFields
    });
    // Save status immediately via dedicated endpoint
    apiClient.put(`/tasks/${id}/status`, {
      status: val || '',
      direction: opts.deleteDirection ? null : undefined
    }).then(() => {
      // Clear dirty flag once server confirms the save
      dispatch({ type: 'CLEAR_DIRTY_STATUS', id });
    }).catch(err => console.error('Failed to save status:', err));
    // If there are also taskFields (e.g. date changes on habit completion), save those too
    if (opts.taskFields) scheduleSave();
  }, [scheduleSave]);

  const setDirection = useCallback((id, val) => {
    dispatchPersist({ type: 'SET_DIRECTION', id, val });
  }, [dispatchPersist]);

  const updateTask = useCallback((id, fields) => {
    dispatchPersist({ type: 'UPDATE_TASK', id, fields });
  }, [dispatchPersist]);

  const addTasks = useCallback(async (tasks) => {
    dispatch({ type: 'ADD_TASKS', tasks });
    try {
      await apiClient.post('/tasks/batch', { tasks });
      await loadPlacements();
    } catch (error) {
      console.error('Failed to add tasks:', error);
    }
  }, [loadPlacements]);

  const deleteTask = useCallback(async (id) => {
    // Cancel any pending save that has stale dependsOn data
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    dispatch({ type: 'DELETE_TASK', id });
    try {
      await apiClient.delete(`/tasks/${id}`);
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

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (placementTimerRef.current) clearTimeout(placementTimerRef.current);
    };
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
    setDirection,
    updateTask,
    addTasks,
    deleteTask,
    createTask,
    taskStateRef,
    setPlacements
  };
}
