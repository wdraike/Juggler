/**
 * TaskEditForm — full editor with all task fields
 */

import React, { useState } from 'react';
import { PRI_COLORS, STATUS_OPTIONS } from '../../state/constants';
import { toTime24, fromTime24, toDateISO, fromDateISO } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';
import ConfirmDialog from '../features/ConfirmDialog';

export default function TaskEditForm({ task, status, direction, onUpdate, onStatusChange, onDirectionChange, onDelete, onClose, onShowChain, allProjectNames, locations, tools, uniqueTags, darkMode }) {
  var theme = getTheme(darkMode);
  var [text, setText] = useState(task.text || '');
  var [project, setProject] = useState(task.project || '');
  var [pri, setPri] = useState(task.pri || 'P3');
  var [date, setDate] = useState(toDateISO(task.date));
  var [time, setTime] = useState(toTime24(task.time));
  var [dur, setDur] = useState(task.dur || 30);
  var [timeRemaining, setTimeRemaining] = useState(task.timeRemaining != null ? task.timeRemaining : '');
  var [due, setDue] = useState(toDateISO(task.due));
  var [startAfter, setStartAfter] = useState(toDateISO(task.startAfter));
  var [notes, setNotes] = useState(task.notes || '');
  var [when, setWhen] = useState(task.when || '');
  var [dayReq, setDayReq] = useState(task.dayReq || 'any');
  var [habit, setHabit] = useState(!!task.habit);
  var [rigid, setRigid] = useState(!!task.rigid);
  var [split, setSplit] = useState(task.split);
  var [splitMin, setSplitMin] = useState(task.splitMin || '');
  var [taskLoc, setTaskLoc] = useState(task.location || []);
  var [taskTools, setTaskTools] = useState(task.tools || []);
  var [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  var [recurType, setRecurType] = useState(task.recur?.type || 'none');
  var [recurDays, setRecurDays] = useState(task.recur?.days || 'MTWRF');
  var [recurEvery, setRecurEvery] = useState(task.recur?.every || 2);

  function save() {
    var d = fromDateISO(date);
    var dayName = '';
    if (d) {
      var pd = new Date(2026, parseInt(d.split('/')[0]) - 1, parseInt(d.split('/')[1]));
      dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][pd.getDay()];
    }
    onUpdate(task.id, {
      text, project, pri,
      date: d || task.date,
      day: dayName || task.day,
      time: fromTime24(time),
      dur: parseInt(dur) || 30,
      timeRemaining: timeRemaining === '' ? null : parseInt(timeRemaining),
      due: fromDateISO(due),
      startAfter: fromDateISO(startAfter),
      notes, when, dayReq, habit, rigid,
      split: split === undefined ? undefined : split,
      splitMin: splitMin ? parseInt(splitMin) : null,
      location: taskLoc,
      tools: taskTools,
      recur: recurType === 'none' ? null : {
        type: recurType,
        days: recurType === 'weekly' || recurType === 'biweekly' ? recurDays : undefined,
        every: recurType === 'interval' ? parseInt(recurEvery) || 2 : undefined
      }
    });
    onClose();
  }

  var inputStyle = {
    padding: '6px 10px', border: `1px solid ${theme.inputBorder}`, borderRadius: 6,
    background: theme.input, color: theme.text, fontSize: 13, fontFamily: 'inherit', width: '100%', outline: 'none'
  };
  var labelStyle = { fontSize: 11, color: theme.textMuted, marginBottom: 2, display: 'block' };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, maxWidth: '100vw',
      background: theme.bgSecondary, borderLeft: `1px solid ${theme.border}`,
      zIndex: 200, overflow: 'auto', padding: 16, boxShadow: `-4px 0 20px ${theme.shadow}`
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>Edit Task</div>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: theme.textMuted, fontSize: 18, cursor: 'pointer' }}>&times;</button>
      </div>

      {/* Status buttons */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Status</label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(s => {
            var isActive = (status || '') === s.value;
            var sBg = darkMode ? s.bgDark : s.bg;
            var sColor = darkMode ? s.colorDark : s.color;
            return (
              <button key={s.value} onClick={() => { if (onStatusChange) onStatusChange(s.value); }} title={s.tip} style={{
                border: `1px solid ${isActive ? sColor : theme.border}`,
                borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                background: isActive ? sBg : 'transparent',
                color: isActive ? sColor : theme.textMuted,
                fontSize: 11, fontWeight: isActive ? 700 : 500, fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 3
              }}>
                <span style={{ fontSize: 13 }}>{s.label}</span> {s.tip.split(' \u2014 ')[0]}
              </button>
            );
          })}
        </div>
        {status === 'other' && (
          <div style={{ marginTop: 6 }}>
            <input
              value={direction || ''}
              onChange={e => { if (onDirectionChange) onDirectionChange(e.target.value); }}
              placeholder="What are you doing instead?"
              style={{ ...inputStyle, fontSize: 12 }}
            />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>Task</label>
          <input value={text} onChange={e => setText(e.target.value)} style={inputStyle} autoFocus />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Project</label>
            <input value={project} onChange={e => setProject(e.target.value)} list="project-list" style={inputStyle} />
            <datalist id="project-list">
              {(allProjectNames || []).map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div style={{ width: 80 }}>
            <label style={labelStyle}>Priority</label>
            <select value={pri} onChange={e => setPri(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              {['P1','P2','P3','P4'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Duration (min)</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input type="number" value={dur} onChange={e => setDur(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
              <select value="" onChange={e => { if (e.target.value) setDur(parseInt(e.target.value)); }}
                style={{ ...inputStyle, width: 'auto', minWidth: 60, cursor: 'pointer' }}>
                <option value="">Preset</option>
                <option value="15">15m</option>
                <option value="30">30m</option>
                <option value="45">45m</option>
                <option value="60">1h</option>
                <option value="90">1.5h</option>
                <option value="120">2h</option>
                <option value="180">3h</option>
                <option value="240">4h</option>
              </select>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Remaining (min)</label>
            <input type="number" value={timeRemaining} onChange={e => setTimeRemaining(e.target.value)} placeholder="—" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Due Date</label>
            <input type="date" value={due} onChange={e => setDue(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Start After</label>
            <input type="date" value={startAfter} onChange={e => setStartAfter(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>When (time blocks)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(uniqueTags || []).map(tag => {
              var selected = when && when.split(',').map(s => s.trim()).includes(tag.tag);
              return (
                <button key={tag.tag} onClick={() => {
                  var parts = when ? when.split(',').map(s => s.trim()).filter(Boolean) : [];
                  if (selected) { parts = parts.filter(p => p !== tag.tag); }
                  else { parts.push(tag.tag); }
                  setWhen(parts.join(','));
                }} style={{
                  border: `1px solid ${selected ? tag.color : theme.border}`,
                  background: selected ? tag.color + '30' : 'transparent',
                  color: selected ? tag.color : theme.textMuted,
                  borderRadius: 12, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
                }}>
                  {tag.icon} {tag.name}
                </button>
              );
            })}
            <button onClick={() => {
              var parts = when ? when.split(',').map(s => s.trim()).filter(Boolean) : [];
              var hasFix = parts.includes('fixed');
              if (hasFix) parts = parts.filter(p => p !== 'fixed');
              else parts.push('fixed');
              setWhen(parts.join(','));
            }} style={{
              border: `1px solid ${when && when.includes('fixed') ? '#EF4444' : theme.border}`,
              background: when && when.includes('fixed') ? '#EF444430' : 'transparent',
              color: when && when.includes('fixed') ? '#EF4444' : theme.textMuted,
              borderRadius: 12, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
            }}>
              &#x1F4CC; Fixed
            </button>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Day requirement</label>
          <select value={dayReq} onChange={e => setDayReq(e.target.value)} style={inputStyle}>
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
        </div>

        <div>
          <label style={labelStyle}>Location</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(locations || []).map(loc => {
              var selected = taskLoc.includes(loc.id);
              return (
                <button key={loc.id} onClick={() => {
                  setTaskLoc(selected ? taskLoc.filter(l => l !== loc.id) : [...taskLoc, loc.id]);
                }} style={{
                  border: `1px solid ${selected ? theme.accent : theme.border}`,
                  background: selected ? theme.accent + '20' : 'transparent',
                  color: selected ? theme.accent : theme.textMuted,
                  borderRadius: 12, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
                }}>
                  {loc.icon} {loc.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={labelStyle}>Tools required</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(tools || []).map(tool => {
              var selected = taskTools.includes(tool.id);
              return (
                <button key={tool.id} onClick={() => {
                  setTaskTools(selected ? taskTools.filter(t => t !== tool.id) : [...taskTools, tool.id]);
                }} style={{
                  border: `1px solid ${selected ? theme.accent : theme.border}`,
                  background: selected ? theme.accent + '20' : 'transparent',
                  color: selected ? theme.accent : theme.textMuted,
                  borderRadius: 12, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
                }}>
                  {tool.icon} {tool.name}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <label style={{ fontSize: 12, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={habit} onChange={e => setHabit(e.target.checked)} /> Habit
          </label>
          <label style={{ fontSize: 12, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={rigid} onChange={e => setRigid(e.target.checked)} /> Rigid
          </label>
          <label style={{ fontSize: 12, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={split === true} onChange={e => setSplit(e.target.checked ? true : undefined)} /> Splittable
          </label>
          {split === true && (
            <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 4 }}>
              Min chunk:
              <input type="number" value={splitMin} onChange={e => setSplitMin(e.target.value)} placeholder="15"
                style={{ width: 50, padding: '2px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11 }} />
              m
            </label>
          )}
        </div>

        {/* Recurrence editor */}
        <div>
          <label style={labelStyle}>Recurrence</label>
          <select value={recurType} onChange={e => setRecurType(e.target.value)} style={inputStyle}>
            <option value="none">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="interval">Every N days</option>
          </select>
          {(recurType === 'weekly' || recurType === 'biweekly') && (
            <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
              {[['M','Mon'],['T','Tue'],['W','Wed'],['R','Thu'],['F','Fri'],['S','Sat'],['U','Sun']].map(([code, label]) => {
                var active = recurDays.includes(code);
                return (
                  <button key={code} onClick={() => {
                    setRecurDays(active ? recurDays.replace(code, '') : recurDays + code);
                  }} style={{
                    border: `1px solid ${active ? theme.accent : theme.border}`,
                    background: active ? theme.accent + '20' : 'transparent',
                    color: active ? theme.accent : theme.textMuted,
                    borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
                  }}>{label}</button>
                );
              })}
            </div>
          )}
          {recurType === 'interval' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span style={{ fontSize: 12, color: theme.text }}>Every</span>
              <input type="number" value={recurEvery} onChange={e => setRecurEvery(e.target.value)} min={2}
                style={{ ...inputStyle, width: 60 }} />
              <span style={{ fontSize: 12, color: theme.text }}>days</span>
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
        </div>

        {/* Dependencies */}
        {task.dependsOn && task.dependsOn.length > 0 && (
          <div>
            <label style={labelStyle}>Dependencies ({task.dependsOn.length})</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {task.dependsOn.map(depId => (
                <span key={depId} style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: theme.bgTertiary, color: theme.textMuted, fontFamily: 'monospace'
                }}>{depId}</span>
              ))}
            </div>
          </div>
        )}

        {onShowChain && (
          <button onClick={onShowChain} style={{
            border: `1px solid #0EA5E9`, borderRadius: 8, padding: '8px 16px',
            background: 'transparent', color: '#0EA5E9', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', width: '100%'
          }}>Show Dependency Chain</button>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={save} style={{
            flex: 1, border: 'none', borderRadius: 8, padding: '10px 16px',
            background: theme.accent, color: '#FFF', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>Save</button>
          <button onClick={onClose} style={{
            border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 16px',
            background: 'transparent', color: theme.textSecondary, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>Cancel</button>
          {onDelete && (
            <button onClick={() => setShowDeleteConfirm(true)} style={{
              border: `1px solid #EF4444`, borderRadius: 8, padding: '10px 16px',
              background: 'transparent', color: '#EF4444', fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit'
            }}>Delete</button>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          message={'Delete "' + (task.text || 'this task').slice(0, 60) + '"?'}
          onConfirm={() => { onDelete(task.id); onClose(); }}
          onCancel={() => setShowDeleteConfirm(false)}
          darkMode={darkMode}
        />
      )}
    </div>
  );
}
