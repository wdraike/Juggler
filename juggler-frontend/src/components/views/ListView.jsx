/**
 * ListView — grouped list by date
 */

import React, { useMemo, useState } from 'react';
import TaskCard from '../tasks/TaskCard';
import QuickAddTask from '../tasks/QuickAddTask';
import { getTheme } from '../../theme/colors';
import { DAY_NAMES, MONTH_NAMES } from '../../state/constants';
import { parseDate, formatDateKey } from '../../scheduler/dateHelpers';
import { getLocationForDatePure } from '../../scheduler/locationHelpers';

var DONE_RANGES = [
  { value: '7',   label: '7d' },
  { value: '30',  label: '30d' },
  { value: '90',  label: '90d' },
  { value: 'all', label: 'All' },
];

export default function ListView({ allTasks, statuses, filter, search, projectFilter, onStatusChange, onDelete, onExpand, onCreate, darkMode, schedCfg, blockedTaskIds, unplacedIds, pastDueIds, fixedIds, isMobile, todayDate }) {
  var theme = getTheme(darkMode);
  var todayKey = todayDate ? formatDateKey(todayDate) : formatDateKey(new Date());
  var [doneRange, setDoneRange] = useState('30');

  var filteredTasks = useMemo(() => {
    return allTasks.filter(t => {
      var st = statuses[t.id] || '';
      if (filter === 'open') return st !== 'done' && st !== 'cancel' && st !== 'skip' && st !== 'pause';
      if (filter === 'action') return st === '' || st === 'wip';
      if (filter === 'done') return st === 'done';
      if (filter === 'wip') return st === 'wip';
      if (filter === 'pause') return st === 'pause';
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
  }, [allTasks, statuses, filter, search, projectFilter, blockedTaskIds, unplacedIds, pastDueIds, fixedIds]);

  // ISO cutoff key for the selected done range (null = show all)
  var doneRangeCutoff = useMemo(() => {
    if (filter !== 'done' || doneRange === 'all') return null;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(doneRange) + 1);
    cutoff.setHours(0, 0, 0, 0);
    return formatDateKey(cutoff);
  }, [filter, doneRange, todayDate]); // eslint-disable-line

  var grouped = useMemo(() => {
    var map = {};
    filteredTasks.forEach(t => {
      var key = t.date || 'TBD';
      if (doneRangeCutoff && key !== 'TBD' && key < doneRangeCutoff) return;
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    var isDone = filter === 'done';
    return Object.entries(map).sort(([a], [b]) => {
      if (a === 'TBD') return 1;
      if (b === 'TBD') return -1;
      var da = parseDate(a), db = parseDate(b);
      return isDone ? (db || 0) - (da || 0) : (da || 0) - (db || 0);
    });
  }, [filteredTasks, filter, doneRangeCutoff]);

  var doneStats = useMemo(() => {
    if (filter !== 'done') return null;
    var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    var weekAgoKey = formatDateKey(weekAgo);
    var todayCount = 0, weekCount = 0, rangeCount = 0;
    filteredTasks.forEach(t => {
      if (!t.date) return;
      if (t.date === todayKey) todayCount++;
      if (t.date >= weekAgoKey && t.date <= todayKey) weekCount++;
      if (!doneRangeCutoff || t.date >= doneRangeCutoff) rangeCount++;
    });
    return { today: todayCount, week: weekCount, range: rangeCount, total: filteredTasks.length };
  }, [filter, filteredTasks, todayKey, doneRangeCutoff]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 8 : 12 }}>
      {doneStats && (
        <>
          <div style={{ display: 'flex', gap: 20, padding: '6px 0 8px', fontSize: 11, color: theme.textMuted }}>
            <span><strong style={{ color: theme.text, fontSize: 15 }}>{doneStats.today}</strong> today</span>
            <span><strong style={{ color: theme.text, fontSize: 15 }}>{doneStats.week}</strong> this week</span>
            {doneRange === 'all'
              ? <span><strong style={{ color: theme.text, fontSize: 15 }}>{doneStats.total}</strong> total</span>
              : <span><strong style={{ color: theme.text, fontSize: 15 }}>{doneStats.range}</strong> past {doneRange}d</span>
            }
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            {DONE_RANGES.map(function(r) {
              var on = doneRange === r.value;
              return (
                <button key={r.value} onClick={function() { setDoneRange(r.value); }}
                  style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                    border: on ? '2px solid ' + theme.accent : '1px solid ' + theme.border,
                    background: on ? theme.accent + '22' : theme.bgCard,
                    color: on ? theme.accent : theme.textMuted,
                    fontWeight: on ? 600 : 400, fontFamily: 'inherit'
                  }}>
                  {r.label}
                </button>
              );
            })}
          </div>
        </>
      )}
      {grouped.map(([dateKey, tasks]) => {
        var d = parseDate(dateKey);
        var loc = dateKey !== 'TBD' ? getLocationForDatePure(dateKey, schedCfg) : null;
        var isToday = dateKey === todayKey;
        var isPast = d && d < (todayDate || new Date(new Date().setHours(0, 0, 0, 0)));

        return (
          <div key={dateKey} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: isToday ? theme.accent : isPast ? theme.textMuted : theme.text,
              padding: '4px 0', borderBottom: `1px solid ${theme.border}`, marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 6
            }}>
              {d ? `${DAY_NAMES[d.getDay()]} ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}` : 'TBD'}
              {isToday && <span style={{ fontSize: 10, background: theme.accent, color: '#FDFAF5', borderRadius: 4, padding: '1px 6px' }}>Today</span>}
              {loc && <span style={{ fontSize: 10, color: theme.textMuted }}>{loc.icon}</span>}
              {filter === 'done' && <span style={{ fontSize: 10, color: theme.textMuted, fontWeight: 400, marginLeft: 'auto' }}>✓ {tasks.length}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {tasks.map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  status={statuses[t.id] || ''}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  onExpand={onExpand}
                  darkMode={darkMode}
                  isBlocked={blockedTaskIds && blockedTaskIds.has(t.id)}
                  isMobile={isMobile}
                  allTasks={allTasks} statuses={statuses}
                  todayDate={todayDate}
                />
              ))}
            </div>
            {d && filter !== 'done' && <QuickAddTask date={d} onCreate={onCreate} darkMode={darkMode} isMobile={isMobile} />}
          </div>
        );
      })}
      {grouped.length === 0 && (
        <div style={{ textAlign: 'center', color: theme.textMuted, padding: 40, fontSize: 14 }}>
          {filter === 'done'
            ? (doneRange === 'all' ? 'No completed tasks yet' : 'No completed tasks in the past ' + doneRange + ' days')
            : 'No tasks match current filters'}
        </div>
      )}
    </div>
  );
}
