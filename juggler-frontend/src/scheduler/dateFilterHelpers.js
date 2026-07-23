/**
 * 999.2775 — shared date-range filter predicate for Priority/List/Dependency views.
 * Returns true if a task passes the active dateFilter.
 *
 * @param {object} task — must have a `date` field (YYYY-MM-DD string, 'TBD', or null/undefined)
 * @param {string} dateFilter — one of DATE_FILTERS ids ('all','today','tomorrow','thisweek','nextweek','thismonth','overdue','nodate')
 * @param {Date} todayDate — the canonical "today" (already timezone-adjusted)
 * @param {function} isTerminal — isTerminalStatus(status) to exclude done/cancelled/skip for overdue
 * @param {string} status — the task's current status string
 * @returns {boolean}
 */
import { formatDateKey, getWeekStart } from './dateHelpers';

export function matchesDateFilter(task, dateFilter, todayDate, isTerminal, status) {
  if (!dateFilter || dateFilter === 'all') return true;

  var taskDate = task.date;
  var todayKey = formatDateKey(todayDate || new Date());

  if (dateFilter === 'nodate') {
    return !taskDate || taskDate === 'TBD';
  }

  // All remaining filters need a real date
  if (!taskDate || taskDate === 'TBD') return false;

  if (dateFilter === 'today') {
    return taskDate === todayKey;
  }

  if (dateFilter === 'tomorrow') {
    var tom = new Date(todayDate || new Date());
    tom.setDate(tom.getDate() + 1);
    return taskDate === formatDateKey(tom);
  }

  if (dateFilter === 'thisweek') {
    var ws = getWeekStart(todayDate || new Date());
    var we = new Date(ws); we.setDate(we.getDate() + 6);
    return taskDate >= formatDateKey(ws) && taskDate <= formatDateKey(we);
  }

  if (dateFilter === 'nextweek') {
    var nws = getWeekStart(todayDate || new Date());
    nws.setDate(nws.getDate() + 7);
    var nwe = new Date(nws); nwe.setDate(nwe.getDate() + 6);
    return taskDate >= formatDateKey(nws) && taskDate <= formatDateKey(nwe);
  }

  if (dateFilter === 'thismonth') {
    var t = todayDate || new Date();
    var ms = new Date(t.getFullYear(), t.getMonth(), 1);
    var me = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    return taskDate >= formatDateKey(ms) && taskDate <= formatDateKey(me);
  }

  if (dateFilter === 'overdue') {
    return taskDate < todayKey && !isTerminal(status || '');
  }

  return true; // unknown filter = no restriction
}