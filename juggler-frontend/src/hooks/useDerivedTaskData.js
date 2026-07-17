/**
 * useDerivedTaskData — extracts derived task computations from AppLayout.
 *
 * Pure derivations from (allTasks, statuses, placements, timezone, filter):
 *   visibleTasks, dayPlacements (normalized), unplaced (filtered),
 *   backlogTasks, schedulerWarnings, filteredDayPlacements,
 *   blockedTaskIds, pastDueIds, fixedIds, unplacedIds,
 *   issuesCount, tasksByDate, unplacedCount, blockedCount, pastDueCount, fixedCount.
 *
 * @param {Array}    allTasks         raw task list
 * @param {Object}   statuses         id → status map
 * @param {Object}   placements       { dayPlacements, unplaced, warnings }
 * @param {string}   userTimezone     active timezone
 * @param {Object}   serverClock      server clock object (or null)
 * @param {Date}     today            today date (derived in parent)
 * @param {string}   projectFilter    current project filter
 * @param {string}   search           current search text
 * @returns {Object} all derived data
 */
import { useMemo } from 'react';
import { formatDateKey, parseDate, parseTimeToMinutes } from '../scheduler/dateHelpers';
import { getNowInTimezone } from '../utils/timezone';
import { isAllDayTask } from '../utils/isAllDayTask';
import { computeConflictBuckets } from '../scheduler/conflictBuckets';

function isTimeLocked(t) {
  if (t.placementMode === 'fixed' || t.placement_mode === 'fixed') return true;
  return false;
}

export default function useDerivedTaskData(allTasks, statuses, placements, userTimezone, serverClock, today, projectFilter, search) {
  // Visible tasks excludes recurring templates (blueprints) and disabled items (frozen by plan limits)
  var visibleTasks = useMemo(function() {
    return allTasks.filter(function(t) {
      return t.taskType !== 'recurring_template' && (statuses[t.id] || '') !== 'disabled';
    });
  }, [allTasks, statuses]);

  // Placements: re-key to canonical ISO "YYYY-MM-DD" in case a stale backend
  // (pre-ISO-refactor) returns legacy "M/D" keys — protects against the
  // "nothing scheduled" state during a partial deploy.
  var dayPlacements = useMemo(function() {
    var src = placements.dayPlacements || {};
    var keys = Object.keys(src);
    if (keys.length === 0) return src;
    var hasLegacy = keys.some(function(k) { return /^\d{1,2}\/\d{1,2}$/.test(k); });
    if (!hasLegacy) return src;
    var out = {};
    var now = new Date();
    keys.forEach(function(k) {
      var md = k.match(/^(\d{1,2})\/(\d{1,2})$/);
      var normalized = k;
      if (md) {
        var mo = Number(md[1]), dy = Number(md[2]);
        var currentMonth = now.getMonth() + 1;
        var year = (mo < currentMonth - 6) ? now.getFullYear() + 1 : now.getFullYear();
        normalized = year + '-' + (mo < 10 ? '0' : '') + mo + '-' + (dy < 10 ? '0' : '') + dy;
      }
      out[normalized] = (out[normalized] || []).concat(src[k] || []);
    });
    return out;
  }, [placements.dayPlacements]);

  // unplaced: filter phantom entries and recurring templates
  var unplaced = placements.unplaced;
  if (unplaced && unplaced.length > 0) {
    unplaced = unplaced.filter(function(t) {
      if (!t || !t.id) return false;
      if (!t.text) return false;
      if (t.taskType === 'recurring_template') return false;
      return true;
    });
  }

  // Backlog: active tasks with no date — intentionally undated, not scheduling failures
  var backlogTasks = useMemo(function() {
    var _unplacedIdSet = {};
    (unplaced || []).forEach(function(t) { if (t && t.id) _unplacedIdSet[t.id] = true; });
    return allTasks.filter(function(t) {
      if (!t || !t.id || _unplacedIdSet[t.id]) return false;
      if (t.taskType === 'recurring_template') return false;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'cancelled' || st === 'skip' || st === 'disabled' || st === 'pause') return false;
      return !t.scheduledAt && !t.date;
    });
  }, [allTasks, statuses, unplaced]);

  var schedulerWarnings = placements.warnings || [];

  // Filtered placements for grid views (projectFilter, search)
  var filteredDayPlacements = useMemo(function() {
    if (!projectFilter && !search) return dayPlacements;
    var searchLower = search ? search.toLowerCase() : '';
    var result = {};
    var keys = Object.keys(dayPlacements);
    for (var i = 0; i < keys.length; i++) {
      var arr = dayPlacements[keys[i]];
      var filtered = arr.filter(function(p) {
        if (!p.task) return true;
        if (projectFilter && (p.task.project || '') !== projectFilter) return false;
        if (searchLower) {
          var text = ((p.task.text || '') + ' ' + (p.task.project || '') + ' ' + (p.task.notes || '')).toLowerCase();
          if (text.indexOf(searchLower) === -1) return false;
        }
        return true;
      });
      result[keys[i]] = filtered;
    }
    return result;
  }, [dayPlacements, projectFilter, search]);

  // Blocked tasks: open tasks with at least one overdue undone dependency
  var blockedTaskIds = useMemo(function() {
    var ids = new Set();
    var _today = getNowInTimezone(userTimezone, serverClock).todayDate;
    var taskMap = {};
    visibleTasks.forEach(function(t) { taskMap[t.id] = t; });
    visibleTasks.forEach(function(t) {
      if (!t.dependsOn || t.dependsOn.length === 0) return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'cancelled' || st === 'skip') return;
      var hasOverdueDep = t.dependsOn.some(function(depId) {
        if ((statuses[depId] || '') === 'done') return false;
        var dep = taskMap[depId];
        if (!dep) return true;
        var depDate = dep.date && dep.date !== 'TBD' ? parseDate(dep.date) : null;
        var depDue = dep.deadline ? parseDate(dep.deadline) : null;
        return (depDate && depDate < _today) || (depDue && depDue < _today);
      });
      if (hasOverdueDep) ids.add(t.id);
    });
    return ids;
  }, [visibleTasks, statuses, serverClock, userTimezone]);

  // Past-due tasks: due date or scheduled date in the past, still open.
  // (a) day-level deadline before today
  // (b) scheduled date before today
  // (c) intraday, ONLY for fixed tasks (flexible tasks are auto-re-placed)
  // (d) scheduler emitted _unplacedReason === 'missed'
  var pastDueIds = useMemo(function() {
    var ids = new Set();
    var now = getNowInTimezone(userTimezone, serverClock);
    var _today = now.todayDate;
    var nowMins = now.nowMins;
    var todayKey = now.todayKey;
    (unplaced || []).forEach(function(u) {
      if (u && u.id && u._unplacedReason === 'missed') ids.add(u.id);
    });
    visibleTasks.forEach(function(t) {
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'cancelled' || st === 'skip') return;
      if (t.deadline) {
        var dd = parseDate(t.deadline);
        if (dd && dd < _today) { ids.add(t.id); return; }
      }
      if (t.date && t.date !== 'TBD') {
        var td = parseDate(t.date);
        if (td && td < _today) { ids.add(t.id); return; }
        if (t.date === todayKey && t.time && isTimeLocked(t)) {
          var startMins = parseTimeToMinutes(t.time);
          if (startMins != null) {
            var dur = Number(t.dur) || 0;
            if (startMins + dur <= nowMins) ids.add(t.id);
          }
        }
      }
    });
    return ids;
  }, [visibleTasks, statuses, userTimezone, serverClock, unplaced]);

  // Fixed tasks: placement_mode='fixed'
  var fixedIds = useMemo(function() {
    var ids = new Set();
    allTasks.forEach(function(t) {
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'cancelled' || st === 'skip') return;
      if (t.placementMode === 'fixed' || t.placement_mode === 'fixed') ids.add(t.id);
    });
    return ids;
  }, [allTasks, statuses]);

  var unplacedCount = unplaced.length;
  var blockedCount = blockedTaskIds.size;
  var pastDueCount = pastDueIds.size;
  var fixedCount = fixedIds.size;

  // Issues badge = computeConflictBuckets actionCount (same computation as Issues page)
  var issuesCount = useMemo(
    function() {
      return computeConflictBuckets({
        allTasks: visibleTasks, statuses: statuses, unplaced: unplaced,
        backlog: backlogTasks, schedulerWarnings: schedulerWarnings, today: today
      }).actionCount;
    },
    [visibleTasks, statuses, unplaced, backlogTasks, schedulerWarnings, today]
  );

  // Unplaced task IDs set for fast lookup
  var unplacedIds = useMemo(function() {
    var ids = new Set();
    unplaced.forEach(function(u) { ids.add(u.id || u.task?.id || u); });
    return ids;
  }, [unplaced]);

  // Tasks by date map — includes multiday all-day tasks on every date in their range (999.096)
  var tasksByDate = useMemo(function() {
    var map = {};
    allTasks.forEach(function(t) {
      var key = t.date || 'TBD';
      if (!map[key]) map[key] = [];
      map[key].push(t);
      if (isAllDayTask(t) && t.endDate && t.date && t.endDate > t.date) {
        var start = new Date(t.date + 'T00:00:00');
        var end = new Date(t.endDate + 'T00:00:00');
        for (var d = new Date(start.getTime() + 86400000); d <= end; d.setDate(d.getDate() + 1)) {
          var dk = formatDateKey(d);
          if (!map[dk]) map[dk] = [];
          if (dk !== key) map[dk].push(t);
        }
      }
    });
    return map;
  }, [allTasks]);

  return {
    visibleTasks,
    dayPlacements,
    unplaced,
    backlogTasks,
    schedulerWarnings,
    filteredDayPlacements,
    blockedTaskIds,
    pastDueIds,
    fixedIds,
    unplacedIds,
    issuesCount,
    tasksByDate,
    unplacedCount,
    blockedCount,
    pastDueCount,
    fixedCount,
  };
}