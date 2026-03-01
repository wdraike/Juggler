/**
 * WeekStrip — day selector strip with week navigation
 */

import React from 'react';
import { DAY_NAMES } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';

export default function WeekStrip({ weekStripDates, selectedDate, dayOffset, setDayOffset, today, darkMode, statuses, tasksByDate }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(today);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', background: theme.bgSecondary, borderBottom: `1px solid ${theme.border}` }}>
      <button onClick={() => setDayOffset(d => d - 7)} style={navBtnStyle(theme)} title="Previous week">&laquo;</button>
      <button onClick={() => setDayOffset(d => d - 1)} style={navBtnStyle(theme)} title="Previous day">&lsaquo;</button>

      <div style={{ display: 'flex', gap: 2, flex: 1, justifyContent: 'center' }}>
        {weekStripDates.map((d, i) => {
          var key = formatDateKey(d);
          var isSelected = d.getTime() === selectedDate.getTime();
          var isToday = key === todayKey;
          var dayTasks = tasksByDate[key] || [];
          var doneCount = dayTasks.filter(t => statuses[t.id] === 'done').length;
          var totalCount = dayTasks.length;

          return (
            <button key={i} onClick={() => setDayOffset(Math.round((d - today) / 86400000))}
              style={{
                border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                background: isSelected ? theme.accent : 'transparent',
                color: isSelected ? '#FFFFFF' : isToday ? theme.accent : theme.text,
                fontWeight: isSelected || isToday ? 600 : 400,
                fontSize: 12, fontFamily: 'inherit', textAlign: 'center',
                minWidth: 48, position: 'relative'
              }}>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{DAY_NAMES[d.getDay()]}</div>
              <div>{d.getDate()}</div>
              {totalCount > 0 && (
                <div style={{ fontSize: 8, opacity: 0.6, marginTop: 1 }}>
                  {doneCount}/{totalCount}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <button onClick={() => setDayOffset(d => d + 1)} style={navBtnStyle(theme)} title="Next day">&rsaquo;</button>
      <button onClick={() => setDayOffset(d => d + 7)} style={navBtnStyle(theme)} title="Next week">&raquo;</button>
      <button onClick={() => setDayOffset(0)} style={{
        ...navBtnStyle(theme), fontSize: 11, padding: '4px 8px', fontWeight: 600
      }} title="Go to today">Today</button>
    </div>
  );
}

function navBtnStyle(theme) {
  return {
    border: `1px solid ${theme.border}`, borderRadius: 6, background: 'transparent',
    color: theme.textSecondary, cursor: 'pointer', padding: '4px 8px', fontSize: 14,
    fontFamily: 'inherit'
  };
}
