/**
 * HeaderBar — progress bar, menu, dark mode toggle
 */

import React from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getTheme } from '../../theme/colors';

export default function HeaderBar({ darkMode, setDarkMode, saving, selectedDateKey, statuses, tasksByDate, onShowSettings, onShowExport, onShowGCalSync, gcalSyncing, onReschedule, onShowHelp }) {
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
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
      background: theme.headerBg, borderBottom: `1px solid ${theme.border}`,
      position: 'sticky', top: 0, zIndex: 100
    }}>
      <div style={{ fontSize: 20 }}>&#x1F939;</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: theme.text }}>Juggler</div>

      {/* Progress bar */}
      <div style={{ flex: 1, maxWidth: 200, height: 6, background: theme.bgTertiary, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#10B981' : '#3B82F6', borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: theme.textMuted, minWidth: 32 }}>{pct}%</span>

      <div style={{ flex: 1 }} />

      {saving && <span style={{ fontSize: 11, color: theme.textMuted }}>Saving...</span>}

      {onReschedule && <button onClick={onReschedule} style={btnStyle(theme)} title="Reschedule">&#x1F504;</button>}
      <button onClick={onShowSettings} style={btnStyle(theme)} title="Settings">&#x2699;&#xFE0F;</button>
      <button onClick={onShowExport} style={btnStyle(theme)} title="Import/Export">&#x1F4E6;</button>
      {onShowGCalSync && (
        <button onClick={onShowGCalSync} style={{ ...btnStyle(theme), position: 'relative' }} title="Google Calendar Sync">
          <span style={gcalSyncing ? { display: 'inline-block', animation: 'gcal-spin 1s linear infinite' } : undefined}>&#x1F4C5;</span>
          {gcalSyncing && <span style={{ position: 'absolute', top: -2, right: -2, width: 6, height: 6, borderRadius: '50%', background: '#3B82F6' }} />}
        </button>
      )}
      {onShowHelp && <button onClick={onShowHelp} style={btnStyle(theme)} title="Help & Shortcuts">&#x2753;</button>}
      <button onClick={() => setDarkMode(d => !d)} style={btnStyle(theme)} title="Toggle dark mode">
        {darkMode ? '\u2600\uFE0F' : '\uD83C\uDF19'}
      </button>

      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user.picture && (
            <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: 12 }} />
          )}
          <button onClick={logout} style={{ ...btnStyle(theme), fontSize: 11 }}>Logout</button>
        </div>
      )}
    </div>
    </>
  );
}

function btnStyle(theme) {
  return {
    border: 'none', background: 'transparent', cursor: 'pointer',
    color: theme.textSecondary, fontSize: 16, padding: '4px 6px',
    borderRadius: 6, fontFamily: 'inherit'
  };
}
