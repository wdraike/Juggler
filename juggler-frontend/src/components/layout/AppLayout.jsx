/**
 * AppLayout — main layout: header + navigation + content + toast
 * Orchestrates all state and views
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { DAY_NAMES } from '../../state/constants';
import { generateRecurringPure } from '../../scheduler/generateRecurring';

// Views
import DayView from '../views/DayView';
import ThreeDayView from '../views/ThreeDayView';
import WeekView from '../views/WeekView';
import MonthView from '../views/MonthView';
import ListView from '../views/ListView';
import PriorityView from '../views/PriorityView';
import ConflictsView from '../views/ConflictsView';
import TimelineView from '../views/TimelineView';
import SCurveView from '../views/SCurveView';

// Task components
import TaskEditForm from '../tasks/TaskEditForm';

// Advanced features
import SettingsPanel from '../settings/SettingsPanel';
import ImportExportPanel from '../features/ImportExportPanel';
import DependencyChainPopup from '../features/DependencyChainPopup';
import GCalSyncPanel from '../features/GCalSyncPanel';
import HelpModal from '../features/HelpModal';
import AiCommandPanel from '../features/AiCommandPanel';
import AppFooter from './AppFooter';
import apiClient from '../../services/apiClient';

export default function AppLayout() {
  // State
  var { taskState, dispatch, dispatchPersist, loading, saving, loadTasks, placements, loadPlacements, setStatus, setDirection, updateTask, addTasks, deleteTask, createTask, taskStateRef, setPlacements } = useTaskState();
  var isMobile = useIsMobile();
  var config = useConfig();
  var { toast, toastHistory, showToast } = useToast();
  var { pushUndo, popUndo } = useUndo(taskStateRef, dispatch, dispatchPersist);

  var [darkMode, setDarkMode] = useState(function() {
    var saved = localStorage.getItem('juggler-darkMode');
    return saved !== null ? saved === 'true' : true;
  });
  var [viewMode, setViewMode] = useState('day');
  var [filter, setFilter] = useState('open');
  var [search, setSearch] = useState('');
  var [projectFilter, setProjectFilter] = useState('');
  var [dayOffset, setDayOffset] = useState(0);
  var [expandedTask, setExpandedTask] = useState(null);
  var [showSettings, setShowSettings] = useState(false);
  var [showExport, setShowExport] = useState(false);
  var [showGCalSync, setShowGCalSync] = useState(false);
  var [showToastHistory, setShowToastHistory] = useState(false);
  var [chainPopupId, setChainPopupId] = useState(null);
  var [hideHabits, setHideHabits] = useState(false);
  var [showHelp, setShowHelp] = useState(false);
  var [showCreateForm, setShowCreateForm] = useState(false);
  var [gcalAutoSync, setGcalAutoSync] = useState(false);
  var [gcalLastSyncedAt, setGcalLastSyncedAt] = useState(null);
  var [gcalSyncing, setGcalSyncing] = useState(false);
  var [scheduling, setScheduling] = useState(false);
  var schedulingRef = useRef(false);
  var editingRef = useRef(false);

  var theme = getTheme(darkMode);
  var statuses = taskState.statuses;
  var directions = taskState.directions;
  var allTasks = taskState.tasks;

  // Track when editing UI is open to suspend background syncs/scheduling
  editingRef.current = !!expandedTask || !!showCreateForm || !!chainPopupId || !!showSettings;

  // Load data on mount
  useEffect(() => {
    loadTasks().then(result => {
      if (result?.config) {
        config.initFromConfig(result.config);
      }
      loadPlacements();
    });
  }, []);

  // Handle ?gcal=connected redirect from OAuth callback
  useEffect(() => {
    var params = new URLSearchParams(window.location.search);
    if (params.get('gcal') === 'connected') {
      showToast('Google Calendar connected!', 'success');
      // Strip the param from URL without reload
      params.delete('gcal');
      var newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      // Notify any open popup parent
      if (window.opener) {
        window.opener.postMessage('gcal-connected', '*');
        window.close();
      }
    }
  }, []);

  // Fetch GCal status on mount
  useEffect(() => {
    apiClient.get('/gcal/status')
      .then(function(r) {
        setGcalAutoSync(!!r.data.autoSync);
        setGcalLastSyncedAt(r.data.lastSyncedAt || null);
      })
      .catch(function() { /* not connected */ });
  }, []);

  // Auto-sync polling: initial sync at 5s, then every 5 minutes
  useEffect(() => {
    if (!gcalAutoSync) return;

    function runAutoSync() {
      if (schedulingRef.current || editingRef.current) return;
      setGcalSyncing(true);
      apiClient.post('/gcal/sync').then(function(r) {
        setGcalLastSyncedAt(new Date().toISOString());
        if (r.data.pushed || r.data.pulled || r.data.deleted_local || r.data.deleted_remote) {
          loadTasks().then(function() { loadPlacements(); });
        }
      }).catch(function() { /* silent */ }).finally(function() {
        setGcalSyncing(false);
      });
    }

    var initialTimer = setTimeout(runAutoSync, 5000);
    var intervalId = setInterval(runAutoSync, 5 * 60 * 1000);

    return function() {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [gcalAutoSync, loadTasks, loadPlacements]);

  // Derived dates
  var today = useMemo(() => {
    var d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);

  var selectedDate = useMemo(() => {
    var d = new Date(today); d.setDate(d.getDate() + dayOffset); return d;
  }, [today, dayOffset]);

  var selectedDateKey = useMemo(() => formatDateKey(selectedDate), [selectedDate]);

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
    scheduleTemplates: config.scheduleTemplates
  }), [config.timeBlocks, config.locSchedules, config.locScheduleDefaults, config.locScheduleOverrides, config.hourLocationOverrides, config.toolMatrix, config.splitDefault, config.splitMinDefault, config.schedFloor, config.scheduleTemplates]);

  // Placements come from the backend scheduler API
  var dayPlacements = placements.dayPlacements;
  var unplaced = placements.unplaced;

  // Blocked tasks: tasks whose dependencies are not all done AND whose
  // date is today or in the past (future tasks with pending deps are expected)
  var blockedTaskIds = useMemo(() => {
    var ids = new Set();
    var todayKey = formatDateKey(new Date());
    allTasks.forEach(t => {
      if (t.dependsOn && t.dependsOn.length > 0) {
        var allDepsDone = t.dependsOn.every(depId => {
          var s = statuses[depId] || '';
          return s === 'done';
        });
        if (!allDepsDone && (statuses[t.id] || '') === '') {
          var td = parseDate(t.date);
          var todayD = parseDate(todayKey);
          if (td && todayD && td <= todayD) {
            ids.add(t.id);
          }
        }
      }
    });
    return ids;
  }, [allTasks, statuses]);

  var unplacedCount = unplaced.length;
  var blockedCount = blockedTaskIds.size;

  // Unplaced task IDs set for fast lookup
  var unplacedIds = useMemo(() => {
    var ids = new Set();
    unplaced.forEach(u => ids.add(u.id || u.task?.id || u));
    return ids;
  }, [unplaced]);

  // Item 6: Generate recurring instances on load
  var recurGenRef = useRef(false);
  useEffect(() => {
    if (allTasks.length === 0 || recurGenRef.current) return;
    recurGenRef.current = true;
    var startDate = new Date();
    var endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);
    var newTasks = generateRecurringPure(allTasks, startDate, endDate);
    if (newTasks.length > 0) {
      addTasks(newTasks);
      showToast('Generated ' + newTasks.length + ' recurring tasks', 'info');
    }
  }, [allTasks.length]);

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
    var n = new Date(); return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    var id = setInterval(() => {
      var n = new Date();
      setNowMins(n.getHours() * 60 + n.getMinutes());
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
    result.sort((a, b) => a._earliest - b._earliest);
    return result;
  }, [config.scheduleTemplates, config.timeBlocks]);

  // All project names
  var allProjectNames = useMemo(() => {
    var names = {};
    allTasks.forEach(t => { if (t.project) names[t.project] = true; });
    config.projects.forEach(p => { if (p.name) names[p.name] = true; });
    return Object.keys(names).sort();
  }, [allTasks, config.projects]);

  // Status change handler
  var handleStatusChange = useCallback((id, val) => {
    pushUndo('status change');
    setStatus(id, val, {
      deleteDirection: val !== 'other',
      taskFields: { status: val }
    });
    var labels = { done: 'Done', wip: 'WIP', cancel: 'Cancelled', skip: 'Skipped', other: 'Redirected', '': 'Reopened' };
    showToast((labels[val] || val) + ': ' + (allTasks.find(t => t.id === id)?.text || id).slice(0, 40), 'success');
  }, [pushUndo, setStatus, allTasks, showToast]);

  // Task expand handler
  var handleExpand = useCallback((id) => {
    setExpandedTask(prev => prev === id ? null : id);
  }, []);

  // Task create handler
  var handleCreate = useCallback((task) => {
    pushUndo('add task');
    createTask(task);
    showToast('Added: ' + task.text, 'success');
  }, [pushUndo, createTask, showToast]);

  // Task update handler
  var handleUpdateTask = useCallback((id, fields) => {
    pushUndo('edit task');
    updateTask(id, fields);
    showToast('Updated task', 'success');
  }, [pushUndo, updateTask, showToast]);

  // Batch mark habits done for a given date
  var handleBatchHabitsDone = useCallback((dateKey) => {
    pushUndo('batch habits done');
    var count = 0;
    allTasks.forEach(t => {
      if (t.habit && t.date === dateKey && (statuses[t.id] || '') !== 'done') {
        setStatus(t.id, 'done', { taskFields: { status: 'done' } });
        count++;
      }
    });
    showToast(count + ' habits marked done', 'success');
  }, [allTasks, statuses, pushUndo, setStatus, showToast]);

  // Per-hour location override handler
  var handleHourLocationOverride = useCallback((dateKey, hour, locId) => {
    var overrides = Object.assign({}, config.hourLocationOverrides || {});
    if (!overrides[dateKey]) overrides[dateKey] = {};
    overrides[dateKey][hour] = locId;
    config.updateHourLocationOverrides(overrides);
  }, [config]);

  // Manual reschedule trigger — calls backend scheduler
  var handleReschedule = useCallback(() => {
    if (scheduling || gcalSyncing || editingRef.current) return;
    setScheduling(true);
    schedulingRef.current = true;
    showToast('Rescheduling...', 'info');
    apiClient.post('/schedule/run').then(function(r) {
      var msg = 'Rescheduled: ' + (r.data.updated || 0) + ' tasks updated';
      showToast(msg, 'success');
      loadTasks().then(function() { loadPlacements(); });
    }).catch(function(err) {
      showToast('Reschedule error: ' + (err.response?.data?.error || err.message), 'error');
    }).finally(function() {
      setScheduling(false);
      schedulingRef.current = false;
    });
  }, [showToast, loadTasks, loadPlacements, scheduling, gcalSyncing]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    selectedDate, tasksByDate, statuses, allTasks, expandedTask, filter,
    setExpandedTask, setDayOffset, setShowSettings, setShowExport,
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
        splitMinDefault: config.splitMinDefault, schedFloor: config.schedFloor,
        fontSize: config.fontSize
      });
    }, 500);
  }, [config]);

  // Drag and drop handlers
  var { handleGridDrop, handleDateDrop, handlePriorityDrop } = useDragDrop({
    allTasks, onUpdate: handleUpdateTask, gridZoom: config.gridZoom, showToast
  });

  // Marker drag handler — convert minutes to time string and update task
  var handleMarkerDrag = useCallback(function(taskId, totalMins) {
    var hr = Math.floor(totalMins / 60);
    var mn = totalMins % 60;
    var ap = hr >= 12 ? 'PM' : 'AM';
    var h12 = hr > 12 ? hr - 12 : (hr === 0 ? 12 : hr);
    var newTime = h12 + ':' + (mn < 10 ? '0' : '') + mn + ' ' + ap;
    pushUndo('drag marker');
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

    (ops || []).forEach(function(op) {
      if (op.op === 'status') {
        if (op.value === '') { delete newSt[op.id]; } else { newSt[op.id] = op.value; }
      } else if (op.op === 'edit') {
        var editFields = Object.assign({}, op.fields);
        var srcTask = allTasks.find(function(tt) { return tt.id === op.id; });
        if (srcTask && srcTask.when && srcTask.when.indexOf('fixed') >= 0) {
          delete editFields.date; delete editFields.day; delete editFields.time;
        }
        taskEdits[op.id] = Object.assign({}, taskEdits[op.id] || {}, editFields);
      } else if (op.op === 'add' && op.task) {
        op.task.created = new Date().toISOString();
        newTasks = newTasks.concat([op.task]);
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

    dispatchPersist({ type: 'SET_ALL', statuses: newSt, tasks: newTasks });
    if (newLocs) config.updateLocations(newLocs);
    if (newTools) config.updateTools(newTools);
    if (newMatrix) config.updateToolMatrix(newMatrix);
    if (newBlocks) config.updateTimeBlocks(newBlocks);

    showToast(msg || 'AI: ' + ops.length + ' changes applied', 'success');
  }, [allTasks, statuses, config, pushUndo, dispatchPersist, showToast]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.bg, color: theme.textMuted, fontFamily: "'DM Sans', system-ui", fontSize: 14 }}>
        Loading tasks...
      </div>
    );
  }

  var isToday = selectedDateKey === formatDateKey(new Date());
  var expandedTaskObj = expandedTask ? allTasks.find(t => t.id === expandedTask) : null;

  return (
    <div style={{ height: '100vh', overflow: 'hidden', maxWidth: '100vw', background: theme.bg, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
    <div style={{ width: isMobile ? '100%' : (10000 / config.fontSize) + '%', height: isMobile ? '100%' : (10000 / config.fontSize) + '%', transform: isMobile ? undefined : 'scale(' + (config.fontSize / 100) + ')', transformOrigin: '0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, zIndex: 100, background: theme.bg }}>
        <HeaderBar
          darkMode={darkMode} setDarkMode={function(v) { setDarkMode(function(prev) { var next = typeof v === 'function' ? v(prev) : v; localStorage.setItem('juggler-darkMode', String(next)); return next; }); }} saving={saving}
          selectedDateKey={selectedDateKey} statuses={statuses} tasksByDate={tasksByDate}
          onShowSettings={() => setShowSettings(true)} onShowExport={() => setShowExport(true)}
          onShowGCalSync={() => setShowGCalSync(true)}
          gcalSyncing={gcalSyncing}
          scheduling={scheduling}
          onReschedule={handleReschedule}
          onShowHelp={() => setShowHelp(true)}
          onAddTask={() => { setShowCreateForm(true); setExpandedTask(null); }}
          isMobile={isMobile}
          aiPanel={<AiCommandPanel darkMode={darkMode} isMobile={isMobile} allTasks={allTasks} statuses={statuses} config={config} onApplyOps={handleAiOps} showToast={showToast} />}
        />
        <WeekStrip
          weekStripDates={weekStripDates} selectedDate={selectedDate}
          dayOffset={dayOffset} setDayOffset={setDayOffset} today={today}
          darkMode={darkMode} statuses={statuses} tasksByDate={tasksByDate}
          isMobile={isMobile}
        />
        <NavigationBar
          viewMode={viewMode} setViewMode={setViewMode}
          filter={filter} setFilter={setFilter}
          search={search} setSearch={setSearch}
          darkMode={darkMode}
          projectFilter={projectFilter} setProjectFilter={setProjectFilter}
          allProjectNames={allProjectNames}
          hideHabits={hideHabits} setHideHabits={setHideHabits}
          unplacedCount={unplacedCount} blockedCount={blockedCount}
          isMobile={isMobile}
        />
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', minHeight: 0 }}>
        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {viewMode === 'day' && (
            <DayView
              selectedDate={selectedDate} selectedDateKey={selectedDateKey}
              placements={dayPlacements[selectedDateKey] || []}
              statuses={statuses} directions={directions}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              onCreate={handleCreate} gridZoom={config.gridZoom}
              darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins} isToday={isToday}
              onGridDrop={handleGridDrop}
              locSchedules={config.locSchedules}
              onUpdateLocScheduleOverrides={config.updateTemplateOverrides}
              allTasks={allTasks} onBatchHabitsDone={handleBatchHabitsDone}
              locations={config.locations} onHourLocationOverride={handleHourLocationOverride}
              blockedTaskIds={blockedTaskIds}
              onZoomChange={handleZoomChange}
              isMobile={isMobile}
              onMarkerDrag={handleMarkerDrag}
            />
          )}
          {viewMode === '3day' && (
            <ThreeDayView
              selectedDate={selectedDate} dayPlacements={dayPlacements}
              statuses={statuses} directions={directions}
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
              selectedDate={selectedDate} dayPlacements={dayPlacements}
              statuses={statuses} directions={directions}
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
              placements={dayPlacements[selectedDateKey] || []}
              statuses={statuses} directions={directions}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              onCreate={handleCreate} gridZoom={config.gridZoom}
              darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins} isToday={isToday}
              onGridDrop={handleGridDrop}
              locSchedules={config.locSchedules}
              onUpdateLocScheduleOverrides={config.updateTemplateOverrides}
              allTasks={allTasks} onBatchHabitsDone={handleBatchHabitsDone}
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
              placements={dayPlacements[selectedDateKey] || []}
              statuses={statuses} directions={directions}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              darkMode={darkMode} schedCfg={schedCfg} nowMins={nowMins} isToday={isToday}
              blockedTaskIds={blockedTaskIds}
              locSchedules={config.locSchedules}
              onUpdateLocScheduleOverrides={config.updateTemplateOverrides}
              allTasks={allTasks} onBatchHabitsDone={handleBatchHabitsDone}
              isMobile={isMobile}
            />
          )}
          {viewMode === 'month' && (
            <MonthView
              selectedDate={selectedDate} dayPlacements={dayPlacements}
              statuses={statuses} tasksByDate={tasksByDate}
              onExpand={handleExpand} setDayOffset={setDayOffset} today={today} darkMode={darkMode}
              onDateDrop={handleDateDrop}
              isMobile={isMobile}
            />
          )}
          {viewMode === 'list' && (
            <ListView
              allTasks={allTasks} statuses={statuses} directions={directions}
              filter={filter} search={search} projectFilter={projectFilter}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              onCreate={handleCreate} darkMode={darkMode} schedCfg={schedCfg}
              hideHabits={hideHabits} blockedTaskIds={blockedTaskIds} unplacedIds={unplacedIds}
              isMobile={isMobile}
            />
          )}
          {viewMode === 'priority' && (
            <PriorityView
              allTasks={allTasks} statuses={statuses} directions={directions}
              filter={filter} search={search} projectFilter={projectFilter}
              onStatusChange={handleStatusChange} onExpand={handleExpand} darkMode={darkMode}
              onPriorityDrop={handlePriorityDrop}
              hideHabits={hideHabits} blockedTaskIds={blockedTaskIds} unplacedIds={unplacedIds}
              isMobile={isMobile}
            />
          )}
          {viewMode === 'conflicts' && (
            <ConflictsView
              allTasks={allTasks} statuses={statuses} directions={directions}
              unplaced={unplaced}
              onStatusChange={handleStatusChange} onExpand={handleExpand} darkMode={darkMode}
              isMobile={isMobile}
            />
          )}
        </div>

        {/* Task edit panel */}
        {expandedTaskObj && !showCreateForm && (
          <TaskEditForm
            task={expandedTaskObj}
            status={statuses[expandedTask] || ''}
            direction={directions[expandedTask]}
            onUpdate={handleUpdateTask}
            onStatusChange={val => handleStatusChange(expandedTask, val)}
            onDirectionChange={val => setDirection(expandedTask, val)}
            onDelete={deleteTask}
            onClose={() => setExpandedTask(null)}
            onShowChain={() => setChainPopupId(expandedTask)}
            allProjectNames={allProjectNames}
            locations={config.locations}
            tools={config.tools}
            uniqueTags={uniqueTags}
            darkMode={darkMode}
            isMobile={isMobile}
          />
        )}

        {/* Task create panel */}
        {showCreateForm && (
          <TaskEditForm
            mode="create"
            onCreate={handleCreate}
            onClose={() => setShowCreateForm(false)}
            initialDate={selectedDate}
            allProjectNames={allProjectNames}
            locations={config.locations}
            tools={config.tools}
            uniqueTags={uniqueTags}
            darkMode={darkMode}
            isMobile={isMobile}
          />
        )}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} darkMode={darkMode} config={config} allProjectNames={allProjectNames} isMobile={isMobile} />
      )}

      {/* Import/Export panel */}
      {showExport && (
        <ImportExportPanel onClose={() => setShowExport(false)} darkMode={darkMode} showToast={showToast}
          allTasks={allTasks} statuses={statuses} dayPlacements={dayPlacements} isMobile={isMobile}
          addTasks={addTasks} />
      )}

      {/* GCal Sync panel */}
      {showGCalSync && (
        <GCalSyncPanel
          onClose={() => setShowGCalSync(false)}
          darkMode={darkMode}
          showToast={showToast}
          isMobile={isMobile}
          autoSync={gcalAutoSync}
          lastSyncedAt={gcalLastSyncedAt}
          onAutoSyncChange={function(val) {
            setGcalAutoSync(val);
            if (!val) setGcalLastSyncedAt(gcalLastSyncedAt); // keep last value
          }}
          scheduling={scheduling}
          onSyncStart={function() { setGcalSyncing(true); }}
          onSyncComplete={function() {
            setGcalSyncing(false);
            setGcalLastSyncedAt(new Date().toISOString());
            loadTasks().then(function() { loadPlacements(); });
          }}
        />
      )}

      {/* Dependency chain popup */}
      {chainPopupId && (
        <DependencyChainPopup
          focusTaskId={chainPopupId}
          allTasks={allTasks}
          statuses={statuses}
          onUpdate={handleUpdateTask}
          onClose={() => setChainPopupId(null)}
          darkMode={darkMode}
          isMobile={isMobile}
        />
      )}

      {/* Help modal */}
      {showHelp && (
        <HelpModal onClose={() => setShowHelp(false)} darkMode={darkMode} isMobile={isMobile} />
      )}

      <AppFooter darkMode={darkMode} />

      <ToastNotification
        toast={toast} toastHistory={toastHistory}
        showHistory={showToastHistory}
        onToggleHistory={() => setShowToastHistory(v => !v)}
      />
    </div>
    </div>
  );
}
