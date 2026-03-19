/**
 * PriorityView — P1-P4 kanban columns with drag-and-drop
 */

import React, { useMemo, useState } from 'react';
import TaskCard from '../tasks/TaskCard';
import { getTheme } from '../../theme/colors';
import { PRI_COLORS } from '../../state/constants';

var PRI_LEVELS = ['P1', 'P2', 'P3', 'P4'];

export default function PriorityView({ allTasks, statuses, directions, filter, search, projectFilter, onStatusChange, onExpand, darkMode, onPriorityDrop, hideHabits, blockedTaskIds, unplacedIds, pastDueIds, fixedIds, isMobile }) {
  var theme = getTheme(darkMode);
  var [dragOver, setDragOver] = useState(null);

  var filteredTasks = useMemo(() => {
    // Exclude habit templates — only show instances.
    // Deduplicate habits: for each habit text, pick the best representative instance.
    // Prefer open instances over done/skipped/cancelled ones so today's habit is shown.
    var habitBest = {};
    allTasks.forEach(t => {
      if (!t.habit || t.taskType === 'habit_template') return;
      var key = t.text || t.id;
      var st = statuses[t.id] || '';
      var isOpen = st !== 'done' && st !== 'cancel' && st !== 'skip';
      var prev = habitBest[key];
      if (!prev || (isOpen && !prev.isOpen)) {
        habitBest[key] = { id: t.id, isOpen: isOpen };
      }
    });
    var habitKeepIds = {};
    Object.keys(habitBest).forEach(k => { habitKeepIds[habitBest[k].id] = true; });
    var deduped = allTasks.filter(t => {
      if (t.taskType === 'habit_template') return false;
      if (t.habit) return !!habitKeepIds[t.id];
      return true;
    });

    return deduped.filter(t => {
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

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: 1, overflow: 'auto', gap: 8, padding: isMobile ? 8 : 12 }}>
      {PRI_LEVELS.map(pri => {
        var tasks = filteredTasks.filter(t => (t.pri || 'P3') === pri);
        var isOver = dragOver === pri;
        return (
          <div key={pri} style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column' }}
            onDragOver={onPriorityDrop ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(pri); }) : undefined}
            onDragLeave={onPriorityDrop ? (() => setDragOver(null)) : undefined}
            onDrop={onPriorityDrop ? (e => {
              e.preventDefault();
              var taskId = e.dataTransfer.getData('text/plain');
              if (taskId) onPriorityDrop(taskId, pri);
              setDragOver(null);
            }) : undefined}
          >
            <div style={{
              fontSize: 13, fontWeight: 700, color: PRI_COLORS[pri],
              padding: '6px 8px', borderBottom: `2px solid ${PRI_COLORS[pri]}`,
              marginBottom: 8, background: isOver ? PRI_COLORS[pri] + '15' : 'transparent',
              borderRadius: isOver ? 4 : 0, transition: 'background 0.15s'
            }}>
              {pri} <span style={{ fontSize: 10, fontWeight: 400, color: theme.textMuted }}>({tasks.length})</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              {tasks.map(t => (
                <TaskCard
                  key={t.id}
                  task={t}
                  status={statuses[t.id] || ''}
                  direction={directions[t.id]}
                  onStatusChange={onStatusChange}
                  onExpand={onExpand}
                  darkMode={darkMode}
                  showDate
                  draggable
                  isBlocked={blockedTaskIds && blockedTaskIds.has(t.id)}
                  isMobile={isMobile}
                  allTasks={allTasks} statuses={statuses}
                />
              ))}
              {tasks.length === 0 && (
                <div style={{ fontSize: 11, color: theme.textMuted, padding: 12, textAlign: 'center' }}>No tasks</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
