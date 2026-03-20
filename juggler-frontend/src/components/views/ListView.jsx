/**
 * ListView — grouped list by date
 */

import React, { useMemo } from 'react';
import TaskCard from '../tasks/TaskCard';
import QuickAddTask from '../tasks/QuickAddTask';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES, MONTH_NAMES } from '../../state/constants';
import { parseDate, formatDateKey } from '../../scheduler/dateHelpers';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

export default function ListView({ allTasks, statuses, filter, search, projectFilter, onStatusChange, onExpand, onCreate, darkMode, schedCfg, hideHabits, blockedTaskIds, unplacedIds, pastDueIds, fixedIds, isMobile }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(new Date());

  var filteredTasks = useMemo(() => {
    return allTasks.filter(t => {
      if (hideHabits && t.habit) return false;
      var st = statuses[t.id] || '';
      if (filter === 'open') return st !== 'done' && st !== 'cancel' && st !== 'skip';
      if (filter === 'action') return st === '' || st === 'wip';
      if (filter === 'done') return st === 'done';
      if (filter === 'wip') return st === 'wip';
      if (filter === 'pastdue') return pastDueIds && pastDueIds.has(t.id);
      if (filter === 'fixed') return fixedIds && fixedIds.has(t.id);
      if (filter === 'blocked') return blockedTaskIds && blockedTaskIds.has(t.id);
      if (filter === 'unplaced') return unplacedIds && unplacedIds.has(t.id);
      return true;
    }).filter(t => {
      if (projectFilter && (t.project || '') !== projectFilter) return false;
      if (!search) return true;
      var s = search.toLowerCase();
      return (t.text || '').toLowerCase().includes(s) || (t.project || '').toLowerCase().includes(s);
    });
  }, [allTasks, statuses, filter, search, projectFilter, hideHabits, blockedTaskIds, unplacedIds, pastDueIds, fixedIds]);

  var grouped = useMemo(() => {
    var map = {};
    filteredTasks.forEach(t => {
      var key = t.date || 'TBD';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return Object.entries(map).sort(([a], [b]) => {
      if (a === 'TBD') return 1;
      if (b === 'TBD') return -1;
      var da = parseDate(a), db = parseDate(b);
      return (da || 0) - (db || 0);
    });
  }, [filteredTasks]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 8 : 12 }}>
      {grouped.map(([dateKey, tasks]) => {
        var d = parseDate(dateKey);
        var loc = dateKey !== 'TBD' ? getLocationForDatePure(dateKey, schedCfg) : null;
        var isToday = dateKey === todayKey;
        var isPast = d && d < new Date(new Date().setHours(0, 0, 0, 0));

        return (
          <div key={dateKey} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: isToday ? theme.accent : isPast ? theme.textMuted : theme.text,
              padding: '4px 0', borderBottom: `1px solid ${theme.border}`, marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 6
            }}>
              {d ? `${DAY_NAMES[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}` : 'TBD'}
              {isToday && <span style={{ fontSize: 10, background: theme.accent, color: '#FFF', borderRadius: 4, padding: '1px 6px' }}>Today</span>}
              {loc && <span style={{ fontSize: 10, color: theme.textMuted }}>{loc.icon}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {tasks.map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  status={statuses[t.id] || ''}

                  onStatusChange={onStatusChange}
                  onExpand={onExpand}
                  darkMode={darkMode}
                  isBlocked={blockedTaskIds && blockedTaskIds.has(t.id)}
                  isMobile={isMobile}
                  allTasks={allTasks} statuses={statuses}
                />
              ))}
            </div>
            {d && <QuickAddTask date={d} onCreate={onCreate} darkMode={darkMode} isMobile={isMobile} />}
          </div>
        );
      })}
      {grouped.length === 0 && (
        <div style={{ textAlign: 'center', color: theme.textMuted, padding: 40, fontSize: 14 }}>
          No tasks match current filters
        </div>
      )}
    </div>
  );
}
