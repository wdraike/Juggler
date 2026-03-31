/**
 * TaskEditForm — full editor matching the original JSX inline design
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PRI_COLORS, STATUS_OPTIONS, applyDefaults } from '../../state/constants';
import { toTime24, fromTime24, toDateISO, fromDateISO, formatDateKey, parseDate } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import { convertTimeForDisplay, getTimezoneAbbr, getUtcOffset } from '../../utils/timezone';
import ConfirmDialog from '../features/ConfirmDialog';

function HabitDeleteDialog({ taskName, onDeleteInstance, onDeleteHabit, onCancel, darkMode, isMobile }) {
  var theme = getTheme(darkMode);
  var btnBase = {
    border: 'none', borderRadius: 8, padding: '10px 16px',
    fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', width: '100%',
    textAlign: 'left', lineHeight: 1.4,
  };
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onCancel}>
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 12,
        width: isMobile ? '100%' : 360, maxWidth: isMobile ? '100%' : '90vw',
        height: isMobile ? '100%' : undefined,
        padding: 24, boxShadow: isMobile ? 'none' : ('0 8px 32px ' + theme.shadow),
        display: isMobile ? 'flex' : undefined, flexDirection: isMobile ? 'column' : undefined,
        justifyContent: isMobile ? 'center' : undefined
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 4 }}>
          Delete "{taskName.slice(0, 50)}"
        </div>
        <div style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 16 }}>
          This is a recurring habit. What would you like to delete?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <button onClick={onDeleteInstance} style={{
            ...btnBase, background: theme.bgCard, border: '1px solid ' + theme.border, color: theme.text,
          }}>
            <span style={{ fontWeight: 600 }}>Delete this instance only</span>
            <br />
            <span style={{ fontSize: 11, color: theme.textSecondary }}>Remove just today's occurrence. The habit continues.</span>
          </button>
          <button onClick={onDeleteHabit} style={{
            ...btnBase, background: theme.errorBg || '#fef2f2', border: '1px solid ' + (theme.errorBorder || '#fca5a5'), color: theme.error || '#991b1b',
          }}>
            <span style={{ fontWeight: 600 }}>Delete entire habit</span>
            <br />
            <span style={{ fontSize: 11, opacity: 0.8 }}>Remove the habit and all future instances. Completed history is kept.</span>
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            border: '1px solid ' + theme.border, borderRadius: 8, padding: '8px 20px',
            background: 'transparent', color: theme.textSecondary, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Full IANA timezone list (browser-sourced or fallback)
var ALL_TIMEZONES = (function() {
  try {
    if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch (e) { /* ignore */ }
  return [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'America/Phoenix', 'Pacific/Honolulu',
    'America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Halifax',
    'America/Mexico_City', 'America/Bogota', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
    'Europe/Amsterdam', 'Europe/Moscow', 'Europe/Istanbul',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Dubai',
    'Asia/Singapore', 'Asia/Seoul', 'Asia/Bangkok',
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
    'Pacific/Auckland', 'Pacific/Fiji',
    'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos'
  ];
})();

/**
 * TimezoneViewer — searchable timezone selector for task-level "View in..." conversion.
 * Read-only: doesn't change the task or app timezone.
 */
/**
 * TimezoneSelector — searchable timezone dropdown for the "When" section header.
 * Shows current task timezone with UTC offset. Selecting a new timezone converts
 * all date/time values in the form to the new timezone.
 */
function TimezoneSelector({ taskTz, onChangeTz, TH }) {
  var [tzSearch, setTzSearch] = React.useState('');
  var [tzOpen, setTzOpen] = React.useState(false);
  var dropdownRef = React.useRef(null);

  React.useEffect(function() {
    if (!tzOpen) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setTzOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [tzOpen]);

  var searchLower = tzSearch.toLowerCase();
  var filteredTzs = searchLower
    ? ALL_TIMEZONES.filter(function(tz) { return tz.toLowerCase().includes(searchLower); })
    : ALL_TIMEZONES;
  var displayTzs = filteredTzs.slice(0, 50);

  function selectTz(tz) {
    onChangeTz(tz);
    setTzOpen(false);
    setTzSearch('');
  }

  var tzAbbr = getTimezoneAbbr(taskTz);
  var utcOff = getUtcOffset(taskTz);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={function() { setTzOpen(!tzOpen); setTzSearch(''); }}
        style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
          border: '1px solid ' + TH.inputBorder, background: TH.inputBg, color: TH.text,
          fontFamily: 'inherit', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4
        }}
      >
        {'\uD83C\uDF10'} {tzAbbr} <span style={{ fontSize: 9, color: TH.textMuted, fontFamily: 'monospace' }}>{utcOff}</span> {'\u25BE'}
      </button>
      {tzOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 200, width: 280,
          background: TH.bgCard, border: '1px solid ' + TH.inputBorder, borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
        }}>
          <div style={{ padding: 6 }}>
            <input
              type="text" autoFocus
              value={tzSearch}
              placeholder="Search timezones..."
              onChange={function(e) { setTzSearch(e.target.value); }}
              style={{
                width: '100%', fontSize: 12, padding: '5px 8px',
                border: '1px solid ' + TH.inputBorder, borderRadius: 4,
                background: TH.inputBg, color: TH.text, boxSizing: 'border-box'
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {displayTzs.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 11, color: TH.textMuted }}>No timezones match</div>
            )}
            {displayTzs.map(function(tz) {
              var off = getUtcOffset(tz);
              var isSelected = tz === taskTz;
              return (
                <div key={tz}
                  onClick={function() { selectTz(tz); }}
                  style={{
                    padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                    background: isSelected ? TH.accent + '22' : 'transparent',
                    color: TH.text,
                    borderBottom: '1px solid ' + TH.inputBorder + '33',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}
                  onMouseEnter={function(e) { e.currentTarget.style.background = TH.accent + '15'; }}
                  onMouseLeave={function(e) { e.currentTarget.style.background = isSelected ? TH.accent + '22' : 'transparent'; }}
                >
                  <span style={{ fontWeight: isSelected ? 600 : 400 }}>{tz.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 10, color: TH.textMuted, fontFamily: 'monospace' }}>{off}</span>
                </div>
              );
            })}
            {filteredTzs.length > 50 && (
              <div style={{ padding: '6px 10px', fontSize: 10, color: TH.textMuted, textAlign: 'center' }}>
                Type to narrow {filteredTzs.length} results...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TaskEditForm({ task, status, onUpdate, onStatusChange, onDelete, onClose, onShowChain, allProjectNames, locations, tools, uniqueTags, scheduleTemplates, templateDefaults, darkMode, isMobile, mode, onCreate, initialDate, initialProject, stackIndex, onRecurDayConflict, activeTimezone }) {
  var isCreate = mode === 'create';
  var TH = getTheme(darkMode);
  var initDate = isCreate && initialDate ? toDateISO(formatDateKey(initialDate)) : '';
  var [text, setText] = useState(isCreate ? '' : (task.text || ''));
  var [project, setProject] = useState(isCreate ? (initialProject || '') : (task.project || ''));
  var [pri, setPri] = useState(isCreate ? 'P3' : (task.pri || 'P3'));
  // Task timezone: stored on the task, defaults to activeTimezone for new tasks.
  // The editor shows times in this timezone (what the user originally entered).
  var [taskTz, setTaskTz] = useState(isCreate ? (activeTimezone || 'America/New_York') : (task.tz || activeTimezone || 'America/New_York'));

  // Initialize date/time from UTC (scheduledAt) converted to taskTz.
  // Editor displays in task.tz so the user sees the time they originally entered.
  var initDateTime = React.useMemo(function() {
    if (isCreate) return { date: initDate, time: '' };
    var tz = task.tz || activeTimezone || 'America/New_York';
    if (task.scheduledAt) {
      var conv = convertTimeForDisplay(task.scheduledAt, tz);
      if (conv && conv.date) return { date: toDateISO(conv.date) || '', time: toTime24(conv.time) || '' };
    }
    return { date: toDateISO(task.date) || '', time: toTime24(task.time) || '' };
  }, []); // only on mount

  var [date, setDate] = useState(initDateTime.date);
  var [time, setTime] = useState(initDateTime.time);
  var [dur, setDur] = useState(isCreate ? 30 : (task.dur || 30));
  var [timeRemaining, setTimeRemaining] = useState(isCreate ? '' : (task.timeRemaining != null ? task.timeRemaining : ''));
  var [due, setDue] = useState(isCreate ? '' : toDateISO(task.due));
  var [startAfter, setStartAfter] = useState(isCreate ? '' : toDateISO(task.startAfter));
  var [notes, setNotes] = useState(isCreate ? '' : (task.notes || ''));
  var [when, setWhen] = useState(function() {
    if (isCreate) return 'morning,lunch,afternoon,evening';
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
  var [habit, setHabit] = useState(isCreate ? false : !!task.habit);
  var [rigid, setRigid] = useState(isCreate ? false : !!task.rigid);
  var [timeFlex, setTimeFlex] = useState(isCreate ? 60 : (task.timeFlex != null ? task.timeFlex : 60));
  var [split, setSplit] = useState(isCreate ? false : (task.split !== undefined ? task.split : false));
  var [splitMin, setSplitMin] = useState(isCreate ? 15 : (task.splitMin || 15));
  var [taskLoc, setTaskLoc] = useState(isCreate ? [] : (task.location || []));
  var [taskTools, setTaskTools] = useState(isCreate ? [] : (task.tools || []));
  var [travelBefore, setTravelBefore] = useState(isCreate ? 0 : (task.travelBefore || 0));
  var [travelAfter, setTravelAfter] = useState(isCreate ? 0 : (task.travelAfter || 0));
  var [marker, setMarker] = useState(isCreate ? false : !!task.marker);
  var [flexWhen, setFlexWhen] = useState(isCreate ? false : !!task.flexWhen);
  var [datePinned, setDatePinned] = useState(isCreate ? false : !!task.datePinned);
  var [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  var [recurType, setRecurType] = useState(isCreate ? 'none' : (task.recur?.type || 'none'));
  var [recurDays, setRecurDays] = useState(isCreate ? 'MTWRF' : (task.recur?.days || 'MTWRF'));
  var [recurEvery, setRecurEvery] = useState(isCreate ? 2 : (task.recur?.every || 2));
  var [recurUnit, setRecurUnit] = useState(isCreate ? 'days' : (task.recur?.unit || 'days'));
  var [recurMonthDays, setRecurMonthDays] = useState(isCreate ? [1, 15] : (task.recur?.monthDays || [1, 15]));

  // --- Configuration feasibility warnings ---
  var configWarnings = (function() {
    if (marker) return [];
    var warnings = [];
    var whenParts = when ? when.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var isAnytime = whenParts.length === 0 || (whenParts.length === 1 && whenParts[0] === 'anytime');
    var isAllDay = whenParts.indexOf('allday') >= 0;
    var isFixedWhen = whenParts.indexOf('fixed') >= 0;
    if (isAnytime || isAllDay || isFixedWhen) return [];
    if (!scheduleTemplates || !templateDefaults) return [];

    // Determine which day-names are eligible given dayReq
    var dayCodeMap = { Su: 'Sun', M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', Sa: 'Sat' };
    var weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var weekends = ['Sat', 'Sun'];
    var allDays = weekdays.concat(weekends);
    var eligibleDays;
    if (!dayReq || dayReq === 'any') {
      eligibleDays = allDays;
    } else if (dayReq === 'weekday') {
      eligibleDays = weekdays;
    } else if (dayReq === 'weekend') {
      eligibleDays = weekends;
    } else {
      var codes = dayReq.split(',');
      eligibleDays = codes.map(function(c) { return dayCodeMap[c]; }).filter(Boolean);
    }

    // Collect which tags exist on eligible days (including aliases)
    var tagsOnEligibleDays = {};
    eligibleDays.forEach(function(dn) {
      var tmplId = templateDefaults[dn];
      var tmpl = tmplId && scheduleTemplates[tmplId];
      if (!tmpl) return;
      (tmpl.blocks || []).forEach(function(b) {
        tagsOnEligibleDays[b.tag] = true;
        // "biz" blocks after noon also match "afternoon"
        if (b.tag === 'biz' && b.start >= 720) tagsOnEligibleDays['afternoon'] = true;
      });
    });

    // Silently strip stale when-tags that don't exist in any template
    // (scheduler handles missing tags gracefully — no warning needed)

    // Check location feasibility: if task has location constraint, check if any eligible block has a matching location
    if (taskLoc.length > 0 && whenParts.length > 0) {
      var matchingBlocks = [];
      eligibleDays.forEach(function(dn) {
        var tmplId = templateDefaults[dn];
        var tmpl = tmplId && scheduleTemplates[tmplId];
        if (!tmpl) return;
        (tmpl.blocks || []).forEach(function(b) {
          if (whenParts.indexOf(b.tag) >= 0) matchingBlocks.push(b);
        });
      });
      if (matchingBlocks.length > 0) {
        var hasLocMatch = matchingBlocks.some(function(b) {
          return taskLoc.some(function(loc) { return loc === b.loc; });
        });
        if (!hasLocMatch) {
          var blockLocs = {};
          matchingBlocks.forEach(function(b) { if (b.loc) blockLocs[b.loc] = true; });
          warnings.push('Location mismatch: task needs "' + taskLoc.join('" or "') +
            '" but matching time blocks use "' + Object.keys(blockLocs).join('", "') + '".');
        }
      }
    }

    return warnings;
  })();

  // Due date vs day requirement conflict (separate from config warnings so it always runs)
  var dueDayWarning = (function() {
    if (!due || !dayReq || dayReq === 'any') return null;
    var dueDate = parseDate(due);
    if (!dueDate) return null;
    var dueDayCode = ['Su','M','T','W','R','F','Sa'][dueDate.getDay()];
    var dueDayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dueDate.getDay()];
    var allowed;
    if (dayReq === 'weekday') allowed = ['M','T','W','R','F'];
    else if (dayReq === 'weekend') allowed = ['Su','Sa'];
    else allowed = dayReq.split(',');
    if (allowed.indexOf(dueDayCode) === -1) {
      return 'Due date (' + dueDayName + ') conflicts with day requirement \u2014 task may not be schedulable before the deadline.';
    }
    return null;
  })();
  if (dueDayWarning) configWarnings.push(dueDayWarning);

  var BTN_H = isMobile ? 30 : 26;
  var iStyle = { fontSize: isMobile ? 13 : 11, padding: isMobile ? '6px 8px' : '3px 4px', border: '1px solid ' + TH.inputBorder, borderRadius: 4, background: TH.inputBg, color: TH.inputText, fontFamily: 'inherit', height: BTN_H, boxSizing: 'border-box', maxWidth: '100%' };
  var lStyle = { fontSize: 8, color: TH.textMuted, display: 'flex', flexDirection: 'column', gap: 2, fontWeight: 600 };
  function togStyle(on, color) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + (color || TH.accent) : '1px solid ' + TH.btnBorder,
      background: on ? (color || TH.accent) + '22' : TH.bgCard,
      color: on ? (color || TH.accent) : TH.textMuted,
    };
  }
  var isFixed = !isCreate && when && when.indexOf('fixed') >= 0;
  var [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved'
  var saveTimer = useRef(null);
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
      due: toDateISO(t.due) || '', startAfter: toDateISO(t.startAfter) || '',
      notes: t.notes || '', when: t.when || '', dayReq: t.dayReq || 'any',
      habit: !!t.habit, rigid: !!t.rigid,
      timeFlex: t.timeFlex != null ? t.timeFlex : 60,
      split: t.split !== undefined ? !!t.split : false, splitMin: t.splitMin || 15,
      location: t.location || [], tools: t.tools || [],
      travelBefore: t.travelBefore || 0, travelAfter: t.travelAfter || 0,
      marker: !!t.marker,
      flexWhen: !!t.flexWhen,
      datePinned: !!t.datePinned,
      recurType: t.recur?.type || 'none', recurDays: t.recur?.days || 'MTWRF',
      recurEvery: t.recur?.every || 2, recurUnit: t.recur?.unit || 'days',
      recurMonthDays: t.recur?.monthDays || [1, 15],
      tz: t.tz || activeTimezone || 'America/New_York'
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
    setTimeRemaining(newSnap.timeRemaining); setDue(newSnap.due);
    setStartAfter(newSnap.startAfter); setNotes(newSnap.notes);
    setWhen(newSnap.when); setDayReq(newSnap.dayReq);
    setHabit(newSnap.habit); setRigid(newSnap.rigid); setTimeFlex(newSnap.timeFlex);
    setSplit(newSnap.split); setSplitMin(newSnap.splitMin);
    setTaskLoc(newSnap.location); setTaskTools(newSnap.tools);
    setTravelBefore(newSnap.travelBefore); setTravelAfter(newSnap.travelAfter);
    setMarker(newSnap.marker);
    setFlexWhen(newSnap.flexWhen);
    setDatePinned(newSnap.datePinned);
    setRecurType(newSnap.recurType); setRecurDays(newSnap.recurDays);
    setRecurEvery(newSnap.recurEvery); setRecurUnit(newSnap.recurUnit);
    setRecurMonthDays(newSnap.recurMonthDays);
    firstRender.current = true; // prevent auto-save from firing for this sync
  }, [task, isCreate]);

  var buildFields = useCallback(function() {
    var d = fromDateISO(date);
    var dayName = '';
    if (d) {
      var pd = new Date(2026, parseInt(d.split('/')[0]) - 1, parseInt(d.split('/')[1]));
      dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][pd.getDay()];
    }
    return {
      text, project, pri,
      date: d || (isCreate ? '' : task.date),
      day: dayName || (isCreate ? '' : task.day),
      time: fromTime24(time),
      dur: parseInt(dur) || 30,
      timeRemaining: timeRemaining === '' ? null : parseInt(timeRemaining),
      due: fromDateISO(due),
      startAfter: fromDateISO(startAfter),
      notes, when, dayReq, habit, rigid,
      timeFlex: habit && !rigid ? timeFlex : undefined,
      split: split || undefined,
      splitMin: split ? (parseInt(splitMin) || 15) : null,
      location: taskLoc,
      tools: taskTools,
      travelBefore: parseInt(travelBefore) || 0,
      travelAfter: parseInt(travelAfter) || 0,
      marker: marker,
      flexWhen: flexWhen,
      datePinned: datePinned,
      recur: recurType === 'none' ? null : {
        type: recurType,
        days: recurType === 'weekly' || recurType === 'biweekly' ? recurDays : undefined,
        every: recurType === 'interval' ? parseInt(recurEvery) || 2 : undefined,
        unit: recurType === 'interval' ? recurUnit : undefined,
        monthDays: recurType === 'monthly' ? recurMonthDays : undefined
      },
      tz: taskTz,
      _timezone: taskTz  // tells backend which timezone to use for date/time → UTC conversion
    };
  }, [text, project, pri, date, time, dur, timeRemaining, due, startAfter, notes, when, dayReq, habit, rigid, timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools, marker, flexWhen, datePinned, recurType, recurDays, recurEvery, recurUnit, recurMonthDays, isCreate, task, taskTz]);

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
    if (when !== snap.when) changed.when = all.when;
    if (dayReq !== snap.dayReq) changed.dayReq = all.dayReq;
    if (habit !== snap.habit) changed.habit = all.habit;
    if (rigid !== snap.rigid) changed.rigid = all.rigid;
    if (parseInt(dur) !== snap.dur) changed.dur = all.dur;
    if (timeFlex !== snap.timeFlex) changed.timeFlex = all.timeFlex;
    if (!!split !== snap.split) changed.split = all.split;
    if (parseInt(splitMin) !== snap.splitMin) changed.splitMin = all.splitMin;
    if (!!marker !== snap.marker) changed.marker = all.marker;
    if (!!flexWhen !== snap.flexWhen) changed.flexWhen = all.flexWhen;
    if (!!datePinned !== snap.datePinned) changed.datePinned = all.datePinned;
    if (parseInt(travelBefore) !== snap.travelBefore) changed.travelBefore = all.travelBefore;
    if (parseInt(travelAfter) !== snap.travelAfter) changed.travelAfter = all.travelAfter;
    // Date/time (compare in form format)
    if (date !== (snap.date || '')) { changed.date = all.date; changed.day = all.day; }
    if (time !== (snap.time || '')) changed.time = all.time;
    if (due !== (snap.due || '')) changed.due = all.due;
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
    if (recurType !== snap.recurType || recurDays !== snap.recurDays || String(recurEvery) !== String(snap.recurEvery) || recurUnit !== snap.recurUnit || JSON.stringify(recurMonthDays) !== JSON.stringify(snap.recurMonthDays)) {
      changed.recur = all.recur;
    }
    // Always include tz and _timezone when any field changed — the backend needs
    // the timezone context for date/time → UTC conversion
    if (Object.keys(changed).length > 0) {
      changed.tz = all.tz;
      changed._timezone = all._timezone;
    }
    return Object.keys(changed).length > 0 ? changed : null;
  }, [buildFields, text, project, pri, notes, when, dayReq, habit, rigid, dur, timeFlex, split, splitMin, travelBefore, travelAfter, marker, flexWhen, datePinned, date, time, due, startAfter, taskLoc, taskTools, recurType, recurDays, recurEvery, recurUnit, recurMonthDays]);

  // Dirty detection — compare current fields to snapshot
  var [isDirty, setIsDirty] = useState(false);
  useEffect(function() {
    if (isCreate) return;
    if (firstRender.current) { firstRender.current = false; return; }
    userDirtyRef.current = true;
    var changed = buildChangedFields();
    setIsDirty(!!changed);
  }, [text, project, pri, date, time, dur, timeRemaining, due, startAfter, notes, when, dayReq, habit, rigid, timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools, marker, flexWhen, datePinned, recurType, recurDays, recurEvery, recurUnit, recurMonthDays, taskTz]);

  // Manual save handler
  function handleSave() {
    var changed = buildChangedFields();
    if (!changed) return;

    // Check if a date change conflicts with recurrence days
    if (changed.date && onRecurDayConflict && task.habit) {
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
    onUpdate(task.id, changed);
    // Update snapshot so next save only sends new changes
    taskSnapshotRef.current = snapshotFromTask(Object.assign({}, task, buildFields()));
    userDirtyRef.current = false;
    setIsDirty(false);
    setSaveStatus('saved');
    // Suppress external sync for 3s after save — scheduler response shouldn't disrupt the form
    saveCooldownRef.current = true;
    setTimeout(function() { saveCooldownRef.current = false; }, 3000);
    setTimeout(function() { setSaveStatus(null); }, 1500);
  }

  function handleCreate() {
    var fields = buildFields();
    var newId = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
    var newTask = applyDefaults(Object.assign({ id: newId }, fields));
    onCreate(newTask);
    onClose();
  }

  var durOptions = [5,10,15,20,30,45,60,90,120,180,240];
  if (durOptions.indexOf(parseInt(dur)) === -1) durOptions = durOptions.concat([parseInt(dur)]);
  durOptions.sort(function(a,b) { return a - b; });

  var remOptions = [0,5,10,15,20,30,45,60,90,120,180,240];
  var remVal = timeRemaining === '' ? dur : parseInt(timeRemaining);
  if (remOptions.indexOf(remVal) === -1) remOptions = remOptions.concat([remVal]);
  if (remOptions.indexOf(parseInt(dur)) === -1) remOptions = remOptions.concat([parseInt(dur)]);
  remOptions = remOptions.filter(function(v, i, a) { return a.indexOf(v) === i; }).sort(function(a,b) { return a - b; });

  function durLabel(v) {
    if (v === 0) return 'Done (0)';
    if (v < 60) return v + ' min';
    if (v === 60) return '1 hour';
    if (v === 90) return '1.5 hrs';
    return (v/60) + ' hrs';
  }

  var hasStack = (stackIndex || 0) > 0;

  var dialogContent = (
    <>
      {/* Top bar with Save / Delete / Close */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        background: TH.badgeBg,
        padding: '8px 12px', borderBottom: '1px solid ' + TH.border
      }}>
        {isCreate ? (
          <button onClick={handleCreate} style={{
            fontSize: 10, fontWeight: 700, padding: '4px 14px', border: 'none', borderRadius: 4,
            background: '#2D6A4F', color: '#FDFAF5', cursor: 'pointer'
          }}>{'\u2795 Create'}</button>
        ) : (
          <>
            {isDirty && <button onClick={handleSave} style={{
              fontSize: 10, fontWeight: 700, padding: '4px 14px', border: 'none', borderRadius: 4,
              background: TH.accent, color: '#FDFAF5', cursor: 'pointer'
            }}>{'\uD83D\uDCBE'} Save</button>}
            {saveStatus && <span style={{
              fontSize: 10, fontWeight: 600, color: saveStatus === 'saving' ? TH.textMuted : '#2D6A4F',
              padding: '4px 8px'
            }}>{saveStatus === 'saving' ? 'Saving\u2026' : '\u2714 Saved'}</span>}
          </>
        )}
        {!isCreate && onDelete && (
          <button onClick={() => setShowDeleteConfirm(true)} style={{
            fontSize: 10, fontWeight: 600, padding: '4px 10px',
            border: '1px solid #8B2635', borderRadius: 4,
            background: TH.redBg, color: TH.redText, cursor: 'pointer'
          }}>{'\uD83D\uDDD1'} Delete</button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{
          border: 'none', background: 'transparent', color: TH.textMuted,
          fontSize: isMobile ? 24 : 16, cursor: 'pointer', padding: '2px 6px',
          minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined
        }}>&times;</button>
      </div>

      <div style={{ padding: '10px 12px', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden', overflowY: 'visible' }}>
        {/* Unplaced reason banner */}
        {!isCreate && task && task._unplacedDetail && (
          <div style={{
            fontSize: 10, padding: '6px 10px', marginBottom: 8, borderRadius: 4,
            background: TH.amberBg,
            color: TH.amberText,
            border: '1px solid ' + TH.amberBorder,
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap'
          }}>
            <span style={{ fontWeight: 600 }}>{'\u26A0'} Not placed:</span>
            <span>{task._unplacedDetail}</span>
            {task._whenBlocked && !flexWhen && (
              <button onClick={function() { setFlexWhen(true); }}
                style={{
                  fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                  border: '1px solid #C8942A', background: '#C8942A18', color: '#C8942A',
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap'
                }}>
                Enable Flex
              </button>
            )}
          </div>
        )}

        {/* Status buttons — hidden in create mode */}
        {!isCreate && <div style={{ marginBottom: 8 }}>
          <div style={{ ...lStyle, marginBottom: 3 }}>Status</div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {STATUS_OPTIONS.map(s => {
              var isActive = (status || '') === s.value;
              var sBg = darkMode ? s.bgDark : s.bg;
              var sColor = darkMode ? s.colorDark : s.color;
              return (
                <button key={s.value} onClick={() => { if (onStatusChange) onStatusChange(s.value); }} title={s.tip} style={{
                  border: '1px solid ' + (isActive ? sColor : TH.btnBorder),
                  borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                  background: isActive ? sBg : 'transparent',
                  color: isActive ? sColor : TH.textMuted,
                  fontSize: 10, fontWeight: isActive ? 700 : 500, fontFamily: 'inherit',
                  height: BTN_H, boxSizing: 'border-box'
                }}>
                  {s.label} {s.tip.split(' \u2014 ')[0]}
                </button>
              );
            })}
          </div>
        </div>}

        {/* ═══ SECTION: Task Description ═══ */}
        {(function() {
          var secStyle = { border: '1px solid ' + TH.border, borderRadius: 6, padding: '8px 10px', marginBottom: 8, maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden' };
          var secHead = { fontSize: 9, fontWeight: 700, color: TH.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 };
          return (<>

        <div style={secStyle}>
          <div style={secHead}>Task</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
            <label style={{ ...lStyle, flex: 1, minWidth: isMobile ? 0 : 200, width: isMobile ? '100%' : undefined }}>
              Name
              <input type="text" value={text} onChange={e => setText(e.target.value)}
                style={{ ...iStyle, width: '100%' }} autoFocus />
            </label>
            <label style={{ ...lStyle, width: isMobile ? '100%' : undefined }}>
              Project
              <input type="text" list="project-options" value={project}
                onChange={e => setProject(e.target.value)}
                placeholder="— none —"
                style={{ ...iStyle, width: isMobile ? '100%' : 120 }} />
              <datalist id="project-options">
                {(allProjectNames || []).map(name => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 5 }}>
            <label style={lStyle}>
              <span title="Controls scheduling order: P1 tasks are placed first and get the best time slots, then P2, P3, P4.">{'\uD83D\uDD25'} Priority</span>
              <select value={pri} onChange={e => setPri(e.target.value)} style={{ ...iStyle, minWidth: 80 }}>
                <option value="P1">{'\uD83D\uDD34'} P1 Critical</option>
                <option value="P2">{'\uD83D\uDFE0'} P2 High</option>
                <option value="P3">{'\uD83D\uDD35'} P3 Medium</option>
                <option value="P4">{'\u26AA'} P4 Low</option>
              </select>
            </label>
            <label style={lStyle}>
              <span title="Non-blocking reminder event — shows on the calendar but doesn't block time. Other tasks can overlap it.">{'\u25C7'} Reminder event</span>
              <button title={marker ? 'This is a non-blocking reminder event' : 'Make this a non-blocking reminder event'} onClick={() => setMarker(!marker)}
                style={{ ...togStyle(marker, '#4338CA'), minWidth: 50 }}>{marker ? '\u25C7 Yes' : 'No'}</button>
            </label>
            {!marker && <>
            <label style={lStyle}>
              <span title="Habits are scheduled before regular tasks and pinned to their date.">{'\uD83D\uDD01'} Habit</span>
              <button title={habit ? 'This is a recurring habit' : 'Mark as a daily habit'} onClick={() => { var next = !habit; setHabit(next); if (habit) setRigid(false); if (next) setDayReq('any'); }}
                style={{ ...togStyle(habit, '#2D6A4F'), minWidth: 50 }}>{habit ? '\uD83D\uDD01 Yes' : 'No'}</button>
            </label>
            </>}
          </div>
          {!isCreate && onShowChain && !task.habit && (
            <button onClick={onShowChain} style={{
              border: '1px solid #0EA5E9', borderRadius: 4, padding: '4px 10px',
              background: 'transparent', color: '#0EA5E9', fontSize: 10, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', width: '100%', marginBottom: 5,
              height: BTN_H, boxSizing: 'border-box'
            }}>{'\uD83D\uDD17'} Dependencies{task.dependsOn && task.dependsOn.length > 0 ? ' (' + task.dependsOn.length + ')' : ''}</button>
          )}
          <label style={lStyle}>
            <span title="Free-text notes for your reference. Not used by the scheduler.">Notes</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              style={{ ...iStyle, minHeight: 40, resize: 'vertical', width: '100%' }} />
          </label>
        </div>

        {/* ═══ SECTION: When (Scheduling) ═══ */}
        <div style={secStyle}>
          <div style={{ ...secHead, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span>When</span>
            <TimezoneSelector taskTz={taskTz} onChangeTz={changeTaskTimezone} TH={TH} />
          </div>

          {/* Date/Time + Duration + Remaining */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5, maxWidth: '100%' }}>
            <label style={{ ...lStyle, maxWidth: '100%', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span title="The date/time for this task. For fixed tasks: anchored exactly here. For pinned tasks: the scheduler keeps this date. For unpinned tasks: the scheduler may move it.">{'\uD83D\uDCC5'} Date / Time</span>
                {!isCreate && !isFixed && !marker && date && (
                  datePinned
                    ? <span style={{ fontSize: 7, color: '#D97706', fontWeight: 700 }}>{'\uD83D\uDCCC'} pinned</span>
                    : <span style={{ fontSize: 7, color: TH.muted2 }}>set by scheduler</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="datetime-local" value={date && time ? date + 'T' + time : date ? date + 'T00:00' : ''}
                  onChange={e => {
                    var v = e.target.value;
                    if (v) {
                      var parts = v.split('T');
                      setDate(parts[0]);
                      setTime(parts[1] || '');
                    } else { setDate(''); setTime(''); }
                    if (!isCreate && !isFixed) setDatePinned(!!v);
                  }}
                  style={{ ...iStyle, width: isMobile ? '100%' : undefined, minWidth: 0, ...(datePinned && date ? { borderColor: '#D97706' } : {}) }} />
                {!isCreate && !isFixed && !marker && datePinned && date && (
                  <button onClick={() => { setDatePinned(false); setDate(''); setTime(''); }} title="Let scheduler control date"
                    style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                      border: '1px solid ' + TH.btnBorder, background: TH.inputBg, color: TH.textMuted, fontWeight: 600,
                      height: BTN_H, boxSizing: 'border-box' }}>
                    Unpin
                  </button>
                )}
              </div>
            </label>
            <label style={lStyle}>
              <span title="Total time needed. The scheduler reserves this much time.">{'\u23F1'} Duration</span>
              <select value={dur} onChange={e => setDur(parseInt(e.target.value))} style={iStyle}>
                {durOptions.map(v => (
                  <option key={v} value={v}>{durLabel(v)}</option>
                ))}
              </select>
            </label>
            {!isCreate && !marker && <label style={lStyle}>
              <span title="Time left on a partially completed task.">{'\uD83D\uDCCA'} Remaining</span>
              <select value={remVal} onChange={e => setTimeRemaining(parseInt(e.target.value))}
                style={{ ...iStyle, background: remVal < parseInt(dur) ? TH.purpleBg : TH.inputBg }}>
                {remOptions.map(v => (
                  <option key={v} value={v}>{durLabel(v)}</option>
                ))}
              </select>
            </label>}
          </div>

          {/* Travel time buffers */}
          {!marker && <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
            <label style={{ ...lStyle, flex: 1, marginBottom: 0 }}>
              <span title="Travel buffer before the task — scheduler prevents overlaps">{'\uD83D\uDE97'} Travel before</span>
              <select value={travelBefore} onChange={e => setTravelBefore(parseInt(e.target.value))} style={iStyle}>
                {[0, 5, 10, 15, 20, 30, 45, 60, 90].map(v => (
                  <option key={v} value={v}>{v === 0 ? 'None' : v + ' min'}</option>
                ))}
              </select>
            </label>
            <label style={{ ...lStyle, flex: 1, marginBottom: 0 }}>
              <span title="Travel buffer after the task — scheduler prevents overlaps">Travel after</span>
              <select value={travelAfter} onChange={e => setTravelAfter(parseInt(e.target.value))} style={iStyle}>
                {[0, 5, 10, 15, 20, 30, 45, 60, 90].map(v => (
                  <option key={v} value={v}>{v === 0 ? 'None' : v + ' min'}</option>
                ))}
              </select>
            </label>
          </div>}

          {/* When mode selector — hidden for markers */}
          {!marker && <label style={{ ...lStyle, marginBottom: 5 }}>
            <span title="Controls which time blocks the scheduler can use.">{'\uD83D\uDCC6'} Scheduling mode</span>
            {(function() {
              var parts = when ? when.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
              var isAllDay = parts.indexOf('allday') !== -1;
              var isFixed = parts.indexOf('fixed') !== -1;
              // Window tags are everything that isn't a mode keyword
              var tagParts = parts.filter(function(p) { return p !== 'anytime' && p !== 'allday' && p !== 'fixed'; });
              var isWindows = tagParts.length > 0;
              var isAnytime = !isAllDay && !isFixed && !isWindows;
              return (
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                  <button title="No time restriction — the scheduler can place this in any available slot" onClick={function() { setWhen(''); }}
                    style={togStyle(isAnytime, '#2D6A4F')}>{'\uD83D\uDD04'} Anytime</button>
                  <button title="Spans the entire day" onClick={function() { setWhen('allday'); }}
                    style={togStyle(isAllDay, '#C8942A')}>{'\u2600\uFE0F'} All Day</button>
                  <button title="Locked to the exact Date/Time. The scheduler will never move it" onClick={function() { setWhen('fixed'); }}
                    style={togStyle(isFixed, '#8B2635')}>{'\uD83D\uDCCC'} Fixed</button>
                  <span style={{ width: 1, height: 18, background: TH.border, margin: '0 2px' }} />
                  {(uniqueTags || []).map(function(tb) {
                    var isOn = tagParts.indexOf(tb.tag) !== -1;
                    return (
                      <button key={tb.tag} title={tb.name + ' time window — selecting any window disables Anytime'} onClick={function() {
                        if (isAllDay || isFixed) {
                          // Switch from allday/fixed to this single window
                          setWhen(tb.tag);
                        } else {
                          var cur = tagParts.slice();
                          if (isOn) { cur = cur.filter(function(v) { return v !== tb.tag; }); }
                          else { cur.push(tb.tag); }
                          setWhen(cur.length === 0 ? '' : cur.join(','));
                        }
                      }} style={{
                        ...togStyle(isOn && !isAllDay && !isFixed, tb.color),
                        opacity: isAllDay || isFixed ? 0.4 : 1
                      }}>{tb.icon} {tb.name}</button>
                    );
                  })}
                  {isWindows && <>
                    <span style={{ width: 1, height: 18, background: TH.border, margin: '0 2px' }} />
                    <button title={flexWhen ? 'Flex: scheduler tries other slots if selected windows are full' : 'Strict: only placed in selected windows'}
                      onClick={function() { setFlexWhen(!flexWhen); }}
                      style={togStyle(flexWhen, '#C8942A')}>
                      {flexWhen ? '~ Flex' : 'Strict'}
                    </button>
                  </>}
                </div>
              );
            })()}
          </label>}

          {/* Day requirement */}
          {!marker && (
          <label style={{ ...lStyle, marginBottom: 5 }}>
            <span title="Restrict which days the scheduler can place this task.">Day requirement</span>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <button title="No day restriction" onClick={function() { setDayReq('any'); }}
                style={togStyle(dayReq === 'any', '#2D6A4F')}>Any</button>
              <button title="Monday through Friday only" onClick={function() { setDayReq(dayReq === 'weekday' ? 'any' : 'weekday'); }}
                style={togStyle(dayReq === 'weekday', '#4338CA')}>Wkday</button>
              <button title="Saturday or Sunday only" onClick={function() { setDayReq(dayReq === 'weekend' ? 'any' : 'weekend'); }}
                style={togStyle(dayReq === 'weekend', '#4338CA')}>Wkend</button>
              {[['Su','Su'],['M','Mo'],['T','Tu'],['W','We'],['R','Th'],['F','Fr'],['Sa','Sa']].map(function(pair) {
                var code = pair[0], label = pair[1];
                var selected = dayReq ? dayReq.split(',') : [];
                var isOn = selected.indexOf(code) >= 0;
                return (
                  <button key={code} title={({Su:'Sunday',M:'Monday',T:'Tuesday',W:'Wednesday',R:'Thursday',F:'Friday',Sa:'Saturday'})[code]}
                    onClick={function() {
                      var cur = dayReq && dayReq !== 'any' && dayReq !== 'weekday' && dayReq !== 'weekend' ? dayReq.split(',') : [];
                      if (isOn) { cur = cur.filter(function(v) { return v !== code; }); }
                      else { cur.push(code); }
                      setDayReq(cur.length === 0 ? 'any' : cur.join(','));
                    }}
                    style={togStyle(isOn)}>{label}</button>
                );
              })}
            </div>
          </label>)}

          {/* Time drift — scaled by recurrence frequency */}
          {!marker && habit && (function() {
            var driftOptions;
            if (recurType === 'monthly' || (recurType === 'interval' && (recurUnit === 'months' || recurUnit === 'years'))) {
              driftOptions = [
                { value: 0, label: '0 (rigid)' },
                { value: 1440, label: '1 day' },
                { value: 2880, label: '2 days' },
                { value: 4320, label: '3 days' },
                { value: 7200, label: '5 days' },
                { value: 10080, label: '7 days' },
              ];
            } else if (recurType === 'weekly' || recurType === 'biweekly' || (recurType === 'interval' && recurUnit === 'weeks')) {
              driftOptions = [
                { value: 0, label: '0 (rigid)' },
                { value: 60, label: '1 hr' },
                { value: 120, label: '2 hr' },
                { value: 240, label: '4 hr' },
                { value: 480, label: '8 hr' },
                { value: 1440, label: '1 day' },
                { value: 2880, label: '2 days' },
              ];
            } else if (recurType === 'interval' && recurUnit === 'days' && recurEvery <= 7) {
              driftOptions = [
                { value: 0, label: '0 (rigid)' },
                { value: 60, label: '1 hr' },
                { value: 120, label: '2 hr' },
                { value: 240, label: '4 hr' },
                { value: 480, label: '8 hr' },
                { value: 1440, label: '1 day' },
                { value: 2880, label: '2 days' },
              ];
            } else {
              // daily, none, or short interval
              driftOptions = [
                { value: 0, label: '0 (rigid)' },
                { value: 15, label: '15 min' },
                { value: 30, label: '30 min' },
                { value: 60, label: '1 hr' },
                { value: 90, label: '1.5 hr' },
                { value: 120, label: '2 hr' },
                { value: 180, label: '3 hr' },
                { value: 240, label: '4 hr' },
              ];
            }
            var maxDrift = driftOptions[driftOptions.length - 1].value;
            var currentVal = rigid ? 0 : timeFlex;
            // Clamp if current value exceeds max for this recurrence
            if (currentVal > maxDrift && !rigid) {
              setTimeFlex(maxDrift);
              currentVal = maxDrift;
            }
            // Ensure current value appears in options
            var hasVal = driftOptions.some(function(o) { return o.value === currentVal; });
            if (!hasVal && currentVal > 0) {
              // Snap to nearest lower option
              var snapped = 0;
              driftOptions.forEach(function(o) { if (o.value <= currentVal) snapped = o.value; });
              setTimeFlex(snapped);
              currentVal = snapped;
            }
            return (
              <label style={{ ...lStyle, marginBottom: 5 }}>
                <span title="How far from the preferred time the scheduler can shift this habit. 0 = locked to exact time.">{'\u00B1'} Time drift</span>
                <select value={currentVal} onChange={e => {
                  var v = parseInt(e.target.value);
                  if (v === 0) { setRigid(true); } else { setRigid(false); setTimeFlex(v); }
                }} style={{ ...iStyle, minWidth: 90 }}>
                  {driftOptions.map(function(o) {
                    return <option key={o.value} value={o.value}>{o.label}</option>;
                  })}
                </select>
              </label>
            );
          })()}

          {/* Due + Start after + Split — hidden for markers */}
          {!marker && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5, alignItems: 'flex-end', maxWidth: '100%' }}>
            <label style={lStyle}>
              <span title="Hard deadline. The scheduler places this task before this date.">{'\uD83D\uDCC6'} Due</span>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <input type="date" value={due || ''}
                  onChange={e => setDue(e.target.value || '')}
                  style={{ ...iStyle, minWidth: 0, flex: 1, ...(due ? { background: TH.amberBg } : {}) }} />
                {due && (
                  <button onClick={() => setDue('')} style={{
                    fontSize: 9, background: 'none', border: 'none', color: TH.redText,
                    cursor: 'pointer', padding: 0, fontWeight: 700
                  }}>{'\u2715'}</button>
                )}
              </div>
            </label>
            <label style={lStyle}>
              <span title="Earliest date this task can be scheduled.">{'\u23F3'} Start after</span>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <input type="date" value={startAfter || ''}
                  onChange={e => setStartAfter(e.target.value || '')}
                  style={{ ...iStyle, minWidth: 0, flex: 1, ...(startAfter ? { background: TH.blueBg } : {}) }} />
                {startAfter && (
                  <button onClick={() => setStartAfter('')} style={{
                    fontSize: 9, background: 'none', border: 'none', color: TH.redText,
                    cursor: 'pointer', padding: 0, fontWeight: 700
                  }}>{'\u2715'}</button>
                )}
              </div>
            </label>
            <label style={lStyle}>
              <span title="Allow the scheduler to break this task into smaller chunks.">{'\u2702'} Split OK</span>
              <button title={split ? 'Task can be split into chunks' : 'Task must be scheduled as one block'} onClick={() => setSplit(!split)}
                style={togStyle(split, '#2D6A4F')}>{split ? '\u2702 Yes' : 'No'}</button>
            </label>
            {split && (
              <label style={lStyle}>
                <span title="Smallest chunk when splitting.">Min block</span>
                <select value={splitMin} onChange={e => setSplitMin(parseInt(e.target.value))}
                  style={{ ...iStyle, width: 'auto', minWidth: 60 }}>
                  {[15,20,30,45,60].map(v => (
                    <option key={v} value={v}>{v < 60 ? v + 'm' : '1h'}</option>
                  ))}
                </select>
              </label>
            )}
          </div>}

          {/* Recurrence */}
          {!marker &&
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <label style={lStyle}>
              <span title="Automatically generate copies of this task on a schedule.">{'\uD83D\uDD01'} Recurrence</span>
              <select value={recurType} onChange={e => { setRecurType(e.target.value); if (e.target.value === 'weekly' || e.target.value === 'biweekly') setDayReq('any'); }} style={iStyle}>
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly (pick days)</option>
                <option value="interval">Every N (days/wks/mo/yr)</option>
              </select>
            </label>
            {(recurType === 'weekly' || recurType === 'biweekly') && (
              <label style={lStyle}>
                Days
                <div style={{ display: 'flex', gap: 3 }}>
                  {[['U','Su'],['M','Mo'],['T','Tu'],['W','We'],['R','Th'],['F','Fr'],['S','Sa']].map(function(pair) {
                    var code = pair[0], label = pair[1];
                    var active = recurDays.includes(code);
                    return (
                      <button key={code} onClick={function() {
                        setRecurDays(active ? recurDays.replace(code, '') : recurDays + code);
                      }} style={togStyle(active)}>{label}</button>
                    );
                  })}
                </div>
              </label>
            )}
            {recurType === 'monthly' && (
              <label style={lStyle}>
                Days of month
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: 260 }}>
                  {[['first', '1st'], ['last', 'Last']].concat(
                    Array.from({ length: 28 }, function(_, i) { return [String(i + 1), String(i + 1)]; })
                  ).map(function(pair) {
                    var val = pair[0], label = pair[1];
                    var active = recurMonthDays.indexOf(val) >= 0 || recurMonthDays.indexOf(Number(val)) >= 0;
                    return (
                      <button key={val} onClick={function() {
                        setRecurMonthDays(function(prev) {
                          var norm = prev.map(String);
                          var sv = String(val);
                          return norm.indexOf(sv) >= 0 ? prev.filter(function(d) { return String(d) !== sv; }) : prev.concat([val]);
                        });
                      }} style={{ ...togStyle(active), minWidth: label.length > 2 ? 32 : 22, fontSize: 9 }}>{label}</button>
                    );
                  })}
                </div>
              </label>
            )}
            {recurType === 'interval' && (
              <label style={lStyle}>
                Interval
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: TH.text }}>Every</span>
                  <input type="number" value={recurEvery} onChange={e => setRecurEvery(e.target.value)} min={1}
                    style={{ ...iStyle, width: 50 }} />
                  <select value={recurUnit} onChange={e => setRecurUnit(e.target.value)} style={{ ...iStyle, width: 'auto' }}>
                    <option value="days">day(s)</option>
                    <option value="weeks">week(s)</option>
                    <option value="months">month(s)</option>
                    <option value="years">year(s)</option>
                  </select>
                </div>
              </label>
            )}
          </div>}

          {/* Configuration warnings */}
          {configWarnings.length > 0 && (
            <div style={{ background: TH.amberBg, border: '1px solid ' + TH.amberBorder, borderRadius: 4, padding: '4px 8px', marginTop: 5, fontSize: 10, color: TH.amberText, lineHeight: 1.4 }}>
              {configWarnings.map(function(w, i) {
                return <div key={i}>{'\u26A0\uFE0F'} {w}</div>;
              })}
            </div>
          )}
        </div>

        {/* ═══ SECTION: Where & Tools ═══ */}
        {!marker &&
        <div style={secStyle}>
          <div style={secHead}>Where & Tools</div>
          <label style={{ ...lStyle, marginBottom: 5 }}>
            <span title="Where this task can be done. The scheduler only places it where you're at a matching location.">{'\uD83D\uDCCD'} Location</span>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
              <button onClick={() => setTaskLoc([])} title="Task can be done at any location"
                style={togStyle(taskLoc.length === 0, '#2D6A4F')}>{'\uD83C\uDF0D'} Anywhere</button>
              {(locations || []).map(loc => {
                var isOn = taskLoc.indexOf(loc.id) !== -1;
                var anywhere = taskLoc.length === 0;
                return (
                  <button key={loc.id} title={'Restrict to ' + loc.name} onClick={() => {
                    if (anywhere) { setTaskLoc([loc.id]); }
                    else { setTaskLoc(isOn ? taskLoc.filter(x => x !== loc.id) : [...taskLoc, loc.id]); }
                  }} style={{
                    ...togStyle(isOn && !anywhere),
                    opacity: anywhere ? 0.4 : 1,
                  }}>{loc.icon} {loc.name}</button>
                );
              })}
            </div>
          </label>
          <label style={lStyle}>
            <span title="Equipment required. The scheduler checks which tools are at each location.">{'\uD83D\uDD27'} Tools needed</span>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
              {(tools || []).map(tool => {
                var isOn = taskTools.indexOf(tool.id) !== -1;
                return (
                  <button key={tool.id} title={'Requires ' + tool.name} onClick={() => {
                    setTaskTools(isOn ? taskTools.filter(x => x !== tool.id) : [...taskTools, tool.id]);
                  }} style={togStyle(isOn)}>{tool.icon} {tool.name}</button>
                );
              })}
            </div>
          </label>
        </div>}

        {/* (Dependencies moved into Task section above) */}

          </>);
        })()}
      </div>

      {showDeleteConfirm && (
        task.habit || task.taskType === 'habit_instance' || task.taskType === 'habit_template' || task.sourceId || task.source_id ? (
          <HabitDeleteDialog
            taskName={task.text || 'this habit'}
            onDeleteInstance={() => { onDelete(task.id); onClose(); }}
            onDeleteHabit={() => { onDelete(task.id, { cascade: 'habit' }); onClose(); }}
            onCancel={() => setShowDeleteConfirm(false)}
            darkMode={darkMode}
            isMobile={isMobile}
          />
        ) : (
          <ConfirmDialog
            message={'Delete "' + (task.text || 'this task').slice(0, 60) + '"?'}
            onConfirm={() => { onDelete(task.id); onClose(); }}
            onCancel={() => setShowDeleteConfirm(false)}
            darkMode={darkMode}
            isMobile={isMobile}
          />
        )
      )}
    </>
  );

  // Sidebar mode (desktop): render inline, no overlay
  if (!isMobile) {
    return (
      <div style={{
        height: '100%', overflowX: 'hidden', overflowY: 'auto',
        background: TH.bgCard, boxSizing: 'border-box'
      }}>
        {dialogContent}
      </div>
    );
  }

  // Mobile: full-screen overlay
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 600, background: TH.bgCard, overflowY: 'auto'
    }}>
      {dialogContent}
    </div>
  );
}
