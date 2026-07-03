/**
 * TaskEditFormSave — save logic extracted from TaskEditForm (999.965).
 * Handles dirty detection, field diffing, save commit, and post-save cooldown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toTime24, toDateISO, fromDateISO, parseDate, fromTime24 } from '../../scheduler/dateHelpers';
import { applyDefaults } from '../../state/constants';

export function useTaskEditFormSave({
  isCreate, task, text, project, pri, date, time, dur, timeRemaining,
  deadline, earliestStart, notes, url, when, dayReq, recurring, exactTime,
  timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools,
  marker, flexWhen, recurType, recurDays, recurTimesPerCycle, recurFillPolicy,
  recurEvery, recurUnit, recurMonthDays, taskTz, recurStart, recurEnd,
  placementMode, weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax,
  weatherHumidityMin, weatherHumidityMax, activeTimezone, onUpdate, onRecurDayConflict,
  onClose, onCreate, endTimeError, _setEndTimeError
}) {
  var [saveStatus, setSaveStatus] = useState(null);
  var [saveError, setSaveError] = useState(null);
  var firstRender = useRef(true);
  var taskSnapshotRef = useRef(null);
  var userDirtyRef = useRef(false);
  var saveCooldownRef = useRef(false);
  var pendingSyncRef = useRef(null);

  function snapshotFromTask(t) {
    return {
      text: t.text || '', project: t.project || '', pri: t.pri || 'P3',
      date: toDateISO(t.date) || '', time: toTime24(t.time) || '',
      dur: t.dur || 30, timeRemaining: t.timeRemaining != null ? t.timeRemaining : '',
      deadline: toDateISO(t.deadline) || '', earliestStart: toDateISO(t.earliestStart) || '',
      notes: t.notes || '', url: t.url || '', when: t.when || '', dayReq: t.dayReq || 'any',
      recurring: !!t.recurring, rigid: !!t.rigid,
      timeFlex: t.timeFlex != null ? t.timeFlex : null,
      split: t.split !== undefined ? !!t.split : false, splitMin: t.splitMin || 15,
      location: t.location || [], tools: t.tools || [],
      travelBefore: t.travelBefore || 0, travelAfter: t.travelAfter || 0,
      marker: !!t.marker, flexWhen: !!t.flexWhen,
      recurType: t.recur?.type || 'none', recurDays: t.recur?.days || 'MTWRF',
      recurTimesPerCycle: t.recur?.timesPerCycle || 0,
      recurFillPolicy: t.recur?.fillPolicy || 'keep',
      recurEvery: t.recur?.every || 2, recurUnit: t.recur?.unit || 'days',
      recurMonthDays: t.recur?.monthDays || [1, 15],
      tz: t.tz || activeTimezone || 'America/New_York',
      recurStart: t.recurStart || '', recurEnd: t.recurEnd || '',
      preferredTimeMins: t.preferredTimeMins != null ? t.preferredTimeMins : null,
      weatherPrecip: t.weatherPrecip || 'any', weatherCloud: t.weatherCloud || 'any',
      weatherTempMin: t.weatherTempMin != null ? t.weatherTempMin : null,
      weatherTempMax: t.weatherTempMax != null ? t.weatherTempMax : null,
      weatherHumidityMin: t.weatherHumidityMin != null ? t.weatherHumidityMin : null,
      weatherHumidityMax: t.weatherHumidityMax != null ? t.weatherHumidityMax : null,
      placementMode: t.placementMode || 'anytime'
    };
  }

  if (!taskSnapshotRef.current && !isCreate && task) {
    taskSnapshotRef.current = snapshotFromTask(task);
  }

  var buildFields = useCallback(function() {
    var d = fromDateISO(date);
    var dayName = '';
    if (d) {
      var pd = parseDate(d);
      if (pd) dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][pd.getDay()];
    }
    return {
      text, project, pri,
      date: d || '', day: dayName || '',
      time: fromTime24(time),
      dur: parseInt(dur) || 30,
      timeRemaining: timeRemaining === '' ? null : parseInt(timeRemaining),
      deadline: fromDateISO(deadline), earliestStart: fromDateISO(earliestStart),
      notes, url: (url && url.trim()) ? url.trim() : null,
      placementMode: placementMode,
      when: when, dayReq: recurring ? 'any' : dayReq,
      recurring, rigid: exactTime,
      timeFlex: placementMode === 'time_window' && time ? (timeFlex || 60) : (placementMode === 'time_window' ? null : undefined),
      split: !!split, splitMin: split ? (parseInt(splitMin) || 15) : null,
      location: taskLoc, tools: taskTools,
      travelBefore: parseInt(travelBefore) || 0, travelAfter: parseInt(travelAfter) || 0,
      marker: marker, flexWhen: flexWhen,
      recur: recurType === 'none' ? null : {
        type: recurType,
        days: recurType === 'weekly' || recurType === 'biweekly' ? recurDays : undefined,
        timesPerCycle: recurTimesPerCycle > 0 ? recurTimesPerCycle : undefined,
        fillPolicy: recurTimesPerCycle > 0 && recurFillPolicy === 'backfill' ? 'backfill' : undefined,
        every: (recurType === 'interval' || recurType === 'rolling') ? parseInt(recurEvery) || (recurType === 'rolling' ? 7 : 2) : undefined,
        unit: (recurType === 'interval' || recurType === 'rolling') ? (recurUnit || 'days') : undefined,
        monthDays: recurType === 'monthly' ? recurMonthDays : undefined
      },
      tz: taskTz, _timezone: taskTz,
      recurStart: recurring ? (recurStart || null) : null,
      recurEnd: recurring ? (recurEnd || null) : null,
      preferredTimeMins: placementMode === 'time_window' && time
        ? (function() { var parts = time.split(':'); return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10); })()
        : (placementMode === 'time_window' ? null : undefined),
      weatherPrecip, weatherCloud,
      weatherTempMin: weatherTempMin !== '' && weatherTempMin !== null ? parseInt(weatherTempMin) : null,
      weatherTempMax: weatherTempMax !== '' && weatherTempMax !== null ? parseInt(weatherTempMax) : null,
      weatherTempUnit: 'F',
      weatherHumidityMin: weatherHumidityMin !== '' && weatherHumidityMin !== null ? parseInt(weatherHumidityMin) : null,
      weatherHumidityMax: weatherHumidityMax !== '' && weatherHumidityMax !== null ? parseInt(weatherHumidityMax) : null
    };
  }, [text, project, pri, date, time, dur, timeRemaining, deadline, earliestStart, notes, url, when, dayReq, recurring, exactTime, timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools, marker, flexWhen, recurType, recurDays, recurTimesPerCycle, recurFillPolicy, recurEvery, recurUnit, recurMonthDays, taskTz, recurStart, recurEnd, placementMode, weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax, weatherHumidityMin, weatherHumidityMax]);

  var buildChangedFields = useCallback(function() {
    var all = buildFields();
    var snap = taskSnapshotRef.current;
    if (!snap) return all;
    var changed = {};
    if (text !== snap.text) changed.text = all.text;
    if (project !== snap.project) changed.project = all.project;
    if (pri !== snap.pri) changed.pri = all.pri;
    if (notes !== snap.notes) changed.notes = all.notes;
    if ((url || '') !== (snap.url || '')) changed.url = all.url;
    if (when !== snap.when) changed.when = all.when;
    var snapPlacementMode = task ? (task.placementMode || 'anytime') : 'anytime';
    if (placementMode !== snapPlacementMode) changed.placementMode = all.placementMode;
    if (dayReq !== snap.dayReq) changed.dayReq = all.dayReq;
    if (recurring !== snap.recurring) changed.recurring = all.recurring;
    if (exactTime !== snap.rigid) changed.rigid = all.rigid;
    if (parseInt(dur) !== snap.dur) changed.dur = all.dur;
    if (all.timeFlex !== snap.timeFlex && !(all.timeFlex == null && snap.timeFlex == null)) changed.timeFlex = all.timeFlex;
    if (all.preferredTimeMins !== snap.preferredTimeMins && !(all.preferredTimeMins == null && snap.preferredTimeMins == null)) changed.preferredTimeMins = all.preferredTimeMins;
    if (!!split !== snap.split) changed.split = all.split;
    if (parseInt(splitMin) !== snap.splitMin) changed.splitMin = all.splitMin;
    if (!!marker !== snap.marker) changed.marker = all.marker;
    if (!!flexWhen !== snap.flexWhen) changed.flexWhen = all.flexWhen;
    if (parseInt(travelBefore) !== snap.travelBefore) changed.travelBefore = all.travelBefore;
    if (parseInt(travelAfter) !== snap.travelAfter) changed.travelAfter = all.travelAfter;
    if (date !== (snap.date || '')) { changed.date = all.date; changed.day = all.day; }
    if (time !== (snap.time || '')) changed.time = all.time;
    if (deadline !== (snap.deadline || '')) changed.deadline = all.deadline;
    if (earliestStart !== (snap.earliestStart || '')) changed.earliestStart = all.earliestStart;
    if (taskTz !== (snap.tz || '')) { changed.tz = all.tz; changed.date = all.date; changed.day = all.day; changed.time = all.time; }
    var snapRem = snap.timeRemaining === '' ? null : parseInt(snap.timeRemaining);
    if (all.timeRemaining !== snapRem) changed.timeRemaining = all.timeRemaining;
    if (JSON.stringify(taskLoc) !== JSON.stringify(snap.location)) changed.location = all.location;
    if (JSON.stringify(taskTools) !== JSON.stringify(snap.tools)) changed.tools = all.tools;
    if (recurType !== snap.recurType || JSON.stringify(recurDays) !== JSON.stringify(snap.recurDays) || recurTimesPerCycle !== snap.recurTimesPerCycle || recurFillPolicy !== (snap.recurFillPolicy || 'keep') || String(recurEvery) !== String(snap.recurEvery) || recurUnit !== snap.recurUnit || JSON.stringify(recurMonthDays) !== JSON.stringify(snap.recurMonthDays)) {
      changed.recur = all.recur;
    }
    if (recurStart !== (snap.recurStart || '')) changed.recurStart = all.recurStart;
    if (recurEnd !== (snap.recurEnd || '')) changed.recurEnd = all.recurEnd;
    if (weatherPrecip !== (snap.weatherPrecip || 'any')) changed.weatherPrecip = all.weatherPrecip;
    if (weatherCloud !== (snap.weatherCloud || 'any')) changed.weatherCloud = all.weatherCloud;
    var snapTMin = snap.weatherTempMin != null ? snap.weatherTempMin : null;
    var snapTMax = snap.weatherTempMax != null ? snap.weatherTempMax : null;
    var curTMin = weatherTempMin !== '' ? parseInt(weatherTempMin) : null;
    var curTMax = weatherTempMax !== '' ? parseInt(weatherTempMax) : null;
    if (curTMin !== snapTMin) { changed.weatherTempMin = all.weatherTempMin; changed.weatherTempUnit = all.weatherTempUnit; }
    if (curTMax !== snapTMax) { changed.weatherTempMax = all.weatherTempMax; changed.weatherTempUnit = all.weatherTempUnit; }
    var snapHMin = snap.weatherHumidityMin != null ? snap.weatherHumidityMin : null;
    var snapHMax = snap.weatherHumidityMax != null ? snap.weatherHumidityMax : null;
    var curHMin = weatherHumidityMin !== '' ? parseInt(weatherHumidityMin) : null;
    var curHMax = weatherHumidityMax !== '' ? parseInt(weatherHumidityMax) : null;
    if (curHMin !== snapHMin) changed.weatherHumidityMin = all.weatherHumidityMin;
    if (curHMax !== snapHMax) changed.weatherHumidityMax = all.weatherHumidityMax;
    if (Object.keys(changed).length > 0) {
      changed.tz = all.tz;
      changed._timezone = all._timezone;
    }
    return Object.keys(changed).length > 0 ? changed : null;
  }, [buildFields, text, project, pri, notes, url, when, dayReq, recurring, exactTime, dur, timeRemaining, timeFlex, split, splitMin, travelBefore, travelAfter, marker, flexWhen, date, time, deadline, earliestStart, taskLoc, taskTools, recurType, recurDays, recurTimesPerCycle, recurFillPolicy, recurEvery, recurUnit, recurMonthDays, recurStart, recurEnd, placementMode, weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax, weatherHumidityMin, weatherHumidityMax]);

  var [isDirty, setIsDirty] = useState(false);
  useEffect(function() {
    if (isCreate) return;
    if (firstRender.current) { firstRender.current = false; return; }
    userDirtyRef.current = true;
    var changed = buildChangedFields();
    setIsDirty(!!changed);
  }, [text, project, pri, date, time, dur, timeRemaining, deadline, earliestStart, notes, url, when, dayReq, recurring, exactTime, timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools, marker, flexWhen, recurType, recurDays, recurTimesPerCycle, recurFillPolicy, recurEvery, recurUnit, recurMonthDays, taskTz, recurStart, recurEnd, placementMode, weatherPrecip, weatherCloud, weatherTempMin, weatherTempMax, weatherHumidityMin, weatherHumidityMax]);

  function commitSave(changed) {
    var willRegenerateInstances = changed.recur !== undefined;
    setSaveStatus('saving');
    var result = onUpdate(task.id, changed);
    Promise.resolve(result).then(function(ok) {
      if (ok === false || typeof ok === 'string') {
        setSaveStatus('failed');
        if (typeof ok === 'string') setSaveError(ok);
        setTimeout(function() { setSaveStatus(null); }, 3000);
        return;
      }
      if (willRegenerateInstances) {
        setSaveStatus('saved');
        userDirtyRef.current = false;
        setIsDirty(false);
        saveCooldownRef.current = true;
        setTimeout(function() { saveCooldownRef.current = false; }, 10000);
        setTimeout(function() {
          if (pendingSyncRef.current && !userDirtyRef.current) {
            var snap = pendingSyncRef.current;
            pendingSyncRef.current = null;
            taskSnapshotRef.current = snap;
          }
        }, 10100);
        return;
      }
      taskSnapshotRef.current = snapshotFromTask(Object.assign({}, task, buildFields()));
      userDirtyRef.current = false;
      setIsDirty(false);
      setSaveStatus('saved');
      saveCooldownRef.current = true;
      setTimeout(function() { saveCooldownRef.current = false; }, 3000);
      setTimeout(function() {
        if (pendingSyncRef.current && !userDirtyRef.current) {
          var snap = pendingSyncRef.current;
          pendingSyncRef.current = null;
          taskSnapshotRef.current = snap;
        }
      }, 3100);
      setTimeout(function() { setSaveStatus(null); }, 1500);
    });
  }

  function handleSave() {
    if (endTimeError) return;
    var changed = buildChangedFields();
    if (!changed) return;
    if (placementMode === 'fixed' && (!date || !time)) {
      setSaveError('Fixed mode requires a date and time.');
      return;
    }
    setSaveError(null);
    if (changed.date && onRecurDayConflict && task.recurring) {
      var recur = task.recur || (recurType !== 'none' ? { type: recurType, days: recurDays } : null);
      if (recur && (recur.type === 'weekly' || recur.type === 'biweekly') && recur.days) {
        var DAY_CODES = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];
        var td = parseDate(changed.date);
        if (td) {
          var dow = td.getDay();
          var dayCode = DAY_CODES[dow];
          var effectiveDays = changed.recur ? (changed.recur.days || '') : recur.days;
          if (effectiveDays.indexOf(dayCode) < 0) {
            var DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            onRecurDayConflict({
              taskId: task.id, task: task, fields: changed,
              conflict: { conflicting: true, dayCode: dayCode, dayLabel: DAY_LABELS[dow], recurDays: recur.days, recur: recur }
            });
            return;
          }
        }
      }
    }
    commitSave(changed);
  }

  function handleCreate() {
    var fields = buildFields();
    var newId = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
    var newTask = applyDefaults(Object.assign({ id: newId }, fields));
    onCreate(newTask);
    onClose();
  }

  return {
    isDirty, saveStatus, saveError, setSaveError,
    handleSave, handleCreate, buildFields, buildChangedFields,
    taskSnapshotRef, userDirtyRef, saveCooldownRef, pendingSyncRef,
    snapshotFromTask
  };
}
