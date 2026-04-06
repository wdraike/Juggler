/**
 * useDragDrop — grid drag (reschedule time/date), date drag (month view), priority drag
 *
 * When a recurring recurring task is moved to a day outside its recurrence pattern,
 * onRecurDayConflict is called instead of onUpdate, giving the caller a
 * chance to prompt the user before committing the change.
 */

import { useCallback } from 'react';
import { GRID_START } from '../state/constants';
import { parseDate } from '../scheduler/dateHelpers';

var DAY_CODES = ['U', 'M', 'T', 'W', 'R', 'F', 'S']; // Sun=0 … Sat=6
var DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Check if moving a task to targetDateKey conflicts with its recurrence days.
 * Returns { conflicting: true, dayCode, dayLabel, recurDays } or null.
 */
function checkRecurDayConflict(task, targetDateKey, allTasks) {
  if (!task || !task.recurring) return null;
  // Resolve recur from task or its source template
  var recur = task.recur;
  if (!recur && task.sourceId) {
    var src = allTasks.find(function(t) { return t.id === task.sourceId; });
    if (src) recur = src.recur;
  }
  if (!recur) return null;
  if (recur.type !== 'weekly' && recur.type !== 'biweekly') return null;
  if (!recur.days) return null;

  var targetDate = parseDate(targetDateKey);
  if (!targetDate) return null;
  var targetDow = targetDate.getDay(); // 0=Sun … 6=Sat
  var targetDayCode = DAY_CODES[targetDow];

  if (recur.days.indexOf(targetDayCode) >= 0) return null; // day is already allowed

  return {
    conflicting: true,
    dayCode: targetDayCode,
    dayLabel: DAY_LABELS[targetDow],
    recurDays: recur.days,
    recur: recur
  };
}

export default function useDragDrop({ allTasks, onUpdate, gridZoom, showToast, onRecurDayConflict }) {
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

      // Check if the move conflicts with recurrence days
      var conflict = checkRecurDayConflict(task, targetDateKey, allTasks);
      if (conflict && onRecurDayConflict) {
        onRecurDayConflict({
          taskId: taskId,
          task: task,
          fields: fields,
          conflict: conflict
        });
        return;
      }
    }

    // Mark as drag-pin so the backend converts to fixed mode
    fields._dragPin = true;
    onUpdate(taskId, fields);
    if (showToast) showToast('\uD83D\uDCCC Pinned at ' + newTime + ' \u00B7 Unpin in task details', 'success');
  }, [allTasks, onUpdate, PX_PER_MIN, showToast, onRecurDayConflict]);

  // Date-only drop: for month view — just change date
  var handleDateDrop = useCallback((e, targetDateKey) => {
    e.preventDefault();
    var taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    var task = allTasks.find(t => t.id === taskId);
    if (!task || task.date === targetDateKey) return;

    var fields = { date: targetDateKey };

    // Check if the move conflicts with recurrence days
    var conflict = checkRecurDayConflict(task, targetDateKey, allTasks);
    if (conflict && onRecurDayConflict) {
      onRecurDayConflict({
        taskId: taskId,
        task: task,
        fields: fields,
        conflict: conflict
      });
      return;
    }

    onUpdate(taskId, fields);
    if (showToast) showToast('Moved to ' + targetDateKey, 'success');
  }, [allTasks, onUpdate, showToast, onRecurDayConflict]);

  // Priority drop: change task's priority level
  var handlePriorityDrop = useCallback((taskId, newPri) => {
    var task = allTasks.find(t => t.id === taskId);
    if (!task || (task.pri || 'P3') === newPri) return;

    onUpdate(taskId, { pri: newPri });
    if (showToast) showToast('Priority: ' + newPri, 'success');
  }, [allTasks, onUpdate, showToast]);

  return { handleGridDrop, handleDateDrop, handlePriorityDrop };
}
