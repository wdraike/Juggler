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
import { getTheme } from '../../theme/colors';
import { formatDateKey, getWeekStart, parseDate } from '../../scheduler/dateHelpers';
import { DAY_NAMES } from '../../state/constants';
import unifiedSchedule from '../../scheduler/unifiedSchedule';
import { generateRecurringPure } from '../../scheduler/generateRecurring';

// Views
import DayView from '../views/DayView';
import ThreeDayView from '../views/ThreeDayView';
import WeekView from '../views/WeekView';
import MonthView from '../views/MonthView';
import ListView from '../views/ListView';
import PriorityView from '../views/PriorityView';
import ConflictsView from '../views/ConflictsView';

// Task components
import TaskEditForm from '../tasks/TaskEditForm';

// Advanced features
import SettingsPanel from '../settings/SettingsPanel';
import ImportExportPanel from '../features/ImportExportPanel';
import DependencyChainPopup from '../features/DependencyChainPopup';
import GCalSyncPanel from '../features/GCalSyncPanel';
import HelpModal from '../features/HelpModal';
import apiClient from '../../services/apiClient';

export default function AppLayout() {
  // State
  var { taskState, dispatch, dispatchPersist, loading, saving, loadTasks, setStatus, setDirection, updateTask, addTasks, deleteTask, createTask, taskStateRef } = useTaskState();
  var config = useConfig();
  var { toast, toastHistory, showToast } = useToast();
  var { pushUndo, popUndo } = useUndo(taskStateRef, dispatch, dispatchPersist);

  var [darkMode, setDarkMode] = useState(true);
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
  var [gcalAutoSync, setGcalAutoSync] = useState(false);
  var [gcalLastSyncedAt, setGcalLastSyncedAt] = useState(null);
  var [gcalSyncing, setGcalSyncing] = useState(false);

  var theme = getTheme(darkMode);
  var statuses = taskState.statuses;
  var directions = taskState.directions;
  var allTasks = taskState.tasks;

  // Load data on mount
  useEffect(() => {
    loadTasks().then(result => {
      if (result?.config) {
        config.initFromConfig(result.config);
      }
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
      setGcalSyncing(true);
      apiClient.post('/gcal/sync').then(function(r) {
        setGcalLastSyncedAt(new Date().toISOString());
        if (r.data.pushed || r.data.pulled || r.data.patched || r.data.deleted) {
          loadTasks();
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
  }, [gcalAutoSync, loadTasks]);

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
    schedFloor: config.schedFloor
  }), [config.timeBlocks, config.locSchedules, config.locScheduleDefaults, config.locScheduleOverrides, config.hourLocationOverrides, config.toolMatrix, config.splitDefault, config.splitMinDefault, config.schedFloor]);

  // Unified schedule computation
  var schedResultRef = useRef({ dayPlacements: {}, taskUpdates: {}, unplaced: [], deadlineMisses: [], placedCount: 0, newStatuses: {} });

  useMemo(() => {
    if (allTasks.length === 0) return;
    var now = new Date();
    var nowMins, todayKey;
    try {
      var tp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
      var h = parseInt(tp.find(p => p.type === 'hour').value); if (h === 24) h = 0;
      var m = parseInt(tp.find(p => p.type === 'minute').value);
      nowMins = h * 60 + m;
      var dp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' }).formatToParts(now);
      todayKey = dp.find(p => p.type === 'month').value + '/' + dp.find(p => p.type === 'day').value;
    } catch (e) {
      nowMins = now.getHours() * 60 + now.getMinutes();
      todayKey = formatDateKey(now);
    }
    try {
      schedResultRef.current = unifiedSchedule(allTasks, statuses, todayKey, nowMins, schedCfg);
    } catch (err) {
      console.error('[SCHED] error:', err);
    }
  }, [allTasks, statuses, schedCfg]);

  var dayPlacements = schedResultRef.current.dayPlacements;
  var unplaced = schedResultRef.current.unplaced;

  // Blocked tasks: tasks whose dependencies are not all done
  var blockedTaskIds = useMemo(() => {
    var ids = new Set();
    allTasks.forEach(t => {
      if (t.dependsOn && t.dependsOn.length > 0) {
        var allDepsDone = t.dependsOn.every(depId => {
          var s = statuses[depId] || '';
          return s === 'done';
        });
        if (!allDepsDone && (statuses[t.id] || '') === '') {
          ids.add(t.id);
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

  // All unique tags
  var uniqueTags = useMemo(() => {
    var seen = {}, result = [];
    DAY_NAMES.forEach(dn => {
      (config.timeBlocks[dn] || []).forEach(b => {
        if (!seen[b.tag]) { seen[b.tag] = true; result.push({ tag: b.tag, name: b.name, icon: b.icon, color: b.color }); }
      });
    });
    return result;
  }, [config.timeBlocks]);

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

  // Manual reschedule trigger
  var handleReschedule = useCallback(() => {
    // Force reschedule by toggling a no-op config change
    var now = new Date();
    var nowMinsVal;
    try {
      var tp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
      var h = parseInt(tp.find(p => p.type === 'hour').value); if (h === 24) h = 0;
      var m = parseInt(tp.find(p => p.type === 'minute').value);
      nowMinsVal = h * 60 + m;
    } catch (e) {
      nowMinsVal = now.getHours() * 60 + now.getMinutes();
    }
    var todayKeyVal = formatDateKey(now);
    try {
      schedResultRef.current = unifiedSchedule(allTasks, statuses, todayKeyVal, nowMinsVal, schedCfg);
      showToast('Schedule recalculated', 'success');
    } catch (err) {
      showToast('Reschedule error: ' + err.message, 'error');
    }
  }, [allTasks, statuses, schedCfg, showToast]);

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
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', system-ui, sans-serif", display: 'flex', flexDirection: 'column', zoom: config.fontSize / 100 }}>
      <HeaderBar
        darkMode={darkMode} setDarkMode={setDarkMode} saving={saving}
        selectedDateKey={selectedDateKey} statuses={statuses} tasksByDate={tasksByDate}
        onShowSettings={() => setShowSettings(true)} onShowExport={() => setShowExport(true)}
        onShowGCalSync={() => setShowGCalSync(true)}
        gcalSyncing={gcalSyncing}
        onReschedule={handleReschedule}
        onShowHelp={() => setShowHelp(true)}
      />
      <WeekStrip
        weekStripDates={weekStripDates} selectedDate={selectedDate}
        dayOffset={dayOffset} setDayOffset={setDayOffset} today={today}
        darkMode={darkMode} statuses={statuses} tasksByDate={tasksByDate}
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
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
              onUpdateLocScheduleOverrides={config.updateLocScheduleOverrides}
              allTasks={allTasks} onBatchHabitsDone={handleBatchHabitsDone}
              locations={config.locations} onHourLocationOverride={handleHourLocationOverride}
              blockedTaskIds={blockedTaskIds}
              onZoomChange={handleZoomChange}
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
            />
          )}
          {viewMode === 'month' && (
            <MonthView
              selectedDate={selectedDate} dayPlacements={dayPlacements}
              statuses={statuses} tasksByDate={tasksByDate}
              onExpand={handleExpand} setDayOffset={setDayOffset} today={today} darkMode={darkMode}
              onDateDrop={handleDateDrop}
            />
          )}
          {viewMode === 'list' && (
            <ListView
              allTasks={allTasks} statuses={statuses} directions={directions}
              filter={filter} search={search} projectFilter={projectFilter}
              onStatusChange={handleStatusChange} onExpand={handleExpand}
              onCreate={handleCreate} darkMode={darkMode} schedCfg={schedCfg}
              hideHabits={hideHabits} blockedTaskIds={blockedTaskIds} unplacedIds={unplacedIds}
            />
          )}
          {viewMode === 'priority' && (
            <PriorityView
              allTasks={allTasks} statuses={statuses} directions={directions}
              filter={filter} search={search} projectFilter={projectFilter}
              onStatusChange={handleStatusChange} onExpand={handleExpand} darkMode={darkMode}
              onPriorityDrop={handlePriorityDrop}
              hideHabits={hideHabits} blockedTaskIds={blockedTaskIds} unplacedIds={unplacedIds}
            />
          )}
          {viewMode === 'conflicts' && (
            <ConflictsView
              allTasks={allTasks} statuses={statuses} directions={directions}
              unplaced={unplaced}
              onStatusChange={handleStatusChange} onExpand={handleExpand} darkMode={darkMode}
            />
          )}
        </div>

        {/* Task edit panel */}
        {expandedTaskObj && (
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
          />
        )}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} darkMode={darkMode} config={config} allProjectNames={allProjectNames} />
      )}

      {/* Import/Export panel */}
      {showExport && (
        <ImportExportPanel onClose={() => setShowExport(false)} darkMode={darkMode} showToast={showToast}
          allTasks={allTasks} statuses={statuses} dayPlacements={dayPlacements} />
      )}

      {/* GCal Sync panel */}
      {showGCalSync && (
        <GCalSyncPanel
          onClose={() => setShowGCalSync(false)}
          darkMode={darkMode}
          showToast={showToast}
          autoSync={gcalAutoSync}
          lastSyncedAt={gcalLastSyncedAt}
          onAutoSyncChange={function(val) {
            setGcalAutoSync(val);
            if (!val) setGcalLastSyncedAt(gcalLastSyncedAt); // keep last value
          }}
          onSyncStart={function() { setGcalSyncing(true); }}
          onSyncComplete={function() {
            setGcalSyncing(false);
            setGcalLastSyncedAt(new Date().toISOString());
            loadTasks();
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
        />
      )}

      {/* Help modal */}
      {showHelp && (
        <HelpModal onClose={() => setShowHelp(false)} darkMode={darkMode} />
      )}

      <ToastNotification
        toast={toast} toastHistory={toastHistory}
        showHistory={showToastHistory}
        onToggleHistory={() => setShowToastHistory(v => !v)}
      />
    </div>
  );
}
