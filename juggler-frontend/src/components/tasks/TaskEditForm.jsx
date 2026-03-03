/**
 * TaskEditForm — full editor matching the original JSX inline design
 */

import React, { useState } from 'react';
import { PRI_COLORS, STATUS_OPTIONS, applyDefaults } from '../../state/constants';
import { toTime24, fromTime24, toDateISO, fromDateISO, formatDateKey } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import ConfirmDialog from '../features/ConfirmDialog';

export default function TaskEditForm({ task, status, direction, onUpdate, onStatusChange, onDirectionChange, onDelete, onClose, onShowChain, allProjectNames, locations, tools, uniqueTags, darkMode, isMobile, mode, onCreate, initialDate }) {
  var isCreate = mode === 'create';
  var TH = getTheme(darkMode);
  var initDate = isCreate && initialDate ? toDateISO(formatDateKey(initialDate)) : '';
  var [text, setText] = useState(isCreate ? '' : (task.text || ''));
  var [project, setProject] = useState(isCreate ? '' : (task.project || ''));
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
  var [split, setSplit] = useState(isCreate ? false : (task.split !== undefined ? task.split : false));
  var [splitMin, setSplitMin] = useState(isCreate ? 15 : (task.splitMin || 15));
  var [taskLoc, setTaskLoc] = useState(isCreate ? [] : (task.location || []));
  var [taskTools, setTaskTools] = useState(isCreate ? [] : (task.tools || []));
  var [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  var [recurType, setRecurType] = useState(isCreate ? 'none' : (task.recur?.type || 'none'));
  var [recurDays, setRecurDays] = useState(isCreate ? 'MTWRF' : (task.recur?.days || 'MTWRF'));
  var [recurEvery, setRecurEvery] = useState(isCreate ? 2 : (task.recur?.every || 2));

  var iStyle = { fontSize: isMobile ? 13 : 11, padding: isMobile ? '6px 8px' : '3px 4px', border: '1px solid ' + TH.inputBorder, borderRadius: 4, background: TH.inputBg, color: TH.inputText, fontFamily: 'inherit' };
  var lStyle = { fontSize: 8, color: TH.textMuted, display: 'flex', flexDirection: 'column', gap: 2, fontWeight: 600 };

  function save() {
    var d = fromDateISO(date);
    var dayName = '';
    if (d) {
      var pd = new Date(2026, parseInt(d.split('/')[0]) - 1, parseInt(d.split('/')[1]));
      dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][pd.getDay()];
    }
    var fields = {
      text, project, pri,
      date: d || (isCreate ? '' : task.date),
      day: dayName || (isCreate ? '' : task.day),
      time: fromTime24(time),
      dur: parseInt(dur) || 30,
      timeRemaining: timeRemaining === '' ? null : parseInt(timeRemaining),
      due: fromDateISO(due),
      startAfter: fromDateISO(startAfter),
      notes, when, dayReq, habit, rigid,
      split: split || undefined,
      splitMin: split ? (parseInt(splitMin) || 15) : null,
      location: taskLoc,
      tools: taskTools,
      recur: recurType === 'none' ? null : {
        type: recurType,
        days: recurType === 'weekly' || recurType === 'biweekly' ? recurDays : undefined,
        every: recurType === 'interval' ? parseInt(recurEvery) || 2 : undefined
      }
    };
    if (isCreate) {
      var newId = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
      var newTask = applyDefaults(Object.assign({ id: newId }, fields));
      onCreate(newTask);
    } else {
      onUpdate(task.id, fields);
    }
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

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: isMobile ? '100vw' : 420, maxWidth: '100vw',
      left: isMobile ? 0 : undefined,
      background: TH.bgCard, borderLeft: isMobile ? 'none' : ('1px solid ' + TH.border),
      zIndex: 200, overflow: 'auto', boxShadow: isMobile ? 'none' : ('-4px 0 20px ' + TH.shadow)
    }}>
      {/* Top bar with Save / Delete / Close */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        background: darkMode ? '#1E293B' : '#F1F5F9',
        padding: '8px 12px', borderBottom: '1px solid ' + TH.border
      }}>
        <button onClick={save} style={{
          fontSize: 10, fontWeight: 700, padding: '4px 14px', border: 'none', borderRadius: 4,
          background: '#10B981', color: 'white', cursor: 'pointer'
        }}>{isCreate ? '\u2795 Create' : '\u2714 Save'}</button>
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

      <div style={{ padding: '10px 12px' }}>
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
          <label style={{ ...lStyle, flex: 1, minWidth: 200 }}>
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

        {/* Row 2: Date + Time + Duration + Remaining + Split + Due + Start After */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
          <label style={lStyle}>
            {'\uD83D\uDCC5'} Date
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={iStyle} />
          </label>
          <label style={lStyle}>
            {'\uD83D\uDD52'} Time
            <input type="time" value={time || ''} onChange={e => setTime(e.target.value)} style={iStyle} />
          </label>
          <label style={lStyle}>
            {'\u23F1'} Duration
            <select value={dur} onChange={e => setDur(parseInt(e.target.value))} style={iStyle}>
              {durOptions.map(v => (
                <option key={v} value={v}>{durLabel(v)}</option>
              ))}
            </select>
          </label>
          {!isCreate && <label style={lStyle}>
            {'\uD83D\uDCCA'} Remaining
            <select value={remVal} onChange={e => setTimeRemaining(parseInt(e.target.value))}
              style={{ ...iStyle, background: remVal < parseInt(dur) ? TH.purpleBg : TH.inputBg }}>
              {remOptions.map(v => (
                <option key={v} value={v}>{durLabel(v)}</option>
              ))}
            </select>
          </label>}
          <label style={lStyle}>
            {'\u2702'} Split
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button onClick={() => setSplit(!split)} style={{
                padding: '3px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 600,
                border: '1px solid ' + (split ? TH.greenBorder : TH.btnBorder),
                background: split ? TH.greenBg : TH.inputBg,
                color: split ? TH.greenText : TH.textMuted,
              }}>{split ? '\u2702 Yes' : 'No'}</button>
              {split && (
                <select value={splitMin} onChange={e => setSplitMin(parseInt(e.target.value))}
                  style={{ ...iStyle, width: 'auto', minWidth: 60 }}>
                  {[15,20,30,45,60].map(v => (
                    <option key={v} value={v}>{v < 60 ? v + 'm min' : '1h min'}</option>
                  ))}
                </select>
              )}
            </div>
          </label>
          <label style={lStyle}>
            {'\uD83D\uDCC6'} Due
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <input type="date" value={due} onChange={e => setDue(e.target.value)}
                style={{ ...iStyle, ...(due ? { background: TH.amberBg } : {}) }} />
              {due && (
                <button onClick={() => setDue('')} style={{
                  fontSize: 9, background: 'none', border: 'none', color: TH.redText,
                  cursor: 'pointer', padding: 0, fontWeight: 700
                }}>{'\u2715'}</button>
              )}
            </div>
          </label>
          <label style={lStyle}>
            {'\u23F3'} Start after
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <input type="date" value={startAfter} onChange={e => setStartAfter(e.target.value)}
                style={{ ...iStyle, ...(startAfter ? { background: TH.blueBg } : {}) }} />
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
            {'\uD83D\uDD25'} Priority
            <select value={pri} onChange={e => setPri(e.target.value)} style={iStyle}>
              <option value="P1">{'\uD83D\uDD34'} P1 Critical</option>
              <option value="P2">{'\uD83D\uDFE0'} P2 High</option>
              <option value="P3">{'\uD83D\uDD35'} P3 Medium</option>
              <option value="P4">{'\u26AA'} P4 Low</option>
            </select>
          </label>
          <label style={lStyle}>
            {'\uD83D\uDD01'} Habit
            <button onClick={() => { setHabit(!habit); if (habit) setRigid(false); }} style={{
              padding: '3px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 600,
              border: '1px solid ' + (habit ? TH.greenBorder : TH.btnBorder),
              background: habit ? TH.greenBg : TH.inputBg,
              color: habit ? TH.greenText : TH.textMuted,
            }}>{habit ? '\uD83D\uDD01 Yes' : 'No'}</button>
          </label>
          {habit && (
            <label style={lStyle}>
              {'\uD83D\uDCCC'} Rigid
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => setRigid(!rigid)} style={{
                  padding: '3px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 600,
                  border: '1px solid ' + (rigid ? TH.accent : TH.btnBorder),
                  background: rigid ? TH.blueBg : TH.inputBg,
                  color: rigid ? TH.blueText : TH.textMuted,
                }}>{rigid ? '\uD83D\uDCCC Anchored' : '\uD83D\uDD01 Slidable'}</button>
                <span style={{ fontSize: 8, color: TH.textDim }}>{rigid ? 'Stays at set time' : 'Moves to fit schedule'}</span>
              </div>
            </label>
          )}
          <label style={lStyle}>
            {'\uD83D\uDCCD'} Location
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
              {(locations || []).map(loc => {
                var isOn = taskLoc.indexOf(loc.id) !== -1;
                return (
                  <button key={loc.id} onClick={() => {
                    setTaskLoc(isOn ? taskLoc.filter(x => x !== loc.id) : [...taskLoc, loc.id]);
                  }} style={{
                    padding: '3px 6px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                    fontWeight: isOn ? 600 : 400,
                    border: isOn ? '2px solid ' + TH.accent : '1px solid ' + TH.btnBorder,
                    background: isOn ? TH.blueBg : TH.bgCard,
                  }}>{loc.icon} {loc.name}</button>
                );
              })}
            </div>
            {taskLoc.length === 0 && <div style={{ fontSize: 9, color: TH.muted2, marginTop: 1 }}>No selection = anywhere</div>}
          </label>
        </div>

        {/* Row 4: Tools + When + Day req */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
          <label style={lStyle}>
            {'\uD83D\uDD27'} Tools needed
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
              {(tools || []).map(tool => {
                var isOn = taskTools.indexOf(tool.id) !== -1;
                return (
                  <button key={tool.id} onClick={() => {
                    setTaskTools(isOn ? taskTools.filter(x => x !== tool.id) : [...taskTools, tool.id]);
                  }} style={{
                    padding: '3px 6px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                    fontWeight: isOn ? 600 : 400,
                    border: isOn ? '2px solid ' + TH.accent : '1px solid ' + TH.btnBorder,
                    background: isOn ? TH.blueBg : TH.bgCard,
                  }}>{tool.icon} {tool.name}</button>
                );
              })}
            </div>
          </label>
          <label style={lStyle}>
            {'\uD83D\uDCC6'} When
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {(uniqueTags || []).concat([{ tag: 'fixed', name: 'Fixed', icon: '\uD83D\uDCCC', color: TH.muted2 }]).map(tb => {
                var parts = when ? when.split(',').map(s => s.trim()).filter(Boolean) : [];
                var isOn = parts.indexOf(tb.tag) !== -1;
                return (
                  <button key={tb.tag} onClick={() => {
                    var cur = when ? when.split(',').map(s => s.trim()).filter(Boolean) : [];
                    if (isOn) { cur = cur.filter(v => v !== tb.tag); }
                    else { cur.push(tb.tag); }
                    setWhen(cur.length === 0 ? '' : cur.join(','));
                  }} style={{
                    padding: '4px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    fontWeight: isOn ? 600 : 400,
                    border: isOn ? '2px solid ' + (tb.color || '#2563EB') : '1px solid ' + TH.btnBorder,
                    background: isOn ? (tb.color || TH.accent) + '22' : TH.bgCard,
                    color: isOn ? (tb.color || TH.accent) : TH.text,
                  }}>{tb.icon} {tb.name}</button>
                );
              })}
            </div>
            {(!when || when === 'anytime') && <div style={{ fontSize: 9, color: TH.muted2, marginTop: 2 }}>No selection = anytime</div>}
          </label>
        </div>

        {/* Row 5: Day req + Recurrence */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
          <label style={lStyle}>
            Day requirement
            <select value={dayReq} onChange={e => setDayReq(e.target.value)} style={iStyle}>
              <option value="any">Any day</option>
              <option value="weekday">Weekday</option>
              <option value="weekend">Weekend</option>
              <option value="M">Monday</option>
              <option value="T">Tuesday</option>
              <option value="W">Wednesday</option>
              <option value="R">Thursday</option>
              <option value="F">Friday</option>
              <option value="Sa">Saturday</option>
              <option value="Su">Sunday</option>
            </select>
          </label>
          <label style={lStyle}>
            {'\uD83D\uDD01'} Recurrence
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
                {[['M','Mon'],['T','Tue'],['W','Wed'],['R','Thu'],['F','Fri'],['S','Sat'],['U','Sun']].map(([code, label]) => {
                  var active = recurDays.includes(code);
                  return (
                    <button key={code} onClick={() => {
                      setRecurDays(active ? recurDays.replace(code, '') : recurDays + code);
                    }} style={{
                      padding: '3px 6px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                      border: '1px solid ' + (active ? TH.accent : TH.btnBorder),
                      background: active ? TH.accent + '20' : 'transparent',
                      color: active ? TH.accent : TH.textMuted,
                    }}>{label}</button>
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

        {/* Dependencies — hidden in create mode */}
        {!isCreate && task.dependsOn && task.dependsOn.length > 0 && (
          <div style={{ marginBottom: 5 }}>
            <label style={lStyle}>
              {'\uD83D\uDD17'} Dependencies ({task.dependsOn.length})
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                {task.dependsOn.map(depId => (
                  <span key={depId} style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 4,
                    background: TH.bgTertiary, color: TH.textMuted, fontFamily: 'monospace'
                  }}>{depId}</span>
                ))}
              </div>
            </label>
          </div>
        )}

        {!isCreate && onShowChain && (
          <button onClick={onShowChain} style={{
            border: '1px solid #0EA5E9', borderRadius: 4, padding: '4px 10px',
            background: 'transparent', color: '#0EA5E9', fontSize: 10, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', width: '100%', marginBottom: 5
          }}>Show Dependency Chain</button>
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
    </div>
  );
}
