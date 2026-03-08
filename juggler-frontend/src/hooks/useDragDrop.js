/**
 * useDragDrop — grid drag (reschedule time/date), date drag (month view), priority drag
 */

import { useCallback } from 'react';
import { GRID_START } from '../state/constants';

export default function useDragDrop({ allTasks, onUpdate, gridZoom, showToast }) {
  var PX_PER_HOUR = gridZoom;
  var PX_PER_MIN = PX_PER_HOUR / 60;

  // Grid drop: calculate time from Y position, optionally update date
  var handleGridDrop = useCallback((e, targetDateKey) => {
    e.preventDefault();
    var taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    var rect = e.currentTarget.getBoundingClientRect();
    var yPx = e.clientY - rect.top;
    var totalMin = GRID_START * 60 + yPx / PX_PER_MIN;
    totalMin = Math.round(totalMin / 5) * 5;
    var hr = Math.floor(totalMin / 60);
    var mn = totalMin % 60;
    var ap = hr >= 12 ? 'PM' : 'AM';
    var h12 = hr > 12 ? hr - 12 : (hr === 0 ? 12 : hr);
    var newTime = h12 + ':' + (mn < 10 ? '0' : '') + mn + ' ' + ap;
    var fields = { time: newTime };

    var task = allTasks.find(t => t.id === taskId);
    if (task && task.date !== targetDateKey) {
      fields.date = targetDateKey;
    }

    onUpdate(taskId, fields);
    if (showToast) showToast('Moved to ' + newTime, 'success');
  }, [allTasks, onUpdate, PX_PER_MIN, showToast]);

  // Date-only drop: for month view — just change date
  var handleDateDrop = useCallback((e, targetDateKey) => {
    e.preventDefault();
    var taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    var task = allTasks.find(t => t.id === taskId);
    if (!task || task.date === targetDateKey) return;

    var fields = { date: targetDateKey };

    onUpdate(taskId, fields);
    if (showToast) showToast('Moved to ' + targetDateKey, 'success');
  }, [allTasks, onUpdate, showToast]);

  // Priority drop: change task's priority level
  var handlePriorityDrop = useCallback((taskId, newPri) => {
    var task = allTasks.find(t => t.id === taskId);
    if (!task || (task.pri || 'P3') === newPri) return;

    onUpdate(taskId, { pri: newPri });
    if (showToast) showToast('Priority: ' + newPri, 'success');
  }, [allTasks, onUpdate, showToast]);

  return { handleGridDrop, handleDateDrop, handlePriorityDrop };
}
