/**
 * TaskEditForm — full editor matching the original JSX inline design
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PRI_COLORS, STATUS_OPTIONS, applyDefaults } from '../../state/constants';
import { toTime24, fromTime24, toDateISO, fromDateISO, formatDateKey } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import ConfirmDialog from '../features/ConfirmDialog';

export default function TaskEditForm({ task, status, direction, onUpdate, onStatusChange, onDirectionChange, onDelete, onClose, onShowChain, allProjectNames, locations, tools, uniqueTags, darkMode, isMobile, mode, onCreate, initialDate, initialProject, stackIndex }) {
  var isCreate = mode === 'create';
  var TH = getTheme(darkMode);
  var initDate = isCreate && initialDate ? toDateISO(formatDateKey(initialDate)) : '';
  var [text, setText] = useState(isCreate ? '' : (task.text || ''));
  var [project, setProject] = useState(isCreate ? (initialProject || '') : (task.project || ''));
  var [pri, setPri] = useState(isCreate ? 'P3' : (task.pri || 'P3'));
  var [date, setDate] = useState(isCreate ? initDate : toDateISO(task.date));
  var [time, setTime] = useState(isCreate ? '' : toTime24(task.time));
  var [dur, setDur] = useState(isCreate ? 30 : (task.dur || 30));
  var [timeRemaining, setTimeRemaining] = useState(isCreate ? '' : (task.timeRemaining != null ? task.timeRemaining : ''));
  var [due, setDue] = useState(isCreate ? '' : toDateISO(task.due));
  var [startAfter, setStartAfter] = useState(isCreate ? '' : toDateISO(task.startAfter));
  var [notes, setNotes] = useState(isCreate ? '' : (task.notes || ''));
  var [when, setWhen] = useState(isCreate ? 'morning,lunch,afternoon,evening' : (task.when || ''));
  var [dayReq, setDayReq] = useState(isCreate ? 'any' : (task.dayReq || 'any'));
  var [habit, setHabit] = useState(isCreate ? false : !!task.habit);
  var [rigid, setRigid] = useState(isCreate ? false : !!task.rigid);
  var [timeFlex, setTimeFlex] = useState(isCreate ? 60 : (task.timeFlex != null ? task.timeFlex : 60));
  var [split, setSplit] = useState(isCreate ? false : (task.split !== undefined ? task.split : false));
  var [splitMin, setSplitMin] = useState(isCreate ? 15 : (task.splitMin || 15));
  var [taskLoc, setTaskLoc] = useState(isCreate ? [] : (task.location || []));
  var [taskTools, setTaskTools] = useState(isCreate ? [] : (task.tools || []));
  var [datePinned, setDatePinned] = useState(isCreate ? false : !!task.datePinned);
  var [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  var [recurType, setRecurType] = useState(isCreate ? 'none' : (task.recur?.type || 'none'));
  var [recurDays, setRecurDays] = useState(isCreate ? 'MTWRF' : (task.recur?.days || 'MTWRF'));
  var [recurEvery, setRecurEvery] = useState(isCreate ? 2 : (task.recur?.every || 2));

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
      datePinned: datePinned,
      recur: recurType === 'none' ? null : {
        type: recurType,
        days: recurType === 'weekly' || recurType === 'biweekly' ? recurDays : undefined,
        every: recurType === 'interval' ? parseInt(recurEvery) || 2 : undefined
      }
    };
  }, [text, project, pri, date, time, dur, timeRemaining, due, startAfter, notes, when, dayReq, habit, rigid, timeFlex, split, splitMin, taskLoc, taskTools, datePinned, recurType, recurDays, recurEvery, isCreate, task]);

  // Auto-save on field changes (edit mode only)
  useEffect(function() {
    if (isCreate) return;
    if (firstRender.current) { firstRender.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus('saving');
    saveTimer.current = setTimeout(function() {
      onUpdate(task.id, buildFields());
      setSaveStatus('saved');
      setTimeout(function() { setSaveStatus(null); }, 1500);
    }, 600);
    return function() { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [text, project, pri, date, time, dur, timeRemaining, due, startAfter, notes, when, dayReq, habit, rigid, timeFlex, split, splitMin, taskLoc, taskTools, datePinned, recurType, recurDays, recurEvery]);

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
        background: darkMode ? '#1E293B' : '#F1F5F9',
        padding: '8px 12px', borderBottom: '1px solid ' + TH.border
      }}>
        {isCreate ? (
          <button onClick={handleCreate} style={{
            fontSize: 10, fontWeight: 700, padding: '4px 14px', border: 'none', borderRadius: 4,
            background: '#10B981', color: 'white', cursor: 'pointer'
          }}>{'\u2795 Create'}</button>
        ) : (
          saveStatus && <span style={{
            fontSize: 10, fontWeight: 600, color: saveStatus === 'saving' ? TH.textMuted : '#10B981',
            padding: '4px 8px'
          }}>{saveStatus === 'saving' ? 'Saving\u2026' : '\u2714 Saved'}</span>
        )}
        {!isCreate && onDelete && (
          <button onClick={() => setShowDeleteConfirm(true)} style={{
            fontSize: 10, fontWeight: 600, padding: '4px 10px',
            border: '1px solid #DC2626', borderRadius: 4,
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

      <div style={{ padding: '10px 12px', maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
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
                  fontSize: 10, fontWeight: isActive ? 700 : 500, fontFamily: 'inherit'
                }}>
                  {s.label} {s.tip.split(' \u2014 ')[0]}
                </button>
              );
            })}
          </div>
          {status === 'other' && (
            <input
              value={direction || ''}
              onChange={e => { if (onDirectionChange) onDirectionChange(e.target.value); }}
              placeholder="What are you doing instead?"
              style={{ ...iStyle, width: '100%', marginTop: 4 }}
            />
          )}
        </div>}

        {/* Row 1: Task + Project */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
          <label style={{ ...lStyle, flex: 1, minWidth: isMobile ? 0 : 200, width: isMobile ? '100%' : undefined }}>
            Task
            <input type="text" value={text} onChange={e => setText(e.target.value)}
              style={{ ...iStyle, width: '100%' }} autoFocus />
          </label>
          <label style={lStyle}>
            Project
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <select value={project} onChange={e => setProject(e.target.value)}
                style={{ ...iStyle, width: 120 }}>
                <option value="">— none —</option>
                {(allProjectNames || []).map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </label>
        </div>

        {/* Row 2a: Date/Time + Duration + Remaining */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5, maxWidth: '100%' }}>
          <label style={{ ...lStyle, maxWidth: '100%', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {'\uD83D\uDCC5'} Date / Time
              {!isCreate && !isFixed && date && (
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
              {!isCreate && !isFixed && datePinned && date && (
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
            <span title="How long the task takes">{'\u23F1'} Duration</span>
            <select value={dur} onChange={e => setDur(parseInt(e.target.value))} style={iStyle}>
              {durOptions.map(v => (
                <option key={v} value={v}>{durLabel(v)}</option>
              ))}
            </select>
          </label>
          {!isCreate && <label style={lStyle}>
            <span title="Time remaining on a partially completed task">{'\uD83D\uDCCA'} Remaining</span>
            <select value={remVal} onChange={e => setTimeRemaining(parseInt(e.target.value))}
              style={{ ...iStyle, background: remVal < parseInt(dur) ? TH.purpleBg : TH.inputBg }}>
              {remOptions.map(v => (
                <option key={v} value={v}>{durLabel(v)}</option>
              ))}
            </select>
          </label>}
        </div>

        {/* Row 2b: Split + Due + Start after */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5, alignItems: 'flex-end', maxWidth: '100%' }}>
          <label style={lStyle}>
            <span title="Allow the scheduler to split this task into smaller chunks across time slots">{'\u2702'} Split OK</span>
            <button title={split ? 'Task can be split into chunks' : 'Task must be scheduled as one block'} onClick={() => setSplit(!split)}
              style={togStyle(split, '#10B981')}>{split ? '\u2702 Yes' : 'No'}</button>
          </label>
          {split && (
            <label style={lStyle}>
              <span title="Smallest chunk the task can be split into">Min block</span>
              <select value={splitMin} onChange={e => setSplitMin(parseInt(e.target.value))}
                style={{ ...iStyle, width: 'auto', minWidth: 60 }}>
                {[15,20,30,45,60].map(v => (
                  <option key={v} value={v}>{v < 60 ? v + 'm' : '1h'}</option>
                ))}
              </select>
            </label>
          )}
          <label style={lStyle}>
            <span title="Deadline — scheduler places the task before this date">{'\uD83D\uDCC6'} Due</span>
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
            <span title="Don't schedule before this date">{'\u23F3'} Start after</span>
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
        </div>

        {/* Row 3: Priority + Habit + Rigid + Location */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
          <label style={lStyle}>
            <span title="Higher priority tasks are scheduled first (P1 before P2, etc.)">{'\uD83D\uDD25'} Priority</span>
            <select value={pri} onChange={e => setPri(e.target.value)} style={iStyle}>
              <option value="P1">{'\uD83D\uDD34'} P1 Critical</option>
              <option value="P2">{'\uD83D\uDFE0'} P2 High</option>
              <option value="P3">{'\uD83D\uDD35'} P3 Medium</option>
              <option value="P4">{'\u26AA'} P4 Low</option>
            </select>
          </label>
          <label style={lStyle}>
            <span title="Habits get priority scheduling and are pinned to their date">{'\uD83D\uDD01'} Habit</span>
            <button title={habit ? 'This is a recurring habit' : 'Mark as a daily habit'} onClick={() => { setHabit(!habit); if (habit) setRigid(false); }}
              style={togStyle(habit, '#10B981')}>{habit ? '\uD83D\uDD01 Yes' : 'No'}</button>
          </label>
          {habit && (
            <label style={lStyle}>
              <span title="Rigid = locked to its set time. Flexible = scheduler picks the best slot.">{'\uD83D\uDCCC'} Rigid</span>
              <button title={rigid ? 'Stays at its exact set time' : 'Scheduler moves it to fit'} onClick={() => setRigid(!rigid)}
                style={togStyle(rigid, '#3B82F6')}>{rigid ? '\uD83D\uDCCC Anchored' : '\uD83D\uDD01 Flexible'}</button>
            </label>
          )}
          {habit && !rigid && (
            <label style={lStyle}>
              <span title="How far from the preferred time the scheduler can move this habit">{'\u00B1'} Flex</span>
              <select value={timeFlex} onChange={e => setTimeFlex(parseInt(e.target.value))}
                style={{ background: TH.inputBg, color: TH.text, border: '1px solid ' + TH.border, borderRadius: 4, padding: '2px 4px', fontSize: 13 }}>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hr</option>
                <option value={90}>1.5 hr</option>
                <option value={120}>2 hr</option>
                <option value={180}>3 hr</option>
                <option value={240}>4 hr</option>
              </select>
            </label>
          )}
          <label style={lStyle}>
            <span title="Where this task can be done. 'Anywhere' means no location constraint.">{'\uD83D\uDCCD'} Location</span>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
              <button onClick={() => setTaskLoc([])} title="Task can be done at any location"
                style={togStyle(taskLoc.length === 0, '#10B981')}>{'\uD83C\uDF0D'} Anywhere</button>
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
        </div>

        {/* Row 4: Tools + When + Day req */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
          <label style={lStyle}>
            <span title="Tools required to complete this task. The scheduler checks tool availability by location.">{'\uD83D\uDD27'} Tools needed</span>
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
          <label style={lStyle}>
            <span title="Time windows when this task can be scheduled. 'Anytime' = no constraint. 'All Day' = spans the whole day. 'Fixed' = locked to the set time.">{'\uD83D\uDCC6'} When</span>
            {(function() {
              var parts = when ? when.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
              var isAnytime = parts.length === 0 || (parts.length === 1 && parts[0] === 'anytime');
              var isAllDay = parts.indexOf('allday') !== -1;
              var isFixed = parts.indexOf('fixed') !== -1;
              var isWindows = !isAnytime && !isAllDay && !isFixed;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button title="No time constraint — scheduler picks any available slot" onClick={function() { setWhen(''); }}
                      style={togStyle(isAnytime, '#10B981')}>{'\uD83D\uDD04'} Anytime</button>
                    <button title="Task spans the entire day (e.g. travel days)" onClick={function() { setWhen('allday'); }}
                      style={togStyle(isAllDay, '#F59E0B')}>{'\u2600\uFE0F'} All Day</button>
                    <button title="Lock task to its exact set time — won't be moved" onClick={function() { setWhen('fixed'); }}
                      style={togStyle(isFixed, '#EF4444')}>{'\uD83D\uDCCC'} Fixed</button>
                    <button title="Choose specific time windows (morning, afternoon, etc.)" onClick={function() {
                      if (!isWindows) setWhen('morning,afternoon,evening');
                    }} style={togStyle(isWindows)}>{'\uD83D\uDDD3'} Windows</button>
                  </div>
                  {isWindows && (
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {(uniqueTags || []).map(function(tb) {
                        var isOn = parts.indexOf(tb.tag) !== -1;
                        return (
                          <button key={tb.tag} title={tb.name + ' time window'} onClick={function() {
                            var cur = parts.slice();
                            if (isOn) { cur = cur.filter(function(v) { return v !== tb.tag; }); }
                            else { cur.push(tb.tag); }
                            setWhen(cur.length === 0 ? '' : cur.join(','));
                          }} style={togStyle(isOn, tb.color)}>{tb.icon} {tb.name}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </label>
        </div>

        {/* Row 5: Day req + Recurrence */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
          <label style={lStyle}>
            <span title="Restrict which day(s) this task can be scheduled on">Day requirement</span>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              <button title="No day restriction" onClick={function() { setDayReq('any'); }}
                style={togStyle(dayReq === 'any', '#10B981')}>Any</button>
              <button title="Monday through Friday only" onClick={function() { setDayReq(dayReq === 'weekday' ? 'any' : 'weekday'); }}
                style={togStyle(dayReq === 'weekday', '#6366F1')}>Wkday</button>
              <button title="Saturday or Sunday only" onClick={function() { setDayReq(dayReq === 'weekend' ? 'any' : 'weekend'); }}
                style={togStyle(dayReq === 'weekend', '#8B5CF6')}>Wkend</button>
              {[['Su','Su'],['M','Mo'],['T','Tu'],['W','We'],['R','Th'],['F','Fr'],['Sa','Sa']].map(function(pair) {
                var code = pair[0], label = pair[1];
                return (
                  <button key={code} title={({Su:'Sunday only',M:'Monday only',T:'Tuesday only',W:'Wednesday only',R:'Thursday only',F:'Friday only',Sa:'Saturday only'})[code]}
                    onClick={function() { setDayReq(dayReq === code ? 'any' : code); }}
                    style={togStyle(dayReq === code)}>{label}</button>
                );
              })}
            </div>
          </label>
          <label style={lStyle}>
            <span title="Automatically generate copies of this task on a schedule">{'\uD83D\uDD01'} Recurrence</span>
            <select value={recurType} onChange={e => setRecurType(e.target.value)} style={iStyle}>
              <option value="none">None</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="interval">Every N days</option>
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
          {recurType === 'interval' && (
            <label style={lStyle}>
              Interval
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: TH.text }}>Every</span>
                <input type="number" value={recurEvery} onChange={e => setRecurEvery(e.target.value)} min={2}
                  style={{ ...iStyle, width: 50 }} />
                <span style={{ fontSize: 10, color: TH.text }}>days</span>
              </div>
            </label>
          )}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 5 }}>
          <label style={lStyle}>
            Notes
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              style={{ ...iStyle, minHeight: 50, resize: 'vertical', width: '100%' }} />
          </label>
        </div>

        {/* Dependencies — link to Deps view */}
        {!isCreate && onShowChain && (
          <button onClick={onShowChain} style={{
            border: '1px solid #0EA5E9', borderRadius: 4, padding: '4px 10px',
            background: 'transparent', color: '#0EA5E9', fontSize: 10, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', width: '100%', marginBottom: 5
          }}>{'\uD83D\uDD17'} View Dependencies{task.dependsOn && task.dependsOn.length > 0 ? ' (' + task.dependsOn.length + ')' : ''}</button>
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          message={'Delete "' + (task.text || 'this task').slice(0, 60) + '"?'}
          onConfirm={() => { onDelete(task.id); onClose(); }}
          onCancel={() => setShowDeleteConfirm(false)}
          darkMode={darkMode}
          isMobile={isMobile}
        />
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
