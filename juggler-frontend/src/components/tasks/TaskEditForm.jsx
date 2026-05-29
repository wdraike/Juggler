/**
 * TaskEditForm — full editor matching the original JSX inline design
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { applyDefaults, CAL_PROVIDER_NAMES } from '../../state/constants';
import { toTime24, fromTime24, toDateISO, fromDateISO, formatDateKey, parseDate } from '../../scheduler/dateHelpers';
import { isAnchorDependentRecur } from '../../scheduler/expandRecurring';
import { getTheme } from '../../theme/colors';
import { convertTimeForDisplay } from '../../utils/timezone';
import { addMinutesTo24h } from './sections/WhenSection';
import CollapsibleSection from './CollapsibleSection';
import TaskDetailHeader from './TaskDetailHeader';
import MetaSection from './sections/MetaSection';
import WhereSection from './sections/WhereSection';
import WeatherSection from './sections/WeatherSection';
import ToolsSection from './sections/ToolsSection';
import DependsOnSection from './sections/DependsOnSection';
import WhenSection from './sections/WhenSection';


var WEATHER_PRECIP_ICONS = { wet_ok: '🌧️', light_ok: '🌂', dry_only: '☀️' };
var WEATHER_CLOUD_ICONS = { overcast_ok: '☁️', partly_ok: '🌤️', clear: '☀️' };

function iconBadge(ids, catalog) {
  return ids.map(function(id) { var item = catalog.find(function(x) { return x.id === id; }); return item ? item.icon : null; }).filter(Boolean).join(' ') || null;
}


var COLLAPSE_KEY = 'juggler_task_detail_collapse';
var COLLAPSE_DEFAULTS = {
  when: true, where: false, weather: false, tools: false, deps: false, meta: false,
  when_recurrence: false, when_constraints: false
};

function readCollapseState() {
  try {
    var stored = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
    return Object.assign({}, COLLAPSE_DEFAULTS, stored);
  } catch (e) {
    return Object.assign({}, COLLAPSE_DEFAULTS);
  }
}

function writeCollapseState(state) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state)); } catch (e) { /* quota */ }
}

export default function TaskEditForm({ task, status, onUpdate, onStatusChange, onDelete, onClose, onShowChain, allProjectNames, locations, tools, uniqueTags, scheduleTemplates, templateDefaults, calSyncSettings, darkMode, isMobile, mode, onCreate, initialDate, initialProject, stackIndex, onRecurDayConflict, activeTimezone, tempUnitPref }) {
  var isCreate = mode === 'create';
  var TH = getTheme(darkMode);
  var [collapse, setCollapse] = useState(readCollapseState);

  var toggleCollapse = useCallback(function(id) {
    setCollapse(function(prev) {
      var next = Object.assign({}, prev, { [id]: !prev[id] });
      writeCollapseState(next);
      return next;
    });
  }, []);

  var initDate = isCreate && initialDate ? toDateISO(formatDateKey(initialDate)) : '';
  var [text, setText] = useState(isCreate ? '' : (task.text || ''));
  var [project, setProject] = useState(isCreate ? (initialProject || '') : (task.project || ''));
  var [pri, setPri] = useState(isCreate ? 'P3' : (task.pri || 'P3'));
  // Task timezone: stored on the task, defaults to activeTimezone for new tasks.
  // The editor shows times in this timezone (what the user originally entered).
  var [taskTz, setTaskTz] = useState(isCreate ? (activeTimezone || 'America/New_York') : (task.tz || activeTimezone || 'America/New_York'));

  // Initialize date/time from task data.
  // For recurring tasks: derive Time from preferredTimeMins whenever it's
  // set — NOT gated on the `preferredTime` boolean flag. That flag is
  // legacy; older rows may have preferredTimeMins populated without the
  // flag, and reading task.time instead leaks the last-placed time into
  // the "Time" input, making it look like the preferred time changed
  // when really it was just the scheduler's most-recent placement.
  // For all other tasks: convert scheduledAt (UTC) to display timezone.
  var initDateTime = React.useMemo(function() {
    if (isCreate) return { date: initDate, time: '' };
    // Recurring Time Window: use preferredTimeMins directly (no tz conversion)
    if (task.recurring && task.preferredTimeMins != null) {
      var h = Math.floor(task.preferredTimeMins / 60);
      var m = task.preferredTimeMins % 60;
      var time24 = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
      // Date comes from instance's scheduledAt (if placed) or empty
      var tz = task.tz || activeTimezone || 'America/New_York';
      var dateStr = '';
      if (task.scheduledAt) {
        var conv = convertTimeForDisplay(task.scheduledAt, tz);
        if (conv && conv.date) dateStr = toDateISO(conv.date) || '';
      }
      return { date: dateStr, time: time24 };
    }
    // Normal tasks: convert from UTC
    var tz2 = task.tz || activeTimezone || 'America/New_York';
    if (task.scheduledAt) {
      var conv2 = convertTimeForDisplay(task.scheduledAt, tz2);
      if (conv2 && conv2.date) return { date: toDateISO(conv2.date) || '', time: toTime24(conv2.time) || '' };
    }
    return { date: toDateISO(task.date) || '', time: toTime24(task.time) || '' };
  }, []); // only on mount

  var [date, setDate] = useState(initDateTime.date);
  var [time, setTime] = useState(initDateTime.time);
  var [dur, setDur] = useState(isCreate ? 30 : (task.dur || 30));
  // Finish time is a UI-only projection of (start + dur). Three-way bound with
  // `time` and `dur`: editing any one updates the other two to keep
  // `finish = start + dur` invariant. Persisted to the backend via `time` +
  // `dur` — there is no "finish" column in the DB.
  var [endTime, setEndTime] = useState(function() {
    var initDur = isCreate ? 30 : (task.dur || 30);
    return initDateTime.time ? addMinutesTo24h(initDateTime.time, initDur) : '';
  });
  var [endTimeError, setEndTimeError] = useState(null);
  var [timeRemaining, setTimeRemaining] = useState(isCreate ? '' : (task.timeRemaining != null ? task.timeRemaining : ''));
  var [deadline, setDeadline] = useState(isCreate ? '' : toDateISO(task.deadline));
  var [startAfter, setStartAfter] = useState(isCreate ? '' : toDateISO(task.startAfter));
  var [notes, setNotes] = useState(isCreate ? '' : (task.notes || ''));
  var [url, setUrl] = useState(isCreate ? '' : (task.url || ''));
  var [when, setWhen] = useState(function() {
    if (isCreate) return '';
    var raw = task.when || '';
    // Strip stale tags not in uniqueTags (e.g. "biz" when no biz button exists)
    var special = ['anytime', 'allday', 'fixed'];
    if (!raw || special.indexOf(raw) >= 0) return raw;
    var knownTags = {};
    (uniqueTags || []).forEach(function(tb) { knownTags[tb.tag] = true; });
    if (Object.keys(knownTags).length === 0) return raw; // no tags loaded yet, keep as-is
    var cleaned = raw.split(',').map(function(s) { return s.trim(); }).filter(function(t) {
      return special.indexOf(t) >= 0 || knownTags[t];
    });
    return cleaned.length > 0 ? cleaned.join(',') : raw;
  });

  // Change timezone: convert displayed date/time to new timezone via UTC.
  // scheduledAt is the UTC source of truth. Re-display it in the new timezone.
  function changeTaskTimezone(newTz) {
    if (newTz === taskTz) return;
    // If we have scheduledAt (UTC), just re-display in new TZ
    if (!isCreate && task && task.scheduledAt) {
      var conv = convertTimeForDisplay(task.scheduledAt, newTz);
      if (conv && conv.date) {
        setDate(toDateISO(conv.date) || '');
        setTime(toTime24(conv.time) || '');
      }
    }
    setTaskTz(newTz);
  }

  var [dayReq, setDayReq] = useState(isCreate ? 'any' : (task.dayReq || 'any'));
  // Recurring is derived from recurrence — any recurring task is a recurring task.
  // Keep setRecurring for backward compat in buildFields, but the UI toggle is removed.
  var [recurring, setRecurring] = useState(isCreate ? false : !!task.recurring);
  var [rigid, setRigid] = useState(isCreate ? false : !!task.rigid); // rigid kept for time_window ± exact selector in WhenSection
  var [timeFlex, setTimeFlex] = useState(isCreate ? 60 : (task.timeFlex != null ? task.timeFlex : 60));
  var [split, setSplit] = useState(isCreate ? false : (task.split !== undefined ? task.split : false));
  var [splitMin, setSplitMin] = useState(isCreate ? 15 : (task.splitMin || 15));
  var [taskLoc, setTaskLoc] = useState(isCreate ? [] : (task.location || []));
  var [taskTools, setTaskTools] = useState(isCreate ? [] : (task.tools || []));
  var [travelBefore, setTravelBefore] = useState(isCreate ? 0 : (task.travelBefore || 0));
  var [travelAfter, setTravelAfter] = useState(isCreate ? 0 : (task.travelAfter || 0));
  var [marker, setMarker] = useState(isCreate ? false : !!task.marker);
  var [flexWhen, setFlexWhen] = useState(isCreate ? false : !!task.flexWhen);
  var [weatherPrecip, setWeatherPrecip] = useState(isCreate ? 'any' : (task.weatherPrecip || 'any'));
  var [weatherCloud, setWeatherCloud]   = useState(isCreate ? 'any' : (task.weatherCloud  || 'any'));
  var [weatherTempMin, setWeatherTempMin] = useState(isCreate ? '' : (task.weatherTempMin != null ? String(task.weatherTempMin) : ''));
  var [weatherTempMax, setWeatherTempMax] = useState(isCreate ? '' : (task.weatherTempMax != null ? String(task.weatherTempMax) : ''));
  var [weatherHumidityMin, setWeatherHumidityMin] = useState(isCreate ? '' : (task.weatherHumidityMin != null ? String(task.weatherHumidityMin) : ''));
  var [weatherHumidityMax, setWeatherHumidityMax] = useState(isCreate ? '' : (task.weatherHumidityMax != null ? String(task.weatherHumidityMax) : ''));
  // For recurring instances: the template's anchor date (separate from this instance's date)
  var [recurType, setRecurType] = useState(isCreate ? 'none' : (task.recur?.type || 'none'));
  var [recurDays, setRecurDays] = useState(isCreate ? 'MTWRF' : (function() {
    var raw = task.recur?.days;
    if (!raw) return 'MTWRF';
    // Normalize object format back to string for backward compat
    if (typeof raw === 'object' && !Array.isArray(raw)) return Object.keys(raw).join('');
    return String(raw);
  })());
  var [recurTimesPerCycle, setRecurTimesPerCycle] = useState(isCreate ? 0 : (task.recur?.timesPerCycle || 0)); // 0 = all selected days
  var [recurFillPolicy, setRecurFillPolicy] = useState(isCreate ? 'keep' : (task.recur?.fillPolicy || 'keep'));
  var [recurEvery, setRecurEvery] = useState(isCreate ? 2 : (task.recur?.every || 2));
  var [recurUnit, setRecurUnit] = useState(isCreate ? 'days' : (task.recur?.unit || 'days'));
  var [recurMonthDays, setRecurMonthDays] = useState(isCreate ? [1, 15] : (task.recur?.monthDays || [1, 15]));
  var [recurStart, setRecurringStart] = useState(isCreate ? '' : (task.recurStart || ''));
  var [recurEnd, setRecurringEnd] = useState(isCreate ? '' : (task.recurEnd || ''));

  // Whether the current recur config requires a stored anchor (recur_start).
  // Biweekly, interval, and timesPerCycle-filtered patterns can't run without
  // one — the scheduler would otherwise fall back to "today" and drift.
  var recurIsAnchorDependent = React.useMemo(function() {
    if (!recurring || recurType === 'none') return false;
    return isAnchorDependentRecur({
      type: recurType,
      days: recurDays,
      timesPerCycle: recurTimesPerCycle,
      every: recurEvery,
      unit: recurUnit,
      monthDays: recurMonthDays
    });
  }, [recurring, recurType, recurDays, recurTimesPerCycle, recurEvery, recurUnit, recurMonthDays]);

  // Auto-populate recurStart with today when the user picks an anchor-dependent
  // config and hasn't already set one. Prevents the "Cut Grass scheduled for
  // today when I did it Friday" class of confusion — user sees a value they
  // can override, rather than a silent today-fallback in the scheduler.
  //
  // Skip the effect on the first render so opening a form for an
  // already-anchor-dependent task with an empty recurStart doesn't mark it
  // dirty immediately. Only fires after the user has changed state at least
  // once (most commonly: flipping the recurrence type).
  var autofillGuardRef = useRef(true);
  React.useEffect(function() {
    if (autofillGuardRef.current) { autofillGuardRef.current = false; return; }
    if (!recurIsAnchorDependent) return;
    if (recurStart) return;
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');
    setRecurringStart(y + '-' + m + '-' + d);
  }, [recurIsAnchorDependent, recurStart]);

  // --- Recurring preferred-time toggle ---
  // For recurringTasks: does the user want a specific preferred time (fixed ± window)
  // or flexible block-based scheduling?
  var [hasPreferredTime, setRecurringHasPreferredTime] = useState(function() {
    if (isCreate) return false;
    if (!recurring || !task) return false;
    // Use tag-count heuristic for preferred-time detection
    var w = task.when || '';
    if (!w || w === 'fixed' || w === 'allday' || w === 'anytime') return false;
    var tags = w.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    return tags.length === 1;
  });

  // --- placementMode state ---
  // Canonical scheduling mode, initialized from task.placementMode.
  // This is the single source of truth for which mode (anytime/time_window/time_blocks/all_day/fixed/reminder) is active.
  var [placementMode, setPlacementMode] = useState(function() {
    if (isCreate) return 'anytime';
    if (!task) return 'anytime';
    return task.placementMode || 'anytime';
  });

  // Handler passed to WhenSection — sets placementMode and syncs hasPreferredTime for time-input display.
  function handleModeChange(mode) {
    var wasAllDay = placementMode === 'all_day';
    var isAllDay = mode === 'all_day';
    if (wasAllDay !== isAllDay) {
      setTime('');
      setEndTime('');
      setDur('');
    }
    setPlacementMode(mode);
    // Keep hasPreferredTime in sync: only true when in time_window mode (drives time-input visibility)
    setRecurringHasPreferredTime(mode === 'time_window');
  }

  var [saveStatus, setSaveStatus] = useState(null);
  var [saveError, setSaveError] = useState(null);
  var firstRender = useRef(true);
  // Track the task prop snapshot so we can detect external changes and diff for saves
  var taskSnapshotRef = useRef(null);
  var userDirtyRef = useRef(false); // true when user has unsaved edits
  var saveCooldownRef = useRef(false); // suppress external sync briefly after save

  // Build a comparable snapshot from a task object (same shape as form state)
  function snapshotFromTask(t) {
    return {
      text: t.text || '', project: t.project || '', pri: t.pri || 'P3',
      date: toDateISO(t.date) || '', time: toTime24(t.time) || '',
      dur: t.dur || 30, timeRemaining: t.timeRemaining != null ? t.timeRemaining : '',
      deadline: toDateISO(t.deadline) || '', startAfter: toDateISO(t.startAfter) || '',
      notes: t.notes || '', url: t.url || '', when: t.when || '', dayReq: t.dayReq || 'any',
      recurring: !!t.recurring, rigid: !!t.rigid,
      timeFlex: t.timeFlex != null ? t.timeFlex : null,
      split: t.split !== undefined ? !!t.split : false, splitMin: t.splitMin || 15,
      location: t.location || [], tools: t.tools || [],
      travelBefore: t.travelBefore || 0, travelAfter: t.travelAfter || 0,
      marker: !!t.marker,
      flexWhen: !!t.flexWhen,
      recurType: t.recur?.type || 'none', recurDays: t.recur?.days || 'MTWRF', recurTimesPerCycle: t.recur?.timesPerCycle || 0,
      recurFillPolicy: t.recur?.fillPolicy || 'keep',
      recurEvery: t.recur?.every || 2, recurUnit: t.recur?.unit || 'days',
      recurMonthDays: t.recur?.monthDays || [1, 15],
      tz: t.tz || activeTimezone || 'America/New_York',
      recurStart: t.recurStart || '', recurEnd: t.recurEnd || '',
      preferredTimeMins: t.preferredTimeMins != null ? t.preferredTimeMins : null,
      weatherPrecip: t.weatherPrecip || 'any',
      weatherCloud:  t.weatherCloud  || 'any',
      weatherTempMin: t.weatherTempMin != null ? t.weatherTempMin : null,
      weatherTempMax: t.weatherTempMax != null ? t.weatherTempMax : null,
      weatherHumidityMin: t.weatherHumidityMin != null ? t.weatherHumidityMin : null,
      weatherHumidityMax: t.weatherHumidityMax != null ? t.weatherHumidityMax : null
    };
  }
  if (!taskSnapshotRef.current && !isCreate && task) {
    taskSnapshotRef.current = snapshotFromTask(task);
  }

  // Sync form state from task prop when it changes externally (e.g. INIT reload)
  // Only sync if the user doesn't have unsaved edits and not in post-save cooldown
  useEffect(function() {
    if (isCreate || !task) return;
    var newSnap = snapshotFromTask(task);
    var oldSnap = taskSnapshotRef.current;
    if (!oldSnap || JSON.stringify(newSnap) === JSON.stringify(oldSnap)) {
      // Even if data matches, update snapshot ref silently
      taskSnapshotRef.current = newSnap;
      return;
    }
    if (userDirtyRef.current) return; // don't overwrite user's in-progress edits
    if (saveCooldownRef.current) {
      // After a save, suppress scheduler-driven re-sync — just update the snapshot
      // so the next real external change will be detected correctly
      taskSnapshotRef.current = newSnap;
      return;
    }
    taskSnapshotRef.current = newSnap;
    setText(newSnap.text); setProject(newSnap.project); setPri(newSnap.pri);
    setDate(newSnap.date); setTime(newSnap.time); setDur(newSnap.dur);
    // Re-derive finish projection from the refreshed start+dur
    setEndTime(newSnap.time ? addMinutesTo24h(newSnap.time, newSnap.dur || 0) : '');
    setEndTimeError(null);
    setTimeRemaining(newSnap.timeRemaining); setDeadline(newSnap.deadline);
    setStartAfter(newSnap.startAfter); setNotes(newSnap.notes);
    setUrl(newSnap.url || '');
    setWhen(newSnap.when); setDayReq(newSnap.dayReq);
    // Re-derive scheduling mode from synced value
    var syncTags = (newSnap.when || '').split(',').filter(Boolean);
    setRecurringHasPreferredTime(syncTags.length === 1 && newSnap.recurring);
    setRecurring(newSnap.recurring); setRigid(newSnap.rigid); setTimeFlex(newSnap.timeFlex);
    setSplit(newSnap.split); setSplitMin(newSnap.splitMin);
    setTaskLoc(newSnap.location); setTaskTools(newSnap.tools);
    setTravelBefore(newSnap.travelBefore); setTravelAfter(newSnap.travelAfter);
    setMarker(newSnap.marker);
    setFlexWhen(newSnap.flexWhen);
    setRecurType(newSnap.recurType); setRecurDays(newSnap.recurDays); setRecurTimesPerCycle(newSnap.recurTimesPerCycle || 0);
    setRecurFillPolicy(newSnap.recurFillPolicy || 'keep');
    setRecurEvery(newSnap.recurEvery); setRecurUnit(newSnap.recurUnit);
    setRecurMonthDays(newSnap.recurMonthDays);
    setRecurringStart(newSnap.recurStart); setRecurringEnd(newSnap.recurEnd);
    setWeatherPrecip(newSnap.weatherPrecip || 'any');
    setWeatherCloud(newSnap.weatherCloud   || 'any');
    setWeatherTempMin(newSnap.weatherTempMin != null ? String(newSnap.weatherTempMin) : '');
    setWeatherTempMax(newSnap.weatherTempMax != null ? String(newSnap.weatherTempMax) : '');
    setWeatherHumidityMin(newSnap.weatherHumidityMin != null ? String(newSnap.weatherHumidityMin) : '');
    setWeatherHumidityMax(newSnap.weatherHumidityMax != null ? String(newSnap.weatherHumidityMax) : '');
    firstRender.current = true; // prevent auto-save from firing for this sync
  }, [task, isCreate]);

  var buildFields = useCallback(function() {
    var d = fromDateISO(date);
    var dayName = '';
    if (d) {
      var pd = parseDate(d);
      if (pd) dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][pd.getDay()];
    }
    return {
      text, project, pri,
      date: d || '',
      day: dayName || '',
      time: fromTime24(time),
      dur: parseInt(dur) || 30,
      timeRemaining: timeRemaining === '' ? null : parseInt(timeRemaining),
      deadline: fromDateISO(deadline),
      startAfter: fromDateISO(startAfter),
      notes,
      url: (url && url.trim()) ? url.trim() : null,
      // Scheduling mode — sent explicitly to backend; backend writes directly to placement_mode ENUM column.
      placementMode: placementMode,
      when: when,  // preserved as-is: user-defined slot tag names only (no 'allday'/'fixed' system keywords after migration)
      dayReq: recurring ? 'any' : dayReq,  // recurringTasks derive days from recurrence, not dayReq
      recurring, rigid: rigid,
      // timeFlex: send when in time_window mode; null clears when switching away so backend doesn't retain stale values.
      timeFlex: placementMode === 'time_window' && time
        ? (timeFlex || 60)
        : (placementMode === 'time_window' ? null : undefined),
      // Always send as an explicit boolean. The previous `split || undefined`
      // collapsed `false` to `undefined`, which JSON-strips the key, which
      // the backend reads as "no change" — so turning split OFF never stuck.
      split: !!split,
      splitMin: split ? (parseInt(splitMin) || 15) : null,
      location: taskLoc,
      tools: taskTools,
      travelBefore: parseInt(travelBefore) || 0,
      travelAfter: parseInt(travelAfter) || 0,
      marker: marker,
      flexWhen: flexWhen,
      recur: recurType === 'none' ? null : {
        type: recurType,
        days: recurType === 'weekly' || recurType === 'biweekly' ? recurDays : undefined,
        timesPerCycle: recurTimesPerCycle > 0 ? recurTimesPerCycle : undefined,
        // Only persist fillPolicy when tpc filtering is actually active — the
        // field is meaningless without a target count.
        fillPolicy: recurTimesPerCycle > 0 && recurFillPolicy === 'backfill' ? 'backfill' : undefined,
        every: (recurType === 'interval' || recurType === 'rolling') ? parseInt(recurEvery) || (recurType === 'rolling' ? 7 : 2) : undefined,
        unit: (recurType === 'interval' || recurType === 'rolling') ? (recurUnit || 'days') : undefined,
        monthDays: recurType === 'monthly' ? recurMonthDays : undefined
      },
      tz: taskTz,
      _timezone: taskTz,  // tells backend which timezone to use for date/time → UTC conversion
      recurStart: recurring ? (recurStart || null) : null,
      recurEnd: recurring ? (recurEnd || null) : null,
      // preferredTimeMins: minutes since midnight from 24h time input (no tz conversion).
      // `null` — not undefined — when switching out of time_window mode so the backend clears preferred_time_mins.
      // The `recurring &&` gate is removed: any task (recurring or not) in time_window mode gets preferredTimeMins.
      preferredTimeMins: placementMode === 'time_window' && time
        ? (function() {
          var parts = time.split(':');
          return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
        })()
        : (placementMode === 'time_window' ? null : undefined),
      weatherPrecip,
      weatherCloud,
      weatherTempMin: weatherTempMin !== '' && weatherTempMin !== null ? parseInt(weatherTempMin) : null,
      weatherTempMax: weatherTempMax !== '' && weatherTempMax !== null ? parseInt(weatherTempMax) : null,
      // Internal storage is always Fahrenheit. Display unit (C/F) is a UI-only
      // preference handled by WeatherTempSlider via fToUnit/unitToF.
      weatherTempUnit: 'F',
      weatherHumidityMin: weatherHumidityMin !== '' && weatherHumidityMin !== null ? parseInt(weatherHumidityMin) : null,
      weatherHumidityMax: weatherHumidityMax !== '' && weatherHumidityMax !== null ? parseInt(weatherHumidityMax) : null
    };
  }, [text, project, pri, date, time, dur, timeRemaining, deadline, startAfter, notes, url, when, dayReq, recurring, rigid, timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools, marker, flexWhen, recurType, recurDays, recurTimesPerCycle, recurFillPolicy, recurEvery, recurUnit, recurMonthDays, isCreate, task, taskTz, recurStart, recurEnd, placementMode, weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax, weatherHumidityMin, weatherHumidityMax]);

  // Build only the fields that changed from the initial snapshot (prevents marking unchanged fields dirty)
  var buildChangedFields = useCallback(function() {
    var all = buildFields();
    var snap = taskSnapshotRef.current;
    if (!snap) return all; // no snapshot = send everything
    var changed = {};
    // Compare form state values directly against snapshot (avoids buildFields' || undefined transforms)
    if (text !== snap.text) changed.text = all.text;
    if (project !== snap.project) changed.project = all.project;
    if (pri !== snap.pri) changed.pri = all.pri;
    if (notes !== snap.notes) changed.notes = all.notes;
    if ((url || '') !== (snap.url || '')) changed.url = all.url;
    if (when !== snap.when) {
      changed.when = all.when;
    }
    var snapPlacementMode = task ? (task.placementMode || 'anytime') : 'anytime';
    if (placementMode !== snapPlacementMode) changed.placementMode = all.placementMode;
    if (dayReq !== snap.dayReq) changed.dayReq = all.dayReq;
    if (recurring !== snap.recurring) changed.recurring = all.recurring;
    if (rigid !== snap.rigid) changed.rigid = all.rigid;
    if (parseInt(dur) !== snap.dur) changed.dur = all.dur;
    // Compare the derived `all.timeFlex` (not the raw state) so that switching
    // into Time Blocks mode — which should blank timeFlex — is detected even
    // if the user didn't touch the flex input directly.
    // undefined = "not applicable for this task type"; treat null and undefined as equivalent
    if (all.timeFlex !== snap.timeFlex && !(all.timeFlex == null && snap.timeFlex == null)) changed.timeFlex = all.timeFlex;
    if (all.preferredTimeMins !== snap.preferredTimeMins && !(all.preferredTimeMins == null && snap.preferredTimeMins == null)) changed.preferredTimeMins = all.preferredTimeMins;
    if (!!split !== snap.split) changed.split = all.split;
    if (parseInt(splitMin) !== snap.splitMin) changed.splitMin = all.splitMin;
    if (!!marker !== snap.marker) changed.marker = all.marker;
    if (!!flexWhen !== snap.flexWhen) changed.flexWhen = all.flexWhen;
    if (parseInt(travelBefore) !== snap.travelBefore) changed.travelBefore = all.travelBefore;
    if (parseInt(travelAfter) !== snap.travelAfter) changed.travelAfter = all.travelAfter;
    // Date/time (compare in form format)
    if (date !== (snap.date || '')) { changed.date = all.date; changed.day = all.day; }
    if (time !== (snap.time || '')) changed.time = all.time;
    if (deadline !== (snap.deadline || '')) changed.deadline = all.deadline;
    if (startAfter !== (snap.startAfter || '')) changed.startAfter = all.startAfter;
    // Timezone change — also sends converted date/time
    if (taskTz !== (snap.tz || '')) { changed.tz = all.tz; changed.date = all.date; changed.day = all.day; changed.time = all.time; }
    // timeRemaining
    var snapRem = snap.timeRemaining === '' ? null : parseInt(snap.timeRemaining);
    if (all.timeRemaining !== snapRem) changed.timeRemaining = all.timeRemaining;
    // Array fields (location, tools)
    if (JSON.stringify(taskLoc) !== JSON.stringify(snap.location)) changed.location = all.location;
    if (JSON.stringify(taskTools) !== JSON.stringify(snap.tools)) changed.tools = all.tools;
    // Recurrence
    if (recurType !== snap.recurType || JSON.stringify(recurDays) !== JSON.stringify(snap.recurDays) || recurTimesPerCycle !== snap.recurTimesPerCycle || recurFillPolicy !== (snap.recurFillPolicy || 'keep') || String(recurEvery) !== String(snap.recurEvery) || recurUnit !== snap.recurUnit || JSON.stringify(recurMonthDays) !== JSON.stringify(snap.recurMonthDays)) {
      changed.recur = all.recur;
    }
    // Recurring date range (recurStart is the sole anchor post-refactor)
    if (recurStart !== (snap.recurStart || '')) changed.recurStart = all.recurStart;
    if (recurEnd !== (snap.recurEnd || '')) changed.recurEnd = all.recurEnd;
    if (weatherPrecip !== (snap.weatherPrecip || 'any')) changed.weatherPrecip = all.weatherPrecip;
    if (weatherCloud  !== (snap.weatherCloud  || 'any')) changed.weatherCloud  = all.weatherCloud;
    var snapTMin = snap.weatherTempMin != null ? snap.weatherTempMin : null;
    var snapTMax = snap.weatherTempMax != null ? snap.weatherTempMax : null;
    var curTMin  = weatherTempMin !== '' ? parseInt(weatherTempMin) : null;
    var curTMax  = weatherTempMax !== '' ? parseInt(weatherTempMax) : null;
    if (curTMin !== snapTMin) { changed.weatherTempMin = all.weatherTempMin; changed.weatherTempUnit = all.weatherTempUnit; }
    if (curTMax !== snapTMax) { changed.weatherTempMax = all.weatherTempMax; changed.weatherTempUnit = all.weatherTempUnit; }
    var snapHMin = snap.weatherHumidityMin != null ? snap.weatherHumidityMin : null;
    var snapHMax = snap.weatherHumidityMax != null ? snap.weatherHumidityMax : null;
    var curHMin  = weatherHumidityMin !== '' ? parseInt(weatherHumidityMin) : null;
    var curHMax  = weatherHumidityMax !== '' ? parseInt(weatherHumidityMax) : null;
    if (curHMin !== snapHMin) changed.weatherHumidityMin = all.weatherHumidityMin;
    if (curHMax !== snapHMax) changed.weatherHumidityMax = all.weatherHumidityMax;
    // Always include tz and _timezone when any field changed — the backend needs
    // the timezone context for date/time → UTC conversion
    if (Object.keys(changed).length > 0) {
      changed.tz = all.tz;
      changed._timezone = all._timezone;
    }
    return Object.keys(changed).length > 0 ? changed : null;
  }, [buildFields, text, project, pri, notes, url, when, dayReq, recurring, rigid, dur, timeRemaining, timeFlex, split, splitMin, travelBefore, travelAfter, marker, flexWhen, date, time, deadline, startAfter, taskLoc, taskTools, recurType, recurDays, recurTimesPerCycle, recurFillPolicy, recurEvery, recurUnit, recurMonthDays, recurStart, recurEnd, placementMode, weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax, weatherHumidityMin, weatherHumidityMax]);

  // Dirty detection — compare current fields to snapshot
  var [isDirty, setIsDirty] = useState(false);
  useEffect(function() {
    if (isCreate) return;
    if (firstRender.current) { firstRender.current = false; return; }
    userDirtyRef.current = true;
    var changed = buildChangedFields();
    setIsDirty(!!changed);
  }, [text, project, pri, date, time, dur, timeRemaining, deadline, startAfter, notes, url, when, dayReq, recurring, rigid, timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools, marker, flexWhen, recurType, recurDays, recurTimesPerCycle, recurFillPolicy, recurEvery, recurUnit, recurMonthDays, taskTz, recurStart, recurEnd, placementMode, weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax, weatherHumidityMin, weatherHumidityMax]);

  function handleSave() {
    // Suppress save while the start/finish pair is invalid — keeps the user's
    // typed bad value visible so they can correct it without losing state.
    if (endTimeError) return;
    var changed = buildChangedFields();
    if (!changed) return;

    // Client-side guard: fixed mode requires both a date and a time anchor.
    // The server enforces this too, but blocking early prevents an unnecessary
    // round-trip and gives the user an immediate, contextual error.
    if (placementMode === 'fixed' && (!date || !time)) {
      setSaveError('Fixed mode requires a date and time.');
      return;
    }
    setSaveError(null);

    // Check if a date change conflicts with recurrence days
    if (changed.date && onRecurDayConflict && task.recurring) {
      var recur = task.recur || (recurType !== 'none' ? { type: recurType, days: recurDays } : null);
      if (recur && (recur.type === 'weekly' || recur.type === 'biweekly') && recur.days) {
        var DAY_CODES = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];
        var td = parseDate(changed.date);
        if (td) {
          var dow = td.getDay();
          var dayCode = DAY_CODES[dow];
          // Only if user didn't also update the recurrence days to include the new day
          var effectiveDays = changed.recur ? (changed.recur.days || '') : recur.days;
          if (effectiveDays.indexOf(dayCode) < 0) {
            var DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            // Immediately show the proposed new day in the form's recurrence toggles
            setRecurDays(recur.days + dayCode);
            onRecurDayConflict({
              taskId: task.id,
              task: task,
              fields: changed,
              conflict: {
                conflicting: true,
                dayCode: dayCode,
                dayLabel: DAY_LABELS[dow],
                recurDays: recur.days,
                recur: recur
              }
            });
            return;
          }
        }
      }
    }

    commitSave(changed);
  }

  function commitSave(changed) {
    // Anchor date or recurrence changes regenerate instances (new IDs) — close form after save
    var willRegenerateInstances = changed.recur !== undefined;
    setSaveStatus('saving');
    var result = onUpdate(task.id, changed);
    // Wait for the API call to confirm before showing "Saved"
    Promise.resolve(result).then(function(ok) {
      if (ok === false || typeof ok === 'string') {
        setSaveStatus('failed');
        if (typeof ok === 'string') setSaveError(ok);
        setTimeout(function() { setSaveStatus(null); }, 3000);
        return;
      }
      if (willRegenerateInstances) {
        // The SSE delta will update the task list when the scheduler finishes.
        // Keep the form open — suppress external sync while scheduler runs.
        setSaveStatus('saved');
        userDirtyRef.current = false;
        setIsDirty(false);
        saveCooldownRef.current = true;
        setTimeout(function() { saveCooldownRef.current = false; }, 10000);
        return;
      }
      // Update snapshot so next save only sends new changes
      taskSnapshotRef.current = snapshotFromTask(Object.assign({}, task, buildFields()));
      userDirtyRef.current = false;
      setIsDirty(false);
      setSaveStatus('saved');
      // Suppress external sync for 3s after save — scheduler response shouldn't disrupt the form
      saveCooldownRef.current = true;
      setTimeout(function() { saveCooldownRef.current = false; }, 3000);
      setTimeout(function() { setSaveStatus(null); }, 1500);
    });
  }

  function handleCreate() {
    var fields = buildFields();
    var newId = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
    var newTask = applyDefaults(Object.assign({ id: newId }, fields));
    onCreate(newTask);
    onClose();
  }

  function handleRecurTypeChange(val) {
    setRecurType(val);
    if (val === 'none') { setRecurring(false); setRigid(false); }
    else { setRecurring(true); setSplit(false); setDayReq('any'); }
  }

  var whenParts = when ? when.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var isAllDay = placementMode === 'all_day';
  var isFixed = placementMode === 'fixed';

  var configWarnings = (function() {
    if (marker) return [];
    var isAnytime = whenParts.length === 0 || (whenParts.length === 1 && whenParts[0] === 'anytime');
    if (isAnytime || isAllDay || isFixed) return [];
    if (!scheduleTemplates || !templateDefaults) return [];
    var dayCodeMap = { Su: 'Sun', M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', Sa: 'Sat' };
    var weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var weekends = ['Sat', 'Sun'];
    var allDays = weekdays.concat(weekends);
    var eligibleDays;
    if (!dayReq || dayReq === 'any') { eligibleDays = allDays; }
    else if (dayReq === 'weekday') { eligibleDays = weekdays; }
    else if (dayReq === 'weekend') { eligibleDays = weekends; }
    else { eligibleDays = dayReq.split(',').map(function(c) { return dayCodeMap[c]; }).filter(Boolean); }
    if (taskLoc.length > 0 && whenParts.length > 0) {
      var matchingBlocks = [];
      eligibleDays.forEach(function(dn) {
        var tmplId = templateDefaults[dn];
        var tmpl = tmplId && scheduleTemplates[tmplId];
        if (!tmpl) return;
        (tmpl.blocks || []).forEach(function(b) { if (whenParts.indexOf(b.tag) >= 0) matchingBlocks.push(b); });
      });
      if (matchingBlocks.length > 0) {
        var hasLocMatch = matchingBlocks.some(function(b) { return taskLoc.some(function(loc) { return loc === b.loc; }); });
        if (!hasLocMatch) {
          var blockLocs = {};
          matchingBlocks.forEach(function(b) { if (b.loc) blockLocs[b.loc] = true; });
          return ['Location mismatch: task needs "' + taskLoc.join('" or "') + '" but matching time blocks use "' + Object.keys(blockLocs).join('", "') + '".'];
        }
      }
    }
    return [];
  })();
  if (deadline && dayReq && dayReq !== 'any') {
    var deadlineDate = parseDate(fromDateISO(deadline));
    if (deadlineDate && !isNaN(deadlineDate.getTime())) {
      var deadlineDayCode = ['Su','M','T','W','R','F','Sa'][deadlineDate.getDay()];
      var deadlineDayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][deadlineDate.getDay()];
      var allowed = dayReq === 'weekday' ? ['M','T','W','R','F'] : dayReq === 'weekend' ? ['Su','Sa'] : dayReq.split(',');
      if (allowed.indexOf(deadlineDayCode) < 0) {
        configWarnings.push('Deadline (' + deadlineDayName + ') conflicts with day requirement — task may not be schedulable before the deadline.');
      }
    }
  }

  var whereBadge = taskLoc.length > 0 ? iconBadge(taskLoc, locations || []) : null;
  var weatherBadgeParts = [];
  if (weatherPrecip && weatherPrecip !== 'any') weatherBadgeParts.push(WEATHER_PRECIP_ICONS[weatherPrecip] || '');
  if (weatherCloud && weatherCloud !== 'any') weatherBadgeParts.push(WEATHER_CLOUD_ICONS[weatherCloud] || '');
  if (weatherTempMin || weatherTempMax) weatherBadgeParts.push((weatherTempMin || '?') + '–' + (weatherTempMax || '?') + '°');
  if (weatherHumidityMin || weatherHumidityMax) weatherBadgeParts.push('💧' + (weatherHumidityMin || '?') + '–' + (weatherHumidityMax || '?') + '%');
  var weatherBadge = weatherBadgeParts.length > 0 ? weatherBadgeParts.join(' ') : null;
  var toolsBadge = taskTools.length > 0 ? iconBadge(taskTools, tools || []) : null;

  var whenBadge = placementMode === 'all_day' && date
    ? date + ' · All Day'
    : date && time
      ? date + ' · ' + (fromTime24(time) || time) + (endTime ? '–' + (fromTime24(endTime) || endTime) : '')
      : null;

  var dialogContent = (
    <>
      <TaskDetailHeader
        task={task} isCreate={isCreate} isMobile={isMobile} TH={TH} darkMode={darkMode}
        isDirty={isDirty} saveStatus={saveStatus} onSave={handleSave} onCreate={handleCreate}
        onClose={onClose} onDelete={onDelete} calSyncSettings={calSyncSettings}
        status={status} onStatusChange={onStatusChange}
        text={text} onTextChange={setText}
        project={project} onProjectChange={setProject} allProjectNames={allProjectNames}
        pri={pri} onPriChange={setPri}
        dur={dur}
        notes={notes} onNotesChange={setNotes}
        url={url} onUrlChange={setUrl}
        marker={marker} onMarkerChange={setMarker}
        scheduledBadge={whenBadge}
        unplacedDetail={!isCreate && task && task._unplacedDetail ? task._unplacedDetail : null}
        whenBlocked={!isCreate && task && task._whenBlocked && !flexWhen}
        onEnableFlex={function() { setFlexWhen(true); }}
      />

      {marker && !isCreate && task && task.calSyncOrigin && task.calSyncOrigin !== 'juggler' && (
        <div style={{ fontSize: 10, color: TH.amberText, margin: '8px 0 4px', fontWeight: 500, background: TH.amberBg, border: '1px solid ' + TH.amberBorder, borderRadius: 4, padding: '4px 8px' }}>
          {'📅 Calendar reminder from ' + (task.calSyncOrigin === 'apple' && task.appleCalendarName ? CAL_PROVIDER_NAMES.apple + ': ' + (task.appleCalendarName.length > 30 ? task.appleCalendarName.slice(0, 28) + '…' : task.appleCalendarName) : (CAL_PROVIDER_NAMES[task.calSyncOrigin] || task.calSyncOrigin)) + ' — managed externally.'}
        </div>
      )}

      {!marker && (
        <CollapsibleSection id="when" label="When" isOpen={!!collapse.when}
          onToggle={toggleCollapse}
          badge={collapse.when ? null : (whenBadge || 'No date')}
          TH={TH}>
          <WhenSection
            date={date} onDateChange={setDate}
            time={time} onTimeChange={setTime}
            endTime={endTime} onEndTimeChange={setEndTime} endTimeError={endTimeError} onEndTimeErrorChange={setEndTimeError}
            dur={dur} onDurChange={setDur}
            recurring={recurring} rigid={rigid} onRigidChange={setRigid}
            timeFlex={timeFlex} onTimeFlexChange={setTimeFlex}
            hasPreferredTime={hasPreferredTime} onHasPreferredTimeChange={setRecurringHasPreferredTime}
            recurType={recurType} onRecurTypeChange={handleRecurTypeChange}
            recurDays={recurDays} onRecurDaysChange={setRecurDays}
            recurEvery={recurEvery} onRecurEveryChange={setRecurEvery}
            recurTpc={recurTimesPerCycle} onRecurTpcChange={setRecurTimesPerCycle}
            recurFillPolicy={recurFillPolicy} onRecurFillPolicyChange={setRecurFillPolicy}
            recurUnit={recurUnit} onRecurUnitChange={setRecurUnit}
            recurMonthDays={recurMonthDays} onRecurMonthDaysChange={setRecurMonthDays}
            recurStart={recurStart} onRecurStartChange={setRecurringStart}
            recurEnd={recurEnd} onRecurEndChange={setRecurringEnd}
            recurIsAnchorDependent={recurIsAnchorDependent}
            configWarnings={configWarnings}
            deadline={deadline} onDeadlineChange={setDeadline}
            startAfter={startAfter} onStartAfterChange={setStartAfter}
            split={split} onSplitChange={setSplit}
            splitMin={splitMin} onSplitMinChange={setSplitMin}
            travelBefore={travelBefore} onTravelBeforeChange={setTravelBefore}
            travelAfter={travelAfter} onTravelAfterChange={setTravelAfter}
            marker={marker} onMarkerChange={setMarker}
            flexWhen={flexWhen} onFlexWhenChange={setFlexWhen}
            dayReq={dayReq} onDayReqChange={setDayReq}
            when={when} onWhenChange={setWhen}
            timeRemaining={timeRemaining} onTimeRemainingChange={setTimeRemaining}
            taskTz={taskTz} onChangeTz={changeTaskTimezone}
            placementMode={placementMode} onModeChange={handleModeChange}
            task={task} isCreate={isCreate} isMobile={isMobile} TH={TH}
            scheduleTemplates={scheduleTemplates} templateDefaults={templateDefaults}
            uniqueTags={uniqueTags}
            collapse={collapse} toggleCollapse={toggleCollapse}
          />
          {saveError && (
            <div role="alert" style={{ fontSize: 11, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4, padding: '4px 8px', marginTop: 4 }}>
              {saveError}
            </div>
          )}
        </CollapsibleSection>
      )}

      {!marker && placementMode !== 'all_day' && (
        <CollapsibleSection id="where" label="Where" isOpen={!!collapse.where}
          onToggle={toggleCollapse}
          badge={whereBadge}
          TH={TH}>
          <WhereSection locations={locations} taskLoc={taskLoc} onChange={setTaskLoc} TH={TH} isMobile={isMobile} />
        </CollapsibleSection>
      )}

      {!marker && placementMode !== 'all_day' && (
        <CollapsibleSection id="weather" label="Weather" isOpen={!!collapse.weather}
          onToggle={toggleCollapse}
          badge={weatherBadge}
          TH={TH}>
          <WeatherSection
            weatherPrecip={weatherPrecip} weatherCloud={weatherCloud}
            weatherTempMin={weatherTempMin} weatherTempMax={weatherTempMax}
            weatherHumidityMin={weatherHumidityMin} weatherHumidityMax={weatherHumidityMax}
            onChange={function(patch) {
              if (patch.weatherPrecip !== undefined) setWeatherPrecip(patch.weatherPrecip);
              if (patch.weatherCloud !== undefined) setWeatherCloud(patch.weatherCloud);
              if (patch.weatherTempMin !== undefined) setWeatherTempMin(patch.weatherTempMin);
              if (patch.weatherTempMax !== undefined) setWeatherTempMax(patch.weatherTempMax);
              if (patch.weatherHumidityMin !== undefined) setWeatherHumidityMin(patch.weatherHumidityMin);
              if (patch.weatherHumidityMax !== undefined) setWeatherHumidityMax(patch.weatherHumidityMax);
            }}
            TH={TH} isMobile={isMobile} tempUnitPref={tempUnitPref}
          />
        </CollapsibleSection>
      )}

      {!marker && placementMode !== 'all_day' && (tools || []).length > 0 && (
        <CollapsibleSection id="tools" label="Tools" isOpen={!!collapse.tools}
          onToggle={toggleCollapse}
          badge={toolsBadge}
          TH={TH}>
          <ToolsSection tools={tools} taskTools={taskTools} onChange={setTaskTools} TH={TH} isMobile={isMobile} />
        </CollapsibleSection>
      )}

      {!isCreate && onShowChain && (
        <CollapsibleSection id="deps" label="Depends On" isOpen={!!collapse.deps}
          onToggle={toggleCollapse}
          badge={task && task.dependsOn && task.dependsOn.length > 0 ? task.dependsOn.length + ' dep' + (task.dependsOn.length > 1 ? 's' : '') : null}
          TH={TH}>
          <DependsOnSection task={task} onShowChain={onShowChain} TH={TH} isMobile={isMobile} />
        </CollapsibleSection>
      )}

      {!isCreate && (
        <CollapsibleSection id="meta" label="Metadata" isOpen={!!collapse.meta}
          onToggle={toggleCollapse} TH={TH}>
          <MetaSection task={task} TH={TH} />
        </CollapsibleSection>
      )}

    </>
  );


  // Sidebar mode (desktop): render inline, no overlay
  if (!isMobile) {
    return (
      <div style={{
        height: '100%', overflowX: 'hidden', overflowY: 'auto',
        background: TH.bgCard, boxSizing: 'border-box', position: 'relative'
      }}>
        {dialogContent}
      </div>
    );
  }

  // Mobile: full-screen overlay with sticky mini-header
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 600, background: TH.bgCard, overflowY: 'auto'
    }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        background: TH.headerBg,
        borderBottom: '2px solid ' + TH.accent,
      }}>
        <button onClick={onClose} style={{
          border: 'none', background: 'transparent', color: TH.accent,
          fontSize: 20, cursor: 'pointer', padding: '2px 4px', lineHeight: 1
        }}>{'←'}</button>
        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontWeight: 700, fontSize: 16, color: TH.headerText, lineHeight: 1.1
        }}>
          Strive<span style={{ color: TH.accent }}>RS</span>
          <span style={{
            fontFamily: "'Inter', sans-serif", fontWeight: 400,
            fontSize: 11, color: TH.textMuted, marginLeft: 6
          }}>{'/ ' + (isCreate ? 'New Task' : 'Edit Task')}</span>
        </div>
        <div style={{ flex: 1 }} />
        {isCreate ? (
          <button onClick={handleCreate} style={{
            fontSize: 11, fontWeight: 700, padding: '5px 14px',
            border: 'none', borderRadius: 4,
            background: '#2D6A4F', color: '#FDFAF5', cursor: 'pointer'
          }}>{'+ Create'}</button>
        ) : (
          isDirty && <button onClick={handleSave} style={{
            fontSize: 11, fontWeight: 700, padding: '5px 14px',
            border: 'none', borderRadius: 4,
            background: TH.accent, color: '#FDFAF5', cursor: 'pointer'
          }}>{'✔ Save'}</button>
        )}
        <button onClick={onClose} style={{
          border: 'none', background: 'transparent', color: TH.textMuted,
          fontSize: 22, cursor: 'pointer', padding: '2px 4px', lineHeight: 1
        }}>{'×'}</button>
      </div>
      {dialogContent}
    </div>
  );
}
