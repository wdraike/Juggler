/**
 * AppLayout — main layout: header + navigation + content + toast
 * Orchestrates all state and views
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ErrorBoundary from '../ErrorBoundary';
import HeaderBar from './HeaderBar';
import WeekStrip from './WeekStrip';
import NavigationBar from './NavigationBar';
import ToastNotification, { useToast } from './ToastNotification';
import useTaskState from '../../hooks/useTaskState';
import useConfig from '../../hooks/useConfig';
import useUndo from '../../hooks/useUndo';
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts';
import useDragDrop from '../../hooks/useDragDrop';
import useIsMobile from '../../hooks/useIsMobile';
import { getTheme } from '../../theme/colors';
import { formatDateKey, getWeekStart, parseDate } from '../../scheduler/dateHelpers';
import { DAY_NAMES, applyDefaults } from '../../state/constants';
import { useAuth } from '../auth/AuthProvider';
import { useTimezone } from '../../hooks/useTimezone';
import { getNowInTimezone } from '../../utils/timezone';

// Views
import DayView from '../views/DayView';
import ThreeDayView from '../views/ThreeDayView';
import WeekView from '../views/WeekView';
import ListView from '../views/ListView';
import PriorityView from '../views/PriorityView';
import ConflictsView from '../views/ConflictsView';
import DependencyView from '../views/DependencyView';
import TimelineView from '../views/TimelineView';
import SCurveView from '../views/SCurveView';
import CalendarView from '../views/CalendarView';
import DailyView from '../views/DailyView';

// Task components
import TaskEditForm from '../tasks/TaskEditForm';

// Advanced features
import SettingsPanel from '../settings/SettingsPanel';
import ImportExportPanel from '../features/ImportExportPanel';
import CompletionTimePicker from '../features/CompletionTimePicker';

import GCalSyncPanel from '../features/GCalSyncPanel';
import MsftCalSyncPanel from '../features/MsftCalSyncPanel';
import CalSyncPanel from '../features/CalSyncPanel';
import HelpModal from '../features/HelpModal';
import DisabledItemsPanel from '../billing/DisabledItemsPanel';
import AiCommandPanel from '../features/AiCommandPanel';
import AppFooter from './AppFooter';
import apiClient from '../../services/apiClient';

export default function AppLayout() {
  // Auth & timezone
  var { user: authUser } = useAuth();
  var config = useConfig();
  var { activeTimezone, source: tzSource, browserTimezone } = useTimezone(config);
  var userTimezone = activeTimezone;

  // State
  var { taskState, dispatch, dispatchPersist, loading, saving, loadTasks, placements, loadPlacements, setStatus, updateTask, addTasks, deleteTask, createTask, taskStateRef, setPlacements, flushNow } = useTaskState();
  var isMobile = useIsMobile();
  var { toast, toastHistory, showToast } = useToast();
  var { pushUndo, popUndo } = useUndo(taskStateRef, dispatch, dispatchPersist);

  // ── Persisted UI state ──
  var _savedUI = useMemo(function () {
    try { return JSON.parse(localStorage.getItem('juggler-ui-state')) || {}; }
    catch (e) { return {}; }
  }, []);

  var [darkMode, setDarkMode] = useState(function() {
    var saved = localStorage.getItem('juggler-darkMode');
    return saved !== null ? saved === 'true' : true;
  });
  var [viewMode, setViewModeRaw] = useState(_savedUI.viewMode || 'daily');
  var [filter, setFilter] = useState(_savedUI.filter || 'open');
  var [search, setSearch] = useState(_savedUI.search || '');
  var [projectFilter, setProjectFilter] = useState(_savedUI.projectFilter || '');
  var setViewMode = useCallback(function(v) {
    setViewModeRaw(function(prev) {
      if (prev === 'deps' && v !== 'deps') setProjectFilter('');
      return v;
    });
    setFilter('open');
    setSearch('');
    setProjectFilter('');
  }, []);
  var [dayOffset, setDayOffset] = useState(function () {
    // Restore saved date as offset from today
    if (_savedUI.selectedDate) {
      var saved = new Date(_savedUI.selectedDate + 'T12:00:00');
      var today = new Date(); today.setHours(12, 0, 0, 0);
      var diff = Math.round((saved - today) / 86400000);
      // Only restore if within reasonable range (±90 days)
      if (Math.abs(diff) <= 90) return diff;
    }
    return 0;
  });
  var [expandedTasks, setExpandedTasks] = useState([]);
  // Task detail fetched from API when expanding — always fresh, always complete
  var [expandedTaskData, setExpandedTaskData] = useState({});
  // Maps template ID → instance ID that was clicked, so status changes target the instance
  var expandedInstanceRef = useRef({});
  var [showSettings, setShowSettings] = useState(false);
  var [showExport, setShowExport] = useState(false);
  var [showGCalSync, setShowGCalSync] = useState(false);
  var [showMsftCalSync, setShowMsftCalSync] = useState(false);
  var [showCalSync, setShowCalSync] = useState(false);
  var [showToastHistory, setShowToastHistory] = useState(false);

  var [showHelp, setShowHelp] = useState(false);
  var [showDisabledItems, setShowDisabledItems] = useState(false);
  var [showCreateForm, setShowCreateForm] = useState(false);
  var [completionPickerTask, setCompletionPickerTask] = useState(null); // task being marked done
  // Pending recurrence-day conflict confirmation from drag-drop
  var [recurDayConfirm, setRecurDayConfirm] = useState(null);
  var [gcalAutoSync, setGcalAutoSync] = useState(false);
  var [gcalLastSyncedAt, setGcalLastSyncedAt] = useState(null);
  var [gcalSyncing, setGcalSyncing] = useState(false);
  var [msftCalAutoSync, setMsftCalAutoSync] = useState(false);
  var [msftCalLastSyncedAt, setMsftCalLastSyncedAt] = useState(null);
  var [msftCalSyncing, setMsftCalSyncing] = useState(false);
  var [appleCalAutoSync, setAppleCalAutoSync] = useState(false);
  var [appleCalLastSyncedAt, setAppleCalLastSyncedAt] = useState(null);
  var [appleCalSyncing, setAppleCalSyncing] = useState(false);
  var [appleCalConnected, setAppleCalConnected] = useState(null);
  var [calSyncProgress, setCalSyncProgress] = useState(null); // { phase, detail, pct, provider, calendar }
  var editingRef = useRef(false);
  var [schedulerReady, setSchedulerReady] = useState(false);

  var theme = getTheme(darkMode);
  var statuses = taskState.statuses;
  var allTasks = taskState.tasks;
  // Refs that always point at the latest tasks/statuses, so callbacks that
  // only read them (never cause re-render) can be useCallback'd with an
  // empty dep list and stay identity-stable across upserts. Without this,
  // every status change rebuilds handleStatusChange, which cascades fresh
  // props into every TaskCard and busts the memo.
  var allTasksRef = useRef(allTasks);
  var statusesRef = useRef(statuses);
  useEffect(function() { allTasksRef.current = allTasks; }, [allTasks]);
  useEffect(function() { statusesRef.current = statuses; }, [statuses]);

  // Visible tasks excludes recurring templates (blueprints) and disabled items (frozen by plan limits)
  var visibleTasks = useMemo(function() {
    return allTasks.filter(function(t) {
      return t.taskType !== 'recurring_template' && (statuses[t.id] || '') !== 'disabled';
    });
  }, [allTasks, statuses]);

  // Track when editing UI is open to suspend background syncs/scheduling
  editingRef.current = expandedTasks.length > 0 || !!showCreateForm || !!showSettings;

  // Load data on mount — tasks + cached placements in parallel, then scheduler in background
  useEffect(() => {
    // Parallel: load tasks and cached placements simultaneously
    Promise.all([
      loadTasks(),
      loadPlacements()
    ]).then(function(results) {
      var taskResult = results[0];
      if (taskResult?.config) {
        config.initFromConfig(taskResult.config);
      }
      // Background: run scheduler for fresh result (doesn't block initial render)
      apiClient.post('/schedule/run').then(function(res) {
        if (res.data?.dayPlacements) {
          loadPlacements();
        }
        setSchedulerReady(true);
      }).catch(function() {
        setSchedulerReady(true);
      });
    });
  }, []);

  // Handle ?gcal=connected or ?msftcal=connected redirect from OAuth callback
  useEffect(() => {
    var params = new URLSearchParams(window.location.search);
    if (params.get('gcal') === 'connected') {
      showToast('Google Calendar connected!', 'success');
      params.delete('gcal');
      var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      if (window.opener) {
        window.opener.postMessage('gcal-connected', '*');
        window.close();
      }
    }
    if (params.get('msftcal') === 'connected') {
      showToast('Microsoft Calendar connected!', 'success');
      params.delete('msftcal');
      var newUrl2 = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl2);
      if (window.opener) {
        window.opener.postMessage('msftcal-connected', '*');
        window.close();
      }
    }
  }, []);

  // Fetch GCal + MsftCal status on mount
  useEffect(() => {
    apiClient.get('/gcal/status')
      .then(function(r) {
        setGcalAutoSync(!!r.data.autoSync);
        setGcalLastSyncedAt(r.data.lastSyncedAt || null);
        if (r.data.tokenExpired) {
          showToast('Google Calendar connection expired. Please reconnect in Calendar Sync settings.', 'error');
        }
      })
      .catch(function() { /* not connected */ });
    apiClient.get('/msft-cal/status')
      .then(function(r) {
        setMsftCalAutoSync(!!r.data.autoSync);
        setMsftCalLastSyncedAt(r.data.lastSyncedAt || null);
        if (r.data.tokenExpired) {
          showToast('Microsoft Calendar connection expired. Please reconnect in Calendar Sync settings.', 'error');
        }
      })
      .catch(function() { /* not connected */ });
    apiClient.get('/apple-cal/status')
      .then(function(r) {
        setAppleCalConnected(!!r.data.connected);
        setAppleCalAutoSync(!!r.data.autoSync);
        setAppleCalLastSyncedAt(r.data.lastSyncedAt || null);
      })
      .catch(function() { setAppleCalConnected(false); });
  }, []);

  // Combined calendar auto-sync: configurable frequency, full sync only when changes detected
  // Waits for initial scheduler run to complete before starting any external syncs
  var calSyncSettings = config.calSyncSettings || { gcal: { mode: 'full', frequency: 120 }, msft: { mode: 'full', frequency: 120 } };
  useEffect(() => {
    // Derive auto-sync from frequency: frequency > 0 means auto-sync is on
    var gcalFreq = (calSyncSettings.gcal || {}).frequency || 0;
    var msftFreq = (calSyncSettings.msft || {}).frequency || 0;
    var gcalAuto = gcalAutoSync || gcalFreq > 0;
    var msftAuto = msftCalAutoSync || msftFreq > 0;
    if (!gcalAuto && !msftAuto) return;
    if (!schedulerReady) return;

    function runFullSync() {
      setGcalSyncing(true);
      setMsftCalSyncing(true);
      apiClient.post('/cal/sync').then(function(r) {
        var errors = r.data.errors || [];
        var hasTokenExpiry = errors.some(function(e) { return e.tokenExpired; });
        var nonTokenErrors = errors.filter(function(e) { return !e.tokenExpired; });

        if (hasTokenExpiry) {
          showToast('Calendar connection expired. Please reconnect in Calendar Sync settings.', 'error');
        } else if (nonTokenErrors.length > 0) {
          showToast('Calendar sync completed with ' + nonTokenErrors.length + ' error(s). Open Calendar Sync for details.', 'error');
        }

        // Only update last-synced timestamp if there were no errors
        if (errors.length === 0) {
          var now = new Date().toISOString();
          if (gcalAutoSync) setGcalLastSyncedAt(now);
          if (msftCalAutoSync) setMsftCalLastSyncedAt(now);
        }
        // Intentionally no loadTasks() here: the backend emits
        // tasks:changed / schedule:changed over SSE when cal-sync touches
        // rows, and the surgical handlers in useTaskState apply the
        // deltas without re-dispatching INIT. The old full refresh here
        // was legacy from before the SSE pipeline existed.
      }).catch(function(e) {
        if (e.response?.status === 409) {
          // Lock held — skip silently, the interval will retry later
          return;
        }
        var hasTokenExpiry = e.response?.data?.errors?.some(function(err) { return err.tokenExpired; });
        if (hasTokenExpiry) {
          showToast('Calendar connection expired. Please reconnect in Calendar Sync settings.', 'error');
        } else {
          var msg = e.response?.data?.error || e.message;
          showToast('Calendar sync failed: ' + (msg || 'unknown error'), 'error');
        }
      }).finally(function() {
        setGcalSyncing(false);
        setMsftCalSyncing(false);
      });
    }

    function checkAndSync() {
      if (editingRef.current) return;

      // Lightweight check first — only full sync if something changed
      apiClient.get('/cal/has-changes').then(function(r) {
        if (r.data.hasChanges) {
          runFullSync();
        }
      }).catch(function() {
        // If the check fails, fall back to a full sync
        runFullSync();
      });
    }

    // Initial sync on load (full sync to catch up)
    var initialTimer = setTimeout(runFullSync, 5000);
    // Use the shortest active provider frequency for the poll interval
    var activeFreqs = [];
    if (gcalAuto && gcalFreq > 0) activeFreqs.push(gcalFreq);
    if (msftAuto && msftFreq > 0) activeFreqs.push(msftFreq);
    var intervalMs = activeFreqs.length > 0 ? Math.min.apply(null, activeFreqs) * 1000 : 2 * 60 * 1000;
    var intervalId = setInterval(checkAndSync, intervalMs);

    return function() {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [gcalAutoSync, msftCalAutoSync, schedulerReady, loadTasks, loadPlacements, calSyncSettings]);

  // Listen for sync:progress SSE events (shared with CalSyncPanel + HeaderBar)
  useEffect(function() {
    var attached = null;
    function handleSyncProgress(e) {
      try {
        var data = JSON.parse(e.data);
        setCalSyncProgress(data);
        if (data.phase === 'done') {
          setTimeout(function() { setCalSyncProgress(null); }, 2000);
        }
      } catch (err) { /* ignore */ }
    }
    // Poll until the event source appears (created asynchronously by useTaskState)
    var poll = setInterval(function() {
      var es = window.__jugglerEventSource;
      if (es && !attached) {
        attached = es;
        es.addEventListener('sync:progress', handleSyncProgress);
        clearInterval(poll);
      }
    }, 500);
    // Also check immediately
    var es = window.__jugglerEventSource;
    if (es) {
      attached = es;
      es.addEventListener('sync:progress', handleSyncProgress);
      clearInterval(poll);
    }
    return function() {
      clearInterval(poll);
      if (attached) attached.removeEventListener('sync:progress', handleSyncProgress);
    };
  }, []);

  // Derived dates
  var today = useMemo(() => {
    return getNowInTimezone(userTimezone).todayDate;
  }, [userTimezone]);

  var selectedDate = useMemo(() => {
    var d = new Date(today); d.setDate(d.getDate() + dayOffset); return d;
  }, [today, dayOffset]);

  var selectedDateKey = useMemo(() => formatDateKey(selectedDate), [selectedDate]);

  // Persist UI state to localStorage on change
  useEffect(function () {
    try {
      localStorage.setItem('juggler-ui-state', JSON.stringify({
        viewMode: viewMode,
        filter: filter,
        search: search,
        projectFilter: projectFilter,
        selectedDate: selectedDateKey
      }));
    } catch (e) { /* quota exceeded — ignore */ }
  }, [viewMode, filter, search, projectFilter, selectedDateKey]);

  var weekStripDates = useMemo(() => {
    var start = getWeekStart(selectedDate);
    return Array.from({ length: 7 }, (_, i) => {
      var d = new Date(start); d.setDate(d.getDate() + i); return d;
    });
  }, [selectedDate]);

  // Schedule config bundle
  var schedCfg = useMemo(() => ({
    timeBlocks: config.timeBlocks,
    locSchedules: config.locSchedules,
    locScheduleDefaults: config.locScheduleDefaults,
    locScheduleOverrides: config.locScheduleOverrides,
    hourLocationOverrides: config.hourLocationOverrides,
    toolMatrix: config.toolMatrix,
    splitDefault: config.splitDefault,
    splitMinDefault: config.splitMinDefault,
    schedFloor: config.schedFloor,
    schedCeiling: config.schedCeiling,
    scheduleTemplates: config.scheduleTemplates
  }), [config.timeBlocks, config.locSchedules, config.locScheduleDefaults, config.locScheduleOverrides, config.hourLocationOverrides, config.toolMatrix, config.splitDefault, config.splitMinDefault, config.schedFloor, config.schedCeiling, config.scheduleTemplates]);

  // Placements come from the backend scheduler API
  var dayPlacements = placements.dayPlacements;
  var unplaced = placements.unplaced;
  // Include active tasks with no scheduled_at — these have no date and won't
  // appear on any calendar day. Show them in the unplaced list so they're not lost.
  var _unplacedIdSet = {};
  (unplaced || []).forEach(function(t) { if (t && t.id) _unplacedIdSet[t.id] = true; });
  var nullScheduled = allTasks.filter(function(t) {
    if (!t || !t.id || _unplacedIdSet[t.id]) return false;
    if (t.taskType === 'recurring_template') return false;
    var st = statuses[t.id] || '';
    if (st === 'done' || st === 'cancel' || st === 'skip' || st === 'disabled' || st === 'pause') return false;
    return !t.scheduledAt && !t.date;
  });
  if (nullScheduled.length > 0) unplaced = (unplaced || []).concat(nullScheduled);
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

  // Blocked tasks: tasks whose dependencies are not all done AND whose
  // date is today or in the past (future tasks with pending deps are expected)
  // Blocked tasks: open tasks with at least one overdue undone dependency
  var blockedTaskIds = useMemo(() => {
    var ids = new Set();
    var today = getNowInTimezone(userTimezone).todayDate;
    var taskMap = {};
    visibleTasks.forEach(function(t) { taskMap[t.id] = t; });
    visibleTasks.forEach(t => {
      if (!t.dependsOn || t.dependsOn.length === 0) return;
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;
      var hasOverdueDep = t.dependsOn.some(function(depId) {
        if ((statuses[depId] || '') === 'done') return false;
        var dep = taskMap[depId];
        if (!dep) return true; // missing dep counts as overdue
        // Overdue if dep's date or due date is in the past
        var depDate = dep.date && dep.date !== 'TBD' ? parseDate(dep.date) : null;
        var depDue = dep.deadline ? parseDate(dep.deadline) : null;
        return (depDate && depDate < today) || (depDue && depDue < today);
      });
      if (hasOverdueDep) ids.add(t.id);
    });
    return ids;
  }, [visibleTasks, statuses]);

  // Past-due tasks: due date or scheduled date in the past, still open
  // Split into overdue (has due date) vs stale (only scheduled date) to match
  // ConflictsView categories — only overdue counts as Action Required
  var pastDueIds = useMemo(() => {
    var ids = new Set();
    var today = getNowInTimezone(userTimezone).todayDate;
    visibleTasks.forEach(t => {
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;
      if (t.generated) return;
      if (t.deadline) {
        var dd = parseDate(t.deadline);
        if (dd && dd < today) { ids.add(t.id); return; }
      }
      if (t.date && t.date !== 'TBD') {
        var td = parseDate(t.date);
        if (td && td < today) ids.add(t.id);
      }
    });
    return ids;
  }, [visibleTasks, statuses]);

  var overdueIds = useMemo(() => {
    var ids = new Set();
    var today = getNowInTimezone(userTimezone).todayDate;
    visibleTasks.forEach(t => {
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;
      if (t.generated) return;
      if (t.deadline) {
        var dd = parseDate(t.deadline);
        if (dd && dd < today) ids.add(t.id);
      }
    });
    return ids;
  }, [visibleTasks, statuses]);

  // Fixed tasks: when contains 'fixed'
  var fixedIds = useMemo(() => {
    var ids = new Set();
    allTasks.forEach(t => {
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;
      if (t.when && t.when.indexOf('fixed') >= 0) ids.add(t.id);
    });
    return ids;
  }, [allTasks, statuses]);

  var unplacedCount = unplaced.length;
  var blockedCount = blockedTaskIds.size;
  var pastDueCount = pastDueIds.size;
  var fixedCount = fixedIds.size;
  var warningCount = schedulerWarnings.length;
  var overdueCount = overdueIds.size;
  var issuesCount = unplacedCount + overdueCount + warningCount;

  // Unplaced task IDs set for fast lookup
  var unplacedIds = useMemo(() => {
    var ids = new Set();
    unplaced.forEach(u => ids.add(u.id || u.task?.id || u));
    return ids;
  }, [unplaced]);

  // Recurring recurring expansion is handled server-side in runSchedule.js

  // Tasks by date map
  var tasksByDate = useMemo(() => {
    var map = {};
    allTasks.forEach(t => {
      var key = t.date || 'TBD';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return map;
  }, [allTasks]);

  // Now minutes (ET) — update every minute
  var [nowMins, setNowMins] = useState(() => {
    return getNowInTimezone(userTimezone).nowMins;
  });

  useEffect(() => {
    var id = setInterval(() => {
      setNowMins(getNowInTimezone(userTimezone).nowMins);
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // All unique tags — derived from scheduleTemplates if available, else legacy timeBlocks
  var uniqueTags = useMemo(() => {
    var seen = {}, result = [];
    var templates = config.scheduleTemplates;
    if (templates && Object.keys(templates).length > 0) {
      Object.keys(templates).forEach(function(tmplId) {
        (templates[tmplId].blocks || []).forEach(function(b) {
          if (!seen[b.tag]) {
            seen[b.tag] = true;
            result.push({ tag: b.tag, name: b.name, icon: b.icon, color: b.color, _earliest: b.start });
          } else {
            var existing = result.find(function(r) { return r.tag === b.tag; });
            if (existing && b.start < existing._earliest) existing._earliest = b.start;
          }
        });
      });
    } else {
      DAY_NAMES.forEach(function(dn) {
        (config.timeBlocks[dn] || []).forEach(function(b) {
          if (!seen[b.tag]) {
            seen[b.tag] = true;
            result.push({ tag: b.tag, name: b.name, icon: b.icon, color: b.color, _earliest: b.start });
          } else {
            var existing = result.find(function(r) { return r.tag === b.tag; });
            if (existing && b.start < existing._earliest) existing._earliest = b.start;
          }
        });
      });
    }
    // Sort by canonical day order (morning→lunch→afternoon→evening→night).
    // _earliest can be skewed by special-purpose templates (e.g., "car" has Night at midnight).
    var TAG_ORDER = { morning: 1, lunch: 2, biz: 2.5, afternoon: 3, evening: 4, night: 5 };
    result.sort((a, b) => (TAG_ORDER[a.tag] || 99) - (TAG_ORDER[b.tag] || 99));
    return result;
  }, [config.scheduleTemplates, config.timeBlocks]);

  // All project names
  var allProjectNames = useMemo(() => {
    var names = {};
    allTasks.forEach(t => { if (t.project) names[t.project] = true; });
    config.projects.forEach(p => { if (p.name) names[p.name] = true; });
    return Object.keys(names).sort();
  }, [allTasks, config.projects]);

  // Status change handler. Reads allTasks through a ref so this callback's
  // identity is stable across task upserts — that keeps memoized TaskCards
  // from re-rendering on every scheduler run.
  var todayRef = useRef(today);
  useEffect(function() { todayRef.current = today; }, [today]);
  var handleStatusChange = useCallback((id, val) => {
    var tasks = allTasksRef.current;
    if (val === 'done') {
      var task = tasks.find(function(t) { return t.id === id; });
      // Block marking future recurring instances as done
      if (task && task.recurring && task.taskType === 'recurring_instance') {
        var taskDate = parseDate(task.date);
        var nowDay = todayRef.current;
        if (taskDate && nowDay && taskDate > nowDay) {
          showToast('Can\'t mark a future recurring task as done — skip or cancel it instead', 'warning');
          return;
        }
      }
      setCompletionPickerTask(task || { id: id });
      return;
    }
    pushUndo('status change');
    setStatus(id, val, {
      taskFields: { status: val }
    });
    var labels = { done: 'Done', wip: 'WIP', cancel: 'Cancelled', skip: 'Skipped', '': 'Reopened' };
    showToast((labels[val] || val) + ': ' + (tasks.find(t => t.id === id)?.text || id).slice(0, 40), 'success');
  }, [pushUndo, setStatus, showToast]);

  var handleCompletionConfirm = useCallback(function(completedAt) {
    var task = completionPickerTask;
    if (!task) return;
    setCompletionPickerTask(null);
    pushUndo('status change');
    setStatus(task.id, 'done', {
      taskFields: { status: 'done' },
      completedAt: completedAt
    });
    showToast('Done: ' + (task.text || task.id).slice(0, 40), 'success');
  }, [completionPickerTask, pushUndo, setStatus, showToast]);

  // Task expand handler — from main views (single open).
  // Reads allTasks through a ref so this callback stays identity-stable
  // across upserts (same reasoning as handleStatusChange above).
  var handleExpand = useCallback((id) => {
    var tasks = allTasksRef.current;
    var effectiveId = id;
    var task = tasks.find(function(t) { return t.id === id; });
    if (task && task.sourceId) {
      var sourceExists = tasks.some(function(t) { return t.id === task.sourceId; });
      if (sourceExists) {
        effectiveId = task.sourceId;
        expandedInstanceRef.current[effectiveId] = id;
      }
    } else if (task && task.recurring) {
      var tmpl = tasks.find(function(t) {
        return t.taskType === 'recurring_template' && t.text === task.text;
      });
      if (tmpl) {
        effectiveId = tmpl.id;
        expandedInstanceRef.current[effectiveId] = id;
      }
    }
    // Toggle: close if already open
    setExpandedTasks(function(prev) {
      if (prev.length === 1 && prev[0] === effectiveId) return [];
      return [effectiveId];
    });
    // Fetch full task detail from API — always fresh, always complete
    apiClient.get('/tasks/' + effectiveId).then(function(res) {
      if (res.data && res.data.task) {
        setExpandedTaskData(function(prev) {
          var next = Object.assign({}, prev);
          next[effectiveId] = res.data.task;
          return next;
        });
      }
    }).catch(function(err) {
      console.error('Failed to fetch task detail:', err);
    });
  }, []);

  // Keep the open detail view (expandedTaskData) in sync with SSE task mutations.
  // expandedTaskData is otherwise populated only on form-open, so backend changes
  // (scheduler re-runs, other-tab edits, MCP writes) wouldn't reach the open form.
  useEffect(function() {
    if (expandedTasks.length === 0) return;
    var es = window.__jugglerEventSource;
    if (!es) return;
    var openIds = {};
    expandedTasks.forEach(function(id) { openIds[id] = true; });
    var refresh = function(id) {
      apiClient.get('/tasks/' + id).then(function(res) {
        if (!res.data || !res.data.task) return;
        setExpandedTaskData(function(prev) {
          var next = Object.assign({}, prev);
          next[id] = res.data.task;
          return next;
        });
      }).catch(function() { /* 404 = deleted; leave state as-is */ });
    };
    var handle = function(e) {
      var data = null;
      try { data = JSON.parse(e.data); } catch (err) {}
      if (!data) return;
      var ids = [];
      if (Array.isArray(data.ids)) ids = data.ids;
      else if (data.changeset) ids = (data.changeset.changed || []).concat(data.changeset.added || []);
      ids.filter(function(id) { return openIds[id]; }).forEach(refresh);
    };
    es.addEventListener('tasks:changed', handle);
    es.addEventListener('schedule:changed', handle);
    return function() {
      es.removeEventListener('tasks:changed', handle);
      es.removeEventListener('schedule:changed', handle);
    };
  }, [expandedTasks]);


  // Task create handler
  var handleCreate = useCallback((task) => {
    pushUndo('add task');
    createTask(task);
    showToast('Added: ' + task.text, 'success');
  }, [pushUndo, createTask, showToast]);

  // Task update handler
  var handleUpdateTask = useCallback(async (id, fields) => {
    pushUndo('edit task');
    var ok = await updateTask(id, fields);
    if (ok === false) {
      showToast('Save failed — try again', 'error');
    }
    return ok;
  }, [pushUndo, updateTask, showToast]);

  // Batch mark recurringTasks done for a given date
  var handleBatchRecurringDone = useCallback((dateKey) => {
    pushUndo('batch recurring done');
    var count = 0;
    allTasks.forEach(t => {
      if (t.recurring && t.date === dateKey && (statuses[t.id] || '') !== 'done') {
        setStatus(t.id, 'done', { taskFields: { status: 'done' } });
        count++;
      }
    });
    showToast(count + ' recurringTasks marked done', 'success');
  }, [allTasks, statuses, pushUndo, setStatus, showToast]);

  // Per-hour location override handler
  var handleHourLocationOverride = useCallback((dateKey, hour, locId) => {
    var overrides = Object.assign({}, config.hourLocationOverrides || {});
    if (!overrides[dateKey]) overrides[dateKey] = {};
    overrides[dateKey][hour] = locId;
    config.updateHourLocationOverrides(overrides);
    // Backend auto-reschedules after config save; reload placements after delay
    setTimeout(function() { loadPlacements(); }, 2000);
  }, [config, loadPlacements]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    selectedDate, tasksByDate, statuses, allTasks, filter,
    expandedTask: expandedTasks.length > 0 ? expandedTasks[expandedTasks.length - 1] : null,
    expandedInstanceMap: expandedInstanceRef.current,
    setExpandedTask: function(v) {
      if (v === null) setExpandedTasks([]);
      else setExpandedTasks([v]);
    },
    setDayOffset, setShowSettings, setShowExport,
    onStatusChange: handleStatusChange, popUndo, showToast
  });

  // Zoom change handler (pinch / ctrl+wheel on grid) — debounce the persist
  var zoomSaveTimerRef = useRef(null);
  var handleZoomChange = useCallback(function(newZoom) {
    config.setGridZoom(newZoom);
    if (zoomSaveTimerRef.current) clearTimeout(zoomSaveTimerRef.current);
    zoomSaveTimerRef.current = setTimeout(function() {
      config.updatePreferences({
        gridZoom: newZoom, splitDefault: config.splitDefault,
        splitMinDefault: config.splitMinDefault, schedFloor: config.schedFloor, schedCeiling: config.schedCeiling,
        fontSize: config.fontSize
      });
    }, 500);
  }, [config]);

  // Drag and drop handlers
  var { handleGridDrop, handleDateDrop, handlePriorityDrop } = useDragDrop({
    allTasks, onUpdate: handleUpdateTask, gridZoom: config.gridZoom, showToast,
    onRecurDayConflict: setRecurDayConfirm
  });

  // Marker drag handler — convert minutes to time string and update task
  var handleMarkerDrag = useCallback(function(taskId, totalMins) {
    var hr = Math.floor(totalMins / 60);
    var mn = totalMins % 60;
    var ap = hr >= 12 ? 'PM' : 'AM';
    var h12 = hr > 12 ? hr - 12 : (hr === 0 ? 12 : hr);
    var newTime = h12 + ':' + (mn < 10 ? '0' : '') + mn + ' ' + ap;
    pushUndo('drag time');
    updateTask(taskId, { time: newTime });

    // Optimistically update placements so the marker stays where it was dropped
    setPlacements(function(prev) {
      var dp = Object.assign({}, prev.dayPlacements);
      Object.keys(dp).forEach(function(dateKey) {
        dp[dateKey] = dp[dateKey].map(function(p) {
          if (p.task && p.task.id === taskId) {
            return Object.assign({}, p, { start: totalMins });
          }
          return p;
        });
      });
      return Object.assign({}, prev, { dayPlacements: dp });
    });

    showToast('Moved to ' + newTime, 'success');
  }, [pushUndo, updateTask, showToast, setPlacements]);

  // AI ops handler — applies ops from AI command panel
  var handleAiOps = useCallback(function(ops, msg) {
    pushUndo('AI command');
    var newSt = Object.assign({}, statuses);
    var newTasks = allTasks.slice();
    var taskEdits = {};
    var newLocs = null, newTools = null, newMatrix = null, newBlocks = null;

    // First pass: collect temp AI IDs and generate real IDs for new tasks
    var aiIdMap = {}; // maps temp IDs (ai001) to real IDs
    (ops || []).forEach(function(op) {
      if (op.op === 'add' && op.task && op.task.id) {
        var realId = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
        aiIdMap[op.task.id] = realId;
      }
    });

    (ops || []).forEach(function(op) {
      if (op.op === 'status') {
        if (op.value === '') { delete newSt[op.id]; } else { newSt[op.id] = op.value; }
      } else if (op.op === 'edit') {
        var editFields = Object.assign({}, op.fields);
        var srcTask = allTasks.find(function(tt) { return tt.id === op.id; });
        if (srcTask && srcTask.when && srcTask.when.indexOf('fixed') >= 0) {
          delete editFields.date; delete editFields.day; delete editFields.time;
        }
        // Resolve any temp AI IDs in dependsOn
        if (editFields.dependsOn) {
          editFields.dependsOn = editFields.dependsOn.map(function(d) { return aiIdMap[d] || d; });
        }
        taskEdits[op.id] = Object.assign({}, taskEdits[op.id] || {}, editFields);
      } else if (op.op === 'add' && op.task) {
        // New tasks are collected separately and sent via addTasks (POST)
        // Skip adding to newTasks here to avoid double-add
      } else if (op.op === 'delete') {
        newSt[op.id] = 'cancel';
      } else if (op.op === 'set_weekly' && op.day && op.location) {
        if (!newBlocks) newBlocks = JSON.parse(JSON.stringify(config.timeBlocks));
        (newBlocks[op.day] || []).forEach(function(b) {
          if (b.tag === 'biz' || b.tag === 'lunch') b.loc = op.location;
        });
      } else if (op.op === 'set_block_loc' && op.day && op.blockTag && op.location) {
        if (!newBlocks) newBlocks = JSON.parse(JSON.stringify(config.timeBlocks));
        (newBlocks[op.day] || []).forEach(function(b) {
          if (b.tag === op.blockTag || b.id === op.blockId) b.loc = op.location;
        });
      } else if (op.op === 'add_location' && op.id && op.name) {
        if (!newLocs) newLocs = config.locations.slice();
        if (!newLocs.some(function(l) { return l.id === op.id; })) {
          newLocs.push({ id: op.id, name: op.name, icon: op.icon || '\uD83D\uDCCD' });
        }
      } else if (op.op === 'add_tool' && op.id && op.name) {
        if (!newTools) newTools = config.tools.slice();
        if (!newTools.some(function(t) { return t.id === op.id; })) {
          newTools.push({ id: op.id, name: op.name, icon: op.icon || '\uD83D\uDD27' });
        }
      } else if (op.op === 'set_tool_matrix' && op.location && op.tools) {
        if (!newMatrix) newMatrix = Object.assign({}, config.toolMatrix);
        newMatrix[op.location] = op.tools;
      } else if (op.op === 'set_blocks' && op.day && op.blocks) {
        if (!newBlocks) newBlocks = Object.assign({}, config.timeBlocks);
        newBlocks[op.day] = op.blocks;
      } else if (op.op === 'clone_blocks' && op.from && op.to) {
        if (!newBlocks) newBlocks = JSON.parse(JSON.stringify(config.timeBlocks));
        var src = newBlocks[op.from] || config.timeBlocks[op.from] || [];
        op.to.forEach(function(d) { newBlocks[d] = JSON.parse(JSON.stringify(src)); });
      }
    });

    // Apply edits to tasks
    newTasks = newTasks.map(function(t) {
      return taskEdits[t.id] ? Object.assign({}, t, taskEdits[t.id]) : t;
    });

    // Collect newly added tasks (they need POST, not PUT)
    var addedTasks = [];
    (ops || []).forEach(function(op) {
      if (op.op === 'add' && op.task) {
        var task = applyDefaults(Object.assign({}, op.task));
        task.id = aiIdMap[task.id] || task.id;
        task.created = new Date().toISOString();
        if (op.task.dependsOn) {
          task.dependsOn = op.task.dependsOn.map(function(d) { return aiIdMap[d] || d; });
        }
        addedTasks.push(task);
      }
    });

    // For status/edit ops, use dispatchPersist (PUT /tasks/batch)
    dispatchPersist({ type: 'SET_ALL', statuses: newSt, tasks: newTasks });
    if (newLocs) config.updateLocations(newLocs);
    if (newTools) config.updateTools(newTools);
    if (newMatrix) config.updateToolMatrix(newMatrix);
    if (newBlocks) config.updateTimeBlocks(newBlocks);

    // For new tasks, use addTasks which does POST /tasks/batch + loadPlacements
    if (addedTasks.length > 0) {
      addTasks(addedTasks);
    }

    showToast(msg || 'AI: ' + ops.length + ' changes applied', 'success');
  }, [allTasks, statuses, config, pushUndo, dispatchPersist, showToast, addTasks]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.bg, color: theme.textMuted, fontFamily: "'Inter', system-ui", fontSize: 14 }}>
        Loading tasks...
      </div>
    );
  }

  var isToday = selectedDateKey === getNowInTimezone(userTimezone).todayKey;
  var expandedTaskObjs = expandedTasks.map(function(id) {
    // Prefer API-fetched detail (always complete) over task list
    if (expandedTaskData[id]) return expandedTaskData[id];
    // Fall back to task list while API fetch is in flight
    var found = allTasks.find(function(t) { return t.id === id; });
    if (found) return found;
    return null;
  }).filter(Boolean);

  return (
    <div style={{ height: '100vh', overflow: 'hidden', maxWidth: '100vw', background: theme.bg, fontFamily: "'Inter', system-ui, sans-serif" }}>
    <div style={{ width: isMobile ? '100%' : (10000 / config.fontSize) + '%', height: isMobile ? '100%' : (10000 / config.fontSize) + '%', transform: isMobile ? undefined : 'scale(' + (config.fontSize / 100) + ')', transformOrigin: '0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, zIndex: 100, background: theme.bg }}>
        <HeaderBar
          darkMode={darkMode} setDarkMode={function(v) { setDarkMode(function(prev) { var next = typeof v === 'function' ? v(prev) : v; localStorage.setItem('juggler-darkMode', String(next)); return next; }); }} saving={saving}
          activeTimezone={activeTimezone} tzSource={tzSource}
          selectedDateKey={selectedDateKey} statuses={statuses} tasksByDate={tasksByDate}
          onShowSettings={() => setShowSettings(true)} onShowExport={() => setShowExport(true)}
          onShowGCalSync={() => setShowGCalSync(true)}
          gcalSyncing={gcalSyncing}
          onShowMsftCalSync={() => setShowMsftCalSync(true)}
          msftCalSyncing={msftCalSyncing}
          calSyncing={gcalSyncing || msftCalSyncing || appleCalSyncing}
          calSyncProgress={calSyncProgress}
          onShowCalSync={() => setShowCalSync(true)}
          onShowHelp={() => setShowHelp(true)}
          onAddTask={() => { setShowCreateForm(true); setExpandedTasks([]); }}
          isMobile={isMobile}
          aiPanel={<AiCommandPanel darkMode={darkMode} isMobile={isMobile} allTasks={allTasks} statuses={statuses} config={config} onApplyOps={handleAiOps} showToast={showToast} />}
          weekStripDates={weekStripDates} selectedDate={selectedDate}
          dayOffset={dayOffset} setDayOffset={setDayOffset} today={today}
          onManageDisabled={function() { setShowDisabledItems(true); }}
        />
        {isMobile && <WeekStrip
          weekStripDates={weekStripDates} selectedDate={selectedDate}
          dayOffset={dayOffset} setDayOffset={setDayOffset} today={today}
          darkMode={darkMode} statuses={statuses} tasksByDate={tasksByDate}
          isMobile={isMobile}
        />}
        <NavigationBar
          viewMode={viewMode} setViewMode={setViewMode}
          filter={filter} setFilter={setFilter}
          search={search} setSearch={setSearch}
          darkMode={darkMode}
          projectFilter={projectFilter} setProjectFilter={setProjectFilter}
          allProjectNames={allProjectNames}

          unplacedCount={unplacedCount} blockedCount={blockedCount} pastDueCount={pastDueCount} fixedCount={fixedCount}
          issuesCount={issuesCount}
          isMobile={isMobile}
        />
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {viewMode === 'day' && (
            <DayView
              selectedDate={selectedDate} selectedDateKey={selectedDateKey}
              placements={filteredDayPlacements[selectedDateKey] || []}
              statuses={statuses}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              onCreate={handleCreate} gridZoom={config.gridZoom}
              darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins} isToday={isToday}
              onGridDrop={handleGridDrop}
              locSchedules={config.locSchedules}
              onUpdateLocScheduleOverrides={config.updateTemplateOverrides}
              onUpdateLocScheduleDefaults={config.updateTemplateDefaults}
              allTasks={allTasks} onBatchRecurringsDone={handleBatchRecurringDone}
              locations={config.locations} onHourLocationOverride={handleHourLocationOverride}
              blockedTaskIds={blockedTaskIds}
              unplacedIds={unplacedIds} pastDueIds={pastDueIds} fixedIds={fixedIds}
              filter={filter}
              onZoomChange={handleZoomChange}
              isMobile={isMobile}
              onMarkerDrag={handleMarkerDrag}
            />
          )}
          {viewMode === '3day' && (
            <ThreeDayView
              selectedDate={selectedDate} dayPlacements={filteredDayPlacements}
              statuses={statuses}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              gridZoom={config.gridZoom} darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins}
              onGridDrop={handleGridDrop} blockedTaskIds={blockedTaskIds}
              onZoomChange={handleZoomChange}
              isMobile={isMobile}
              onMarkerDrag={handleMarkerDrag}
            />
          )}
          {viewMode === 'week' && (
            <WeekView
              selectedDate={selectedDate} dayPlacements={filteredDayPlacements}
              statuses={statuses}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              gridZoom={config.gridZoom} darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins}
              onGridDrop={handleGridDrop} blockedTaskIds={blockedTaskIds}
              onZoomChange={handleZoomChange}
              isMobile={isMobile}
              onMarkerDrag={handleMarkerDrag}
            />
          )}
          {viewMode === 'timeline' && (
            <TimelineView
              selectedDate={selectedDate} selectedDateKey={selectedDateKey}
              placements={filteredDayPlacements[selectedDateKey] || []}
              statuses={statuses}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              onCreate={handleCreate} gridZoom={config.gridZoom}
              darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins} isToday={isToday}
              onGridDrop={handleGridDrop}
              locSchedules={config.locSchedules}
              onUpdateLocScheduleOverrides={config.updateTemplateOverrides}
              allTasks={allTasks} onBatchRecurringsDone={handleBatchRecurringDone}
              locations={config.locations} onHourLocationOverride={handleHourLocationOverride}
              blockedTaskIds={blockedTaskIds}
              onZoomChange={handleZoomChange}
              isMobile={isMobile}
              onMarkerDrag={handleMarkerDrag}
            />
          )}
          {viewMode === 'scurve' && (
            <SCurveView
              selectedDate={selectedDate} selectedDateKey={selectedDateKey}
              placements={filteredDayPlacements[selectedDateKey] || []}
              statuses={statuses}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins} isToday={isToday}
              blockedTaskIds={blockedTaskIds}
              locSchedules={config.locSchedules}
              onUpdateLocScheduleOverrides={config.updateTemplateOverrides}
              allTasks={allTasks} onBatchRecurringsDone={handleBatchRecurringDone}
              isMobile={isMobile}
            />
          )}
          {viewMode === 'month' && (
            <CalendarView
              selectedDate={selectedDate} dayPlacements={filteredDayPlacements}
              statuses={statuses} tasksByDate={tasksByDate}
              onExpand={handleExpand} setDayOffset={setDayOffset} setViewMode={setViewMode} today={today} darkMode={darkMode}
              onDateDrop={handleDateDrop}
              isMobile={isMobile}
            />
          )}
          {viewMode === 'daily' && (
            <DailyView
              selectedDate={selectedDate} selectedDateKey={selectedDateKey}
              placements={filteredDayPlacements[selectedDateKey] || []}
              statuses={statuses}
              onStatusChange={handleStatusChange}
              onExpand={handleExpand}
              darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins} isToday={isToday}
              allTasks={visibleTasks}
              filter={filter}
              blockedTaskIds={blockedTaskIds}
              unplacedIds={unplacedIds}
              pastDueIds={pastDueIds} fixedIds={fixedIds}
              isMobile={isMobile}
              onUpdate={handleUpdateTask}
              showToast={showToast}
              locations={config.locations}
              onHourLocationOverride={handleHourLocationOverride}
              locSchedules={config.locSchedules}
              onUpdateLocScheduleOverrides={config.updateTemplateOverrides}
              onUpdateLocScheduleDefaults={config.updateTemplateDefaults}
              onBatchRecurringsDone={handleBatchRecurringDone}
            />
          )}
          {viewMode === 'list' && (
            <ListView
              allTasks={visibleTasks} statuses={statuses}
              filter={filter} search={search} projectFilter={projectFilter}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              onCreate={handleCreate} darkMode={darkMode} schedCfg={schedCfg}
              blockedTaskIds={blockedTaskIds} unplacedIds={unplacedIds} pastDueIds={pastDueIds} fixedIds={fixedIds}
              isMobile={isMobile} todayDate={today}
            />
          )}
          {viewMode === 'priority' && (
            <PriorityView
              allTasks={visibleTasks} statuses={statuses}
              filter={filter} search={search} projectFilter={projectFilter}
              onStatusChange={handleStatusChange} onExpand={handleExpand} darkMode={darkMode}
              onPriorityDrop={handlePriorityDrop}
              blockedTaskIds={blockedTaskIds} unplacedIds={unplacedIds} pastDueIds={pastDueIds} fixedIds={fixedIds}
              isMobile={isMobile} todayDate={today}
            />
          )}
          {viewMode === 'deps' && (
            <DependencyView
              allTasks={visibleTasks} statuses={statuses}
              projectFilter={projectFilter} filter={filter}
              search={search}
              pastDueIds={pastDueIds} fixedIds={fixedIds}
              onUpdate={handleUpdateTask} onExpand={handleExpand}
              darkMode={darkMode} isMobile={isMobile}
            />
          )}
          {viewMode === 'conflicts' && (
            <ConflictsView
              allTasks={visibleTasks} statuses={statuses}
              unplaced={unplaced} schedulerWarnings={schedulerWarnings}
              onStatusChange={handleStatusChange} onExpand={handleExpand} onUpdateTask={handleUpdateTask}
              darkMode={darkMode} isMobile={isMobile} todayDate={today}
            />
          )}
        </div>

        {/* Right sidebar — task edit / create */}
        {!isMobile && (showCreateForm || expandedTaskObjs.length > 0) && (
          <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid ' + theme.border, overflowY: 'auto', overflowX: 'hidden', background: theme.bgCard }}>
            {showCreateForm ? (
              <TaskEditForm
                mode="create"
                onCreate={handleCreate}
                onClose={() => setShowCreateForm(false)}
                initialDate={selectedDate}
                initialProject={viewMode === 'deps' ? projectFilter : undefined}
                allProjectNames={allProjectNames}
                locations={config.locations}
                tools={config.tools}
                uniqueTags={uniqueTags}
                scheduleTemplates={config.scheduleTemplates}
                templateDefaults={config.templateDefaults}
                darkMode={darkMode}
                isMobile={isMobile}
                activeTimezone={userTimezone}
              />
            ) : (
              expandedTaskObjs.map(function(taskObj, idx) {
                var taskId = taskObj.id;
                // For recurring templates opened via an instance, use the instance ID for status
                var statusId = expandedInstanceRef.current[taskId] || taskId;
                // If ref mapping was lost but this is a template, find the nearest instance
                if (statusId === taskId && taskObj.taskType === 'recurring_template') {
                  var nearestInstance = allTasks.find(function(t) { return t.sourceId === taskId && t.date === selectedDateKey; });
                  if (nearestInstance) {
                    statusId = nearestInstance.id;
                    expandedInstanceRef.current[taskId] = statusId;
                  }
                }
                // Merge instance-specific fields (date, time) onto template for display
                var instanceTask = statusId !== taskId ? allTasks.find(function(t) { return t.id === statusId; }) : null;
                var displayTask = instanceTask
                  ? Object.assign({}, taskObj, { date: instanceTask.date, time: instanceTask.time, scheduledAt: instanceTask.scheduledAt })
                  : taskObj;
                return (
                  <TaskEditForm
                    key={taskId}
                    task={displayTask}
                    status={statuses[statusId] || ''}
                    onUpdate={handleUpdateTask}
                    onStatusChange={function(val) { handleStatusChange(statusId, val); }}
                    onDelete={deleteTask}
                    onClose={function() { setExpandedTasks(function(prev) { return prev.filter(function(x) { return x !== taskId; }); }); }}
                    onShowChain={function() { setViewMode('deps'); setProjectFilter(taskObj.project || ''); setExpandedTasks([]); }}
                    allProjectNames={allProjectNames}
                    locations={config.locations}
                    tools={config.tools}
                    uniqueTags={uniqueTags}
                    scheduleTemplates={config.scheduleTemplates}
                    templateDefaults={config.templateDefaults}
                    calSyncSettings={calSyncSettings}
                    darkMode={darkMode}
                    isMobile={isMobile}
                    activeTimezone={userTimezone}
                    onRecurDayConflict={function(data) {
                      // Inject the instance ID so the confirm handler moves the instance, not the template
                      data.instanceId = statusId;
                      setRecurDayConfirm(data);
                    }}
                  />
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Mobile: task edit / create as full-screen overlay */}
      {isMobile && showCreateForm && (
        <TaskEditForm
          mode="create"
          onCreate={handleCreate}
          onClose={() => setShowCreateForm(false)}
          initialDate={selectedDate}
          initialProject={viewMode === 'deps' ? projectFilter : undefined}
          allProjectNames={allProjectNames}
          locations={config.locations}
          tools={config.tools}
          uniqueTags={uniqueTags}
          scheduleTemplates={config.scheduleTemplates}
          templateDefaults={config.templateDefaults}
          darkMode={darkMode}
          isMobile={isMobile}
        />
      )}
      {isMobile && !showCreateForm && expandedTaskObjs.map(function(taskObj, idx) {
        var taskId = taskObj.id;
        // For recurring templates opened via an instance, use the instance ID for status
        var statusId = expandedInstanceRef.current[taskId] || taskId;
        if (statusId === taskId && taskObj.taskType === 'recurring_template') {
          var nearestInst = allTasks.find(function(t) { return t.sourceId === taskId && t.date === selectedDateKey; });
          if (nearestInst) {
            statusId = nearestInst.id;
            expandedInstanceRef.current[taskId] = statusId;
          }
        }
        var instTask = statusId !== taskId ? allTasks.find(function(t) { return t.id === statusId; }) : null;
        var dispTask = instTask
          ? Object.assign({}, taskObj, { date: instTask.date, time: instTask.time, scheduledAt: instTask.scheduledAt })
          : taskObj;
        return (
          <TaskEditForm
            key={taskId}
            task={dispTask}
            status={statuses[statusId] || ''}
            onUpdate={handleUpdateTask}
            onStatusChange={function(val) { handleStatusChange(statusId, val); }}
            onDelete={deleteTask}
            onClose={function() { setExpandedTasks(function(prev) { return prev.filter(function(x) { return x !== taskId; }); }); }}
            onShowChain={function() { setViewMode('deps'); setProjectFilter(taskObj.project || ''); setExpandedTasks([]); }}
            allProjectNames={allProjectNames}
            locations={config.locations}
            tools={config.tools}
            uniqueTags={uniqueTags}
            scheduleTemplates={config.scheduleTemplates}
            templateDefaults={config.templateDefaults}
            calSyncSettings={calSyncSettings}
            darkMode={darkMode}
            isMobile={isMobile}
            onRecurDayConflict={function(data) {
              data.instanceId = statusId;
              setRecurDayConfirm(data);
            }}
          />
        );
      })}

      {/* Settings panel */}
      {showSettings && (
        <ErrorBoundary>
        <SettingsPanel onClose={() => setShowSettings(false)} darkMode={darkMode} config={config} allProjectNames={allProjectNames} allTasks={allTasks} isMobile={isMobile}
          showToast={showToast}
          onRenameProject={function(oldName, newName) { loadTasks(); }} />
        </ErrorBoundary>
      )}

      {/* Import/Export panel */}
      {showExport && (
        <ErrorBoundary>
        <ImportExportPanel onClose={() => setShowExport(false)} darkMode={darkMode} showToast={showToast}
          allTasks={allTasks} statuses={statuses} dayPlacements={dayPlacements} isMobile={isMobile}
          addTasks={addTasks} />
        </ErrorBoundary>
      )}

      {/* Unified Calendar Sync panel */}
      {(showCalSync || showGCalSync || showMsftCalSync) && (
        <ErrorBoundary>
        <CalSyncPanel
          onClose={() => { setShowCalSync(false); setShowGCalSync(false); setShowMsftCalSync(false); }}
          darkMode={darkMode}
          showToast={showToast}
          isMobile={isMobile}
          gcalAutoSync={gcalAutoSync}
          gcalLastSyncedAt={gcalLastSyncedAt}
          onGcalAutoSyncChange={function(val) {
            setGcalAutoSync(val);
          }}
          msftAutoSync={msftCalAutoSync}
          msftLastSyncedAt={msftCalLastSyncedAt}
          onMsftAutoSyncChange={function(val) {
            setMsftCalAutoSync(val);
          }}
          appleAutoSync={appleCalAutoSync}
          appleLastSyncedAt={appleCalLastSyncedAt}
          appleConnected={appleCalConnected}
          onAppleAutoSyncChange={function(val) { setAppleCalAutoSync(val); }}
          onAppleConnectedChange={function(val) { setAppleCalConnected(val); }}
          calSyncSettings={config.calSyncSettings}
          onCalSyncSettingsChange={function(val) {
            config.updateCalSyncSettings(val);
          }}
          onSyncStart={function() { setGcalSyncing(true); setMsftCalSyncing(true); setAppleCalSyncing(true); }}
          onSyncComplete={function() {
            setGcalSyncing(false); setMsftCalSyncing(false); setAppleCalSyncing(false);
            var now = new Date().toISOString();
            setGcalLastSyncedAt(now); setMsftCalLastSyncedAt(now); setAppleCalLastSyncedAt(now);
            // SSE events from the sync deliver task updates surgically —
            // no full reload needed.
          }}
        />
        </ErrorBoundary>
      )}

      {/* Help modal */}
      {showHelp && (
        <HelpModal onClose={() => setShowHelp(false)} darkMode={darkMode} isMobile={isMobile} />
      )}

      {/* Disabled items panel */}
      {showDisabledItems && (
        <DisabledItemsPanel
          theme={theme}
          onClose={function() { setShowDisabledItems(false); }}
          onRefreshTasks={loadTasks}
        />
      )}

      {/* Completion time picker */}
      {completionPickerTask && (
        <CompletionTimePicker
          task={completionPickerTask}
          onConfirm={handleCompletionConfirm}
          onCancel={function() { setCompletionPickerTask(null); }}
          darkMode={darkMode}
          isMobile={isMobile}
        />
      )}

      <AppFooter darkMode={darkMode} />

      <ToastNotification
        toast={toast} toastHistory={toastHistory}
        showHistory={showToastHistory}
        onToggleHistory={() => setShowToastHistory(v => !v)}
      />

      {/* Recurrence day conflict confirmation dialog */}
      {recurDayConfirm && (function() {
        var c = recurDayConfirm;
        var taskName = (c.task.text || c.taskId).slice(0, 40);
        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }} onClick={function() { setRecurDayConfirm(null); }}>
            <div style={{
              background: theme.bgCard, border: '1px solid ' + theme.border,
              borderRadius: 12, padding: 24, maxWidth: 380, width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)', color: theme.text
            }} onClick={function(e) { e.stopPropagation(); }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>
                Move to {c.conflict.dayLabel}?
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 20, color: theme.textSecondary }}>
                <strong>{taskName}</strong> is set to recur on{' '}
                {c.conflict.recurDays.split('').map(function(code) {
                  var labels = { U: 'Sun', M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat' };
                  return labels[code] || code;
                }).join(', ')}
                {' '}only. Add <strong>{c.conflict.dayLabel}</strong> as a recurring day?
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={function() { setRecurDayConfirm(null); }}
                  style={{
                    padding: '8px 16px', borderRadius: 6, border: '1px solid ' + theme.border,
                    background: 'transparent', color: theme.text, cursor: 'pointer', fontSize: 13
                  }}>Cancel</button>
                <button onClick={function() {
                  pushUndo('move recurring');
                  // Resolve the correct IDs: prefer explicit instanceId (from detail view),
                  // then expandedInstanceRef, then fall back to taskId
                  var instanceId = c.instanceId || expandedInstanceRef.current[c.taskId] || c.taskId;
                  var templateId = c.task.sourceId || c.taskId;
                  console.log('[RECUR-CONFIRM]', { instanceId, templateId, taskId: c.taskId, cInstanceId: c.instanceId, fields: c.fields });
                  // If instanceId still points to a template (no instance mapping),
                  // use taskId as-is — the backend will update the template's date
                  if (instanceId === templateId) {
                    // Editing the template directly — just update it with all fields
                    var combined = Object.assign({}, c.fields, {
                      recur: Object.assign({}, c.conflict.recur, { days: c.conflict.recurDays + c.conflict.dayCode })
                    });
                    updateTask(templateId, combined);
                  } else {
                    // Move the instance
                    updateTask(instanceId, c.fields);
                    // Add the new day to the template's recurrence
                    var newDays = c.conflict.recurDays + c.conflict.dayCode;
                    updateTask(templateId, { recur: Object.assign({}, c.conflict.recur, { days: newDays }) });
                  }
                  showToast('Moved and added ' + c.conflict.dayLabel + ' to schedule', 'success');
                  setRecurDayConfirm(null);
                }}
                  style={{
                    padding: '8px 16px', borderRadius: 6, border: 'none',
                    background: theme.accent || '#3B82F6', color: '#fff', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600
                  }}>Yes, add {c.conflict.dayLabel}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
    </div>
  );
}
