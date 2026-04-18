/**
 * TaskEditForm — full editor matching the original JSX inline design
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PRI_COLORS, STATUS_OPTIONS, applyDefaults } from '../../state/constants';
import { toTime24, fromTime24, toDateISO, fromDateISO, formatDateKey, parseDate } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import { convertTimeForDisplay, getTimezoneAbbr, getUtcOffset } from '../../utils/timezone';
import ConfirmDialog from '../features/ConfirmDialog';
import apiClient from '../../services/apiClient';

// "hh:mm" (24h) + delta minutes → "hh:mm" (24h). Clamps to the day [00:00, 23:59].
// Used by the start/finish/duration three-way binding below.
function addMinutesTo24h(hhmm, mins) {
  if (!hhmm) return '';
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10); if (isNaN(h)) return '';
  var m = parseInt(parts[1], 10); if (isNaN(m)) m = 0;
  var total = h * 60 + m + (Number(mins) || 0);
  if (total < 0) total = 0;
  if (total > 23 * 60 + 59) total = 23 * 60 + 59;
  var nh = Math.floor(total / 60), nm = total % 60;
  return (nh < 10 ? '0' : '') + nh + ':' + (nm < 10 ? '0' : '') + nm;
}

function minutesFrom24h(hhmm) {
  if (!hhmm) return null;
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10); if (isNaN(h)) return null;
  var m = parseInt(parts[1], 10); if (isNaN(m)) m = 0;
  return h * 60 + m;
}

function RecurringDeleteDialog({ taskName, onSkipInstance, onDeleteSeries, onCancel, darkMode, isMobile }) {
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
          This is a recurring task. What would you like to do?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <button onClick={onSkipInstance} style={{
            ...btnBase, background: theme.bgCard, border: '1px solid ' + theme.border, color: theme.text,
          }}>
            <span style={{ fontWeight: 600 }}>{'\u23ED'} Skip this instance</span>
            <br />
            <span style={{ fontSize: 11, color: theme.textSecondary }}>Mark this occurrence as skipped. The recurring task continues.</span>
          </button>
          <button onClick={onDeleteSeries} style={{
            ...btnBase, background: theme.errorBg || '#fef2f2', border: '1px solid ' + (theme.errorBorder || '#fca5a5'), color: theme.error || '#991b1b',
          }}>
            <span style={{ fontWeight: 600 }}>{'\uD83D\uDDD1'} Delete entire series</span>
            <br />
            <span style={{ fontSize: 11, opacity: 0.8 }}>Remove the recurring task and all future instances. Completed history is kept.</span>
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

export default function TaskEditForm({ task, status, onUpdate, onStatusChange, onDelete, onClose, onShowChain, allProjectNames, locations, tools, uniqueTags, scheduleTemplates, templateDefaults, calSyncSettings, darkMode, isMobile, mode, onCreate, initialDate, initialProject, stackIndex, onRecurDayConflict, activeTimezone }) {
  var isCreate = mode === 'create';
  var TH = getTheme(darkMode);
  var initDate = isCreate && initialDate ? toDateISO(formatDateKey(initialDate)) : '';
  var [text, setText] = useState(isCreate ? '' : (task.text || ''));
  var [project, setProject] = useState(isCreate ? (initialProject || '') : (task.project || ''));
  var [pri, setPri] = useState(isCreate ? 'P3' : (task.pri || 'P3'));
  // Task timezone: stored on the task, defaults to activeTimezone for new tasks.
  // The editor shows times in this timezone (what the user originally entered).
  var [taskTz, setTaskTz] = useState(isCreate ? (activeTimezone || 'America/New_York') : (task.tz || activeTimezone || 'America/New_York'));

  // Initialize date/time from task data.
  // For recurring Time Window mode: derive time from preferredTimeMins (minutes since
  // midnight, local tz — no timezone conversion needed).
  // For all other tasks: convert scheduledAt (UTC) to display timezone.
  var initDateTime = React.useMemo(function() {
    if (isCreate) return { date: initDate, time: '' };
    // Recurring Time Window: use preferredTimeMins directly (no tz conversion)
    if (task.recurring && task.preferredTime && task.preferredTimeMins != null) {
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
  var [when, setWhen] = useState(function() {
    if (isCreate) return 'morning,lunch,afternoon,evening,night';
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
  // For recurring instances: the template's anchor date (separate from this instance's date)
  // anchorDate from API is YYYY-MM-DD (date-only)
  var [anchorDate, setAnchorDate] = useState(isCreate ? '' : (task.anchorDate || ''));
  var [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  var [recurType, setRecurType] = useState(isCreate ? 'none' : (task.recur?.type || 'none'));
  var [recurDays, setRecurDays] = useState(isCreate ? 'MTWRF' : (function() {
    var raw = task.recur?.days;
    if (!raw) return 'MTWRF';
    // Normalize object format back to string for backward compat
    if (typeof raw === 'object' && !Array.isArray(raw)) return Object.keys(raw).join('');
    return String(raw);
  })());
  var [recurTimesPerCycle, setRecurTimesPerCycle] = useState(isCreate ? 0 : (task.recur?.timesPerCycle || 0)); // 0 = all selected days
  var [recurEvery, setRecurEvery] = useState(isCreate ? 2 : (task.recur?.every || 2));
  var [recurUnit, setRecurUnit] = useState(isCreate ? 'days' : (task.recur?.unit || 'days'));
  var [recurMonthDays, setRecurMonthDays] = useState(isCreate ? [1, 15] : (task.recur?.monthDays || [1, 15]));
  var [recurStart, setRecurringStart] = useState(isCreate ? '' : (task.recurStart || ''));
  var [recurEnd, setRecurringEnd] = useState(isCreate ? '' : (task.recurEnd || ''));

  // --- Recurring preferred-time toggle ---
  // For recurringTasks: does the user want a specific preferred time (fixed ± window)
  // or flexible block-based scheduling?
  var [hasPreferredTime, setRecurringHasPreferredTime] = useState(function() {
    if (isCreate) return false;
    if (!recurring || !task) return false;
    // Use explicit preferredTime flag if persisted; fall back to tag-count heuristic
    if (task.preferredTime != null) return !!task.preferredTime;
    var w = task.when || '';
    if (!w || w === 'fixed' || w === 'allday' || w === 'anytime') return false;
    var tags = w.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    return tags.length === 1;
  });

  // --- Derived scheduling mode flags (used for field disable logic) ---
  var whenParts = when ? when.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var isAllDay = whenParts.indexOf('allday') !== -1;
  var isFixed = !!datePinned;
  // Calendar-linked fixed tasks are pinned by the external calendar. Stripping
  // 'fixed' from them creates a contradiction the backend guard will reject,
  // so the When-mode selector locks those buttons out entirely.
  var isCalLinkedFixed = isFixed && !!(task && (task.gcalEventId || task.msftEventId || task.appleEventId));
  var isRigid = recurring && rigid;
  // Split is allowed for non-recurring tasks (except all-day / fixed) and for
  // recurring tasks only in Time Blocks mode (not Time Window, not rigid).
  // For recurring Time Blocks, the scheduler enforces that chunks stay on
  // the instance's assigned day — chunks that don't fit are dropped, not
  // rolled to the next day. See the hint below the split toggle.
  var disSplit = isAllDay || isFixed || (recurring && (hasPreferredTime || rigid));

  // --- Configuration feasibility warnings ---
  var configWarnings = (function() {
    if (marker) return [];
    var warnings = [];
    var isAnytime = whenParts.length === 0 || (whenParts.length === 1 && whenParts[0] === 'anytime');
    if (isAnytime || isAllDay || isFixed) return [];
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

  // Deadline vs day requirement conflict (separate from config warnings so it always runs)
  var deadlineDayWarning = (function() {
    if (!deadline || !dayReq || dayReq === 'any') return null;
    var deadlineDate = parseDate(deadline);
    if (!deadlineDate) return null;
    var deadlineDayCode = ['Su','M','T','W','R','F','Sa'][deadlineDate.getDay()];
    var deadlineDayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][deadlineDate.getDay()];
    var allowed;
    if (dayReq === 'weekday') allowed = ['M','T','W','R','F'];
    else if (dayReq === 'weekend') allowed = ['Su','Sa'];
    else allowed = dayReq.split(',');
    if (allowed.indexOf(deadlineDayCode) === -1) {
      return 'Deadline (' + deadlineDayName + ') conflicts with day requirement \u2014 task may not be schedulable before the deadline.';
    }
    return null;
  })();
  if (deadlineDayWarning) configWarnings.push(deadlineDayWarning);

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
      deadline: toDateISO(t.deadline) || '', startAfter: toDateISO(t.startAfter) || '',
      notes: t.notes || '', when: t.when || '', dayReq: t.dayReq || 'any',
      recurring: !!t.recurring, rigid: !!t.rigid,
      timeFlex: t.timeFlex != null ? t.timeFlex : null,
      split: t.split !== undefined ? !!t.split : false, splitMin: t.splitMin || 15,
      location: t.location || [], tools: t.tools || [],
      travelBefore: t.travelBefore || 0, travelAfter: t.travelAfter || 0,
      marker: !!t.marker,
      flexWhen: !!t.flexWhen,
      datePinned: !!t.datePinned,
      anchorDate: t.anchorDate || '',
      recurType: t.recur?.type || 'none', recurDays: t.recur?.days || 'MTWRF', recurTimesPerCycle: t.recur?.timesPerCycle || 0,
      recurEvery: t.recur?.every || 2, recurUnit: t.recur?.unit || 'days',
      recurMonthDays: t.recur?.monthDays || [1, 15],
      tz: t.tz || activeTimezone || 'America/New_York',
      recurStart: t.recurStart || '', recurEnd: t.recurEnd || '',
      preferredTime: t.preferredTime != null ? !!t.preferredTime : null,
      preferredTimeMins: t.preferredTimeMins != null ? t.preferredTimeMins : null
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
    setWhen(newSnap.when); setDayReq(newSnap.dayReq);
    // Re-derive scheduling mode from synced value
    var syncTags = (newSnap.when || '').split(',').filter(Boolean);
    setRecurringHasPreferredTime(newSnap.preferredTime != null ? newSnap.preferredTime : (syncTags.length === 1 && newSnap.recurring));
    setRecurring(newSnap.recurring); setRigid(newSnap.rigid); setTimeFlex(newSnap.timeFlex);
    setSplit(newSnap.split); setSplitMin(newSnap.splitMin);
    setTaskLoc(newSnap.location); setTaskTools(newSnap.tools);
    setTravelBefore(newSnap.travelBefore); setTravelAfter(newSnap.travelAfter);
    setMarker(newSnap.marker);
    setFlexWhen(newSnap.flexWhen);
    setDatePinned(newSnap.datePinned);
    setAnchorDate(newSnap.anchorDate);
    setRecurType(newSnap.recurType); setRecurDays(newSnap.recurDays); setRecurTimesPerCycle(newSnap.recurTimesPerCycle || 0);
    setRecurEvery(newSnap.recurEvery); setRecurUnit(newSnap.recurUnit);
    setRecurMonthDays(newSnap.recurMonthDays);
    setRecurringStart(newSnap.recurStart); setRecurringEnd(newSnap.recurEnd);
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
      date: d || '',
      day: dayName || '',
      time: fromTime24(time),
      dur: parseInt(dur) || 30,
      timeRemaining: timeRemaining === '' ? null : parseInt(timeRemaining),
      deadline: fromDateISO(deadline),
      startAfter: fromDateISO(startAfter),
      notes,
      // Recurring tasks: auto-derive when/dayReq/rigid from mode
      when: when,  // preserved as-is: single tag = time-window mode, multi = time-blocks mode
      dayReq: recurring ? 'any' : dayReq,  // recurringTasks derive days from recurrence, not dayReq
      recurring, rigid: recurring && hasPreferredTime && time ? false : rigid,
      timeFlex: recurring && hasPreferredTime && time ? (timeFlex || 60) : (recurring && !rigid ? timeFlex : undefined),
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
        timesPerCycle: recurTimesPerCycle > 0 ? recurTimesPerCycle : undefined,
        every: recurType === 'interval' ? parseInt(recurEvery) || 2 : undefined,
        unit: recurType === 'interval' ? recurUnit : undefined,
        monthDays: recurType === 'monthly' ? recurMonthDays : undefined
      },
      tz: taskTz,
      _timezone: taskTz,  // tells backend which timezone to use for date/time → UTC conversion
      recurStart: recurring ? (recurStart || null) : null,
      recurEnd: recurring ? (recurEnd || null) : null,
      preferredTime: recurring ? hasPreferredTime : undefined,
      // preferredTimeMins: minutes since midnight from 24h time input (no tz conversion)
      preferredTimeMins: recurring && hasPreferredTime && time ? (function() {
        var parts = time.split(':');
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
      })() : undefined
    };
  }, [text, project, pri, date, time, dur, timeRemaining, deadline, startAfter, notes, when, dayReq, recurring, rigid, timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools, marker, flexWhen, datePinned, recurType, recurDays, recurTimesPerCycle, recurEvery, recurUnit, recurMonthDays, isCreate, task, taskTz, recurStart, recurEnd, hasPreferredTime]);

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
    if (when !== snap.when) {
      changed.when = all.when;
      // If the user is removing the 'fixed' tag, mark this edit as an explicit
      // When unpinning a calendar-linked task, send _allowUnfix so the backend
      // guard allows it through.
      if (snap.datePinned && !all.datePinned) changed._allowUnfix = true;
    }
    if (recurring && hasPreferredTime !== snap.preferredTime) changed.preferredTime = all.preferredTime;
    if (dayReq !== snap.dayReq) changed.dayReq = all.dayReq;
    if (recurring !== snap.recurring) changed.recurring = all.recurring;
    if (rigid !== snap.rigid) changed.rigid = all.rigid;
    if (parseInt(dur) !== snap.dur) changed.dur = all.dur;
    if (timeFlex !== snap.timeFlex) changed.timeFlex = all.timeFlex;
    if (all.preferredTimeMins !== snap.preferredTimeMins) changed.preferredTimeMins = all.preferredTimeMins;
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
    if (recurType !== snap.recurType || JSON.stringify(recurDays) !== JSON.stringify(snap.recurDays) || recurTimesPerCycle !== snap.recurTimesPerCycle || String(recurEvery) !== String(snap.recurEvery) || recurUnit !== snap.recurUnit || JSON.stringify(recurMonthDays) !== JSON.stringify(snap.recurMonthDays)) {
      changed.recur = all.recur;
    }
    // Anchor date (template's anchor, separate from instance date)
    if (anchorDate !== (snap.anchorDate || '')) changed.anchorDate = fromDateISO(anchorDate);
    // Recurring date range
    if (recurStart !== (snap.recurStart || '')) changed.recurStart = all.recurStart;
    if (recurEnd !== (snap.recurEnd || '')) changed.recurEnd = all.recurEnd;
    // Always include tz and _timezone when any field changed — the backend needs
    // the timezone context for date/time → UTC conversion
    if (Object.keys(changed).length > 0) {
      changed.tz = all.tz;
      changed._timezone = all._timezone;
    }
    return Object.keys(changed).length > 0 ? changed : null;
  }, [buildFields, text, project, pri, notes, when, dayReq, recurring, rigid, dur, timeFlex, split, splitMin, travelBefore, travelAfter, marker, flexWhen, datePinned, date, time, deadline, startAfter, taskLoc, taskTools, recurType, recurDays, recurTimesPerCycle, recurEvery, recurUnit, recurMonthDays, recurStart, recurEnd, hasPreferredTime, anchorDate]);

  // Dirty detection — compare current fields to snapshot
  var [isDirty, setIsDirty] = useState(false);
  useEffect(function() {
    if (isCreate) return;
    if (firstRender.current) { firstRender.current = false; return; }
    userDirtyRef.current = true;
    var changed = buildChangedFields();
    console.log('[DIRTY]', !!changed, changed ? Object.keys(changed) : 'null', 'when=' + when, 'snapWhen=' + (taskSnapshotRef.current ? taskSnapshotRef.current.when : '?'));
    setIsDirty(!!changed);
  }, [text, project, pri, date, time, dur, timeRemaining, deadline, startAfter, notes, when, dayReq, recurring, rigid, timeFlex, split, splitMin, travelBefore, travelAfter, taskLoc, taskTools, marker, flexWhen, datePinned, recurType, recurDays, recurTimesPerCycle, recurEvery, recurUnit, recurMonthDays, taskTz, recurStart, recurEnd, hasPreferredTime, anchorDate]);

  // Manual save handler
  // Unpin: revert a drag-pinned task to scheduler control.
  // For recurring instances: deletes the instance so the scheduler regenerates it.
  var isPinned = !isCreate && task && task.prevWhen != null;
  function handleUnpin() {
    if (!task) return;
    var isRecurringInstance = task.taskType === 'recurring_instance' && task.sourceId;
    // Optimistic update: flip UI state immediately, let the scheduler's final
    // placement arrive via SSE. For recurring instances, the row is deleted
    // server-side, so close the form now.
    if (isRecurringInstance) {
      if (onClose) onClose();
    } else if (onUpdate) {
      onUpdate(task.id, { when: task.prevWhen || '', datePinned: false, prevWhen: null });
    }
    apiClient.put('/tasks/' + task.id + '/unpin').catch(function(err) {
      console.error('Unpin failed:', err);
    });
  }

  function handleSave() {
    // Suppress save while the start/finish pair is invalid — keeps the user's
    // typed bad value visible so they can correct it without losing state.
    if (endTimeError) return;
    var changed = buildChangedFields();
    if (!changed) return;

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
    console.log('[SAVE] commitSave for', task.id, 'changed keys:', Object.keys(changed), 'when:', changed.when);
    // Anchor date or recurrence changes regenerate instances (new IDs) — close form after save
    var willRegenerateInstances = changed.anchorDate !== undefined || changed.recur !== undefined;
    setSaveStatus('saving');
    var result = onUpdate(task.id, changed);
    // Wait for the API call to confirm before showing "Saved"
    Promise.resolve(result).then(function(ok) {
      if (ok === false) {
        setSaveStatus('failed');
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
              fontSize: 10, fontWeight: 600,
              color: saveStatus === 'failed' ? '#8B2635' : saveStatus === 'saving' ? TH.textMuted : '#2D6A4F',
              padding: '4px 8px'
            }}>{saveStatus === 'saving' ? 'Saving\u2026' : saveStatus === 'failed' ? '\u2716 Save failed' : '\u2714 Saved'}</span>}
          </>
        )}
        <div style={{ flex: 1 }} />
        {!isCreate && onDelete && (() => {
          // Hide delete for calendar-linked tasks when provider is in ingest-only mode
          var css = calSyncSettings || {};
          var isIngestBlocked = (task.gcalEventId && css.gcal && css.gcal.mode === 'ingest')
                             || (task.msftEventId && css.msft && css.msft.mode === 'ingest');
          if (isIngestBlocked) {
            return <span style={{ fontSize: 10, color: TH.textMuted, fontStyle: 'italic' }} title="This event is managed by your calendar. Delete it there instead.">Calendar event</span>;
          }
          return (
            <button onClick={() => setShowDeleteConfirm(true)} style={{
              fontSize: 10, fontWeight: 600, padding: '4px 10px',
              border: '1px solid #8B2635', borderRadius: 4,
              background: TH.redBg, color: TH.redText, cursor: 'pointer'
            }}>{'\uD83D\uDDD1'} Delete</button>
          );
        })()}
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
            {/* Recurring toggle removed — recurrence drives recurring status automatically */}
          </div>
          {!isCreate && onShowChain && !task.recurring && (
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

          {/* === RECURRING MODE: Fixed time ±window  OR  Time blocks === */}
          {recurring && !marker && (
            <div style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
                <button onClick={function() {
                  setRecurringHasPreferredTime(true);
                  // Derive single when-tag from time or default to 'morning'
                  var tags = (when || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
                  if (tags.length !== 1) setWhen('morning');
                }} style={togStyle(hasPreferredTime, '#C8942A')}>{'\u23F0'} Time window</button>
                <button onClick={function() {
                  setRecurringHasPreferredTime(false);
                  setTime('');
                  // Rigid is a Time Window concept (exact time, no \u00B1 flex).
                  // Clear it when leaving that mode so the split toggle is
                  // reachable and the meaning of "rigid" doesn't leak.
                  setRigid(false);
                  var tags = (when || '').split(',').filter(Boolean);
                  if (tags.length <= 1) setWhen('morning,lunch,afternoon,evening,night');
                }} style={togStyle(!hasPreferredTime, '#2D6A4F')}>{'\uD83D\uDCC6'} Time blocks</button>
              </div>

              {hasPreferredTime ? (
                /* Fixed time mode: time + ± window on one row */
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label style={lStyle}>
                    <span>{'\u23F0'} Time</span>
                    <input type="time" value={time || ''}
                      onChange={e => setTime(e.target.value || '')}
                      style={{ ...iStyle, minWidth: 90 }} />
                  </label>
                  <label style={lStyle}>
                    <span>{'\u00B1'} Window</span>
                    {(function() {
                      var opts = [
                        { value: 0, label: 'exact' },
                        { value: 15, label: '\u00b115m' },
                        { value: 30, label: '\u00b130m' },
                        { value: 60, label: '\u00b11hr' },
                        { value: 90, label: '\u00b11.5hr' },
                        { value: 120, label: '\u00b12hr' },
                      ];
                      var val = rigid ? 0 : (timeFlex || 60);
                      return (
                        <select value={val} onChange={e => {
                          var v = parseInt(e.target.value);
                          if (v === 0) { setRigid(true); setTimeFlex(0); } else { setRigid(false); setTimeFlex(v); }
                        }} style={{ ...iStyle, minWidth: 80 }}>
                          {opts.map(function(o) { return <option key={o.value} value={o.value}>{o.label}</option>; })}
                        </select>
                      );
                    })()}
                  </label>
                </div>
              ) : (
                /* Time blocks mode: block buttons + flex toggle */
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(uniqueTags || []).map(function(tb) {
                    var tagParts2 = when ? when.split(',').map(function(s) { return s.trim(); }) : [];
                    var isOn = tagParts2.indexOf(tb.tag) !== -1;
                    return (
                      <button key={tb.tag} title={tb.name + ' time window'} onClick={function() {
                        var cur = when ? when.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s && s !== 'fixed' && s !== 'allday' && s !== 'anytime'; }) : [];
                        if (isOn) { cur = cur.filter(function(v) { return v !== tb.tag; }); }
                        else { cur.push(tb.tag); }
                        setWhen(cur.length === 0 ? '' : cur.join(','));
                      }} style={togStyle(isOn, tb.color)}>{tb.icon} {tb.name}</button>
                    );
                  })}
                  {/* Flex toggle removed — if selected blocks are full, recurring goes unplaced
                       with a clear diagnostic. User can add more blocks explicitly. */}
                </div>
              )}
            </div>
          )}

          {/* Recurring instance: show read-only scheduled date/time from the scheduler */}
          {recurring && !isCreate && !marker && task.scheduledAt && (
            <div style={{ fontSize: 11, color: TH.textMuted, marginBottom: 5, padding: '4px 8px', background: TH.inputBg, borderRadius: 4, border: '1px solid ' + TH.border }}>
              {'\uD83D\uDCC5'} Scheduled: <span style={{ color: TH.text, fontWeight: 600 }}>{(function() {
                // Format the instance's actual scheduled date/time (from scheduler, not desired)
                var tz = task.tz || activeTimezone || 'America/New_York';
                var conv = convertTimeForDisplay(task.scheduledAt, tz);
                if (!conv || !conv.date) return 'Not scheduled';
                var d = toDateISO(conv.date);
                var t = toTime24(conv.time);
                if (!d) return 'Not scheduled';
                var dt = new Date(d + 'T' + (t || '00:00'));
                var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                var dayName = dayNames[dt.getDay()];
                var month = monthNames[dt.getMonth()];
                var day = dt.getDate();
                var h = dt.getHours(), m = dt.getMinutes();
                var ampm = h >= 12 ? 'PM' : 'AM';
                var h12 = h % 12 || 12;
                var timeStr = t ? (h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm) : '';
                return dayName + ', ' + month + ' ' + day + (timeStr ? ' at ' + timeStr : '');
              })()}</span>
              {isPinned ? (
                <span style={{ marginLeft: 6 }}>
                  <span style={{ fontSize: 9, color: '#D97706' }}>{'\uD83D\uDCCC'} pinned</span>
                  <button onClick={handleUnpin} style={{
                    fontSize: 9, marginLeft: 6, padding: '1px 6px', borderRadius: 3,
                    background: TH.inputBg, border: '1px solid ' + TH.border, color: TH.redText,
                    cursor: 'pointer', fontWeight: 600
                  }}>{task.taskType === 'recurring_instance' ? 'Reset to template' : 'Unpin'}</button>
                </span>
              ) : (
                <span style={{ color: TH.muted2, marginLeft: 6, fontSize: 9 }}>set by scheduler</span>
              )}
            </div>
          )}

          {/* Recurring instance: note when scheduler moved it from intended time */}
          {recurring && !isCreate && task.desiredAt && task.scheduledAt && task.desiredAt !== task.scheduledAt && (function() {
            var tz = task.tz || activeTimezone || 'America/New_York';
            var intended = convertTimeForDisplay(task.desiredAt, tz);
            var scheduled = convertTimeForDisplay(task.scheduledAt, tz);
            if (!intended || !intended.time || !scheduled || intended.time === scheduled.time) return null;
            return <div style={{ fontSize: 10, color: TH.textMuted, marginBottom: 5 }}>
              Moved: {intended.time} {'\u2192'} <span style={{ color: TH.text }}>{scheduled.time}</span>
            </div>;
          })()}

          {/* Non-recurring pinned task: show unpin option */}
          {!recurring && !isCreate && isPinned && (
            <div style={{ fontSize: 11, color: '#D97706', marginBottom: 5, padding: '4px 8px', background: TH.inputBg, borderRadius: 4, border: '1px solid #D97706', display: 'flex', alignItems: 'center', gap: 6 }}>
              {'\uD83D\uDCCC'} Pinned by drag
              <button onClick={handleUnpin} style={{
                fontSize: 9, padding: '1px 8px', borderRadius: 3,
                background: TH.inputBg, border: '1px solid ' + TH.border, color: TH.text,
                cursor: 'pointer', fontWeight: 600
              }}>Unpin — let scheduler control</button>
            </div>
          )}

          {/* === NON-RECURRING: Original Date/Time field === */}
          {!recurring && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5, maxWidth: '100%' }}>
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
                {isAllDay ? (
                  <input type="date" value={date || ''}
                    onChange={e => {
                      setDate(e.target.value || '');
                      setTime('');
                      if (!isCreate && !isFixed) setDatePinned(!!e.target.value);
                    }}
                    style={{ ...iStyle, width: isMobile ? '100%' : undefined, minWidth: 0, ...(datePinned && date ? { borderColor: '#D97706' } : {}) }} />
                ) : (
                  <input type="datetime-local" value={date && time ? date + 'T' + time : date ? date + 'T00:00' : ''}
                    onChange={e => {
                      var v = e.target.value;
                      if (v) {
                        var parts = v.split('T');
                        setDate(parts[0]);
                        var newStart = parts[1] || '';
                        setTime(newStart);
                        // Keep finish in sync: shift finish by the same delta as start,
                        // preserving the current duration. Clears any stale validation error.
                        if (newStart) setEndTime(addMinutesTo24h(newStart, dur));
                        setEndTimeError(null);
                      } else { setDate(''); setTime(''); setEndTime(''); setEndTimeError(null); }
                      if (!isCreate && !isFixed) setDatePinned(!!v);
                    }}
                    style={{ ...iStyle, width: isMobile ? '100%' : undefined, minWidth: 0, ...(datePinned && date ? { borderColor: '#D97706' } : {}) }} />
                )}
                {!isCreate && !isFixed && !marker && datePinned && date && (
                  <button onClick={() => { setDatePinned(false); setDate(''); setTime(''); setEndTime(''); setEndTimeError(null); }} title="Let scheduler control date"
                    style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                      border: '1px solid ' + TH.btnBorder, background: TH.inputBg, color: TH.textMuted, fontWeight: 600,
                      height: BTN_H, boxSizing: 'border-box' }}>
                    Unpin
                  </button>
                )}
              </div>
            </label>
            {!isAllDay && <label style={lStyle}>
              <span>{'\uD83C\uDFC1'} Finish</span>
              <input type="time" value={endTime || ''} step={60}
                onChange={e => {
                  var newEnd = e.target.value || '';
                  setEndTime(newEnd);
                  var startMin = minutesFrom24h(time);
                  var endMin = minutesFrom24h(newEnd);
                  if (startMin == null || endMin == null || endMin <= startMin) {
                    setEndTimeError('Finish must be after start');
                    return;
                  }
                  setEndTimeError(null);
                  setDur(endMin - startMin);
                  if (!isCreate && !isFixed) setDatePinned(true);
                }}
                style={{ ...iStyle, width: isMobile ? '100%' : undefined, minWidth: 0,
                  ...(endTimeError ? { borderColor: '#DC2626' } : (datePinned && time ? { borderColor: '#D97706' } : {})) }} />
              {endTimeError && (
                <span style={{ fontSize: 10, color: '#DC2626', marginTop: 2 }}>{endTimeError}</span>
              )}
            </label>}
            {!isAllDay && <label style={lStyle}>
              <span>{'\u23F1'} Duration</span>
              <select value={dur} onChange={e => {
                var newDur = parseInt(e.target.value);
                setDur(newDur);
                // Keep finish in sync when user changes duration directly.
                if (time) setEndTime(addMinutesTo24h(time, newDur));
                setEndTimeError(null);
              }} style={iStyle}>
                {durOptions.map(v => (
                  <option key={v} value={v}>{durLabel(v)}</option>
                ))}
              </select>
            </label>}
            {!isCreate && !marker && !isAllDay && <label style={lStyle}>
              <span>{'\uD83D\uDCCA'} Remaining</span>
              <select value={remVal} onChange={e => setTimeRemaining(parseInt(e.target.value))}
                style={{ ...iStyle, background: remVal < parseInt(dur) ? TH.purpleBg : TH.inputBg }}>
                {remOptions.map(v => (
                  <option key={v} value={v}>{durLabel(v)}</option>
                ))}
              </select>
            </label>}
            {!marker && !disSplit && <label style={lStyle}>
              <span>{'\u2702'} Split</span>
              <button title={split ? 'Can be split into chunks' : 'Scheduled as one block'}
                onClick={() => { var on = !split; setSplit(on); if (on) { setTravelBefore(0); setTravelAfter(0); } }}
                style={togStyle(split, '#2D6A4F')}>{split ? '\u2702 Yes' : 'No'}</button>
            </label>}
            {split && !disSplit && !marker && (
              <label style={lStyle}>
                <span>Min</span>
                <select value={splitMin} onChange={e => setSplitMin(parseInt(e.target.value))}
                  style={{ ...iStyle, width: 'auto', minWidth: 55 }}>
                  {[15,20,30,45,60].map(v => (
                    <option key={v} value={v}>{v < 60 ? v + 'm' : '1h'}</option>
                  ))}
                </select>
              </label>
            )}
          </div>}

          {/* Intended vs scheduled — only when scheduler moved the task */}
          {!isCreate && !recurring && task.desiredAt && task.scheduledAt && task.desiredAt !== task.scheduledAt && !task.unscheduled && (function() {
            var tz = task.tz || activeTimezone || 'America/New_York';
            var intended = convertTimeForDisplay(task.desiredAt, tz);
            var scheduled = convertTimeForDisplay(task.scheduledAt, tz);
            if (!intended || !scheduled || (intended.date === scheduled.date && intended.time === scheduled.time)) return null;
            var fmtTime = function(c) { return c && c.time ? c.time : ''; };
            var sameDay = intended.date === scheduled.date;
            return <div style={{ fontSize: 10, color: TH.textMuted, marginBottom: 5 }}>
              {sameDay
                ? <span>Moved: {fmtTime(intended)} {'\u2192'} <span style={{ color: TH.text }}>{fmtTime(scheduled)}</span></span>
                : <span>Moved to <span style={{ color: TH.text }}>{scheduled.date}{fmtTime(scheduled) ? ' ' + fmtTime(scheduled) : ''}</span></span>}
            </div>;
          })()}

          {/* Intended time for unscheduled tasks */}
          {!isCreate && !recurring && task.desiredAt && task.unscheduled && (function() {
            var tz = task.tz || activeTimezone || 'America/New_York';
            var intended = convertTimeForDisplay(task.desiredAt, tz);
            if (!intended) return null;
            return <div style={{ fontSize: 10, marginBottom: 5 }}>
              <span style={{ color: TH.redText }}>Unscheduled</span>
              {intended.time ? <span style={{ color: TH.textMuted }}> — requested {intended.time}</span> : null}
            </div>;
          })()}

          {/* Duration + Split for recurringTasks */}
          {recurring && !marker && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5, alignItems: 'flex-end' }}>
            <label style={lStyle}>
              <span>{'\u23F1'} Duration</span>
              <select value={dur} onChange={e => setDur(parseInt(e.target.value))} style={iStyle}>
                {durOptions.map(v => (
                  <option key={v} value={v}>{durLabel(v)}</option>
                ))}
              </select>
            </label>
            {!isCreate && <label style={lStyle}>
              <span>{'\uD83D\uDCCA'} Remaining</span>
              <select value={remVal} onChange={e => setTimeRemaining(parseInt(e.target.value))}
                style={{ ...iStyle, background: remVal < parseInt(dur) ? TH.purpleBg : TH.inputBg }}>
                {remOptions.map(v => (
                  <option key={v} value={v}>{durLabel(v)}</option>
                ))}
              </select>
            </label>}
            {!disSplit && <label style={lStyle}>
              <span>{'\u2702'} Split</span>
              <button title={split ? 'Can be split into chunks' : 'Scheduled as one block'}
                onClick={() => { var on = !split; setSplit(on); if (on) { setTravelBefore(0); setTravelAfter(0); } }}
                style={togStyle(split, '#2D6A4F')}>{split ? '\u2702 Yes' : 'No'}</button>
            </label>}
            {split && !disSplit && (
              <label style={lStyle}>
                <span>Min</span>
                <select value={splitMin} onChange={e => setSplitMin(parseInt(e.target.value))}
                  style={{ ...iStyle, width: 'auto', minWidth: 55 }}>
                  {[15,20,30,45,60].map(v => (
                    <option key={v} value={v}>{v < 60 ? v + 'm' : '1h'}</option>
                  ))}
                </select>
              </label>
            )}
          </div>}
          {recurring && !marker && split && !disSplit && (
            <div style={{ fontSize: 10, color: TH.textMuted, marginTop: -2, marginBottom: 5, lineHeight: 1.3 }}>
              Chunks stay on the same day as the instance. If a chunk doesn't
              fit, it's dropped rather than moved to a later day.
            </div>
          )}

          {/* Travel time buffers — hidden for all-day, markers, and split tasks */}
          {!marker && !isAllDay && !split && <div style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
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

          {/* When mode selector — hidden for markers only */}
          {!marker && <label style={{ ...lStyle, marginBottom: 5 }}>
            <span title="Controls which time windows the scheduler can place this task in.">{'\uD83D\uDCC6'} Time window</span>
            {(function() {
              // Window tags are everything that isn't a mode keyword
              var tagParts = whenParts.filter(function(p) { return p !== 'anytime' && p !== 'allday' && p !== 'fixed'; });
              var isWindows = tagParts.length > 0;
              var isAnytime = !isAllDay && !isFixed && !isWindows;
              var calWarn = isCalLinkedFixed
                ? ' — This event is synced to your external calendar; unpinning it may cause calendar/scheduler drift.'
                : '';
              return (
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                  <button title={'No time restriction — the scheduler can place this in any available slot' + calWarn}
                    onClick={function() { setWhen(''); }}
                    style={togStyle(isAnytime, '#2D6A4F')}>{'\uD83D\uDD04'} Anytime</button>
                  <button title={'Spans the entire day' + calWarn}
                    onClick={function() { setWhen('allday'); setSplit(false); setTravelBefore(0); setTravelAfter(0); }}
                    style={togStyle(isAllDay, '#C8942A')}>{'\u2600\uFE0F'} All Day</button>
                  <button title={'Locked to the exact Date/Time. The scheduler will never move it' + calWarn}
                    onClick={function() { setWhen('fixed'); setSplit(false); }}
                    style={togStyle(isFixed, '#8B2635')}>{'\uD83D\uDCCC'} Fixed</button>
                  <span style={{ width: 1, height: 18, background: TH.border, margin: '0 2px' }} />
                  {(uniqueTags || []).map(function(tb) {
                    var isOn = tagParts.indexOf(tb.tag) !== -1;
                    return (
                      <button key={tb.tag}
                        title={(isAllDay || isFixed)
                          ? tb.name + ' time window — clicking will switch out of ' + (isFixed ? 'Fixed' : 'All Day') + ' mode'
                          : tb.name + ' time window — selecting any window disables Anytime'}
                        onClick={function() {
                          if (isAllDay || isFixed) {
                            setWhen(tb.tag);
                          } else {
                            var cur = tagParts.slice();
                            if (isOn) { cur = cur.filter(function(v) { return v !== tb.tag; }); }
                            else { cur.push(tb.tag); }
                            setWhen(cur.length === 0 ? '' : cur.join(','));
                          }
                        }} style={{
                          ...togStyle(isOn && !isAllDay && !isFixed, tb.color),
                          opacity: (isAllDay || isFixed) ? 0.55 : 1
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

          {/* Day requirement — hidden for recurringTasks and fixed tasks */}
          {!marker && !recurring && !isFixed && (
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

          {/* Deadline + Start after — hidden for markers, recurringTasks, and fixed tasks */}
          {!marker && !recurring && !isFixed && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5, alignItems: 'flex-end', maxWidth: '100%' }}>
            <label style={lStyle}>
              <span title="Hard deadline. The scheduler places this task on or before this date.">{'\uD83D\uDCC6'} Deadline</span>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <input type="date" value={deadline || ''}
                  onChange={e => setDeadline(e.target.value || '')}
                  style={{ ...iStyle, minWidth: 0, flex: 1, ...(deadline ? { background: TH.amberBg } : {}) }} />
                {deadline && (
                  <button onClick={() => setDeadline('')} style={{
                    fontSize: 9, background: 'none', border: 'none', color: TH.redText,
                    cursor: 'pointer', padding: 0, fontWeight: 700
                  }}>{'\u2715'}</button>
                )}
              </div>
            </label>
            <label style={lStyle}>
              <span title="Task will not be scheduled before this date.">{'\u23F3'} Not before</span>
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
          </div>}

          {/* Split moved to be next to Duration */}

          {/* Recurrence */}
          {!marker &&
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <label style={lStyle}>
              <span title="Automatically generate copies of this task on a schedule.">{'\uD83D\uDD01'} Recurrence</span>
              <select value={recurType} onChange={e => {
                var val = e.target.value;
                setRecurType(val);
                if (val === 'weekly' || val === 'biweekly') setDayReq('any');
                // Recurrence drives recurring status: recurring = recurring, none = regular task
                if (val === 'none') { setRecurring(false); setRigid(false); }
                else { setRecurring(true); setSplit(false); setDayReq('any'); }
              }} style={iStyle}>
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly (pick days)</option>
                <option value="interval">Every N (days/wks/mo/yr)</option>
              </select>
            </label>
            {(recurType === 'weekly' || recurType === 'biweekly') && (function() {
              var selectedCount = recurDays.length;
              return <label style={lStyle}>
                Days
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={function() { setRecurDays('MTWRF'); }}
                    style={togStyle(recurDays === 'MTWRF', '#4338CA')}>Wkday</button>
                  <button onClick={function() { setRecurDays('SU'); }}
                    style={togStyle(recurDays === 'SU' || recurDays === 'US', '#4338CA')}>Wkend</button>
                  <span style={{ width: 1, height: 18, background: TH.border, margin: '0 1px' }} />
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
                {selectedCount > 1 && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: TH.textMuted }}>Times per {recurType === 'biweekly' ? '2 weeks' : 'week'}:</span>
                    <select value={recurTimesPerCycle || selectedCount} onChange={function(e) { setRecurTimesPerCycle(parseInt(e.target.value)); }}
                      style={{ ...iStyle, width: 'auto', minWidth: 50 }}>
                      {Array.from({ length: selectedCount }, function(_, i) { return i + 1; }).map(function(n) {
                        return <option key={n} value={n}>{n}{n === selectedCount ? ' (all)' : ''}</option>;
                      })}
                    </select>
                    {(recurTimesPerCycle > 0 && recurTimesPerCycle < selectedCount) && (
                      <span style={{ fontSize: 9, color: '#C8942A' }}>{'\u2248'}every {Math.round((recurType === 'biweekly' ? 14 : 7) / recurTimesPerCycle * 10) / 10} days</span>
                    )}
                  </div>
                )}
              </label>;
            })()}
            {recurType === 'monthly' && (function() {
              var mdArr = Array.isArray(recurMonthDays) ? recurMonthDays : Object.keys(recurMonthDays || {});
              var mdCount = mdArr.length;
              return <label style={lStyle}>
                Days of month
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: 260 }}>
                  {[['first', '1st'], ['last', 'Last']].concat(
                    Array.from({ length: 28 }, function(_, i) { return [String(i + 1), String(i + 1)]; })
                  ).map(function(pair) {
                    var val = pair[0], label = pair[1];
                    var active = mdArr.indexOf(val) >= 0 || mdArr.indexOf(Number(val)) >= 0;
                    return (
                      <button key={val} onClick={function() {
                        setRecurMonthDays(function(prev) {
                          var arr = Array.isArray(prev) ? prev : Object.keys(prev || {});
                          var norm = arr.map(String);
                          var sv = String(val);
                          return norm.indexOf(sv) >= 0 ? arr.filter(function(d) { return String(d) !== sv; }) : arr.concat([val]);
                        });
                      }} style={{ ...togStyle(active), minWidth: label.length > 2 ? 32 : 22, fontSize: 9 }}>{label}</button>
                    );
                  })}
                </div>
                {mdCount > 1 && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: TH.textMuted }}>Times per month:</span>
                    <select value={recurTimesPerCycle || mdCount} onChange={function(e) { setRecurTimesPerCycle(parseInt(e.target.value)); }}
                      style={{ ...iStyle, width: 'auto', minWidth: 50 }}>
                      {Array.from({ length: mdCount }, function(_, i) { return i + 1; }).map(function(n) {
                        return <option key={n} value={n}>{n}{n === mdCount ? ' (all)' : ''}</option>;
                      })}
                    </select>
                    {(recurTimesPerCycle > 0 && recurTimesPerCycle < mdCount) && (
                      <span style={{ fontSize: 9, color: '#C8942A' }}>{'\u2248'}every {Math.round((recurType === 'biweekly' ? 14 : 7) / recurTimesPerCycle * 10) / 10} days</span>
                    )}
                  </div>
                )}
              </label>;
            })()}
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

          {/* Anchor date — for interval/weekly/biweekly recurrence, the date from which cycles are counted */}
          {!marker && (recurType === 'interval' || ((recurType === 'weekly' || recurType === 'biweekly') && recurTimesPerCycle > 0 && recurTimesPerCycle < recurDays.length)) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 5 }}>
              <label style={lStyle}>
                <span title="The date from which the interval cycle counts. Change this to reset the cycle (e.g., after completing the task).">{'\u2693'} Anchor date</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="date" value={anchorDate || ''}
                    onChange={e => { setAnchorDate(e.target.value || ''); }}
                    style={iStyle} />
                  <button onClick={function() {
                    // Reset anchor to today
                    var now = new Date();
                    var y = now.getFullYear();
                    var m = String(now.getMonth() + 1).padStart(2, '0');
                    var d = String(now.getDate()).padStart(2, '0');
                    setAnchorDate(y + '-' + m + '-' + d);
                  }} title="Reset cycle to start from today"
                    style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3,
                      background: TH.inputBg, border: '1px solid ' + TH.border, color: TH.text,
                      cursor: 'pointer', fontWeight: 600, height: 26, boxSizing: 'border-box'
                    }}>Today</button>
                </div>
              </label>
              <span style={{ fontSize: 9, color: TH.muted2, paddingBottom: 4 }}>{recurType === 'interval' ? 'intervals count from this date' : 'cycle spacing starts from this date'}</span>
            </div>
          )}

          {/* Recurrence date range — when to start/stop generating instances */}
          {recurring && !marker && recurType !== 'none' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
              <label style={lStyle}>
                <span title="Date to start generating instances for this recurring task">{'\u23EF\uFE0F'} Recurrence starts</span>
                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  <input type="date" value={recurStart || ''} onChange={e => setRecurringStart(e.target.value || '')} style={iStyle} />
                  {recurStart && (
                    <button onClick={() => setRecurringStart('')} style={{
                      fontSize: 9, background: 'none', border: 'none', color: TH.redText,
                      cursor: 'pointer', padding: 0, fontWeight: 700
                    }}>{'\u2715'}</button>
                  )}
                </div>
              </label>
              <label style={lStyle}>
                <span title="Date to stop generating new instances">{'\u23F9'} Recurrence ends</span>
                <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  <input type="date" value={recurEnd || ''} onChange={e => setRecurringEnd(e.target.value || '')} style={iStyle} />
                  {recurEnd && (
                    <button onClick={() => setRecurringEnd('')} style={{
                      fontSize: 9, background: 'none', border: 'none', color: TH.redText,
                      cursor: 'pointer', padding: 0, fontWeight: 700
                    }}>{'\u2715'}</button>
                  )}
                </div>
              </label>
            </div>
          )}

          {/* Placement window removed — time-window recurringTasks have ± Window inline,
               time-blocks recurringTasks don't need it (blocks ARE the window).
               The timeFlex field still exists in the data model for backward compat. */}
          {false && !marker && recurring && !hasPreferredTime && (function() {
            var driftOptions;
            // Normalize recurrence to effective days between occurrences
            var effectiveDays = 1; // default: daily
            if (recurType === 'daily') effectiveDays = 1;
            else if (recurType === 'weekly') effectiveDays = 7;
            else if (recurType === 'biweekly') effectiveDays = 14;
            else if (recurType === 'monthly') effectiveDays = 30;
            else if (recurType === 'interval') {
              var n = parseInt(recurEvery) || 1;
              if (recurUnit === 'days') effectiveDays = n;
              else if (recurUnit === 'weeks') effectiveDays = n * 7;
              else if (recurUnit === 'months') effectiveDays = n * 30;
              else if (recurUnit === 'years') effectiveDays = n * 365;
            }

            if (effectiveDays >= 90) {
              // Quarterly+ — very infrequent, wide window
              driftOptions = [
                { value: 0, label: 'exact (rigid)' },
                { value: 1440, label: '+/- 1 day' },
                { value: 4320, label: '+/- 3 days' },
                { value: 7200, label: '+/- 5 days' },
                { value: 10080, label: '+/- 7 days' },
                { value: 20160, label: '+/- 14 days' },
              ];
            } else if (effectiveDays >= 21) {
              // Monthly-ish (21-89 days)
              driftOptions = [
                { value: 0, label: 'exact (rigid)' },
                { value: 240, label: '+/- 4 hr' },
                { value: 1440, label: '+/- 1 day' },
                { value: 2880, label: '+/- 2 days' },
                { value: 4320, label: '+/- 3 days' },
                { value: 7200, label: '+/- 5 days' },
              ];
            } else if (effectiveDays >= 7) {
              // Weekly-ish (7-20 days)
              driftOptions = [
                { value: 0, label: 'exact (rigid)' },
                { value: 60, label: '+/- 1 hr' },
                { value: 120, label: '+/- 2 hr' },
                { value: 240, label: '+/- 4 hr' },
                { value: 480, label: '+/- 8 hr' },
                { value: 1440, label: '+/- 1 day' },
              ];
            } else if (effectiveDays >= 2) {
              // Every few days (2-6 days)
              driftOptions = [
                { value: 0, label: 'exact (rigid)' },
                { value: 30, label: '+/- 30 min' },
                { value: 60, label: '+/- 1 hr' },
                { value: 120, label: '+/- 2 hr' },
                { value: 240, label: '+/- 4 hr' },
                { value: 480, label: '+/- 8 hr' },
              ];
            } else {
              // Daily — tight window
              driftOptions = [
                { value: 0, label: 'exact (rigid)' },
                { value: 15, label: '+/- 15 min' },
                { value: 30, label: '+/- 30 min' },
                { value: 60, label: '+/- 1 hr' },
                { value: 90, label: '+/- 1.5 hr' },
                { value: 120, label: '+/- 2 hr' },
              ];
            }
            var maxDrift = driftOptions[driftOptions.length - 1].value;
            var currentVal = rigid ? 0 : timeFlex;
            if (currentVal > maxDrift && !rigid) {
              setTimeFlex(maxDrift);
              currentVal = maxDrift;
            }
            var hasVal = driftOptions.some(function(o) { return o.value === currentVal; });
            if (!hasVal && currentVal > 0) {
              var snapped = 0;
              driftOptions.forEach(function(o) { if (o.value <= currentVal) snapped = o.value; });
              setTimeFlex(snapped);
              currentVal = snapped;
            }
            var disPlacement = isAllDay || isFixed;
            return (
              <label style={{ ...lStyle, marginBottom: 5 }}>
                <span title={disPlacement ? (isAllDay ? 'Not applicable for all-day tasks' : 'Fixed tasks have no placement flexibility') : 'How far from the preferred time the scheduler can shift this task. 0 = locked to exact time.'} style={disPlacement ? { opacity: 0.4 } : undefined}>Placement window</span>
                <select value={currentVal} onChange={e => {
                  var v = parseInt(e.target.value);
                  if (v === 0) { setRigid(true); } else { setRigid(false); setTimeFlex(v); }
                }} disabled={disPlacement} style={{ ...iStyle, minWidth: 90, ...(disPlacement ? { opacity: 0.4 } : {}) }}>
                  {driftOptions.map(function(o) {
                    return <option key={o.value} value={o.value}>{o.label}</option>;
                  })}
                </select>
              </label>
            );
          })()}

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
        task.recurring || task.taskType === 'recurring_instance' || task.taskType === 'recurring_template' ? (
          <RecurringDeleteDialog
            taskName={task.text || 'this task'}
            onSkipInstance={() => { if (onStatusChange) onStatusChange('skip'); setShowDeleteConfirm(false); }}
            onDeleteSeries={() => { onDelete(task.id, { cascade: 'recurring' }); onClose(); }}
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
