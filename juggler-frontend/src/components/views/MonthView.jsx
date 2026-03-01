/**
 * MonthView — calendar month grid
 */

import React from 'react';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES, PRI_COLORS, STATUS_MAP } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';

export default function MonthView({ selectedDate, dayPlacements, statuses, tasksByDate, onExpand, setDayOffset, today, darkMode, onDateDrop }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(today);
  var year = selectedDate.getFullYear();
  var month = selectedDate.getMonth();
  var firstDay = new Date(year, month, 1);
  var startDow = firstDay.getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  var cells = [];
  for (var i = 0; i < startDow; i++) cells.push(null);
  for (var d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {DAY_NAMES.map(dn => (
          <div key={dn} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: theme.textMuted, padding: 4 }}>{dn}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          var dateObj = new Date(year, month, day);
          var key = formatDateKey(dateObj);
          var isToday = key === todayKey;
          var tasks = tasksByDate[key] || [];
          var doneCount = tasks.filter(t => (statuses[t.id] || '') === 'done').length;

          return (
            <div key={i}
              onClick={() => setDayOffset(Math.round((dateObj - today) / 86400000))}
              onDragOver={onDateDrop ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }) : undefined}
              onDrop={onDateDrop ? (e => { e.stopPropagation(); onDateDrop(e, key); }) : undefined}
              style={{
                border: `1px solid ${isToday ? theme.accent : theme.border}`,
                borderRadius: 6, padding: 4, minHeight: 80, cursor: 'pointer',
                background: isToday ? theme.accent + '10' : theme.card,
                fontSize: 11
              }}>
              <div style={{ fontWeight: isToday ? 700 : 500, color: isToday ? theme.accent : theme.text, marginBottom: 2 }}>
                {day}
                {tasks.length > 0 && <span style={{ fontSize: 9, color: theme.textMuted, marginLeft: 4 }}>{doneCount}/{tasks.length}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {tasks.slice(0, 4).map(t => {
                  var st = statuses[t.id] || '';
                  var isDone = st === 'done' || st === 'cancel' || st === 'skip';
                  return (
                    <div key={t.id} draggable
                      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onClick={e => { e.stopPropagation(); onExpand(t.id); }}
                      style={{
                        fontSize: 9, padding: '1px 4px', borderRadius: 3,
                        borderLeft: `2px solid ${PRI_COLORS[t.pri] || PRI_COLORS.P3}`,
                        color: isDone ? theme.textMuted : theme.text,
                        textDecoration: isDone ? 'line-through' : 'none',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        background: theme.bgTertiary
                      }}>
                      {t.text}
                    </div>
                  );
                })}
                {tasks.length > 4 && <div style={{ fontSize: 8, color: theme.textMuted }}>+{tasks.length - 4} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
