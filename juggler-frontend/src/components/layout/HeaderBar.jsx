/**
 * HeaderBar — progress bar, AI input, menu buttons, dark mode toggle
 * On mobile: overflow menu hides infrequent buttons behind "..."
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getTheme, BRAND } from '../../theme/colors';
import { DAY_NAMES } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';

export default function HeaderBar({ darkMode, setDarkMode, saving, selectedDateKey, statuses, tasksByDate, onShowSettings, onShowExport, onShowGCalSync, gcalSyncing, onShowMsftCalSync, msftCalSyncing, calSyncing, onShowCalSync, onShowHelp, onAddTask, isMobile, aiPanel, weekStripDates, selectedDate, dayOffset, setDayOffset, today }) {
  var theme = getTheme(darkMode);
  var { user, logout } = useAuth();
  var [showOverflow, setShowOverflow] = useState(false);
  var overflowRef = useRef(null);

  // Close overflow on outside click
  useEffect(function() {
    if (!showOverflow) return;
    function handleClick(e) {
      if (overflowRef.current && !overflowRef.current.contains(e.target)) setShowOverflow(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [showOverflow]);

  var dayTasks = tasksByDate[selectedDateKey] || [];
  var doneCount = dayTasks.filter(t => statuses[t.id] === 'done' || statuses[t.id] === 'cancel' || statuses[t.id] === 'skip').length;
  var totalCount = dayTasks.filter(t => statuses[t.id] !== 'cancel' && statuses[t.id] !== 'skip').length;
  var pct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;

  // Overflow menu items for mobile
  var overflowItems = [];
  if (isMobile) {
    overflowItems.push({ label: 'Settings', icon: '\u2699\uFE0F', onClick: onShowSettings });
    overflowItems.push({ label: 'Import/Export', icon: '\uD83D\uDCE6', onClick: onShowExport });
    if (onShowCalSync || onShowGCalSync || onShowMsftCalSync) overflowItems.push({ label: 'Calendar Sync', icon: '\uD83D\uDCC5', onClick: onShowCalSync || onShowGCalSync || onShowMsftCalSync });
    if (onShowHelp) overflowItems.push({ label: 'Help', icon: '\u2753', onClick: onShowHelp });
    overflowItems.push({ label: darkMode ? 'Light Mode' : 'Dark Mode', icon: darkMode ? '\u2600\uFE0F' : '\uD83C\uDF19', onClick: function() { setDarkMode(function(d) { return !d; }); } });
    if (user) overflowItems.push({ label: 'Logout', icon: '\uD83D\uDEAA', onClick: logout });
  }

  return (
    <>
    {gcalSyncing && <style>{`@keyframes gcal-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>}
    <div style={{
      display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, padding: isMobile ? '6px 8px' : '8px 16px',
      background: theme.headerBg, borderBottom: '2px solid ' + theme.accent + '4D',
      position: 'sticky', top: 0, zIndex: 100
    }}>
      {!isMobile && <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '4px 10px', borderLeft: '2px solid ' + theme.accent }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: theme.accent, opacity: 0.7 }}>by Raike &amp; Sons</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 20, color: theme.headerText, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Strive<span style={{ color: theme.accent }}>RS</span></div>
      </div>}
      {isMobile && <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0, padding: '2px 6px', borderLeft: '2px solid ' + theme.accent }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 6, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: theme.accent, opacity: 0.7 }}>R&amp;S</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 15, color: theme.headerText, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Strive<span style={{ color: theme.accent }}>RS</span></div>
      </div>}

      {/* Progress bar */}
      <div title={doneCount + ' of ' + totalCount + ' tasks done today (' + pct + '%)'} style={{ flex: 0, minWidth: isMobile ? 50 : 80, maxWidth: isMobile ? 80 : 140, height: 6, background: theme.headerTrack, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? theme.success : theme.accent, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: theme.headerTextMuted, minWidth: 28 }} title={doneCount + ' of ' + totalCount + ' tasks done today'}>{pct}%</span>

      {/* AI command input — inline in header */}
      {aiPanel}

      {/* Inline week strip — fills the gap between AI input and action buttons */}
      {!isMobile && weekStripDates && (function() {
        var todayKey = formatDateKey(today);
        var SHORT_DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        var dateInputValue = selectedDate.getFullYear() + '-' +
          String(selectedDate.getMonth() + 1).padStart(2, '0') + '-' +
          String(selectedDate.getDate()).padStart(2, '0');
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, justifyContent: 'center' }}>
            <button onClick={function() { setDayOffset(function(d) { return d - 7; }); }} style={weekNavBtn(theme)} title="Previous week">&laquo;</button>
            <button onClick={function() { setDayOffset(function(d) { return d - 1; }); }} style={weekNavBtn(theme)} title="Previous day">&lsaquo;</button>
            {weekStripDates.map(function(d, i) {
              var key = formatDateKey(d);
              var isSelected = d.getTime() === selectedDate.getTime();
              var isToday = key === todayKey;
              var dayTasks = tasksByDate[key] || [];
              var doneCount = dayTasks.filter(function(t) { return statuses[t.id] === 'done'; }).length;
              var totalCount = dayTasks.length;
              return (
                <button key={i} onClick={function() { setDayOffset(Math.round((d - today) / 86400000)); }}
                  title={DAY_NAMES[d.getDay()] + ' ' + (d.getMonth()+1) + '/' + d.getDate() + (totalCount > 0 ? ' (' + doneCount + '/' + totalCount + ')' : '')}
                  style={{
                    border: 'none', borderRadius: 2, padding: '2px 6px', cursor: 'pointer',
                    background: isSelected ? theme.accent : 'transparent',
                    color: isSelected ? BRAND.navy : isToday ? BRAND.goldLight : theme.headerTextMuted,
                    fontWeight: isSelected || isToday ? 700 : 400,
                    fontSize: 11, fontFamily: "'Inter', sans-serif", textAlign: 'center',
                    minWidth: 36, lineHeight: 1.2
                  }}>
                  <div style={{ fontSize: 9, opacity: 0.6 }}>{DAY_NAMES[d.getDay()]}</div>
                  <div>{d.getDate()}</div>
                  {totalCount > 0 && (
                    <div style={{ fontSize: 7, opacity: 0.5 }}>{doneCount}/{totalCount}</div>
                  )}
                </button>
              );
            })}
            <button onClick={function() { setDayOffset(function(d) { return d + 1; }); }} style={weekNavBtn(theme)} title="Next day">&rsaquo;</button>
            <button onClick={function() { setDayOffset(function(d) { return d + 7; }); }} style={weekNavBtn(theme)} title="Next week">&raquo;</button>
            <input type="date" value={dateInputValue} onChange={function(e) {
              var d2 = new Date(e.target.value + 'T12:00:00');
              if (!isNaN(d2)) setDayOffset(Math.round((d2 - today) / 86400000));
            }} style={{
              padding: '2px 3px', borderRadius: 2, fontSize: 10,
              border: '1px solid ' + theme.headerTrack,
              background: theme.headerTrack, color: theme.headerTextMuted,
              cursor: 'pointer', fontFamily: "'Inter', sans-serif"
            }} title="Jump to any date" />
            <button onClick={function() { setDayOffset(0); }} style={{
              ...weekNavBtn(theme), fontSize: 10, padding: '3px 8px', fontWeight: 600
            }} title="Go to today">Today</button>
          </div>
        );
      })()}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'inherit', ...(isMobile ? { marginLeft: 'auto' } : {}) }}>
        {saving && <span style={{ fontSize: 11, color: theme.textMuted }}>Saving...</span>}

        {onAddTask && <button onClick={onAddTask} style={{ ...btnStyle(theme, isMobile), fontSize: 20, fontWeight: 700, color: '#10B981' }} title="Add task">+</button>}

        {/* Desktop: show all buttons inline */}
        {!isMobile && (
          <>
            <button onClick={onShowSettings} style={btnStyle(theme, isMobile)} title="Settings \u2014 locations, tools, templates, and preferences">&#x2699;&#xFE0F;</button>
            <button onClick={onShowExport} style={btnStyle(theme, isMobile)} title="Import/Export \u2014 save or load tasks as JSON">&#x1F4E6;</button>
            {(onShowGCalSync || onShowMsftCalSync) && (
              <button onClick={onShowCalSync || onShowGCalSync || onShowMsftCalSync} style={{ ...btnStyle(theme, isMobile), position: 'relative' }} title="Calendar Sync \u2014 bidirectional sync with connected calendars">
                <span style={calSyncing ? { display: 'inline-block', animation: 'gcal-spin 1s linear infinite' } : undefined}>&#x1F4C5;</span>
                {calSyncing && <span style={{ position: 'absolute', top: -2, right: -2, width: 6, height: 6, borderRadius: '50%', background: theme.accent }} />}
              </button>
            )}
            {onShowHelp && <button onClick={onShowHelp} style={btnStyle(theme, isMobile)} title="Help guide \u2014 how the scheduler works, task properties, keyboard shortcuts">&#x2753;</button>}
            <button onClick={() => setDarkMode(d => !d)} style={btnStyle(theme, isMobile)} title="Toggle dark mode">
              {darkMode ? '\u2600\uFE0F' : '\uD83C\uDF19'}
            </button>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {user.picture && (
                  <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: 12 }} />
                )}
                <button onClick={logout} style={{ ...btnStyle(theme, isMobile), fontSize: 11 }}>Logout</button>
              </div>
            )}
          </>
        )}

        {/* Mobile: overflow menu button */}
        {isMobile && (
          <div ref={overflowRef} style={{ position: 'relative' }}>
            <button onClick={function() { setShowOverflow(function(v) { return !v; }); }} style={{ ...btnStyle(theme, isMobile), fontSize: 18, fontWeight: 700 }} title="More options">
              &#x22EF;
            </button>
            {showOverflow && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: theme.bgSecondary, border: '1px solid ' + theme.border,
                borderRadius: 2, boxShadow: '0 2px 8px ' + theme.shadow,
                zIndex: 200, minWidth: 180, overflow: 'hidden'
              }}>
                {user && user.picture && (
                  <div style={{ padding: '8px 14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: 12 }} />
                    <span style={{ fontSize: 12, color: theme.textMuted }}>{user.name || user.email || ''}</span>
                  </div>
                )}
                {overflowItems.map(function(item, i) {
                  return (
                    <button key={i} onClick={function() { if (item.disabled) return; setShowOverflow(false); item.onClick(); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        border: 'none', background: 'transparent', cursor: item.disabled ? 'default' : 'pointer',
                        padding: '12px 14px', fontSize: 14, color: item.disabled ? theme.textMuted : theme.text,
                        fontFamily: 'inherit', textAlign: 'left',
                        minHeight: 44, opacity: item.disabled ? 0.6 : 1,
                        borderTop: i === 0 && !(user && user.picture) ? 'none' : undefined
                      }}>
                      <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{item.icon}</span>
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function btnStyle(theme, isMobile) {
  return {
    border: 'none', background: 'transparent', cursor: 'pointer',
    color: theme.headerTextMuted, fontSize: 16,
    padding: isMobile ? '8px' : '4px 6px',
    borderRadius: 2, fontFamily: "'Inter', sans-serif",
    minWidth: isMobile ? 36 : undefined,
    minHeight: isMobile ? 36 : undefined
  };
}

function weekNavBtn(theme) {
  return {
    border: '1px solid ' + theme.headerTrack, borderRadius: 2, background: 'transparent',
    color: theme.headerTextMuted, cursor: 'pointer',
    padding: '3px 6px', fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 600,
    minHeight: 28, minWidth: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  };
}
