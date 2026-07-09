/**
 * useKeyboardShortcuts — J/K navigation, S status cycle, arrows, Ctrl+Z, ?, Escape
 *
 * Contract: this hook implements EXACTLY what HelpModal's SHORTCUTS list
 * advertises (999.1234). Key matching is case-insensitive (CapsLock/Shift must
 * not kill shortcuts); Cmd/Ctrl/Alt-modified keys are ignored except the
 * explicit Ctrl/Cmd+Z undo branch (so Cmd+S browser-save never cycles status);
 * Escape closes only the expanded task panel, per the Help contract.
 */

import { useEffect, useRef } from 'react';
import { formatDateKey } from '../scheduler/dateHelpers';

var HELP_HINT_KEY = 'juggler-help-hint-shown';

export default function useKeyboardShortcuts({
  selectedDate,
  tasksByDate,
  statuses,
  allTasks,
  expandedTask,
  expandedInstanceMap,
  setExpandedTask,
  setDayOffset,
  setShowHelp,
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
    // One-time discoverability hint (999.1234): Help documents every shortcut,
    // but nothing pointed at Help itself. Hint '?' on first visit only.
    try {
      if (!localStorage.getItem(HELP_HINT_KEY)) {
        localStorage.setItem(HELP_HINT_KEY, '1');
        showToast('Tip: press ? for keyboard shortcuts and help', 'info');
      }
    } catch (err) { /* storage unavailable — skip the hint */ }

    function filterTask(t) {
      var st = stateRef.current.statuses[t.id] || '';
      var f = stateRef.current.filter;
      if (f === 'open') return st !== 'done' && st !== 'cancel' && st !== 'skip' && st !== 'pause';
      if (f === 'done') return st === 'done';
      if (f === 'pause') return st === 'pause';
      return true;
    }

    function handleKeyDown(e) {
      var key = e.key.toLowerCase();

      // Ctrl/Cmd+Z: undo (the only modified-key shortcut)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
        e.preventDefault();
        var label = popUndoRef.current();
        if (label) showToast('Undid: ' + label, 'success');
        return;
      }

      // Skip if in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      // Any other Cmd/Ctrl/Alt combo belongs to the browser/OS (e.g. Cmd+S
      // save reflex) — never treat it as an app shortcut (999.1234).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      var st = stateRef.current;

      // Escape: close expanded panel (exactly what Help advertises)
      if (e.key === 'Escape') {
        setExpandedTask(null);
        return;
      }

      // ?: open the help guide
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(true);
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

      // J/K: navigate tasks in day (case-insensitive — CapsLock/Shift safe)
      if (key === 'j' || key === 'k') {
        var dk = formatDateKey(st.selectedDate);
        var dayT = (st.tasksByDate[dk] || []).filter(filterTask);
        if (dayT.length === 0) return;
        var curIdx = st.expandedTask ? dayT.findIndex(t => t.id === st.expandedTask) : -1;
        var nextIdx;
        if (key === 'j') nextIdx = curIdx < dayT.length - 1 ? curIdx + 1 : 0;
        else nextIdx = curIdx > 0 ? curIdx - 1 : dayT.length - 1;
        setExpandedTask(dayT[nextIdx].id);
        return;
      }

      // S: cycle status on expanded task (case-insensitive)
      if (key === 's' && st.expandedTask) {
        var cycle = ['', 'done'];
        // For recurring templates opened via an instance, use the instance ID for status
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
  }, [showToast, setExpandedTask, setDayOffset, setShowHelp, onStatusChange]);
}
