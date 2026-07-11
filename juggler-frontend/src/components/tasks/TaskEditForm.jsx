/**
 * TaskEditForm — thin orchestrator over extracted sub-components (999.965).
 *
 * Sections (WhenSection, WhereSection, WeatherSection, ToolsSection,
 * DependsOnSection, MetaSection) are already extracted. The save logic,
 * config warnings, and badge helpers are now in separate files.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CAL_PROVIDER_NAMES } from '../../state/constants';
import { toTime24, toDateISO, formatDateKey, fromTime24, parseDate } from '../../scheduler/dateHelpers';
import { isAnchorDependentRecur, nextMatchingDate } from '../../scheduler/expandRecurring';
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
import { useTaskEditFormSave } from './TaskEditFormSave';
import { useConfigWarnings } from './TaskEditFormWarnings';
import TaskEditFormMobileHeader from './TaskEditFormMobileHeader';

var WEATHER_PRECIP_ICONS = { wet_ok: '\u{1F327}\uFE0F', light_ok: '\u{1F302}', dry_only: '\u2600\uFE0F' };
var WEATHER_CLOUD_ICONS = { overcast_ok: '\u2601\uFE0F', partly_ok: '\u{1F324}\uFE0F', clear: '\u2600\uFE0F' };

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

export default function TaskEditForm({ task, status, onUpdate, onStatusChange, onDelete, onClose, onShowChain, allProjectNames, allTasks, locations, tools, uniqueTags, scheduleTemplates, templateDefaults, calSyncSettings, darkMode, isMobile, mode, onCreate, initialDate, initialProject, stackIndex, onRecurDayConflict, activeTimezone, tempUnitPref }) {
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
  var [taskTz, setTaskTz] = useState(isCreate ? (activeTimezone || 'America/New_York') : (task.tz || activeTimezone || 'America/New_York'));

  var initDateTime = React.useMemo(function() {
    if (isCreate) return { date: initDate, time: '' };
    if (task.recurring && task.preferredTimeMins != null) {
      var h = Math.floor(task.preferredTimeMins / 60);
      var m = task.preferredTimeMins % 60;
      var time24 = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
      var tz = task.tz || activeTimezone || 'America/New_York';
      var dateStr = '';
      if (task.scheduledAt) {
        var conv = convertTimeForDisplay(task.scheduledAt, tz);
        if (conv && conv.date) dateStr = toDateISO(conv.date) || '';
      }
      return { date: dateStr, time: time24 };
    }
    var tz2 = task.tz || activeTimezone || 'America/New_York';
    if (task.scheduledAt) {
      var conv2 = convertTimeForDisplay(task.scheduledAt, tz2);
      if (conv2 && conv2.date) return { date: toDateISO(conv2.date) || '', time: toTime24(conv2.time) || '' };
    }
    return { date: toDateISO(task.date) || '', time: toTime24(task.time) || '' };
  }, []);

  var [date, setDate] = useState(initDateTime.date);
  var [time, setTime] = useState(initDateTime.time);
  var [dur, setDur] = useState(isCreate ? 30 : (task.dur || 30));
  var [endTime, setEndTime] = useState(function() {
    var initDur = isCreate ? 30 : (task.dur || 30);
    return initDateTime.time ? addMinutesTo24h(initDateTime.time, initDur) : '';
  });
  var [endTimeError, setEndTimeError] = useState(null);
  var [timeRemaining, setTimeRemaining] = useState(isCreate ? '' : (task.timeRemaining != null ? task.timeRemaining : ''));
  var [deadline, setDeadline] = useState(isCreate ? '' : toDateISO(task.deadline));
  var [earliestStart, setEarliestStart] = useState(isCreate ? '' : toDateISO(task.earliestStart));
  var [notes, setNotes] = useState(isCreate ? '' : (task.notes || ''));
  var [url, setUrl] = useState(isCreate ? '' : (task.url || ''));
  var [when, setWhen] = useState(function() {
    if (isCreate) return '';
    var raw = task.when || '';
    var special = ['anytime', 'allday', 'fixed'];
    if (!raw || special.indexOf(raw) >= 0) return raw;
    var knownTags = {};
    (uniqueTags || []).forEach(function(tb) { knownTags[tb.tag] = true; });
    if (Object.keys(knownTags).length === 0) return raw;
    var cleaned = raw.split(',').map(function(s) { return s.trim(); }).filter(function(t) {
      return special.indexOf(t) >= 0 || knownTags[t];
    });
    return cleaned.length > 0 ? cleaned.join(',') : raw;
  });

  function changeTaskTimezone(newTz) {
    if (newTz === taskTz) return;
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
  var [recurring, setRecurring] = useState(isCreate ? false : !!task.recurring);
  // 999.1241: `task.rigid` never arrives from the API (column dropped
  // 20260526000000) — exactTime is purely local UI state for WhenSection's
  // time-flex select and is not sent in the save payload.
  var [exactTime, setExactTime] = useState(false);
  var [timeFlex, setTimeFlex] = useState(isCreate ? 60 : (task.timeFlex != null ? task.timeFlex : 60));
  var [split, setSplit] = useState(isCreate ? false : (task.split !== undefined ? task.split : false));
  var [splitMin, setSplitMin] = useState(isCreate ? 15 : (task.splitMin || 15));
  var [taskLoc, setTaskLoc] = useState(isCreate ? [] : (task.location || []));
  var [taskTools, setTaskTools] = useState(isCreate ? [] : (task.tools || []));
  var [travelBefore, setTravelBefore] = useState(isCreate ? 0 : (task.travelBefore || 0));
  var [travelAfter, setTravelAfter] = useState(isCreate ? 0 : (task.travelAfter || 0));
  var [flexWhen, setFlexWhen] = useState(isCreate ? false : !!task.flexWhen);
  var [weatherPrecip, setWeatherPrecip] = useState(isCreate ? 'any' : (task.weatherPrecip || 'any'));
  var [weatherCloud, setWeatherCloud]   = useState(isCreate ? 'any' : (task.weatherCloud  || 'any'));
  var [weatherTempMin, setWeatherTempMin] = useState(isCreate ? '' : (task.weatherTempMin != null ? String(task.weatherTempMin) : ''));
  var [weatherTempMax, setWeatherTempMax] = useState(isCreate ? '' : (task.weatherTempMax != null ? String(task.weatherTempMax) : ''));
  var [weatherHumidityMin, setWeatherHumidityMin] = useState(isCreate ? '' : (task.weatherHumidityMin != null ? String(task.weatherHumidityMin) : ''));
  var [weatherHumidityMax, setWeatherHumidityMax] = useState(isCreate ? '' : (task.weatherHumidityMax != null ? String(task.weatherHumidityMax) : ''));
  var [recurType, setRecurType] = useState(isCreate ? 'none' : (task.recur?.type || 'none'));
  var [recurDays, setRecurDays] = useState(isCreate ? 'MTWRF' : (function() {
    var raw = task.recur?.days;
    if (!raw) return 'MTWRF';
    if (typeof raw === 'object' && !Array.isArray(raw)) return Object.keys(raw).join('');
    return String(raw);
  })());
  var [recurTimesPerCycle, setRecurTimesPerCycle] = useState(isCreate ? 0 : (task.recur?.timesPerCycle || 0));
  var [recurFillPolicy, setRecurFillPolicy] = useState(isCreate ? 'keep' : (task.recur?.fillPolicy || 'keep'));
  var [recurEvery, setRecurEvery] = useState(isCreate ? 2 : (task.recur?.every || 2));
  var [recurUnit, setRecurUnit] = useState(isCreate ? 'days' : (task.recur?.unit || 'days'));
  var [recurMonthDays, setRecurMonthDays] = useState(isCreate ? [1, 15] : (task.recur?.monthDays || [1, 15]));
  var [recurStart, setRecurringStart] = useState(isCreate ? '' : (task.recurStart || ''));
  var [recurEnd, setRecurringEnd] = useState(isCreate ? '' : (task.recurEnd || ''));
  // 999.1110 (David 2026-07-04): the recurrence anchor — 'Next Cycle Starts' —
  // is user-editable. next_start is the single unified anchor column for every
  // recur type (rolling_anchor / next_occurrence_anchor were dropped — see
  // juggler-anchor-column-cleanup leg).
  var [nextStart, setNextStart] = useState(isCreate ? '' : (function() {
    var v = task.nextStart;
    return v ? String(v).slice(0, 10) : '';
  })());
  var [nextStartNotice, setNextStartNotice] = useState(null);

  // 999.1110 VALIDATION (David confirmed): for pattern-recur types the chosen
  // date MUST be snapped to a date the master's own recur pattern actually
  // allows — reuse nextMatchingDate/matchesRecurrenceDay from shared
  // expandRecurring (the same predicate the backend's next-occurrence-anchor.js
  // calls) rather than accepting an arbitrary date. Rolling has no calendar
  // pattern, so any date is valid there.
  function handleNextStartChange(val) {
    setNextStartNotice(null);
    if (!val || recurType === 'none' || recurType === 'rolling') {
      setNextStart(val || '');
      return;
    }
    var recur = {
      type: recurType,
      days: recurDays,
      timesPerCycle: recurTimesPerCycle > 0 ? recurTimesPerCycle : undefined,
      every: parseInt(recurEvery) || undefined,
      unit: recurUnit || undefined,
      monthDays: recurType === 'monthly' ? recurMonthDays : undefined
    };
    // nextMatchingDate walks strictly AFTER its afterDateKey, so start the walk
    // one day before the chosen date — if the chosen date itself matches the
    // pattern it comes back unchanged, otherwise we snap forward.
    var chosen = parseDate(val);
    if (!chosen) { setNextStart(val); return; }
    chosen.setDate(chosen.getDate() - 1);
    var phaseAnchor = nextStart || recurStart || val; // biweekly parity epoch
    var snapped = nextMatchingDate(recur, formatDateKey(chosen), phaseAnchor);
    if (snapped && snapped !== val) {
      setNextStartNotice('Adjusted to ' + snapped + ' — the next date this task’s repeat pattern allows.');
    }
    setNextStart(snapped || val);
  }

  var recurIsAnchorDependent = React.useMemo(function() {
    if (!recurring || recurType === 'none') return false;
    return isAnchorDependentRecur({
      type: recurType, days: recurDays, timesPerCycle: recurTimesPerCycle,
      every: recurEvery, unit: recurUnit, monthDays: recurMonthDays
    });
  }, [recurring, recurType, recurDays, recurTimesPerCycle, recurEvery, recurUnit, recurMonthDays]);

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

  var [hasPreferredTime, setRecurringHasPreferredTime] = useState(function() {
    if (isCreate) return false;
    if (!recurring || !task) return false;
    return task.placementMode === 'time_window';
  });

  var [placementMode, setPlacementMode] = useState(function() {
    if (isCreate) return 'anytime';
    if (!task) return 'anytime';
    return task.placementMode || 'anytime';
  });

  function handleModeChange(mode) {
    var wasAllDay = placementMode === 'all_day';
    var isAllDay = mode === 'all_day';
    if (wasAllDay !== isAllDay) {
      setTime('');
      setEndTime('');
      setDur('');
    }
    setPlacementMode(mode);
    setRecurringHasPreferredTime(mode === 'time_window');
  }

  // `marker` (BUG 999.1000) is derived from placementMode, not separate state:
  // placement_mode='reminder' is the single source of truth server-side (the
  // `marker` DB column was dropped; tasks_v derives it). The ◇ toggle drives
  // placementMode directly so the save payload carries the authoritative field.
  var marker = placementMode === 'reminder';
  function handleMarkerChange(next) {
    setPlacementMode(next ? 'reminder' : 'anytime');
  }

  // Sync form state from task prop when it changes externally
  useEffect(function() {
    if (isCreate || !task) return;
    var newSnap = save.snapshotFromTask(task);
    var oldSnap = save.taskSnapshotRef.current;
    if (!oldSnap || JSON.stringify(newSnap) === JSON.stringify(oldSnap)) {
      save.taskSnapshotRef.current = newSnap;
      return;
    }
    if (save.userDirtyRef.current) return;
    if (save.saveCooldownRef.current) {
      save.pendingSyncRef.current = newSnap;
      save.taskSnapshotRef.current = newSnap;
      return;
    }
    save.taskSnapshotRef.current = newSnap;
    setText(newSnap.text); setProject(newSnap.project); setPri(newSnap.pri);
    setDate(newSnap.date); setTime(newSnap.time); setDur(newSnap.dur);
    setEndTime(newSnap.time ? addMinutesTo24h(newSnap.time, newSnap.dur || 0) : '');
    setEndTimeError(null);
    setTimeRemaining(newSnap.timeRemaining); setDeadline(newSnap.deadline);
    setEarliestStart(newSnap.earliestStart); setNotes(newSnap.notes);
    setUrl(newSnap.url || '');
    setWhen(newSnap.when); setDayReq(newSnap.dayReq);
    setRecurringHasPreferredTime(newSnap.placementMode === 'time_window');
    // 999.1241: `rigid` was dropped from the snapshot (dead column) — reset the
    // local exact-time UI state instead of reading a field that no longer exists.
    setRecurring(newSnap.recurring); setExactTime(false); setTimeFlex(newSnap.timeFlex);
    setSplit(newSnap.split); setSplitMin(newSnap.splitMin);
    setTaskLoc(newSnap.location); setTaskTools(newSnap.tools);
    setTravelBefore(newSnap.travelBefore); setTravelAfter(newSnap.travelAfter);
    setPlacementMode(newSnap.placementMode);
    setFlexWhen(newSnap.flexWhen);
    setRecurType(newSnap.recurType); setRecurDays(newSnap.recurDays); setRecurTimesPerCycle(newSnap.recurTimesPerCycle || 0);
    setRecurFillPolicy(newSnap.recurFillPolicy || 'keep');
    setRecurEvery(newSnap.recurEvery); setRecurUnit(newSnap.recurUnit);
    setRecurMonthDays(newSnap.recurMonthDays);
    setRecurringStart(newSnap.recurStart); setRecurringEnd(newSnap.recurEnd);
    setNextStart(newSnap.nextStart || ''); setNextStartNotice(null);
    setWeatherPrecip(newSnap.weatherPrecip || 'any');
    setWeatherCloud(newSnap.weatherCloud   || 'any');
    setWeatherTempMin(newSnap.weatherTempMin != null ? String(newSnap.weatherTempMin) : '');
    setWeatherTempMax(newSnap.weatherTempMax != null ? String(newSnap.weatherTempMax) : '');
    setWeatherHumidityMin(newSnap.weatherHumidityMin != null ? String(newSnap.weatherHumidityMin) : '');
    setWeatherHumidityMax(newSnap.weatherHumidityMax != null ? String(newSnap.weatherHumidityMax) : '');
  }, [task, isCreate]);

  var save = useTaskEditFormSave({
    isCreate, task, text, project, pri, date, time, dur, timeRemaining,
    deadline, earliestStart, notes, url, when, dayReq, recurring,
    timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools,
    flexWhen, recurType, recurDays, recurTimesPerCycle, recurFillPolicy,
    recurEvery, recurUnit, recurMonthDays, taskTz, recurStart, recurEnd, nextStart,
    placementMode, weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax,
    weatherHumidityMin, weatherHumidityMax, activeTimezone, onUpdate,
    onRecurDayConflict, onClose, onCreate, endTimeError, setEndTimeError
  });

  function handleRecurTypeChange(val) {
    setRecurType(val);
    if (val === 'none') { setRecurring(false); setExactTime(false); }
    else { setRecurring(true); setSplit(false); setDayReq('any'); }
  }

  var { configWarnings, whenParts, isAllDay, isFixed } = useConfigWarnings({
    marker, when, placementMode, scheduleTemplates, templateDefaults, dayReq, taskLoc, deadline, date, time
  });

  var whereBadge = taskLoc.length > 0 ? iconBadge(taskLoc, locations || []) : null;
  var weatherBadgeParts = [];
  if (weatherPrecip && weatherPrecip !== 'any') weatherBadgeParts.push(WEATHER_PRECIP_ICONS[weatherPrecip] || '');
  if (weatherCloud && weatherCloud !== 'any') weatherBadgeParts.push(WEATHER_CLOUD_ICONS[weatherCloud] || '');
  if (weatherTempMin || weatherTempMax) weatherBadgeParts.push((weatherTempMin || '?') + '\u2013' + (weatherTempMax || '?') + '\u00B0');
  if (weatherHumidityMin || weatherHumidityMax) weatherBadgeParts.push('\u{1F4A7}' + (weatherHumidityMin || '?') + '\u2013' + (weatherHumidityMax || '?') + '%');
  var weatherBadge = weatherBadgeParts.length > 0 ? weatherBadgeParts.join(' ') : null;
  var toolsBadge = taskTools.length > 0 ? iconBadge(taskTools, tools || []) : null;

  var whenBadge = placementMode === 'all_day' && date
    ? date + ' \u00B7 All Day'
    : date && time
      ? date + ' \u00B7 ' + (fromTime24(time) || time) + (endTime ? '\u2013' + (fromTime24(endTime) || endTime) : '')
      : null;

  var dialogContent = (
    <>
      <TaskDetailHeader
        task={task} isCreate={isCreate} isMobile={isMobile} TH={TH} darkMode={darkMode}
        isDirty={save.isDirty} saveStatus={save.saveStatus} onSave={save.handleSave} onCreate={save.handleCreate}
        onClose={onClose} onDelete={onDelete} calSyncSettings={calSyncSettings}
        status={status} onStatusChange={onStatusChange}
        text={text} onTextChange={setText}
        project={project} onProjectChange={setProject} allProjectNames={allProjectNames}
        pri={pri} onPriChange={setPri} dur={dur}
        notes={notes} onNotesChange={setNotes} url={url} onUrlChange={setUrl}
        marker={marker} onMarkerChange={handleMarkerChange}
        scheduledBadge={whenBadge}
        unplacedDetail={!isCreate && task && task._unplacedDetail ? task._unplacedDetail : null}
        whenBlocked={!isCreate && task && task._whenBlocked && !flexWhen}
        onEnableFlex={function() { setFlexWhen(true); }}
      />

      {marker && !isCreate && task && task.calSyncOrigin && task.calSyncOrigin !== 'juggler' && (
        <div style={{ fontSize: 10, color: TH.amberText, margin: '8px 0 4px', fontWeight: 500, background: TH.amberBg, border: '1px solid ' + TH.amberBorder, borderRadius: 4, padding: '4px 8px' }}>
          {'\u{1F4C5} Calendar reminder from ' + (task.calSyncOrigin === 'apple' && task.appleCalendarName ? CAL_PROVIDER_NAMES.apple + ': ' + (task.appleCalendarName.length > 30 ? task.appleCalendarName.slice(0, 28) + '\u2026' : task.appleCalendarName) : (CAL_PROVIDER_NAMES[task.calSyncOrigin] || task.calSyncOrigin)) + ' \u2014 managed externally.'}
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
            recurring={recurring} rigid={exactTime} onRigidChange={setExactTime}
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
            nextStart={nextStart} onNextStartChange={handleNextStartChange}
            nextStartNotice={nextStartNotice}
            recurIsAnchorDependent={recurIsAnchorDependent}
            configWarnings={configWarnings}
            deadline={deadline} onDeadlineChange={setDeadline}
            earliestStart={earliestStart} onEarliestStartChange={setEarliestStart}
            split={split} onSplitChange={setSplit} splitMin={splitMin} onSplitMinChange={setSplitMin}
            travelBefore={travelBefore} onTravelBeforeChange={setTravelBefore}
            travelAfter={travelAfter} onTravelAfterChange={setTravelAfter}
            marker={marker} onMarkerChange={handleMarkerChange}
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
          {save.saveError && (
            <div role="alert" style={{ fontSize: 11, color: TH.redText, background: TH.redBg, border: '1px solid ' + TH.redBorder, borderRadius: 4, padding: '4px 8px', marginTop: 4 }}>
              {save.saveError}
            </div>
          )}
        </CollapsibleSection>
      )}

      {!marker && placementMode !== 'all_day' && (
        <CollapsibleSection id="where" label="Where" isOpen={!!collapse.where}
          onToggle={toggleCollapse} badge={whereBadge} TH={TH}>
          <WhereSection locations={locations} taskLoc={taskLoc} onChange={setTaskLoc} TH={TH} isMobile={isMobile} />
        </CollapsibleSection>
      )}

      {!marker && placementMode !== 'all_day' && (
        <CollapsibleSection id="weather" label="Weather" isOpen={!!collapse.weather}
          onToggle={toggleCollapse} badge={weatherBadge} TH={TH}>
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
          onToggle={toggleCollapse} badge={toolsBadge} TH={TH}>
          <ToolsSection tools={tools} taskTools={taskTools} onChange={setTaskTools} TH={TH} isMobile={isMobile} />
        </CollapsibleSection>
      )}

      {!isCreate && onShowChain && (
        <CollapsibleSection id="deps" label="Depends On" isOpen={!!collapse.deps}
          onToggle={toggleCollapse}
          badge={task && task.dependsOn && task.dependsOn.length > 0 ? task.dependsOn.length + ' dep' + (task.dependsOn.length > 1 ? 's' : '') : null}
          TH={TH}>
          <DependsOnSection task={task} onShowChain={onShowChain} TH={TH} isMobile={isMobile} allTasks={allTasks} onUpdate={onUpdate} />
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

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 600, background: TH.bgCard, overflowY: 'auto'
    }}>
      <TaskEditFormMobileHeader
        isCreate={isCreate} TH={TH} onClose={onClose}
        isDirty={save.isDirty} handleSave={save.handleSave} handleCreate={save.handleCreate}
      />
      {dialogContent}
    </div>
  );
}
