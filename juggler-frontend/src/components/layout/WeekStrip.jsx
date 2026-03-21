/**
 * WeekStrip — day selector strip with week navigation + date picker
 * On mobile: no task counts, no date picker, reduced padding
 */

import React from 'react';
import { DAY_NAMES } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { getTheme } from '../../theme/colors';

var SHORT_DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function WeekStrip({ weekStripDates, selectedDate, dayOffset, setDayOffset, today, darkMode, statuses, tasksByDate, isMobile }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(today);

  var dateInputValue = selectedDate.getFullYear() + '-' +
    String(selectedDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(selectedDate.getDate()).padStart(2, '0');

  var handleDatePick = function(e) {
    var parts = e.target.value.split('-');
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setHours(0, 0, 0, 0);
    if (!isNaN(d)) setDayOffset(Math.round((d - today) / 86400000));
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: isMobile ? '4px 8px' : '8px 12px', background: theme.bgSecondary, borderBottom: `1px solid ${theme.border}` }}>
      {!isMobile && <button onClick={() => setDayOffset(d => d - 7)} style={navBtnStyle(theme, isMobile)} title="Previous week">&laquo;</button>}
      <button onClick={() => setDayOffset(d => d - 1)} style={navBtnStyle(theme, isMobile)} title="Previous day">&lsaquo;</button>

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
                border: 'none', borderRadius: 8, padding: isMobile ? '4px 2px' : '6px 10px', cursor: 'pointer',
                background: isSelected ? theme.accent : 'transparent',
                color: isSelected ? theme.bg : isToday ? theme.accent : theme.text,
                fontWeight: isSelected || isToday ? 600 : 400,
                fontSize: 12, fontFamily: 'inherit', textAlign: 'center',
                minWidth: isMobile ? 38 : 48, position: 'relative',
                minHeight: isMobile ? 36 : undefined
              }}>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{isMobile ? SHORT_DAY[d.getDay()] : DAY_NAMES[d.getDay()]}</div>
              <div>{d.getDate()}</div>
              {/* Task counts — desktop only */}
              {!isMobile && totalCount > 0 && (
                <div style={{ fontSize: 8, opacity: 0.6, marginTop: 1 }}>
                  {doneCount}/{totalCount}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <button onClick={() => setDayOffset(d => d + 1)} style={navBtnStyle(theme, isMobile)} title="Next day">&rsaquo;</button>
      {!isMobile && <button onClick={() => setDayOffset(d => d + 7)} style={navBtnStyle(theme, isMobile)} title="Next week">&raquo;</button>}
      {/* Date picker — desktop only */}
      {!isMobile && (
        <input type="date" value={dateInputValue} onChange={handleDatePick}
          style={{
            padding: '3px 4px', borderRadius: 6, fontSize: 10,
            border: `1px solid ${theme.border}`,
            background: theme.input, color: theme.textMuted,
            cursor: 'pointer', fontFamily: 'inherit'
          }}
          title="Jump to any date"
        />
      )}
      <button onClick={() => setDayOffset(0)} style={{
        ...navBtnStyle(theme, isMobile), fontSize: 11, padding: isMobile ? '6px 10px' : '6px 12px', fontWeight: 600
      }} title="Go to today">Today</button>
    </div>
  );
}

function navBtnStyle(theme, isMobile) {
  return {
    border: `1px solid ${theme.border}`, borderRadius: 6, background: 'transparent',
    color: theme.textSecondary, cursor: 'pointer',
    padding: isMobile ? '6px 10px' : '6px 12px',
    fontSize: isMobile ? 18 : 20,
    fontFamily: 'inherit', fontWeight: 600,
    minHeight: isMobile ? 36 : 32,
    minWidth: isMobile ? 36 : 32,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  };
}
