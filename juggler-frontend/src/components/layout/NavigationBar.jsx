/**
 * NavigationBar — view mode tabs + filter pills
 */

import React from 'react';
import { getTheme } from '../../theme/colors';

const VIEW_MODES = [
  { id: 'day', label: 'Day', icon: '1' },
  { id: '3day', label: '3-Day', icon: '3' },
  { id: 'week', label: 'Week', icon: '7' },
  { id: 'month', label: 'Month', icon: 'M' },
  { id: 'list', label: 'List', icon: '\u2261' },
  { id: 'priority', label: 'Priority', icon: 'P' },
  { id: 'conflicts', label: 'Issues', icon: '!' },
];

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'action', label: 'Action' },
  { id: 'all', label: 'All' },
  { id: 'done', label: 'Done' },
  { id: 'wip', label: 'WIP' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'unplaced', label: 'Unplaced' },
];

export default function NavigationBar({ viewMode, setViewMode, filter, setFilter, search, setSearch, darkMode, projectFilter, setProjectFilter, allProjectNames, hideHabits, setHideHabits, unplacedCount, blockedCount }) {
  var theme = getTheme(darkMode);

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
      padding: '8px 12px', background: theme.bgSecondary, borderBottom: `1px solid ${theme.border}`
    }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {VIEW_MODES.map(v => (
          <button key={v.id} onClick={() => setViewMode(v.id)}
            style={{
              border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
              background: viewMode === v.id ? theme.accent : 'transparent',
              color: viewMode === v.id ? '#FFF' : theme.textSecondary,
              fontSize: 11, fontWeight: viewMode === v.id ? 600 : 400, fontFamily: 'inherit'
            }}
            title={v.label}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 20, background: theme.border }} />

      <div style={{ display: 'flex', gap: 2 }}>
        {FILTERS.map(f => {
          var badge = f.id === 'unplaced' && unplacedCount > 0 ? unplacedCount
            : f.id === 'blocked' && blockedCount > 0 ? blockedCount : null;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{
                border: `1px solid ${filter === f.id ? theme.accent : theme.border}`,
                borderRadius: 12, padding: '3px 10px', cursor: 'pointer',
                background: filter === f.id ? theme.accent + '20' : 'transparent',
                color: filter === f.id ? theme.accent : theme.textMuted,
                fontSize: 11, fontFamily: 'inherit', position: 'relative'
              }}
            >
              {f.label}
              {badge != null && (
                <span style={{
                  marginLeft: 3, background: '#EF4444', color: '#FFF', borderRadius: 8,
                  padding: '0 5px', fontSize: 9, fontWeight: 700, verticalAlign: 'top'
                }}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {setHideHabits && (
        <button onClick={() => setHideHabits(h => !h)}
          style={{
            border: `1px solid ${hideHabits ? theme.accent : theme.border}`,
            borderRadius: 12, padding: '3px 10px', cursor: 'pointer',
            background: hideHabits ? theme.accent + '20' : 'transparent',
            color: hideHabits ? theme.accent : theme.textMuted,
            fontSize: 11, fontFamily: 'inherit'
          }}
        >
          {hideHabits ? '🔁 Show Habits' : '🔁 Hide Habits'}
        </button>
      )}

      {allProjectNames && allProjectNames.length > 0 && (
        <select
          value={projectFilter || ''}
          onChange={e => setProjectFilter(e.target.value)}
          style={{
            padding: '4px 8px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
            border: `1px solid ${projectFilter ? theme.accent : theme.border}`,
            background: projectFilter ? theme.accent + '20' : theme.input,
            color: projectFilter ? theme.accent : theme.textMuted,
            fontFamily: 'inherit', outline: 'none'
          }}
        >
          <option value="">All Projects</option>
          {allProjectNames.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      )}

      <input
        type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search tasks..."
        style={{
          flex: 1, minWidth: 120, maxWidth: 240, padding: '5px 10px',
          border: `1px solid ${theme.inputBorder}`, borderRadius: 8,
          background: theme.input, color: theme.text, fontSize: 12,
          fontFamily: 'inherit', outline: 'none'
        }}
      />
    </div>
  );
}
