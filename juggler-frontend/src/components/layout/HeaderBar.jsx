/**
 * HeaderBar — progress bar, menu, dark mode toggle
 */

import React from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getTheme } from '../../theme/colors';

export default function HeaderBar({ darkMode, setDarkMode, saving, selectedDateKey, statuses, tasksByDate, onShowSettings, onShowExport, onShowGCalSync, gcalSyncing, onReschedule, onShowHelp, onAddTask, isMobile }) {
  var theme = getTheme(darkMode);
  var { user, logout } = useAuth();

  var dayTasks = tasksByDate[selectedDateKey] || [];
  var doneCount = dayTasks.filter(t => statuses[t.id] === 'done' || statuses[t.id] === 'cancel' || statuses[t.id] === 'skip').length;
  var totalCount = dayTasks.filter(t => statuses[t.id] !== 'cancel' && statuses[t.id] !== 'skip').length;
  var pct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;

  return (
    <>
    {gcalSyncing && <style>{`@keyframes gcal-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>}
    <div style={{
      display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, padding: isMobile ? '6px 8px' : '8px 16px',
      background: theme.headerBg, borderBottom: `1px solid ${theme.border}`,
      position: 'sticky', top: 0, zIndex: 100
    }}>
      <div style={{ fontSize: 20 }}>&#x1F939;</div>
      {!isMobile && <div style={{ fontWeight: 700, fontSize: 16, color: theme.text }}>Juggler</div>}

      {/* Progress bar */}
      <div style={{ flex: 1, maxWidth: isMobile ? 80 : 200, height: 6, background: theme.bgTertiary, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#10B981' : '#3B82F6', borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: theme.textMuted, minWidth: 32 }}>{pct}%</span>

      <div style={{ flex: 1 }} />

      {saving && <span style={{ fontSize: 11, color: theme.textMuted }}>Saving...</span>}

      {onAddTask && <button onClick={onAddTask} style={{ ...btnStyle(theme, isMobile), fontSize: 20, fontWeight: 700, color: '#10B981' }} title="Add task">+</button>}
      {onReschedule && <button onClick={onReschedule} style={btnStyle(theme, isMobile)} title="Reschedule">&#x1F504;</button>}
      <button onClick={onShowSettings} style={btnStyle(theme, isMobile)} title="Settings">&#x2699;&#xFE0F;</button>
      <button onClick={onShowExport} style={btnStyle(theme, isMobile)} title="Import/Export">&#x1F4E6;</button>
      {onShowGCalSync && (
        <button onClick={onShowGCalSync} style={{ ...btnStyle(theme, isMobile), position: 'relative' }} title="Google Calendar Sync">
          <span style={gcalSyncing ? { display: 'inline-block', animation: 'gcal-spin 1s linear infinite' } : undefined}>&#x1F4C5;</span>
          {gcalSyncing && <span style={{ position: 'absolute', top: -2, right: -2, width: 6, height: 6, borderRadius: '50%', background: '#3B82F6' }} />}
        </button>
      )}
      {onShowHelp && <button onClick={onShowHelp} style={btnStyle(theme, isMobile)} title="Help & Shortcuts">&#x2753;</button>}
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
    </div>
    </>
  );
}

function btnStyle(theme, isMobile) {
  return {
    border: 'none', background: 'transparent', cursor: 'pointer',
    color: theme.textSecondary, fontSize: 16,
    padding: isMobile ? '8px' : '4px 6px',
    borderRadius: 6, fontFamily: 'inherit',
    minWidth: isMobile ? 36 : undefined,
    minHeight: isMobile ? 36 : undefined
  };
}
