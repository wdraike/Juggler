/**
 * useKeyboardShortcuts — J/K navigation, S status cycle, arrows, Ctrl+Z, Escape
 */

import { useEffect, useRef } from 'react';
import { formatDateKey } from '../scheduler/dateHelpers';

export default function useKeyboardShortcuts({
  selectedDate,
  tasksByDate,
  statuses,
  allTasks,
  expandedTask,
  expandedInstanceMap,
  setExpandedTask,
  setDayOffset,
  setShowSettings,
  setShowExport,
  onStatusChange,
  popUndo,
  showToast,
  filter
}) {
  var stateRef = useRef({});
  var popUndoRef = useRef(popUndo);
  popUndoRef.current = popUndo;

  stateRef.current = {
    selectedDate, tasksByDate, expandedTask, expandedInstanceMap, allTasks, statuses, filter
  };

  useEffect(() => {
    function filterTask(t) {
      var st = stateRef.current.statuses[t.id] || '';
      var f = stateRef.current.filter;
      if (f === 'open') return st !== 'done' && st !== 'cancel' && st !== 'skip' && st !== 'pause';
      if (f === 'done') return st === 'done';
      if (f === 'wip') return st === 'wip';
      if (f === 'pause') return st === 'pause';
      return true;
    }

    function handleKeyDown(e) {
      // Ctrl/Cmd+Z: undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        var label = popUndoRef.current();
        if (label) showToast('Undid: ' + label, 'success');
        return;
      }

      // Skip if in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      var st = stateRef.current;

      // Escape: close panels
      if (e.key === 'Escape') {
        setExpandedTask(null);
        setShowSettings(false);
        setShowExport(false);
        return;
      }

      // Arrow keys: navigate days
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setDayOffset(d => d - (e.shiftKey ? 7 : 1));
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setDayOffset(d => d + (e.shiftKey ? 7 : 1));
        return;
      }

      // J/K: navigate tasks in day
      if (e.key === 'j' || e.key === 'k') {
        var dk = formatDateKey(st.selectedDate);
        var dayT = (st.tasksByDate[dk] || []).filter(filterTask);
        if (dayT.length === 0) return;
        var curIdx = st.expandedTask ? dayT.findIndex(t => t.id === st.expandedTask) : -1;
        var nextIdx;
        if (e.key === 'j') nextIdx = curIdx < dayT.length - 1 ? curIdx + 1 : 0;
        else nextIdx = curIdx > 0 ? curIdx - 1 : dayT.length - 1;
        setExpandedTask(dayT[nextIdx].id);
        return;
      }

      // S: cycle status on expanded task
      if (e.key === 's' && st.expandedTask) {
        var cycle = ['', 'wip', 'done'];
        // For habit templates opened via an instance, use the instance ID for status
        var statusTarget = (st.expandedInstanceMap && st.expandedInstanceMap[st.expandedTask]) || st.expandedTask;
        var ct = st.allTasks.find(t => t.id === statusTarget);
        if (ct) {
          var curSt = st.statuses[ct.id] || '';
          var ci = cycle.indexOf(curSt);
          onStatusChange(statusTarget, cycle[(ci + 1) % cycle.length]);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showToast, setExpandedTask, setDayOffset, setShowSettings, setShowExport, onStatusChange]);
}
