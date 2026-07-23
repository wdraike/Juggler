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
import TaskBoardSkeleton from './TaskBoardSkeleton';
import useTaskState from '../../hooks/useTaskState';
import useConfig from '../../hooks/useConfig';
import useUndo from '../../hooks/useUndo';
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts';
import useDragDrop from '../../hooks/useDragDrop';
import useIsMobile from '../../hooks/useIsMobile';
import useIsCompact from '../../hooks/useIsCompact';
import { getTheme } from '../../theme/colors';
import { formatDateKey, getWeekStart, parseDate } from '../../scheduler/dateHelpers';
import { evaluateFutureCompletionGuard } from '../../utils/futureCompletionGuard';
import { DAY_NAMES, applyDefaults } from '../../state/constants';
import { useAuth } from '../auth/AuthProvider';
import { useTimezone } from '../../hooks/useTimezone';
import { getNowInTimezone, buildServerClock, formatMinsAmPm } from '../../utils/timezone';
import useDocumentTitle from '../../hooks/useDocumentTitle';

// Views
import DayView from '../views/DayView';
import ThreeDayView from '../views/ThreeDayView';
import WeekView from '../views/WeekView';
import ListView from '../views/ListView';
import PriorityView from '../views/PriorityView';
import ConflictsView from '../views/ConflictsView';
import DependencyView from '../views/DependencyView';
import TimelineView from '../views/TimelineView';
import CalendarView from '../views/CalendarView';
import DailyView from '../views/DailyView';

// Task components
import TaskEditForm from '../tasks/TaskEditForm';

// Advanced features
import SettingsPanel from '../settings/SettingsPanel';
import ImportExportPanel from '../features/ImportExportPanel';
import CompletionTimePicker from '../features/CompletionTimePicker';

import CalSyncPanel from '../features/CalSyncPanel';
import HelpModal from '../features/HelpModal';
import DisabledItemsPanel from '../billing/DisabledItemsPanel';
import ConfirmDialog from '../features/ConfirmDialog';
import RecurringDeleteDialog from '../features/RecurringDeleteDialog';
import AiCommandPanel from '../features/AiCommandPanel';
import AppFooter from './AppFooter';
import apiClient from '../../services/apiClient';
import ImpersonationBanner from '../admin/ImpersonationBanner';
import useWeather from '../../hooks/useWeather';
import useCalSyncState from '../../hooks/useCalSyncState';
import useDerivedTaskData from '../../hooks/useDerivedTaskData';

// 999.103: browser tab titles in the shared Raike & Sons format ("View — StriveRS").
// Maps the viewMode id (NavigationBar VIEWS) → the human label used in the tab.
var VIEW_TITLES = {
  daily: 'Day', day: 'Flex', '3day': '3-Day', week: 'Week', month: 'Month',
  timeline: 'Timeline', list: 'List', priority: 'Priority', deps: 'Dependencies',
  conflicts: 'Issues'
};

export default function AppLayout() {
  // Auth & timezone
  var { user: authUser } = useAuth();
  // 999.1225 — config persistence failures surface as an error toast.
  // `showToast` is destructured further down (var — hoisted), and useConfig
  // re-arms its internal ref with this closure every render, so by the time a
  // save rejection actually invokes it, showToast is assigned.
  var config = useConfig(function(msg) { if (typeof showToast === 'function') showToast(msg, 'error'); });
  var { activeTimezone, source: tzSource, browserTimezone } = useTimezone(config);
  var userTimezone = activeTimezone;

  // AC3 (999.809): server-time clock — fetched once at app load so overdue computation
  // uses canonical server time, not the client clock, eliminating clock-skew false-positives.
  // offset = serverEpochMs - Date.now() at fetch time; serverClock.now() applies that offset.
  // On fetch failure: offset=0 (degraded mode, AC3 approved fallback — clock-skew correction
  // simply unavailable; real client clock used instead; never a wrong value for a present one).
  var [serverClock, setServerClock] = useState(null);
  useEffect(function() {
    apiClient.get('/now').then(function(res) {
      var serverEpochMs = res.data && res.data.epochMs;
      if (typeof serverEpochMs !== 'number') {
        console.warn('[server-clock] /api/now returned unexpected shape; using client clock (degraded mode, AC3)');
        setServerClock(buildServerClock(serverEpochMs));
        return;
      }
      setServerClock(buildServerClock(serverEpochMs));
    }).catch(function(err) {
      // AC3 approved fallback: log and fall back to real client clock (offset=0).
      // Clock-skew correction is unavailable; overdue display may be off by client drift.
      console.warn('[server-clock] Failed to fetch /api/now; using client clock (degraded mode, AC3)', err);
      setServerClock(buildServerClock(null));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // State
  // 999.1594 — load/autosave failures surface as an error toast, mirroring the
  // 999.1225 useConfig wiring above (same hoisted-showToast-closure reasoning).
  var { taskState, dispatch, dispatchPersist, loading, saving, loadTasks, placements, loadPlacements, setStatus, updateTask, addTasks, retryAddTasks, deleteTask, createTask, taskStateRef, setPlacements, flushNow } = useTaskState(function(msg) { if (typeof showToast === 'function') showToast(msg, 'error'); });
  var isMobile = useIsMobile();
  var isCompact = useIsCompact();
  var { weatherByDate, refreshed: weatherRefreshed } = useWeather(config.locations, config.tempUnitPref);
  var [headerCompact, setHeaderCompact] = useState(isCompact);
  var { toast, toastHistory, showToast } = useToast();

  // Calendar sync state + effects extracted to useCalSyncState hook (999.965).
  // editingRef is defined below (expandedTasks length > 0 etc.) but the hook
  // reads it via a ref that we set before any effect fires — refs are set
  // during render (synchronously) so the hook's mount effects see the right
  // value even though editingRef.current is assigned further down.
  var editingRef = useRef(false);

  var calSync = useCalSyncState(showToast, loadPlacements, config, editingRef);
  var {
    kickScheduleRun, setSchedulerReady, schedulerRunning,
    gcalAutoSync, setGcalAutoSync, gcalLastSyncedAt, setGcalLastSyncedAt,
    gcalSyncing, setGcalSyncing,
    msftCalAutoSync, setMsftCalAutoSync, msftCalLastSyncedAt, setMsftCalLastSyncedAt,
    msftCalSyncing, setMsftCalSyncing,
    appleCalAutoSync, setAppleCalAutoSync, appleCalLastSyncedAt, setAppleCalLastSyncedAt,
    appleCalSyncing, setAppleCalSyncing,
    appleCalConnected, setAppleCalConnected,
    calSyncProgress,
    setWeatherRefreshedAndKick,
  } = calSync;

  var { pushUndo, popUndo, canUndo } = useUndo(taskStateRef, dispatch, dispatchPersist);
  // Single-step undo affordance — pops the most recent action off the undo
  // stack (same path as Ctrl/Cmd+Z) and toasts the result. 999.1227: the
  // HeaderBar button is disabled via canUndo() evaluated per render (every
  // pushUndo call site also dispatches state, so a render always follows);
  // the empty-case toast below stays as the Ctrl/Cmd+Z path's feedback.
  var handleUndo = useCallback(function() {
    var label = popUndo();
    if (label) showToast('Undid: ' + label, 'success');
    else showToast('Nothing to undo', 'info');
  }, [popUndo, showToast]);

  // ── Persisted UI state ──
  var _savedUI = useMemo(function () {
    try { return JSON.parse(localStorage.getItem('juggler-ui-state')) || {}; }
    catch (e) { return {}; }
  }, []);

  var [darkMode, setDarkMode] = useState(function() {
    var saved = localStorage.getItem('juggler-darkMode');
    return saved !== null ? saved === 'true' : true;
  });
  // 999.1243: keep mobile browser chrome / PWA title bar in sync with the active
  // theme (brand guide "Theme Color Meta": light = Brand Navy, dark = Deep Navy).
  useEffect(function() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', darkMode ? '#0F1520' : '#1A2B4A');
  }, [darkMode]);
  var [viewMode, setViewModeRaw] = useState(_savedUI.viewMode || 'daily');
  // 999.103: keep the browser tab title in sync with the active view.
  useDocumentTitle(VIEW_TITLES[viewMode] || 'StriveRS');
  var [filter, setFilter] = useState(_savedUI.filter || 'open');
  var [dateFilter, setDateFilter] = useState(_savedUI.dateFilter || 'all');
  var [search, setSearch] = useState(_savedUI.search || '');
  var [projectFilter, setProjectFilter] = useState(_savedUI.projectFilter || '');
  var setViewMode = useCallback(function(v) {
    setViewModeRaw(function(prev) {
      if (prev === 'deps' && v !== 'deps') setProjectFilter('');
      return v;
    });
    setFilter('open');
    setDateFilter('all');
    setSearch('');
    setProjectFilter('');
  }, []);
  var [dayOffset, setDayOffset] = useState(function () {
    // Restore saved date as offset from today. The saved format is the
    // canonical date key (ISO "YYYY-MM-DD"). Legacy M/D values ("4/21")
    // are tolerated — we normalize before parsing so stale localStorage
    // doesn't produce Invalid Date (which cascades to "nothing scheduled").
    if (_savedUI.selectedDate) {
      var raw = String(_savedUI.selectedDate);
      var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      var md = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
      var saved = null;
      if (iso) {
        saved = new Date(raw + 'T12:00:00');
      } else if (md) {
        // Legacy M/D — infer current year, same as shared inferYear logic.
        var now = new Date();
        saved = new Date(now.getFullYear(), Number(md[1]) - 1, Number(md[2]), 12, 0, 0);
      }
      if (saved && !isNaN(saved.getTime())) {
        var today = new Date(); today.setHours(12, 0, 0, 0);
        var diff = Math.round((saved - today) / 86400000);
        if (Math.abs(diff) <= 90) return diff;
      }
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
  var [deleteConfirmTask, setDeleteConfirmTask] = useState(null);
  // bert bird-w6-002 BLOCK fix: holds the cal_locked CAL_LOCKED_DELETE_BLOCKED 403
  // message when a series-delete is rejected, keeping RecurringDeleteDialog open with
  // an explanation instead of the dialog silently closing like every other outcome.
  var [recurringDeleteBlockedMessage, setRecurringDeleteBlockedMessage] = useState(null);
  // 999.1240: escape hatch for the provider-origin delete wall. When a delete is
  // rejected with PROVIDER_ORIGIN_DELETE_BLOCKED (403), offer the backend's
  // POST /api/tasks/:id/take-ownership — detaches the task from its calendar
  // link so Juggler owns the schedule (and it becomes deletable). Shape:
  // { taskId, taskText, message }.
  var [takeOwnershipPrompt, setTakeOwnershipPrompt] = useState(null);

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
      // Background: run scheduler for fresh result (doesn't block initial render).
      // 999.1242: routed through the single-flight kick — placement refresh,
      // 409 retry, and failure surfacing live in kickScheduleRun (it never
      // rejects). schedulerReady flips regardless so the UI never hangs.
      kickScheduleRun().then(function() {
        setSchedulerReady(true);
      });
    });
  }, []);

  // Show contextual toast when a calendar-synced task rejects edits
  useEffect(() => {
    var handleReadonly = function(e) {
      showToast(e.detail?.error || 'This task is controlled by the source calendar.', 'warning');
    };
    window.addEventListener('task:calendar-sync-readonly', handleReadonly);
    return function() {
      window.removeEventListener('task:calendar-sync-readonly', handleReadonly);
    };
  }, [showToast]);

  // Weather-refresh → kick schedule run (extracted to useCalSyncState hook).
  // The hook owns the weatherRefreshedRef + kick; this effect bridges the
  // parent's `weatherRefreshed` prop to the hook's setWeatherRefreshedAndKick.
  useEffect(function() {
    setWeatherRefreshedAndKick(weatherRefreshed);
  }, [weatherRefreshed, setWeatherRefreshedAndKick]);

  // Derived dates
  var today = useMemo(() => {
    return getNowInTimezone(userTimezone, serverClock).todayDate;
  }, [userTimezone, serverClock]);

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
        dateFilter: dateFilter,
        search: search,
        projectFilter: projectFilter,
        selectedDate: selectedDateKey
      }));
    } catch (e) { /* quota exceeded — ignore */ }
  }, [viewMode, filter, dateFilter, search, projectFilter, selectedDateKey]);

  var weekStripDates = useMemo(() => {
    var start = getWeekStart(selectedDate);
    return Array.from({ length: 7 }, (_, i) => {
      var d = new Date(start); d.setDate(d.getDate() + i); return d;
    });
  }, [selectedDate]);

  // Derived task data extracted to useDerivedTaskData hook (999.965).
  var _derived = useDerivedTaskData(allTasks, statuses, placements, userTimezone, serverClock, today, projectFilter, search);
  var {
    dayPlacements, unplaced, backlogTasks, schedulerWarnings,
    filteredDayPlacements, blockedTaskIds, pastDueIds, fixedIds,
    unplacedIds, issuesCount, tasksByDate,
    unplacedCount, blockedCount, pastDueCount, fixedCount,
  } = _derived;

  // Schedule config bundle (kept inline — tightly coupled to config prop)
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
    scheduleTemplates: config.scheduleTemplates,
    // 999.2161 — mirror the backend's assembleSchedulerCfg: pass the OTHER
    // two canonical-trio members (999.2146) alongside scheduleTemplates, so
    // CalendarGrid/HorizontalTimeline's getBlocksForDate call (same shared
    // helper the backend scheduler now consults) resolves blocks with the
    // identical precedence the backend uses, instead of only ever seeing
    // the legacy-key-derived preview.
    templateDefaults: config.templateDefaults,
    templateOverrides: config.templateOverrides,
    temperatureUnit: config.tempUnitPref || 'F'
  }), [config.timeBlocks, config.locSchedules, config.locScheduleDefaults, config.locScheduleOverrides, config.hourLocationOverrides, config.toolMatrix, config.splitDefault, config.splitMinDefault, config.schedFloor, config.schedCeiling, config.scheduleTemplates, config.templateDefaults, config.templateOverrides, config.tempUnitPref]);

  // Now minutes (ET) — update every minute
  var [nowMins, setNowMins] = useState(() => {
    return getNowInTimezone(userTimezone, serverClock).nowMins;
  });

  useEffect(() => {
    var id = setInterval(() => {
      setNowMins(getNowInTimezone(userTimezone, serverClock).nowMins);
    }, 60000);
    return () => clearInterval(id);
  }, [userTimezone, serverClock]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Block marking future recurring instances as done.
      // Today is always allowed — it's normal to complete a recurring task
      // a bit early on the same calendar day. FR-3/AC4: rolling masters may
      // also complete a future-dated instance early (e.g. wash the car ahead
      // of schedule) — see evaluateFutureCompletionGuard for the full rule.
      var guardResult = evaluateFutureCompletionGuard(task, todayRef.current);
      if (guardResult.blocked) {
        showToast(guardResult.warning, 'warning');
        return;
      }
      setCompletionPickerTask(task || { id: id });
      return;
    }
    pushUndo('status change');
    setStatus(id, val, {
      taskFields: { status: val },
      // 999.1225 — a rejected status save now rolls back in useTaskState;
      // surface it so the revert isn't silent.
      onError: function(msg) { showToast(msg, 'error'); }
    });
    var labels = { done: 'Done', wip: 'WIP', cancel: 'Cancelled', skip: 'Skipped', '': 'Reopened' };
    showToast((labels[val] || val) + ': ' + (tasks.find(t => t.id === id)?.text || id).slice(0, 40), 'success');
  }, [pushUndo, setStatus, showToast]);

  var requestDelete = useCallback(function(id) {
    var tasks = allTasksRef.current;
    var task = tasks.find(function(t) { return t.id === id; });
    if (!task) return;
    setRecurringDeleteBlockedMessage(null);
    setDeleteConfirmTask(task);
  }, []);

  var handleCompletionConfirm = useCallback(function(completedAt) {
    var task = completionPickerTask;
    if (!task) return;
    setCompletionPickerTask(null);
    pushUndo('status change');
    setStatus(task.id, 'done', {
      taskFields: { status: 'done' },
      completedAt: completedAt,
      onError: function(msg) { showToast(msg, 'error'); } // 999.1225
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

  // 999.1109: Issues tab click → switch to Day view at the task's date, then expand.
  var handleIssuesExpand = useCallback(function(id) {
    var tasks = allTasksRef.current;
    var task = tasks.find(function(t) { return t.id === id; });
    if (task && task.date && task.date !== 'TBD') {
      var td = parseDate(task.date);
      if (td && !isNaN(td.getTime())) {
        var t0 = new Date(); t0.setHours(12, 0, 0, 0);
        var diff = Math.round((td - t0) / 86400000);
        setDayOffset(diff);
      }
    }
    setViewMode('daily');
    handleExpand(id);
  }, [handleExpand, setViewMode, setDayOffset]);

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
    createTask(task, {
      onError: function(msg) { showToast(msg, 'error'); } // 999.1544
    });
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
        setStatus(t.id, 'done', {
          taskFields: { status: 'done' },
          onError: function(msg) { showToast(msg, 'error'); } // 999.1225
        });
        count++;
      }
    });
    showToast(count + ' recurring tasks marked done', 'success');
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
    setDayOffset, setShowHelp,
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
    var newTime = formatMinsAmPm(totalMins);
    pushUndo('drag time');

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

    // sched-audit L3 ernie INFO (l3-ernie-5) — same F3 class of defect: must
    // check the result before toasting. updateTask resolves `true` on success
    // but a truthy SERVER-MESSAGE STRING (or `false`) on rejection (e.g.
    // calLocked 403), so only `=== true` counts as success.
    Promise.resolve(updateTask(taskId, { time: newTime })).then(function (result) {
      if (result === true) {
        showToast('Moved to ' + newTime, 'success');
      } else {
        showToast(typeof result === 'string' ? result : 'Could not move task', 'error');
      }
    }).catch(function () {
      showToast('Could not move task', 'error');
    });
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
        if (srcTask && (srcTask.placementMode === 'fixed' || srcTask.placement_mode === 'fixed')) {
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
      var addedIds = addedTasks.map(function(t) { return t.id; });
      // 999.1631 — a bulk (N>1) failure is preserved, not rolled back
      // (999.1571), so give the aggregate error toast a real Retry action
      // that re-POSTs exactly the failed subset via retryAddTasks. N=1 stays
      // on the pre-existing rollback path (no _addFailed phantom exists to
      // retry), matching AppLayout.aiOpsRollback.test.jsx's ratified contract.
      // onBulkAddError re-attaches the Retry action on a re-failure too, so a
      // flaky retry doesn't strand the user without a way to try again.
      var onBulkAddError = function(msg) {
        var retryAction = addedTasks.length > 1 ? {
          label: 'Retry',
          onClick: function() {
            retryAddTasks(addedIds, { onError: onBulkAddError });
          }
        } : undefined;
        showToast(msg, 'error', retryAction); // 999.1544 / 999.1631
      };
      addTasks(addedTasks, { onError: onBulkAddError });
    }

    showToast(msg || 'AI: ' + ops.length + ' changes applied', 'success');
  }, [allTasks, statuses, config, pushUndo, dispatchPersist, showToast, addTasks, retryAddTasks]);

  if (loading) {
    // 999.2119: layout-matching skeleton per brand Loading & Busy-State
    // Standard — full-page spinner gate deprecated for content regions.
    return <TaskBoardSkeleton theme={theme} isMobile={isMobile} />;
  }

  var isToday = selectedDateKey === getNowInTimezone(userTimezone, serverClock).todayKey;
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
      <ImpersonationBanner darkMode={darkMode} />
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
          schedulerRunning={schedulerRunning}
          onShowCalSync={() => setShowCalSync(true)}
          onShowHelp={() => setShowHelp(true)}
          onAddTask={() => { setShowCreateForm(true); setExpandedTasks([]); }}
          onUndo={handleUndo}
          canUndo={canUndo()}
          isMobile={isMobile}
          isCompact={isCompact}
          onCompactChange={setHeaderCompact}
          aiPanel={<AiCommandPanel darkMode={darkMode} isMobile={isMobile} allTasks={allTasks} statuses={statuses} config={config} onApplyOps={handleAiOps} showToast={showToast} />}
          weekStripDates={weekStripDates} selectedDate={selectedDate}
          dayOffset={dayOffset} setDayOffset={setDayOffset} today={today}
          onManageDisabled={function() { setShowDisabledItems(true); }}
        />
        {(isMobile || headerCompact) && <WeekStrip
          weekStripDates={weekStripDates} selectedDate={selectedDate}
          dayOffset={dayOffset} setDayOffset={setDayOffset} today={today}
          darkMode={darkMode} statuses={statuses} tasksByDate={tasksByDate}
          isMobile={isMobile}
        />}
        <NavigationBar
          viewMode={viewMode} setViewMode={setViewMode}
          filter={filter} setFilter={setFilter}
          dateFilter={dateFilter} setDateFilter={setDateFilter}
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
              onStatusChange={handleStatusChange} onDelete={requestDelete} onExpand={handleExpand}
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
              weatherByDate={weatherByDate}
            />
          )}
          {viewMode === '3day' && (
            <ThreeDayView
              selectedDate={selectedDate} dayPlacements={filteredDayPlacements}
              allTasks={allTasks}
              statuses={statuses}
              onStatusChange={handleStatusChange} onDelete={requestDelete} onExpand={handleExpand}
              gridZoom={config.gridZoom} darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins}
              onGridDrop={handleGridDrop} blockedTaskIds={blockedTaskIds}
              onZoomChange={handleZoomChange}
              isMobile={isMobile}
              onMarkerDrag={handleMarkerDrag}
              weatherByDate={weatherByDate}
            />
          )}
          {viewMode === 'week' && (
            <WeekView
              selectedDate={selectedDate} dayPlacements={filteredDayPlacements}
              allTasks={allTasks}
              statuses={statuses}
              onStatusChange={handleStatusChange} onDelete={requestDelete} onExpand={handleExpand}
              gridZoom={config.gridZoom} darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins}
              onGridDrop={handleGridDrop} blockedTaskIds={blockedTaskIds}
              onZoomChange={handleZoomChange}
              isMobile={isMobile}
              onMarkerDrag={handleMarkerDrag}
              weatherByDate={weatherByDate}
            />
          )}
          {viewMode === 'timeline' && (
            <TimelineView
              selectedDate={selectedDate} selectedDateKey={selectedDateKey}
              placements={filteredDayPlacements[selectedDateKey] || []}
              statuses={statuses}
              onStatusChange={handleStatusChange} onDelete={requestDelete} onExpand={handleExpand}
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
              weatherByDate={weatherByDate}
            />
          )}
          {viewMode === 'month' && (
            <CalendarView
              selectedDate={selectedDate} dayPlacements={filteredDayPlacements}
              statuses={statuses} tasksByDate={tasksByDate}
              onExpand={handleExpand} setDayOffset={setDayOffset} setViewMode={setViewMode} today={today} darkMode={darkMode}
              onDateDrop={handleDateDrop}
              isMobile={isMobile}
              weatherByDate={weatherByDate}
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
              unplaced={unplaced}
              filter={filter}
              blockedTaskIds={blockedTaskIds}
              unplacedIds={unplacedIds}
              pastDueIds={pastDueIds} fixedIds={fixedIds}
              isMobile={isMobile}
              onUpdate={handleUpdateTask}
              onDelete={requestDelete}
              showToast={showToast}
              locations={config.locations}
              onHourLocationOverride={handleHourLocationOverride}
              locSchedules={config.locSchedules}
              onUpdateLocScheduleOverrides={config.updateTemplateOverrides}
              onUpdateLocScheduleDefaults={config.updateTemplateDefaults}
              onBatchRecurringsDone={handleBatchRecurringDone}
              weatherByDate={weatherByDate}
            />
          )}
          {viewMode === 'list' && (
            <ListView
              allTasks={visibleTasks} statuses={statuses}
              filter={filter} dateFilter={dateFilter} search={search} projectFilter={projectFilter}
              onStatusChange={handleStatusChange} onDelete={requestDelete} onExpand={handleExpand}
              onCreate={handleCreate} darkMode={darkMode} schedCfg={schedCfg}
              blockedTaskIds={blockedTaskIds} unplacedIds={unplacedIds} pastDueIds={pastDueIds} fixedIds={fixedIds}
              isMobile={isMobile} todayDate={today}
              weatherByDate={weatherByDate}
            />
          )}
          {viewMode === 'priority' && (
            <PriorityView
              allTasks={visibleTasks} statuses={statuses}
              filter={filter} search={search} projectFilter={projectFilter}
              dateFilter={dateFilter}
              onStatusChange={handleStatusChange} onDelete={requestDelete} onExpand={handleExpand} darkMode={darkMode}
              onPriorityDrop={handlePriorityDrop}
              blockedTaskIds={blockedTaskIds} unplacedIds={unplacedIds} pastDueIds={pastDueIds} fixedIds={fixedIds}
              isMobile={isMobile} todayDate={today}
              weatherByDate={weatherByDate}
            />
          )}
          {viewMode === 'deps' && (
            <DependencyView
              allTasks={visibleTasks} statuses={statuses}
              projectFilter={projectFilter} filter={filter}
              dateFilter={dateFilter}
              search={search}
              pastDueIds={pastDueIds} fixedIds={fixedIds}
              onUpdate={handleUpdateTask} onExpand={handleExpand}
              darkMode={darkMode} isMobile={isMobile}
            />
          )}
          {viewMode === 'conflicts' && (
            <ConflictsView
              allTasks={visibleTasks} statuses={statuses}
              unplaced={unplaced} backlog={backlogTasks} schedulerWarnings={schedulerWarnings}
              onStatusChange={handleStatusChange} onExpand={handleIssuesExpand} onUpdateTask={handleUpdateTask}
              onDelete={requestDelete}
              darkMode={darkMode} isMobile={isMobile} todayDate={today}
              weatherByDate={weatherByDate}
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
                tempUnitPref={config.tempUnitPref || 'F'}
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
                    onDelete={requestDelete}
                    onClose={function() { setExpandedTasks(function(prev) { return prev.filter(function(x) { return x !== taskId; }); }); }}
                    onShowChain={function() { setViewMode('deps'); setProjectFilter(taskObj.project || ''); setExpandedTasks([]); }}
                    allProjectNames={allProjectNames}
                    allTasks={allTasks}
                    locations={config.locations}
                    tools={config.tools}
                    uniqueTags={uniqueTags}
                    scheduleTemplates={config.scheduleTemplates}
                    templateDefaults={config.templateDefaults}
                tempUnitPref={config.tempUnitPref || 'F'}
                    calSyncSettings={config.calSyncSettings}
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
            onDelete={requestDelete}
            onClose={function() { setExpandedTasks(function(prev) { return prev.filter(function(x) { return x !== taskId; }); }); }}
            onShowChain={function() { setViewMode('deps'); setProjectFilter(taskObj.project || ''); setExpandedTasks([]); }}
            allProjectNames={allProjectNames}
            allTasks={allTasks}
            locations={config.locations}
            tools={config.tools}
            uniqueTags={uniqueTags}
            scheduleTemplates={config.scheduleTemplates}
            templateDefaults={config.templateDefaults}
            calSyncSettings={config.calSyncSettings}
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
          showToast={showToast}
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

      {/* Unified delete confirmation */}
      {deleteConfirmTask && (
        (deleteConfirmTask.recurring || deleteConfirmTask.taskType === 'recurring_instance' || deleteConfirmTask.taskType === 'recurring_template') ? (
          <RecurringDeleteDialog
            taskName={deleteConfirmTask.text || 'this task'}
            onSkipInstance={function() {
              handleStatusChange(deleteConfirmTask.id, 'skip');
              setDeleteConfirmTask(null);
            }}
            onDeleteSeries={function() {
              var id = deleteConfirmTask.id;
              // bert bird-w6-002 BLOCK fix: await the real DELETE call so a
              // CAL_LOCKED_DELETE_BLOCKED 403 (FR-6/AC7, series-delete only) can keep
              // this dialog open with an explanation instead of closing unconditionally.
              deleteTask(id, { cascade: 'recurring' }).then(function() {
                setExpandedTasks(function(prev) { return prev.filter(function(x) { return x !== id; }); });
                setDeleteConfirmTask(null);
              }).catch(function(error) {
                var code = error && error.response && error.response.data && error.response.data.code;
                if (code === 'CAL_LOCKED_DELETE_BLOCKED') {
                  setRecurringDeleteBlockedMessage(
                    (error.response.data && error.response.data.error) ||
                    'This series has a calendar-linked instance. Remove the calendar link before deleting the whole series.'
                  );
                } else {
                  // 999.1225 — surface the server's rejection (e.g. the 403
                  // INGEST_DELETE_BLOCKED / PROVIDER_ORIGIN_DELETE_BLOCKED
                  // bodies) instead of closing silently; the task stays in
                  // place (deleteTask defers all local removal until success).
                  var serverMsg = error && error.response && error.response.data && error.response.data.error;
                  showToast(serverMsg || 'Failed to delete series', 'error');
                  setExpandedTasks(function(prev) { return prev.filter(function(x) { return x !== id; }); });
                  setDeleteConfirmTask(null);
                }
              });
            }}
            onCancel={function() { setDeleteConfirmTask(null); setRecurringDeleteBlockedMessage(null); }}
            blocked={!!recurringDeleteBlockedMessage}
            blockedMessage={recurringDeleteBlockedMessage}
            darkMode={darkMode}
            isMobile={isMobile}
          />
        ) : (
          <ConfirmDialog
            message={'Delete "' + (deleteConfirmTask.text || 'this task').slice(0, 60) + '"?'}
            onConfirm={function() {
              var id = deleteConfirmTask.id;
              var taskText = deleteConfirmTask.text || 'this task';
              // 999.1227 delete-undo: the server delete is a SOFT-cancel (R55 —
              // row kept, status='cancelled'), so it is recoverable. Snapshot
              // BEFORE the delete (same push-before-action pattern as status
              // changes) with a server-side revert that un-cancels through the
              // EXPLICIT reactivation path (PUT /tasks/:id/status — the terminal
              // guard + reopen date gate stand unweakened, 2026-07-06 ruling 7).
              // Absence from the statuses map means "open", whose canonical wire
              // value is '' (taskStatusRouteSchema) — not a fallback.
              var prevStatus = taskStateRef.current.statuses[id];
              if (prevStatus === undefined) prevStatus = '';
              pushUndo('delete task', function() {
                setStatus(id, prevStatus, {
                  onError: function(msg) {
                    showToast(msg || 'Undo failed — the task is still deleted on the server', 'error');
                  }
                });
              });
              // deleteTask rethrows on failure (bird-w6-002 fix). 999.1225:
              // surface the server's rejection body (e.g. the deliberate 403
              // INGEST_DELETE_BLOCKED "Calendar-linked tasks cannot be deleted
              // in ingest-only mode..." / PROVIDER_ORIGIN_DELETE_BLOCKED)
              // instead of swallowing it — the task never leaves local state
              // on a failed delete, so the user needs to know why.
              deleteTask(id).then(function() {
                // 999.1227: undoable delete — toast Undo pops the same stack as
                // Ctrl/Cmd+Z (mobile parity: no keyboard needed).
                showToast('Task deleted — Undo', 'success', { label: 'Undo', onClick: handleUndo });
              }).catch(function(error) {
                var data = error && error.response && error.response.data;
                var serverMsg = data && data.error;
                // 999.1240: the provider-origin wall gets an escape hatch —
                // offer the take-ownership endpoint instead of a dead-end toast.
                if (data && data.code === 'PROVIDER_ORIGIN_DELETE_BLOCKED') {
                  setTakeOwnershipPrompt({ taskId: id, taskText: taskText, message: serverMsg });
                  return;
                }
                showToast(serverMsg || 'Failed to delete task', 'error');
              });
              setExpandedTasks(function(prev) { return prev.filter(function(x) { return x !== id; }); });
              setDeleteConfirmTask(null);
            }}
            onCancel={function() { setDeleteConfirmTask(null); }}
            darkMode={darkMode}
            isMobile={isMobile}
          />
        )
      )}

      {/* 999.1240: provider-origin delete wall escape hatch. The delete was
          rejected (PROVIDER_ORIGIN_DELETE_BLOCKED) because the task came from a
          calendar provider; offer POST /tasks/:id/take-ownership, which detaches
          the calendar link so Juggler owns the schedule from here on. */}
      {takeOwnershipPrompt && (
        <ConfirmDialog
          title="This task belongs to your calendar"
          message={(takeOwnershipPrompt.message || 'This task came from a connected calendar, so it can’t be deleted here.') +
            ' You can instead have Juggler take ownership of "' + takeOwnershipPrompt.taskText.slice(0, 60) +
            '" — it will be detached from the calendar event and Juggler will manage (and can delete) it from then on.'}
          confirmLabel="Take ownership"
          onConfirm={function() {
            var id = takeOwnershipPrompt.taskId;
            setTakeOwnershipPrompt(null);
            apiClient.post('/tasks/' + id + '/take-ownership').then(function() {
              showToast('Juggler now owns this task — it’s detached from your calendar.', 'success');
              loadTasks();
            }).catch(function(error) {
              // apiClient's interceptor (999.1226) has already normalized
              // error.message to human copy (server body wins when present).
              showToast(error && error.message ? error.message : 'Could not take ownership of this task.', 'error');
            });
          }}
          onCancel={function() { setTakeOwnershipPrompt(null); }}
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
