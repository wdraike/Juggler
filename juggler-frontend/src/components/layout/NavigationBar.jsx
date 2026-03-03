/**
 * NavigationBar — view mode tabs + filter pills
 * On mobile: filters collapse behind a single dropdown button
 */

import React, { useState, useRef, useEffect } from 'react';
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

export default function NavigationBar({ viewMode, setViewMode, filter, setFilter, search, setSearch, darkMode, projectFilter, setProjectFilter, allProjectNames, hideHabits, setHideHabits, unplacedCount, blockedCount, isMobile }) {
  var theme = getTheme(darkMode);
  var [showFilterDropdown, setShowFilterDropdown] = useState(false);
  var filterRef = useRef(null);

  // Close filter dropdown on outside click
  useEffect(function() {
    if (!showFilterDropdown) return;
    function handleClick(e) {
      if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilterDropdown(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [showFilterDropdown]);

  var activeFilterLabel = FILTERS.find(function(f) { return f.id === filter; });
  activeFilterLabel = activeFilterLabel ? activeFilterLabel.label : filter;

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: isMobile ? 4 : 8, alignItems: 'center',
      padding: isMobile ? '4px 8px' : '8px 12px', background: theme.bgSecondary, borderBottom: `1px solid ${theme.border}`,
      overflowX: isMobile ? 'hidden' : 'visible'
    }}>
      {/* View mode tabs — on mobile, spread across full width */}
      <div style={{ display: 'flex', gap: isMobile ? 0 : 2, flex: isMobile ? '1 1 100%' : undefined, justifyContent: isMobile ? 'space-between' : undefined }}>
        {VIEW_MODES.map(v => (
          <button key={v.id} onClick={() => setViewMode(v.id)}
            style={{
              border: 'none', borderRadius: 6, padding: isMobile ? '5px 0' : '5px 10px', cursor: 'pointer',
              background: viewMode === v.id ? theme.accent : 'transparent',
              color: viewMode === v.id ? '#FFF' : theme.textSecondary,
              fontSize: isMobile ? 13 : 11, fontWeight: viewMode === v.id ? 600 : 400, fontFamily: 'inherit',
              minHeight: isMobile ? 32 : undefined,
              flex: isMobile ? 1 : undefined, textAlign: 'center'
            }}
            title={v.label}
          >
            {isMobile ? v.icon : v.label}
          </button>
        ))}
      </div>

      {!isMobile && <div style={{ width: 1, height: 20, background: theme.border, flexShrink: 0 }} />}

      {/* Desktop: inline filter pills */}
      {!isMobile && (
        <>
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
                    fontSize: 11, fontFamily: 'inherit', position: 'relative',
                    whiteSpace: 'nowrap'
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
                fontSize: 11, fontFamily: 'inherit', whiteSpace: 'nowrap'
              }}
            >
              {hideHabits ? '\uD83D\uDD01 Show Habits' : '\uD83D\uDD01 Hide Habits'}
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
        </>
      )}

      {/* Mobile row 2: filter dropdown + search */}
      {isMobile && (
        <div ref={filterRef} style={{ position: 'relative', flex: '1 1 100%', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={function() { setShowFilterDropdown(function(v) { return !v; }); }}
            style={{
              border: `1px solid ${theme.accent}`, borderRadius: 12, padding: '4px 10px',
              cursor: 'pointer', background: theme.accent + '20', color: theme.accent,
              fontSize: 11, fontFamily: 'inherit', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 4, minHeight: 32
            }}
          >
            {activeFilterLabel} &#x25BE;
          </button>

          {/* Search inline on mobile — full remaining width */}
          <input
            type="text" value={search} onChange={function(e) { setSearch(e.target.value); }}
            placeholder="Search..."
            style={{
              flex: 1, minWidth: 80, padding: '5px 10px',
              border: `1px solid ${theme.inputBorder}`, borderRadius: 8,
              background: theme.input, color: theme.text, fontSize: 12,
              fontFamily: 'inherit', outline: 'none'
            }}
          />

          {showFilterDropdown && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: theme.bgSecondary, border: `1px solid ${theme.border}`,
              borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              zIndex: 200, minWidth: 200, overflow: 'hidden'
            }}>
              {/* Filter options */}
              {FILTERS.map(function(f) {
                var badge = f.id === 'unplaced' && unplacedCount > 0 ? unplacedCount
                  : f.id === 'blocked' && blockedCount > 0 ? blockedCount : null;
                var isActive = filter === f.id;
                return (
                  <button key={f.id} onClick={function() { setFilter(f.id); setShowFilterDropdown(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', border: 'none', cursor: 'pointer',
                      padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                      background: isActive ? theme.accent + '15' : 'transparent',
                      color: isActive ? theme.accent : theme.text,
                      fontWeight: isActive ? 600 : 400,
                      minHeight: 40
                    }}>
                    <span>{f.label}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {badge != null && (
                        <span style={{
                          background: '#EF4444', color: '#FFF', borderRadius: 8,
                          padding: '0 6px', fontSize: 10, fontWeight: 700
                        }}>{badge}</span>
                      )}
                      {isActive && <span style={{ color: theme.accent }}>&#x2713;</span>}
                    </span>
                  </button>
                );
              })}

              {/* Divider */}
              <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />

              {/* Hide habits toggle */}
              {setHideHabits && (
                <button onClick={function() { setHideHabits(function(h) { return !h; }); setShowFilterDropdown(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', border: 'none', cursor: 'pointer',
                    padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                    background: 'transparent', color: theme.text, minHeight: 40
                  }}>
                  <span>{hideHabits ? '\uD83D\uDD01 Show Habits' : '\uD83D\uDD01 Hide Habits'}</span>
                  {hideHabits && <span style={{ color: theme.accent }}>&#x2713;</span>}
                </button>
              )}

              {/* Project filter */}
              {allProjectNames && allProjectNames.length > 0 && (
                <div style={{ padding: '8px 14px' }}>
                  <select
                    value={projectFilter || ''}
                    onChange={function(e) { setProjectFilter(e.target.value); setShowFilterDropdown(false); }}
                    style={{
                      width: '100%', padding: '6px 8px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                      border: `1px solid ${projectFilter ? theme.accent : theme.border}`,
                      background: projectFilter ? theme.accent + '20' : theme.input,
                      color: projectFilter ? theme.accent : theme.textMuted,
                      fontFamily: 'inherit', outline: 'none'
                    }}
                  >
                    <option value="">All Projects</option>
                    {allProjectNames.map(function(p) { return <option key={p} value={p}>{p}</option>; })}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
